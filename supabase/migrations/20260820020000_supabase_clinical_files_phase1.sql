begin;

create extension if not exists pgcrypto;

-- Bucket privado único. Las columnas opcionales varían entre versiones de
-- Supabase Storage, por eso se configuran sólo cuando existen.
insert into storage.buckets (id, name)
values ('patient-clinical-files', 'patient-clinical-files')
on conflict (id) do update set name = excluded.name;

do $$
begin
	if exists (
		select 1
		from information_schema.columns
		where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public'
	) then
		execute $sql$update storage.buckets set public = false where id = 'patient-clinical-files'$sql$;
	end if;

	if exists (
		select 1
		from information_schema.columns
		where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
	) then
		execute $sql$update storage.buckets set file_size_limit = 26214400 where id = 'patient-clinical-files'$sql$;
	end if;

	if exists (
		select 1
		from information_schema.columns
		where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
	) then
		execute $sql$
			update storage.buckets
			set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
			where id = 'patient-clinical-files'
		$sql$;
	end if;
end;
$$;

-- La actividad se completa y se indexa en la migración siguiente. Se agrega
-- aquí para que finalizar una radiografía pueda actualizarla en la misma
-- transacción que marca el archivo ready.
alter table public.patients
	add column if not exists activity_at timestamptz not null default now();

-- El dueño técnico histórico nunca debe ser dueño destructivo del historial.
alter table public.patients
	drop constraint if exists patients_owner_id_fkey;
alter table public.patients
	add constraint patients_owner_id_fkey
	foreign key (owner_id) references auth.users(id) on delete set null;

-- La auditoría debe sobrevivir al cierre de una cuenta sin bloquearlo ni
-- retener al usuario como propietario técnico del archivo.
-- Estas columnas ya forman parte del contrato de audit_security_event, pero
-- faltaban en una reconstrucción desde cero del historial de migraciones.
alter table public.audit_logs
	add column if not exists result text,
	add column if not exists reason_code text;

update public.audit_logs
set result = 'success'
where result is null;

alter table public.audit_logs
	alter column result set default 'success',
	alter column result set not null;

alter table public.audit_logs
	drop constraint if exists audit_logs_user_id_fkey;
alter table public.audit_logs
	add constraint audit_logs_user_id_fkey
	foreign key (user_id) references auth.users(id) on delete set null;

-- The trusted backend verifies audit side effects and may inspect them during
-- incident handling. Client roles do not receive this grant.
grant select on table public.audit_logs to service_role;

alter table public.patient_radiographs
	add column if not exists storage_provider text not null default 'google_drive_legacy',
	add column if not exists storage_bucket text,
	add column if not exists storage_path text,
	add column if not exists thumbnail_path text,
	add column if not exists integrity_status text not null default 'unchecked',
	add column if not exists uploaded_by uuid,
	add column if not exists client_request_id uuid,
	add column if not exists ready_at timestamptz,
	add column if not exists deleted_by uuid,
	add column if not exists restored_at timestamptz,
	add column if not exists restored_by uuid,
	add column if not exists failure_code text;

update public.patient_radiographs
set
	uploaded_by = coalesce(uploaded_by, created_by, owner_id),
	ready_at = case
		when status = 'ready' then coalesce(ready_at, created_at)
		else ready_at
	end,
	storage_provider = case
		when storage_path is not null then 'supabase_storage'
		else 'google_drive_legacy'
	end
where
	uploaded_by is null
	or (status = 'ready' and ready_at is null)
	or storage_provider is distinct from case
		when storage_path is not null then 'supabase_storage'
		else 'google_drive_legacy'
	end;

alter table public.patient_radiographs
	alter column storage_provider set default 'supabase_storage';

alter table public.patient_radiographs
	alter column owner_id drop not null;

alter table public.patient_radiographs
	drop constraint if exists patient_radiographs_owner_id_fkey,
	drop constraint if exists patient_radiographs_created_by_fkey,
	drop constraint if exists patient_radiographs_uploaded_by_fkey,
	drop constraint if exists patient_radiographs_deleted_by_fkey,
	drop constraint if exists patient_radiographs_restored_by_fkey,
	drop constraint if exists patient_radiographs_patient_id_fkey,
	drop constraint if exists patient_radiographs_business_id_fkey,
	drop constraint if exists patient_radiographs_status_chk,
	drop constraint if exists patient_radiographs_storage_provider_chk,
	drop constraint if exists patient_radiographs_integrity_status_chk,
	drop constraint if exists patient_radiographs_storage_ready_chk,
	drop constraint if exists patient_radiographs_storage_path_chk,
	drop constraint if exists patient_radiographs_thumbnail_path_chk;

alter table public.patient_radiographs
	add constraint patient_radiographs_owner_id_fkey
		foreign key (owner_id) references auth.users(id) on delete set null,
	add constraint patient_radiographs_created_by_fkey
		foreign key (created_by) references auth.users(id) on delete set null,
	add constraint patient_radiographs_uploaded_by_fkey
		foreign key (uploaded_by) references auth.users(id) on delete set null,
	add constraint patient_radiographs_deleted_by_fkey
		foreign key (deleted_by) references auth.users(id) on delete set null,
	add constraint patient_radiographs_restored_by_fkey
		foreign key (restored_by) references auth.users(id) on delete set null,
	add constraint patient_radiographs_patient_id_fkey
		foreign key (patient_id) references public.patients(id) on delete restrict,
	add constraint patient_radiographs_business_id_fkey
		foreign key (business_id) references public.businesses(id) on delete restrict,
	add constraint patient_radiographs_status_chk
		check (status in ('uploading', 'ready', 'failed', 'trashed')),
	add constraint patient_radiographs_storage_provider_chk
		check (storage_provider in ('google_drive_legacy', 'supabase_storage')),
	add constraint patient_radiographs_integrity_status_chk
		check (integrity_status in ('unchecked', 'ok', 'missing', 'checksum_mismatch')),
	add constraint patient_radiographs_storage_ready_chk
		check (
			storage_provider <> 'supabase_storage'
			or status not in ('ready', 'trashed')
			or (
				storage_bucket = 'patient-clinical-files'
				and storage_path is not null
				and mime_type in ('image/jpeg', 'image/png')
				and bytes between 1 and 26214400
				and sha256 ~ '^[0-9a-f]{64}$'
				and ready_at is not null
			)
		),
	add constraint patient_radiographs_storage_path_chk
		check (
			storage_path is null
			or storage_path = business_id::text || '/' || patient_id::text || '/' || id::text || '/original.' ||
				case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else '' end
		),
	add constraint patient_radiographs_thumbnail_path_chk
		check (
			thumbnail_path is null
			or thumbnail_path = business_id::text || '/' || patient_id::text || '/' || id::text || '/thumbnail.webp'
		);

do $$
begin
	if not exists (select 1 from public.patient_radiographs where business_id is null) then
		alter table public.patient_radiographs alter column business_id set not null;
	end if;
end;
$$;

create unique index if not exists patient_radiographs_storage_object_uq
	on public.patient_radiographs (storage_bucket, storage_path)
	where storage_bucket is not null and storage_path is not null;

create unique index if not exists patient_radiographs_client_request_uq
	on public.patient_radiographs (business_id, uploaded_by, client_request_id)
	where uploaded_by is not null and client_request_id is not null;

create index if not exists patient_radiographs_active_patient_idx
	on public.patient_radiographs (business_id, patient_id, created_at desc, id desc)
	where status = 'ready' and storage_provider = 'supabase_storage';

create index if not exists patient_radiographs_trash_idx
	on public.patient_radiographs (business_id, deleted_at desc, id desc)
	where status = 'trashed' and storage_provider = 'supabase_storage';

create index if not exists patient_radiographs_pending_uploader_idx
	on public.patient_radiographs (business_id, uploaded_by, created_at desc)
	where status = 'uploading' and storage_provider = 'supabase_storage';

-- El modelo personal de Drive aplicado previamente queda sólo como inventario.
-- Se revocan sus superficies operativas sin borrar filas ni columnas heredadas.
drop policy if exists drive_connections_owner_select on public.drive_connections;
drop policy if exists drive_connections_owner_write on public.drive_connections;
drop policy if exists drive_connections_owner_update on public.drive_connections;
drop policy if exists drive_connections_owner_delete on public.drive_connections;
revoke all on table public.drive_connections from public, anon, authenticated;

do $$
begin
	if to_regclass('public.patient_drive_folders') is not null then
		execute 'drop policy if exists patient_drive_folders_select_own on public.patient_drive_folders';
		execute 'drop policy if exists patient_drive_folders_insert_own on public.patient_drive_folders';
		execute 'drop policy if exists patient_drive_folders_update_own on public.patient_drive_folders';
		execute 'drop policy if exists patient_drive_folders_delete_own on public.patient_drive_folders';
		execute 'revoke all on table public.patient_drive_folders from public, anon, authenticated';
	end if;
end;
$$;

drop function if exists public.set_my_patient_drive_folder(uuid, uuid, text);
drop function if exists public.disconnect_my_google_drive();
drop function if exists public.save_my_google_drive_connection(text, text);
revoke all on function public.set_patient_drive_folder_safely(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_patient_drive_folder_safely(uuid, uuid) from public, anon, authenticated;
revoke all on function public.clear_patient_drive_folders_safely(uuid) from public, anon, authenticated;

-- Metadata clínica: lectura directa mínima y todas las mutaciones por RPC.
drop policy if exists patient_radiographs_owner_select on public.patient_radiographs;
drop policy if exists patient_radiographs_owner_insert on public.patient_radiographs;
drop policy if exists patient_radiographs_owner_update on public.patient_radiographs;
drop policy if exists patient_radiographs_owner_delete on public.patient_radiographs;
drop policy if exists patient_radiographs_business_member_select on public.patient_radiographs;
drop policy if exists patient_radiographs_business_operator_insert on public.patient_radiographs;
drop policy if exists patient_radiographs_business_operator_update on public.patient_radiographs;
drop policy if exists patient_radiographs_business_operator_delete on public.patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_select on public.patient_radiographs;
drop policy if exists patient_radiographs_user_isolated_select on public.patient_radiographs;
drop policy if exists patient_radiographs_user_isolated_insert on public.patient_radiographs;
drop policy if exists patient_radiographs_user_isolated_update on public.patient_radiographs;
drop policy if exists patient_radiographs_user_isolated_delete on public.patient_radiographs;

create policy patient_radiographs_clinical_select
	on public.patient_radiographs
	for select
	to authenticated
	using (
		business_id is not null
		and (
			(
				storage_provider = 'supabase_storage'
				and status = 'ready'
				and (
					(
						public.user_business_role(business_id) in ('owner', 'admin')
						and public.business_allows_owner_restricted_read(business_id)
					)
					or (
						public.user_business_role(business_id) = 'professional'
						and public.user_can_read_clinical_patient(business_id, patient_id)
					)
				)
			)
			or (
				storage_provider = 'supabase_storage'
				and status in ('uploading', 'failed')
				and public.business_allows_operation(business_id)
				and public.user_can_read_clinical_patient(business_id, patient_id)
				and (
					uploaded_by = auth.uid()
					or public.user_business_role(business_id) in ('owner', 'admin')
				)
			)
			or (
				storage_provider = 'supabase_storage'
				and status = 'trashed'
				and public.user_business_role(business_id) in ('owner', 'admin')
				and public.business_allows_owner_restricted_read(business_id)
			)
		)
	);

revoke all on table public.patient_radiographs from public, anon, authenticated;
grant select on table public.patient_radiographs to authenticated, service_role;

-- No política de INSERT/UPDATE/DELETE en storage.objects: los clientes sólo
-- reciben tokens firmados para una ruta exacta. Tampoco existe DELETE firmado.
-- Supabase administra RLS sobre storage.objects; la migración no intenta
-- alterar la tabla del esquema gestionado porque el rol de migraciones no es
-- su propietario. Al no crear políticas para este bucket, el cliente no tiene
-- acceso directo.

-- El plano de control también es exclusivamente server-side. Estas funciones
-- resuelven permisos para un actor explícito porque la llamada llega con el JWT
-- service_role del backend, nunca con el JWT reutilizable del navegador.
create schema if not exists private;

create or replace function private.require_clinical_file_service_call()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
	if coalesce(auth.role(), '') <> 'service_role' then
		raise exception 'RADIOGRAPH_SERVER_REQUIRED';
	end if;
end;
$$;

create or replace function private.clinical_file_actor_business_role(
	p_business_id uuid,
	p_actor_id uuid
)
returns text
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
	select candidate.role
	from (
		select bu.role::text as role
		from public.business_users bu
		where bu.business_id = p_business_id
			and bu.user_id = p_actor_id
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
		union all
		select 'admin'::text
		where exists (
			select 1
			from public.account_assistance_grants grant_row
			join public.account_assistance_support_users support
				on support.user_id = grant_row.support_user_id
				and support.enabled = true
			where grant_row.business_id = p_business_id
				and grant_row.support_user_id = p_actor_id
				and grant_row.status = 'active'
				and grant_row.revoked_at is null
				and grant_row.expires_at > now()
				and public.business_allows_operation(p_business_id)
		)
	) candidate
	order by case candidate.role
		when 'owner' then 1
		when 'admin' then 2
		when 'reception' then 3
		when 'professional' then 4
		else 5
	end
	limit 1;
$$;

create or replace function private.clinical_file_actor_can_read_patient(
	p_business_id uuid,
	p_patient_id uuid,
	p_actor_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
	select exists (
		select 1
		from public.patients patient
		where patient.business_id = p_business_id
			and patient.id = p_patient_id
	)
	and case
		when private.clinical_file_actor_business_role(p_business_id, p_actor_id) in ('owner', 'admin')
			then public.business_allows_owner_restricted_read(p_business_id)
		when private.clinical_file_actor_business_role(p_business_id, p_actor_id) = 'professional'
			then public.business_allows_operation(p_business_id)
			and exists (
				select 1
				from public.professional_patient_links link
				join public.professional_users professional_user
					on professional_user.business_id = link.business_id
					and professional_user.professional_id = link.professional_id
				where link.business_id = p_business_id
					and link.patient_id = p_patient_id
					and link.is_active = true
					and professional_user.user_id = p_actor_id
			)
		else false
	end;
$$;

revoke all on function private.require_clinical_file_service_call() from public, anon, authenticated;
revoke all on function private.clinical_file_actor_business_role(uuid, uuid) from public, anon, authenticated;
revoke all on function private.clinical_file_actor_can_read_patient(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.begin_patient_radiograph_upload(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_client_request_id uuid,
	p_original_filename text,
	p_mime_type text,
	p_bytes bigint,
	p_sha256 text,
	p_taken_at date default null,
	p_note text default null
)
returns table (
	radiograph_id uuid,
	storage_bucket text,
	storage_path text,
	thumbnail_path text,
	status text,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := p_actor_id;
	v_role text;
	v_id uuid;
	v_extension text;
	v_filename text := nullif(trim(coalesce(p_original_filename, '')), '');
	v_note text := nullif(trim(coalesce(p_note, '')), '');
	v_hash text := lower(trim(coalesce(p_sha256, '')));
	v_business_today date;
	v_existing public.patient_radiographs%rowtype;
begin
	perform private.require_clinical_file_service_call();
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if p_business_id is null or p_patient_id is null or p_client_request_id is null then
		raise exception 'RADIOGRAPH_UPLOAD_INVALID';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	v_role := private.clinical_file_actor_business_role(p_business_id, v_actor);
	if coalesce(v_role, '') not in ('owner', 'admin', 'professional')
		or not private.clinical_file_actor_can_read_patient(p_business_id, p_patient_id, v_actor)
	then
		raise exception 'RADIOGRAPH_ACCESS_DENIED';
	end if;
	if not exists (
		select 1 from public.patients p
		where p.business_id = p_business_id and p.id = p_patient_id
	) then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
	if p_mime_type not in ('image/jpeg', 'image/png') then
		raise exception 'RADIOGRAPH_FORMAT_INVALID';
	end if;
	if p_bytes is null or p_bytes < 1 or p_bytes > 26214400 then
		raise exception 'RADIOGRAPH_SIZE_INVALID';
	end if;
	if v_hash !~ '^[0-9a-f]{64}$' then
		raise exception 'RADIOGRAPH_CHECKSUM_INVALID';
	end if;
	if v_filename is null or length(v_filename) > 160 or v_filename ~ '[\\/]' then
		raise exception 'RADIOGRAPH_FILENAME_INVALID';
	end if;
	if v_note is not null and length(v_note) > 500 then
		raise exception 'RADIOGRAPH_NOTE_INVALID';
	end if;
	select (statement_timestamp() at time zone coalesce(nullif(trim(b.timezone), ''), 'UTC'))::date
	into v_business_today
	from public.businesses b
	where b.id = p_business_id;

	if p_taken_at is not null and p_taken_at > coalesce(v_business_today, current_date) then
		raise exception 'RADIOGRAPH_DATE_INVALID';
	end if;

	-- Serializa por consultorio + actor. Esto hace atómico tanto el reintento
	-- idempotente como el máximo de tres cargas pendientes ante solicitudes
	-- concurrentes desde varias pestañas o dispositivos.
	perform pg_advisory_xact_lock(
		hashtextextended(p_business_id::text || ':' || v_actor::text, 0)
	);

	select pr.*
	into v_existing
	from public.patient_radiographs pr
	where pr.business_id = p_business_id
		and pr.uploaded_by = v_actor
		and pr.client_request_id = p_client_request_id
	limit 1;

	if found then
		if v_existing.patient_id <> p_patient_id
			or v_existing.storage_provider <> 'supabase_storage'
			or v_existing.mime_type <> p_mime_type
			or v_existing.bytes <> p_bytes
			or v_existing.sha256 <> v_hash
		then
			raise exception 'RADIOGRAPH_REQUEST_CONFLICT';
		end if;

		return query
		select
			v_existing.id,
			v_existing.storage_bucket,
			v_existing.storage_path,
			v_existing.thumbnail_path,
			v_existing.status,
			v_existing.created_at;
		return;
	end if;

	if (
		select count(*)
		from public.patient_radiographs pr
		where pr.business_id = p_business_id
			and pr.uploaded_by = v_actor
			and pr.storage_provider = 'supabase_storage'
			and pr.status = 'uploading'
			and pr.created_at >= now() - interval '30 minutes'
	) >= 3 then
		raise exception 'RADIOGRAPH_PENDING_LIMIT';
	end if;

	v_id := gen_random_uuid();
	v_extension := case p_mime_type when 'image/jpeg' then 'jpg' else 'png' end;

	insert into public.patient_radiographs (
		id,
		owner_id,
		business_id,
		patient_id,
		status,
		storage_provider,
		storage_bucket,
		storage_path,
		thumbnail_path,
		integrity_status,
		uploaded_by,
		client_request_id,
		original_filename,
		mime_type,
		bytes,
		sha256,
		taken_at,
		note,
		created_by
	)
	values (
		v_id,
		v_actor,
		p_business_id,
		p_patient_id,
		'uploading',
		'supabase_storage',
		'patient-clinical-files',
		p_business_id::text || '/' || p_patient_id::text || '/' || v_id::text || '/original.' || v_extension,
		p_business_id::text || '/' || p_patient_id::text || '/' || v_id::text || '/thumbnail.webp',
		'unchecked',
		v_actor,
		p_client_request_id,
		v_filename,
		p_mime_type,
		p_bytes,
		v_hash,
		p_taken_at,
		v_note,
		v_actor
	);

	insert into public.audit_logs (
		business_id, user_id, action, entity_type, entity_id, result, metadata
	)
	values (
		p_business_id,
		v_actor,
		'radiograph.upload_started',
		'patient_radiograph',
		v_id,
		'success',
		jsonb_build_object('patient_id', p_patient_id, 'bytes', p_bytes, 'mime_type', p_mime_type)
	);

	return query
	select
		pr.id,
		pr.storage_bucket,
		pr.storage_path,
		pr.thumbnail_path,
		pr.status,
		pr.created_at
	from public.patient_radiographs pr
	where pr.id = v_id;
end;
$$;

create or replace function public.complete_patient_radiograph_upload(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_radiograph_id uuid,
	p_actual_bytes bigint,
	p_actual_mime_type text,
	p_thumbnail_uploaded boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := p_actor_id;
	v_role text;
	v_row public.patient_radiographs%rowtype;
begin
	perform private.require_clinical_file_service_call();
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	v_role := private.clinical_file_actor_business_role(p_business_id, v_actor);
	if coalesce(v_role, '') not in ('owner', 'admin', 'professional')
		or not private.clinical_file_actor_can_read_patient(p_business_id, p_patient_id, v_actor)
	then
		raise exception 'RADIOGRAPH_ACCESS_DENIED';
	end if;

	select pr.*
	into v_row
	from public.patient_radiographs pr
	where pr.id = p_radiograph_id
		and pr.business_id = p_business_id
		and pr.patient_id = p_patient_id
	for update;

	if not found then
		raise exception 'RADIOGRAPH_NOT_FOUND';
	end if;
	if v_row.storage_provider <> 'supabase_storage' then
		raise exception 'RADIOGRAPH_PROVIDER_INVALID';
	end if;
	if v_row.uploaded_by is distinct from v_actor then
		raise exception 'RADIOGRAPH_UPLOAD_OWNER_REQUIRED';
	end if;
	if v_row.status = 'ready' then
		return v_row.id;
	end if;
	if v_row.status <> 'uploading' then
		raise exception 'RADIOGRAPH_STATE_INVALID';
	end if;
	if p_actual_bytes is distinct from v_row.bytes
		or p_actual_mime_type is distinct from v_row.mime_type
	then
		raise exception 'RADIOGRAPH_OBJECT_MISMATCH';
	end if;

	update public.patient_radiographs pr
	set
		status = 'ready',
		ready_at = coalesce(pr.ready_at, now()),
		integrity_status = 'ok',
		thumbnail_path = case when coalesce(p_thumbnail_uploaded, false) then pr.thumbnail_path else null end,
		failure_code = null
	where pr.id = v_row.id;

	update public.patients p
	set activity_at = greatest(coalesce(p.activity_at, p.created_at), now())
	where p.business_id = p_business_id and p.id = p_patient_id;

	insert into public.audit_logs (
		business_id, user_id, action, entity_type, entity_id, result, metadata
	)
	values (
		p_business_id,
		v_actor,
		'radiograph.upload_completed',
		'patient_radiograph',
		v_row.id,
		'success',
		jsonb_build_object(
			'patient_id', p_patient_id,
			'bytes', v_row.bytes,
			'mime_type', v_row.mime_type,
			'thumbnail_available', coalesce(p_thumbnail_uploaded, false)
		)
	);

	return v_row.id;
end;
$$;

create or replace function public.fail_patient_radiograph_upload(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_radiograph_id uuid,
	p_failure_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := p_actor_id;
	v_row public.patient_radiographs%rowtype;
	v_code text := left(nullif(trim(coalesce(p_failure_code, '')), ''), 80);
begin
	perform private.require_clinical_file_service_call();
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	select pr.*
	into v_row
	from public.patient_radiographs pr
	where pr.id = p_radiograph_id
		and pr.business_id = p_business_id
		and pr.patient_id = p_patient_id
	for update;

	if not found then
		raise exception 'RADIOGRAPH_NOT_FOUND';
	end if;
	if v_row.storage_provider <> 'supabase_storage'
		or not private.clinical_file_actor_can_read_patient(p_business_id, p_patient_id, v_actor)
		or (
			v_row.uploaded_by is distinct from v_actor
			and private.clinical_file_actor_business_role(p_business_id, v_actor) not in ('owner', 'admin')
		)
	then
		raise exception 'RADIOGRAPH_ACCESS_DENIED';
	end if;
	if v_row.status = 'failed' then
		return v_row.id;
	end if;
	if v_row.status <> 'uploading' then
		raise exception 'RADIOGRAPH_STATE_INVALID';
	end if;

	update public.patient_radiographs
	set status = 'failed', failure_code = v_code
	where id = v_row.id;

	insert into public.audit_logs (
		business_id, user_id, action, entity_type, entity_id, result, reason_code, metadata
	)
	values (
		p_business_id,
		v_actor,
		'radiograph.upload_failed',
		'patient_radiograph',
		v_row.id,
		'error',
		v_code,
		jsonb_build_object('patient_id', p_patient_id, 'failure_code', v_code)
	);

	return v_row.id;
end;
$$;

create or replace function public.trash_patient_radiograph(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_radiograph_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := p_actor_id;
	v_row public.patient_radiographs%rowtype;
begin
	perform private.require_clinical_file_service_call();
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if private.clinical_file_actor_business_role(p_business_id, v_actor) not in ('owner', 'admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'RADIOGRAPH_TRASH_DENIED';
	end if;

	select pr.*
	into v_row
	from public.patient_radiographs pr
	where pr.id = p_radiograph_id
		and pr.business_id = p_business_id
		and pr.patient_id = p_patient_id
	for update;

	if not found then
		raise exception 'RADIOGRAPH_NOT_FOUND';
	end if;
	if v_row.storage_provider <> 'supabase_storage' then
		raise exception 'RADIOGRAPH_PROVIDER_INVALID';
	end if;
	if v_row.status = 'trashed' then
		return v_row.id;
	end if;
	if v_row.status <> 'ready' then
		raise exception 'RADIOGRAPH_STATE_INVALID';
	end if;

	update public.patient_radiographs
	set
		status = 'trashed',
		deleted_at = now(),
		deleted_by = v_actor,
		restored_at = null,
		restored_by = null
	where id = v_row.id;

	insert into public.audit_logs (
		business_id, user_id, action, entity_type, entity_id, result, metadata
	)
	values (
		p_business_id,
		v_actor,
		'radiograph.trashed',
		'patient_radiograph',
		v_row.id,
		'success',
		jsonb_build_object('patient_id', p_patient_id)
	);

	return v_row.id;
end;
$$;

create or replace function public.restore_patient_radiograph(
	p_actor_id uuid,
	p_business_id uuid,
	p_radiograph_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := p_actor_id;
	v_row public.patient_radiographs%rowtype;
begin
	perform private.require_clinical_file_service_call();
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if private.clinical_file_actor_business_role(p_business_id, v_actor) not in ('owner', 'admin')
		or not public.business_allows_operation(p_business_id)
	then
		raise exception 'RADIOGRAPH_RESTORE_DENIED';
	end if;

	select pr.*
	into v_row
	from public.patient_radiographs pr
	where pr.id = p_radiograph_id
		and pr.business_id = p_business_id
	for update;

	if not found then
		raise exception 'RADIOGRAPH_NOT_FOUND';
	end if;
	if v_row.storage_provider <> 'supabase_storage' then
		raise exception 'RADIOGRAPH_PROVIDER_INVALID';
	end if;
	if v_row.status = 'ready' then
		return v_row.id;
	end if;
	if v_row.status <> 'trashed' then
		raise exception 'RADIOGRAPH_STATE_INVALID';
	end if;
	if v_row.integrity_status <> 'ok' then
		raise exception 'RADIOGRAPH_INTEGRITY_INVALID';
	end if;

	update public.patient_radiographs
	set
		status = 'ready',
		deleted_at = null,
		deleted_by = null,
		restored_at = now(),
		restored_by = v_actor
	where id = v_row.id;

	update public.patients p
	set activity_at = greatest(coalesce(p.activity_at, p.created_at), now())
	where p.business_id = p_business_id and p.id = v_row.patient_id;

	insert into public.audit_logs (
		business_id, user_id, action, entity_type, entity_id, result, metadata
	)
	values (
		p_business_id,
		v_actor,
		'radiograph.restored',
		'patient_radiograph',
		v_row.id,
		'success',
		jsonb_build_object('patient_id', v_row.patient_id)
	);

	return v_row.id;
end;
$$;

create or replace function public.grant_patient_radiograph_original_access(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_radiograph_id uuid
)
returns table (
	storage_bucket text,
	storage_path text,
	original_filename text,
	mime_type text,
	bytes bigint
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := p_actor_id;
	v_row public.patient_radiographs%rowtype;
begin
	perform private.require_clinical_file_service_call();
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if not private.clinical_file_actor_can_read_patient(p_business_id, p_patient_id, v_actor) then
		raise exception 'RADIOGRAPH_ACCESS_DENIED';
	end if;

	select pr.*
	into v_row
	from public.patient_radiographs pr
	where pr.id = p_radiograph_id
		and pr.business_id = p_business_id
		and pr.patient_id = p_patient_id;

	if not found or v_row.storage_provider <> 'supabase_storage' or v_row.status <> 'ready' then
		raise exception 'RADIOGRAPH_NOT_FOUND';
	end if;
	if v_row.integrity_status <> 'ok' then
		raise exception 'RADIOGRAPH_INTEGRITY_INVALID';
	end if;

	insert into public.audit_logs (
		business_id, user_id, action, entity_type, entity_id, result, metadata
	)
	values (
		p_business_id,
		v_actor,
		'radiograph.original_access_granted',
		'patient_radiograph',
		v_row.id,
		'success',
		jsonb_build_object('patient_id', p_patient_id, 'bytes', v_row.bytes)
	);

	return query
	select
		v_row.storage_bucket,
		v_row.storage_path,
		v_row.original_filename,
		v_row.mime_type,
		v_row.bytes;
end;
$$;

revoke all on function public.begin_patient_radiograph_upload(uuid, uuid, uuid, uuid, text, text, bigint, text, date, text) from public, anon, authenticated;
revoke all on function public.complete_patient_radiograph_upload(uuid, uuid, uuid, uuid, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.fail_patient_radiograph_upload(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.trash_patient_radiograph(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_patient_radiograph(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.grant_patient_radiograph_original_access(uuid, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.begin_patient_radiograph_upload(uuid, uuid, uuid, uuid, text, text, bigint, text, date, text) to service_role;
grant execute on function public.complete_patient_radiograph_upload(uuid, uuid, uuid, uuid, bigint, text, boolean) to service_role;
grant execute on function public.fail_patient_radiograph_upload(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.trash_patient_radiograph(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.restore_patient_radiograph(uuid, uuid, uuid) to service_role;
grant execute on function public.grant_patient_radiograph_original_access(uuid, uuid, uuid, uuid) to service_role;

-- Reconciliación liviana: nunca borra. Sólo marca metadata cuyo original ya no
-- aparece en storage.objects y registra una anomalía sin datos personales.
create or replace function private.reconcile_patient_radiograph_integrity()
returns integer
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
	v_missing_count integer := 0;
begin
	with changed as (
		update public.patient_radiographs pr
		set integrity_status = 'missing'
		where pr.storage_provider = 'supabase_storage'
			and pr.status in ('ready', 'trashed')
			and pr.integrity_status <> 'missing'
			and not exists (
				select 1
				from storage.objects object
				where object.bucket_id = pr.storage_bucket
					and object.name = pr.storage_path
			)
		returning pr.id, pr.business_id, pr.patient_id
	), audited as (
		insert into public.audit_logs (
			business_id, user_id, action, entity_type, entity_id, result, reason_code, metadata
		)
		select
			changed.business_id,
			null,
			'radiograph.integrity_missing',
			'patient_radiograph',
			changed.id,
			'error',
			'storage_object_missing',
			jsonb_build_object('patient_id', changed.patient_id)
		from changed
		returning 1
	)
	select count(*) into v_missing_count from audited;

	-- Que un objeto reaparezca no demuestra que sus bytes sean los esperados.
	-- Permanece bloqueado hasta una futura recuperación/verificación explícita.
	return v_missing_count;
end;
$$;

revoke all on function private.reconcile_patient_radiograph_integrity() from public, anon, authenticated;
grant execute on function private.reconcile_patient_radiograph_integrity() to service_role;

-- La detección periódica es parte del contrato de fase 1. Si pg_cron o la
-- programación no están disponibles, la migración debe fallar de forma visible
-- en vez de desplegar silenciosamente sin reconciliación.
create extension if not exists pg_cron;

do $$
declare
	v_job_id bigint;
begin
	if to_regnamespace('cron') is null then
		raise exception 'CLINICAL_INTEGRITY_CRON_UNAVAILABLE';
	end if;

	for v_job_id in
		select jobid
		from cron.job
		where jobname = 'cita-suite-clinical-files-integrity'
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'cita-suite-clinical-files-integrity',
		'17 */6 * * *',
		'select private.reconcile_patient_radiograph_integrity()'
	);
end;
$$;

-- Observabilidad estimada, nunca autorización ni facturación. Suma los bytes
-- declarados por cargas completadas y grants de originales para el día local
-- de cada consultorio. Miniaturas, reintentos de red y caché pueden hacer que
-- la transferencia real difiera; por eso los umbrales sólo clasifican revisión.
create or replace function public.get_clinical_file_daily_transfer_estimates(
	p_local_day date default null
)
returns table (
	business_id uuid,
	local_day date,
	upload_events bigint,
	original_access_events bigint,
	upload_bytes bigint,
	original_access_bytes bigint,
	estimated_transfer_bytes bigint,
	threshold_level text
)
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
begin
	perform private.require_clinical_file_service_call();

	return query
	with normalized_events as (
		select
			audit.business_id,
			(audit.created_at at time zone business.timezone)::date as event_local_day,
			audit.action,
			case
				when coalesce(audit.metadata ->> 'bytes', '') ~ '^[0-9]{1,19}$'
					then (audit.metadata ->> 'bytes')::numeric
				else 0::numeric
			end as event_bytes
		from public.audit_logs audit
		join public.businesses business on business.id = audit.business_id
		where audit.action in (
			'radiograph.upload_completed',
			'radiograph.original_access_granted'
		)
			and audit.result = 'success'
			and (audit.created_at at time zone business.timezone)::date = coalesce(
				p_local_day,
				(statement_timestamp() at time zone business.timezone)::date
			)
	), totals as (
		select
			event.business_id,
			event.event_local_day,
			count(*) filter (where event.action = 'radiograph.upload_completed')::bigint
				as upload_events,
			count(*) filter (where event.action = 'radiograph.original_access_granted')::bigint
				as original_access_events,
			coalesce(sum(event.event_bytes) filter (
				where event.action = 'radiograph.upload_completed'
			), 0::numeric) as upload_bytes,
			coalesce(sum(event.event_bytes) filter (
				where event.action = 'radiograph.original_access_granted'
			), 0::numeric) as original_access_bytes
		from normalized_events event
		group by event.business_id, event.event_local_day
	), bounded as (
		select
			totals.*,
			least(
				totals.upload_bytes + totals.original_access_bytes,
				9223372036854775807::numeric
			) as estimated_bytes
		from totals
	)
	select
		bounded.business_id,
		bounded.event_local_day,
		bounded.upload_events,
		bounded.original_access_events,
		least(bounded.upload_bytes, 9223372036854775807::numeric)::bigint,
		least(bounded.original_access_bytes, 9223372036854775807::numeric)::bigint,
		bounded.estimated_bytes::bigint,
		case
			when bounded.estimated_bytes >= 10737418240::numeric then 'critical_10gb'
			when bounded.estimated_bytes >= 5368709120::numeric then 'high_5gb'
			when bounded.estimated_bytes >= 2147483648::numeric then 'watch_2gb'
			else 'normal'
		end
	from bounded
	order by bounded.estimated_bytes desc, bounded.business_id;
end;
$$;

revoke all on function public.get_clinical_file_daily_transfer_estimates(date)
	from public, anon, authenticated;
grant execute on function public.get_clinical_file_daily_transfer_estimates(date)
	to service_role;

-- Amplía el limitador server-side existente sólo para operaciones costosas de
-- radiografías. Los sujetos continúan llegando hasheados desde el servidor.
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
		'mp_subscription_create_by_business',
		'radiograph_upload_by_user',
		'radiograph_original_access_by_user',
		'radiograph_trash_by_user',
		'radiograph_restore_by_user'
	) then
		raise exception 'RATE_LIMIT_UNKNOWN_ACTION';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(v_action || ':' || v_subject_hash, 0));
	v_since := now() - make_interval(secs => v_window_seconds);

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
	if v_action is null or v_subject_hash is null
		or jsonb_typeof(p_windows) <> 'array'
		or jsonb_array_length(p_windows) = 0
	then
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
		'mp_subscription_create_by_business',
		'radiograph_upload_by_user',
		'radiograph_original_access_by_user',
		'radiograph_trash_by_user',
		'radiograph_restore_by_user'
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

revoke execute on function public.consume_server_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.consume_server_rate_limits(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_server_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.consume_server_rate_limits(text, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
