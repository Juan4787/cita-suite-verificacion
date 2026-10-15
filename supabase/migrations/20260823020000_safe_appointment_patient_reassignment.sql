-- Controlled repair path for a confirmed wrong patient association. It keeps
-- clinical records separate, invalidates pending communications and records a
-- complete audit trail instead of editing appointment.patient_id ad hoc.

begin;

alter table public.message_dispatches
	add column if not exists superseded_at timestamptz,
	add column if not exists superseded_reason text;

drop index if exists public.message_dispatches_appointment_type_active_uq;
create unique index message_dispatches_appointment_type_active_uq
	on public.message_dispatches (business_id, appointment_id, type)
	where appointment_id is not null
		and status not in ('failed', 'cancelled', 'skipped')
		and superseded_at is null;

comment on column public.message_dispatches.superseded_at is
	'When set, this historical dispatch no longer covers the appointment current patient association.';
comment on column public.message_dispatches.superseded_reason is
	'Stable internal reason for superseding the dispatch without erasing its delivery history.';

-- A superseded row is immutable history and must never be claimed after a
-- reassignment, even if an old worker left it queued.
create or replace function public.claim_queued_message_dispatches(
	claim_limit int default 20,
	claim_now timestamptz default now()
)
returns setof public.message_dispatches
language sql
security definer
set search_path = public
as $$
	with claimed as (
		select dispatch.id
		from public.message_dispatches dispatch
		where dispatch.status = 'queued'
			and dispatch.superseded_at is null
			and dispatch.attempts < dispatch.max_attempts
			and (dispatch.scheduled_for is null or dispatch.scheduled_for <= claim_now)
		order by dispatch.scheduled_for nulls first, dispatch.created_at
		for update skip locked
		limit greatest(claim_limit, 1)
	),
	updated as (
		update public.message_dispatches dispatch
		set
			status = 'sending',
			attempts = dispatch.attempts + 1,
			sending_at = claim_now,
			updated_at = claim_now
		from claimed
		where dispatch.id = claimed.id
		returning dispatch.*
	)
	select * from updated;
$$;

revoke all on function public.claim_queued_message_dispatches(int, timestamptz)
	from public, anon, authenticated;
grant execute on function public.claim_queued_message_dispatches(int, timestamptz)
	to service_role;

-- Every delivery attempt must belong to the same live appointment subscription.
-- FOR KEY SHARE is intentionally paired with the repair RPC's FOR UPDATE lock:
-- an attempt starting after reassignment waits, sees revoked_at, and is rejected
-- before any external Web Push request is made.
create or replace function private.validate_push_delivery_attempt_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_subscription record;
begin
	select subscription.business_id, subscription.appointment_id, subscription.revoked_at
	into v_subscription
	from public.push_subscriptions subscription
	where subscription.id = new.subscription_id
	for key share;
	if not found then
		raise exception 'PUSH_SUBSCRIPTION_NOT_FOUND';
	end if;
	if v_subscription.business_id is distinct from new.business_id
		or v_subscription.appointment_id is distinct from new.appointment_id
	then
		raise exception 'PUSH_SUBSCRIPTION_MISMATCH';
	end if;
	if v_subscription.revoked_at is not null then
		raise exception 'PUSH_SUBSCRIPTION_REVOKED';
	end if;
	return new;
end;
$$;

drop trigger if exists push_delivery_attempts_validate_identity
	on public.push_delivery_attempts;
create trigger push_delivery_attempts_validate_identity
	before insert on public.push_delivery_attempts
	for each row
	execute function private.validate_push_delivery_attempt_identity();

revoke all on function private.validate_push_delivery_attempt_identity()
	from public, anon, authenticated;

create or replace function private.recompute_patient_activity(
	p_business_id uuid,
	p_patient_id uuid
)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
	update public.patients patient
	set activity_at = greatest(
		patient.created_at,
		patient.last_entry_at,
		(
			select max(greatest(appointment.created_at, appointment.updated_at))
			from public.appointments appointment
			where appointment.business_id = p_business_id
				and appointment.patient_id = p_patient_id
		),
		(
			select max(greatest(entry.created_at, entry.updated_at))
			from public.clinical_entries entry
			where entry.business_id = p_business_id
				and entry.patient_id = p_patient_id
		),
		(
			select max(coalesce(radiograph.ready_at, radiograph.created_at))
			from public.patient_radiographs radiograph
			where radiograph.business_id = p_business_id
				and radiograph.patient_id = p_patient_id
				and radiograph.storage_provider = 'supabase_storage'
				and radiograph.status in ('ready', 'trashed')
		)
	)
	where patient.business_id = p_business_id
		and patient.id = p_patient_id;
$$;

create or replace function private.touch_patient_activity_from_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_business_id uuid;
	v_patient_id uuid;
begin
	v_business_id := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
	v_patient_id := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;

	if tg_op = 'UPDATE'
		and (new.business_id, new.patient_id) is distinct from (old.business_id, old.patient_id)
	then
		if old.business_id is not null and old.patient_id is not null then
			perform private.recompute_patient_activity(old.business_id, old.patient_id);
		end if;
	end if;

	if v_business_id is not null and v_patient_id is not null then
		update public.patients patient
		set activity_at = greatest(
			coalesce(patient.activity_at, patient.created_at),
			statement_timestamp()
		)
		where patient.business_id = v_business_id
			and patient.id = v_patient_id;
	end if;

	return null;
end;
$$;

revoke all on function private.recompute_patient_activity(uuid, uuid) from public;
revoke all on function private.touch_patient_activity_from_domain() from public;

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
	revoked_push_subscriptions integer,
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
	v_revoked_push_subscriptions integer := 0;
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

	-- Lock the durable calendar link without waiting behind a worker that has
	-- already begun a remote request. Holding this row makes new queue claims
	-- skip it until the reassignment commits.
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

	-- Serialize against the WhatsApp claim RPC. If a worker committed a claim
	-- first, we observe sending and stop; if repair locks first, SKIP LOCKED keeps
	-- the worker away and superseded rows can no longer be claimed afterward.
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

	-- Serialize both scheduled claims and test-delivery inserts. The insert
	-- trigger above also rejects any waiter after these subscriptions are revoked.
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
			and subscription.revoked_at is null
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
		revoked_at = statement_timestamp(),
		verified_at = null,
		push_24h_claimed_at = null,
		push_24h_sent_at = null,
		push_2h_claimed_at = null,
		push_2h_sent_at = null,
		updated_at = statement_timestamp()
	where subscription.business_id = p_business_id
		and subscription.appointment_id = p_appointment_id
		and subscription.revoked_at is null;
	get diagnostics v_revoked_push_subscriptions = row_count;

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
			'revoked_push_subscriptions', v_revoked_push_subscriptions,
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
		v_revoked_push_subscriptions,
		v_superseded_push_attempts,
		v_invalidated_calendar_attempts,
		v_queued_calendar_deletions;
end;
$$;

revoke execute on function public.reassign_appointment_patient_safely(
	uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.reassign_appointment_patient_safely(
	uuid, uuid, uuid, uuid, text
) to service_role;

notify pgrst, 'reload schema';

commit;
