-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/joint_appointments.sql
--
-- Transactional integration test: leaves no rows behind.

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_professional_user_id uuid := gen_random_uuid();
	v_outsider_user_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_1 uuid;
	v_professional_2 uuid;
	v_professional_3 uuid;
	v_patient_joint uuid;
	v_patient_overlap uuid;
	v_patient_partial uuid;
	v_patient_block uuid;
	v_patient_break_1 uuid;
	v_patient_break_2 uuid;
	v_patient_zero_1 uuid;
	v_patient_zero_2 uuid;
	v_joint_id uuid;
	v_block_id uuid;
	v_public_id uuid;
	v_start timestamptz := date_trunc('day', statement_timestamp()) + interval '30 days 10 hours';
	v_count integer;
	v_original_start timestamptz;
begin
	insert into auth.users (id, email)
	values (v_owner_id, 'joint-appointments@example.test');
	insert into auth.users (id, email)
	values
		(v_professional_user_id, 'joint-professional@example.test'),
		(v_outsider_user_id, 'joint-outsider@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba turnos conjuntos',
		'joint-appointments-' || gen_random_uuid()::text,
		'odontology',
		'UTC'
	)
	returning id into v_business_id;

	insert into public.business_subscriptions (
		business_id,
		commercial_access_enabled,
		is_permanent,
		subscription_status,
		access_starts_at,
		paid_until,
		grace_until,
		restricted_until,
		archived_at
	)
	values (
		v_business_id,
		true,
		true,
		'active',
		statement_timestamp(),
		null,
		null,
		null,
		null
	)
	on conflict (business_id) do update
	set
		commercial_access_enabled = excluded.commercial_access_enabled,
		is_permanent = excluded.is_permanent,
		subscription_status = excluded.subscription_status,
		access_starts_at = excluded.access_starts_at,
		paid_until = excluded.paid_until,
		grace_until = excluded.grace_until,
		restricted_until = excluded.restricted_until,
		archived_at = excluded.archived_at;

	insert into public.services (
		business_id,
		name,
		duration_minutes,
		buffer_before_minutes,
		buffer_after_minutes
	)
	values (v_business_id, 'Cirugía conjunta', 30, 0, 0)
	returning id into v_service_id;

	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional Uno')
	returning id into v_professional_1;
	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional Dos')
	returning id into v_professional_2;
	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional Tres')
	returning id into v_professional_3;

	insert into public.business_users (
		business_id,
		user_id,
		role,
		status,
		accepted_at
	)
	values (
		v_business_id,
		v_professional_user_id,
		'professional',
		'active',
		statement_timestamp()
	);
	insert into public.professional_users (
		business_id,
		professional_id,
		user_id
	)
	values (
		v_business_id,
		v_professional_2,
		v_professional_user_id
	);

	insert into public.professional_services (business_id, professional_id, service_id)
	select v_business_id, professional_id, v_service_id
	from unnest(array[v_professional_1, v_professional_2, v_professional_3]) professional_id;

	insert into public.availability_rules (
		business_id,
		professional_id,
		weekday,
		start_time,
		end_time,
		slot_interval_minutes,
		break_minutes
	)
	select
		v_business_id,
		professional_id,
		weekday,
		'08:00'::time,
		'18:00'::time,
		15,
		23
	from unnest(array[v_professional_1, v_professional_2, v_professional_3]) professional_id
	cross join generate_series(0, 6) weekday;

	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Conjunto')
	returning id into v_patient_joint;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Solapado')
	returning id into v_patient_overlap;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Parcial')
	returning id into v_patient_partial;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Bloqueo')
	returning id into v_patient_block;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Descanso Uno')
	returning id into v_patient_break_1;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Descanso Dos')
	returning id into v_patient_break_2;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Cero Uno')
	returning id into v_patient_zero_1;
	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente Cero Dos')
	returning id into v_patient_zero_2;

	select created.id
	into v_joint_id
	from public.create_joint_appointment(
		v_business_id,
		v_patient_joint,
		v_service_id,
		array[v_professional_1, v_professional_2, v_professional_3],
		v_start,
		'Equipo completo',
		v_owner_id,
		false
	) created;

	select count(*)::integer
	into v_count
	from public.appointments appointment
	where appointment.business_id = v_business_id
		and appointment.id = v_joint_id;
	if v_count <> 1 then
		raise exception 'TEST_JOINT_MUST_BE_ONE_APPOINTMENT_GOT_%', v_count;
	end if;

	select count(*)::integer
	into v_count
	from public.appointment_professionals allocation
	where allocation.business_id = v_business_id
		and allocation.appointment_id = v_joint_id;
	if v_count <> 3 then
		raise exception 'TEST_JOINT_EXPECTED_3_ALLOCATIONS_GOT_%', v_count;
	end if;

	-- Un profesional secundario puede ver el único turno de su equipo; un
	-- usuario ajeno no obtiene acceso.
	perform set_config(
		'request.jwt.claims',
		jsonb_build_object('sub', v_professional_user_id, 'role', 'authenticated')::text,
		true
	);
	if not public.user_can_read_appointment(v_business_id, v_joint_id) then
		raise exception 'TEST_SECONDARY_PROFESSIONAL_CANNOT_READ_JOINT_APPOINTMENT';
	end if;
	perform set_config(
		'request.jwt.claims',
		jsonb_build_object('sub', v_outsider_user_id, 'role', 'authenticated')::text,
		true
	);
	if public.user_can_read_appointment(v_business_id, v_joint_id) then
		raise exception 'TEST_OUTSIDER_CAN_READ_JOINT_APPOINTMENT';
	end if;

	select public.get_public_booking_active_future_count_for_request(
		v_business_id,
		v_patient_joint,
		'Paciente Conjunto',
		null,
		statement_timestamp()
	)
	into v_count;
	if v_count <> 1 then
		raise exception 'TEST_JOINT_RATE_LIMIT_EXPECTED_1_GOT_%', v_count;
	end if;

	-- El resto de esta sección valida invariantes transaccionales desde el rol
	-- de backend. No debe heredar el JWT del usuario ajeno usado para probar la
	-- lectura anterior, porque el trigger de defensa de roles debe bloquearlo.
	perform set_config('request.jwt.claims', '{}', true);

	-- Cualquier profesional del equipo bloquea el horario completo.
	begin
		insert into public.appointments (
			business_id,
			patient_id,
			service_id,
			professional_id,
			starts_at,
			ends_at,
			blocking_starts_at,
			blocking_ends_at,
			status,
			source,
			service_name_snapshot,
			professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id,
			v_patient_overlap,
			v_service_id,
			v_professional_2,
			v_start,
			v_start + interval '30 minutes',
			v_start,
			v_start + interval '30 minutes',
			'reserved',
			'manual',
			'Pendiente',
			'Pendiente',
			30
		);
		raise exception 'TEST_EXPECTED_TEAM_OVERLAP';
	exception when exclusion_violation then
		null;
	end;

	-- Si el último profesional no puede reservarse, toda la creación se revierte.
	insert into public.appointments (
		business_id,
		patient_id,
		service_id,
		professional_id,
		starts_at,
		ends_at,
		blocking_starts_at,
		blocking_ends_at,
		status,
		source,
		service_name_snapshot,
		professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id,
		v_patient_block,
		v_service_id,
		v_professional_3,
		v_start + interval '1 day',
		v_start + interval '1 day 30 minutes',
		v_start + interval '1 day',
		v_start + interval '1 day 30 minutes',
		'reserved',
		'manual',
		'Pendiente',
		'Pendiente',
		30
	)
	returning id into v_block_id;

	select count(*)::integer
	into v_count
	from public.appointment_professionals allocation
	where allocation.business_id = v_business_id
		and allocation.appointment_id = v_block_id
		and allocation.is_primary = true;
	if v_count <> 1 then
		raise exception 'TEST_INDIVIDUAL_EXPECTED_ONE_PRIMARY_ALLOCATION_GOT_%', v_count;
	end if;

	begin
		perform public.create_joint_appointment(
			v_business_id,
			v_patient_partial,
			v_service_id,
			array[v_professional_1, v_professional_2, v_professional_3],
			v_start + interval '1 day',
			null,
			v_owner_id,
			false
		);
		raise exception 'TEST_EXPECTED_ATOMIC_TEAM_FAILURE';
	exception when exclusion_violation then
		null;
	end;

	select count(*)::integer
	into v_count
	from public.appointments appointment
	where appointment.business_id = v_business_id
		and appointment.patient_id = v_patient_partial;
	if v_count <> 0 then
		raise exception 'TEST_PARTIAL_APPOINTMENT_WAS_PERSISTED';
	end if;

	-- Una reprogramación también actualiza todas las agendas o ninguna.
	insert into public.appointments (
		business_id,
		patient_id,
		service_id,
		professional_id,
		starts_at,
		ends_at,
		blocking_starts_at,
		blocking_ends_at,
		status,
		source,
		service_name_snapshot,
		professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id,
		v_patient_overlap,
		v_service_id,
		v_professional_2,
		v_start + interval '2 days',
		v_start + interval '2 days 30 minutes',
		v_start + interval '2 days',
		v_start + interval '2 days 30 minutes',
		'reserved',
		'manual',
		'Pendiente',
		'Pendiente',
		30
	);

	select starts_at into v_original_start
	from public.appointments
	where id = v_joint_id;

	begin
		update public.appointments
		set
			starts_at = v_start + interval '2 days',
			ends_at = v_start + interval '2 days 30 minutes'
		where id = v_joint_id;
		raise exception 'TEST_EXPECTED_ATOMIC_RESCHEDULE_FAILURE';
	exception when exclusion_violation then
		null;
	end;

	if (select starts_at from public.appointments where id = v_joint_id) <> v_original_start then
		raise exception 'TEST_APPOINTMENT_MOVED_PARTIALLY';
	end if;
	if exists (
		select 1
		from public.appointment_professionals allocation
		where allocation.appointment_id = v_joint_id
			and allocation.starts_at <> v_original_start
	) then
		raise exception 'TEST_TEAM_ALLOCATION_MOVED_PARTIALLY';
	end if;

	-- Descanso 23: el turno normal adyacente falla; la excepción manual entra
	-- exactamente al terminar porque no existe una superposición real.
	insert into public.appointments (
		business_id,
		patient_id,
		service_id,
		professional_id,
		starts_at,
		ends_at,
		blocking_starts_at,
		blocking_ends_at,
		status,
		source,
		service_name_snapshot,
		professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id,
		v_patient_break_1,
		v_service_id,
		v_professional_1,
		v_start + interval '3 days',
		v_start + interval '3 days 30 minutes',
		v_start + interval '3 days',
		v_start + interval '3 days 30 minutes',
		'reserved',
		'manual',
		'Pendiente',
		'Pendiente',
		30
	);

	begin
		insert into public.appointments (
			business_id,
			patient_id,
			service_id,
			professional_id,
			starts_at,
			ends_at,
			blocking_starts_at,
			blocking_ends_at,
			status,
			source,
			service_name_snapshot,
			professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id,
			v_patient_break_2,
			v_service_id,
			v_professional_1,
			v_start + interval '3 days 30 minutes',
			v_start + interval '3 days 60 minutes',
			v_start + interval '3 days 30 minutes',
			v_start + interval '3 days 60 minutes',
			'reserved',
			'manual',
			'Pendiente',
			'Pendiente',
			30
		);
		raise exception 'TEST_EXPECTED_BREAK_OVERLAP';
	exception when exclusion_violation then
		null;
	end;

	-- Ignorar el descanso no permite solapar ni un minuto de atención real.
	begin
		insert into public.appointments (
			business_id,
			patient_id,
			service_id,
			professional_id,
			starts_at,
			ends_at,
			blocking_starts_at,
			blocking_ends_at,
			status,
			source,
			service_name_snapshot,
			professional_name_snapshot,
			duration_minutes_snapshot,
			ignore_break
		)
		values (
			v_business_id,
			v_patient_break_2,
			v_service_id,
			v_professional_1,
			v_start + interval '3 days 29 minutes',
			v_start + interval '3 days 59 minutes',
			v_start + interval '3 days 29 minutes',
			v_start + interval '3 days 59 minutes',
			'reserved',
			'manual',
			'Pendiente',
			'Pendiente',
			30,
			true
		);
		raise exception 'TEST_EXPECTED_REAL_OVERLAP_WITH_MANUAL_OVERRIDE';
	exception when exclusion_violation then
		null;
	end;

	insert into public.appointments (
		business_id,
		patient_id,
		service_id,
		professional_id,
		starts_at,
		ends_at,
		blocking_starts_at,
		blocking_ends_at,
		status,
		source,
		service_name_snapshot,
		professional_name_snapshot,
		duration_minutes_snapshot,
		ignore_break
	)
	values (
		v_business_id,
		v_patient_break_2,
		v_service_id,
		v_professional_1,
		v_start + interval '3 days 30 minutes',
		v_start + interval '3 days 60 minutes',
		v_start + interval '3 days 30 minutes',
		v_start + interval '3 days 60 minutes',
		'reserved',
		'manual',
		'Pendiente',
		'Pendiente',
		30,
		true
	);

	-- Cero minutos habilita dos turnos consecutivos sin excepción.
	update public.availability_rules
	set break_minutes = 0
	where business_id = v_business_id
		and professional_id = v_professional_1;

	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_patient_zero_1, v_service_id, v_professional_1,
		v_start + interval '4 days', v_start + interval '4 days 30 minutes',
		v_start + interval '4 days', v_start + interval '4 days 30 minutes',
		'reserved', 'manual', 'Pendiente', 'Pendiente', 30
	);
	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_patient_zero_2, v_service_id, v_professional_1,
		v_start + interval '4 days 30 minutes', v_start + interval '4 days 60 minutes',
		v_start + interval '4 days 30 minutes', v_start + interval '4 days 60 minutes',
		'reserved', 'manual', 'Pendiente', 'Pendiente', 30
	);

	-- Una reserva pública no puede ignorar el descanso por sí sola. Recepción
	-- sí puede activar la excepción al reprogramarla manualmente y dejar su
	-- usuario registrado en updated_by_user_id.
	begin
		insert into public.appointments (
			business_id, patient_id, service_id, professional_id,
			starts_at, ends_at, blocking_starts_at, blocking_ends_at,
			status, source, service_name_snapshot, professional_name_snapshot,
			duration_minutes_snapshot, ignore_break
		)
		values (
			v_business_id, v_patient_zero_1, v_service_id, v_professional_2,
			v_start + interval '5 days', v_start + interval '5 days 30 minutes',
			v_start + interval '5 days', v_start + interval '5 days 30 minutes',
			'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30, true
		);
		raise exception 'TEST_PUBLIC_BOOKING_MUST_NOT_SELF_OVERRIDE_BREAK';
	exception when check_violation then
		null;
	end;

	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_patient_zero_1, v_service_id, v_professional_2,
		v_start + interval '5 days', v_start + interval '5 days 30 minutes',
		v_start + interval '5 days', v_start + interval '5 days 30 minutes',
		'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
	)
	returning id into v_public_id;

	update public.appointments
	set ignore_break = true, updated_by_user_id = v_owner_id
	where id = v_public_id;
	if not (select ignore_break from public.appointments where id = v_public_id) then
		raise exception 'TEST_AUTHORIZED_PUBLIC_RESCHEDULE_OVERRIDE_WAS_NOT_SAVED';
	end if;

	raise notice 'PASS: joint appointment is single, team allocation is atomic, reschedule is atomic, overlap is global, flexible break and manual override are enforced';
end;
$$;

select extensions.pass('joint appointments contract');
select * from extensions.finish();

rollback;
