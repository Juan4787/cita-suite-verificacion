-- Lote 0 de la entrega a Natalia (docs/plans/entrega-natalia-implementacion.md):
--  D1: private.appointment_management_snapshot separa estrictamente address_instructions
--      (sólo turnos presenciales) de integration.video_instructions_snapshot (turnos virtuales).
--  D2: public.get_email_unsubscribe_state distingue enlace activo, vencido (exponiendo sólo
--      el nombre y el contacto público del consultorio si está activo) e inválido sin revelar nada.
--      public.get_email_unsubscribe(text) conserva su firma y comportamiento para compatibilidad
--      de vuelta atrás con la revisión previa del Worker.
--  D3: definición única en la base para elegibilidad y cobertura del recordatorio de 24 h por
--      correo, compartida por el planificador (private.plan_appointment_email_work), el despacho
--      (public.claim_appointment_email_batch) y la consulta autenticada de Recordatorios y Agenda
--      (public.list_appointment_email_reminder_coverage).
-- Retrocompatible con el Worker anterior b6c3a8ae: no quita columnas ni cambia firmas existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ============================================================================
-- D1: separar indicaciones de llegada físicas e indicaciones online en snapshot
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
      'video_instructions_snapshot', c.video_instructions_snapshot, 'modality_windows', i.modality_windows
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
-- D2: estado de baja con datos públicos del consultorio para enlaces vencidos
-- ============================================================================

create or replace function public.get_email_unsubscribe_state(p_token text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  t private.email_unsubscribe_tokens;
  b public.businesses;
  v_contact jsonb;
begin
  if not coalesce(p_token ~ '^[0-9a-f]{64}$', false) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into t from private.email_unsubscribe_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into b from public.businesses where id = t.business_id;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_contact := jsonb_build_object(
    'phone', case when b.is_active and b.public_contact_enabled then b.phone end,
    'whatsapp_phone', case when b.is_active and b.whatsapp_contact_enabled then b.whatsapp_phone end
  );
  if t.expires_at <= clock_timestamp() then
    return jsonb_build_object(
      'status', 'expired',
      'business_name', case when b.is_active then b.name end,
      'contact', v_contact
    );
  end if;
  return jsonb_build_object(
    'status', 'active',
    'business_name', b.name,
    'unsubscribed', exists(
      select 1 from private.email_suppressions s
      where s.business_id = t.business_id
        and s.email_normalized = t.email_normalized
        and s.lifted_at is null
    ),
    'contact', v_contact
  );
end $$;

-- ============================================================================
-- D3: definición única de cobertura de recordatorio por correo (planificador + lista)
-- ============================================================================

create or replace function private.appointment_email_channel_ready(
  p_business_id uuid,
  p_appointment_id uuid
) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce((select r.email_producer_enabled from private.appointment_management_runtime r where r.singleton), false)
    and coalesce((select p.email_enabled from public.appointment_email_policies p where p.business_id = p_business_id), false)
    and private.email_sender_ready(p_business_id)
    and exists(
      select 1
      from private.appointment_email_contact(p_business_id, p_appointment_id) c
      where nullif(btrim(c.email), '') is not null
        and char_length(btrim(c.email)) <= 254
        and btrim(c.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and not exists(
          select 1
          from private.email_suppressions s
          where s.business_id = p_business_id
            and s.email_normalized = lower(btrim(c.email))
            and s.lifted_at is null
        )
    )
$$;

create or replace function private.appointment_email_reminders_active(
  p_business_id uuid,
  p_appointment_id uuid
) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select private.appointment_email_channel_ready(p_business_id, p_appointment_id)
$$;

create or replace function private.appointment_email_reminder_eligible(
  p_business_id uuid,
  p_appointment_id uuid,
  p_lead interval,
  p_now timestamptz
) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists(
    select 1
    from public.appointments a
    join public.appointment_management_states m
      on (m.business_id, m.appointment_id) = (a.business_id, a.id)
    where (a.business_id, a.id) = (p_business_id, p_appointment_id)
      and a.status in ('reserved', 'confirmed', 'reschedule_requested')
      and a.starts_at > p_now
      and m.schedule_changed_at < a.starts_at - p_lead
      and p_now < least(a.starts_at - p_lead + interval '30 minutes', a.starts_at)
      and private.appointment_email_channel_ready(a.business_id, a.id)
  )
$$;

create or replace function private.appointment_email_receipt_covers_due(
  p_business_id uuid,
  p_appointment_id uuid,
  p_schedule_revision bigint,
  p_patient_id uuid,
  p_contact_revision bigint,
  p_due_at timestamptz
) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists(
    select 1
    from private.appointment_email_deliveries r
    where (r.business_id, r.appointment_id) = (p_business_id, p_appointment_id)
      and r.schedule_revision = p_schedule_revision
      and r.purpose in ('booking_receipt', 'reschedule_receipt')
      and r.state in ('accepted', 'delivered')
      and (r.patient_id is null or r.patient_id = p_patient_id)
      and r.contact_revision = p_contact_revision
      and r.accepted_at >= p_due_at - interval '30 minutes'
  )
$$;

create or replace function private.appointment_email_reminder_24h_covered(
  p_business_id uuid,
  p_appointment_id uuid,
  p_now timestamptz
) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists(
    select 1
    from public.appointments a
    join public.appointment_management_states m
      on (m.business_id, m.appointment_id) = (a.business_id, a.id)
    cross join lateral private.appointment_email_contact(a.business_id, a.id) c
    left join private.appointment_email_deliveries d
      on (d.business_id, d.appointment_id) = (a.business_id, a.id)
      and d.dedupe_key = 'reminder_24h:' || m.schedule_revision
    where (a.business_id, a.id) = (p_business_id, p_appointment_id)
      and a.status in ('reserved', 'confirmed', 'reschedule_requested')
      and a.starts_at > p_now
      and (
        (
          d.id is not null
          and (
            (
              d.state in ('accepted', 'delivered')
              and (d.patient_id is null or d.patient_id = c.patient_id)
              and d.contact_revision = c.contact_revision
            )
            or (
              d.state = 'sending'
              and d.lease_expires_at > p_now
              and (d.patient_id is null or d.patient_id = c.patient_id)
              and d.contact_revision = c.contact_revision
            )
            or (
              d.state in ('pending', 'retry')
              and d.expires_at > p_now
              and coalesce(d.next_attempt_at, d.due_at) < d.expires_at
              and private.appointment_email_channel_ready(a.business_id, a.id)
            )
          )
        )
        or (
          d.id is null
          and private.appointment_email_reminder_eligible(a.business_id, a.id, interval '24 hours', p_now)
        )
        or private.appointment_email_receipt_covers_due(
          a.business_id,
          a.id,
          m.schedule_revision,
          c.patient_id,
          c.contact_revision,
          a.starts_at - interval '24 hours'
        )
      )
  )
$$;

create or replace function private.plan_appointment_email_work(p_now timestamptz, p_limit integer)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare e record; c record; v_enabled_at timestamptz;
begin
  select email_producer_enabled_at into v_enabled_at from private.appointment_management_runtime where singleton;

  for e in select * from private.appointment_email_events where processed_at is null
    order by occurred_at, id limit p_limit for update skip locked loop
    if private.email_sender_ready(e.business_id) then
      insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, due_at, expires_at)
      select e.business_id, e.appointment_id, e.purpose, e.purpose || ':' || e.schedule_revision, e.schedule_revision, e.occurred_at,
        case when e.purpose = 'cancellation_receipt' then e.occurred_at + interval '24 hours'
          else least(e.occurred_at + interval '24 hours', a.starts_at) end
      from public.appointments a where (a.business_id, a.id) = (e.business_id, e.appointment_id)
      on conflict(business_id, appointment_id, dedupe_key) do nothing;
    end if;
    update private.appointment_email_events set processed_at = p_now where id = e.id;
  end loop;

  for c in select * from private.patient_email_contact_events where processed_at is null
    order by created_at, patient_id limit p_limit for update skip locked loop
    if private.email_sender_ready(c.business_id) then
      insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, due_at, expires_at)
      select a.business_id, a.id, 'booking_receipt', 'contact:' || c.contact_revision || ':' || m.schedule_revision, m.schedule_revision, p_now,
        least(p_now + interval '24 hours', a.starts_at)
      from public.appointments a
      join public.appointment_management_states m on (m.business_id, m.appointment_id) = (a.business_id, a.id)
      where a.business_id = c.business_id and a.patient_id = c.patient_id
        and a.status in ('reserved', 'confirmed', 'reschedule_requested') and a.starts_at > p_now
        and v_enabled_at is not null and c.created_at >= v_enabled_at
        and not exists(select 1 from private.appointment_email_deliveries d
          where (d.business_id, d.appointment_id) = (a.business_id, a.id) and d.schedule_revision = m.schedule_revision
            and d.purpose in ('booking_receipt', 'reschedule_receipt') and d.state in ('accepted', 'delivered', 'pending', 'retry', 'sending', 'uncertain'))
      on conflict(business_id, appointment_id, dedupe_key) do nothing;
    end if;
    update private.patient_email_contact_events set processed_at = p_now
    where (business_id, patient_id, contact_revision) = (c.business_id, c.patient_id, c.contact_revision);
  end loop;

  insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, due_at, expires_at)
  select a.business_id, a.id, 'deposit_request', 'deposit_request:' || r.id, m.schedule_revision, p_now, least(d.due_at, a.starts_at)
  from public.appointment_deposit_requirements r
  join public.appointment_deposits d on (d.business_id, d.appointment_id) = (r.business_id, r.appointment_id)
  join public.appointments a on (a.business_id, a.id) = (r.business_id, r.appointment_id)
  join public.appointment_management_states m on (m.business_id, m.appointment_id) = (a.business_id, a.id)
  where r.is_current and r.status = 'pending' and d.status = 'pending' and v_enabled_at is not null and r.created_at >= v_enabled_at
    and private.email_sender_ready(a.business_id)
    and a.status in ('reserved', 'confirmed', 'reschedule_requested') and a.starts_at > p_now and d.due_at > p_now
    and not exists(select 1 from private.appointment_email_deliveries x
      where (x.business_id, x.appointment_id) = (a.business_id, a.id) and x.schedule_revision = m.schedule_revision
        and x.purpose in ('booking_receipt', 'reschedule_receipt') and x.state <> 'discarded')
  on conflict(business_id, appointment_id, dedupe_key) do nothing;

  insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, due_at, expires_at)
  select a.business_id, a.id, w.purpose, w.purpose || ':' || m.schedule_revision, m.schedule_revision, a.starts_at - w.lead,
    least(a.starts_at - w.lead + interval '30 minutes', a.starts_at)
  from public.appointments a
  join public.appointment_management_states m on (m.business_id, m.appointment_id) = (a.business_id, a.id)
  cross join (values('reminder_72h', interval '72 hours'), ('reminder_24h', interval '24 hours')) w(purpose, lead)
  where a.status in ('reserved', 'confirmed', 'reschedule_requested')
    and a.starts_at > p_now and a.starts_at <= p_now + interval '72 hours 30 minutes'
    and p_now >= a.starts_at - w.lead
    and private.appointment_email_reminder_eligible(a.business_id, a.id, w.lead, p_now)
  on conflict(business_id, appointment_id, dedupe_key) do nothing;
end $$;

create or replace function public.claim_appointment_email_batch(p_limit integer, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_runtime private.appointment_management_runtime;
  d private.appointment_email_deliveries;
  a public.appointments;
  m public.appointment_management_states;
  pol public.appointment_email_policies;
  s private.business_email_senders;
  dep public.appointment_deposits;
  v_contact record;
  v_items jsonb := '[]'::jsonb;
  v_taken integer := 0;
  v_used integer;
  v_budget integer;
  v_lease uuid;
  v_token text;
  v_unsub text;
  v_snapshot jsonb;
  v_email text;
  v_discarded integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 or not isfinite(v_now) then raise exception 'EMAIL_CLAIM_INVALID'; end if;
  select * into v_runtime from private.appointment_management_runtime where singleton;
  if not v_runtime.email_producer_enabled then return jsonb_build_object('enabled', false, 'items', '[]'::jsonb); end if;

  perform private.plan_appointment_email_work(v_now, 50);

  update private.appointment_email_deliveries set state = 'uncertain', failure_code = 'lease_expired', lease_token = null, lease_expires_at = null
  where state = 'sending' and lease_expires_at <= v_now;
  update private.appointment_email_deliveries set state = 'discarded', discard_reason = 'expired', next_attempt_at = null
  where state in ('pending', 'retry') and expires_at <= v_now;

  if v_runtime.email_paused_until is not null and v_runtime.email_paused_until > v_now then
    return jsonb_build_object('enabled', true, 'paused', true, 'reason', v_runtime.email_pause_reason, 'items', '[]'::jsonb);
  end if;

  select count(*) into v_used from private.appointment_email_deliveries where started_at > v_now - interval '24 hours';
  v_budget := greatest(0, v_runtime.email_daily_limit - v_runtime.email_daily_reserve - v_used);

  for d in select x.* from private.appointment_email_deliveries x
    where x.state in ('pending', 'retry') and coalesce(x.next_attempt_at, x.due_at) <= v_now and private.email_sender_ready(x.business_id)
    order by case when x.purpose in ('booking_receipt', 'reschedule_receipt', 'cancellation_receipt') then 0 when x.purpose = 'deposit_request' then 1 else 2 end, x.due_at, x.id
    limit p_limit * 3 for update of x skip locked loop
    exit when v_taken >= p_limit or v_budget <= 0;
    select * into a from public.appointments where business_id = d.business_id and id = d.appointment_id for no key update skip locked;
    continue when not found;
    select * into m from public.appointment_management_states where business_id = d.business_id and appointment_id = d.appointment_id;
    select * into pol from public.appointment_email_policies where business_id = d.business_id;
    select * into s from private.business_email_senders where business_id = d.business_id;
    select * into dep from public.appointment_deposits where business_id = d.business_id and appointment_id = d.appointment_id;

    if not pol.email_enabled then perform private.discard_appointment_email(d.id, 'email_disabled'); v_discarded := v_discarded + 1; continue; end if;
    if d.purpose = 'cancellation_receipt' then
      if a.status <> 'cancelled' then perform private.discard_appointment_email(d.id, 'not_cancelled'); v_discarded := v_discarded + 1; continue; end if;
    else
      if a.status not in ('reserved', 'confirmed', 'reschedule_requested') then perform private.discard_appointment_email(d.id, 'appointment_cancelled'); v_discarded := v_discarded + 1; continue; end if;
      if a.starts_at <= v_now then perform private.discard_appointment_email(d.id, 'appointment_started'); v_discarded := v_discarded + 1; continue; end if;
      if d.schedule_revision is distinct from m.schedule_revision then perform private.discard_appointment_email(d.id, 'superseded_schedule'); v_discarded := v_discarded + 1; continue; end if;
    end if;
    if d.purpose = 'deposit_request' and (dep.appointment_id is null or dep.status <> 'pending') then
      perform private.discard_appointment_email(d.id, 'deposit_not_pending'); v_discarded := v_discarded + 1; continue;
    end if;

    select * into v_contact from private.appointment_email_contact(d.business_id, d.appointment_id);
    v_email := btrim(v_contact.email);
    if v_email is null or v_email = '' then perform private.discard_appointment_email(d.id, 'no_recipient'); v_discarded := v_discarded + 1; continue; end if;
    if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      perform private.discard_appointment_email(d.id, 'invalid_recipient'); v_discarded := v_discarded + 1; continue; end if;
    if exists(select 1 from private.email_suppressions x where x.business_id = d.business_id and x.email_normalized = lower(v_email) and x.lifted_at is null) then
      perform private.discard_appointment_email(d.id, 'suppressed'); v_discarded := v_discarded + 1; continue; end if;
    if d.purpose in ('reminder_72h', 'reminder_24h') and private.appointment_email_receipt_covers_due(
      d.business_id, d.appointment_id, d.schedule_revision, v_contact.patient_id, v_contact.contact_revision, d.due_at
    ) then
      perform private.discard_appointment_email(d.id, 'covered_by_receipt'); v_discarded := v_discarded + 1; continue;
    end if;

    v_token := null;
    if d.purpose <> 'cancellation_receipt' then
      v_token := public.issue_appointment_management_capability(d.business_id, d.appointment_id, m.generation);
    end if;
    v_unsub := encode(extensions.gen_random_bytes(32), 'hex');
    insert into private.email_unsubscribe_tokens(token_hash, business_id, email_normalized, delivery_id, expires_at)
    values(encode(extensions.digest(v_unsub, 'sha256'), 'hex'), d.business_id, lower(v_email), d.id, v_now + interval '365 days');
    v_snapshot := private.appointment_management_snapshot(d.business_id, d.appointment_id, null, v_now);
    v_lease := gen_random_uuid();
    update private.appointment_email_deliveries set state = 'sending', attempts = attempts + 1, lease_token = v_lease, lease_expires_at = v_now + interval '10 minutes',
      next_attempt_at = null, started_at = v_now, recipient_email = v_email, patient_id = v_contact.patient_id, contact_revision = v_contact.contact_revision, management_generation = m.generation
    where id = d.id;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'delivery_id', d.id, 'lease_token', v_lease, 'purpose', d.purpose, 'recipient', v_email,
      'token', v_token, 'unsubscribe_token', v_unsub,
      'sender', jsonb_build_object('from_address', s.from_local || '@' || s.sending_domain, 'reply_to', coalesce(s.reply_to_email, s.from_local || '@' || s.sending_domain)),
      'preferences', jsonb_build_object('show_cancel', pol.show_cancel, 'show_reschedule', pol.show_reschedule),
      'snapshot', v_snapshot
    ));
    v_taken := v_taken + 1; v_budget := v_budget - 1;
  end loop;

  return jsonb_build_object(
    'enabled', true, 'paused', false, 'items', v_items, 'discarded', v_discarded,
    'quota', jsonb_build_object('used', v_used + v_taken, 'limit', v_runtime.email_daily_limit, 'reserve', v_runtime.email_daily_reserve)
  );
end $$;

create or replace function public.list_appointment_email_reminder_coverage(
  p_business_id uuid,
  p_appointment_ids uuid[],
  p_now timestamptz default null
) returns table(appointment_id uuid, covered boolean)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  if p_business_id is null or not isfinite(v_now) then
    raise exception 'REMINDER_COVERAGE_INVALID';
  end if;
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'APPOINTMENT_MANAGEMENT_FORBIDDEN';
  end if;
  if p_appointment_ids is null or cardinality(p_appointment_ids) = 0 then
    return;
  end if;
  if cardinality(p_appointment_ids) > 500 then
    raise exception 'REMINDER_COVERAGE_BATCH_INVALID';
  end if;
  return query
    select a.id, private.appointment_email_reminder_24h_covered(a.business_id, a.id, v_now)
    from public.appointments a
    where a.business_id = p_business_id
      and a.id = any(p_appointment_ids);
end $$;

revoke all on function
  private.appointment_email_channel_ready(uuid, uuid),
  private.appointment_email_reminder_eligible(uuid, uuid, interval, timestamptz),
  private.appointment_email_receipt_covers_due(uuid, uuid, bigint, uuid, bigint, timestamptz),
  private.appointment_email_reminder_24h_covered(uuid, uuid, timestamptz),
  public.get_email_unsubscribe_state(text),
  public.list_appointment_email_reminder_coverage(uuid, uuid[], timestamptz)
from public, anon, authenticated, service_role;

grant execute on function public.get_email_unsubscribe_state(text) to service_role;
grant execute on function public.list_appointment_email_reminder_coverage(uuid, uuid[], timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
