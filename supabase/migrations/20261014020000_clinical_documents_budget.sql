begin;
alter table public.businesses add column patient_documents_enabled boolean not null default false;
update storage.buckets set file_size_limit=5000000,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'] where id='patient-clinical-files';
alter table public.patient_radiographs add column source text not null default 'professional' check(source in ('professional','patient'));
alter table public.patient_radiographs add column appointment_id uuid;
alter table public.patient_radiographs add constraint clinical_document_appointment_tenant foreign key(business_id,appointment_id) references public.appointments(business_id,id) on delete restrict;
create index clinical_document_thumbnail_lookup on public.patient_radiographs(storage_bucket,thumbnail_path) where thumbnail_path is not null;
create index clinical_document_appointment on public.patient_radiographs(business_id,appointment_id) where appointment_id is not null;
alter table public.patient_radiographs drop constraint patient_radiographs_storage_ready_chk;
alter table public.patient_radiographs drop constraint patient_radiographs_storage_path_chk;
alter table public.patient_radiographs add constraint patient_radiographs_storage_ready_chk check(storage_provider<>'supabase_storage' or status not in ('ready','trashed') or (storage_bucket='patient-clinical-files' and storage_path is not null and mime_type in ('image/jpeg','image/png','application/pdf') and bytes between 1 and 26214400 and sha256 ~ '^[0-9a-f]{64}$' and ready_at is not null));
alter table public.patient_radiographs add constraint patient_radiographs_storage_path_chk check(storage_path is null or storage_path=business_id::text||'/'||patient_id::text||'/'||id::text||'/original.'||case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'application/pdf' then 'pdf' else '' end);

create table public.clinical_storage_budget (
 singleton boolean primary key default true check(singleton),max_bytes bigint not null default 700000000 check(max_bytes>0),
 used_bytes bigint not null check(used_bytes>=0),reserved_bytes bigint not null default 0 check(reserved_bytes>=0),updated_at timestamptz not null default now()
);
insert into public.clinical_storage_budget(singleton,used_bytes) select true,coalesce(sum(case when metadata->>'size' ~ '^[0-9]{1,18}$' then (metadata->>'size')::bigint else 0 end),0) from storage.objects;
create table public.clinical_upload_slots (
 bucket text not null,path text not null,file_id uuid not null references public.patient_radiographs(id) on delete restrict,
 expires_at timestamptz not null,reserved_bytes bigint not null check(reserved_bytes between 0 and 5000000),
 primary key(bucket,path)
);
create index clinical_upload_slot_file on public.clinical_upload_slots(file_id);
create index clinical_upload_slot_expiry on public.clinical_upload_slots(expires_at);
alter table public.clinical_storage_budget enable row level security;
alter table public.clinical_upload_slots enable row level security;
revoke all on public.clinical_storage_budget,public.clinical_upload_slots from public,anon,authenticated,service_role;
grant select on public.clinical_storage_budget,public.clinical_upload_slots to service_role;

create function private.clinical_budget_lock() returns void language sql volatile set search_path=pg_catalog as $$ select pg_advisory_xact_lock(hashtextextended('cita:project:storage-budget',0)); $$;
create function private.reserve_clinical_document(p_file_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare file public.patient_radiographs%rowtype; path_value text; additional bigint:=0; released bigint; slot public.clinical_upload_slots%rowtype;
begin
 perform private.clinical_budget_lock();
 select * into file from public.patient_radiographs where id=p_file_id;
 if not found or file.status<>'uploading' then return; end if;
 perform private.release_expired_clinical_reservations();
 foreach path_value in array array_remove(array[file.storage_path,file.thumbnail_path],null) loop
  select * into slot from public.clinical_upload_slots where bucket=file.storage_bucket and path=path_value;
  if exists(select 1 from storage.objects where bucket_id=file.storage_bucket and name=path_value and coalesce((metadata->>'size')::bigint,0)>0) then continue;end if;
  if slot.path is null then additional:=additional+5000000;end if;
  insert into public.clinical_upload_slots(bucket,path,file_id,expires_at,reserved_bytes) values(file.storage_bucket,path_value,file.id,clock_timestamp()+interval '2 hours 15 minutes',5000000)
  on conflict(bucket,path) do update set expires_at=excluded.expires_at;
 end loop;
 if exists(select 1 from public.clinical_storage_budget where singleton and used_bytes+reserved_bytes+additional>max_bytes) then raise exception 'CLINICAL_STORAGE_QUOTA';end if;
 update public.clinical_storage_budget set reserved_bytes=reserved_bytes+additional,updated_at=clock_timestamp() where singleton;
 if file.source='patient' and (
   (select coalesce(sum(coalesce((o.metadata->>'size')::bigint,0)),0) from public.patient_radiographs f join storage.objects o on o.bucket_id=f.storage_bucket and (o.name=f.storage_path or o.name=f.thumbnail_path) where f.appointment_id=file.appointment_id and f.source='patient')+
   (select coalesce(sum(f.bytes),0) from public.patient_radiographs f where f.appointment_id=file.appointment_id and f.source='patient' and f.status='uploading' and exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id and s.expires_at>clock_timestamp()) and not exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name=f.storage_path))>10000000
 ) then raise exception 'CLINICAL_PATIENT_QUOTA';end if;
end $$;

create function private.track_storage_budget() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare old_bytes bigint:=0;new_bytes bigint:=0;released bigint:=0;slot public.clinical_upload_slots%rowtype;file public.patient_radiographs%rowtype;
begin
 perform private.clinical_budget_lock();
 if tg_op<>'INSERT' and old.metadata->>'size' ~ '^[0-9]{1,18}$' then old_bytes:=(old.metadata->>'size')::bigint;end if;
 if tg_op<>'DELETE' and new.metadata->>'size' ~ '^[0-9]{1,18}$' then new_bytes:=(new.metadata->>'size')::bigint;end if;
 if tg_op<>'DELETE' then
  if new.bucket_id='patient-clinical-files' and ((octet_length(coalesce(to_jsonb(new)->'user_metadata','{}'::jsonb)::text)>4096 and (tg_op='INSERT' or (to_jsonb(new)->'user_metadata') is distinct from (to_jsonb(old)->'user_metadata'))) or (octet_length(coalesce(new.metadata,'{}'::jsonb)::text)>4096 and (tg_op='INSERT' or new.metadata is distinct from old.metadata))) then raise exception 'CLINICAL_DOCUMENT_METADATA_TOO_LARGE';end if;
  if new.bucket_id='patient-clinical-files' and new_bytes>5000000 and new_bytes>old_bytes then raise exception 'RADIOGRAPH_SIZE_INVALID';end if;
  select * into slot from public.clinical_upload_slots where bucket=new.bucket_id and path=new.name;
  select * into file from public.patient_radiographs f where f.storage_bucket=new.bucket_id and (f.storage_path=new.name or f.thumbnail_path=new.name);
  if found then
   if file.status='failed' and new_bytes>0 then raise exception 'CLINICAL_UPLOAD_CLOSED';end if;
   if file.source='patient' and (select coalesce(sum(coalesce((o.metadata->>'size')::bigint,0)),0) from public.patient_radiographs f join storage.objects o on o.bucket_id=f.storage_bucket and (o.name=f.storage_path or o.name=f.thumbnail_path) where f.appointment_id=file.appointment_id and f.source='patient')-old_bytes+new_bytes>10000000 then raise exception 'CLINICAL_PATIENT_QUOTA';end if;
  end if;
  if new_bytes>0 and slot.path is not null then
   if new_bytes>5000000 then raise exception 'RADIOGRAPH_SIZE_INVALID';end if;
   select * into file from public.patient_radiographs where id=slot.file_id;
   released:=slot.reserved_bytes;update public.clinical_upload_slots set reserved_bytes=0 where bucket=slot.bucket and path=slot.path;
  end if;
 end if;
 if tg_op='DELETE' then
  select * into slot from public.clinical_upload_slots where bucket=old.bucket_id and path=old.name and expires_at>clock_timestamp();
  if slot.path is not null then released:=slot.reserved_bytes-5000000;update public.clinical_upload_slots set reserved_bytes=5000000 where bucket=slot.bucket and path=slot.path;end if;
 end if;
 if exists(select 1 from public.clinical_storage_budget where singleton and used_bytes-old_bytes+new_bytes+reserved_bytes-released>max_bytes) and new_bytes>old_bytes then raise exception 'CLINICAL_STORAGE_QUOTA';end if;
 update public.clinical_storage_budget set used_bytes=used_bytes-old_bytes+new_bytes,reserved_bytes=reserved_bytes-released,updated_at=clock_timestamp() where singleton;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger cita_storage_budget before insert or update or delete on storage.objects for each row execute function private.track_storage_budget();

create function public.get_clinical_storage_budget(p_business_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) then raise exception 'RADIOGRAPH_ACCESS_DENIED';end if;
 perform private.release_expired_clinical_reservations();
 return (select jsonb_build_object('database_bytes',pg_database_size(current_database()),'monthly_authorized_download_bytes',(select coalesce(sum(case when metadata->>'bytes' ~ '^[0-9]{1,18}$' then (metadata->>'bytes')::bigint else 0 end),0) from public.audit_logs where action='radiograph.original_access_granted' and created_at>=date_trunc('month',statement_timestamp() at time zone 'UTC') at time zone 'UTC'),'used_bytes',used_bytes,'reserved_bytes',reserved_bytes,'max_bytes',max_bytes,'percentage',round(100.0*(used_bytes+reserved_bytes)/max_bytes,1)) from public.clinical_storage_budget where singleton);
end $$;

create function public.begin_public_patient_document_upload(p_token text,p_request_id uuid,p_filename text,p_mime text,p_bytes bigint,p_sha256 text,p_note text default null)
returns public.patient_radiographs language plpgsql security definer set search_path=pg_catalog as $$
declare appointment public.appointments%rowtype;file public.patient_radiographs%rowtype;extension text;
begin
 perform private.require_clinical_file_service_call();perform private.clinical_budget_lock();
 appointment:=private.booking_information_appointment(p_token);
 if not coalesce((select patient_documents_enabled from public.businesses where id=appointment.business_id),false) then raise exception 'CLINICAL_PATIENT_DOCUMENTS_DISABLED';end if;
 perform 1 from public.appointments where id=appointment.id for update;
 appointment:=private.booking_information_appointment(p_token);
 if p_request_id is null or not coalesce(p_mime in ('image/jpeg','image/png','application/pdf'),false) or not coalesce(p_bytes between 1 and 5000000,false) or not coalesce(p_sha256 ~ '^[0-9a-f]{64}$',false) or coalesce(length(trim(p_filename)),0) not between 1 and 160 or p_filename ~ '[\\/]' or length(coalesce(p_note,''))>500 then raise exception 'RADIOGRAPH_UPLOAD_INVALID';end if;
 select * into file from public.patient_radiographs f where f.appointment_id=appointment.id and f.source='patient' and f.client_request_id=p_request_id;
 if found then
  if file.mime_type<>p_mime or file.bytes<>p_bytes or file.sha256<>p_sha256 then raise exception 'RADIOGRAPH_REQUEST_CONFLICT';end if;
  perform private.reserve_clinical_document(file.id);return file;
 end if;
 if (select count(*) from public.patient_radiographs f where f.appointment_id=appointment.id and f.source='patient' and (f.status in ('ready','trashed') or f.created_at>clock_timestamp()-interval '2 hours 15 minutes'))>=3 then raise exception 'CLINICAL_PATIENT_QUOTA';end if;
 extension:=case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' else 'jpg' end;
 file.id:=gen_random_uuid();
 insert into public.patient_radiographs(id,business_id,patient_id,source,appointment_id,status,storage_provider,storage_bucket,storage_path,integrity_status,client_request_id,original_filename,mime_type,bytes,sha256,note)
 values(file.id,appointment.business_id,appointment.patient_id,'patient',appointment.id,'uploading','supabase_storage','patient-clinical-files',appointment.business_id::text||'/'||appointment.patient_id::text||'/'||file.id::text||'/original.'||extension,'unchecked',p_request_id,trim(p_filename),p_mime,p_bytes,p_sha256,nullif(trim(p_note),'')) returning * into file;
 perform private.reserve_clinical_document(file.id);
 insert into public.audit_logs(business_id,action,entity_type,entity_id,metadata) values(appointment.business_id,'clinical_document.patient_upload_started','patient_radiograph',file.id,jsonb_build_object('appointment_id',appointment.id,'bytes',p_bytes));
 return file;
end $$;

create function public.get_public_patient_document_upload(p_token text,p_file_id uuid) returns public.patient_radiographs language plpgsql security definer set search_path=pg_catalog as $$
declare appointment public.appointments%rowtype;file public.patient_radiographs%rowtype;
begin
 perform private.require_clinical_file_service_call();
 select ap.* into appointment from public.appointments ap
 join public.appointment_patient_information_contexts c on c.appointment_id=ap.id and c.business_id=ap.business_id and c.patient_id_snapshot=ap.patient_id
 join public.patients p on p.id=ap.patient_id and p.business_id=ap.business_id
 join public.businesses b on b.id=ap.business_id
 where ap.confirmation_token=p_token and ap.status in ('reserved','confirmed','reschedule_requested') and p.archived_at is null and b.is_active and public.business_allows_operation(ap.business_id);
 if not found then raise exception 'BOOKING_INFORMATION_UNAVAILABLE';end if;
 select * into file from public.patient_radiographs where id=p_file_id and appointment_id=appointment.id and business_id=appointment.business_id and patient_id=appointment.patient_id and source='patient' and status in ('uploading','ready');
 if not found then raise exception 'RADIOGRAPH_NOT_FOUND';end if;
 if appointment.starts_at<=statement_timestamp() and not exists(select 1 from public.clinical_upload_slots where file_id=file.id and expires_at>clock_timestamp()) and not(file.status='ready' and file.ready_at>clock_timestamp()-interval '15 minutes') then raise exception 'BOOKING_INFORMATION_UNAVAILABLE';end if;
 return file;
end $$;
create function public.complete_public_patient_document_upload(p_token text,p_file_id uuid,p_bytes bigint,p_mime text) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare file public.patient_radiographs%rowtype;
begin
 file:=public.get_public_patient_document_upload(p_token,p_file_id);
 perform 1 from public.patient_radiographs where id=file.id for update;
 file:=public.get_public_patient_document_upload(p_token,p_file_id);
 if file.status='ready' then return file.id;end if;
 if file.bytes is distinct from p_bytes or file.mime_type is distinct from p_mime then raise exception 'RADIOGRAPH_OBJECT_MISMATCH';end if;
 update public.patient_radiographs set status='ready',ready_at=clock_timestamp(),integrity_status='ok' where id=file.id;
 update public.patients set activity_at=greatest(coalesce(activity_at,created_at),clock_timestamp()) where id=file.patient_id and business_id=file.business_id;
 insert into public.audit_logs(business_id,action,entity_type,entity_id,metadata) values(file.business_id,'clinical_document.patient_upload_completed','patient_radiograph',file.id,jsonb_build_object('bytes',file.bytes,'mime_type',file.mime_type,'appointment_id',file.appointment_id));
 return file.id;
end $$;
revoke all on function private.clinical_budget_lock(),private.reserve_clinical_document(uuid),private.track_storage_budget() from public,anon,authenticated,service_role;
revoke all on function public.get_clinical_storage_budget(uuid),public.begin_public_patient_document_upload(text,uuid,text,text,bigint,text,text),public.get_public_patient_document_upload(text,uuid),public.complete_public_patient_document_upload(text,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.get_clinical_storage_budget(uuid) to authenticated;
grant execute on function public.begin_public_patient_document_upload(text,uuid,text,text,bigint,text,text),public.get_public_patient_document_upload(text,uuid),public.complete_public_patient_document_upload(text,uuid,bigint,text) to service_role;

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
 perform private.clinical_budget_lock();
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
	if not coalesce(p_mime_type in ('image/jpeg', 'image/png','application/pdf'),false) then
		raise exception 'RADIOGRAPH_FORMAT_INVALID';
	end if;
	if p_bytes is null or p_bytes < 1 or p_bytes > 5000000 then
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

        perform private.reserve_clinical_document(v_existing.id);
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
	v_extension := case p_mime_type when 'image/jpeg' then 'jpg' when 'application/pdf' then 'pdf' else 'png' end;

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
		case when p_mime_type='application/pdf' then null else p_business_id::text || '/' || p_patient_id::text || '/' || v_id::text || '/thumbnail.webp' end,
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

    perform private.reserve_clinical_document(v_id);
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
create function public.claim_expired_clinical_uploads(p_business_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare ids uuid[];
begin
 perform private.require_clinical_file_service_call();perform private.clinical_budget_lock();
 if not coalesce(private.clinical_file_actor_business_role(p_business_id,p_actor_id) in ('owner','admin'),false) then raise exception 'RADIOGRAPH_ACCESS_DENIED';end if;
 perform private.release_expired_clinical_reservations();
 select array_agg(id) into ids from (select f.id from public.patient_radiographs f where f.business_id=p_business_id and f.storage_provider='supabase_storage' and f.status in ('uploading','failed') and f.created_at<clock_timestamp()-interval '2 hours 15 minutes' and (exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name in (f.storage_path,f.thumbnail_path)) or exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id)) and not exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id and s.expires_at>clock_timestamp()) order by f.created_at limit 30 for update) candidates;
 update public.patient_radiographs set status='failed',failure_code='expired_upload' where id=any(ids);
 return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'bucket',f.storage_bucket,'paths',array_remove(array[f.storage_path,f.thumbnail_path],null))) from public.patient_radiographs f where f.id=any(ids)),'[]'::jsonb)||coalesce((select jsonb_agg(jsonb_build_object('id',unused.id,'bucket',unused.bucket,'paths',unused.paths)) from (select f.id,s.bucket,array_agg(s.path) as paths from public.clinical_upload_slots s join public.patient_radiographs f on f.id=s.file_id join storage.objects o on o.bucket_id=s.bucket and o.name=s.path where f.business_id=p_business_id and f.status='ready' and s.expires_at<=clock_timestamp() and s.path<>f.storage_path and s.path is distinct from f.thumbnail_path group by f.id,s.bucket limit 30) unused),'[]'::jsonb);
end $$;
revoke all on function public.claim_expired_clinical_uploads(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_expired_clinical_uploads(uuid,uuid) to service_role;

create function private.release_expired_clinical_reservations() returns void language plpgsql security definer set search_path=pg_catalog as $$
declare released bigint;
begin
 perform private.clinical_budget_lock();
 select coalesce(sum(reserved_bytes),0) into released from public.clinical_upload_slots where expires_at<=clock_timestamp();
 update public.clinical_upload_slots set reserved_bytes=0 where expires_at<=clock_timestamp();
 update public.clinical_storage_budget set reserved_bytes=reserved_bytes-released,updated_at=clock_timestamp() where singleton;
 delete from public.clinical_upload_slots s where s.expires_at<=clock_timestamp() and not exists(select 1 from storage.objects o where o.bucket_id=s.bucket and o.name=s.path);
end $$;
revoke all on function private.release_expired_clinical_reservations() from public,anon,authenticated,service_role;
create function public.patient_document_in_appointment_scope(p_business_id uuid,p_appointment_id uuid,p_actor_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select (coalesce(auth.role(),'')='service_role' or p_actor_id=auth.uid()) and (coalesce(private.clinical_file_actor_business_role(p_business_id,p_actor_id) in ('owner','admin'),false) or exists(
 select 1 from public.appointment_professionals ap join public.professional_users pu on pu.business_id=ap.business_id and pu.professional_id=ap.professional_id
 join public.business_users bu on bu.business_id=pu.business_id and bu.user_id=pu.user_id
 where ap.business_id=p_business_id and ap.appointment_id=p_appointment_id and pu.user_id=p_actor_id and bu.status='active' and bu.role='professional'));
$$;
revoke all on function public.patient_document_in_appointment_scope(uuid,uuid,uuid) from public,anon;
grant execute on function public.patient_document_in_appointment_scope(uuid,uuid,uuid) to authenticated,service_role;
create policy patient_document_appointment_scope on public.patient_radiographs as restrictive for select to authenticated using(source<>'patient' or public.patient_document_in_appointment_scope(business_id,appointment_id,auth.uid()));
alter function public.grant_patient_radiograph_original_access(uuid,uuid,uuid,uuid) rename to grant_patient_radiograph_original_access_legacy;
revoke all on function public.grant_patient_radiograph_original_access_legacy(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.grant_patient_radiograph_original_access(p_actor_id uuid,p_business_id uuid,p_patient_id uuid,p_radiograph_id uuid)
returns table(storage_bucket text,storage_path text,original_filename text,mime_type text,bytes bigint) language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform private.require_clinical_file_service_call();
 if exists(select 1 from public.patient_radiographs f where f.id=p_radiograph_id and f.business_id=p_business_id and f.patient_id=p_patient_id and f.source='patient' and not public.patient_document_in_appointment_scope(f.business_id,f.appointment_id,p_actor_id)) then raise exception 'RADIOGRAPH_ACCESS_DENIED';end if;
 return query select * from public.grant_patient_radiograph_original_access_legacy(p_actor_id,p_business_id,p_patient_id,p_radiograph_id);
end $$;
revoke all on function public.grant_patient_radiograph_original_access(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.grant_patient_radiograph_original_access(uuid,uuid,uuid,uuid) to service_role;

commit;
