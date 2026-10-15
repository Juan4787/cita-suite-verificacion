-- Transactional integration test for the device-level push contract.

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_id uuid;
	v_patient_id uuid;
	v_appointment_one uuid;
	v_appointment_two uuid;
	v_subscription_one uuid;
	v_delivery_id uuid;
	v_now timestamptz := statement_timestamp();
	v_confirmed_at timestamptz := statement_timestamp() + interval '1 minute';
	v_saved record;
	v_device record;
begin
	insert into auth.users (id, email)
	values (v_owner_id, 'push-device-' || gen_random_uuid()::text || '@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba dispositivo Web Push',
		'push-device-' || gen_random_uuid()::text,
		'odontology',
		'America/Argentina/Buenos_Aires'
	)
	returning id into v_business_id;

	insert into public.services (business_id, name, duration_minutes)
	values (v_business_id, 'Consulta', 30)
	returning id into v_service_id;

	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional de prueba')
	returning id into v_professional_id;

	insert into public.professional_services (business_id, professional_id, service_id)
	values (v_business_id, v_professional_id, v_service_id);

	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Paciente de prueba')
	returning id into v_patient_id;

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
		v_patient_id,
		v_service_id,
		v_professional_id,
		v_now + interval '10 hours',
		v_now + interval '10 hours 30 minutes',
		v_now + interval '10 hours',
		v_now + interval '10 hours 30 minutes',
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_appointment_one;

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
		v_patient_id,
		v_service_id,
		v_professional_id,
		v_now + interval '12 hours',
		v_now + interval '12 hours 30 minutes',
		v_now + interval '12 hours',
		v_now + interval '12 hours 30 minutes',
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_appointment_two;

	select *
	into v_saved
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment_one,
		'https://push.example/device-contract',
		'key-one',
		'auth-one',
		'Android test',
		v_now
	);

	if v_saved.test_suppressed or v_saved.verification_confirmed_at is not null then
		raise exception 'TEST_NEW_DEVICE_SKIPPED_INITIAL_TEST';
	end if;
	v_subscription_one := v_saved.subscription_id;

	insert into public.push_delivery_attempts (
		business_id,
		appointment_id,
		subscription_id,
		kind,
		receipt_token_hash,
		accepted_at,
		expires_at
	)
	values (
		v_business_id,
		v_appointment_one,
		v_subscription_one,
		'test',
		repeat('a', 64),
		v_now,
		v_now + interval '5 minutes'
	)
	returning id into v_delivery_id;

	if not public.record_push_test_feedback(
		v_appointment_one,
		v_delivery_id,
		true,
		v_confirmed_at
	) then
		raise exception 'TEST_CONFIRMATION_WAS_NOT_RECORDED';
	end if;

	select *
	into v_saved
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment_two,
		'https://push.example/device-contract',
		'key-one',
		'auth-one',
		'Android test',
		v_confirmed_at + interval '1 minute'
	);

	if not v_saved.test_suppressed
		or v_saved.verification_confirmed_at is distinct from v_confirmed_at
	then
		raise exception 'TEST_CONFIRMATION_WAS_NOT_REUSED_BY_SECOND_APPOINTMENT';
	end if;

	-- El cambio de claves es una razon tecnica real, pero las 48 horas son un
	-- bloqueo absoluto. La razon queda pendiente sin repetir la prueba ahora.
	select *
	into v_saved
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment_two,
		'https://push.example/device-contract',
		'key-two',
		'auth-two',
		'Android test',
		v_confirmed_at + interval '2 minutes'
	);

	if not v_saved.test_suppressed then
		raise exception 'TEST_48_HOUR_GUARD_WAS_NOT_ABSOLUTE';
	end if;

	select *
	into v_saved
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment_two,
		'https://push.example/device-contract',
		'key-two',
		'auth-two',
		'Android test',
		v_confirmed_at + interval '49 hours'
	);

	if v_saved.test_suppressed then
		raise exception 'TEST_TECHNICAL_REASON_DID_NOT_ENABLE_LATER_TEST';
	end if;

	perform public.mark_push_device_gone(
		'https://push.example/device-contract',
		v_confirmed_at + interval '50 hours'
	);

	select
		device.provider_gone_at,
		count(subscription.id) filter (where subscription.detached_at is null) as attached_links
	into v_device
	from public.push_devices device
	left join public.push_subscriptions subscription on subscription.device_id = device.id
	where device.endpoint = 'https://push.example/device-contract'
	group by device.provider_gone_at;

	if v_device.provider_gone_at is null or v_device.attached_links <> 2 then
		raise exception 'TEST_PROVIDER_GONE_REVOKED_APPOINTMENT_LINKS';
	end if;

	if has_function_privilege(
		'anon',
		'public.save_appointment_push_subscription(uuid,uuid,text,text,text,text,timestamptz)',
		'execute'
	) then
		raise exception 'TEST_ANON_CAN_SAVE_PUSH_DEVICE';
	end if;
end;
$$;

select extensions.pass('push device confirmation and endpoint lifecycle are separated');
select * from extensions.finish();

rollback;
