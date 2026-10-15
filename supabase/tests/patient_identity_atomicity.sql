-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/patient_identity_atomicity.sql

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_1 uuid;
	v_professional_2 uuid;
	v_first record;
	v_second record;
	v_replay record;
	v_joint record;
	v_direct_id uuid;
	v_base timestamptz := date_trunc('day', statement_timestamp()) + interval '45 days 9 hours';
	v_count integer;
	v_error text;
begin
	if to_regclass('public.patients_owner_dni_uq') is not null
		or to_regclass('public.patients_business_dni_uq') is null
	then
		raise exception 'TEST_DNI_UNIQUENESS_SCOPE_IS_NOT_BUSINESS_ONLY';
	end if;

	insert into auth.users (id, email)
	values (v_owner_id, 'patient-identity-atomicity@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba atomicidad pacientes',
		'patient-identity-atomicity-' || gen_random_uuid()::text,
		'odontology',
		'UTC'
	)
	returning id into v_business_id;

	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_owner_id, 'owner', 'active', statement_timestamp());

	insert into public.services (
		business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes
	)
	values (v_business_id, 'Consulta atómica', 30, 0, 0)
	returning id into v_service_id;

	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional Uno') returning id into v_professional_1;
	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional Dos') returning id into v_professional_2;

	insert into public.professional_services (business_id, professional_id, service_id)
	values
		(v_business_id, v_professional_1, v_service_id),
		(v_business_id, v_professional_2, v_service_id);

	-- Explicit new means new even when contact data is shared.
	select created.* into v_first
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Juan Pedro', '342 504 8209', '+5493425048209', null,
		false, v_owner_id, v_service_id, array[v_professional_1], v_base, null,
		v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000001'
	) created;
	select created.* into v_second
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Carlos Gomez', '342 504 8209', '+5493425048209', null,
		false, v_owner_id, v_service_id, array[v_professional_1], v_base + interval '1 hour', null,
		v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000002'
	) created;
	if v_first.patient_id = v_second.patient_id
		or not v_first.patient_created
		or not v_second.patient_created
	then
		raise exception 'TEST_EXPLICIT_NEW_PATIENTS_WERE_MERGED';
	end if;
	if v_first.patient_resolution_strategy <> 'new_explicit'
		or v_second.patient_resolution_strategy <> 'new_explicit'
	then
		raise exception 'TEST_EXPLICIT_NEW_STRATEGY_MISSING';
	end if;
	if not exists (
		select 1 from public.appointments appointment
		where appointment.id = v_first.id
			and appointment.patient_name_at_booking = 'Juan Pedro'
			and appointment.patient_phone_raw_at_booking = '342 504 8209'
			and appointment.patient_phone_e164_at_booking = '+5493425048209'
			and appointment.patient_resolution_strategy = 'new_explicit'
	) then
		raise exception 'TEST_PATIENT_BOOKING_SNAPSHOT_MISSING';
	end if;

	-- The database derives snapshots from patient_id even for a legacy direct
	-- insert, and rejects callers that try to forge atomic-creation provenance.
	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot, patient_name_at_booking,
		patient_phone_raw_at_booking,
		patient_phone_e164_at_booking
	)
	values (
		v_business_id, v_first.patient_id, v_service_id, v_professional_1,
		v_base + interval '10 hours', v_base + interval '10 hours 30 minutes',
		v_base + interval '10 hours', v_base + interval '10 hours 30 minutes',
		'reserved', 'manual', 'Consulta atómica', 'Profesional Uno', 30,
		'Nombre falsificado', 'teléfono falsificado', '+5490000000000'
	)
	returning id into v_direct_id;
	if not exists (
		select 1
		from public.appointments appointment
		where appointment.id = v_direct_id
			and appointment.patient_name_at_booking = 'Juan Pedro'
			and appointment.patient_phone_raw_at_booking = '342 504 8209'
			and appointment.patient_phone_e164_at_booking = '+5493425048209'
			and appointment.patient_resolution_strategy = 'legacy_unknown'
			and appointment.public_booking_contact_key is null
	) then
		raise exception 'TEST_DIRECT_INSERT_SNAPSHOT_WAS_NOT_DERIVED';
	end if;
	begin
		insert into public.appointments (
			business_id, patient_id, service_id, professional_id,
			starts_at, ends_at, blocking_starts_at, blocking_ends_at,
			status, source, service_name_snapshot, professional_name_snapshot,
			duration_minutes_snapshot, patient_resolution_strategy,
			creation_request_key, creation_request_fingerprint
		)
		values (
			v_business_id, v_first.patient_id, v_service_id, v_professional_1,
			v_base + interval '11 hours', v_base + interval '11 hours 30 minutes',
			v_base + interval '11 hours', v_base + interval '11 hours 30 minutes',
			'reserved', 'manual', 'Consulta atómica', 'Profesional Uno', 30,
			'new_explicit', 'a2000000-0000-4000-8000-000000000098', repeat('a', 64)
		);
		raise exception 'TEST_EXPECTED_DIRECT_PROVENANCE_INSERT_BLOCK';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_IDENTITY_WRITE_DENIED' then
			raise exception 'TEST_WRONG_DIRECT_PROVENANCE_INSERT_ERROR_%', v_error;
		end if;
	end;
	begin
		update public.appointments appointment
		set patient_phone_raw_at_booking = 'dato alterado'
		where appointment.id = v_first.id;
		raise exception 'TEST_EXPECTED_RAW_SNAPSHOT_BLOCK';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_IDENTITY_FIELDS_IMMUTABLE' then
			raise exception 'TEST_WRONG_RAW_SNAPSHOT_ERROR_%', v_error;
		end if;
	end;

	-- Generic table updates cannot bypass the audited repair path or rewrite
	-- idempotency provenance, even when the caller can otherwise edit a turn.
	begin
		update public.appointments appointment
		set patient_id = v_second.patient_id
		where appointment.id = v_first.id;
		raise exception 'TEST_EXPECTED_DIRECT_PATIENT_REASSIGNMENT_BLOCK';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_IDENTITY_FIELDS_IMMUTABLE' then
			raise exception 'TEST_WRONG_DIRECT_REASSIGNMENT_ERROR_%', v_error;
		end if;
	end;
	begin
		update public.appointments appointment
		set creation_request_key = 'a2000000-0000-4000-8000-000000000099'
		where appointment.id = v_first.id;
		raise exception 'TEST_EXPECTED_CREATION_PROVENANCE_BLOCK';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_CREATION_PROVENANCE_IMMUTABLE' then
			raise exception 'TEST_WRONG_CREATION_PROVENANCE_ERROR_%', v_error;
		end if;
	end;
	begin
		update public.appointments appointment
		set confirmation_token = encode(gen_random_bytes(32), 'hex')
		where appointment.id = v_first.id;
		raise exception 'TEST_EXPECTED_CONFIRMATION_TOKEN_BLOCK';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_CONFIRMATION_TOKEN_IMMUTABLE' then
			raise exception 'TEST_WRONG_CONFIRMATION_TOKEN_ERROR_%', v_error;
		end if;
	end;
	if not exists (
		select 1
		from public.appointments appointment
		where appointment.id = v_first.id
			and appointment.patient_id <> v_second.patient_id
			and appointment.creation_request_key = 'a2000000-0000-4000-8000-000000000001'
	) then
		raise exception 'TEST_IMMUTABLE_FIELDS_CHANGED_AFTER_REJECTION';
	end if;

	-- Same request + same normalized payload returns the original appointment
	-- and does not create a second patient.
	select created.* into v_first
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Idempotente Persona', '351 555 0101', '+5493515550101', null,
		false, v_owner_id, v_service_id, array[v_professional_1], v_base + interval '2 hours', 'nota',
		v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000003'
	) created;
	select created.* into v_replay
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Idempotente Persona', '351 555 0101', '+5493515550101', null,
		false, v_owner_id, v_service_id, array[v_professional_1], v_base + interval '2 hours', 'nota',
		v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000003'
	) created;
	if v_replay.id <> v_first.id or not v_replay.idempotent_replay then
		raise exception 'TEST_IDEMPOTENT_REPLAY_DID_NOT_RETURN_ORIGINAL';
	end if;
	select created.* into v_replay
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Idempotente Persona', '351 555 0101', '+5493515550101', null,
		false, v_owner_id, v_service_id, array[v_professional_1], v_base + interval '2 hours', 'nota',
		v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000003', true
	) created;
	if v_replay.id <> v_first.id or not v_replay.idempotent_replay then
		raise exception 'TEST_REPLAY_ONLY_DID_NOT_RETURN_ORIGINAL';
	end if;
	select count(*)::integer into v_count
	from public.patients patient
	where patient.business_id = v_business_id
		and patient.full_name = 'Idempotente Persona';
	if v_count <> 1 then
		raise exception 'TEST_IDEMPOTENCY_CREATED_%_PATIENTS', v_count;
	end if;

	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'new', null, 'Idempotente Persona', '351 555 0101', '+5493515550101', null,
			false, v_owner_id, v_service_id, array[v_professional_1], v_base + interval '2 hours',
			'payload distinto', v_owner_id, false, 'manual', 'valid', false,
			'a2000000-0000-4000-8000-000000000003'
		);
		raise exception 'TEST_EXPECTED_IDEMPOTENCY_CONFLICT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_IDEMPOTENCY_CONFLICT' then
			raise exception 'TEST_WRONG_IDEMPOTENCY_ERROR_%', v_error;
		end if;
	end;

	-- A replay-only miss is a read-only zero-row result: it does not validate a
	-- currently unavailable service and cannot leave a patient behind.
	select count(*)::integer into v_count
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Solo Consulta', '351 555 0198', '+5493515550198', null,
		false, v_owner_id, gen_random_uuid(), array[v_professional_1], v_base + interval '3 hours', null,
		v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000097', true
	);
	if v_count <> 0 or exists (
		select 1 from public.patients patient
		where patient.business_id = v_business_id and patient.full_name = 'Solo Consulta'
	) then
		raise exception 'TEST_REPLAY_ONLY_MISS_WROTE_DATA';
	end if;

	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'new', null, 'Responsable Ajeno', null, null, null,
			false, gen_random_uuid(), v_service_id, array[v_professional_1],
			v_base + interval '3 hours', null, v_owner_id, false, 'manual', 'missing', true,
			'a2000000-0000-4000-8000-000000000095'
		);
		raise exception 'TEST_EXPECTED_INVALID_OWNER';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PATIENT_OWNER_INVALID' then
			raise exception 'TEST_WRONG_INVALID_OWNER_ERROR_%', v_error;
		end if;
	end;
	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'existing', v_first.patient_id, null, null, null, null,
			false, null, v_service_id, array[v_professional_1],
			v_base + interval '3 hours', null, gen_random_uuid(), false, 'manual', 'unknown', false,
			'a2000000-0000-4000-8000-000000000094'
		);
		raise exception 'TEST_EXPECTED_INVALID_CREATOR';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_CREATOR_INVALID' then
			raise exception 'TEST_WRONG_INVALID_CREATOR_ERROR_%', v_error;
		end if;
	end;

	update public.services service set is_public = false where service.id = v_service_id;
	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Recurso Privado', '351 555 0197', '+5493515550197', null,
			false, null, v_service_id, array[v_professional_1], v_base + interval '3 hours', null,
			null, false, 'public_booking', 'valid', false,
			'a2000000-0000-4000-8000-000000000093'
		);
		raise exception 'TEST_EXPECTED_PRIVATE_SERVICE_REJECTION';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'SERVICE_NOT_FOUND' then
			raise exception 'TEST_WRONG_PRIVATE_SERVICE_ERROR_%', v_error;
		end if;
	end;
	update public.services service set is_public = true where service.id = v_service_id;

	-- A service failure cannot leave a patient because resource validation and
	-- patient + appointment creation share the same transaction.
	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'new', null, 'No Debe Quedar', '351 555 0199', '+5493515550199', null,
			false, v_owner_id, gen_random_uuid(), array[v_professional_1], v_base + interval '3 hours', null,
			v_owner_id, false, 'manual', 'valid', false,
			'a2000000-0000-4000-8000-000000000004'
		);
		raise exception 'TEST_EXPECTED_SERVICE_FAILURE';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'SERVICE_NOT_FOUND' then
			raise exception 'TEST_WRONG_SERVICE_ERROR_%', v_error;
		end if;
	end;
	select count(*)::integer into v_count
	from public.patients patient
	where patient.business_id = v_business_id and patient.full_name = 'No Debe Quedar';
	if v_count <> 0 then
		raise exception 'TEST_SERVICE_FAILURE_LEFT_ORPHAN_PATIENT';
	end if;

	-- Joint creation is in the same transaction. A later overlap must also roll
	-- back its newly inserted patient.
	select created.* into v_joint
	from public.create_appointment_with_patient_identity(
		v_business_id, 'new', null, 'Paciente Conjunto', '351 555 0200', '+5493515550200', null,
		false, v_owner_id, v_service_id, array[v_professional_1, v_professional_2],
		v_base + interval '4 hours', null, v_owner_id, false, 'manual', 'valid', false,
		'a2000000-0000-4000-8000-000000000005'
	) created;
	select count(*)::integer into v_count
	from public.appointment_professionals allocation
	where allocation.appointment_id = v_joint.id;
	if v_count <> 2 then
		raise exception 'TEST_JOINT_EXPECTED_2_ALLOCATIONS_GOT_%', v_count;
	end if;

	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'new', null, 'Solapado No Debe Quedar', '351 555 0201', '+5493515550201', null,
			false, v_owner_id, v_service_id, array[v_professional_1, v_professional_2],
			v_base + interval '4 hours', null, v_owner_id, false, 'manual', 'valid', false,
			'a2000000-0000-4000-8000-000000000006'
		);
		raise exception 'TEST_EXPECTED_JOINT_OVERLAP';
	exception when exclusion_violation then
		null;
	end;
	select count(*)::integer into v_count
	from public.patients patient
	where patient.business_id = v_business_id
		and patient.full_name = 'Solapado No Debe Quedar';
	if v_count <> 0 then
		raise exception 'TEST_JOINT_OVERLAP_LEFT_ORPHAN_PATIENT';
	end if;

	-- Archived rows are never reused automatically.
	insert into public.patients (
		owner_id, business_id, full_name, phone_e164, archived_at
	)
	values (
		v_owner_id, v_business_id, 'Paciente Archivado', '+5493515550300', statement_timestamp()
	);
	select created.* into v_first
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Paciente Archivado', '351 555 0300', '+5493515550300', null,
		false, null, v_service_id, array[v_professional_1], v_base + interval '5 hours', null,
		null, false, 'public_booking', 'valid', false,
		'a2000000-0000-4000-8000-000000000007'
	) created;
	if not v_first.patient_created or v_first.patient_resolution_strategy <> 'public_new' then
		raise exception 'TEST_ARCHIVED_PATIENT_WAS_REUSED';
	end if;

	-- Multiple exact rows remain ambiguous; never pick an arbitrary first ID.
	insert into public.patients (owner_id, business_id, full_name, phone_e164)
	values
		(v_owner_id, v_business_id, 'Ana Ambigua', '+5493515550400'),
		(v_owner_id, v_business_id, 'Ana Ambigua', '+5493515550400');
	select created.* into v_first
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Ana Ambigua', '351 555 0400', '+5493515550400', null,
		false, null, v_service_id, array[v_professional_1], v_base + interval '6 hours', null,
		null, false, 'public_booking', 'valid', false,
		'a2000000-0000-4000-8000-000000000008'
	) created;
	if not v_first.patient_created
		or v_first.patient_resolution_strategy <> 'public_ambiguous_new'
	then
		raise exception 'TEST_AMBIGUOUS_PUBLIC_MATCH_SELECTED_EXISTING_ROW';
	end if;

	-- The public joint path keeps the legacy inner source transition compatible,
	-- then enriches the same row with identity provenance and idempotency.
	select created.* into v_joint
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Paciente Público Conjunto', '351 555 0500',
		'+5493515550500', null, false, null, v_service_id,
		array[v_professional_1, v_professional_2], v_base + interval '8 hours', null,
		null, false, 'public_booking', 'valid', false,
		'a2000000-0000-4000-8000-000000000010'
	) created;
	if v_joint.patient_resolution_strategy <> 'public_new'
		or not exists (
			select 1
			from public.appointments appointment
			where appointment.id = v_joint.id
				and appointment.source = 'public_booking'
				and appointment.public_booking_contact_key is not null
				and appointment.creation_request_key = 'a2000000-0000-4000-8000-000000000010'
		)
	then
		raise exception 'TEST_PUBLIC_JOINT_IDENTITY_PROVENANCE_MISSING';
	end if;
	select count(*)::integer into v_count
	from public.appointment_professionals allocation
	where allocation.appointment_id = v_joint.id;
	if v_count <> 2 then
		raise exception 'TEST_PUBLIC_JOINT_EXPECTED_2_ALLOCATIONS_GOT_%', v_count;
	end if;

	-- Mixed contracts are rejected before any write.
	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'existing', v_first.patient_id, 'Nombre Inesperado', null, null, null,
			false, null, v_service_id, array[v_professional_1], v_base + interval '7 hours', null,
			v_owner_id, false, 'manual', 'unknown', false,
			'a2000000-0000-4000-8000-000000000009'
		);
		raise exception 'TEST_EXPECTED_MIXED_CONTRACT_REJECTION';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PATIENT_EXISTING_FIELDS_UNEXPECTED' then
			raise exception 'TEST_WRONG_MIXED_CONTRACT_ERROR_%', v_error;
		end if;
	end;

	raise notice 'PASS: explicit identity, snapshots, atomic rollback, joint creation and idempotency';
end;
$$;

select extensions.pass('patient and appointment creation is atomic and idempotent');
select * from extensions.finish();

rollback;
