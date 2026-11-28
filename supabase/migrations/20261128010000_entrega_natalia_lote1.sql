-- Lote 1 de la entrega a Natalia (docs/plans/entrega-natalia-implementacion.md):
--  P6: horizonte de reserva hasta 365 días en la base (restricción explícita en businesses
--      y validación por día calendario local en apply_patient_appointment_management).
--  P7: private.appointment_management_snapshot resuelve el texto/enlace vigente de
--      booking_integrations.video_instructions para turnos virtuales (con respaldo en
--      c.video_instructions_snapshot si la integración quedó vacía), y nunca en presenciales.
--  P9: public.get_public_practice_contact y public.get_public_booking_catalogue exponen
--      contact.email bajo el mismo interruptor public_contact_enabled, sólo si es válido.
-- Retrocompatible con el Worker anterior 3bad70e8: no quita columnas ni cambia firmas existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ============================================================================
-- P6: tope de 365 días en businesses y día calendario local al reprogramar
-- ============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.businesses'::regclass
      and conname = 'businesses_max_booking_days_ahead_check'
  ) then
    alter table public.businesses
      add constraint businesses_max_booking_days_ahead_check
      check (max_booking_days_ahead between 1 and 365);
  end if;
end $$;

create or replace function public.apply_patient_appointment_management(
  p_token text, p_legacy boolean, p_operation_id uuid, p_expected_revision text, p_action text,
  p_starts_at timestamptz default null, p_availability_revision bigint default null,
  p_financial_terms jsonb default null, p_integration_revision bigint default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare access jsonb; locked_access jsonb; a public.appointments; before_a public.appointments;
  b public.businesses; s public.services; context public.appointment_booking_contexts; integration public.booking_integrations;
  d public.appointment_deposits; r public.appointment_deposit_requirements; basis public.appointment_deposit_requirements;
  prior private.appointment_management_operations; v_business uuid; v_appointment uuid; v_now timestamptz;
  v_fingerprint text; v_result jsonb; v_terms jsonb; v_scope jsonb; v_requirement uuid; v_revision bigint; v_teams uuid[]; v_locked_teams uuid[];
  v_professional uuid; v_ends_at timestamptz; v_status text; v_changed boolean := true; v_kind text;
  v_projection_revision bigint; v_snapshot jsonb; v_has_projection boolean; v_has_current boolean; v_previous_disposition text;
begin
  if p_legacy is null or p_operation_id is null or not coalesce(p_expected_revision ~ '^[0-9a-f]{64}$', false)
    or not coalesce(p_action in ('cancel', 'reschedule', 'confirm'), false) then raise exception 'APPOINTMENT_MANAGEMENT_CHANGED'; end if;
  if p_action <> 'reschedule' and (p_starts_at is not null or p_availability_revision is not null or p_financial_terms is not null or p_integration_revision is not null) then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED'; end if;
  if p_action = 'reschedule' and (p_starts_at is null or not isfinite(p_starts_at)) then raise exception 'APPOINTMENT_RESCHEDULE_TIME_INVALID'; end if;
  if p_financial_terms is not null and (jsonb_typeof(p_financial_terms) <> 'object' or octet_length(p_financial_terms::text) > 8192) then
    raise exception 'APPOINTMENT_FINANCIAL_TERMS_CHANGED'; end if;
  access := public.resolve_appointment_management_access(p_token, p_legacy);
  v_business := (access->>'business_id')::uuid; v_appointment := (access->>'appointment_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('appointment-management-operation:' || v_business::text || ':' || p_operation_id::text, 0));
  if p_action = 'reschedule' then
    select * into b from public.businesses where id = v_business for share;
    perform 1 from public.business_subscriptions where business_id = v_business for share;
    perform pg_advisory_xact_lock_shared(hashtextextended('cita-suite:deposit-automation-configuration', 0));
    perform 1 from public.deposit_policies where business_id = v_business for share;
    perform 1 from public.appointment_email_policies where business_id = v_business for share;
    perform 1 from private.appointment_management_runtime where singleton for share;
    select array_agg(professional_id order by professional_id) into v_teams from public.appointment_professionals
      where business_id = v_business and appointment_id = v_appointment;
    for v_professional in select unnest(v_teams) loop
      perform pg_advisory_xact_lock(hashtextextended(v_business::text || ':' || v_professional::text, 0));
    end loop;
  end if;
  select * into a from public.appointments where business_id = v_business and id = v_appointment for no key update;
  if not found then raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  locked_access := public.resolve_appointment_management_access(p_token, p_legacy);
  if (locked_access->>'business_id', locked_access->>'appointment_id') is distinct from (v_business::text, v_appointment::text) then
    raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  v_fingerprint := private.patient_management_request_fingerprint(p_action, a.id, a.patient_id, (locked_access->>'generation')::bigint,
    p_expected_revision, p_starts_at, p_availability_revision, p_financial_terms, p_integration_revision);
  select * into prior from private.appointment_management_operations where business_id = v_business and operation_id = p_operation_id;
  if found then
    if prior.appointment_id is distinct from a.id or prior.request_fingerprint is distinct from v_fingerprint
      or prior.origin <> 'patient' or prior.action <> p_action then raise exception 'APPOINTMENT_OPERATION_CONFLICT'; end if;
    return prior.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if private.appointment_semantic_revision(v_business, a.id) is distinct from p_expected_revision then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED'; end if;
  v_now := clock_timestamp(); before_a := a;

  if p_action = 'cancel' then
    if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or a.starts_at <= v_now then raise exception 'APPOINTMENT_CANNOT_CANCEL'; end if;
    update public.appointments set status = 'cancelled', cancelled_at = v_now, cancelled_by_user_id = null,
      cancelled_reason = 'Cancelado por el paciente', calendar_sequence = a.calendar_sequence + 1,
      calendar_update_required_at = case when a.calendar_action_count > 0 then v_now end,
      updated_by_user_id = null, updated_at = v_now where business_id = v_business and id = a.id returning * into a;
  elsif p_action = 'confirm' then
    if a.starts_at <= v_now or a.status <> 'reserved' then raise exception 'APPOINTMENT_CANNOT_CONFIRM'; end if;
    if exists(select 1 from public.appointment_deposits where business_id = v_business and appointment_id = a.id and status = 'pending') then
      raise exception 'APPOINTMENT_DEPOSIT_PENDING'; end if;
    if not exists(select 1 from public.businesses where id = v_business and is_active) or not private.appointment_business_allows_operation_at(v_business, v_now) then
      raise exception 'APPOINTMENT_CANNOT_CONFIRM'; end if;
    update public.appointments set status = 'confirmed', confirmed_at = v_now, updated_by_user_id = null, updated_at = v_now
      where business_id = v_business and id = a.id returning * into a;
  else
    if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or a.starts_at <= v_now then raise exception 'APPOINTMENT_CANNOT_RESCHEDULE'; end if;
    if p_starts_at = a.starts_at then v_changed := false;
    else
      if p_availability_revision is null or p_availability_revision is distinct from
        (select booking_availability_revision from public.businesses where id = v_business) then raise exception 'APPOINTMENT_AVAILABILITY_CHANGED'; end if;
      v_now := clock_timestamp();
      if p_starts_at < v_now + make_interval(mins => b.min_booking_notice_minutes) or p_starts_at <= v_now
        or (not b.allow_same_day_booking and (p_starts_at at time zone b.timezone)::date <= (v_now at time zone b.timezone)::date)
        or (p_starts_at at time zone b.timezone)::date > ((v_now at time zone b.timezone)::date + least(greatest(b.max_booking_days_ahead, 1), 365)) then
        raise exception 'APPOINTMENT_RESCHEDULE_TIME_INVALID'; end if;
      select * into s from public.services where business_id = v_business and id = a.service_id and is_active and is_public;
      if not found then raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
      select array_agg(professional_id order by professional_id) into v_locked_teams from public.appointment_professionals where business_id = v_business and appointment_id = a.id;
      if v_teams is distinct from v_locked_teams then
        raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
      select * into context from public.appointment_booking_contexts where business_id = v_business and appointment_id = a.id;
      if found then
        begin
          select * into integration from public.booking_integrations where business_id = v_business and id = context.integration_id for share nowait;
        exception when lock_not_available then raise exception 'APPOINTMENT_AVAILABILITY_CHANGED'; end;
        if integration.id is null then
          raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
        if p_integration_revision is distinct from integration.revision then raise exception 'APPOINTMENT_AVAILABILITY_CHANGED'; end if;
      elsif p_integration_revision is not null then raise exception 'APPOINTMENT_AVAILABILITY_CHANGED';
      end if;
      v_scope := private.appointment_reschedule_scope(v_business, a.id, v_now);
      if (v_scope->>'can_select')::boolean is not true then raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
      v_ends_at := p_starts_at + make_interval(mins => s.duration_minutes);
      v_terms := private.appointment_reschedule_financial_terms(v_business, a.id, p_starts_at, v_now);
      if v_terms->>'unavailable_reason' is not null or v_terms->>'kind' = 'unavailable' then raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
      if v_terms is distinct from p_financial_terms then raise exception 'APPOINTMENT_FINANCIAL_TERMS_CHANGED'; end if;
      select * into d from public.appointment_deposits where business_id = v_business and appointment_id = a.id for update;
      v_has_projection := found;
      select * into r from public.appointment_deposit_requirements where business_id = v_business and appointment_id = a.id and is_current for update;
      v_has_current := found;
      select * into basis from public.appointment_deposit_requirements where business_id = v_business and appointment_id = a.id and patient_id = a.patient_id order by ordinal desc limit 1;
      if v_has_current then basis := r; end if;
      v_kind := v_terms->>'kind';
      if v_kind <> 'reuse_pending' and v_has_current then
        v_previous_disposition := v_terms->>'previous_payment_disposition';
        update public.appointment_deposit_requirements set is_current = false,
          allocation = case when v_previous_disposition = 'forfeit' then 'forfeited' else allocation end, updated_at = v_now where id = r.id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, metadata)
        values(v_business, a.id, r.id, case when v_previous_disposition = 'forfeit' then 'payment_forfeited'
          when v_previous_disposition = 'credit' then 'payment_applied' else 'requirement_updated' end,
          case when v_previous_disposition in ('forfeit', 'credit') then r.amount else 0 end,
          jsonb_build_object('origin', 'patient', 'operation_id', p_operation_id, 'reason', 'rescheduled', 'closed', true));
        if v_kind <> 'new_requirement' then delete from public.appointment_deposits where business_id = v_business and appointment_id = a.id; end if;
      end if;
      v_status := case when v_kind in ('reuse_pending', 'new_requirement') then 'reserved'
        when a.status = 'confirmed' then 'confirmed' else 'reserved' end;
      update public.appointments set starts_at = p_starts_at, ends_at = v_ends_at, status = v_status,
        confirmed_at = case when v_status = 'confirmed' then a.confirmed_at end, reschedule_requested_at = null, reminder_due_at = null,
        calendar_sequence = a.calendar_sequence + 1, calendar_update_required_at = case when a.calendar_action_count > 0 then v_now end,
        ignore_break = false, updated_by_user_id = null, updated_at = v_now where business_id = v_business and id = a.id returning * into a;
      if context.appointment_id is not null then
        for v_professional in select unnest(v_teams) loop
          if exists(select 1 from jsonb_array_elements(integration.modality_windows) w where w->>'modality' = context.modality
            and (not (w ? 'professionalId') or (w->>'professionalId')::uuid = v_professional)) and not exists(
            select 1 from jsonb_array_elements(integration.modality_windows) w
            join public.appointment_professionals ap on ap.business_id = v_business and ap.appointment_id = a.id and ap.professional_id = v_professional
            where w->>'modality' = context.modality and (not (w ? 'professionalId') or (w->>'professionalId')::uuid = v_professional)
              and (w->>'weekday')::integer = extract(dow from (p_starts_at at time zone b.timezone))::integer
              and ap.blocking_starts_at >= (((p_starts_at at time zone b.timezone)::date + (w->>'startTime')::time) at time zone b.timezone)
              and ap.blocking_ends_at <= (((p_starts_at at time zone b.timezone)::date + (w->>'endTime')::time) at time zone b.timezone)
          ) then raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
        end loop;
      end if;
      if v_kind = 'new_requirement' then
        select coalesce(max(projection_revision), 0) + 1 into v_projection_revision from public.appointment_deposit_requirements where business_id = v_business and appointment_id = a.id;
        v_snapshot := basis.terms_snapshot || jsonb_build_object('request_from', v_terms->'request_from', 'due_at', v_terms->'due_at', 'auto_cancel', v_terms->'auto_cancel', 'waived_reason', null);
        insert into public.appointment_deposit_requirements(business_id, appointment_id, patient_id, status, amount, base_amount, allocation, terms_snapshot, projection_revision)
        values(v_business, a.id, a.patient_id, 'pending', (v_terms->>'amount')::bigint, (v_terms->>'base_amount')::bigint, 'none', v_snapshot, v_projection_revision) returning id into v_requirement;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, metadata)
        values(v_business, a.id, v_requirement, 'requirement_created', jsonb_build_object('origin', 'patient', 'operation_id', p_operation_id));
        insert into public.appointment_deposits(business_id, appointment_id, status, amount, currency, percentage, reference_amount, request_days, deadline_hours,
          min_payment_hours, policy_revision, request_from, due_at, auto_cancel, revision)
        values(v_business, a.id, 'pending', (v_terms->>'amount')::bigint, 'ARS', (basis.terms_snapshot->>'percentage')::numeric,
          (basis.terms_snapshot->>'reference_amount')::bigint, (v_terms->>'request_days')::integer, (v_terms->>'deadline_hours')::integer,
          (v_terms->>'min_payment_hours')::integer, (basis.terms_snapshot->>'policy_revision')::bigint, (v_terms->>'request_from')::timestamptz,
          (v_terms->>'due_at')::timestamptz, (v_terms->>'auto_cancel')::boolean, v_projection_revision)
        on conflict(appointment_id) do update set status = 'pending', amount = excluded.amount, percentage = excluded.percentage, reference_amount = excluded.reference_amount,
          request_days = excluded.request_days, deadline_hours = excluded.deadline_hours, min_payment_hours = excluded.min_payment_hours, policy_revision = excluded.policy_revision,
          request_from = excluded.request_from, due_at = excluded.due_at, auto_cancel = excluded.auto_cancel, revision = excluded.revision,
          waived_reason = null, note = null, recorded_by = null, recorded_at = null, reminder_opened_at = null, reminder_opened_by = null, expired_at = null, updated_at = v_now;
      elsif v_kind = 'reuse_pending' then
        update public.appointment_deposits set auto_cancel = false, revision = revision + 1, updated_at = v_now
        where business_id = v_business and appointment_id = a.id and auto_cancel and (v_terms->>'auto_cancel')::boolean is not true;
      end if;
    end if;
  end if;
  if v_changed then
    insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
    values(v_business, null, case p_action when 'cancel' then 'appointment.cancelled' when 'confirm' then 'appointment.confirmed' else 'appointment.rescheduled' end,
      'appointment', a.id, jsonb_build_object('origin', 'patient', 'operation_id', p_operation_id, 'from_status', before_a.status, 'to_status', a.status,
        'from_starts_at', before_a.starts_at, 'to_starts_at', a.starts_at, 'financial_terms', v_terms));
  end if;
  locked_access := public.resolve_appointment_management_access(p_token, p_legacy);
  if (locked_access->>'business_id', locked_access->>'appointment_id') is distinct from (v_business::text, v_appointment::text) then
    raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  select schedule_revision into v_revision from public.appointment_management_states where business_id = v_business and appointment_id = a.id;
  v_result := jsonb_build_object('appointment_id', a.id, 'status', a.status, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
    'changed', v_changed, 'schedule_revision', v_revision, 'revision', private.appointment_semantic_revision(v_business, a.id), 'idempotent_replay', false);
  insert into private.appointment_management_operations(business_id, operation_id, appointment_id, origin, action, request_fingerprint, result)
  values(v_business, p_operation_id, a.id, 'patient', p_action, v_fingerprint, v_result);
  return v_result;
end $$;

-- ============================================================================
-- P7: indicaciones vigentes de la consulta online en snapshot del turno
-- ============================================================================

create or replace function private.appointment_management_snapshot(
  p_business_id uuid,
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_now timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $function$
declare
  a public.appointments;
  b public.businesses;
  m public.appointment_management_states;
  d public.appointment_deposits;
  dp public.deposit_policies;
  c public.appointment_booking_contexts;
  i public.booking_integrations;
  v_scope jsonb;
  v_terms jsonb;
  v_deposit jsonb;
  v_financial_summary jsonb;
  v_patient_name text;
  v_integration jsonb;
  v_patient_active boolean;
  v_auxiliary boolean;
  v_active_future boolean;
  v_operable boolean;
  v_booking boolean;
  v_cancel boolean;
  v_reschedule boolean;
  v_confirm boolean;
  v_auto_cancel boolean;
begin
  select * into a from public.appointments where business_id = p_business_id and id = p_appointment_id;
  if not found then return null; end if;
  select * into b from public.businesses where id = p_business_id;
  select * into m from public.appointment_management_states where business_id = p_business_id and appointment_id = p_appointment_id;
  select * into d from public.appointment_deposits where business_id = p_business_id and appointment_id = p_appointment_id;
  select * into dp from public.deposit_policies where business_id = p_business_id;
  select * into c from public.appointment_booking_contexts where business_id = p_business_id and appointment_id = p_appointment_id;
  select full_name, archived_at is null into v_patient_name, v_patient_active from public.patients where business_id = p_business_id and id = a.patient_id;
  v_active_future := a.status in ('reserved', 'confirmed', 'reschedule_requested') and a.starts_at > p_now;
  v_operable := b.is_active and coalesce(private.appointment_business_allows_operation_at(b.id, p_now), false);
  v_booking := v_operable and b.public_booking_enabled;
  v_auxiliary := v_active_future and v_operable and coalesce(v_patient_active, false);
  v_scope := private.appointment_reschedule_scope(p_business_id, p_appointment_id, p_now);
  if v_active_future then v_terms := private.appointment_reschedule_financial_terms(p_business_id, p_appointment_id, coalesce(p_starts_at, a.starts_at), p_now); end if;
  v_cancel := v_active_future;
  v_reschedule := v_active_future and coalesce((v_scope->>'can_select')::boolean, false) and v_terms->>'unavailable_reason' is null;
  v_confirm := v_active_future and a.status = 'reserved' and v_operable and coalesce(d.status not in ('pending', 'expired'), true);
  v_auto_cancel := d.status = 'pending' and a.status = 'reserved' and a.starts_at > p_now and d.auto_cancel and dp.enabled and dp.auto_cancel_enabled
    and v_operable and p_now < d.due_at + interval '24 hours' and coalesce((select enabled from private.deposit_automation where singleton), false);
  if d.appointment_id is not null then
    v_deposit := jsonb_build_object(
      'appointment_id', d.appointment_id, 'status', d.status, 'amount', d.amount, 'currency', d.currency,
      'request_from', d.request_from, 'due_at', d.due_at, 'auto_cancel', coalesce(v_auto_cancel, false),
      'waived_reason', d.waived_reason, 'recorded_at', d.recorded_at, 'reminder_opened_at', d.reminder_opened_at,
      'expired_at', d.expired_at, 'revision', d.revision
    );
  end if;
  v_financial_summary := private.appointment_deposit_summary(p_business_id, p_appointment_id, a.patient_id);
  if c.appointment_id is not null then
    select * into i from public.booking_integrations where business_id = p_business_id and id = c.integration_id;
    v_integration := jsonb_build_object(
      'id', c.integration_id, 'revision', i.revision, 'is_active', i.is_active, 'public_key', i.public_key,
      'theme_snapshot', c.theme_snapshot, 'entry_point', c.entry_point, 'modality', c.modality,
      'video_instructions_snapshot', case
        when c.modality = 'video' then coalesce(nullif(trim(i.video_instructions), ''), nullif(trim(c.video_instructions_snapshot), ''))
        else null
      end,
      'modality_windows', i.modality_windows
    );
  end if;
  return jsonb_build_object(
    'schema_version', 1, 'id', a.id, 'status', a.status, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'now', p_now,
    'schedule_revision', m.schedule_revision, 'calendar_token', a.confirmation_token, 'patient_name', v_patient_name,
    'service_name_snapshot', a.service_name_snapshot, 'professional_name_snapshot', a.professional_name_snapshot,
    'service_id', a.service_id, 'professional_ids', v_scope->'professional_ids', 'reschedule_duration_minutes', v_scope->'duration_minutes',
    'modality', coalesce(c.modality, 'in_person'), 'integration', v_integration,
    'patient_instructions_snapshot', a.patient_instructions_snapshot, 'public_reminder_description_snapshot', a.public_reminder_description_snapshot,
    'price_quote_snapshot', a.price_quote_snapshot, 'calendar_action_status', a.calendar_action_status, 'calendar_action_at', a.calendar_action_at,
    'calendar_action_count', a.calendar_action_count, 'calendar_sequence', a.calendar_sequence, 'calendar_update_required_at', a.calendar_update_required_at,
    'deposit', v_deposit, 'deposit_transfer_details', case when v_active_future and d.status = 'pending' then dp.transfer_details end,
    'financial_terms', v_terms, 'financial_summary', v_financial_summary,
    'reschedule_unavailable_reason', coalesce(v_scope->>'reason', v_terms->>'unavailable_reason'),
    'can_add_information', v_auxiliary and exists(
      select 1 from public.appointment_patient_information_contexts ic
      where (ic.business_id, ic.appointment_id, ic.patient_id_snapshot) = (a.business_id, a.id, a.patient_id)
    ),
    'can_manage_reminders', v_auxiliary,
    'can_cancel', v_cancel, 'can_reschedule', v_reschedule, 'can_confirm', v_confirm, 'is_past', a.starts_at <= p_now,
    'new_booking_allowed', a.status = 'cancelled' and a.starts_at > p_now and v_booking,
    'business', jsonb_build_object(
      'id', b.id, 'name', b.name, 'slug', b.slug, 'timezone', b.timezone, 'phone', b.phone,
      'address', case when c.modality is distinct from 'video' then b.address end,
      'address_instructions', case when c.modality is distinct from 'video' then b.address_instructions end,
      'maps_url', case when c.modality is distinct from 'video' then b.maps_url end,
      'logo_url', b.logo_url, 'is_active', b.is_active,
      'public_booking_enabled', b.public_booking_enabled, 'cancellation_policy', b.cancellation_policy,
      'whatsapp_contact_phone', case when b.whatsapp_contact_enabled then b.whatsapp_phone end
    )
  );
end $function$;

-- ============================================================================
-- P9: correo de contacto público bajo public_contact_enabled
-- ============================================================================

create or replace function public.get_public_practice_contact(p_key text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  integration public.booking_integrations%rowtype;
  business public.businesses%rowtype;
  v_email text;
begin
  select * into integration from public.booking_integrations where public_key = p_key;
  if not found then raise exception 'PUBLIC_CONTACT_UNAVAILABLE'; end if;
  select * into business from public.businesses where id = integration.business_id and is_active;
  if not found then raise exception 'PUBLIC_CONTACT_UNAVAILABLE'; end if;
  v_email := nullif(trim(business.email), '');
  if not business.public_contact_enabled
     or v_email is null
     or length(v_email) > 254
     or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    v_email := null;
  end if;
  return jsonb_build_object(
    'allowed_origins', integration.allowed_origins,
    'contact', jsonb_build_object(
      'phone', case when business.public_contact_enabled then business.phone end,
      'email', v_email,
      'address', case when business.public_contact_enabled then business.address end,
      'whatsapp_phone', case when business.whatsapp_contact_enabled then business.whatsapp_phone end,
      'whatsapp_message', case when business.whatsapp_contact_enabled then business.whatsapp_message end
    )
  );
end $$;

create or replace function public.get_public_booking_catalogue(p_integration_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  i public.booking_integrations%rowtype;
  b public.businesses%rowtype;
  services jsonb;
  v_email text;
begin
  select * into i from public.booking_integrations where id = p_integration_id and is_active;
  if not found then raise exception 'BOOKING_INTEGRATION_UNAVAILABLE'; end if;
  select * into b from public.businesses where id = i.business_id and is_active and public_booking_enabled;
  if not found or not coalesce(public.business_allows_operation(i.business_id), false) then raise exception 'BOOKING_INTEGRATION_UNAVAILABLE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'duration_minutes', s.duration_minutes, 'price_label', s.price_label) order by s.sort_order, s.name, s.id), '[]') into services
  from public.services s where s.business_id = i.business_id and s.is_active and s.is_public and (cardinality(i.allowed_service_ids) = 0 or s.id = any(i.allowed_service_ids)) and exists(
    select 1 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.business_id = ps.business_id
    where ps.business_id = i.business_id and ps.service_id = s.id and p.is_active and p.is_public and (cardinality(i.allowed_professional_ids) = 0 or p.id = any(i.allowed_professional_ids))
  );
  v_email := nullif(trim(b.email), '');
  if not b.public_contact_enabled
     or v_email is null
     or length(v_email) > 254
     or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    v_email := null;
  end if;
  return jsonb_build_object(
    'services', services,
    'modalities', i.allowed_modalities,
    'contact', jsonb_build_object(
      'phone', case when b.public_contact_enabled then b.phone end,
      'email', v_email,
      'address', case when b.public_contact_enabled then b.address end,
      'whatsapp_phone', case when b.whatsapp_contact_enabled then b.whatsapp_phone end,
      'whatsapp_message', case when b.whatsapp_contact_enabled then b.whatsapp_message end
    )
  );
end $$;

commit;
