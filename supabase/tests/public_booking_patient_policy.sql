-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_booking_patient_policy.sql
--
-- Transactional integration test: phones may be shared, while public blocking
-- stays patient-scoped and an exact contact hash closes ambiguous quota bypasses.

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_id uuid;
	v_juan_id uuid;
	v_carlos_id uuid;
	v_blocked_id uuid;
	v_created record;
	v_replay record;
	v_start timestamptz := date_trunc('day', statement_timestamp()) + interval '30 days 9 hours';
	v_count integer;
	v_error text;
	i integer;
begin
	insert into auth.users (id, email)
	values (v_owner_id, 'patient-phone-policy@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba identidad por ID',
		'patient-phone-policy-' || gen_random_uuid()::text,
		'odontology',
		'UTC'
	)
	returning id into v_business_id;

	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_owner_id, 'owner', 'active', statement_timestamp());

	insert into public.services (
		business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes
	)
	values (v_business_id, 'Consulta', 30, 0, 0)
	returning id into v_service_id;

	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional')
	returning id into v_professional_id;

	insert into public.professional_services (business_id, professional_id, service_id)
	values (v_business_id, v_professional_id, v_service_id);

	-- Shared contact data must never merge the rows.
	insert into public.patients (owner_id, business_id, full_name, phone_raw, phone_e164)
	values (v_owner_id, v_business_id, 'Juan Pedro', '342 504 8209', '+5493425048209')
	returning id into v_juan_id;

	insert into public.patients (owner_id, business_id, full_name, phone_raw, phone_e164)
	values (v_owner_id, v_business_id, 'Carlos Gomez', '342 504 8209', '+5493425048209')
	returning id into v_carlos_id;

	if v_juan_id = v_carlos_id then
		raise exception 'TEST_SHARED_PHONE_MERGED_PATIENTS';
	end if;
	select count(*)::integer into v_count
	from public.patients patient
	where patient.business_id = v_business_id
		and patient.phone_e164 = '+5493425048209';
	if v_count <> 2 then
		raise exception 'TEST_EXPECTED_TWO_SHARED_PHONE_ROWS_GOT_%', v_count;
	end if;

	-- The conservative public bridge reuses Juan only because name + phone has
	-- exactly one active match. Carlos keeps a separate patient_id.
	select created.* into v_created
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Juan Pedro', '342 504 8209', '+5493425048209',
		null, false, null, v_service_id, array[v_professional_id], v_start, null,
		null, false, 'public_booking', 'valid', false,
		'a1000000-0000-4000-8000-000000000101'
	) created;
	if v_created.patient_id <> v_juan_id
		or v_created.patient_created
		or v_created.patient_resolution_strategy <> 'public_exact_match'
	then
		raise exception 'TEST_PUBLIC_EXACT_MATCH_DID_NOT_REUSE_JUAN';
	end if;

	select created.* into v_created
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Carlos Gomez', '342 504 8209', '+5493425048209',
		null, false, null, v_service_id, array[v_professional_id], v_start + interval '1 hour', null,
		null, false, 'public_booking', 'valid', false,
		'a1000000-0000-4000-8000-000000000102'
	) created;
	if v_created.patient_id <> v_carlos_id then
		raise exception 'TEST_PUBLIC_SHARED_PHONE_SELECTED_WRONG_PERSON';
	end if;

	-- A blocked Juan does not block Carlos merely because they share a phone.
	update public.patients set blocked = true where id = v_juan_id;
	select created.* into v_created
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Carlos Gomez', '342 504 8209', '+5493425048209',
		null, false, null, v_service_id, array[v_professional_id], v_start + interval '2 hours', null,
		null, false, 'public_booking', 'valid', false,
		'a1000000-0000-4000-8000-000000000103'
	) created;
	if v_created.patient_id <> v_carlos_id then
		raise exception 'TEST_BLOCKED_SHARED_PHONE_AFFECTED_CARLOS';
	end if;

	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Juan Pedro', '342 504 8209', '+5493425048209',
			null, false, null, v_service_id, array[v_professional_id], v_start + interval '3 hours', null,
			null, false, 'public_booking', 'valid', false,
			'a1000000-0000-4000-8000-000000000104'
		);
		raise exception 'TEST_EXPECTED_JUAN_BLOCK';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PATIENT_BLOCKED' then
			raise exception 'TEST_WRONG_BLOCK_ERROR_%', v_error;
		end if;
	end;
	update public.patients set blocked = false where id = v_juan_id;

	-- Juan already has one public booking. Add three more; his fifth is rejected.
	for i in 1..3 loop
		select created.* into v_created
		from public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Juan Pedro', '342 504 8209', '+5493425048209',
			null, false, null, v_service_id, array[v_professional_id],
			v_start + make_interval(hours => 3 + i), null, null, false,
			'public_booking', 'valid', false,
			('a1000000-0000-4000-8000-' || lpad((104 + i)::text, 12, '0'))
		) created;
	end loop;

	select public.get_public_booking_active_future_count_for_request(
		v_business_id, v_juan_id, 'Juan Pedro', '+5493425048209', statement_timestamp()
	) into v_count;
	if v_count <> 4 then
		raise exception 'TEST_JUAN_EXPECTED_4_GOT_%', v_count;
	end if;

	-- The application probes this read-only branch before its own quota and slot
	-- checks. Retrying the fourth booking must recover it even though a fresh fifth
	-- request would now be rejected.
	select replay.* into v_replay
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Juan Pedro', '342 504 8209', '+5493425048209',
		null, false, null, v_service_id, array[v_professional_id], v_start + interval '6 hours', null,
		null, false, 'public_booking', 'valid', false,
		'a1000000-0000-4000-8000-000000000107', true
	) replay;
	if v_replay.id <> v_created.id or not v_replay.idempotent_replay then
		raise exception 'TEST_FOURTH_BOOKING_REPLAY_FAILED';
	end if;

	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Juan Pedro', '342 504 8209', '+5493425048209',
			null, false, null, v_service_id, array[v_professional_id], v_start + interval '8 hours', null,
			null, false, 'public_booking', 'valid', false,
			'a1000000-0000-4000-8000-000000000108'
		);
		raise exception 'TEST_EXPECTED_JUAN_LIMIT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PUBLIC_BOOKING_ACTIVE_LIMIT' then
			raise exception 'TEST_WRONG_LIMIT_ERROR_%', v_error;
		end if;
	end;

	-- Carlos remains below his own capacity despite the shared phone.
	select public.get_public_booking_active_future_count_for_request(
		v_business_id, v_carlos_id, 'Carlos Gomez', '+5493425048209', statement_timestamp()
	) into v_count;
	if v_count <> 2 then
		raise exception 'TEST_CARLOS_EXPECTED_2_GOT_%', v_count;
	end if;

	-- A unique blocked exact match is blocked by patient_id. This separate row
	-- proves the check is not a broad phone blacklist.
	insert into public.patients (owner_id, business_id, full_name, phone_e164, blocked)
	values (v_owner_id, v_business_id, 'Paciente Bloqueado', '+5493510000900', true)
	returning id into v_blocked_id;
	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Paciente Bloqueado', '3510000900', '+5493510000900',
			null, false, null, v_service_id, array[v_professional_id], v_start + interval '9 hours', null,
			null, false, 'public_booking', 'valid', false,
			'a1000000-0000-4000-8000-000000000109'
		);
		raise exception 'TEST_EXPECTED_BLOCKED_PATIENT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PATIENT_BLOCKED' then
			raise exception 'TEST_WRONG_SEPARATE_BLOCK_ERROR_%', v_error;
		end if;
	end;

	-- Two exact active rows are deliberately not merged or arbitrarily selected.
	-- Even though each booking creates another patient_id, the separate hashed
	-- contact bucket still prevents an unlimited sequence of anonymous bookings.
	insert into public.patients (owner_id, business_id, full_name, phone_e164)
	values
		(v_owner_id, v_business_id, 'Ana Doble', '+5493510000999'),
		(v_owner_id, v_business_id, 'Ana Doble', '+5493510000999');

	for i in 1..4 loop
		select created.* into v_created
		from public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Ana Doble', '3510000999', '+5493510000999',
			null, false, null, v_service_id, array[v_professional_id],
			v_start + interval '2 days' + make_interval(hours => i), null, null, false,
			'public_booking', 'valid', false,
			('a1100000-0000-4000-8000-' || lpad(i::text, 12, '0'))
		) created;
		if not v_created.patient_created
			or v_created.patient_resolution_strategy <> 'public_ambiguous_new'
		then
			raise exception 'TEST_AMBIGUOUS_PUBLIC_REQUEST_REUSED_A_PATIENT';
		end if;
	end loop;

	select public.get_public_booking_active_future_count_for_request(
		v_business_id, null, 'Ana Doble', '+5493510000999', statement_timestamp()
	) into v_count;
	if v_count <> 4 then
		raise exception 'TEST_AMBIGUOUS_CONTACT_EXPECTED_4_GOT_%', v_count;
	end if;

	begin
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Ana Doble', '3510000999', '+5493510000999',
			null, false, null, v_service_id, array[v_professional_id],
			v_start + interval '2 days 6 hours', null, null, false,
			'public_booking', 'valid', false,
			'a1100000-0000-4000-8000-000000000005'
		);
		raise exception 'TEST_EXPECTED_AMBIGUOUS_CONTACT_LIMIT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PUBLIC_BOOKING_ACTIVE_LIMIT' then
			raise exception 'TEST_WRONG_AMBIGUOUS_LIMIT_ERROR_%', v_error;
		end if;
	end;

	select count(*)::integer into v_count
	from public.patients patient
	where patient.business_id = v_business_id
		and public.normalized_patient_name(patient.full_name) = 'ana doble'
		and patient.phone_e164 = '+5493510000999';
	if v_count <> 6 then
		raise exception 'TEST_AMBIGUOUS_PATIENT_ROWS_EXPECTED_6_GOT_%', v_count;
	end if;

	if exists (
		select 1 from pg_indexes
		where schemaname = 'public' and indexname = 'patients_business_phone_e164_uq'
	) then
		raise exception 'TEST_PHONE_UNIQUE_INDEX_STILL_EXISTS';
	end if;
	if not exists (
		select 1 from pg_indexes
		where schemaname = 'public' and indexname = 'patients_business_phone_e164_idx'
	) then
		raise exception 'TEST_NON_UNIQUE_PHONE_INDEX_MISSING';
	end if;
	if exists (
		select 1
		from pg_proc procedure
		join pg_namespace namespace on namespace.oid = procedure.pronamespace
		where namespace.nspname = 'public'
			and procedure.proname = 'reserve_public_booking_hold_safely'
	) then
		raise exception 'TEST_LEGACY_PHONE_IDENTITY_RPC_STILL_EXISTS';
	end if;

	raise notice 'PASS: shared phones stay separate; block is patient-scoped and anonymous quota bypasses are closed';
end;
$$;

select extensions.pass('public booking identity and contact anti-abuse remain separate');
select * from extensions.finish();

rollback;
