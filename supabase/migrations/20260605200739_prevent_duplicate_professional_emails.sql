-- Roles/professionals consistency hardening.
-- Keep role actions behind RPCs and prevent new duplicate professional emails.

alter table business_users
	add column if not exists status text not null default 'active' check (status in ('active','disabled')),
	add column if not exists accepted_at timestamptz,
	add column if not exists disabled_at timestamptz,
	add column if not exists disabled_reason text,
	add column if not exists created_by uuid references auth.users(id),
	add column if not exists updated_by uuid references auth.users(id),
	add column if not exists updated_at timestamptz not null default now();

update business_users
set
	status = coalesce(status, 'active'),
	accepted_at = coalesce(accepted_at, created_at),
	updated_at = coalesce(updated_at, created_at, now())
where accepted_at is null
	or updated_at is null;

update allowed_emails
set
	email = lower(trim(email)),
	updated_at = now()
where email is distinct from lower(trim(email));

with normalized_allowed_emails as (
	select
		id,
		lower(trim(email)) as normalized_email,
		bool_or(enabled) over (partition by lower(trim(email))) as any_enabled,
		row_number() over (
			partition by lower(trim(email))
			order by created_at asc nulls last, id asc
		) as row_number
	from allowed_emails
),
kept_allowed_emails as (
	update allowed_emails ae
	set
		enabled = normalized.any_enabled,
		updated_at = now()
	from normalized_allowed_emails normalized
	where ae.id = normalized.id
		and normalized.row_number = 1
	returning ae.id
)
delete from allowed_emails ae
using normalized_allowed_emails normalized
where ae.id = normalized.id
	and normalized.row_number > 1;

create unique index if not exists allowed_emails_email_uq
	on allowed_emails (email);

create or replace function public.user_business_role(target_business_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
	select bu.role
	from business_users bu
	where bu.business_id = target_business_id
		and bu.user_id = auth.uid()
		and coalesce(bu.status, 'active') = 'active'
		and bu.accepted_at is not null
	order by
		case bu.role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end
	limit 1;
$$;

create or replace function public.user_has_business_access(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
		select 1
		from business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = auth.uid()
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
	);
$$;

create or replace function public.count_active_business_owners(target_business_id uuid)
returns integer
language sql
security definer
set search_path = public, auth
as $$
	select count(*)::integer
	from business_users bu
	join auth.users au on au.id = bu.user_id
	join allowed_emails ae on lower(ae.email) = lower(au.email)
	where bu.business_id = target_business_id
		and bu.role = 'owner'
		and coalesce(bu.status, 'active') = 'active'
		and bu.accepted_at is not null
		and ae.enabled = true;
$$;

create or replace function public.prevent_duplicate_professional_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_email text := lower(trim(coalesce(new.email, '')));
begin
	if v_email = '' then
		new.email := null;
		return new;
	end if;

	new.email := v_email;

	if exists (
		select 1
		from professionals p
		where p.business_id = new.business_id
			and p.id <> new.id
			and lower(trim(coalesce(p.email, ''))) = v_email
	) then
		raise exception 'PROFESSIONAL_EMAIL_ALREADY_EXISTS';
	end if;

	return new;
end;
$$;

update professionals
set
	email = nullif(lower(trim(email)), ''),
	updated_at = now()
where email is distinct from nullif(lower(trim(email)), '');

with ranked_professional_emails as (
	select
		id,
		row_number() over (
			partition by business_id, lower(trim(email))
			order by created_at asc nulls last, id asc
		) as row_number
	from professionals
	where nullif(lower(trim(coalesce(email, ''))), '') is not null
)
update professionals p
set
	email = null,
	updated_at = now()
from ranked_professional_emails ranked
where p.id = ranked.id
	and ranked.row_number > 1;

create unique index if not exists professionals_business_normalized_email_uq
	on professionals (business_id, lower(trim(email)))
	where nullif(trim(coalesce(email, '')), '') is not null;

drop trigger if exists trg_prevent_duplicate_professional_email on professionals;
create trigger trg_prevent_duplicate_professional_email
	before insert or update of business_id, email
	on professionals
	for each row
	execute function public.prevent_duplicate_professional_email();

create or replace function public.list_business_role_access(target_business_id uuid)
returns table(
	id uuid,
	business_id uuid,
	user_id uuid,
	email text,
	role text,
	status text,
	professional_id uuid,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
	if not public.user_can_manage_business(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	return query
	select
		access_rows.id,
		access_rows.business_id,
		access_rows.user_id,
		access_rows.email,
		access_rows.role,
		access_rows.status,
		access_rows.professional_id,
		access_rows.created_at
	from (
		select
			bu.id,
			bu.business_id,
			bu.user_id,
			au.email::text as email,
			bu.role::text as role,
			'active'::text as status,
			professional_link.professional_id,
			bu.created_at
		from business_users bu
		left join auth.users au on au.id = bu.user_id
		left join lateral (
			select pu.professional_id
			from professional_users pu
			where pu.business_id = bu.business_id
				and pu.user_id = bu.user_id
			order by pu.created_at asc
			limit 1
		) professional_link on true
		where bu.business_id = target_business_id
			and coalesce(bu.status, 'active') = 'active'
		union all
		select
			bui.id,
			bui.business_id,
			null::uuid as user_id,
			bui.email::text as email,
			bui.role::text as role,
			'pending'::text as status,
			bui.professional_id,
			bui.created_at
		from business_user_invites bui
		where bui.business_id = target_business_id
			and bui.status = 'pending'
	) access_rows
	order by
		case access_rows.role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end,
		access_rows.email nulls last;
end;
$$;

create or replace function public.upsert_business_role_access(
	target_business_id uuid,
	target_email text,
	target_role text,
	target_professional_id uuid default null
)
returns table(status text, membership_id uuid, invite_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_role text;
	v_email text := lower(trim(coalesce(target_email, '')));
	v_target_user_id uuid;
	v_membership_id uuid;
	v_invite_id uuid;
	v_existing_role text;
	v_existing_professional_id uuid;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	v_actor_role := public.user_business_role(target_business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if v_email = '' or position('@' in v_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;
	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;
	if v_actor_role = 'admin' and target_role in ('owner','admin') then
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if target_role = 'professional' and target_professional_id is null then
		raise exception 'PROFESSIONAL_REQUIRED';
	end if;
	if target_professional_id is not null and not exists (
		select 1
		from professionals p
		where p.business_id = target_business_id
			and p.id = target_professional_id
	) then
		raise exception 'PROFESSIONAL_NOT_FOUND';
	end if;

	insert into allowed_emails (email, enabled, created_by, updated_by, disabled_at, disabled_reason, updated_at)
	values (v_email, true, v_actor, v_actor, null, null, now())
	on conflict (email) do update
	set
		enabled = true,
		disabled_at = null,
		disabled_reason = null,
		updated_by = v_actor,
		updated_at = now();

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = v_email
	limit 1;

	if target_role = 'professional' and exists (
		select 1
		from professional_users pu
		where pu.business_id = target_business_id
			and pu.professional_id = target_professional_id
			and (
				v_target_user_id is null
				or pu.user_id <> v_target_user_id
			)
	) then
		raise exception 'PROFESSIONAL_ALREADY_LINKED_TO_USER';
	end if;

	if v_target_user_id is not null then
		select bu.id, bu.role, pu.professional_id
		into v_membership_id, v_existing_role, v_existing_professional_id
		from business_users bu
		left join lateral (
			select professional_link.professional_id
			from professional_users professional_link
			where professional_link.business_id = bu.business_id
				and professional_link.user_id = bu.user_id
			order by professional_link.created_at asc
			limit 1
		) pu on true
		where bu.business_id = target_business_id
			and bu.user_id = v_target_user_id
		for update;

		if v_actor_role = 'admin' and v_existing_role in ('owner','admin') then
			raise exception 'ADMIN_OWNER_ACTION_DENIED';
		end if;
		if v_existing_role = 'owner' and target_role <> 'owner'
			and public.count_active_business_owners(target_business_id) <= 1
		then
			raise exception 'LAST_OWNER_BLOCKED';
		end if;

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
			target_business_id,
			v_target_user_id,
			target_role,
			'active',
			now(),
			v_actor,
			v_actor
		)
		on conflict on constraint business_users_business_id_user_id_key
		do update set
			role = excluded.role,
			status = 'active',
			accepted_at = coalesce(business_users.accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = v_actor,
			updated_at = now()
		returning id into v_membership_id;

		if target_role = 'professional' then
			delete from professional_users pu
			where pu.business_id = target_business_id
				and (
					(pu.user_id = v_target_user_id and pu.professional_id <> target_professional_id)
					or (pu.professional_id = target_professional_id and pu.user_id <> v_target_user_id)
				);

			insert into professional_users (business_id, professional_id, user_id)
			values (target_business_id, target_professional_id, v_target_user_id)
			on conflict on constraint professional_users_business_id_professional_id_user_id_key do nothing;
		else
			delete from professional_users pu
			where pu.business_id = target_business_id
				and pu.user_id = v_target_user_id;
		end if;

		update business_user_invites
		set
			status = 'accepted',
			accepted_user_id = v_target_user_id,
			accepted_at = now(),
			updated_at = now()
		where business_id = target_business_id
			and lower(email) = v_email
			and status = 'pending';

		status := case
			when v_existing_role = target_role
				and (target_role <> 'professional' or v_existing_professional_id = target_professional_id)
				then 'already_active'
			else 'active'
		end;
		membership_id := v_membership_id;
		invite_id := null;
		user_id := v_target_user_id;
		return next;
		return;
	end if;

	select bui.id, bui.role, bui.professional_id
	into v_invite_id, v_existing_role, v_existing_professional_id
	from business_user_invites bui
	where bui.business_id = target_business_id
		and lower(bui.email) = v_email
		and bui.status = 'pending'
	for update;

	if v_invite_id is not null then
		update business_user_invites
		set
			role = target_role,
			professional_id = target_professional_id,
			invited_by = v_actor,
			updated_at = now()
		where id = v_invite_id;
	else
		insert into business_user_invites (
			business_id,
			email,
			role,
			professional_id,
			invited_by
		)
		values (
			target_business_id,
			v_email,
			target_role,
			target_professional_id,
			v_actor
		)
		returning id into v_invite_id;
	end if;

	status := case
		when v_existing_role = target_role
			and (target_role <> 'professional' or v_existing_professional_id = target_professional_id)
			then 'already_pending'
		else 'pending'
	end;
	membership_id := null;
	invite_id := v_invite_id;
	user_id := null;
	return next;
end;
$$;

create or replace function public.update_business_role_access(
	target_access_id uuid,
	target_role text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_role text;
	v_target business_users%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_target
	from business_users
	where id = target_access_id
		and coalesce(status, 'active') = 'active'
	for update;

	if not found then
		raise exception 'BUSINESS_USER_NOT_FOUND';
	end if;

	v_actor_role := public.user_business_role(v_target.business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(v_target.business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;
	if v_actor_role = 'admin' and (v_target.role in ('owner','admin') or target_role in ('owner','admin')) then
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if v_target.role = 'owner' and target_role <> 'owner'
		and public.count_active_business_owners(v_target.business_id) <= 1
	then
		raise exception 'LAST_OWNER_BLOCKED';
	end if;
	if target_role = 'professional' and not exists (
		select 1
		from professional_users pu
		where pu.business_id = v_target.business_id
			and pu.user_id = v_target.user_id
	) then
		raise exception 'PROFESSIONAL_REQUIRED';
	end if;

	update business_users
	set
		role = target_role,
		updated_by = v_actor,
		updated_at = now()
	where id = target_access_id;

	if target_role <> 'professional' then
		delete from professional_users pu
		where pu.business_id = v_target.business_id
			and pu.user_id = v_target.user_id;
	end if;

	perform public.audit_security_event(
		v_target.business_id,
		v_actor,
		'business_user.role_changed',
		'business_user',
		target_access_id,
		'success',
		null,
		jsonb_build_object('from_role', v_target.role, 'to_role', target_role)
	);
end;
$$;

create or replace function public.remove_business_role_access(target_access_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_role text;
	v_target business_users%rowtype;
	v_email text;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_target
	from business_users
	where id = target_access_id
		and coalesce(status, 'active') = 'active'
	for update;

	if not found then
		raise exception 'BUSINESS_USER_NOT_FOUND';
	end if;

	if v_target.user_id = v_actor then
		raise exception 'SELF_REMOVE_DENIED';
	end if;

	v_actor_role := public.user_business_role(v_target.business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(v_target.business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if v_actor_role = 'admin' and v_target.role in ('owner','admin') then
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if v_target.role = 'owner' and public.count_active_business_owners(v_target.business_id) <= 1 then
		raise exception 'LAST_OWNER_BLOCKED';
	end if;

	select lower(u.email)
	into v_email
	from auth.users u
	where u.id = v_target.user_id;

	delete from professional_users pu
	where pu.business_id = v_target.business_id
		and pu.user_id = v_target.user_id;

	update business_users
	set
		status = 'disabled',
		disabled_at = now(),
		disabled_reason = 'Quitado desde Roles.',
		updated_by = v_actor,
		updated_at = now()
	where id = target_access_id;

	if v_email is not null
		and not exists (
			select 1
			from business_users bu
			join auth.users au on au.id = bu.user_id
			where lower(au.email) = v_email
				and coalesce(bu.status, 'active') = 'active'
		)
		and not exists (
			select 1
			from business_user_invites bui
			where lower(bui.email) = v_email
				and bui.status = 'pending'
		)
	then
		update allowed_emails
		set
			enabled = false,
			disabled_at = now(),
			disabled_reason = 'Sin roles activos o pendientes.',
			updated_by = v_actor,
			updated_at = now()
		where lower(email) = v_email;
	end if;

	perform public.audit_security_event(
		v_target.business_id,
		v_actor,
		'business_user.removed',
		'business_user',
		target_access_id,
		'success',
		null,
		jsonb_build_object('target_role', v_target.role)
	);
end;
$$;

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
		update business_users
		set
			accepted_at = coalesce(accepted_at, now()),
			updated_at = now()
		where business_id = v_business_id
			and user_id = v_user_id;

		business_id := v_business_id;
		role := v_role;
		return next;
		return;
	end if;

	select lower(u.email)
	into v_email
	from auth.users u
	where u.id = v_user_id;

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

		update business_user_invites
		set
			status = 'accepted',
			accepted_user_id = v_user_id,
			accepted_at = now(),
			updated_at = now()
		where id = v_invite.id;

		business_id := v_invite.business_id;
		role := v_invite.role;
		return next;
		return;
	end if;

	raise exception 'DEFAULT_BUSINESS_CREATION_DISABLED';
end;
$$;

revoke execute on function public.prevent_duplicate_professional_email() from public, anon;
revoke execute on function public.user_business_role(uuid) from public, anon;
revoke execute on function public.user_has_business_access(uuid) from public, anon;
revoke execute on function public.count_active_business_owners(uuid) from public, anon;
revoke execute on function public.list_business_role_access(uuid) from public, anon;
revoke execute on function public.upsert_business_role_access(uuid, text, text, uuid) from public, anon;
revoke execute on function public.update_business_role_access(uuid, text) from public, anon;
revoke execute on function public.remove_business_role_access(uuid) from public, anon;
revoke execute on function public.ensure_user_default_business(text, text) from public, anon;

grant execute on function public.user_business_role(uuid) to authenticated;
grant execute on function public.user_has_business_access(uuid) to authenticated;
grant execute on function public.count_active_business_owners(uuid) to service_role;
grant execute on function public.list_business_role_access(uuid) to authenticated;
grant execute on function public.upsert_business_role_access(uuid, text, text, uuid) to authenticated;
grant execute on function public.update_business_role_access(uuid, text) to authenticated;
grant execute on function public.remove_business_role_access(uuid) to authenticated;
grant execute on function public.ensure_user_default_business(text, text) to authenticated;

notify pgrst, 'reload schema';
