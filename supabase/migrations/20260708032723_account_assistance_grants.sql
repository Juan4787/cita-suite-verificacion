create table if not exists public.account_assistance_support_users (
	user_id uuid primary key references auth.users(id) on delete cascade,
	email text not null unique,
	enabled boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.account_assistance_grants (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses(id) on delete cascade,
	requested_by_user_id uuid not null references auth.users(id) on delete restrict,
	support_user_id uuid not null references auth.users(id) on delete restrict,
	status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
	starts_at timestamptz not null default now(),
	expires_at timestamptz not null,
	revoked_at timestamptz,
	revoked_by_user_id uuid references auth.users(id) on delete set null,
	dismissed_at timestamptz,
	dismissed_by_user_id uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (expires_at > starts_at),
	check (
		(status = 'revoked' and revoked_at is not null)
		or (status <> 'revoked' and revoked_at is null)
	)
);

create unique index if not exists account_assistance_grants_one_active_idx
	on public.account_assistance_grants (business_id)
	where status = 'active' and revoked_at is null;

create index if not exists account_assistance_grants_support_active_idx
	on public.account_assistance_grants (support_user_id, status, expires_at desc)
	where revoked_at is null;

create index if not exists account_assistance_grants_business_created_idx
	on public.account_assistance_grants (business_id, created_at desc);

drop trigger if exists trg_account_assistance_support_users_updated_at on public.account_assistance_support_users;
create trigger trg_account_assistance_support_users_updated_at
	before update on public.account_assistance_support_users
	for each row
	execute function public.touch_updated_at();

drop trigger if exists trg_account_assistance_grants_updated_at on public.account_assistance_grants;
create trigger trg_account_assistance_grants_updated_at
	before update on public.account_assistance_grants
	for each row
	execute function public.touch_updated_at();

alter table public.account_assistance_support_users enable row level security;
alter table public.account_assistance_grants enable row level security;

revoke all on table public.account_assistance_support_users from anon, authenticated;
revoke all on table public.account_assistance_grants from anon, authenticated;
grant all on table public.account_assistance_support_users to service_role;
grant select on table public.account_assistance_grants to authenticated;
grant all on table public.account_assistance_grants to service_role;

drop policy if exists account_assistance_grants_visible on public.account_assistance_grants;
create policy account_assistance_grants_visible
	on public.account_assistance_grants
	for select
	to authenticated
	using (
		support_user_id = (select auth.uid())
		or exists (
			select 1
			from public.business_users bu
			where bu.business_id = account_assistance_grants.business_id
				and bu.user_id = (select auth.uid())
				and coalesce(bu.status, 'active') = 'active'
				and bu.accepted_at is not null
				and bu.role in ('owner', 'admin')
		)
	);

create or replace function public.user_has_active_account_assistance(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
	select exists (
		select 1
		from public.account_assistance_grants aag
		join public.account_assistance_support_users aasu
			on aasu.user_id = aag.support_user_id
			and aasu.enabled = true
		where aag.business_id = target_business_id
			and aag.support_user_id = auth.uid()
			and aag.status = 'active'
			and aag.revoked_at is null
			and aag.expires_at > now()
			and public.business_allows_operation(target_business_id)
	);
$$;

create or replace function public.user_has_business_access(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = auth.uid()
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
	)
	or public.user_has_active_account_assistance(target_business_id);
$$;

create or replace function public.user_business_role(target_business_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
	select role
	from (
		select bu.role::text as role
		from public.business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = auth.uid()
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
		union all
		select 'admin'::text as role
		where public.user_has_active_account_assistance(target_business_id)
	) roles
	order by
		case role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end
	limit 1;
$$;

create or replace function public.user_can_manage_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner', 'admin');
$$;

create or replace function public.user_can_operate_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner', 'admin', 'reception')
		and public.business_allows_operation(target_business_id);
$$;

create or replace function public.activate_account_assistance(
	target_business_id uuid,
	target_support_user_id uuid
)
returns table(
	id uuid,
	business_id uuid,
	requested_by_user_id uuid,
	support_user_id uuid,
	status text,
	starts_at timestamptz,
	expires_at timestamptz,
	revoked_at timestamptz,
	dismissed_at timestamptz,
	created_at timestamptz,
	updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_now timestamptz := now();
	v_grant public.account_assistance_grants%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if not exists (
		select 1
		from public.business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = v_actor
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
			and bu.role = 'owner'
	) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;

	if not public.business_allows_operation(target_business_id) then
		raise exception 'ACCOUNT_ASSISTANCE_BUSINESS_NOT_AVAILABLE';
	end if;

	perform 1
	from public.businesses business_lock
	where business_lock.id = target_business_id
	for update;

	if not exists (
		select 1
		from public.account_assistance_support_users support
		where support.user_id = target_support_user_id
			and support.enabled = true
	) then
		raise exception 'ACCOUNT_ASSISTANCE_SUPPORT_USER_NOT_ENABLED';
	end if;

	update public.account_assistance_grants existing
	set
		status = 'expired',
		updated_at = v_now
	where existing.business_id = target_business_id
		and existing.status = 'active'
		and existing.revoked_at is null
		and existing.expires_at <= v_now;

	select *
	into v_grant
	from public.account_assistance_grants existing
	where existing.business_id = target_business_id
		and existing.status = 'active'
		and existing.revoked_at is null
		and existing.expires_at > v_now
	for update;

	if not found then
		insert into public.account_assistance_grants (
			business_id,
			requested_by_user_id,
			support_user_id,
			status,
			starts_at,
			expires_at
		)
		values (
			target_business_id,
			v_actor,
			target_support_user_id,
			'active',
			v_now,
			v_now + interval '60 minutes'
		)
		returning * into v_grant;

		insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
		values (
			target_business_id,
			v_actor,
			'account_assistance.activated',
			'account_assistance_grant',
			v_grant.id,
			jsonb_build_object(
				'support_user_id', target_support_user_id,
				'expires_at', v_grant.expires_at
			)
		);
	end if;

	id := v_grant.id;
	business_id := v_grant.business_id;
	requested_by_user_id := v_grant.requested_by_user_id;
	support_user_id := v_grant.support_user_id;
	status := v_grant.status;
	starts_at := v_grant.starts_at;
	expires_at := v_grant.expires_at;
	revoked_at := v_grant.revoked_at;
	dismissed_at := v_grant.dismissed_at;
	created_at := v_grant.created_at;
	updated_at := v_grant.updated_at;
	return next;
end;
$$;

create or replace function public.revoke_account_assistance(target_business_id uuid)
returns table(
	id uuid,
	business_id uuid,
	requested_by_user_id uuid,
	support_user_id uuid,
	status text,
	starts_at timestamptz,
	expires_at timestamptz,
	revoked_at timestamptz,
	dismissed_at timestamptz,
	created_at timestamptz,
	updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_now timestamptz := now();
	v_grant public.account_assistance_grants%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if not exists (
		select 1
		from public.business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = v_actor
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
			and bu.role = 'owner'
	) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;

	perform 1
	from public.businesses business_lock
	where business_lock.id = target_business_id
	for update;

	select *
	into v_grant
	from public.account_assistance_grants existing
	where existing.business_id = target_business_id
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
		dismissed_at = null,
		dismissed_by_user_id = null,
		updated_at = v_now
	where account_assistance_grants.id = v_grant.id
	returning * into v_grant;

	insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id,
		v_actor,
		'account_assistance.revoked',
		'account_assistance_grant',
		v_grant.id,
		jsonb_build_object('support_user_id', v_grant.support_user_id)
	);

	id := v_grant.id;
	business_id := v_grant.business_id;
	requested_by_user_id := v_grant.requested_by_user_id;
	support_user_id := v_grant.support_user_id;
	status := v_grant.status;
	starts_at := v_grant.starts_at;
	expires_at := v_grant.expires_at;
	revoked_at := v_grant.revoked_at;
	dismissed_at := v_grant.dismissed_at;
	created_at := v_grant.created_at;
	updated_at := v_grant.updated_at;
	return next;
end;
$$;

create or replace function public.dismiss_account_assistance_notice(
	target_business_id uuid,
	target_grant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_now timestamptz := now();
	v_grant public.account_assistance_grants%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if not exists (
		select 1
		from public.business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = v_actor
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
			and bu.role = 'owner'
	) then
		raise exception 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED';
	end if;

	select *
	into v_grant
	from public.account_assistance_grants existing
	where existing.id = target_grant_id
		and existing.business_id = target_business_id
	for update;

	if not found then
		raise exception 'ACCOUNT_ASSISTANCE_NOT_FOUND';
	end if;

	if v_grant.status = 'active' and v_grant.revoked_at is null and v_grant.expires_at <= v_now then
		update public.account_assistance_grants
		set
			status = 'expired',
			updated_at = v_now
		where account_assistance_grants.id = v_grant.id
		returning * into v_grant;
	end if;

	if v_grant.status = 'active' and v_grant.revoked_at is null and v_grant.expires_at > v_now then
		raise exception 'ACCOUNT_ASSISTANCE_STILL_ACTIVE';
	end if;

	update public.account_assistance_grants
	set
		dismissed_at = v_now,
		dismissed_by_user_id = v_actor,
		updated_at = v_now
	where account_assistance_grants.id = v_grant.id;
end;
$$;

revoke execute on function public.user_has_active_account_assistance(uuid) from public, anon;
revoke execute on function public.activate_account_assistance(uuid, uuid) from public, anon;
revoke execute on function public.revoke_account_assistance(uuid) from public, anon;
revoke execute on function public.dismiss_account_assistance_notice(uuid, uuid) from public, anon;

grant execute on function public.user_has_active_account_assistance(uuid) to authenticated;
grant execute on function public.activate_account_assistance(uuid, uuid) to authenticated;
grant execute on function public.revoke_account_assistance(uuid) to authenticated;
grant execute on function public.dismiss_account_assistance_notice(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
