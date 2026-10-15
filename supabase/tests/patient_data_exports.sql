-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/patient_data_exports.sql
--
-- Transactional contract for the server-only patient export control plane.
-- It leaves no fixture behind.

begin;

select extensions.plan(1);

create temp table patient_export_test_state (
	key text primary key,
	value text not null
);
grant select, insert, update, delete on table patient_export_test_state to service_role;

insert into auth.users (id, email)
values
	('71000000-0000-4000-8000-000000000001', 'export-owner@example.test'),
	('71000000-0000-4000-8000-000000000002', 'export-admin@example.test'),
	('71000000-0000-4000-8000-000000000003', 'export-professional@example.test'),
	('71000000-0000-4000-8000-000000000004', 'export-reception@example.test'),
	('71000000-0000-4000-8000-000000000005', 'export-assistance@example.test'),
	('71000000-0000-4000-8000-000000000006', 'export-pending@example.test'),
	('71000000-0000-4000-8000-000000000007', 'export-disabled@example.test'),
	('71000000-0000-4000-8000-000000000008', 'export-outsider@example.test');

insert into public.businesses (id, name, slug, industry, timezone)
values
	(
		'72000000-0000-4000-8000-000000000001',
		'Consultorio exportable',
		'patient-export-' || gen_random_uuid()::text,
		'odontology',
		'America/Argentina/Buenos_Aires'
	),
	(
		'72000000-0000-4000-8000-000000000002',
		'Consultorio ajeno',
		'patient-export-other-' || gen_random_uuid()::text,
		'odontology',
		'UTC'
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
	'72000000-0000-4000-8000-000000000001',
	'72000000-0000-4000-8000-000000000002'
);

insert into public.business_users (
	business_id, user_id, role, status, accepted_at, disabled_at
)
values
	('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
	('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'admin', 'active', now(), null),
	('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'professional', 'active', now(), null),
	('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004', 'reception', 'active', now(), null),
	('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000006', 'admin', 'disabled', null, now()),
	('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000007', 'admin', 'disabled', now(), now()),
	('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000008', 'owner', 'active', now(), null);

insert into public.account_assistance_support_users (user_id, email, enabled)
values (
	'71000000-0000-4000-8000-000000000005',
	'export-assistance@example.test',
	true
);

insert into public.account_assistance_grants (
	business_id,
	requested_by_user_id,
	support_user_id,
	status,
	starts_at,
	expires_at
)
values (
	'72000000-0000-4000-8000-000000000001',
	'71000000-0000-4000-8000-000000000001',
	'71000000-0000-4000-8000-000000000005',
	'active',
	now() - interval '1 minute',
	now() + interval '1 hour'
);

insert into public.professionals (id, business_id, name)
values
	('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Dra. Uno'),
	('74000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000001', 'Dr. Dos');

insert into public.services (
	id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes
)
values (
	'75000000-0000-4000-8000-000000000001',
	'72000000-0000-4000-8000-000000000001',
	'Consulta de prueba',
	30,
	0,
	0
);

insert into public.professional_services (business_id, professional_id, service_id)
values
	(
		'72000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000001',
		'75000000-0000-4000-8000-000000000001'
	),
	(
		'72000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000002',
		'75000000-0000-4000-8000-000000000001'
	);

insert into public.patients (
	id, owner_id, business_id, full_name, dni, phone, email, birth_date, address,
	insurance, insurance_plan, archived_at
)
values
	(
		'73000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'Paciente Activa', '00123456', '+54 11 4000-0001', 'activa@example.test',
		'1990-01-02', 'Calle 1', 'Cobertura', 'Plan A', null
	),
	(
		'73000000-0000-4000-8000-000000000002',
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'Paciente Archivada', '00123457', '+54 11 4000-0002', null,
		'1985-03-04', null, null, null, now() - interval '2 days'
	),
	(
		'73000000-0000-4000-8000-000000000099',
		'71000000-0000-4000-8000-000000000008',
		'72000000-0000-4000-8000-000000000002',
		'Paciente Ajena', '00999999', '+54 11 4999-9999', null,
		null, null, null, null, null
	);

-- Fuerza paginacion real por encima del limite historico de PostgREST.
insert into public.patients (owner_id, business_id, full_name)
select
	'71000000-0000-4000-8000-000000000001'::uuid,
	'72000000-0000-4000-8000-000000000001'::uuid,
	'Paciente export masivo ' || lpad(series::text, 4, '0')
from generate_series(1, 1003) series;

insert into public.patient_clinical_profiles (
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
values
	(
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000001',
		'Penicilina',
		'Medicacion habitual',
		'Antecedente de prueba',
		'Alerta clinica',
		'Notas con Unicode: áéíóú ñ 😀',
		jsonb_build_object(
			'texto', '00123',
			'numero', 12.5,
			'booleano', true,
			'nulo', null,
			'objeto', jsonb_build_object('clave', 'valor'),
			'lista', jsonb_build_array('uno', 2, false)
		),
		'71000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001'
	),
	(
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000002',
		null, null, null, null, null,
		jsonb_build_array('raiz', 7),
		'71000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001'
	);

insert into public.clinical_entries (
	id, owner_id, business_id, patient_id, entry_type, description, teeth,
	internal_note, archived_at, created_by_professional_id, created_by_user_id
)
values
	(
		'76000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000001',
		'Consulta', '=texto, no formula', '11, 12', 'Nota interna', null,
		'74000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001'
	),
	(
		'76000000-0000-4000-8000-000000000002',
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000002',
		'Tratamiento', 'Entrada archivada', null, null, now() - interval '1 day',
		'74000000-0000-4000-8000-000000000002',
		'71000000-0000-4000-8000-000000000001'
	);

insert into public.clinical_entry_costs (
	business_id, clinical_entry_id, amount, created_by, updated_by
)
values
	(
		'72000000-0000-4000-8000-000000000001',
		'76000000-0000-4000-8000-000000000001',
		12345.67,
		'71000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001'
	),
	(
		'72000000-0000-4000-8000-000000000001',
		'76000000-0000-4000-8000-000000000002',
		null,
		'71000000-0000-4000-8000-000000000001',
		'71000000-0000-4000-8000-000000000001'
	);

insert into public.appointments (
	id, business_id, patient_id, service_id, professional_id, starts_at, ends_at,
	blocking_starts_at, blocking_ends_at, status, source, service_name_snapshot,
	professional_name_snapshot, duration_minutes_snapshot, internal_note,
	confirmed_at, cancelled_at, cancelled_reason, reschedule_requested_at,
	created_by_user_id
)
values
	(
		'77000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000001',
		'75000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000001',
		'2025-01-01 10:00:00+00', '2025-01-01 10:30:00+00',
		'2025-01-01 10:00:00+00', '2025-01-01 10:30:00+00',
		'reserved', 'manual', 'Consulta', 'Dra. Uno', 30, 'Reservado',
		null, null, null, null, '71000000-0000-4000-8000-000000000001'
	),
	(
		'77000000-0000-4000-8000-000000000002',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000001',
		'75000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000001',
		'2025-01-02 10:00:00+00', '2025-01-02 10:30:00+00',
		'2025-01-02 10:00:00+00', '2025-01-02 10:30:00+00',
		'confirmed', 'admin', 'Consulta', 'Dra. Uno', 30, 'Confirmado',
		'2025-01-01 12:00:00+00', null, null, null,
		'71000000-0000-4000-8000-000000000001'
	),
	(
		'77000000-0000-4000-8000-000000000003',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000002',
		'75000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000002',
		'2025-01-03 10:00:00+00', '2025-01-03 10:30:00+00',
		'2025-01-03 10:00:00+00', '2025-01-03 10:30:00+00',
		'cancelled', 'manual', 'Consulta', 'Dr. Dos', 30, 'Cancelado',
		null, '2025-01-02 12:00:00+00', 'Motivo', null,
		'71000000-0000-4000-8000-000000000001'
	),
	(
		'77000000-0000-4000-8000-000000000004',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000002',
		'75000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000002',
		'2025-01-04 10:00:00+00', '2025-01-04 10:30:00+00',
		'2025-01-04 10:00:00+00', '2025-01-04 10:30:00+00',
		'reschedule_requested', 'manual', 'Consulta', 'Dr. Dos', 30, 'Reprogramar',
		null, null, null, '2025-01-03 12:00:00+00',
		'71000000-0000-4000-8000-000000000001'
	);

insert into public.follow_ups (
	id, business_id, patient_id, assigned_professional_id, remind_on, message,
	status, created_by, done_at
)
values
	(
		'78000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000001',
		'74000000-0000-4000-8000-000000000001',
		'2026-09-01', '@mensaje de prueba', 'pending',
		'71000000-0000-4000-8000-000000000001', null
	),
	(
		'78000000-0000-4000-8000-000000000002',
		'72000000-0000-4000-8000-000000000001',
		'73000000-0000-4000-8000-000000000002',
		null, '2026-01-01', 'Ya completado', 'done',
		'71000000-0000-4000-8000-000000000001', now() - interval '1 day'
	);

-- La asistencia tiene rol efectivo admin para otras pantallas, pero no una
-- membresia directa. Esto demuestra que la denegacion no es accidental.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
	v_denied boolean := false;
begin
	if public.user_business_role('72000000-0000-4000-8000-000000000001') <> 'admin' then
		raise exception 'TEST_ASSISTANCE_DID_NOT_MAP_TO_EFFECTIVE_ADMIN';
	end if;

	begin
		perform public.begin_patient_export(
			'71000000-0000-4000-8000-000000000005',
			'72000000-0000-4000-8000-000000000001',
			'all_patients', null,
			'79000000-0000-4000-8000-000000000001'
		);
	exception when insufficient_privilege then
		v_denied := true;
	end;
	if not v_denied then
		raise exception 'TEST_AUTHENTICATED_BYPASSED_SERVER_CONTROL_PLANE';
	end if;

	v_denied := false;
	begin
		perform 1 from public.patient_export_sessions limit 1;
	exception when insufficient_privilege then
		v_denied := true;
	end;
	if not v_denied then
		raise exception 'TEST_AUTHENTICATED_READ_PRIVATE_EXPORT_SESSIONS';
	end if;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Solo owner/admin directos activos y aceptados pueden iniciar.
do $$
declare
	v_actor uuid;
	v_result jsonb;
	v_request integer := 10;
begin
	foreach v_actor in array array[
		'71000000-0000-4000-8000-000000000003'::uuid,
		'71000000-0000-4000-8000-000000000004'::uuid,
		'71000000-0000-4000-8000-000000000005'::uuid,
		'71000000-0000-4000-8000-000000000006'::uuid,
		'71000000-0000-4000-8000-000000000007'::uuid,
		'71000000-0000-4000-8000-000000000008'::uuid
	]
	loop
		v_result := public.begin_patient_export(
			v_actor,
			'72000000-0000-4000-8000-000000000001',
			'patient',
			'73000000-0000-4000-8000-000000000001',
			('79000000-0000-4000-8000-' || lpad(v_request::text, 12, '0'))::uuid
		);
		if v_result ->> 'error_code' <> 'EXPORT_NOT_AUTHORIZED' then
			raise exception 'TEST_UNAUTHORIZED_ACTOR_ALLOWED actor=% result=%', v_actor, v_result;
		end if;
		v_request := v_request + 1;
	end loop;
end;
$$;

-- Owner y admin directos pueden exportar una persona y cancelar de forma
-- idempotente. El consultorio ajeno nunca es un paciente valido del alcance.
do $$
declare
	v_result jsonb;
	v_export_id uuid;
	v_actor uuid;
	v_request integer := 30;
begin
	foreach v_actor in array array[
		'71000000-0000-4000-8000-000000000001'::uuid,
		'71000000-0000-4000-8000-000000000002'::uuid
	]
	loop
		v_result := public.begin_patient_export(
			v_actor,
			'72000000-0000-4000-8000-000000000001',
			'patient',
			'73000000-0000-4000-8000-000000000001',
			('79000000-0000-4000-8000-' || lpad(v_request::text, 12, '0'))::uuid
		);
		if coalesce((v_result ->> 'ok')::boolean, false) is not true then
			raise exception 'TEST_DIRECT_MANAGER_DENIED actor=% result=%', v_actor, v_result;
		end if;
		v_export_id := (v_result ->> 'export_id')::uuid;
		v_result := public.cancel_patient_export(v_actor, v_export_id);
		if v_result ->> 'status' <> 'cancelled' then
			raise exception 'TEST_MANAGER_CANCEL_FAILED result=%', v_result;
		end if;
		v_request := v_request + 1;
	end loop;

	v_result := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'patient',
		'73000000-0000-4000-8000-000000000099',
		'79000000-0000-4000-8000-000000000039'
	);
	if v_result ->> 'error_code' <> 'EXPORT_PATIENT_NOT_FOUND' then
		raise exception 'TEST_OTHER_BUSINESS_PATIENT_LEAK result=%', v_result;
	end if;
end;
$$;

-- Restricted mantiene la salida de datos; pausa manual y archivado la cierran.
update public.business_subscriptions
set
	commercial_access_enabled = true,
	is_permanent = false,
	subscription_status = 'restricted',
	restricted_until = now() + interval '1 day',
	archived_at = null
where business_id = '72000000-0000-4000-8000-000000000001';

do $$
declare
	v_result jsonb;
begin
	v_result := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'patient',
		'73000000-0000-4000-8000-000000000001',
		'79000000-0000-4000-8000-000000000040'
	);
	if coalesce((v_result ->> 'ok')::boolean, false) is not true then
		raise exception 'TEST_RESTRICTED_EXPORT_DENIED result=%', v_result;
	end if;
	perform public.cancel_patient_export(
		'71000000-0000-4000-8000-000000000001',
		(v_result ->> 'export_id')::uuid
	);
end;
$$;

update public.business_subscriptions
set commercial_access_enabled = false
where business_id = '72000000-0000-4000-8000-000000000001';

do $$
declare v_result jsonb;
begin
	v_result := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'patient', '73000000-0000-4000-8000-000000000001',
		'79000000-0000-4000-8000-000000000041'
	);
	if v_result ->> 'error_code' <> 'EXPORT_NOT_AUTHORIZED' then
		raise exception 'TEST_MANUAL_PAUSE_ALLOWED result=%', v_result;
	end if;
end;
$$;

update public.business_subscriptions
set commercial_access_enabled = true, archived_at = now(), subscription_status = 'archived'
where business_id = '72000000-0000-4000-8000-000000000001';

do $$
declare v_result jsonb;
begin
	v_result := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'patient', '73000000-0000-4000-8000-000000000001',
		'79000000-0000-4000-8000-000000000042'
	);
	if v_result ->> 'error_code' <> 'EXPORT_NOT_AUTHORIZED' then
		raise exception 'TEST_ARCHIVED_ALLOWED result=%', v_result;
	end if;
end;
$$;

update public.business_subscriptions
set
	commercial_access_enabled = true,
	is_permanent = true,
	subscription_status = 'active',
	restricted_until = null,
	archived_at = null
where business_id = '72000000-0000-4000-8000-000000000001';

-- Exportacion global: idempotencia, un unico lock, mas de 1.000 pacientes,
-- cursores sin duplicados/omisiones y conteos exactos para las seis fuentes.
do $$
declare
	v_start jsonb;
	v_repeat jsonb;
	v_blocked jsonb;
	v_page jsonb;
	v_validate jsonb;
	v_export_id uuid;
	v_expected jsonb;
	v_received jsonb := '{}'::jsonb;
	v_cursor jsonb;
	v_dataset text;
	v_total bigint;
	v_seen_patient_ids uuid[] := array[]::uuid[];
	v_seen_statuses text[] := array[]::text[];
	v_distinct bigint;
begin
	v_start := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'all_patients', null,
		'79000000-0000-4000-8000-000000000050'
	);
	if coalesce((v_start ->> 'ok')::boolean, false) is not true then
		raise exception 'TEST_GLOBAL_START_FAILED result=%', v_start;
	end if;
	v_export_id := (v_start ->> 'export_id')::uuid;
	v_expected := v_start -> 'expected_counts';

	v_repeat := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'all_patients', null,
		'79000000-0000-4000-8000-000000000050'
	);
	if (v_repeat ->> 'export_id')::uuid <> v_export_id
		or coalesce((v_repeat ->> 'reused')::boolean, false) is not true
	then
		raise exception 'TEST_IDEMPOTENCY_FAILED first=% repeated=%', v_start, v_repeat;
	end if;

	v_blocked := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000002',
		'72000000-0000-4000-8000-000000000001',
		'all_patients', null,
		'79000000-0000-4000-8000-000000000051'
	);
	if v_blocked ->> 'error_code' <> 'EXPORT_IN_PROGRESS' then
		raise exception 'TEST_GLOBAL_LOCK_FAILED result=%', v_blocked;
	end if;

	foreach v_dataset in array array[
		'patients', 'custom_fields', 'clinical_entries', 'appointments',
		'appointment_professionals', 'follow_ups'
	]
	loop
		v_cursor := null;
		v_total := 0;
		loop
			v_page := public.read_patient_export_page(
				'71000000-0000-4000-8000-000000000001',
				v_export_id,
				v_dataset,
				v_cursor,
				200
			);
			if coalesce((v_page ->> 'ok')::boolean, false) is not true then
				raise exception 'TEST_PAGE_FAILED dataset=% result=%', v_dataset, v_page;
			end if;
			v_total := v_total + (v_page ->> 'row_count')::bigint;

			if v_dataset = 'patients' then
				v_seen_patient_ids := v_seen_patient_ids || coalesce((
					select array_agg((row_value ->> 'patient_id')::uuid)
					from jsonb_array_elements(v_page -> 'rows') row_value
				), array[]::uuid[]);
			elsif v_dataset = 'appointments' then
				v_seen_statuses := v_seen_statuses || coalesce((
					select array_agg(row_value ->> 'status')
					from jsonb_array_elements(v_page -> 'rows') row_value
				), array[]::text[]);
			end if;

			exit when coalesce((v_page ->> 'done')::boolean, false);
			v_cursor := v_page -> 'next_cursor';
			if v_cursor is null then
				raise exception 'TEST_MISSING_CURSOR dataset=%', v_dataset;
			end if;
		end loop;
		v_received := jsonb_set(v_received, array[v_dataset], to_jsonb(v_total), true);
	end loop;

	if v_received is distinct from v_expected then
		raise exception 'TEST_COUNTS_MISMATCH expected=% received=%', v_expected, v_received;
	end if;
	if (v_received ->> 'patients')::bigint <= 1000 then
		raise exception 'TEST_DID_NOT_EXERCISE_OVER_1000_PATIENTS counts=%', v_received;
	end if;
	select count(distinct id) into v_distinct from unnest(v_seen_patient_ids) id;
	if v_distinct <> cardinality(v_seen_patient_ids)
		or cardinality(v_seen_patient_ids) <> (v_expected ->> 'patients')::integer
	then
		raise exception 'TEST_PATIENT_PAGINATION_DUPLICATED_OR_SKIPPED distinct=% total=% expected=%',
			v_distinct, cardinality(v_seen_patient_ids), v_expected ->> 'patients';
	end if;
	if '73000000-0000-4000-8000-000000000099'::uuid = any(v_seen_patient_ids) then
		raise exception 'TEST_OTHER_BUSINESS_ROW_EXPORTED';
	end if;
	if not (
		'reserved' = any(v_seen_statuses)
		and 'confirmed' = any(v_seen_statuses)
		and 'cancelled' = any(v_seen_statuses)
		and 'reschedule_requested' = any(v_seen_statuses)
	) then
		raise exception 'TEST_APPOINTMENT_STATES_INCOMPLETE statuses=%', v_seen_statuses;
	end if;

	v_validate := public.validate_patient_export(
		'71000000-0000-4000-8000-000000000001',
		v_export_id,
		v_received
	);
	if coalesce((v_validate ->> 'validated')::boolean, false) is not true then
		raise exception 'TEST_VALIDATION_FAILED result=%', v_validate;
	end if;

	if (select count(*) from public.audit_logs where entity_id = v_export_id and action = 'patient_export_requested') <> 1
		or (select count(*) from public.audit_logs where entity_id = v_export_id and action = 'patient_export_dataset_validated') <> 1
	then
		raise exception 'TEST_AUTHORITATIVE_AUDIT_NOT_EXACTLY_ONCE';
	end if;
end;
$$;

-- Un lock vencido se expira de forma perezosa, se audita una sola vez y deja
-- iniciar otra exportacion global.
do $$
declare
	v_start jsonb;
	v_result jsonb;
	v_expired_id uuid;
	v_next_id uuid;
begin
	v_start := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000002',
		'72000000-0000-4000-8000-000000000001',
		'all_patients', null,
		'79000000-0000-4000-8000-000000000060'
	);
	v_expired_id := (v_start ->> 'export_id')::uuid;
	update public.patient_export_sessions
	set
		created_at = statement_timestamp() - interval '2 hours',
		expires_at = statement_timestamp() - interval '1 hour'
	where id = v_expired_id;

	v_result := public.read_patient_export_page(
		'71000000-0000-4000-8000-000000000002',
		v_expired_id, 'patients', null, 100
	);
	if v_result ->> 'error_code' <> 'EXPORT_SESSION_EXPIRED' then
		raise exception 'TEST_EXPIRATION_NOT_ENFORCED result=%', v_result;
	end if;
	v_result := public.read_patient_export_page(
		'71000000-0000-4000-8000-000000000002',
		v_expired_id, 'patients', null, 100
	);
	if (select count(*) from public.audit_logs where entity_id = v_expired_id and action = 'patient_export_expired') <> 1 then
		raise exception 'TEST_EXPIRATION_AUDIT_NOT_IDEMPOTENT';
	end if;

	v_start := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'all_patients', null,
		'79000000-0000-4000-8000-000000000061'
	);
	v_next_id := (v_start ->> 'export_id')::uuid;
	if v_next_id is null then
		raise exception 'TEST_EXPIRED_LOCK_NOT_RELEASED result=%', v_start;
	end if;
	perform public.cancel_patient_export('71000000-0000-4000-8000-000000000001', v_next_id);
	perform public.cancel_patient_export('71000000-0000-4000-8000-000000000001', v_next_id);
	if (select count(*) from public.audit_logs where entity_id = v_next_id and action = 'patient_export_cancelled') <> 1 then
		raise exception 'TEST_CANCEL_AUDIT_NOT_IDEMPOTENT';
	end if;
end;
$$;

-- Revocar el rol entre paginas invalida la sesion y deja un motivo tecnico
-- acotado, nunca contenido clinico.
do $$
declare
	v_start jsonb;
	v_result jsonb;
	v_export_id uuid;
begin
	v_start := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'patient', '73000000-0000-4000-8000-000000000001',
		'79000000-0000-4000-8000-000000000070'
	);
	v_export_id := (v_start ->> 'export_id')::uuid;
	update public.business_users
	set status = 'disabled', disabled_at = now()
	where business_id = '72000000-0000-4000-8000-000000000001'
		and user_id = '71000000-0000-4000-8000-000000000001';

	v_result := public.read_patient_export_page(
		'71000000-0000-4000-8000-000000000001',
		v_export_id, 'patients', null, 100
	);
	if v_result ->> 'error_code' <> 'EXPORT_NOT_AUTHORIZED' then
		raise exception 'TEST_REVOKED_ROLE_READ_PAGE result=%', v_result;
	end if;
	if not exists (
		select 1 from public.patient_export_sessions
		where id = v_export_id and status = 'failed' and failure_code = 'authorization_revoked'
	) then
		raise exception 'TEST_REVOKED_SESSION_NOT_FAILED';
	end if;

	update public.business_users
	set status = 'active', disabled_at = null
	where business_id = '72000000-0000-4000-8000-000000000001'
		and user_id = '71000000-0000-4000-8000-000000000001';
end;
$$;

-- Una alta entre captura y validacion cambia huella/conteos y descarta todo el
-- intento; nunca construye un archivo con fotografias mezcladas.
do $$
declare
	v_start jsonb;
	v_result jsonb;
	v_export_id uuid;
begin
	v_start := public.begin_patient_export(
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'all_patients', null,
		'79000000-0000-4000-8000-000000000080'
	);
	v_export_id := (v_start ->> 'export_id')::uuid;
	insert into public.patients (owner_id, business_id, full_name)
	values (
		'71000000-0000-4000-8000-000000000001',
		'72000000-0000-4000-8000-000000000001',
		'Paciente concurrente nuevo'
	);

	v_result := public.validate_patient_export(
		'71000000-0000-4000-8000-000000000001',
		v_export_id,
		v_start -> 'expected_counts'
	);
	if v_result ->> 'error_code' <> 'EXPORT_DATA_CHANGED' then
		raise exception 'TEST_DATA_CHANGE_NOT_DETECTED result=%', v_result;
	end if;
	if not exists (
		select 1 from public.patient_export_sessions
		where id = v_export_id and status = 'failed' and failure_code = 'data_changed'
	) then
		raise exception 'TEST_DATA_CHANGE_SESSION_NOT_FAILED';
	end if;
end;
$$;

-- Ningun evento de exportacion incorpora PHI o claves tecnicas prohibidas.
do $$
begin
	if exists (
		select 1
		from public.audit_logs log
		where log.action like 'patient_export_%'
			and coalesce(log.metadata, '{}'::jsonb) ?| array[
				'full_name', 'dni', 'phone', 'email', 'description', 'message',
				'confirmation_token', 'request_key', 'dataset_fingerprint'
			]
	) then
		raise exception 'TEST_EXPORT_AUDIT_CONTAINS_FORBIDDEN_DATA';
	end if;
end;
$$;

-- Si la auditoria autoritativa no puede escribirse, la sesion tampoco queda
-- creada. El trigger vive solo dentro de esta transaccion de prueba.
reset role;
create function pg_temp.reject_patient_export_audit()
returns trigger
language plpgsql
as $$
begin
	if new.action = 'patient_export_requested' then
		raise exception 'TEST_AUDIT_UNAVAILABLE';
	end if;
	return new;
end;
$$;

create trigger patient_export_test_reject_audit
before insert on public.audit_logs
for each row execute function pg_temp.reject_patient_export_audit();

set local role service_role;
do $$
declare
	v_failed_closed boolean := false;
begin
	begin
		perform public.begin_patient_export(
			'71000000-0000-4000-8000-000000000001',
			'72000000-0000-4000-8000-000000000001',
			'patient', '73000000-0000-4000-8000-000000000001',
			'79000000-0000-4000-8000-000000000090'
		);
	exception when others then
		v_failed_closed := true;
	end;
	if not v_failed_closed then
		raise exception 'TEST_AUDIT_FAILURE_DID_NOT_FAIL_CLOSED';
	end if;
	if exists (
		select 1 from public.patient_export_sessions
		where requested_by_user_id = '71000000-0000-4000-8000-000000000001'
			and request_key = '79000000-0000-4000-8000-000000000090'
	) then
		raise exception 'TEST_AUDIT_FAILURE_LEFT_ORPHAN_SESSION';
	end if;
end;
$$;

reset role;
drop trigger patient_export_test_reject_audit on public.audit_logs;

select extensions.pass('patient export authorization, isolation, completeness and lifecycle hold');
select * from extensions.finish();

rollback;
