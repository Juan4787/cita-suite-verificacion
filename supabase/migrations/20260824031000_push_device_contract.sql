-- Cierra la migración expansiva de Web Push: el endpoint, sus claves y su
-- comprobación quedan exclusivamente en push_devices. push_subscriptions pasa a
-- representar solamente el vínculo entre un dispositivo y un turno.

begin;

drop trigger if exists push_subscriptions_sync_device_compat
	on public.push_subscriptions;
drop function if exists private.sync_push_device_from_legacy_subscription();

drop function if exists public.save_appointment_push_subscription(
	uuid, uuid, text, text, text, text, timestamptz
);
drop function if exists public.record_push_notification_click(
	uuid, uuid, text, timestamptz
);
drop function if exists public.record_push_test_feedback(
	uuid, uuid, boolean, timestamptz
);
drop function if exists public.reassign_appointment_patient_safely(
	uuid, uuid, uuid, uuid, text
);

drop index if exists public.idx_push_subscriptions_endpoint;
drop index if exists public.idx_push_subscriptions_verified_appointment;
alter table public.push_subscriptions
	drop constraint if exists push_subscriptions_appointment_id_endpoint_key;

alter table public.push_subscriptions
	drop column if exists endpoint,
	drop column if exists p256dh,
	drop column if exists auth,
	drop column if exists user_agent,
	drop column if exists revoked_at,
	drop column if exists verified_at;

-- Nombrar la unicidad permite usar ON CONFLICT sin que el parametro de salida
-- device_id de la RPC sea ambiguo para PL/pgSQL.
alter table public.push_subscriptions
	add constraint push_subscriptions_appointment_device_key
	unique using index push_subscriptions_appointment_device_uq;

create or replace function public.save_appointment_push_subscription(
	target_business_id uuid,
	target_appointment_id uuid,
	target_endpoint text,
	target_p256dh text,
	target_auth text,
	target_user_agent text,
	save_time timestamptz default now()
)
returns table (
	subscription_id uuid,
	device_id uuid,
	endpoint text,
	verification_confirmed_at timestamptz,
	test_suppressed boolean,
	provider_gone boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_device public.push_devices%rowtype;
	v_subscription_id uuid;
	v_keys_changed boolean := false;
	v_positive_at timestamptz;
	v_test_suppressed boolean := false;
begin
	if target_business_id is null
		or target_appointment_id is null
		or save_time is null
		or nullif(trim(target_endpoint), '') is null
		or nullif(trim(target_p256dh), '') is null
		or nullif(trim(target_auth), '') is null
	then
		raise exception 'PUSH_SUBSCRIPTION_INVALID';
	end if;

	if not exists (
		select 1
		from public.appointments appointment
		where appointment.business_id = target_business_id
			and appointment.id = target_appointment_id
	) then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	select device.*
	into v_device
	from public.push_devices device
	where device.endpoint = target_endpoint
	for update;

	if not found then
		insert into public.push_devices (
			endpoint,
			p256dh,
			auth,
			user_agent,
			last_seen_at,
			verification_required_at,
			created_at,
			updated_at
		)
		values (
			target_endpoint,
			target_p256dh,
			target_auth,
			target_user_agent,
			save_time,
			save_time,
			save_time,
			save_time
		)
		returning * into v_device;
	else
		v_keys_changed := v_device.p256dh is distinct from target_p256dh
			or v_device.auth is distinct from target_auth;

		update public.push_devices device
		set
			p256dh = target_p256dh,
			auth = target_auth,
			user_agent = coalesce(target_user_agent, device.user_agent),
			last_seen_at = save_time,
			verification_required_at = case
				when v_keys_changed then save_time
				else device.verification_required_at
			end,
			provider_gone_at = case
				when v_keys_changed then null
				else device.provider_gone_at
			end,
			updated_at = save_time
		where device.id = v_device.id
		returning * into v_device;
	end if;

	v_positive_at := greatest(
		v_device.last_test_confirmed_at,
		v_device.last_notification_clicked_at
	);
	v_test_suppressed :=
		v_device.provider_gone_at is null
		and v_positive_at is not null
		and (
			v_device.verification_required_at is null
			or v_positive_at >= v_device.verification_required_at
			or v_device.last_test_confirmed_at >= save_time - interval '48 hours'
		);

	insert into public.push_subscriptions (
		business_id,
		appointment_id,
		device_id,
		failed_count,
		detached_at,
		detached_reason,
		updated_at
	)
	values (
		target_business_id,
		target_appointment_id,
		v_device.id,
		0,
		null,
		null,
		save_time
	)
	on conflict on constraint push_subscriptions_appointment_device_key do update
	set
		business_id = excluded.business_id,
		failed_count = 0,
		detached_at = null,
		detached_reason = null,
		updated_at = excluded.updated_at
	returning id into v_subscription_id;

	return query
	select
		v_subscription_id,
		v_device.id,
		v_device.endpoint,
		case when v_test_suppressed then v_positive_at else null end,
		v_test_suppressed,
		v_device.provider_gone_at is not null;
end;
$$;

revoke all on function public.save_appointment_push_subscription(
	uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_appointment_push_subscription(
	uuid, uuid, text, text, text, text, timestamptz
) to service_role;

create or replace function public.record_push_notification_click(
	target_appointment_id uuid,
	target_delivery_id uuid,
	target_receipt_token_hash text,
	click_time timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	target_subscription_id uuid;
	target_device_id uuid;
begin
	if click_time is null
		or target_receipt_token_hash is null
		or target_receipt_token_hash !~ '^[0-9a-f]{64}$'
	then
		return false;
	end if;

	update public.push_delivery_attempts delivery
	set
		received_at = coalesce(delivery.received_at, click_time),
		displayed_at = coalesce(delivery.displayed_at, click_time),
		clicked_at = coalesce(delivery.clicked_at, click_time),
		user_reported_missing_at = null,
		updated_at = greatest(delivery.updated_at, click_time)
	where delivery.id = target_delivery_id
		and delivery.appointment_id = target_appointment_id
		and delivery.receipt_token_hash = target_receipt_token_hash
	returning delivery.subscription_id into target_subscription_id;

	if target_subscription_id is null then
		return false;
	end if;

	select subscription.device_id
	into target_device_id
	from public.push_subscriptions subscription
	where subscription.id = target_subscription_id
		and subscription.appointment_id = target_appointment_id
		and subscription.detached_at is null;

	if target_device_id is null then
		return false;
	end if;

	update public.push_devices device
	set
		last_notification_clicked_at = greatest(device.last_notification_clicked_at, click_time),
		verification_required_at = case
			when device.verification_required_at is null
				or click_time >= device.verification_required_at
				then null
			else device.verification_required_at
		end,
		updated_at = greatest(device.updated_at, click_time)
	where device.id = target_device_id
		and device.provider_gone_at is null;

	return true;
end;
$$;

revoke all on function public.record_push_notification_click(
	uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_push_notification_click(
	uuid, uuid, text, timestamptz
) to service_role;

create or replace function public.record_push_test_feedback(
	target_appointment_id uuid,
	target_delivery_id uuid,
	feedback_visible boolean,
	feedback_time timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	target_subscription_id uuid;
	target_device_id uuid;
	delivery_clicked_at timestamptz;
begin
	if feedback_visible is null or feedback_time is null then
		return false;
	end if;

	select delivery.subscription_id, delivery.clicked_at
	into target_subscription_id, delivery_clicked_at
	from public.push_delivery_attempts delivery
	where delivery.id = target_delivery_id
		and delivery.appointment_id = target_appointment_id
		and delivery.kind = 'test'
		and delivery.accepted_at is not null
		and delivery.failed_at is null
		and delivery.superseded_at is null
	for update;

	if target_subscription_id is null then
		return false;
	end if;

	select subscription.device_id
	into target_device_id
	from public.push_subscriptions subscription
	where subscription.id = target_subscription_id
		and subscription.appointment_id = target_appointment_id
		and subscription.detached_at is null
	for update;

	if target_device_id is null then
		return false;
	end if;

	if feedback_visible then
		update public.push_delivery_attempts delivery
		set
			user_confirmed_at = feedback_time,
			user_reported_missing_at = null,
			updated_at = greatest(delivery.updated_at, feedback_time)
		where delivery.id = target_delivery_id;

		update public.push_devices device
		set
			last_test_confirmed_at = greatest(device.last_test_confirmed_at, feedback_time),
			verification_required_at = null,
			updated_at = greatest(device.updated_at, feedback_time)
		where device.id = target_device_id;
	elsif delivery_clicked_at is null then
		update public.push_delivery_attempts delivery
		set
			user_confirmed_at = null,
			user_reported_missing_at = feedback_time,
			updated_at = greatest(delivery.updated_at, feedback_time)
		where delivery.id = target_delivery_id;

		update public.push_devices device
		set
			verification_required_at = greatest(device.verification_required_at, feedback_time),
			updated_at = greatest(device.updated_at, feedback_time)
		where device.id = target_device_id;
	end if;

	if delivery_clicked_at is not null then
		update public.push_devices device
		set
			last_notification_clicked_at = greatest(
				device.last_notification_clicked_at,
				delivery_clicked_at
			),
			verification_required_at = case
				when device.verification_required_at is null
					or delivery_clicked_at >= device.verification_required_at
					then null
				else device.verification_required_at
			end,
			updated_at = greatest(device.updated_at, delivery_clicked_at)
		where device.id = target_device_id;
	end if;

	return true;
end;
$$;

revoke all on function public.record_push_test_feedback(
	uuid, uuid, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_push_test_feedback(
	uuid, uuid, boolean, timestamptz
) to service_role;

-- La reparación de paciente separa exclusivamente los vínculos de ese turno.
-- El permiso y la salud de push_devices nunca se modifican aquí.
create or replace function public.reassign_appointment_patient_safely(
	p_business_id uuid,
	p_appointment_id uuid,
	p_new_patient_id uuid,
	p_actor_user_id uuid,
	p_reason text
)
returns table (
	appointment_id uuid,
	old_patient_id uuid,
	new_patient_id uuid,
	cancelled_dispatches integer,
	superseded_dispatches integer,
	detached_push_subscriptions integer,
	superseded_push_attempts integer,
	invalidated_calendar_attempts integer,
	queued_calendar_deletions integer
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
	v_appointment public.appointments%rowtype;
	v_new_patient record;
	v_calendar_event public.appointment_google_calendar_events%rowtype;
	v_reason text := nullif(regexp_replace(trim(coalesce(p_reason, '')), '\s+', ' ', 'g'), '');
	v_cancelled_dispatches integer := 0;
	v_superseded_dispatches integer := 0;
	v_detached_push_subscriptions integer := 0;
	v_superseded_push_attempts integer := 0;
	v_invalidated_calendar_attempts integer := 0;
	v_queued_calendar_deletions integer := 0;
begin
	if p_business_id is null or p_appointment_id is null or p_new_patient_id is null then
		raise exception 'APPOINTMENT_REASSIGNMENT_REQUIRED_FIELDS';
	end if;
	if p_actor_user_id is null then
		raise exception 'APPOINTMENT_REASSIGNMENT_ACTOR_REQUIRED';
	end if;
	if not exists (
		select 1
		from public.business_users business_user
		where business_user.business_id = p_business_id
			and business_user.user_id = p_actor_user_id
			and business_user.role in ('owner', 'admin', 'reception')
			and business_user.status = 'active'
			and business_user.disabled_at is null
	) then
		raise exception 'APPOINTMENT_REASSIGNMENT_ACTOR_INVALID';
	end if;
	if v_reason is null then
		raise exception 'APPOINTMENT_REASSIGNMENT_REASON_REQUIRED';
	end if;
	if char_length(v_reason) > 500 then
		raise exception 'APPOINTMENT_REASSIGNMENT_REASON_TOO_LONG';
	end if;

	select appointment.*
	into v_appointment
	from public.appointments appointment
	where appointment.business_id = p_business_id
		and appointment.id = p_appointment_id
	for update;
	if not found then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;
	if v_appointment.patient_id = p_new_patient_id then
		raise exception 'APPOINTMENT_PATIENT_UNCHANGED';
	end if;

	begin
		select event_link.*
		into v_calendar_event
		from public.appointment_google_calendar_events event_link
		where event_link.business_id = p_business_id
			and event_link.appointment_id = p_appointment_id
		for update nowait;
	exception when lock_not_available then
		raise exception 'APPOINTMENT_REASSIGNMENT_CALENDAR_IN_FLIGHT';
	end;
	if v_calendar_event.id is not null
		and v_calendar_event.claimed_at is not null
		and v_calendar_event.claimed_at >= statement_timestamp() - interval '10 minutes'
	then
		raise exception 'APPOINTMENT_REASSIGNMENT_CALENDAR_IN_FLIGHT';
	end if;

	select
		patient.id,
		patient.full_name,
		coalesce(
			nullif(trim(patient.phone_raw), ''),
			nullif(trim(patient.phone), ''),
			patient.phone_e164
		) as phone_raw,
		patient.phone_e164,
		patient.blocked,
		patient.archived_at
	into v_new_patient
	from public.patients patient
	where patient.business_id = p_business_id
		and patient.id = p_new_patient_id
	for update;
	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
	if v_new_patient.archived_at is not null then
		raise exception 'PATIENT_ARCHIVED';
	end if;
	if v_new_patient.blocked then
		raise exception 'PATIENT_BLOCKED';
	end if;

	perform dispatch.id
	from public.message_dispatches dispatch
	where dispatch.business_id = p_business_id
		and dispatch.appointment_id = p_appointment_id
	for update;
	if exists (
		select 1
		from public.message_dispatches dispatch
		where dispatch.business_id = p_business_id
			and dispatch.appointment_id = p_appointment_id
			and dispatch.status = 'sending'
	) then
		raise exception 'APPOINTMENT_REASSIGNMENT_MESSAGE_IN_FLIGHT';
	end if;

	perform subscription.id
	from public.push_subscriptions subscription
	where subscription.business_id = p_business_id
		and subscription.appointment_id = p_appointment_id
	for update;
	perform attempt.id
	from public.push_delivery_attempts attempt
	where attempt.business_id = p_business_id
		and attempt.appointment_id = p_appointment_id
	for update;

	if exists (
		select 1
		from public.push_subscriptions subscription
		where subscription.business_id = p_business_id
			and subscription.appointment_id = p_appointment_id
			and subscription.detached_at is null
			and (
				(subscription.push_24h_claimed_at is not null
					and subscription.push_24h_sent_at is null
					and subscription.push_24h_claimed_at >= statement_timestamp() - interval '10 minutes')
				or
				(subscription.push_2h_claimed_at is not null
					and subscription.push_2h_sent_at is null
					and subscription.push_2h_claimed_at >= statement_timestamp() - interval '10 minutes')
			)
	) or exists (
		select 1
		from public.push_delivery_attempts attempt
		where attempt.business_id = p_business_id
			and attempt.appointment_id = p_appointment_id
			and attempt.superseded_at is null
			and attempt.accepted_at is null
			and attempt.failed_at is null
			and attempt.created_at >= statement_timestamp() - interval '2 minutes'
	) then
		raise exception 'APPOINTMENT_REASSIGNMENT_PUSH_IN_FLIGHT';
	end if;

	if exists (
		select 1
		from public.google_calendar_oauth_attempts attempt
		where attempt.business_id = p_business_id
			and attempt.appointment_id = p_appointment_id
			and attempt.consumed_at is not null
			and attempt.expires_at > statement_timestamp()
	) then
		raise exception 'APPOINTMENT_REASSIGNMENT_CALENDAR_IN_FLIGHT';
	end if;

	update public.message_dispatches dispatch
	set
		superseded_at = statement_timestamp(),
		superseded_reason = 'patient_reassigned',
		updated_at = statement_timestamp(),
		metadata = coalesce(dispatch.metadata, '{}'::jsonb) || jsonb_build_object(
			'superseded_by_patient_reassignment', true,
			'previous_patient_id', v_appointment.patient_id,
			'new_patient_id', p_new_patient_id
		)
	where dispatch.business_id = p_business_id
		and dispatch.appointment_id = p_appointment_id
		and dispatch.superseded_at is null;
	get diagnostics v_superseded_dispatches = row_count;

	update public.message_dispatches dispatch
	set
		status = 'cancelled',
		cancelled_at = statement_timestamp(),
		last_error_code = 'PATIENT_REASSIGNED',
		human_error_message = 'Envío cancelado porque el turno fue reasignado a otra ficha.',
		updated_at = statement_timestamp()
	where dispatch.business_id = p_business_id
		and dispatch.appointment_id = p_appointment_id
		and dispatch.status in ('scheduled', 'queued');
	get diagnostics v_cancelled_dispatches = row_count;

	update public.push_subscriptions subscription
	set
		detached_at = statement_timestamp(),
		detached_reason = 'patient_reassigned',
		push_24h_claimed_at = null,
		push_2h_claimed_at = null,
		updated_at = statement_timestamp()
	where subscription.business_id = p_business_id
		and subscription.appointment_id = p_appointment_id
		and subscription.detached_at is null;
	get diagnostics v_detached_push_subscriptions = row_count;

	update public.push_delivery_attempts attempt
	set
		superseded_at = statement_timestamp(),
		updated_at = statement_timestamp()
	where attempt.business_id = p_business_id
		and attempt.appointment_id = p_appointment_id
		and attempt.superseded_at is null;
	get diagnostics v_superseded_push_attempts = row_count;

	delete from public.google_calendar_oauth_attempts attempt
	where attempt.business_id = p_business_id
		and attempt.appointment_id = p_appointment_id
		and attempt.consumed_at is null;
	get diagnostics v_invalidated_calendar_attempts = row_count;

	update public.appointment_google_calendar_events event_link
	set
		sync_status = 'pending_delete',
		claimed_at = null,
		next_attempt_at = statement_timestamp(),
		last_error_code = null,
		last_error_at = null,
		updated_at = statement_timestamp()
	where event_link.business_id = p_business_id
		and event_link.appointment_id = p_appointment_id
		and event_link.sync_status not in ('deleted', 'detached');
	get diagnostics v_queued_calendar_deletions = row_count;

	perform set_config('cita_suite.appointment_identity_write', 'repair', true);
	update public.appointments appointment
	set
		patient_id = p_new_patient_id,
		patient_name_at_booking = v_new_patient.full_name,
		patient_phone_raw_at_booking = v_new_patient.phone_raw,
		patient_phone_e164_at_booking = v_new_patient.phone_e164,
		patient_resolution_strategy = 'reassigned_manual',
		confirmation_token = encode(gen_random_bytes(32), 'hex'),
		calendar_sequence = appointment.calendar_sequence + 1,
		calendar_action_status = 'not_offered',
		calendar_provider = null,
		calendar_offered_at = null,
		calendar_action_at = null,
		calendar_action_count = 0,
		calendar_update_required_at = null,
		updated_by_user_id = p_actor_user_id,
		updated_at = statement_timestamp()
	where appointment.business_id = p_business_id
		and appointment.id = p_appointment_id;
	perform set_config('cita_suite.appointment_identity_write', '', true);

	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		metadata
	)
	values (
		p_business_id,
		p_actor_user_id,
		'appointment.patient_reassigned',
		'appointment',
		p_appointment_id,
		jsonb_build_object(
			'old_patient_id', v_appointment.patient_id,
			'new_patient_id', p_new_patient_id,
			'new_patient_name', v_new_patient.full_name,
			'new_patient_phone_raw', v_new_patient.phone_raw,
			'new_patient_phone_e164', v_new_patient.phone_e164,
			'reason', v_reason,
			'confirmation_token_rotated', true,
			'cancelled_dispatches', v_cancelled_dispatches,
			'superseded_dispatches', v_superseded_dispatches,
			'detached_push_subscriptions', v_detached_push_subscriptions,
			'superseded_push_attempts', v_superseded_push_attempts,
			'invalidated_calendar_attempts', v_invalidated_calendar_attempts,
			'queued_calendar_deletions', v_queued_calendar_deletions,
			'previous_calendar_action_status', v_appointment.calendar_action_status,
			'previous_calendar_action_count', v_appointment.calendar_action_count,
			'previous_resolution_strategy', v_appointment.patient_resolution_strategy
		)
	);

	return query
	select
		p_appointment_id,
		v_appointment.patient_id,
		p_new_patient_id,
		v_cancelled_dispatches,
		v_superseded_dispatches,
		v_detached_push_subscriptions,
		v_superseded_push_attempts,
		v_invalidated_calendar_attempts,
		v_queued_calendar_deletions;
end;
$$;

revoke all on function public.reassign_appointment_patient_safely(
	uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.reassign_appointment_patient_safely(
	uuid, uuid, uuid, uuid, text
) to service_role;

notify pgrst, 'reload schema';

commit;
