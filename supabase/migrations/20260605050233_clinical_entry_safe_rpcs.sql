create extension if not exists pgcrypto;

alter table clinical_entries
	add column if not exists business_id uuid references businesses(id) on delete cascade,
	add column if not exists created_by_professional_id uuid,
	add column if not exists created_by_user_id uuid references auth.users(id),
	add column if not exists updated_by_user_id uuid references auth.users(id),
	add column if not exists locked_after timestamptz;

update clinical_entries ce
set
	business_id = coalesce(ce.business_id, p.business_id),
	created_by_user_id = case
		when ce.created_by_user_id is not null
			and exists (select 1 from auth.users u where u.id = ce.created_by_user_id)
			then ce.created_by_user_id
		when ce.owner_id is not null
			and exists (select 1 from auth.users u where u.id = ce.owner_id)
			then ce.owner_id
		else null
	end,
	locked_after = coalesce(ce.locked_after, coalesce(ce.created_at, now()) + interval '24 hours')
from patients p
where ce.patient_id = p.id
	and (
		ce.business_id is null
		or ce.created_by_user_id is null
		or ce.locked_after is null
	);

create table if not exists clinical_entry_costs (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	clinical_entry_id uuid not null references clinical_entries(id) on delete cascade,
	amount numeric,
	created_by uuid references auth.users(id),
	updated_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, clinical_entry_id)
);

create index if not exists clinical_entry_costs_business_entry_idx
	on clinical_entry_costs (business_id, clinical_entry_id);

create table if not exists professional_patient_links (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	professional_id uuid not null references professionals(id) on delete cascade,
	patient_id uuid not null references patients(id) on delete cascade,
	source text not null default 'manual' check (source in ('appointment','public_booking','clinical_entry','manual','import')),
	source_entity_id uuid,
	is_active boolean not null default true,
	created_by uuid references auth.users(id),
	disabled_by uuid references auth.users(id),
	disabled_at timestamptz,
	disabled_reason text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index if not exists professional_patient_links_active_uq
	on professional_patient_links (business_id, professional_id, patient_id)
	where is_active = true;

create index if not exists professional_patient_links_patient_idx
	on professional_patient_links (business_id, patient_id, is_active);

create index if not exists professional_patient_links_professional_idx
	on professional_patient_links (business_id, professional_id, is_active);

create or replace function public.current_user_professional_id(target_business_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
	select pu.professional_id
	from professional_users pu
	where pu.business_id = target_business_id
		and pu.user_id = auth.uid()
	order by pu.created_at asc
	limit 1;
$$;

create or replace function public.user_has_active_professional_patient_link(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
		select 1
		from professional_patient_links ppl
		join professional_users pu
			on pu.business_id = ppl.business_id
			and pu.professional_id = ppl.professional_id
		where ppl.business_id = target_business_id
			and ppl.patient_id = target_patient_id
			and ppl.is_active = true
			and pu.user_id = auth.uid()
	);
$$;

create or replace function public.user_can_view_costs(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.business_allows_operation(target_business_id)
		and public.user_business_role(target_business_id) in ('owner','admin');
$$;

create or replace function public.business_allows_owner_restricted_read(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce((
		select
			bs.archived_at is null
			and bs.commercial_access_enabled = true
			and (
				bs.is_permanent = true
				or (bs.paid_until is not null and now() <= bs.paid_until)
				or (bs.grace_until is not null and now() <= bs.grace_until)
				or (bs.restricted_until is not null and now() <= bs.restricted_until)
				or bs.subscription_status = 'restricted'
			)
		from business_subscriptions bs
		where bs.business_id = target_business_id
	), public.business_allows_operation(target_business_id));
$$;

create or replace function public.user_can_read_basic_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
			select 1
			from patients p
			where p.business_id = target_business_id
				and p.id = target_patient_id
		)
		and case
			when public.user_business_role(target_business_id) in ('owner','admin')
				then public.business_allows_owner_restricted_read(target_business_id)
			when public.user_business_role(target_business_id) in ('reception','readonly')
				then public.business_allows_operation(target_business_id)
			when public.user_business_role(target_business_id) = 'professional'
				then public.business_allows_operation(target_business_id)
					and public.user_has_active_professional_patient_link(target_business_id, target_patient_id)
			else false
		end;
$$;

create or replace function public.user_can_read_clinical_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
			select 1
			from patients p
			where p.business_id = target_business_id
				and p.id = target_patient_id
		)
		and public.business_allows_operation(target_business_id)
		and (
			public.user_business_role(target_business_id) in ('owner','admin')
			or (
				public.user_business_role(target_business_id) = 'professional'
				and public.user_has_active_professional_patient_link(target_business_id, target_patient_id)
			)
		);
$$;

create or replace function public.user_can_read_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_can_read_basic_patient(target_business_id, target_patient_id);
$$;

create or replace function public.user_can_read_radiology_reference(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_can_read_clinical_patient(target_business_id, target_patient_id);
$$;

create table if not exists patient_clinical_profiles (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	patient_id uuid not null references patients(id) on delete cascade,
	allergies text,
	medication text,
	background text,
	clinical_alert_note text,
	notes text,
	custom_fields jsonb,
	created_by uuid references auth.users(id),
	updated_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, patient_id)
);

create index if not exists patient_clinical_profiles_patient_idx
	on patient_clinical_profiles (business_id, patient_id);

insert into patient_clinical_profiles (
	business_id,
	patient_id,
	allergies,
	medication,
	background,
	notes,
	custom_fields,
	created_at,
	updated_at
)
select
	p.business_id,
	p.id,
	nullif(p.allergies, ''),
	nullif(p.medication, ''),
	nullif(p.background, ''),
	null,
	p.custom_fields,
	coalesce(p.created_at, now()),
	coalesce(p.updated_at, now())
from patients p
where p.business_id is not null
	and (
		nullif(p.allergies, '') is not null
		or nullif(p.medication, '') is not null
		or nullif(p.background, '') is not null
		or p.custom_fields is not null
	)
on conflict (business_id, patient_id) do update
set
	allergies = coalesce(patient_clinical_profiles.allergies, excluded.allergies),
	medication = coalesce(patient_clinical_profiles.medication, excluded.medication),
	background = coalesce(patient_clinical_profiles.background, excluded.background),
	notes = coalesce(patient_clinical_profiles.notes, excluded.notes),
	custom_fields = coalesce(patient_clinical_profiles.custom_fields, excluded.custom_fields),
	updated_at = now();

alter table patient_clinical_profiles enable row level security;

drop policy if exists patient_clinical_profiles_select on patient_clinical_profiles;
create policy patient_clinical_profiles_select
	on patient_clinical_profiles
	for select
	to authenticated
	using (public.user_can_read_clinical_patient(business_id, patient_id));

revoke all on table patient_clinical_profiles from anon, authenticated;
grant select on table patient_clinical_profiles to authenticated;

create or replace function public.upsert_patient_clinical_profile_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_allergies text default null,
	p_medication text default null,
	p_background text default null,
	p_clinical_alert_note text default null,
	p_notes text default null,
	p_custom_fields jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_profile_id uuid;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'CLINICAL_PROFILE_DENIED';
	end if;
	if not exists (
		select 1
		from patients p
		where p.business_id = p_business_id
			and p.id = p_patient_id
	) then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	insert into patient_clinical_profiles (
		business_id,
		patient_id,
		allergies,
		medication,
		background,
		clinical_alert_note,
		notes,
		custom_fields,
		created_by,
		updated_by
	)
	values (
		p_business_id,
		p_patient_id,
		nullif(trim(coalesce(p_allergies, '')), ''),
		nullif(trim(coalesce(p_medication, '')), ''),
		nullif(trim(coalesce(p_background, '')), ''),
		nullif(trim(coalesce(p_clinical_alert_note, '')), ''),
		nullif(trim(coalesce(p_notes, '')), ''),
		p_custom_fields,
		auth.uid(),
		auth.uid()
	)
	on conflict (business_id, patient_id) do update
	set
		allergies = excluded.allergies,
		medication = excluded.medication,
		background = excluded.background,
		clinical_alert_note = excluded.clinical_alert_note,
		notes = excluded.notes,
		custom_fields = excluded.custom_fields,
		updated_by = auth.uid(),
		updated_at = now()
	returning id into v_profile_id;

	return v_profile_id;
end;
$$;

create or replace function public.set_patient_archive_state_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'PATIENT_ARCHIVE_DENIED';
	end if;

	update patients
	set
		archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
		updated_at = now()
	where business_id = p_business_id
		and id = p_patient_id;

	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
end;
$$;

create or replace function public.set_patient_drive_folder_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_drive_folder_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'PATIENT_DRIVE_FOLDER_DENIED';
	end if;

	update patients
	set
		drive_folder_id = nullif(trim(coalesce(p_drive_folder_id, '')), ''),
		updated_at = now()
	where business_id = p_business_id
		and id = p_patient_id;

	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
end;
$$;

create or replace function public.get_patient_drive_folder_safely(
	p_business_id uuid,
	p_patient_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
	v_drive_folder_id text;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'PATIENT_DRIVE_FOLDER_DENIED';
	end if;

	select p.drive_folder_id
	into v_drive_folder_id
	from patients p
	where p.business_id = p_business_id
		and p.id = p_patient_id;

	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	return v_drive_folder_id;
end;
$$;

create or replace function public.clear_patient_drive_folders_safely(
	p_business_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'PATIENT_DRIVE_FOLDER_DENIED';
	end if;

	update patients
	set
		drive_folder_id = null,
		updated_at = now()
	where business_id = p_business_id;
end;
$$;

create or replace function public.create_clinical_entry_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_entry_type text,
	p_description text,
	p_created_at timestamptz default null,
	p_teeth text default null,
	p_internal_note text default null,
	p_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_professional_id uuid;
	v_created_at timestamptz;
	v_entry_id uuid;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if p_business_id is null or p_patient_id is null then
		raise exception 'INVALID_PATIENT';
	end if;
	if nullif(trim(coalesce(p_entry_type, '')), '') is null then
		raise exception 'ENTRY_TYPE_REQUIRED';
	end if;
	if nullif(trim(coalesce(p_description, '')), '') is null then
		raise exception 'DESCRIPTION_REQUIRED';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;
	if not exists (
		select 1
		from patients p
		where p.business_id = p_business_id
			and p.id = p_patient_id
	) then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	v_role := public.user_business_role(p_business_id);
	if v_role in ('owner','admin') then
		v_professional_id := null;
		v_created_at := coalesce(p_created_at, now());
		if v_created_at > now() + interval '5 minutes' then
			raise exception 'INVALID_CLINICAL_ENTRY_DATE';
		end if;
	elsif v_role = 'professional' then
		v_professional_id := public.current_user_professional_id(p_business_id);
		if v_professional_id is null then
			raise exception 'PROFESSIONAL_LINK_REQUIRED';
		end if;
		if not exists (
			select 1
			from professional_patient_links ppl
			where ppl.business_id = p_business_id
				and ppl.professional_id = v_professional_id
				and ppl.patient_id = p_patient_id
				and ppl.is_active = true
		) then
			raise exception 'PATIENT_ACCESS_DENIED';
		end if;
		v_created_at := now();
	else
		raise exception 'CLINICAL_ENTRY_DENIED';
	end if;

	if p_amount is not null and not public.user_can_view_costs(p_business_id) then
		raise exception 'CLINICAL_COST_DENIED';
	end if;

	insert into clinical_entries (
		owner_id,
		business_id,
		patient_id,
		created_at,
		entry_type,
		description,
		teeth,
		internal_note,
		created_by_user_id,
		created_by_professional_id,
		locked_after
	)
	values (
		v_actor,
		p_business_id,
		p_patient_id,
		v_created_at,
		nullif(trim(p_entry_type), ''),
		nullif(trim(p_description), ''),
		nullif(trim(coalesce(p_teeth, '')), ''),
		nullif(trim(coalesce(p_internal_note, '')), ''),
		v_actor,
		v_professional_id,
		v_created_at + interval '24 hours'
	)
	returning id into v_entry_id;

	if p_amount is not null then
		insert into clinical_entry_costs (
			business_id,
			clinical_entry_id,
			amount,
			created_by,
			updated_by
		)
		values (
			p_business_id,
			v_entry_id,
			p_amount,
			v_actor,
			v_actor
		)
		on conflict (business_id, clinical_entry_id) do update
		set
			amount = excluded.amount,
			updated_by = v_actor,
			updated_at = now();
	end if;

	update patients
	set
		last_entry_at = greatest(coalesce(last_entry_at, v_created_at), v_created_at),
		updated_at = now()
	where business_id = p_business_id
		and id = p_patient_id;

	return v_entry_id;
end;
$$;

create or replace function public.update_clinical_entry_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_entry_id uuid,
	p_entry_type text,
	p_description text,
	p_teeth text default null,
	p_internal_note text default null,
	p_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_entry clinical_entries%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if p_business_id is null or p_patient_id is null or p_entry_id is null then
		raise exception 'INVALID_CLINICAL_ENTRY';
	end if;
	if nullif(trim(coalesce(p_entry_type, '')), '') is null then
		raise exception 'ENTRY_TYPE_REQUIRED';
	end if;
	if nullif(trim(coalesce(p_description, '')), '') is null then
		raise exception 'DESCRIPTION_REQUIRED';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	select *
	into v_entry
	from clinical_entries ce
	where ce.business_id = p_business_id
		and ce.patient_id = p_patient_id
		and ce.id = p_entry_id
	for update;

	if not found then
		raise exception 'CLINICAL_ENTRY_NOT_FOUND';
	end if;

	v_role := public.user_business_role(p_business_id);
	if v_role in ('owner','admin') then
		null;
	elsif v_role = 'professional' then
		if v_entry.created_by_user_id is distinct from v_actor then
			raise exception 'CLINICAL_ENTRY_EDIT_DENIED';
		end if;
		if now() > coalesce(v_entry.locked_after, v_entry.created_at + interval '24 hours') then
			raise exception 'CLINICAL_ENTRY_LOCKED';
		end if;
		if not public.user_has_active_professional_patient_link(p_business_id, p_patient_id) then
			raise exception 'PATIENT_ACCESS_DENIED';
		end if;
	else
		raise exception 'CLINICAL_ENTRY_DENIED';
	end if;

	if p_amount is not null and not public.user_can_view_costs(p_business_id) then
		raise exception 'CLINICAL_COST_DENIED';
	end if;

	update clinical_entries
	set
		entry_type = nullif(trim(p_entry_type), ''),
		description = nullif(trim(p_description), ''),
		teeth = nullif(trim(coalesce(p_teeth, '')), ''),
		internal_note = nullif(trim(coalesce(p_internal_note, '')), ''),
		updated_by_user_id = v_actor,
		updated_at = now()
	where id = p_entry_id;

	if public.user_can_view_costs(p_business_id) then
		insert into clinical_entry_costs (
			business_id,
			clinical_entry_id,
			amount,
			created_by,
			updated_by
		)
		values (
			p_business_id,
			p_entry_id,
			p_amount,
			v_actor,
			v_actor
		)
		on conflict (business_id, clinical_entry_id) do update
		set
			amount = excluded.amount,
			updated_by = v_actor,
			updated_at = now();
	end if;
end;
$$;

revoke execute on function public.create_clinical_entry_safely(uuid, uuid, text, text, timestamptz, text, text, numeric) from public, anon;
revoke execute on function public.update_clinical_entry_safely(uuid, uuid, uuid, text, text, text, text, numeric) from public, anon;
revoke execute on function public.current_user_professional_id(uuid) from public, anon;
revoke execute on function public.user_has_active_professional_patient_link(uuid, uuid) from public, anon;
revoke execute on function public.user_can_view_costs(uuid) from public, anon;
revoke execute on function public.business_allows_owner_restricted_read(uuid) from public, anon;
revoke execute on function public.user_can_read_basic_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_clinical_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_radiology_reference(uuid, uuid) from public, anon;
revoke execute on function public.upsert_patient_clinical_profile_safely(uuid, uuid, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.set_patient_archive_state_safely(uuid, uuid, boolean) from public, anon;
revoke execute on function public.set_patient_drive_folder_safely(uuid, uuid, text) from public, anon;
revoke execute on function public.get_patient_drive_folder_safely(uuid, uuid) from public, anon;
revoke execute on function public.clear_patient_drive_folders_safely(uuid) from public, anon;

grant execute on function public.create_clinical_entry_safely(uuid, uuid, text, text, timestamptz, text, text, numeric) to authenticated;
grant execute on function public.update_clinical_entry_safely(uuid, uuid, uuid, text, text, text, text, numeric) to authenticated;
grant execute on function public.current_user_professional_id(uuid) to authenticated;
grant execute on function public.user_has_active_professional_patient_link(uuid, uuid) to authenticated;
grant execute on function public.user_can_view_costs(uuid) to authenticated;
grant execute on function public.business_allows_owner_restricted_read(uuid) to authenticated;
grant execute on function public.user_can_read_basic_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_clinical_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_radiology_reference(uuid, uuid) to authenticated;
grant execute on function public.upsert_patient_clinical_profile_safely(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.set_patient_archive_state_safely(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_patient_drive_folder_safely(uuid, uuid, text) to authenticated;
grant execute on function public.get_patient_drive_folder_safely(uuid, uuid) to authenticated;
grant execute on function public.clear_patient_drive_folders_safely(uuid) to authenticated;

revoke all on table clinical_entry_costs from anon, authenticated;
grant select on table clinical_entry_costs to authenticated;

alter table clinical_entry_costs enable row level security;
alter table professional_patient_links enable row level security;

drop policy if exists clinical_entry_costs_select on clinical_entry_costs;
create policy clinical_entry_costs_select
	on clinical_entry_costs
	for select
	to authenticated
	using (public.user_can_view_costs(business_id));

notify pgrst, 'reload schema';
