-- Account assistance with three durations (plan 12.17, 1 November 2026): one hour and 24 hours,
-- always available, and a seven-day initial setup that the owner can give only while the
-- practice has no patients. Once given it lasts what was chosen: loading patients, test or real,
-- neither ends nor shortens it. Only the owner gives and extends it; an extension counts from
-- that moment and never shortens it. The owner and the support user of the grant can end it,
-- and the grant and the audit log record who did.
--
-- What the assistance allows does not change: the support user acts as an administrator of the
-- practice while a grant is active (user_has_active_account_assistance), whatever its duration.
--
-- activate_account_assistance(uuid, uuid) and revoke_account_assistance(uuid) stay as V10b uses
-- them: the version served while this migration is applied, and the one a recovery returns to.
-- The first one inserts without a duration, so the column default is its one hour.

begin;

alter table public.account_assistance_grants
	add column if not exists kind text not null default 'hour',
	add column if not exists extended_at timestamptz,
	add column if not exists revoked_by_role text;

comment on column public.account_assistance_grants.kind is
	'hour, day or initial_setup (seven days). The default is the one hour V10b gives.';
comment on column public.account_assistance_grants.extended_at is
	'Last extension. The grant ends at this moment, or at starts_at if never extended, plus its duration.';
comment on column public.account_assistance_grants.revoked_by_role is
	'Who ended the grant: owner or support. Null when it expired, or when V10b ended it (only the owner could).';

alter table public.account_assistance_grants
	drop constraint if exists account_assistance_grants_kind_check,
	add constraint account_assistance_grants_kind_check check (kind in ('hour', 'day', 'initial_setup')),
	drop constraint if exists account_assistance_grants_extended_after_start_check,
	add constraint account_assistance_grants_extended_after_start_check check (extended_at is null or extended_at >= starts_at),
	-- Whatever writes the table, no grant lasts more than seven days from its last activation
	-- or extension. The functions below give each duration exactly.
	drop constraint if exists account_assistance_grants_seven_day_cap_check,
	add constraint account_assistance_grants_seven_day_cap_check check (expires_at <= coalesce(extended_at, starts_at) + interval '7 days'),
	drop constraint if exists account_assistance_grants_revoked_by_role_check,
	add constraint account_assistance_grants_revoked_by_role_check check (
		revoked_by_role is null or (revoked_by_role in ('owner', 'support') and status = 'revoked')
	);

create or replace function private.account_assistance_duration(p_kind text)
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
	select case p_kind
		when 'hour' then interval '60 minutes'
		when 'day' then interval '24 hours'
		when 'initial_setup' then interval '7 days'
	end;
$$;

-- Longer durations rank higher; an extension only moves up, except that the initial setup can
-- be renewed.
create or replace function private.account_assistance_rank(p_kind text)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
	select case p_kind when 'hour' then 1 when 'day' then 2 when 'initial_setup' then 3 end;
$$;

create or replace function private.account_assistance_is_owner(p_business_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
	select exists (
		select 1
		from public.business_users bu
		where bu.business_id = p_business_id
			and bu.user_id = p_user_id
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
			and bu.role = 'owner'
	);
$$;

-- Any patient counts, archived ones too: the initial setup is for a practice that has none yet.
create or replace function private.account_assistance_business_has_patients(p_business_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
	select exists (select 1 from public.patients p where p.business_id = p_business_id);
$$;

-- Whether the practice has patients, for the owner choosing a duration.
create or replace function public.account_assistance_has_patients(target_business_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if not private.account_assistance_is_owner(target_business_id, auth.uid()) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;
	return private.account_assistance_business_has_patients(target_business_id);
end;
$$;

-- The owner gives the assistance for the duration chosen. Asking again for the duration that is
-- active returns the same grant; another duration is an extension, never a silent replacement.
create or replace function public.start_account_assistance(
	target_business_id uuid,
	target_support_user_id uuid,
	target_kind text
)
returns setof public.account_assistance_grants
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
	v_actor uuid := auth.uid();
	v_now timestamptz := now();
	v_grant public.account_assistance_grants%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if private.account_assistance_duration(target_kind) is null then
		raise exception 'ACCOUNT_ASSISTANCE_KIND_INVALID';
	end if;
	if not private.account_assistance_is_owner(target_business_id, v_actor) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;
	if not public.business_allows_operation(target_business_id) then
		raise exception 'ACCOUNT_ASSISTANCE_BUSINESS_NOT_AVAILABLE';
	end if;

	perform 1 from public.businesses business_lock where business_lock.id = target_business_id for update;

	if not exists (
		select 1
		from public.account_assistance_support_users support
		where support.user_id = target_support_user_id
			and support.enabled = true
	) then
		raise exception 'ACCOUNT_ASSISTANCE_SUPPORT_USER_NOT_ENABLED';
	end if;

	update public.account_assistance_grants existing
	set status = 'expired', updated_at = v_now
	where existing.business_id = target_business_id
		and existing.status = 'active'
		and existing.revoked_at is null
		and existing.expires_at <= v_now;

	select * into v_grant
	from public.account_assistance_grants existing
	where existing.business_id = target_business_id
		and existing.status = 'active'
		and existing.revoked_at is null
		and existing.expires_at > v_now
	for update;

	if found then
		if v_grant.kind <> target_kind then
			raise exception 'ACCOUNT_ASSISTANCE_ALREADY_ACTIVE';
		end if;
		return next v_grant;
		return;
	end if;

	-- Checked once, now: patients loaded later neither end nor shorten the initial setup.
	if target_kind = 'initial_setup' and private.account_assistance_business_has_patients(target_business_id) then
		raise exception 'ACCOUNT_ASSISTANCE_INITIAL_SETUP_UNAVAILABLE';
	end if;

	insert into public.account_assistance_grants (
		business_id, requested_by_user_id, support_user_id, status, kind, starts_at, expires_at
	)
	values (
		target_business_id, v_actor, target_support_user_id, 'active', target_kind, v_now,
		v_now + private.account_assistance_duration(target_kind)
	)
	returning * into v_grant;

	insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id, v_actor, 'account_assistance.activated', 'account_assistance_grant', v_grant.id,
		jsonb_build_object('support_user_id', target_support_user_id, 'kind', target_kind, 'expires_at', v_grant.expires_at)
	);

	return next v_grant;
end;
$$;

-- The owner moves the active grant shown to a longer duration, counted from now, on the same
-- grant. The initial setup can be renewed for seven more days even with patients; moving to it
-- from a shorter duration needs a practice without patients, as giving it does.
create or replace function public.extend_account_assistance(
	target_business_id uuid,
	target_grant_id uuid,
	target_kind text
)
returns setof public.account_assistance_grants
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
	v_actor uuid := auth.uid();
	v_now timestamptz := now();
	v_grant public.account_assistance_grants%rowtype;
	v_previous public.account_assistance_grants%rowtype;
	v_expires_at timestamptz;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if private.account_assistance_duration(target_kind) is null then
		raise exception 'ACCOUNT_ASSISTANCE_KIND_INVALID';
	end if;
	if not private.account_assistance_is_owner(target_business_id, v_actor) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;
	if not public.business_allows_operation(target_business_id) then
		raise exception 'ACCOUNT_ASSISTANCE_BUSINESS_NOT_AVAILABLE';
	end if;

	perform 1 from public.businesses business_lock where business_lock.id = target_business_id for update;

	select * into v_grant
	from public.account_assistance_grants existing
	where existing.id = target_grant_id
		and existing.business_id = target_business_id
		and existing.status = 'active'
		and existing.revoked_at is null
		and existing.expires_at > v_now
	for update;

	if not found then
		raise exception 'ACCOUNT_ASSISTANCE_NOT_ACTIVE';
	end if;

	if not (
		private.account_assistance_rank(target_kind) > coalesce(private.account_assistance_rank(v_grant.kind), 0)
		or (target_kind = 'initial_setup' and v_grant.kind = 'initial_setup')
	) then
		raise exception 'ACCOUNT_ASSISTANCE_EXTENSION_NOT_ALLOWED';
	end if;
	if target_kind = 'initial_setup' and v_grant.kind <> 'initial_setup'
		and private.account_assistance_business_has_patients(target_business_id) then
		raise exception 'ACCOUNT_ASSISTANCE_INITIAL_SETUP_UNAVAILABLE';
	end if;

	v_expires_at := v_now + private.account_assistance_duration(target_kind);
	if v_expires_at <= v_grant.expires_at then
		raise exception 'ACCOUNT_ASSISTANCE_EXTENSION_NOT_ALLOWED';
	end if;

	v_previous := v_grant;
	update public.account_assistance_grants
	set kind = target_kind, extended_at = v_now, expires_at = v_expires_at, updated_at = v_now
	where account_assistance_grants.id = v_grant.id
	returning * into v_grant;

	insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id, v_actor, 'account_assistance.extended', 'account_assistance_grant', v_grant.id,
		jsonb_build_object(
			'support_user_id', v_grant.support_user_id,
			'kind', v_grant.kind,
			'expires_at', v_grant.expires_at,
			'previous_kind', v_previous.kind,
			'previous_expires_at', v_previous.expires_at
		)
	);

	return next v_grant;
end;
$$;

-- The owner, or the support user of the grant, ends the active grant shown. Anyone else gets
-- the same refusal whatever the state of the grant.
create or replace function public.end_account_assistance(
	target_business_id uuid,
	target_grant_id uuid
)
returns setof public.account_assistance_grants
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
	v_actor uuid := auth.uid();
	v_now timestamptz := now();
	v_is_owner boolean;
	v_grant public.account_assistance_grants%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	v_is_owner := private.account_assistance_is_owner(target_business_id, v_actor);
	if not v_is_owner and not exists (
		select 1
		from public.account_assistance_grants g
		where g.id = target_grant_id
			and g.business_id = target_business_id
			and g.support_user_id = v_actor
	) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;

	perform 1 from public.businesses business_lock where business_lock.id = target_business_id for update;

	select * into v_grant
	from public.account_assistance_grants existing
	where existing.id = target_grant_id
		and existing.business_id = target_business_id
		and existing.status = 'active'
		and existing.revoked_at is null
		and existing.expires_at > v_now
	for update;

	if not found then
		raise exception 'ACCOUNT_ASSISTANCE_NOT_ACTIVE';
	end if;

	update public.account_assistance_grants
	set
		status = 'revoked',
		revoked_at = v_now,
		revoked_by_user_id = v_actor,
		revoked_by_role = case when v_is_owner then 'owner' else 'support' end,
		dismissed_at = null,
		dismissed_by_user_id = null,
		updated_at = v_now
	where account_assistance_grants.id = v_grant.id
	returning * into v_grant;

	insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id, v_actor, 'account_assistance.revoked', 'account_assistance_grant', v_grant.id,
		jsonb_build_object('support_user_id', v_grant.support_user_id, 'kind', v_grant.kind, 'revoked_by_role', v_grant.revoked_by_role)
	);

	return next v_grant;
end;
$$;

revoke execute on function private.account_assistance_duration(text) from public;
revoke execute on function private.account_assistance_rank(text) from public;
revoke execute on function private.account_assistance_is_owner(uuid, uuid) from public;
revoke execute on function private.account_assistance_business_has_patients(uuid) from public;

revoke execute on function public.account_assistance_has_patients(uuid) from public, anon;
revoke execute on function public.start_account_assistance(uuid, uuid, text) from public, anon;
revoke execute on function public.extend_account_assistance(uuid, uuid, text) from public, anon;
revoke execute on function public.end_account_assistance(uuid, uuid) from public, anon;

grant execute on function public.account_assistance_has_patients(uuid) to authenticated;
grant execute on function public.start_account_assistance(uuid, uuid, text) to authenticated;
grant execute on function public.extend_account_assistance(uuid, uuid, text) to authenticated;
grant execute on function public.end_account_assistance(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
