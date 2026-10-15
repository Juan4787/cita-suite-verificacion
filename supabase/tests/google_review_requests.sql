-- Transactional integration test for review scheduling, invalidation, cooldown
-- and click tracking. No fixture survives the rollback.

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_id uuid;
	v_patient_id uuid;
	v_second_patient_id uuid;
	v_appointment_id uuid;
	v_second_appointment_id uuid;
	v_third_appointment_id uuid;
	v_fourth_appointment_id uuid;
	v_subscription_id uuid;
	v_delivery_id uuid;
	v_request record;
	v_claim record;
	v_prepared record;
	v_now timestamptz := statement_timestamp();
	v_original_ends_at timestamptz;
	v_new_ends_at timestamptz;
	v_send_time timestamptz;
	v_unknown_recovery_time timestamptz;
	v_click_hash text := repeat('b', 64);
	v_count integer;
	v_completed boolean;
begin
	insert into auth.users (id, email)
	values (v_owner_id, 'google-review-' || gen_random_uuid()::text || '@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba resenas Google',
		'google-review-' || gen_random_uuid()::text,
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

	insert into public.patients (owner_id, business_id, full_name)
	values (v_owner_id, v_business_id, 'Segundo paciente de prueba')
	returning id into v_second_patient_id;

	insert into public.google_review_settings (
		business_id,
		enabled,
		review_url
	)
	values (
		v_business_id,
		true,
		'https://g.page/r/test/review'
	);

	begin
		update public.google_review_settings
		set review_url = 'https://example.test/not-google'
		where business_id = v_business_id;
		raise exception 'TEST_EXTERNAL_REVIEW_REDIRECT_WAS_ACCEPTED';
	exception
		when check_violation then null;
	end;

	v_original_ends_at := v_now + interval '10 hours 30 minutes';
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
		v_original_ends_at,
		v_now + interval '10 hours',
		v_original_ends_at,
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_appointment_id;

	select request.*
	into v_request
	from public.google_review_requests request
	where request.appointment_id = v_appointment_id
		and request.status = 'pending';

	if not found
		or v_request.appointment_ends_at is distinct from v_original_ends_at
		or v_request.scheduled_for is distinct from v_original_ends_at + interval '2 hours'
	then
		raise exception 'TEST_REVIEW_WAS_NOT_SCHEDULED_AT_END_PLUS_TWO_HOURS';
	end if;

	-- Reprogramar invalida la fila anterior y crea exactamente una nueva para el
	-- horario actual.
	v_new_ends_at := v_original_ends_at + interval '1 day';
	update public.appointments appointment
	set
		starts_at = appointment.starts_at + interval '1 day',
		ends_at = appointment.ends_at + interval '1 day',
		blocking_starts_at = appointment.blocking_starts_at + interval '1 day',
		blocking_ends_at = appointment.blocking_ends_at + interval '1 day'
	where appointment.id = v_appointment_id;

	select count(*)::integer
	into v_count
	from public.google_review_requests request
	where request.appointment_id = v_appointment_id
		and request.status = 'superseded'
		and request.appointment_ends_at = v_original_ends_at;
	if v_count <> 1 then
		raise exception 'TEST_OLD_REVIEW_WAS_NOT_SUPERSEDED';
	end if;

	select request.*
	into v_request
	from public.google_review_requests request
	where request.appointment_id = v_appointment_id
		and request.status = 'pending';
	if not found
		or v_request.appointment_ends_at is distinct from v_new_ends_at
		or v_request.scheduled_for is distinct from v_new_ends_at + interval '2 hours'
	then
		raise exception 'TEST_RESCHEDULED_REVIEW_HAS_WRONG_TIME';
	end if;

	select saved.subscription_id
	into v_subscription_id
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment_id,
		'https://push.example/google-review',
		'review-key',
		'review-auth',
		'Android review test',
		v_now
	) saved;

	v_send_time := v_new_ends_at + interval '2 hours 1 minute';
	select claimed.*
	into v_claim
	from public.claim_due_google_review_requests(v_send_time, 20) claimed
	where claimed.appointment_id = v_appointment_id;

	if not found
		or v_claim.subscription_id is distinct from v_subscription_id
		or v_claim.scheduled_for is distinct from v_new_ends_at + interval '2 hours'
	then
		raise exception 'TEST_DUE_REVIEW_WAS_NOT_CLAIMED';
	end if;

	-- Si un worker cae, el lease vencido vuelve a quedar disponible y libera el
	-- candado del paciente; no deja la única solicitud vigente congelada.
	update public.google_review_requests
	set claim_expires_at = v_send_time - interval '1 minute'
	where id = v_claim.request_id;
	update public.google_review_patient_delivery_state
	set claim_expires_at = v_send_time - interval '1 minute'
	where business_id = v_business_id and patient_id = v_patient_id;
	select public.recover_expired_google_review_request_claims(v_send_time)
	into v_count;
	if v_count <> 1 or not exists (
		select 1
		from public.google_review_requests request
		where request.id = v_claim.request_id
			and request.status = 'pending'
			and request.claim_token is null
	) then
		raise exception 'TEST_EXPIRED_REVIEW_CLAIM_WAS_NOT_RECOVERED';
	end if;

	select claimed.*
	into v_claim
	from public.claim_due_google_review_requests(v_send_time, 20) claimed
	where claimed.appointment_id = v_appointment_id;
	if not found then
		raise exception 'TEST_RECOVERED_REVIEW_WAS_NOT_RECLAIMED';
	end if;

	select prepared.*
	into v_prepared
	from public.prepare_google_review_request_delivery(
		v_claim.request_id,
		v_claim.claim_token,
		v_claim.subscription_id,
		v_click_hash,
		v_send_time
	) prepared;

	if not found
		or v_prepared.review_url <> 'https://g.page/r/test/review'
		or v_prepared.notification_title <> '✨ Esperamos que hayas tenido una buena experiencia con nosotros.'
		or v_prepared.notification_body <> 'Si querés, compartí tu opinión en Google. Puede ayudar a otros que estén buscando dónde atenderse.'
		or v_prepared.notification_action_label <> 'Compartir mi opinión'
	then
		raise exception 'TEST_REVIEW_MESSAGE_SNAPSHOT_IS_INCONSISTENT';
	end if;

	-- Una apertura extremadamente rapida puede llegar antes de que el worker
	-- termine de guardar sent_at. Debe registrarse y conservarse al completar.
	select count(*)::integer
	into v_count
	from public.record_google_review_click(v_click_hash, v_send_time + interval '1 second');
	if v_count <> 1 then
		raise exception 'TEST_REVIEW_CLICK_WAS_NOT_RECORDED';
	end if;

	insert into public.push_delivery_attempts (
		business_id,
		appointment_id,
		subscription_id,
		kind,
		google_review_request_id,
		receipt_token_hash,
		accepted_at,
		push_service_status,
		expires_at
	)
	values (
		v_business_id,
		v_appointment_id,
		v_subscription_id,
		'review',
		v_claim.request_id,
		repeat('c', 64),
		v_send_time + interval '1 second',
		201,
		v_send_time + interval '1 day'
	)
	returning id into v_delivery_id;

	v_completed := public.complete_google_review_request(
		v_claim.request_id,
		v_claim.claim_token,
		v_delivery_id,
		201,
		v_send_time + interval '2 seconds'
	);
	if not v_completed then
		raise exception 'TEST_REVIEW_SEND_WAS_NOT_COMPLETED';
	end if;

	if not exists (
		select 1
		from public.google_review_requests request
		where request.id = v_claim.request_id
			and request.status = 'clicked'
			and request.sent_at = v_send_time + interval '2 seconds'
			and request.clicked_at = v_send_time + interval '1 second'
	) then
		raise exception 'TEST_SENT_AND_CLICKED_TIMES_WERE_NOT_PRESERVED';
	end if;

	-- Otro turno del mismo paciente dentro de 180 dias se salta. La igualdad
	-- exacta a 180 dias queda habilitada y se comprueba con el segundo paciente.
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
		v_now + interval '3 days',
		v_now + interval '3 days 30 minutes',
		v_now + interval '3 days',
		v_now + interval '3 days 30 minutes',
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_second_appointment_id;

	perform public.save_appointment_push_subscription(
		v_business_id,
		v_second_appointment_id,
		'https://push.example/google-review',
		'review-key',
		'review-auth',
		'Android review test',
		v_now + interval '1 minute'
	);

	perform *
	from public.claim_due_google_review_requests(v_now + interval '3 days 3 hours', 20);

	if not exists (
		select 1
		from public.google_review_requests request
		where request.appointment_id = v_second_appointment_id
			and request.status = 'skipped'
			and request.status_reason = 'patient_cooldown'
	) then
		raise exception 'TEST_180_DAY_COOLDOWN_WAS_NOT_APPLIED';
	end if;

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
		v_second_patient_id,
		v_service_id,
		v_professional_id,
		v_now + interval '5 days',
		v_now + interval '5 days 30 minutes',
		v_now + interval '5 days',
		v_now + interval '5 days 30 minutes',
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_third_appointment_id;

	perform public.save_appointment_push_subscription(
		v_business_id,
		v_third_appointment_id,
		'https://push.example/google-review-second-patient',
		'review-key-two',
		'review-auth-two',
		'Android review test',
		v_now + interval '2 minutes'
	);

	insert into public.google_review_patient_delivery_state (
		business_id,
		patient_id,
		last_sent_at
	)
	values (
		v_business_id,
		v_second_patient_id,
		v_now + interval '5 days 2 hours 30 minutes' - interval '180 days'
	)
	on conflict (business_id, patient_id) do update
	set last_sent_at = excluded.last_sent_at;

	select count(*)::integer
	into v_count
	from public.claim_due_google_review_requests(
		v_now + interval '5 days 2 hours 30 minutes',
		20
	) claimed
	where claimed.appointment_id = v_third_appointment_id;
	if v_count <> 1 then
		raise exception 'TEST_EXACT_180_DAY_BOUNDARY_WAS_NOT_ELIGIBLE';
	end if;

	-- Cancelar nunca borra el dispositivo: solamente invalida la solicitud.
	update public.appointments
	set status = 'cancelled', cancelled_at = v_now
	where id = v_third_appointment_id;

	if not exists (
		select 1
		from public.google_review_requests request
		where request.appointment_id = v_third_appointment_id
			and request.status = 'cancelled'
			and request.status_reason = 'appointment_cancelled'
	) or not exists (
		select 1
		from public.push_subscriptions subscription
		where subscription.appointment_id = v_third_appointment_id
			and subscription.detached_at is null
	) then
			raise exception 'TEST_CANCELLATION_REVOKED_DEVICE_OR_LEFT_REVIEW_ACTIVE';
	end if;

	-- Si el worker cae con un delivery creado pero sin resultado durable, el
	-- vencimiento no puede dejarlo congelado ni arriesgar un segundo envio.
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
		v_second_patient_id,
		v_service_id,
		v_professional_id,
		v_now + interval '7 days',
		v_now + interval '7 days 30 minutes',
		v_now + interval '7 days',
		v_now + interval '7 days 30 minutes',
		'reserved',
		'manual',
		'Consulta',
		'Profesional de prueba',
		30
	)
	returning id into v_fourth_appointment_id;

	select saved.subscription_id
	into v_subscription_id
	from public.save_appointment_push_subscription(
		v_business_id,
		v_fourth_appointment_id,
		'https://push.example/google-review-second-patient',
		'review-key-two',
		'review-auth-two',
		'Android review test',
		v_now + interval '3 minutes'
	) saved;

	v_unknown_recovery_time := v_now + interval '7 days 2 hours 41 minutes';
	select claimed.*
	into v_claim
	from public.claim_due_google_review_requests(
		v_unknown_recovery_time - interval '11 minutes',
		20
	) claimed
	where claimed.appointment_id = v_fourth_appointment_id;
	if not found then
		raise exception 'TEST_UNKNOWN_OUTCOME_REVIEW_WAS_NOT_CLAIMED';
	end if;

	insert into public.push_delivery_attempts (
		business_id,
		appointment_id,
		subscription_id,
		kind,
		google_review_request_id,
		receipt_token_hash,
		expires_at
	)
	values (
		v_business_id,
		v_fourth_appointment_id,
		v_subscription_id,
		'review',
		v_claim.request_id,
		repeat('d', 64),
		v_unknown_recovery_time + interval '1 day'
	)
	returning id into v_delivery_id;

	update public.google_review_requests
	set claim_expires_at = v_unknown_recovery_time - interval '1 minute'
	where id = v_claim.request_id;
	update public.google_review_patient_delivery_state
	set claim_expires_at = v_unknown_recovery_time - interval '1 minute'
	where business_id = v_business_id and patient_id = v_second_patient_id;

	select public.recover_expired_google_review_request_claims(v_unknown_recovery_time)
	into v_count;
	if v_count <> 1
		or not exists (
			select 1
			from public.google_review_requests request
			where request.id = v_claim.request_id
				and request.status = 'failed'
				and request.status_reason = 'delivery_outcome_unknown'
		)
		or not exists (
			select 1
			from public.push_delivery_attempts delivery
			where delivery.id = v_delivery_id
				and delivery.failed_at = v_unknown_recovery_time
		)
		or not exists (
			select 1
			from public.google_review_patient_delivery_state state
			where state.business_id = v_business_id
				and state.patient_id = v_second_patient_id
				and state.last_sent_at = v_unknown_recovery_time
				and state.active_request_id is null
		)
	then
		raise exception 'TEST_UNKNOWN_DELIVERY_WAS_NOT_CLOSED_CONSERVATIVELY';
	end if;

	select count(*)::integer
	into v_count
	from public.claim_due_google_review_requests(v_unknown_recovery_time, 20) claimed
	where claimed.appointment_id = v_fourth_appointment_id;
	if v_count <> 0 then
		raise exception 'TEST_UNKNOWN_DELIVERY_WAS_RETRIED';
	end if;

	if has_function_privilege(
		'anon',
		'public.claim_due_google_review_requests(timestamptz,integer)',
		'execute'
	) then
		raise exception 'TEST_ANON_CAN_CLAIM_REVIEWS';
	end if;
end;
$$;

select extensions.pass('Google review requests preserve current schedule, cooldown and click tracking');
select * from extensions.finish();

rollback;
