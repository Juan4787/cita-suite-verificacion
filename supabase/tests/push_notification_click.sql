-- Run after 20260805223000_record_push_notification_click.sql.
-- Transactional integration test: no fixture survives the rollback.

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_id uuid;
	v_patient_id uuid;
	v_appointment_id uuid;
	v_subscription_id uuid;
	v_device_id uuid;
	v_delivery_id uuid;
	v_receipt_token text := 'push-click-receipt-token-1234567890abcdef';
	v_receipt_hash text;
	v_click_time timestamptz := statement_timestamp() + interval '1 minute';
	v_claimed_at timestamptz;
	v_count integer;
	v_recorded boolean;
begin
	v_receipt_hash := encode(digest(v_receipt_token, 'sha256'), 'hex');

	insert into auth.users (id, email)
	values (v_owner_id, 'push-click-' || gen_random_uuid()::text || '@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba clic Web Push',
		'push-click-' || gen_random_uuid()::text,
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
		statement_timestamp() + interval '10 hours',
		statement_timestamp() + interval '10 hours 30 minutes',
		statement_timestamp() + interval '10 hours',
		statement_timestamp() + interval '10 hours 30 minutes',
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_appointment_id;

	select saved.subscription_id, saved.device_id
	into v_subscription_id, v_device_id
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment_id,
		'https://push.example/click-test',
		'p256dh-test',
		'auth-test',
		'Android test',
		statement_timestamp()
	) saved;

	-- La entrega automática no depende de verified_at ni del clic.
	select count(*)::integer
	into v_count
	from public.claim_due_push_reminders(statement_timestamp(), 50) claimed
	where claimed.subscription_id = v_subscription_id
		and claimed.reminder_kind = '24h';
	if v_count <> 1 then
		raise exception 'TEST_UNVERIFIED_SUBSCRIPTION_WAS_NOT_CLAIMED';
	end if;

	select push_24h_claimed_at
	into v_claimed_at
	from public.push_subscriptions
	where id = v_subscription_id;

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
		v_appointment_id,
		v_subscription_id,
		'test',
		v_receipt_hash,
		statement_timestamp(),
		statement_timestamp() + interval '5 minutes'
	)
	returning id into v_delivery_id;

	v_recorded := public.record_push_notification_click(
		v_appointment_id,
		v_delivery_id,
		repeat('0', 64),
		v_click_time
	);
	if v_recorded or exists (
		select 1
		from public.push_delivery_attempts
		where id = v_delivery_id and clicked_at is not null
	) then
		raise exception 'TEST_INVALID_RECEIPT_HASH_RECORDED_CLICK';
	end if;

	v_recorded := public.record_push_notification_click(
		v_appointment_id,
		v_delivery_id,
		v_receipt_hash,
		v_click_time
	);
	if not v_recorded then
		raise exception 'TEST_CLICK_WAS_NOT_RECORDED';
	end if;

	if not exists (
		select 1
		from public.push_delivery_attempts delivery
		where delivery.id = v_delivery_id
			and delivery.received_at = v_click_time
			and delivery.displayed_at = v_click_time
			and delivery.clicked_at = v_click_time
			and delivery.user_confirmed_at is null
			and delivery.user_reported_missing_at is null
	) then
		raise exception 'TEST_CLICK_STAGES_ARE_INCONSISTENT';
	end if;

	if not exists (
		select 1
		from public.push_subscriptions subscription
		join public.push_devices device on device.id = subscription.device_id
		where subscription.id = v_subscription_id
			and subscription.device_id = v_device_id
			and subscription.detached_at is null
			and device.last_notification_clicked_at = v_click_time
			and device.provider_gone_at is null
			and subscription.push_24h_claimed_at = v_claimed_at
	) then
		raise exception 'TEST_CLICK_DID_NOT_VERIFY_WITHOUT_CONSUMING_REMINDER';
	end if;

	-- Una respuesta negativa tardía sobre la misma prueba no puede borrar el clic.
	v_recorded := public.record_push_test_feedback(
		v_appointment_id,
		v_delivery_id,
		false,
		v_click_time + interval '1 minute'
	);
	if not v_recorded then
		raise exception 'TEST_LATE_FEEDBACK_WAS_NOT_PROCESSED';
	end if;
	if not exists (
		select 1
		from public.push_subscriptions subscription
		join public.push_devices device on device.id = subscription.device_id
		join public.push_delivery_attempts delivery
			on delivery.subscription_id = subscription.id
		where subscription.id = v_subscription_id
			and device.last_notification_clicked_at = v_click_time
			and delivery.id = v_delivery_id
			and delivery.clicked_at = v_click_time
			and delivery.user_reported_missing_at is null
	) then
		raise exception 'TEST_LATE_NEGATIVE_FEEDBACK_OVERWROTE_CLICK';
	end if;

	-- Reprogramar invalida el claim anterior y el mismo endpoint vuelve a quedar
	-- elegible usando el starts_at nuevo, aunque la cobertura manual ya esté verificada.
	update public.appointments
	set starts_at = starts_at + interval '2 hours',
		ends_at = ends_at + interval '2 hours',
		blocking_starts_at = blocking_starts_at + interval '2 hours',
		blocking_ends_at = blocking_ends_at + interval '2 hours'
	where id = v_appointment_id;

	if exists (
		select 1
		from public.push_subscriptions
		where id = v_subscription_id
			and (
				push_24h_claimed_at is not null
				or push_24h_sent_at is not null
				or push_2h_claimed_at is not null
				or push_2h_sent_at is not null
			)
	) then
		raise exception 'TEST_RESCHEDULE_DID_NOT_RESET_OLD_REMINDERS';
	end if;

	select count(*)::integer
	into v_count
	from public.claim_due_push_reminders(statement_timestamp(), 50) claimed
	where claimed.subscription_id = v_subscription_id
		and claimed.reminder_kind = '24h';
	if v_count <> 1 then
		raise exception 'TEST_RESCHEDULED_TIME_WAS_NOT_RECLAIMED';
	end if;

	-- Un aviso histórico no debe resucitar un endpoint que el proveedor declaró muerto.
	perform public.mark_push_device_gone(
		'https://push.example/click-test',
		v_click_time + interval '2 minutes'
	);
	perform public.record_push_notification_click(
		v_appointment_id,
		v_delivery_id,
		v_receipt_hash,
		v_click_time + interval '3 minutes'
	);
	if exists (
		select 1
		from public.push_devices
		where id = v_device_id and provider_gone_at is null
	) then
		raise exception 'TEST_OLD_CLICK_REVIVED_PROVIDER_GONE_DEVICE';
	end if;

	if has_function_privilege(
		'anon',
		'public.record_push_notification_click(uuid,uuid,text,timestamptz)',
		'execute'
	) then
		raise exception 'TEST_ANON_CAN_RECORD_PUSH_CLICK';
	end if;
	if not has_function_privilege(
		'service_role',
		'public.record_push_notification_click(uuid,uuid,text,timestamptz)',
		'execute'
	) then
		raise exception 'TEST_SERVICE_ROLE_CANNOT_RECORD_PUSH_CLICK';
	end if;

	raise notice 'PASS: push click verifies the device without gating or consuming automatic reminders.';
end;
$$;

select extensions.pass('push notification click contract');
select * from extensions.finish();

rollback;
