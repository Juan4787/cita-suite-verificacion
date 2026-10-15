-- Profesional: archivo personal de pacientes y trazabilidad visible de cambios.
-- No modifica historiales existentes ni cambia el archivo global del paciente.

alter table professional_patient_links
	add column if not exists archived_at timestamptz,
	add column if not exists archived_by uuid references auth.users(id);

create index if not exists professional_patient_links_professional_archive_idx
	on professional_patient_links (business_id, professional_id, archived_at, is_active);

create table if not exists patient_profile_change_events (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	patient_id uuid not null references patients(id) on delete cascade,
	changed_by_user_id uuid references auth.users(id),
	changed_by_professional_id uuid references professionals(id),
	changed_by_name text not null,
	changed_fields jsonb not null default '[]'::jsonb,
	summary text not null,
	created_at timestamptz not null default now()
);

create index if not exists patient_profile_change_events_patient_created_idx
	on patient_profile_change_events (business_id, patient_id, created_at desc);

alter table patient_profile_change_events enable row level security;

drop policy if exists patient_profile_change_events_select on patient_profile_change_events;
create policy patient_profile_change_events_select
	on patient_profile_change_events
	for select
	to authenticated
	using (public.user_can_read_basic_patient(business_id, patient_id));

drop policy if exists patient_profile_change_events_no_direct_insert on patient_profile_change_events;
create policy patient_profile_change_events_no_direct_insert
	on patient_profile_change_events
	for insert
	to authenticated
	with check (false);

revoke all on table patient_profile_change_events from anon, authenticated;
grant select on table patient_profile_change_events to authenticated;

notify pgrst, 'reload schema';
