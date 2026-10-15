-- Base schema for the existing odontologia panel.
-- Kept idempotent so it can be applied to an existing Supabase project.

create extension if not exists pgcrypto;

create table if not exists allowed_emails (
	id uuid primary key default gen_random_uuid(),
	email text not null unique,
	enabled boolean not null default true,
	created_at timestamptz not null default now()
);

create or replace function public.is_email_enabled(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
		select 1
		from allowed_emails ae
		where lower(ae.email) = lower(trim(p_email))
			and ae.enabled = true
	);
$$;

grant execute on function public.is_email_enabled(text) to authenticated, anon;

create table if not exists patients (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid references auth.users(id) on delete cascade,
	full_name text not null,
	dni text,
	phone text,
	email text,
	birth_date date,
	address text,
	allergies text,
	medication text,
	background text,
	insurance text,
	insurance_plan text,
	custom_fields jsonb,
	archived_at timestamptz,
	last_entry_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table patients
	add column if not exists owner_id uuid references auth.users(id) on delete cascade,
	add column if not exists dni text,
	add column if not exists phone text,
	add column if not exists email text,
	add column if not exists birth_date date,
	add column if not exists address text,
	add column if not exists allergies text,
	add column if not exists medication text,
	add column if not exists background text,
	add column if not exists insurance text,
	add column if not exists insurance_plan text,
	add column if not exists custom_fields jsonb,
	add column if not exists archived_at timestamptz,
	add column if not exists last_entry_at timestamptz,
	add column if not exists created_at timestamptz not null default now(),
	add column if not exists updated_at timestamptz not null default now();

create table if not exists clinical_entries (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid references auth.users(id) on delete cascade,
	patient_id uuid not null references patients(id) on delete cascade,
	created_at timestamptz not null default now(),
	entry_type text not null,
	description text not null,
	teeth text,
	amount numeric,
	internal_note text,
	archived_at timestamptz,
	updated_at timestamptz not null default now()
);

alter table clinical_entries
	add column if not exists owner_id uuid references auth.users(id) on delete cascade,
	add column if not exists teeth text,
	add column if not exists amount numeric,
	add column if not exists internal_note text,
	add column if not exists archived_at timestamptz,
	add column if not exists updated_at timestamptz not null default now();

do $$
begin
	if not exists (
		select 1 from pg_constraint where conname = 'clinical_entries_type_chk'
	) then
		alter table clinical_entries
			add constraint clinical_entries_type_chk
			check (
				entry_type in (
					'Consulta',
					'Diagnóstico',
					'Tratamiento',
					'Procedimiento',
					'Evolución',
					'Indicaciones',
					'Nota interna'
				)
			);
	end if;
end $$;

create unique index if not exists patients_owner_dni_uq
	on patients (owner_id, dni)
	where dni is not null;

create index if not exists patients_owner_updated_idx
	on patients (owner_id, updated_at desc);

create index if not exists clinical_entries_owner_patient_created_idx
	on clinical_entries (owner_id, patient_id, created_at desc);

alter table allowed_emails enable row level security;
alter table patients enable row level security;
alter table clinical_entries enable row level security;

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'allowed_emails'
			and policyname = 'allowed_emails_master_read'
	) then
		create policy allowed_emails_master_read
			on allowed_emails
			for select
			to authenticated
			using (true);
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patients'
			and policyname = 'patients_owner_select'
	) then
		create policy patients_owner_select
			on patients
			for select
			to authenticated
			using (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patients'
			and policyname = 'patients_owner_insert'
	) then
		create policy patients_owner_insert
			on patients
			for insert
			to authenticated
			with check (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patients'
			and policyname = 'patients_owner_update'
	) then
		create policy patients_owner_update
			on patients
			for update
			to authenticated
			using (owner_id = auth.uid())
			with check (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patients'
			and policyname = 'patients_owner_delete'
	) then
		create policy patients_owner_delete
			on patients
			for delete
			to authenticated
			using (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'clinical_entries'
			and policyname = 'clinical_entries_owner_select'
	) then
		create policy clinical_entries_owner_select
			on clinical_entries
			for select
			to authenticated
			using (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'clinical_entries'
			and policyname = 'clinical_entries_owner_insert'
	) then
		create policy clinical_entries_owner_insert
			on clinical_entries
			for insert
			to authenticated
			with check (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'clinical_entries'
			and policyname = 'clinical_entries_owner_update'
	) then
		create policy clinical_entries_owner_update
			on clinical_entries
			for update
			to authenticated
			using (owner_id = auth.uid())
			with check (owner_id = auth.uid());
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'clinical_entries'
			and policyname = 'clinical_entries_owner_delete'
	) then
		create policy clinical_entries_owner_delete
			on clinical_entries
			for delete
			to authenticated
			using (owner_id = auth.uid());
	end if;
end $$;
