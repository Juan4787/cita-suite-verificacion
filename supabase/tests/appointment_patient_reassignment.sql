-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/appointment_patient_reassignment.sql

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_service_id uuid;
	v_professional_id uuid;
	v_old_patient_id uuid;
	v_new_patient_id uuid;
	v_appointment record;
	v_public_appointment record;
	v_subscription_id uuid;
	v_device_id uuid;
	v_superseded_queue_id uuid;
	v_calendar_connection_id uuid;
	v_result record;
	v_old_confirmation_token text;
	v_old_contact_key text;
	v_old_created_at timestamptz;
	v_old_activity_at timestamptz;
	v_start timestamptz := date_trunc('day', statement_timestamp()) + interval '50 days 10 hours';
	v_count integer;
	v_error text;
	i integer;
begin
	insert into auth.users (id, email)
	values (v_owner_id, 'appointment-reassignment@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'Prueba reasignación',
		'appointment-reassignment-' || gen_random_uuid()::text,
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

	insert into public.patients (
		owner_id, business_id, full_name, phone_e164, created_at, activity_at
	)
	values (
		v_owner_id, v_business_id, 'Juan Carlos', '+5493425048209',
		statement_timestamp() - interval '10 days', statement_timestamp() - interval '10 days'
	)
	returning id, created_at into v_old_patient_id, v_old_created_at;

	insert into public.patients (owner_id, business_id, full_name, phone_raw, phone_e164)
	values (v_owner_id, v_business_id, 'Juan Pedro', '342 504 8209', '+5493425048209')
	returning id into v_new_patient_id;

	select created.* into v_appointment
	from public.create_appointment_with_patient_identity(
		v_business_id, 'existing', v_old_patient_id, null, '342 504 8209', '+5493425048209', null,
		false, null, v_service_id, array[v_professional_id], v_start, null,
		v_owner_id, false, 'manual', 'valid', false,
		'a3000000-0000-4000-8000-000000000001'
	) created;
	v_old_confirmation_token := v_appointment.confirmation_token;

	update public.appointments appointment
	set
		calendar_action_status = 'synced_google',
		calendar_provider = 'google',
		calendar_action_at = statement_timestamp(),
		calendar_action_count = 1,
		calendar_sequence = 2
	where appointment.id = v_appointment.id;

	insert into public.message_dispatches (
		business_id, appointment_id, patient_id, provider, channel, type,
		to_phone_e164, status, scheduled_for, template_variables
	)
	values (
		v_business_id, v_appointment.id, v_old_patient_id, 'mock', 'whatsapp',
		'appointment_reminder_24h', '+5493425048209', 'queued', v_start - interval '24 hours', '[]'::jsonb
	);
	insert into public.message_dispatches (
		business_id, appointment_id, patient_id, provider, channel, type,
		to_phone_e164, status, sent_at, template_variables
	)
	values (
		v_business_id, v_appointment.id, v_old_patient_id, 'mock', 'whatsapp',
		'manual_test', '+5493425048209', 'sent', statement_timestamp(), '[]'::jsonb
	);

	select saved.subscription_id, saved.device_id
	into v_subscription_id, v_device_id
	from public.save_appointment_push_subscription(
		v_business_id,
		v_appointment.id,
		'https://push.example.test/reassignment',
		'p256dh',
		'auth',
		'Android test',
		statement_timestamp()
	) saved;
	update public.push_subscriptions
	set
		push_24h_claimed_at = statement_timestamp(),
		push_24h_sent_at = statement_timestamp(),
		push_2h_claimed_at = statement_timestamp(),
		push_2h_sent_at = statement_timestamp()
	where id = v_subscription_id;

	insert into public.push_delivery_attempts (
		business_id, appointment_id, subscription_id, kind, receipt_token_hash,
		accepted_at, expires_at
	)
	values (
		v_business_id, v_appointment.id, v_subscription_id, '24h', repeat('a', 64),
		statement_timestamp(), statement_timestamp() + interval '1 day'
	);

	insert into public.google_calendar_connections (
		oauth_client_key, google_subject, refresh_token_ciphertext, granted_scopes
	)
	values (
		repeat('c', 64), repeat('s', 64), repeat('r', 32),
		array['https://www.googleapis.com/auth/calendar.events.owned']
	)
	returning id into v_calendar_connection_id;
	insert into public.appointment_google_calendar_events (
		business_id, appointment_id, connection_id, event_id, sync_status, synced_sequence
	)
	values (
		v_business_id, v_appointment.id, v_calendar_connection_id,
		'remote-event-reassignment', 'active', 2
	);
	insert into public.google_calendar_oauth_attempts (
		business_id, appointment_id, state_hash, code_verifier_ciphertext, expires_at
	)
	values (
		v_business_id, v_appointment.id, repeat('d', 64), repeat('v', 32),
		statement_timestamp() + interval '10 minutes'
	);

	begin
		perform public.reassign_appointment_patient_safely(
			v_business_id,
			v_appointment.id,
			v_new_patient_id,
			gen_random_uuid(),
			'Actor ajeno al consultorio'
		);
		raise exception 'TEST_EXPECTED_INVALID_REPAIR_ACTOR';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_REASSIGNMENT_ACTOR_INVALID' then
			raise exception 'TEST_WRONG_INVALID_ACTOR_ERROR_%', v_error;
		end if;
	end;

	select repaired.* into v_result
	from public.reassign_appointment_patient_safely(
		v_business_id,
		v_appointment.id,
		v_new_patient_id,
		v_owner_id,
		'El turno se cargó con el nombre equivocado'
	) repaired;

	if v_result.old_patient_id <> v_old_patient_id
		or v_result.new_patient_id <> v_new_patient_id
		or v_result.cancelled_dispatches <> 1
		or v_result.superseded_dispatches <> 2
		or v_result.detached_push_subscriptions <> 1
		or v_result.superseded_push_attempts <> 1
		or v_result.invalidated_calendar_attempts <> 1
		or v_result.queued_calendar_deletions <> 1
	then
		raise exception 'TEST_REASSIGNMENT_RESULT_COUNTS_WRONG';
	end if;

	if not exists (
		select 1
		from public.appointments appointment
		where appointment.id = v_appointment.id
			and appointment.patient_id = v_new_patient_id
			and appointment.patient_name_at_booking = 'Juan Pedro'
			and appointment.patient_phone_raw_at_booking = '342 504 8209'
			and appointment.patient_phone_e164_at_booking = '+5493425048209'
			and appointment.patient_resolution_strategy = 'reassigned_manual'
			and appointment.confirmation_token <> v_old_confirmation_token
			and appointment.calendar_sequence = 3
			and appointment.calendar_action_status = 'not_offered'
			and appointment.calendar_provider is null
			and appointment.calendar_action_count = 0
			and appointment.calendar_update_required_at is null
	) then
		raise exception 'TEST_APPOINTMENT_NOT_FULLY_REASSIGNED';
	end if;

	if not exists (
		select 1
		from public.message_dispatches dispatch
		where dispatch.appointment_id = v_appointment.id
			and dispatch.status = 'cancelled'
			and dispatch.superseded_at is not null
			and dispatch.superseded_reason = 'patient_reassigned'
			and dispatch.cancelled_at is not null
			and dispatch.last_error_code = 'PATIENT_REASSIGNED'
	) then
		raise exception 'TEST_PENDING_DISPATCH_NOT_CANCELLED';
	end if;
	if not exists (
		select 1
		from public.message_dispatches dispatch
		where dispatch.appointment_id = v_appointment.id
			and dispatch.type = 'manual_test'
			and dispatch.status = 'sent'
			and dispatch.superseded_at is not null
	) then
		raise exception 'TEST_SENT_DISPATCH_HISTORY_NOT_SUPERSEDED';
	end if;

	if exists (
		select 1
		from public.push_subscriptions subscription
		where subscription.id = v_subscription_id
			and (
				subscription.push_24h_claimed_at is not null
				or subscription.push_2h_claimed_at is not null
				or subscription.push_24h_sent_at is null
				or subscription.push_2h_sent_at is null
				or subscription.detached_at is null
				or subscription.detached_reason <> 'patient_reassigned'
			)
	) then
		raise exception 'TEST_PUSH_SUBSCRIPTION_NOT_SAFELY_DETACHED';
	end if;
	if not exists (
		select 1
		from public.push_devices device
		where device.id = v_device_id
			and device.provider_gone_at is null
	) then
		raise exception 'TEST_PATIENT_REASSIGNMENT_INVALIDATED_DEVICE';
	end if;
	if not exists (
		select 1 from public.push_delivery_attempts attempt
		where attempt.subscription_id = v_subscription_id
			and attempt.superseded_at is not null
	) then
		raise exception 'TEST_PUSH_ATTEMPT_NOT_SUPERSEDED';
	end if;
	begin
		insert into public.push_delivery_attempts (
			business_id, appointment_id, subscription_id, kind, receipt_token_hash, expires_at
		)
		values (
			v_business_id, v_appointment.id, v_subscription_id, 'test', repeat('b', 64),
			statement_timestamp() + interval '5 minutes'
		);
		raise exception 'TEST_EXPECTED_DETACHED_PUSH_REJECTION';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'PUSH_SUBSCRIPTION_DETACHED' then
			raise exception 'TEST_WRONG_DETACHED_PUSH_ERROR_%', v_error;
		end if;
	end;
	if exists (
		select 1
		from public.google_calendar_oauth_attempts attempt
		where attempt.appointment_id = v_appointment.id
	) then
		raise exception 'TEST_CALENDAR_OAUTH_ATTEMPT_NOT_INVALIDATED';
	end if;
	if not exists (
		select 1
		from public.appointment_google_calendar_events event_link
		where event_link.appointment_id = v_appointment.id
			and event_link.sync_status = 'pending_delete'
			and event_link.claimed_at is null
	) then
		raise exception 'TEST_OLD_CALENDAR_EVENT_NOT_QUEUED_FOR_DELETE';
	end if;

	-- Superseded history no longer occupies the unique active-dispatch slot, so
	-- a fresh reminder for the corrected patient can be generated.
	insert into public.message_dispatches (
		business_id, appointment_id, patient_id, provider, channel, type,
		to_phone_e164, status, scheduled_for, template_variables
	)
	values (
		v_business_id, v_appointment.id, v_new_patient_id, 'mock', 'whatsapp',
		'appointment_reminder_24h', '+5493425048209', 'queued',
		v_start - interval '24 hours', '[]'::jsonb
	);
	insert into public.message_dispatches (
		business_id, appointment_id, patient_id, provider, channel, type,
		to_phone_e164, status, scheduled_for, superseded_at, superseded_reason,
		template_variables
	)
	values (
		v_business_id, v_appointment.id, v_old_patient_id, 'mock', 'whatsapp',
		'manual_test', '+5493425048209', 'queued', statement_timestamp(),
		statement_timestamp(), 'patient_reassigned', '[]'::jsonb
	)
	returning id into v_superseded_queue_id;
	perform public.claim_queued_message_dispatches(100, statement_timestamp());
	if not exists (
		select 1 from public.message_dispatches dispatch
		where dispatch.id = v_superseded_queue_id and dispatch.status = 'queued'
	) then
		raise exception 'TEST_SUPERSEDED_DISPATCH_WAS_RECLAIMED';
	end if;

	select patient.activity_at into v_old_activity_at
	from public.patients patient where patient.id = v_old_patient_id;
	if v_old_activity_at <> v_old_created_at then
		raise exception 'TEST_OLD_PATIENT_ACTIVITY_NOT_RECOMPUTED_%_%', v_old_activity_at, v_old_created_at;
	end if;

	select count(*)::integer into v_count
	from public.audit_logs audit
	where audit.business_id = v_business_id
		and audit.entity_id = v_appointment.id
		and audit.action = 'appointment.patient_reassigned'
		and audit.metadata->>'old_patient_id' = v_old_patient_id::text
		and audit.metadata->>'new_patient_id' = v_new_patient_id::text
		and audit.metadata->>'reason' = 'El turno se cargó con el nombre equivocado';
	if v_count <> 1 then
		raise exception 'TEST_REASSIGNMENT_AUDIT_MISSING';
	end if;

	-- A dispatch already being sent is an explicit stop condition: changing the
	-- patient while a message is in flight could notify the wrong person.
	update public.message_dispatches dispatch
	set status = 'sending', sending_at = statement_timestamp()
	where dispatch.appointment_id = v_appointment.id;
	begin
		perform public.reassign_appointment_patient_safely(
			v_business_id,
			v_appointment.id,
			v_old_patient_id,
			v_owner_id,
			'Intento durante un envío'
		);
		raise exception 'TEST_EXPECTED_IN_FLIGHT_GUARD';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_REASSIGNMENT_MESSAGE_IN_FLIGHT' then
			raise exception 'TEST_WRONG_IN_FLIGHT_ERROR_%', v_error;
		end if;
	end;
	if not exists (
		select 1 from public.appointments appointment
		where appointment.id = v_appointment.id and appointment.patient_id = v_new_patient_id
	) then
		raise exception 'TEST_IN_FLIGHT_GUARD_CHANGED_APPOINTMENT';
	end if;

	update public.message_dispatches dispatch
	set status = 'cancelled', cancelled_at = statement_timestamp()
	where dispatch.appointment_id = v_appointment.id
		and dispatch.status = 'sending';
	update public.push_subscriptions subscription
	set
		detached_at = null,
		detached_reason = null,
		push_24h_claimed_at = statement_timestamp(),
		push_24h_sent_at = null
	where subscription.id = v_subscription_id;
	begin
		perform public.reassign_appointment_patient_safely(
			v_business_id,
			v_appointment.id,
			v_old_patient_id,
			v_owner_id,
			'Intento durante un Push'
		);
		raise exception 'TEST_EXPECTED_PUSH_IN_FLIGHT_GUARD';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_REASSIGNMENT_PUSH_IN_FLIGHT' then
			raise exception 'TEST_WRONG_PUSH_IN_FLIGHT_ERROR_%', v_error;
		end if;
	end;
	update public.push_subscriptions subscription
	set
		detached_at = statement_timestamp(),
		detached_reason = 'patient_reassigned',
		push_24h_claimed_at = null
	where subscription.id = v_subscription_id;

	update public.appointment_google_calendar_events event_link
	set claimed_at = statement_timestamp()
	where event_link.appointment_id = v_appointment.id;
	begin
		perform public.reassign_appointment_patient_safely(
			v_business_id,
			v_appointment.id,
			v_old_patient_id,
			v_owner_id,
			'Intento durante Google Calendar'
		);
		raise exception 'TEST_EXPECTED_CALENDAR_IN_FLIGHT_GUARD';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'APPOINTMENT_REASSIGNMENT_CALENDAR_IN_FLIGHT' then
			raise exception 'TEST_WRONG_CALENDAR_IN_FLIGHT_ERROR_%', v_error;
		end if;
	end;
	update public.appointment_google_calendar_events event_link
	set claimed_at = null
	where event_link.appointment_id = v_appointment.id;

	-- Fill the target patient's capacity (the repaired manual turn plus three
	-- public turns). Historical correction still has to succeed; afterward the
	-- repaired row remains counted by every future booking decision.
	for i in 1..3 loop
		perform public.create_appointment_with_patient_identity(
			v_business_id, 'public', null, 'Juan Pedro', '342 504 8209', '+5493425048209', null,
			false, null, v_service_id, array[v_professional_id],
			v_start + interval '3 days' + make_interval(hours => i), null,
			null, false, 'public_booking', 'valid', false,
			('a3000000-0000-4000-8000-' || lpad((10 + i)::text, 12, '0'))
		);
	end loop;

	-- A repaired public appointment must move its anti-abuse bucket to the new
	-- descriptive snapshot without treating that bucket as patient identity.
	select created.* into v_public_appointment
	from public.create_appointment_with_patient_identity(
		v_business_id, 'public', null, 'Juan Carlos', '342 504 8209', '+5493425048209', null,
		false, null, v_service_id, array[v_professional_id], v_start + interval '2 days', null,
		null, false, 'public_booking', 'valid', false,
		'a3000000-0000-4000-8000-000000000002'
	) created;
	select appointment.public_booking_contact_key into v_old_contact_key
	from public.appointments appointment
	where appointment.id = v_public_appointment.id;

	perform public.reassign_appointment_patient_safely(
		v_business_id,
		v_public_appointment.id,
		v_new_patient_id,
		v_owner_id,
		'Corrección de una reserva pública'
	);
	if not exists (
		select 1
		from public.appointments appointment
		where appointment.id = v_public_appointment.id
			and appointment.patient_id = v_new_patient_id
			and appointment.public_booking_contact_key
				= private.public_booking_contact_bucket('Juan Pedro', '+5493425048209')
			and appointment.public_booking_contact_key is distinct from v_old_contact_key
	) then
		raise exception 'TEST_PUBLIC_CONTACT_BUCKET_NOT_REPAIRED';
	end if;
	select public.get_public_booking_active_future_count_for_request(
		v_business_id, v_new_patient_id, 'Juan Pedro', '+5493425048209', statement_timestamp()
	) into v_count;
	if v_count <> 5 then
		raise exception 'TEST_REPAIRED_PUBLIC_APPOINTMENT_EXPECTED_COUNT_5_GOT_%', v_count;
	end if;

	raise notice 'PASS: reassignment is audited and pending WhatsApp, Push, calendar and activity are repaired';
end;
$$;

select extensions.pass('safe appointment patient reassignment');
select * from extensions.finish();

rollback;
