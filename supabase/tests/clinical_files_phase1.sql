-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/clinical_files_phase1.sql
--
-- Transactional phase 1 contract. It verifies authorization, lifecycle,
-- auditability, non-destructive retention and the absence of a Drive or
-- physical-delete surface. No fixture survives the rollback.

begin;

select extensions.plan(1);

create temp table clinical_files_test_state (
	key text primary key,
	value text not null
);
grant select, insert, update on table clinical_files_test_state to authenticated, service_role;

insert into auth.users (id, email)
values
	('10000000-0000-4000-8000-000000000001', 'phase1-owner@example.test'),
	('10000000-0000-4000-8000-000000000002', 'phase1-admin@example.test'),
	('10000000-0000-4000-8000-000000000003', 'phase1-linked@example.test'),
	('10000000-0000-4000-8000-000000000004', 'phase1-unlinked@example.test'),
	('10000000-0000-4000-8000-000000000005', 'phase1-reception@example.test'),
	('10000000-0000-4000-8000-000000000006', 'phase1-readonly@example.test'),
	('10000000-0000-4000-8000-000000000007', 'phase1-outsider@example.test'),
	('10000000-0000-4000-8000-000000000008', 'phase1-deleted-uploader@example.test');

insert into public.businesses (id, name, slug, industry)
values
	(
		'a0000000-0000-4000-8000-000000000001',
		'Consultorio fase 1',
		'phase1-clinical-files-' || gen_random_uuid()::text,
		'odontology'
	),
	(
		'b0000000-0000-4000-8000-000000000001',
		'Consultorio ajeno fase 1',
		'phase1-clinical-files-other-' || gen_random_uuid()::text,
		'odontology'
	);

update public.business_subscriptions
set
	commercial_access_enabled = true,
	is_permanent = true,
	subscription_status = 'active',
	paid_until = null,
	grace_until = null,
	restricted_until = null,
	archived_at = null
where business_id in (
	'a0000000-0000-4000-8000-000000000001',
	'b0000000-0000-4000-8000-000000000001'
);

insert into public.business_users (business_id, user_id, role, status, accepted_at)
values
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'admin', 'active', now()),
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'professional', 'active', now()),
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'professional', 'active', now()),
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'reception', 'active', now()),
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'readonly', 'active', now()),
	('b0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007', 'owner', 'active', now()),
	('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008', 'professional', 'active', now());

insert into public.professionals (id, business_id, name)
values
	('30000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Profesional vinculado'),
	('30000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Profesional no vinculado'),
	('30000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Profesional a eliminar');

insert into public.professional_users (business_id, professional_id, user_id)
values
	('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003'),
	('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004'),
	('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000008');

insert into public.patients (id, owner_id, business_id, full_name, dni, phone)
values
	(
		'20000000-0000-4000-8000-000000000001',
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'Paciente compartido',
		'30111222',
		'1130000001'
	),
	(
		'20000000-0000-4000-8000-000000000002',
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'Paciente sin vínculo',
		'30111223',
		'1130000002'
	),
	(
		'20000000-0000-4000-8000-000000000003',
		'10000000-0000-4000-8000-000000000007',
		'b0000000-0000-4000-8000-000000000001',
		'Paciente de otro consultorio',
		'30111224',
		'1130000003'
	);

insert into public.professional_patient_links (
	business_id,
	professional_id,
	patient_id,
	source,
	is_active,
	created_by
)
values
	(
		'a0000000-0000-4000-8000-000000000001',
		'30000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		'manual',
		true,
		'10000000-0000-4000-8000-000000000001'
	),
	(
		'a0000000-0000-4000-8000-000000000001',
		'30000000-0000-4000-8000-000000000003',
		'20000000-0000-4000-8000-000000000001',
		'manual',
		true,
		'10000000-0000-4000-8000-000000000001'
	);

-- The browser role cannot execute the control plane. The backend service role
-- supplies the already-authenticated actor explicitly.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
	v_denied boolean := false;
begin
	begin
		perform public.begin_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			'40000000-0000-4000-8000-000000000099',
			'directo.jpg', 'image/jpeg', 100, repeat('f', 64), null, null
		);
	exception when insufficient_privilege then
		v_denied := true;
	end;
	if not v_denied then
		raise exception 'TEST_BROWSER_ROLE_EXECUTED_CONTROL_PLANE';
	end if;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Failure is explicit, idempotent and audited exactly once. It remains a
-- server-side lifecycle mutation, not a browser-writable metadata shortcut.
do $$
declare
	v_upload record;
	v_count integer;
begin
	select * into v_upload
	from public.begin_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		'40000000-0000-4000-8000-000000000066',
		'carga fallida.jpg', 'image/jpeg', 100, repeat('6', 64), null, null
	);

	perform public.fail_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_upload.radiograph_id,
		'client_upload_failed'
	);
	perform public.fail_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_upload.radiograph_id,
		'client_upload_failed'
	);

	if not exists (
		select 1 from public.patient_radiographs
		where id = v_upload.radiograph_id
			and status = 'failed'
			and failure_code = 'client_upload_failed'
	) then
		raise exception 'TEST_FAIL_DID_NOT_REACH_FAILED_STATE';
	end if;
	select count(*)::integer into v_count
	from public.audit_logs
	where entity_id = v_upload.radiograph_id
		and action = 'radiograph.upload_failed';
	if v_count <> 1 then
		raise exception 'TEST_FAIL_AUDIT_NOT_IDEMPOTENT count=%', v_count;
	end if;
end;
$$;

-- Owner: begin is deterministic/idempotent and complete validates the object
-- facts supplied by the already-authorized server boundary.

do $$
declare
	v_first record;
	v_repeat record;
	v_count integer;
	v_denied boolean := false;
	v_future_denied boolean := false;
begin
	select * into v_first
		from public.begin_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		'40000000-0000-4000-8000-000000000001',
		'panoramica inicial.jpg',
		'image/jpeg',
		1024,
		repeat('a', 64),
		(statement_timestamp() at time zone 'America/Argentina/Cordoba')::date,
		'Imagen inicial'
	);

	if v_first.status <> 'uploading'
		or v_first.storage_bucket <> 'patient-clinical-files'
		or v_first.storage_path <> (
			'a0000000-0000-4000-8000-000000000001/' ||
			'20000000-0000-4000-8000-000000000001/' ||
			v_first.radiograph_id::text || '/original.jpg'
		)
		or v_first.thumbnail_path <> (
			'a0000000-0000-4000-8000-000000000001/' ||
			'20000000-0000-4000-8000-000000000001/' ||
			v_first.radiograph_id::text || '/thumbnail.webp'
		)
	then
		raise exception 'TEST_BEGIN_DID_NOT_CREATE_EXACT_PRIVATE_PATHS';
	end if;

	insert into clinical_files_test_state (key, value)
	values ('owner_file_id', v_first.radiograph_id::text);

	select * into v_repeat
		from public.begin_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		'40000000-0000-4000-8000-000000000001',
		'panoramica inicial.jpg',
		'image/jpeg',
		1024,
		repeat('a', 64),
		(statement_timestamp() at time zone 'America/Argentina/Cordoba')::date,
		'Imagen inicial'
	);
	if v_repeat.radiograph_id <> v_first.radiograph_id then
		raise exception 'TEST_BEGIN_IDEMPOTENCY_FAILED';
	end if;

	select count(*)::integer into v_count
	from public.patient_radiographs
	where business_id = 'a0000000-0000-4000-8000-000000000001'
		and uploaded_by = '10000000-0000-4000-8000-000000000001'
		and client_request_id = '40000000-0000-4000-8000-000000000001';
	if v_count <> 1 then
		raise exception 'TEST_BEGIN_CREATED_DUPLICATE_ROWS count=%', v_count;
	end if;

	begin
		perform public.begin_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			'40000000-0000-4000-8000-000000000088',
			'futura.jpg',
			'image/jpeg',
			1024,
			repeat('e', 64),
			(statement_timestamp() at time zone 'America/Argentina/Cordoba')::date + 1,
			null
		);
	exception when others then
		v_future_denied := position('RADIOGRAPH_DATE_INVALID' in sqlerrm) > 0;
	end;
	if not v_future_denied then
		raise exception 'TEST_BEGIN_ACCEPTED_FUTURE_BUSINESS_DATE';
	end if;

	begin
			perform public.complete_patient_radiograph_upload(
				'10000000-0000-4000-8000-000000000001',
				'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			v_first.radiograph_id,
			2048,
			'image/jpeg',
			false
		);
	exception when others then
		v_denied := position('RADIOGRAPH_OBJECT_MISMATCH' in sqlerrm) > 0;
	end;
	if not v_denied then
		raise exception 'TEST_COMPLETE_ACCEPTED_MISMATCHED_OBJECT';
	end if;

	perform public.complete_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_first.radiograph_id,
		1024,
		'image/jpeg',
		false
	);
	perform public.complete_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_first.radiograph_id,
		1024,
		'image/jpeg',
		false
	);

	if not exists (
		select 1 from public.patient_radiographs
		where id = v_first.radiograph_id
			and status = 'ready'
			and integrity_status = 'ok'
			and ready_at is not null
			and thumbnail_path is null
	) then
		raise exception 'TEST_COMPLETE_DID_NOT_REACH_VERIFIED_READY';
	end if;

	select count(*)::integer into v_count
	from public.audit_logs
	where entity_id = v_first.radiograph_id
		and action = 'radiograph.upload_completed';
	if v_count <> 1 then
		raise exception 'TEST_COMPLETE_AUDIT_NOT_IDEMPOTENT count=%', v_count;
	end if;
end;
$$;

-- A linked professional can read metadata uploaded by another person.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	select count(*)::integer into v_count
	from public.patient_radiographs
	where id = v_file_id;
	if v_count <> 1 then
		raise exception 'TEST_LINKED_PROFESSIONAL_CANNOT_READ_SHARED_FILE';
	end if;
end;
$$;


-- The server can grant that professional a short-lived original URL after
-- resolving the same patient permission for the explicit actor.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_access record;
begin
	select * into v_access
	from public.grant_patient_radiograph_original_access(
		'10000000-0000-4000-8000-000000000003',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_file_id
	);
	if v_access.storage_bucket <> 'patient-clinical-files'
		or v_access.storage_path is null
		or v_access.bytes <> 1024
	then
		raise exception 'TEST_LINKED_PROFESSIONAL_ACCESS_GRANT_INVALID';
	end if;
end;
$$;

-- A professional without a patient link cannot discover the file through RLS.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	select count(*)::integer into v_count from public.patient_radiographs where id = v_file_id;
	if v_count <> 0 then
		raise exception 'TEST_UNLINKED_PROFESSIONAL_DISCOVERED_FILE';
	end if;
end;
$$;


-- The server-side permission resolver rejects that same actor.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
	v_denied boolean := false;
begin
	begin
		perform public.begin_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000004',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			'40000000-0000-4000-8000-000000000002',
			'unlinked.jpg', 'image/jpeg', 100, repeat('b', 64), null, null
		);
	exception when others then
		v_denied := position('RADIOGRAPH_ACCESS_DENIED' in sqlerrm) > 0;
	end;
	if not v_denied then
		raise exception 'TEST_UNLINKED_PROFESSIONAL_STARTED_UPLOAD';
	end if;
end;
$$;

-- Reception, readonly and another business cannot discover clinical metadata.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	select count(*)::integer into v_count from public.patient_radiographs where id = v_file_id;
	if v_count <> 0 then raise exception 'TEST_RECEPTION_DISCOVERED_FILE'; end if;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_denied boolean := false;
begin
	begin
		perform public.grant_patient_radiograph_original_access(
			'10000000-0000-4000-8000-000000000005',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			v_file_id
		);
	exception when others then
		v_denied := position('RADIOGRAPH_ACCESS_DENIED' in sqlerrm) > 0;
	end;
	if not v_denied then raise exception 'TEST_RECEPTION_RECEIVED_ORIGINAL_ACCESS'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	select count(*)::integer into v_count from public.patient_radiographs where id = v_file_id;
	if v_count <> 0 then raise exception 'TEST_READONLY_DISCOVERED_FILE'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	select count(*)::integer into v_count from public.patient_radiographs where id = v_file_id;
	if v_count <> 0 then raise exception 'TEST_CROSS_BUSINESS_FILE_LEAK'; end if;
end;
$$;

-- A professional cannot trash. Admin can trash and restore; both operations
-- are idempotent and never touch storage.objects.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_denied boolean := false;
begin
	begin
		perform public.trash_patient_radiograph(
			'10000000-0000-4000-8000-000000000003',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			v_file_id
		);
	exception when others then
		v_denied := position('RADIOGRAPH_TRASH_DENIED' in sqlerrm) > 0;
	end;
	if not v_denied then raise exception 'TEST_PROFESSIONAL_TRASHED_FILE'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	if not exists (
		select 1 from public.audit_logs
		where entity_id = v_file_id
			and user_id = '10000000-0000-4000-8000-000000000003'
			and action = 'radiograph.original_access_granted'
	) then
		raise exception 'TEST_ORIGINAL_ACCESS_NOT_AUDITED';
	end if;

	perform public.trash_patient_radiograph(
		'10000000-0000-4000-8000-000000000002',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_file_id
	);
	perform public.trash_patient_radiograph(
		'10000000-0000-4000-8000-000000000002',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_file_id
	);

	if not exists (
		select 1 from public.patient_radiographs
		where id = v_file_id
			and status = 'trashed'
			and deleted_by = '10000000-0000-4000-8000-000000000002'
	) then
		raise exception 'TEST_ADMIN_TRASH_STATE_INVALID';
	end if;
	select count(*)::integer into v_count from public.audit_logs
	where entity_id = v_file_id and action = 'radiograph.trashed';
	if v_count <> 1 then raise exception 'TEST_TRASH_AUDIT_NOT_IDEMPOTENT count=%', v_count; end if;

	perform public.restore_patient_radiograph(
		'10000000-0000-4000-8000-000000000002',
		'a0000000-0000-4000-8000-000000000001', v_file_id
	);
	perform public.restore_patient_radiograph(
		'10000000-0000-4000-8000-000000000002',
		'a0000000-0000-4000-8000-000000000001', v_file_id
	);
	if not exists (
		select 1 from public.patient_radiographs
		where id = v_file_id
			and status = 'ready'
			and deleted_at is null
			and restored_by = '10000000-0000-4000-8000-000000000002'
	) then
		raise exception 'TEST_ADMIN_RESTORE_STATE_INVALID';
	end if;
	select count(*)::integer into v_count from public.audit_logs
	where entity_id = v_file_id and action = 'radiograph.restored';
	if v_count <> 1 then raise exception 'TEST_RESTORE_AUDIT_NOT_IDEMPOTENT count=%', v_count; end if;
end;
$$;

-- During the commercial restricted-read window, owner/admin retain access to
-- existing clinical files. Professionals and every mutation remain blocked
-- until the consultorio returns to active/grace operation.
reset role;

-- Leave one legitimate upload pending before restriction so every lifecycle
-- endpoint can be checked against the commercial boundary.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
	v_upload record;
begin
	select * into v_upload
	from public.begin_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		'40000000-0000-4000-8000-000000000076',
		'pendiente antes de restriccion.jpg',
		'image/jpeg', 100, repeat('7', 64), null, null
	);
	insert into clinical_files_test_state (key, value)
	values ('restricted_pending_file_id', v_upload.radiograph_id::text);
end;
$$;

reset role;
update public.business_subscriptions
set
	is_permanent = false,
	subscription_status = 'restricted',
	paid_until = now() - interval '3 days',
	grace_until = now() - interval '1 day',
	restricted_until = now() + interval '10 days',
	archived_at = null,
	commercial_access_enabled = true
where business_id = 'a0000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_count integer;
begin
	select count(*)::integer into v_count
	from public.patient_radiographs
	where id = v_file_id and status = 'ready';
	if v_count <> 1 then
		raise exception 'TEST_RESTRICTED_OWNER_CANNOT_READ_EXISTING_FILE';
	end if;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_access record;
	v_upload_denied boolean := false;
	v_fail_denied boolean := false;
	v_trash_denied boolean := false;
	v_professional_denied boolean := false;
begin
	select * into v_access
	from public.grant_patient_radiograph_original_access(
		'10000000-0000-4000-8000-000000000001',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_file_id
	);
	if v_access.storage_path is null then
		raise exception 'TEST_RESTRICTED_OWNER_ACCESS_GRANT_INVALID';
	end if;

	begin
		perform public.begin_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			'40000000-0000-4000-8000-000000000077',
			'restricted.jpg', 'image/jpeg', 100, repeat('d', 64), null, null
		);
	exception when others then
		v_upload_denied := position('BUSINESS_ACCESS_RESTRICTED' in sqlerrm) > 0;
	end;
	if not v_upload_denied then
		raise exception 'TEST_RESTRICTED_OWNER_STARTED_UPLOAD';
	end if;

	begin
		perform public.fail_patient_radiograph_upload(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			(select value::uuid from clinical_files_test_state where key = 'restricted_pending_file_id'),
			'client_upload_failed'
		);
	exception when others then
		v_fail_denied := position('BUSINESS_ACCESS_RESTRICTED' in sqlerrm) > 0;
	end;
	if not v_fail_denied then
		raise exception 'TEST_RESTRICTED_OWNER_MARKED_UPLOAD_FAILED';
	end if;

	begin
		perform public.trash_patient_radiograph(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			v_file_id
		);
	exception when others then
		v_trash_denied := position('RADIOGRAPH_TRASH_DENIED' in sqlerrm) > 0;
	end;
	if not v_trash_denied then
		raise exception 'TEST_RESTRICTED_OWNER_TRASHED_FILE';
	end if;

	begin
		perform public.grant_patient_radiograph_original_access(
			'10000000-0000-4000-8000-000000000003',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			v_file_id
		);
	exception when others then
		v_professional_denied := position('RADIOGRAPH_ACCESS_DENIED' in sqlerrm) > 0;
	end;
	if not v_professional_denied then
		raise exception 'TEST_RESTRICTED_PROFESSIONAL_RECEIVED_FILE';
	end if;
end;
$$;

reset role;
update public.business_subscriptions
set
	is_permanent = true,
	subscription_status = 'active',
	paid_until = null,
	grace_until = null,
	restricted_until = null,
	archived_at = null,
	commercial_access_enabled = true
where business_id = 'a0000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- A second professional uploads a verified file. Deleting that auth account
-- must null actor references while retaining both metadata and audit history.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);
do $$
declare
	v_upload record;
begin
	select * into v_upload
	from public.begin_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000008',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		'40000000-0000-4000-8000-000000000008',
		'archivo retenido.png', 'image/png', 2048, repeat('c', 64), null, null
	);
	perform public.complete_patient_radiograph_upload(
		'10000000-0000-4000-8000-000000000008',
		'a0000000-0000-4000-8000-000000000001',
		'20000000-0000-4000-8000-000000000001',
		v_upload.radiograph_id,
		2048,
		'image/png',
		false
	);
	insert into clinical_files_test_state (key, value)
	values ('deleted_uploader_file_id', v_upload.radiograph_id::text);
end;
$$;

reset role;
delete from auth.users where id = '10000000-0000-4000-8000-000000000008';

do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'deleted_uploader_file_id');
begin
	if not exists (
		select 1 from public.patient_radiographs
		where id = v_file_id
			and status = 'ready'
			and owner_id is null
			and created_by is null
			and uploaded_by is null
	) then
		raise exception 'TEST_DELETING_UPLOADER_REMOVED_OR_OWNED_FILE';
	end if;
	if not exists (
		select 1 from public.audit_logs
		where entity_id = v_file_id
			and action = 'radiograph.upload_completed'
			and user_id is null
	) then
		raise exception 'TEST_DELETING_UPLOADER_REMOVED_AUDIT';
	end if;
end;
$$;

-- Historical Drive rows remain inert for traceability and are invisible to
-- authenticated application users, including their historical owner.
insert into public.patient_radiographs (
	id, owner_id, business_id, patient_id, status, drive_file_id,
	original_filename, storage_provider, created_by
)
values (
	'50000000-0000-4000-8000-000000000001',
	'10000000-0000-4000-8000-000000000001',
	'a0000000-0000-4000-8000-000000000001',
	'20000000-0000-4000-8000-000000000001',
	'ready',
	'legacy-test-file',
	'legacy.jpg',
	'google_drive_legacy',
	'10000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
	v_count integer;
begin
	select count(*)::integer into v_count
	from public.patient_radiographs
	where id = '50000000-0000-4000-8000-000000000001';
	if v_count <> 0 then raise exception 'TEST_LEGACY_DRIVE_ROW_IS_OPERATIONALLY_VISIBLE'; end if;
end;
$$;

-- There is no authenticated mutation control plane, physical-delete route or
-- usable Drive function.
do $$
begin
	if exists (
		select 1
		from pg_catalog.pg_policy policy
		where policy.polrelid = 'public.patient_radiographs'::regclass
			and policy.polcmd <> 'r'
	) then
		raise exception 'TEST_RADIOGRAPH_MUTATION_RLS_POLICY_REMAINS';
	end if;
	if has_table_privilege('authenticated', 'public.patient_radiographs', 'INSERT')
		or has_table_privilege('authenticated', 'public.patient_radiographs', 'UPDATE')
		or has_table_privilege('authenticated', 'public.patient_radiographs', 'DELETE')
	then
		raise exception 'TEST_AUTHENTICATED_HAS_DIRECT_RADIOGRAPH_MUTATION_PRIVILEGE';
	end if;
	if has_function_privilege(
		'authenticated',
		'public.begin_patient_radiograph_upload(uuid,uuid,uuid,uuid,text,text,bigint,text,date,text)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.complete_patient_radiograph_upload(uuid,uuid,uuid,uuid,bigint,text,boolean)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.fail_patient_radiograph_upload(uuid,uuid,uuid,uuid,text)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.trash_patient_radiograph(uuid,uuid,uuid,uuid)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.restore_patient_radiograph(uuid,uuid,uuid)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.grant_patient_radiograph_original_access(uuid,uuid,uuid,uuid)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.get_clinical_file_daily_transfer_estimates(date)',
		'EXECUTE'
	) then
		raise exception 'TEST_AUTHENTICATED_CAN_EXECUTE_CONTROL_PLANE';
	end if;
	if has_function_privilege(
		'authenticated',
		'public.set_patient_drive_folder_safely(uuid,uuid,text)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.get_patient_drive_folder_safely(uuid,uuid)',
		'EXECUTE'
	) or has_function_privilege(
		'authenticated',
		'public.clear_patient_drive_folders_safely(uuid)',
		'EXECUTE'
	) then
		raise exception 'TEST_AUTHENTICATED_CAN_USE_LEGACY_DRIVE_RPC';
	end if;
end;
$$;

reset role;

-- Reconciliation fails closed: missing objects become inaccessible and a row
-- merely reappearing in storage.objects does not automatically restore trust.
do $$
declare
	v_owner_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_deleted_uploader_file_id uuid := (
		select value::uuid from clinical_files_test_state where key = 'deleted_uploader_file_id'
	);
	v_changed integer;
	v_marked integer;
begin
	v_changed := private.reconcile_patient_radiograph_integrity();
	if v_changed <> 2 then
		raise exception 'TEST_RECONCILIATION_EXPECTED_2_MISSING_GOT_%', v_changed;
	end if;
	select count(*)::integer into v_marked
	from public.patient_radiographs
	where id in (v_owner_file_id, v_deleted_uploader_file_id)
		and integrity_status = 'missing';
	if v_marked <> 2 then
		raise exception 'TEST_RECONCILIATION_DID_NOT_MARK_ALL_MISSING';
	end if;
	if (
		select count(*) from public.audit_logs
		where entity_id in (v_owner_file_id, v_deleted_uploader_file_id)
			and action = 'radiograph.integrity_missing'
	) <> 2 then
		raise exception 'TEST_RECONCILIATION_MISSING_AUDIT_INVALID';
	end if;

	insert into storage.objects (bucket_id, name, metadata)
	select storage_bucket, storage_path, jsonb_build_object('mimetype', mime_type, 'size', bytes)
	from public.patient_radiographs
	where id = v_owner_file_id;

	v_changed := private.reconcile_patient_radiograph_integrity();
	if v_changed <> 0 or not exists (
		select 1 from public.patient_radiographs
		where id = v_owner_file_id and integrity_status = 'missing'
	) then
		raise exception 'TEST_REAPPEARED_OBJECT_WAS_TRUSTED_WITHOUT_VERIFICATION';
	end if;
end;
$$;

set local role service_role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
	v_file_id uuid := (select value::uuid from clinical_files_test_state where key = 'owner_file_id');
	v_denied boolean := false;
begin
	begin
		perform public.grant_patient_radiograph_original_access(
			'10000000-0000-4000-8000-000000000001',
			'a0000000-0000-4000-8000-000000000001',
			'20000000-0000-4000-8000-000000000001',
			v_file_id
		);
	exception when others then
		v_denied := position('RADIOGRAPH_INTEGRITY_INVALID' in sqlerrm) > 0;
	end;
	if not v_denied then raise exception 'TEST_MISSING_FILE_RECEIVED_ACCESS_GRANT'; end if;
end;
$$;

-- Transfer thresholds are a server-only operational estimate. They must never
-- become a browser-readable usage oracle or an authorization decision.
do $$
declare
	v_local_day date := (
		statement_timestamp() at time zone 'America/Argentina/Cordoba'
	)::date;
	v_estimate record;
begin
	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		metadata,
		created_at
	)
	values (
		'a0000000-0000-4000-8000-000000000001',
		'10000000-0000-4000-8000-000000000001',
		'radiograph.original_access_granted',
		'patient_radiograph',
		(select value::uuid from clinical_files_test_state where key = 'owner_file_id'),
		'success',
		jsonb_build_object('bytes', 2147483648::bigint),
		statement_timestamp()
	);

	select estimate.*
	into v_estimate
	from public.get_clinical_file_daily_transfer_estimates(v_local_day) estimate
	where estimate.business_id = 'a0000000-0000-4000-8000-000000000001';

	if not found then
		raise exception 'TEST_TRANSFER_ESTIMATE_MISSING';
	end if;
	if v_estimate.local_day <> v_local_day
		or v_estimate.original_access_events < 1
		or v_estimate.original_access_bytes < 2147483648::bigint
		or v_estimate.estimated_transfer_bytes < 2147483648::bigint
		or v_estimate.threshold_level <> 'watch_2gb'
	then
		raise exception 'TEST_TRANSFER_ESTIMATE_INVALID:%', row_to_json(v_estimate);
	end if;
end;
$$;

reset role;
do $$
begin
	if not exists (
		select 1 from storage.buckets
		where id = 'patient-clinical-files'
			and public = false
			and file_size_limit = 5000000
			and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp','application/pdf']::text[]
	) then
		raise exception 'TEST_PRIVATE_BUCKET_CONFIGURATION_INVALID';
	end if;

	if exists (
		select 1 from pg_policies
		where schemaname = 'storage'
			and tablename = 'objects'
			and (
				coalesce(qual, '') like '%patient-clinical-files%'
				or coalesce(with_check, '') like '%patient-clinical-files%'
			)
	) then
		raise exception 'TEST_CLIENT_STORAGE_POLICY_EXISTS_FOR_CLINICAL_BUCKET';
	end if;

	if exists (
		select 1 from pg_proc procedure
		join pg_namespace namespace on namespace.oid = procedure.pronamespace
		where namespace.nspname in ('public', 'private')
			and procedure.proname ~ '(delete|purge).*radiograph|radiograph.*(delete|purge)'
	) then
		raise exception 'TEST_PHYSICAL_DELETE_OR_PURGE_FUNCTION_EXISTS';
	end if;
end;
$$;

-- A patient with a ready clinical file cannot be physically removed and thus
-- cannot cascade-delete the file metadata.
do $$
declare
	v_denied boolean := false;
begin
	begin
		delete from public.patients where id = '20000000-0000-4000-8000-000000000001';
	exception when foreign_key_violation then
		v_denied := true;
	end;
	if not v_denied then raise exception 'TEST_PATIENT_DELETE_REMOVED_CLINICAL_FILES'; end if;
end;
$$;

do $$
begin
	raise notice 'PASS: clinical files phase 1 authorization, lifecycle, retention, integrity and legacy isolation.';
end;
$$;

select extensions.pass('clinical files phase 1 contract');
select * from extensions.finish();

rollback;
