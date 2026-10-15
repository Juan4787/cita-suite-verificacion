-- Open account creation while keeping full app access gated by commercial
-- activation. Abuse prevention moves from discretionary email allowlisting to
-- server-side rate limits and one pending self-service business per user.

create table if not exists public.server_rate_limit_events (
	id uuid primary key default gen_random_uuid(),
	action text not null,
	subject_hash text not null,
	created_at timestamptz not null default now()
);

create index if not exists server_rate_limit_events_lookup_idx
	on public.server_rate_limit_events (action, subject_hash, created_at desc);

create index if not exists server_rate_limit_events_created_at_idx
	on public.server_rate_limit_events (created_at);

alter table public.server_rate_limit_events enable row level security;

drop policy if exists server_rate_limit_events_no_direct_access on public.server_rate_limit_events;

comment on table public.server_rate_limit_events is
	'Server-only event log for abuse rate limiting. Subjects are pre-hashed by the app server; no direct client access.';

create or replace function public.consume_server_rate_limit(
	p_action text,
	p_subject_hash text,
	p_limit integer,
	p_window_seconds integer
)
returns table(allowed boolean, used integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_action text := lower(nullif(trim(coalesce(p_action, '')), ''));
	v_subject_hash text := lower(nullif(trim(coalesce(p_subject_hash, '')), ''));
	v_limit integer := greatest(coalesce(p_limit, 0), 0);
	v_window_seconds integer := greatest(coalesce(p_window_seconds, 0), 0);
	v_since timestamptz;
	v_used integer;
	v_oldest timestamptz;
begin
	if v_action is null or v_subject_hash is null or v_limit <= 0 or v_window_seconds <= 0 then
		raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
	end if;

	if v_action not in (
		'signup_email_by_email',
		'signup_email_by_ip',
		'signup_google_by_ip',
		'login_password_by_email',
		'login_password_by_ip',
		'pending_business_creation_by_user',
		'pending_business_creation_by_ip',
		'mp_subscription_create_by_business'
	) then
		raise exception 'RATE_LIMIT_UNKNOWN_ACTION';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(v_action || ':' || v_subject_hash, 0));

	v_since := now() - make_interval(secs => v_window_seconds);

	-- Bounded cleanup keeps the table small without making every request scan
	-- old history. A 7 day retention is enough for the current windows.
	delete from public.server_rate_limit_events
	where created_at < now() - interval '7 days';

	select count(*)::integer, min(created_at)
	into v_used, v_oldest
	from public.server_rate_limit_events
	where action = v_action
		and subject_hash = v_subject_hash
		and created_at >= v_since;

	if v_used >= v_limit then
		allowed := false;
		used := v_used;
		retry_after_seconds := greatest(
			1,
			ceil(extract(epoch from (v_oldest + make_interval(secs => v_window_seconds) - now())))::integer
		);
		return next;
		return;
	end if;

	insert into public.server_rate_limit_events (action, subject_hash)
	values (v_action, v_subject_hash);

	allowed := true;
	used := v_used + 1;
	retry_after_seconds := 0;
	return next;
end;
$$;

create or replace function public.consume_server_rate_limits(
	p_action text,
	p_subject_hash text,
	p_windows jsonb
)
returns table(allowed boolean, used integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_action text := lower(nullif(trim(coalesce(p_action, '')), ''));
	v_subject_hash text := lower(nullif(trim(coalesce(p_subject_hash, '')), ''));
	v_window record;
	v_since timestamptz;
	v_used integer;
	v_oldest timestamptz;
	v_max_used integer := 0;
	v_retry_after integer := 0;
begin
	if v_action is null or v_subject_hash is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) = 0 then
		raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
	end if;

	if v_action not in (
		'signup_email_by_email',
		'signup_email_by_ip',
		'signup_google_by_ip',
		'login_password_by_email',
		'login_password_by_ip',
		'pending_business_creation_by_user',
		'pending_business_creation_by_ip',
		'mp_subscription_create_by_business'
	) then
		raise exception 'RATE_LIMIT_UNKNOWN_ACTION';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(v_action || ':' || v_subject_hash, 0));

	delete from public.server_rate_limit_events
	where created_at < now() - interval '7 days';

	for v_window in
		select *
		from jsonb_to_recordset(p_windows) as window_defs(limit_count integer, window_seconds integer)
	loop
		if coalesce(v_window.limit_count, 0) <= 0 or coalesce(v_window.window_seconds, 0) <= 0 then
			raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
		end if;

		v_since := now() - make_interval(secs => v_window.window_seconds);

		select count(*)::integer, min(created_at)
		into v_used, v_oldest
		from public.server_rate_limit_events
		where action = v_action
			and subject_hash = v_subject_hash
			and created_at >= v_since;

		v_max_used := greatest(v_max_used, v_used);

		if v_used >= v_window.limit_count then
			v_retry_after := greatest(
				v_retry_after,
				greatest(
					1,
					ceil(extract(epoch from (v_oldest + make_interval(secs => v_window.window_seconds) - now())))::integer
				)
			);
		end if;
	end loop;

	if v_retry_after > 0 then
		allowed := false;
		used := v_max_used;
		retry_after_seconds := v_retry_after;
		return next;
		return;
	end if;

	insert into public.server_rate_limit_events (action, subject_hash)
	values (v_action, v_subject_hash);

	allowed := true;
	used := v_max_used + 1;
	retry_after_seconds := 0;
	return next;
end;
$$;

revoke all on table public.server_rate_limit_events from public, anon, authenticated;
revoke execute on function public.consume_server_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.consume_server_rate_limits(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_server_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.consume_server_rate_limits(text, text, jsonb) to service_role;

create or replace function public.ensure_user_default_business(
	p_name text default null,
	p_industry text default 'odontology'
)
returns table(business_id uuid, role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_user_id uuid := auth.uid();
	v_email text;
	v_business_id uuid;
	v_role text;
	v_invite business_user_invites%rowtype;
	v_name text;
	v_base_slug text;
	v_slug text;
	v_counter integer := 1;
begin
	perform p_name, p_industry;

	if v_user_id is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select bu.business_id, bu.role
	into v_business_id, v_role
	from business_users bu
	where bu.user_id = v_user_id
		and coalesce(bu.status, 'active') = 'active'
	order by bu.created_at asc
	limit 1;

	if v_business_id is not null then
		update business_users bu
		set
			accepted_at = coalesce(bu.accepted_at, now()),
			updated_at = now()
		where bu.business_id = v_business_id
			and bu.user_id = v_user_id;

		business_id := v_business_id;
		role := v_role;
		return next;
		return;
	end if;

	select lower(u.email)
	into v_email
	from auth.users u
	where u.id = v_user_id;

	if v_email is null or v_email = '' then
		raise exception 'DEFAULT_BUSINESS_EMAIL_REQUIRED';
	end if;

	select *
	into v_invite
	from business_user_invites bui
	where lower(bui.email) = v_email
		and bui.status = 'pending'
	order by bui.created_at asc
	limit 1
	for update;

	if found then
		insert into business_users (
			business_id,
			user_id,
			role,
			status,
			accepted_at,
			created_by,
			updated_by
		)
		values (
			v_invite.business_id,
			v_user_id,
			v_invite.role,
			'active',
			now(),
			v_invite.invited_by,
			v_user_id
		)
		on conflict on constraint business_users_business_id_user_id_key
		do update set
			role = excluded.role,
			status = 'active',
			accepted_at = coalesce(business_users.accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = v_user_id,
			updated_at = now();

		if v_invite.role = 'professional' and v_invite.professional_id is not null then
			delete from professional_users pu
			where pu.business_id = v_invite.business_id
				and (
					(pu.user_id = v_user_id and pu.professional_id <> v_invite.professional_id)
					or (pu.professional_id = v_invite.professional_id and pu.user_id <> v_user_id)
				);

			insert into professional_users (business_id, professional_id, user_id)
			values (v_invite.business_id, v_invite.professional_id, v_user_id)
			on conflict on constraint professional_users_business_id_professional_id_user_id_key do nothing;
		else
			delete from professional_users pu
			where pu.business_id = v_invite.business_id
				and pu.user_id = v_user_id;
		end if;

		update business_user_invites bui
		set
			status = 'accepted',
			accepted_user_id = v_user_id,
			accepted_at = now(),
			updated_at = now()
		where bui.id = v_invite.id;

		business_id := v_invite.business_id;
		role := v_invite.role;
		return next;
		return;
	end if;

	-- Self-service users may create exactly one pending business. If support
	-- manually disables/removes the membership, repeated automatic creation
	-- stays blocked until an admin resolves the account.
	if exists (
		select 1
		from business_users bu
			join business_subscriptions bs on bs.business_id = bu.business_id
		where bu.user_id = v_user_id
			and bu.role = 'owner'
			and bs.is_permanent = false
			and bs.paid_until is null
			and bs.last_payment_at is null
			and bs.access_source = 'internal'
	) then
		raise exception 'DEFAULT_BUSINESS_PENDING_LIMIT_REACHED';
	end if;

	v_name := nullif(trim(coalesce(p_name, '')), '');
	if v_name is null then
		v_name := 'Consultorio';
	end if;

	v_base_slug := public.slugify_business_slug(coalesce(split_part(v_email, '@', 1), v_name));
	if v_base_slug is null or v_base_slug = '' then
		v_base_slug := 'consultorio';
	end if;

	v_slug := v_base_slug || '-' || replace(left(v_user_id::text, 8), '-', '');
	while exists (select 1 from businesses b where b.slug = v_slug) loop
		v_counter := v_counter + 1;
		v_slug := v_base_slug || '-' || replace(left(v_user_id::text, 8), '-', '') || '-' || v_counter::text;
	end loop;

	insert into businesses (name, slug, industry, email)
	values (
		v_name,
		v_slug,
		case
			when p_industry in ('odontology','aesthetics','kinesiology','nutrition','therapy','other')
				then p_industry
			else 'odontology'
		end,
		v_email
	)
	returning id into v_business_id;

	insert into business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_user_id, 'owner', 'active', now());

	business_id := v_business_id;
	role := 'owner';
	return next;
end;
$$;

comment on function public.ensure_user_default_business(text, text) is
	'Accepts pending invites first; otherwise creates one restricted self-service owner business for any authenticated user. App access remains gated by business_subscriptions.';

revoke execute on function public.ensure_user_default_business(text, text) from public, anon;
grant execute on function public.ensure_user_default_business(text, text) to authenticated;

notify pgrst, 'reload schema';
