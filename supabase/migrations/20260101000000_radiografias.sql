-- Esquema para radiografias (Drive BYO) + conexion Drive.
-- Ejecutar en Supabase SQL editor.

alter table if exists patients
	add column if not exists drive_folder_id text;

create table if not exists drive_connections (
	owner_id uuid primary key references auth.users(id) on delete cascade,
	provider text not null default 'google_drive',
	connected_email text,
	root_folder_id text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists patient_radiographs (
	id uuid primary key default gen_random_uuid(),
	owner_id uuid not null references auth.users(id) on delete cascade,
	patient_id uuid not null references patients(id) on delete cascade,
	status text not null default 'uploading',
	drive_file_id text,
	original_filename text,
	mime_type text,
	bytes bigint,
	sha256 text,
	taken_at date,
	note text,
	created_at timestamptz not null default now(),
	created_by uuid references auth.users(id),
	deleted_at timestamptz
);

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'patient_radiographs_status_chk'
	) then
		alter table patient_radiographs
			add constraint patient_radiographs_status_chk
			check (status in ('uploading', 'ready', 'failed'));
	end if;
end $$;

create index if not exists patient_radiographs_owner_patient_idx
	on patient_radiographs (owner_id, patient_id, created_at desc);

create unique index if not exists patient_radiographs_drive_file_id_uq
	on patient_radiographs (drive_file_id)
	where drive_file_id is not null;

alter table if exists patients enable row level security;
alter table drive_connections enable row level security;
alter table patient_radiographs enable row level security;

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patients'
	) then
		create policy patients_owner_select
			on patients
			for select
			using (owner_id = auth.uid());

		create policy patients_owner_insert
			on patients
			for insert
			with check (owner_id = auth.uid());

		create policy patients_owner_update
			on patients
			for update
			using (owner_id = auth.uid())
			with check (owner_id = auth.uid());

		create policy patients_owner_delete
			on patients
			for delete
			using (owner_id = auth.uid());
	end if;
end $$;

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'drive_connections'
		and policyname = 'drive_connections_owner_select'
	) then
		create policy drive_connections_owner_select
			on drive_connections
			for select
			using (owner_id = auth.uid());
	end if;
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'drive_connections'
		and policyname = 'drive_connections_owner_write'
	) then
		create policy drive_connections_owner_write
			on drive_connections
			for insert
			with check (owner_id = auth.uid());
	end if;
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'drive_connections'
		and policyname = 'drive_connections_owner_update'
	) then
		create policy drive_connections_owner_update
			on drive_connections
			for update
			using (owner_id = auth.uid())
			with check (owner_id = auth.uid());
	end if;
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'drive_connections'
		and policyname = 'drive_connections_owner_delete'
	) then
		create policy drive_connections_owner_delete
			on drive_connections
			for delete
			using (owner_id = auth.uid());
	end if;
end $$;

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patient_radiographs'
		and policyname = 'patient_radiographs_owner_select'
	) then
		create policy patient_radiographs_owner_select
			on patient_radiographs
			for select
			using (owner_id = auth.uid());
	end if;
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patient_radiographs'
		and policyname = 'patient_radiographs_owner_insert'
	) then
		create policy patient_radiographs_owner_insert
			on patient_radiographs
			for insert
			with check (
				owner_id = auth.uid()
				and exists (
					select 1
					from patients p
					where p.id = patient_id
					and p.owner_id = auth.uid()
				)
			);
	end if;
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patient_radiographs'
		and policyname = 'patient_radiographs_owner_update'
	) then
		create policy patient_radiographs_owner_update
			on patient_radiographs
			for update
			using (owner_id = auth.uid())
			with check (owner_id = auth.uid());
	end if;
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'patient_radiographs'
		and policyname = 'patient_radiographs_owner_delete'
	) then
		create policy patient_radiographs_owner_delete
			on patient_radiographs
			for delete
			using (owner_id = auth.uid());
	end if;
end $$;
