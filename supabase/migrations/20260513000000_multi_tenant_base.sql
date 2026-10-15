create extension if not exists pgcrypto;

create table if not exists businesses (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	slug text unique not null,
	industry text not null check (
		industry in ('odontology','aesthetics','kinesiology','nutrition','therapy','other')
	),
	phone text,
	email text,
	address text,
	logo_url text,
	timezone text not null default 'America/Argentina/Cordoba',
	public_booking_enabled boolean not null default true,
	whatsapp_enabled boolean not null default false,
	allow_same_day_booking boolean not null default false,
	min_booking_notice_minutes int not null default 1440,
	max_booking_days_ahead int not null default 60,
	cancellation_policy text,
	is_active boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists business_users (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('owner','admin','reception','professional','readonly')),
	created_at timestamptz not null default now(),
	unique (business_id, user_id)
);

create index if not exists business_users_user_id_idx
	on business_users (user_id);

create index if not exists business_users_business_role_idx
	on business_users (business_id, role);

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
	);
$$;

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

create or replace function public.user_can_manage_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner','admin');
$$;

create or replace function public.user_can_operate_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner','admin','reception');
$$;

create or replace function public.slugify_business_slug(value text)
returns text
language sql
immutable
set search_path = public
as $$
	select trim(both '-' from lower(regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]+', '-', 'g')));
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
	v_name text;
	v_base_slug text;
	v_slug text;
begin
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

	select u.email
	into v_email
	from auth.users u
	where u.id = v_user_id;

	v_name := nullif(trim(coalesce(p_name, '')), '');
	if v_name is null then
		v_name := 'Consultorio';
	end if;

	v_base_slug := public.slugify_business_slug(coalesce(split_part(v_email, '@', 1), v_name));
	if v_base_slug is null or v_base_slug = '' then
		v_base_slug := 'consultorio';
	end if;
	v_slug := v_base_slug || '-' || replace(left(v_user_id::text, 8), '-', '');

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

	insert into business_users (business_id, user_id, role)
	values (v_business_id, v_user_id, 'owner');

	business_id := v_business_id;
	role := 'owner';
	return next;
end;
$$;

create or replace function public.list_business_users(target_business_id uuid)
returns table(
	id uuid,
	business_id uuid,
	user_id uuid,
	email text,
	role text,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
	if not public.user_has_business_access(target_business_id) then
		raise exception 'BUSINESS_ACCESS_DENIED';
	end if;

	return query
	select
		bu.id,
		bu.business_id,
		bu.user_id,
		au.email::text,
		bu.role,
		bu.created_at
	from business_users bu
	left join auth.users au on au.id = bu.user_id
	where bu.business_id = target_business_id
	order by
		case bu.role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end,
		au.email nulls last;
end;
$$;

create or replace function public.add_business_user_by_email(
	target_business_id uuid,
	target_email text,
	target_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_target_user_id uuid;
	v_membership_id uuid;
begin
	if not public.user_can_manage_business(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = lower(trim(target_email))
	limit 1;

	if v_target_user_id is null then
		raise exception 'USER_NOT_FOUND';
	end if;

	insert into business_users (business_id, user_id, role)
	values (target_business_id, v_target_user_id, target_role)
	on conflict (business_id, user_id)
	do update set role = excluded.role
	returning id into v_membership_id;

	return v_membership_id;
end;
$$;

grant execute on function public.user_has_business_access(uuid) to authenticated;
grant execute on function public.user_business_role(uuid) to authenticated;
grant execute on function public.user_can_manage_business(uuid) to authenticated;
grant execute on function public.user_can_operate_business(uuid) to authenticated;
grant execute on function public.ensure_user_default_business(text, text) to authenticated;
grant execute on function public.list_business_users(uuid) to authenticated;
grant execute on function public.add_business_user_by_email(uuid, text, text) to authenticated;

alter table businesses enable row level security;
alter table business_users enable row level security;

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'businesses'
			and policyname = 'business members can read businesses'
	) then
		create policy "business members can read businesses"
			on businesses
			for select
			to authenticated
			using (
				auth.uid() is not null
				and public.user_has_business_access(id)
			);
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'businesses'
			and policyname = 'business admins can update businesses'
	) then
		create policy "business admins can update businesses"
			on businesses
			for update
			to authenticated
			using (public.user_can_manage_business(id))
			with check (public.user_can_manage_business(id));
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'business_users'
			and policyname = 'business members can read memberships'
	) then
		create policy "business members can read memberships"
			on business_users
			for select
			to authenticated
			using (public.user_has_business_access(business_id));
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'business_users'
			and policyname = 'business admins can insert memberships'
	) then
		create policy "business admins can insert memberships"
			on business_users
			for insert
			to authenticated
			with check (public.user_can_manage_business(business_id));
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'business_users'
			and policyname = 'business admins can update memberships'
	) then
		create policy "business admins can update memberships"
			on business_users
			for update
			to authenticated
			using (public.user_can_manage_business(business_id))
			with check (public.user_can_manage_business(business_id));
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'business_users'
			and policyname = 'business admins can delete memberships'
	) then
		create policy "business admins can delete memberships"
			on business_users
			for delete
			to authenticated
			using (public.user_can_manage_business(business_id));
	end if;
end $$;

alter table if exists patients
	add column if not exists business_id uuid references businesses(id) on delete cascade;

alter table if exists clinical_entries
	add column if not exists business_id uuid references businesses(id) on delete cascade;

alter table if exists patient_radiographs
	add column if not exists business_id uuid references businesses(id) on delete cascade;

create index if not exists patients_business_archived_updated_idx
	on patients (business_id, archived_at, updated_at desc);

create unique index if not exists patients_business_dni_uq
	on patients (business_id, dni)
	where dni is not null and business_id is not null;

create index if not exists clinical_entries_business_patient_created_idx
	on clinical_entries (business_id, patient_id, created_at desc);

create index if not exists patient_radiographs_business_patient_created_idx
	on patient_radiographs (business_id, patient_id, created_at desc);

do $$
declare
	r record;
	v_email text;
	v_name text;
	v_base_slug text;
	v_slug text;
	v_counter int;
	v_business_id uuid;
begin
	for r in
		select distinct p.owner_id as user_id
		from patients p
		where p.owner_id is not null
			and not exists (
				select 1
				from business_users bu
				where bu.user_id = p.owner_id
			)
	loop
		select u.email into v_email
		from auth.users u
		where u.id = r.user_id;

		v_name := 'Consultorio';
		v_base_slug := public.slugify_business_slug(
			coalesce(nullif(split_part(v_email, '@', 1), ''), 'consultorio')
		);
		if v_base_slug is null or v_base_slug = '' then
			v_base_slug := 'consultorio';
		end if;

		v_slug := v_base_slug || '-' || replace(left(r.user_id::text, 8), '-', '');
		v_counter := 1;
		while exists (select 1 from businesses b where b.slug = v_slug) loop
			v_counter := v_counter + 1;
			v_slug := v_base_slug || '-' || replace(left(r.user_id::text, 8), '-', '') || '-' || v_counter::text;
		end loop;

		insert into businesses (name, slug, industry, email)
		values (v_name, v_slug, 'odontology', v_email)
		returning id into v_business_id;

		insert into business_users (business_id, user_id, role)
		values (v_business_id, r.user_id, 'owner')
		on conflict (business_id, user_id) do nothing;
	end loop;
end $$;

update patients p
set business_id = bu.business_id
from business_users bu
where p.business_id is null
	and p.owner_id = bu.user_id;

update clinical_entries ce
set business_id = p.business_id
from patients p
where ce.business_id is null
	and ce.patient_id = p.id
	and p.business_id is not null;

update patient_radiographs pr
set business_id = p.business_id
from patients p
where pr.business_id is null
	and pr.patient_id = p.id
	and p.business_id is not null;

create or replace function public.patients_counts_by_business(p_business uuid)
returns table(total_count bigint, active_count bigint, archived_count bigint)
language sql
security invoker
set search_path = public
as $$
	select
		count(*)::bigint as total_count,
		count(*) filter (where archived_at is null)::bigint as active_count,
		count(*) filter (where archived_at is not null)::bigint as archived_count
	from patients
	where business_id = p_business;
$$;

grant execute on function public.patients_counts_by_business(uuid) to authenticated;

do $$
begin
	if to_regclass('public.patients') is not null then
		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patients'
				and policyname = 'patients_business_member_select'
		) then
			create policy patients_business_member_select
				on patients
				for select
				to authenticated
				using (
					business_id is not null
					and public.user_has_business_access(business_id)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patients'
				and policyname = 'patients_business_operator_insert'
		) then
			create policy patients_business_operator_insert
				on patients
				for insert
				to authenticated
				with check (
					business_id is not null
					and public.user_can_operate_business(business_id)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patients'
				and policyname = 'patients_business_operator_update'
		) then
			create policy patients_business_operator_update
				on patients
				for update
				to authenticated
				using (
					business_id is not null
					and public.user_can_operate_business(business_id)
				)
				with check (
					business_id is not null
					and public.user_can_operate_business(business_id)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patients'
				and policyname = 'patients_business_admin_delete'
		) then
			create policy patients_business_admin_delete
				on patients
				for delete
				to authenticated
				using (
					business_id is not null
					and public.user_can_manage_business(business_id)
				);
		end if;
	end if;

	if to_regclass('public.clinical_entries') is not null then
		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'clinical_entries'
				and policyname = 'clinical_entries_business_member_select'
		) then
			create policy clinical_entries_business_member_select
				on clinical_entries
				for select
				to authenticated
				using (
					business_id is not null
					and public.user_has_business_access(business_id)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'clinical_entries'
				and policyname = 'clinical_entries_business_operator_insert'
		) then
			create policy clinical_entries_business_operator_insert
				on clinical_entries
				for insert
				to authenticated
				with check (
					business_id is not null
					and public.user_can_operate_business(business_id)
					and exists (
						select 1
						from patients p
						where p.id = clinical_entries.patient_id
							and p.business_id = clinical_entries.business_id
					)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'clinical_entries'
				and policyname = 'clinical_entries_business_operator_update'
		) then
			create policy clinical_entries_business_operator_update
				on clinical_entries
				for update
				to authenticated
				using (
					business_id is not null
					and public.user_can_operate_business(business_id)
				)
				with check (
					business_id is not null
					and public.user_can_operate_business(business_id)
					and exists (
						select 1
						from patients p
						where p.id = clinical_entries.patient_id
							and p.business_id = clinical_entries.business_id
					)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'clinical_entries'
				and policyname = 'clinical_entries_business_operator_delete'
		) then
			create policy clinical_entries_business_operator_delete
				on clinical_entries
				for delete
				to authenticated
				using (
					business_id is not null
					and public.user_can_operate_business(business_id)
				);
		end if;
	end if;

	if to_regclass('public.patient_radiographs') is not null then
		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patient_radiographs'
				and policyname = 'patient_radiographs_business_member_select'
		) then
			create policy patient_radiographs_business_member_select
				on patient_radiographs
				for select
				to authenticated
				using (
					business_id is not null
					and public.user_has_business_access(business_id)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patient_radiographs'
				and policyname = 'patient_radiographs_business_operator_insert'
		) then
			create policy patient_radiographs_business_operator_insert
				on patient_radiographs
				for insert
				to authenticated
				with check (
					business_id is not null
					and public.user_can_operate_business(business_id)
					and exists (
						select 1
						from patients p
						where p.id = patient_radiographs.patient_id
							and p.business_id = patient_radiographs.business_id
					)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patient_radiographs'
				and policyname = 'patient_radiographs_business_operator_update'
		) then
			create policy patient_radiographs_business_operator_update
				on patient_radiographs
				for update
				to authenticated
				using (
					business_id is not null
					and public.user_can_operate_business(business_id)
				)
				with check (
					business_id is not null
					and public.user_can_operate_business(business_id)
					and exists (
						select 1
						from patients p
						where p.id = patient_radiographs.patient_id
							and p.business_id = patient_radiographs.business_id
					)
				);
		end if;

		if not exists (
			select 1 from pg_policies
			where schemaname = 'public' and tablename = 'patient_radiographs'
				and policyname = 'patient_radiographs_business_operator_delete'
		) then
			create policy patient_radiographs_business_operator_delete
				on patient_radiographs
				for delete
				to authenticated
				using (
					business_id is not null
					and public.user_can_operate_business(business_id)
				);
		end if;
	end if;
end $$;

drop policy if exists patients_owner_select on patients;
drop policy if exists patients_owner_insert on patients;
drop policy if exists patients_owner_update on patients;
drop policy if exists patients_owner_delete on patients;

drop policy if exists clinical_entries_owner_select on clinical_entries;
drop policy if exists clinical_entries_owner_insert on clinical_entries;
drop policy if exists clinical_entries_owner_update on clinical_entries;
drop policy if exists clinical_entries_owner_delete on clinical_entries;

drop policy if exists patient_radiographs_owner_select on patient_radiographs;
drop policy if exists patient_radiographs_owner_insert on patient_radiographs;
drop policy if exists patient_radiographs_owner_update on patient_radiographs;
drop policy if exists patient_radiographs_owner_delete on patient_radiographs;
