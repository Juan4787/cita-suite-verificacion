create extension if not exists pgcrypto;

create table if not exists business_user_invites (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	email text not null,
	role text not null check (role in ('owner','admin','reception','professional','readonly')),
	professional_id uuid,
	status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
	invited_by uuid references auth.users(id),
	accepted_user_id uuid references auth.users(id),
	accepted_at timestamptz,
	cancelled_by uuid references auth.users(id),
	cancelled_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (role <> 'professional' or professional_id is not null),
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete restrict
);

alter table business_user_invites
	add column if not exists professional_id uuid,
	add column if not exists status text not null default 'pending',
	add column if not exists invited_by uuid references auth.users(id),
	add column if not exists accepted_user_id uuid references auth.users(id),
	add column if not exists accepted_at timestamptz,
	add column if not exists cancelled_by uuid references auth.users(id),
	add column if not exists cancelled_at timestamptz,
	add column if not exists updated_at timestamptz not null default now();

do $$
declare
	v_invite record;
	v_professional_id uuid;
begin
	for v_invite in
		select id, business_id, email
		from business_user_invites
		where role = 'professional'
			and professional_id is null
	loop
		insert into professionals (
			business_id,
			name,
			email,
			is_active,
			is_public
		)
		values (
			v_invite.business_id,
			coalesce(nullif(split_part(v_invite.email, '@', 1), ''), 'Profesional pendiente'),
			v_invite.email,
			true,
			false
		)
		returning id into v_professional_id;

		update business_user_invites
		set
			professional_id = v_professional_id,
			updated_at = now()
		where id = v_invite.id;
	end loop;
end $$;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'business_user_invites_professional_required_chk'
	) then
		alter table business_user_invites
			add constraint business_user_invites_professional_required_chk
			check (role <> 'professional' or professional_id is not null);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'business_user_invites_business_professional_fk'
	) then
		alter table business_user_invites
			add constraint business_user_invites_business_professional_fk
			foreign key (business_id, professional_id)
			references professionals (business_id, id)
			on delete restrict;
	end if;
end $$;

create unique index if not exists business_user_invites_pending_email_uq
	on business_user_invites (business_id, lower(email))
	where status = 'pending';

create unique index if not exists business_user_invites_pending_professional_uq
	on business_user_invites (business_id, professional_id)
	where status = 'pending'
		and professional_id is not null;

create index if not exists business_user_invites_business_status_idx
	on business_user_invites (business_id, status, created_at desc);

delete from professional_users keep_row
using professional_users duplicate_row
where keep_row.business_id = duplicate_row.business_id
	and keep_row.user_id = duplicate_row.user_id
	and (
		keep_row.created_at > duplicate_row.created_at
		or (
			keep_row.created_at = duplicate_row.created_at
			and keep_row.id > duplicate_row.id
		)
	);

delete from professional_users keep_row
using professional_users duplicate_row
where keep_row.business_id = duplicate_row.business_id
	and keep_row.professional_id = duplicate_row.professional_id
	and (
		keep_row.created_at > duplicate_row.created_at
		or (
			keep_row.created_at = duplicate_row.created_at
			and keep_row.id > duplicate_row.id
		)
	);

create unique index if not exists professional_users_business_user_uq
	on professional_users (business_id, user_id);

create unique index if not exists professional_users_business_professional_uq
	on professional_users (business_id, professional_id);

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
	if not public.user_can_manage_business(target_business_id) or not public.business_allows_operation(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if v_email = '' or position('@' in v_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;
	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
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

		insert into business_users (business_id, user_id, role)
		values (target_business_id, v_target_user_id, target_role)
		on conflict on constraint business_users_business_id_user_id_key
		do update set role = excluded.role
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

create or replace function public.cancel_business_role_invite(target_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_invite business_user_invites%rowtype;
	v_target_user_id uuid;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_invite
	from business_user_invites
	where id = target_invite_id
		and status = 'pending'
	for update;

	if not found then
		raise exception 'INVITE_NOT_FOUND';
	end if;

	if not public.user_can_manage_business(v_invite.business_id) or not public.business_allows_operation(v_invite.business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	update business_user_invites
	set
		status = 'cancelled',
		cancelled_by = v_actor,
		cancelled_at = now(),
		updated_at = now()
	where id = target_invite_id;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = lower(v_invite.email)
	limit 1;

	if not exists (
		select 1
		from business_user_invites bui
		where lower(bui.email) = lower(v_invite.email)
			and bui.status = 'pending'
	)
	and not exists (
		select 1
		from business_users bu
		where bu.user_id = v_target_user_id
	) then
		update allowed_emails
		set
			enabled = false,
			disabled_at = now(),
			disabled_reason = 'Sin roles activos o pendientes.',
			updated_by = v_actor,
			updated_at = now()
		where lower(email) = lower(v_invite.email);
	end if;
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
	order by bu.created_at asc
	limit 1;

	if v_business_id is not null then
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
		insert into business_users (business_id, user_id, role)
		values (v_invite.business_id, v_user_id, v_invite.role)
		on conflict on constraint business_users_business_id_user_id_key
		do update set role = excluded.role;

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

revoke execute on function public.list_business_role_access(uuid) from public, anon;
revoke execute on function public.upsert_business_role_access(uuid, text, text, uuid) from public, anon;
revoke execute on function public.cancel_business_role_invite(uuid) from public, anon;
revoke execute on function public.ensure_user_default_business(text, text) from public, anon;

grant execute on function public.list_business_role_access(uuid) to authenticated;
grant execute on function public.upsert_business_role_access(uuid, text, text, uuid) to authenticated;
grant execute on function public.cancel_business_role_invite(uuid) to authenticated;
grant execute on function public.ensure_user_default_business(text, text) to authenticated;

alter table business_user_invites enable row level security;

drop policy if exists business_user_invites_no_direct_read on business_user_invites;
create policy business_user_invites_no_direct_read
	on business_user_invites
	for select
	to authenticated
	using (false);

notify pgrst, 'reload schema';
