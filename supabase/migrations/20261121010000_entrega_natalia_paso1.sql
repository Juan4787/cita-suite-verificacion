-- Paso 1 de entrega a Natalia (docs/plans/entrega-natalia-paso-1.md):
--  AF1-001: allow_same_day_booking expuesto en catálogo de disponibilidad, vigilado por revisiones
--           y exigido en reserva pública y reprogramación del paciente (zona local del consultorio).
--  AF1-002: consultorio sin remitente listo no genera eventos/entregas de correo muertos ni exige
--           correo al reservar online.
--  AF1-010: contacto público coherente en get_public_practice_contact y get_public_booking_catalogue,
--           devolviendo teléfono/dirección nulos (sin error) cuando public_contact_enabled está apagado.
--  AF1-012: agregar/habilitar integrante no impone Consulta / Otro servicio si el consultorio ya tiene
--           servicios activos, y save_professional_editor permite desasignar cualquier servicio.
--  AF1-019: get_patient_data_revision devuelve can_create_patient=false para rol readonly.
-- Retrocompatible con la versión previa del Worker (sin quitar columnas ni cambiar firmas públicas).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ============================================================================
-- AF1-001: allow_same_day_booking en catálogo, revisiones y comandos públicos
-- ============================================================================

create or replace function private.advance_booking_availability_revision()
returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_table_name = 'businesses' then
    if row(new.timezone, new.public_booking_enabled, new.is_active, new.allow_same_day_booking, new.min_booking_notice_minutes, new.max_booking_days_ahead)
      is distinct from row(old.timezone, old.public_booking_enabled, old.is_active, old.allow_same_day_booking, old.min_booking_notice_minutes, old.max_booking_days_ahead) then
      new.booking_availability_revision := old.booking_availability_revision + 1;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.business_id is distinct from new.business_id then
    raise exception 'BOOKING_SCHEDULE_BUSINESS_IMMUTABLE';
  end if;
  update public.businesses
  set booking_availability_revision = booking_availability_revision + 1
  where id = case when tg_op = 'DELETE' then old.business_id else new.business_id end;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists business_availability_configuration on public.businesses;
create trigger business_availability_configuration after update of timezone, allow_same_day_booking, max_booking_days_ahead,
  min_booking_notice_minutes, is_active, public_booking_enabled on public.businesses
  for each row when ((old.timezone, old.allow_same_day_booking, old.max_booking_days_ahead, old.min_booking_notice_minutes, old.is_active, old.public_booking_enabled)
    is distinct from (new.timezone, new.allow_same_day_booking, new.max_booking_days_ahead, new.min_booking_notice_minutes, new.is_active, new.public_booking_enabled))
  execute function private.advance_availability_configuration();

create or replace function public.get_availability_catalog(p_business_id uuid, p_public boolean)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare business public.businesses%rowtype; revision bigint; result jsonb;
begin
  business := private.require_availability_business(p_business_id, p_public);
  select v.revision into revision from private.availability_configuration_versions v where v.business_id = p_business_id;
  if revision is null then raise exception 'AVAILABILITY_CONFIGURATION_MISSING'; end if;
  result := jsonb_build_object(
    'schema_version', 2, 'business_id', business.id, 'scope', case when p_public then 'public' else 'internal' end,
    'configuration_revision', revision, 'availability_revision', business.booking_availability_revision, 'generated_at', statement_timestamp(),
    'business', jsonb_build_object(
      'timezone', business.timezone,
      'allow_same_day_booking', business.allow_same_day_booking,
      'max_booking_days_ahead', business.max_booking_days_ahead,
      'min_booking_notice_minutes', business.min_booking_notice_minutes,
      'is_active', business.is_active,
      'public_booking_enabled', business.public_booking_enabled
    ),
    'services', coalesce((select jsonb_agg(to_jsonb(row) order by row.sort_order, row.name, row.id) from (
      select s.id, s.business_id, s.name, s.description, s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes,
        s.price_label, s.is_public, s.is_active, s.sort_order from public.services s
      where s.business_id = p_business_id and s.is_active and (not p_public or s.is_public)) row), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(to_jsonb(row) order by row.sort_order, row.name, row.id) from (
      select p.id, p.name, p.specialty, p.avatar_url, p.is_public, p.is_active, p.sort_order from public.professionals p
      where p.business_id = p_business_id and p.is_active and (not p_public or (p.is_public and length(trim(p.name)) > 0))) row), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(row) order by row.service_id, row.professional_id) from (
      select a.service_id, a.professional_id from public.professional_services a
      join public.services s on s.business_id = a.business_id and s.id = a.service_id
      join public.professionals p on p.business_id = a.business_id and p.id = a.professional_id
      where a.business_id = p_business_id and s.is_active and p.is_active
        and (not p_public or (s.is_public and p.is_public and length(trim(p.name)) > 0))) row), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(row) order by row.professional_id, row.weekday, row.start_time, row.id) from (
      select r.id, r.professional_id, r.weekday, r.start_time, r.end_time, r.slot_interval_minutes, r.break_minutes, r.is_active, r.service_scope,
        array(select rs.service_id from public.availability_rule_services rs where rs.business_id = r.business_id and rs.rule_id = r.id order by rs.service_id) as allowed_service_ids
      from public.availability_rules r join public.professionals p on p.business_id = r.business_id and p.id = r.professional_id
      where r.business_id = p_business_id and r.is_active and p.is_active
        and (not p_public or (p.is_public and length(trim(p.name)) > 0))) row), '[]'::jsonb)
  );
  if octet_length(result::text) > 5000000 then raise exception 'AVAILABILITY_RESPONSE_LIMIT'; end if;
  return result;
end $$;

create or replace function private.assert_public_booking_same_day(p_business_id uuid, p_starts_at timestamptz) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_business public.businesses;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_business from public.businesses where id = p_business_id for share;
  if not found then raise exception 'PUBLIC_BOOKING_UNAVAILABLE'; end if;
  if not v_business.allow_same_day_booking
    and (p_starts_at at time zone v_business.timezone)::date <= (v_now at time zone v_business.timezone)::date then
    raise exception 'PUBLIC_SAME_DAY_BOOKING_DISABLED';
  end if;
end $$;
revoke all on function private.assert_public_booking_same_day(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ============================================================================
-- AF1-002: sin remitente listo no se exige email ni se acumula trabajo muerto
-- ============================================================================

create or replace function private.assert_public_booking_email(p_business_id uuid, p_email text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare required boolean; email text := nullif(btrim(p_email), '');
begin
  select p.require_email into required from public.appointment_email_policies p where p.business_id = p_business_id for share;
  if not found then raise exception 'EMAIL_POLICY_UNAVAILABLE'; end if;
  if required and private.email_sender_ready(p_business_id) and email is null then
    raise exception 'PUBLIC_PATIENT_EMAIL_REQUIRED';
  end if;
  if email is not null and (char_length(email) > 254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'PUBLIC_PATIENT_EMAIL_INVALID';
  end if;
end $$;

create or replace function private.record_appointment_email_event() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_revision bigint; v_generation bigint; v_purpose text; v_enabled boolean;
begin
  if tg_op = 'UPDATE' and (new.starts_at, new.ends_at, new.service_id, new.professional_id)
    is distinct from (old.starts_at, old.ends_at, old.service_id, old.professional_id) then
    update public.appointment_management_states set schedule_revision = schedule_revision + 1, schedule_changed_at = clock_timestamp()
    where business_id = new.business_id and appointment_id = new.id returning schedule_revision into v_revision;
  end if;
  if v_revision is null then
    select schedule_revision into v_revision from public.appointment_management_states where business_id = new.business_id and appointment_id = new.id;
  end if;
  select email_producer_enabled into v_enabled from private.appointment_management_runtime where singleton for share;
  if v_enabled is not true then return null; end if;
  if not private.email_sender_ready(new.business_id) then return null; end if;
  if tg_op = 'INSERT' and new.status in ('reserved', 'confirmed', 'reschedule_requested') then v_purpose := 'booking_receipt';
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status in ('reserved', 'confirmed', 'reschedule_requested') then v_purpose := 'cancellation_receipt';
  elsif tg_op = 'UPDATE' and new.status in ('reserved', 'confirmed', 'reschedule_requested') and old.status in ('reserved', 'confirmed', 'reschedule_requested')
    and (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then v_purpose := 'reschedule_receipt';
  end if;
  if v_purpose is not null then
    select generation into v_generation from public.appointment_management_states where business_id = new.business_id and appointment_id = new.id;
    insert into private.appointment_email_events(business_id, appointment_id, schedule_revision, management_generation, purpose)
    values(new.business_id, new.id, v_revision, v_generation, v_purpose)
    on conflict(business_id, appointment_id, schedule_revision, management_generation, purpose) do nothing;
  end if;
  return null;
end $$;

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
  join public.appointment_email_policies p on p.business_id = a.business_id and p.email_enabled
  cross join (values('reminder_72h', interval '72 hours'), ('reminder_24h', interval '24 hours')) w(purpose, lead)
  where private.email_sender_ready(a.business_id)
    and a.status in ('reserved', 'confirmed', 'reschedule_requested')
    and a.starts_at > p_now and a.starts_at <= p_now + interval '72 hours 30 minutes'
    and p_now >= a.starts_at - w.lead and p_now < a.starts_at - w.lead + interval '30 minutes'
    and m.schedule_changed_at < a.starts_at - w.lead
  on conflict(business_id, appointment_id, dedupe_key) do nothing;
end $$;

create or replace function public.create_appointment_with_patient_identity(
  p_business_id uuid, p_patient_mode text, p_patient_id uuid, p_patient_name text, p_patient_phone_raw text,
  p_patient_phone_e164 text, p_patient_email text, p_update_existing_phone boolean, p_owner_id uuid,
  p_service_id uuid, p_professional_ids uuid[], p_starts_at timestamptz, p_internal_note text,
  p_created_by_user_id uuid, p_ignore_break boolean, p_source text, p_phone_communication_status text,
  p_phone_warning_acknowledged boolean, p_idempotency_key text, p_replay_only boolean default false
)
returns table(
  id uuid, patient_id uuid, confirmation_token text, starts_at timestamptz, ends_at timestamptz,
  service_name_snapshot text, professional_name_snapshot text, patient_created boolean,
  idempotent_replay boolean, patient_resolution_strategy text
)
language plpgsql security definer set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  created record; current_appointment public.appointments;
begin
  if coalesce(nullif(btrim(p_source), ''), 'manual') in ('manual', 'admin')
    and private.business_operation_actor(p_business_id, array['owner', 'admin', 'reception'], p_created_by_user_id) is null then
    raise exception 'APPOINTMENT_CREATOR_INVALID';
  end if;
  perform set_config('cita.booking_professional_ids', coalesce(p_professional_ids, '{}'::uuid[])::text, true);
  for created in select * from public.create_appointment_with_patient_identity_before_pricing(
    p_business_id, p_patient_mode, p_patient_id, p_patient_name, p_patient_phone_raw, p_patient_phone_e164, p_patient_email,
    p_update_existing_phone, p_owner_id, p_service_id, p_professional_ids, p_starts_at, p_internal_note, p_created_by_user_id,
    p_ignore_break, p_source, p_phone_communication_status, p_phone_warning_acknowledged, p_idempotency_key, p_replay_only
  ) loop
    if lower(btrim(p_source)) = 'public_booking' and not created.idempotent_replay then
      perform private.assert_public_booking_same_day(p_business_id, p_starts_at);
      perform private.assert_public_booking_email(p_business_id, p_patient_email);
    end if;
    select * into current_appointment from public.appointments a
    where a.business_id = p_business_id and a.id = created.id for no key update;
    if not found or current_appointment.patient_resolution_strategy = 'reassigned_manual'
      or (current_appointment.patient_id, current_appointment.confirmation_token) is distinct from
        (created.patient_id, created.confirmation_token) then
      raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT';
    end if;
    if lower(btrim(p_source)) = 'public_booking' and not created.idempotent_replay and nullif(btrim(p_patient_email), '') is not null then
      insert into private.public_booking_email_contacts(business_id, appointment_id, patient_id_snapshot, patient_contact_revision, email)
      select current_appointment.business_id, current_appointment.id, p.id, p.email_contact_revision, btrim(p_patient_email)
      from public.patients p where (p.business_id, p.id) = (current_appointment.business_id, current_appointment.patient_id);
      if not found then raise exception 'PATIENT_NOT_FOUND'; end if;
    end if;
    if lower(btrim(p_source)) = 'public_booking' and not created.idempotent_replay then
      perform private.accept_booking_reschedule_policy(p_business_id, current_appointment.id, null);
    elsif coalesce(nullif(lower(btrim(p_source)), ''), 'manual') in ('manual', 'admin') and not created.idempotent_replay then
      perform private.accept_booking_reschedule_policy(p_business_id, current_appointment.id, p_created_by_user_id);
    end if;
    return query select created.id, created.patient_id, created.confirmation_token, created.starts_at, created.ends_at,
      created.service_name_snapshot, created.professional_name_snapshot, created.patient_created, created.idempotent_replay, created.patient_resolution_strategy;
  end loop;
  if coalesce(nullif(btrim(p_source), ''), 'manual') in ('manual', 'admin')
    and private.business_operation_actor(p_business_id, array['owner', 'admin', 'reception'], p_created_by_user_id) is null then
    raise exception 'APPOINTMENT_CREATOR_INVALID';
  end if;
end;
$function$;

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
        or (p_starts_at at time zone b.timezone)::date > ((v_now + make_interval(mins => b.max_booking_days_ahead * 1440)) at time zone b.timezone)::date then
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
-- AF1-010: contacto público coherente sin error cuando un dato está apagado
-- ============================================================================

create or replace function public.get_public_practice_contact(p_key text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare integration public.booking_integrations%rowtype; business public.businesses%rowtype;
begin
  select * into integration from public.booking_integrations where public_key = p_key;
  if not found then raise exception 'PUBLIC_CONTACT_UNAVAILABLE'; end if;
  select * into business from public.businesses where id = integration.business_id and is_active;
  if not found then raise exception 'PUBLIC_CONTACT_UNAVAILABLE'; end if;
  return jsonb_build_object(
    'allowed_origins', integration.allowed_origins,
    'contact', jsonb_build_object(
      'phone', case when business.public_contact_enabled then business.phone end,
      'address', case when business.public_contact_enabled then business.address end,
      'whatsapp_phone', case when business.whatsapp_contact_enabled then business.whatsapp_phone end,
      'whatsapp_message', case when business.whatsapp_contact_enabled then business.whatsapp_message end
    )
  );
end $$;

create or replace function public.get_public_booking_catalogue(p_integration_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare i public.booking_integrations%rowtype; b public.businesses%rowtype; services jsonb;
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
  return jsonb_build_object(
    'services', services,
    'modalities', i.allowed_modalities,
    'contact', jsonb_build_object(
      'phone', case when b.public_contact_enabled then b.phone end,
      'address', case when b.public_contact_enabled then b.address end,
      'whatsapp_phone', case when b.whatsapp_contact_enabled then b.whatsapp_phone end,
      'whatsapp_message', case when b.whatsapp_contact_enabled then b.whatsapp_message end
    )
  );
end $$;

-- ============================================================================
-- AF1-012: no imponer Consulta / Otro servicio y permitir desasignarlos
-- ============================================================================

create or replace function private.assign_team_default_services(p_business_id uuid, p_professional_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_name text; v_service uuid;
begin
  -- Sólo sembrar servicios genéricos si el consultorio todavía no tiene ningún servicio activo.
  if exists(select 1 from public.services s where s.business_id = p_business_id and s.is_active) then
    return;
  end if;
  for v_name in select unnest(array['Consulta', 'Otro servicio']) loop
    select s.id into v_service from public.services s where s.business_id = p_business_id and lower(trim(s.name)) = lower(v_name) order by s.created_at, s.id limit 1;
    if v_service is null then
      insert into public.services(business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_active, is_public)
      values(p_business_id, v_name, 30, 0, 0, true, true) returning id into v_service;
    else
      update public.services set is_active = true, is_public = true, updated_at = clock_timestamp()
      where business_id = p_business_id and id = v_service and (not is_active or not is_public);
    end if;
    insert into public.professional_services(business_id, professional_id, service_id)
    values(p_business_id, p_professional_id, v_service) on conflict do nothing;
  end loop;
end $$;

create or replace function public.create_team_member_profile(p_business_id uuid, p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_professional uuid; v_email text; v_role text; v_service uuid; v_item jsonb; v_ids uuid[]; v_revision bigint; v_status text; v_exception jsonb;
begin
  perform private.lock_team_manager_authority(p_business_id);
  if jsonb_typeof(p_configuration) is distinct from 'object' or octet_length(p_configuration::text) > 200000 then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
  if jsonb_typeof(p_configuration->'professionalId') is distinct from 'string' or jsonb_typeof(p_configuration->'email') is distinct from 'string' or jsonb_typeof(p_configuration->'role') is distinct from 'string' or jsonb_typeof(p_configuration->'name') is distinct from 'string' then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
  v_email := lower(trim(p_configuration->>'email')); v_role := p_configuration->>'role';
  if coalesce(v_role, '') not in ('owner', 'admin', 'professional') then raise exception 'PROFESSIONAL_ROLE_NOT_SUPPORTED'; end if;
  if coalesce(length(trim(p_configuration->>'name')), 0) not between 1 and 160 then raise exception 'SCHEDULE_PROFILE_INVALID'; end if;
  perform 1 from public.businesses where id = p_business_id for update;
  v_professional := (p_configuration->>'professionalId')::uuid;
  if v_professional is null then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
  insert into public.professionals(id, business_id, name, specialty, email, is_active, is_public)
  values(v_professional, p_business_id, trim(p_configuration->>'name'), nullif(trim(p_configuration->>'specialty'), ''), v_email, true, false);
  if jsonb_typeof(p_configuration->'serviceIds') is distinct from 'array' or jsonb_array_length(p_configuration->'serviceIds') > 500
    or jsonb_typeof(p_configuration->'newServices') is distinct from 'array' or jsonb_array_length(p_configuration->'newServices') > 500
    or jsonb_array_length(p_configuration->'serviceIds') + jsonb_array_length(p_configuration->'newServices') > 500 then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
  for v_item in select value from jsonb_array_elements(p_configuration->'serviceIds') loop
    v_service := (v_item#>>'{}')::uuid;
    if v_service is null or not exists(select 1 from public.services where business_id = p_business_id and id = v_service) then raise exception 'INVALID_SERVICE_ASSIGNMENT'; end if;
    insert into public.professional_services(business_id, professional_id, service_id) values(p_business_id, v_professional, v_service) on conflict do nothing;
  end loop;
  for v_item in select value from jsonb_array_elements(p_configuration->'newServices') loop
    if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'name') is distinct from 'string' or coalesce(length(trim(v_item->>'name')), 0) = 0 then raise exception 'NEW_SERVICE_NAME_REQUIRED'; end if;
    if jsonb_typeof(v_item->'duration_minutes') is distinct from 'number' or (v_item->>'duration_minutes')::numeric <> trunc((v_item->>'duration_minutes')::numeric)
      or (v_item->>'duration_minutes')::numeric not between 5 and 480 then raise exception 'NEW_SERVICE_DURATION_INVALID'; end if;
    insert into public.services(business_id, name, duration_minutes, price_label, description, buffer_before_minutes, buffer_after_minutes, is_active, is_public)
    values(p_business_id, trim(v_item->>'name'), (v_item->>'duration_minutes')::numeric::integer, nullif(trim(v_item->>'price_label'), ''), null, 0, 0, true, true) returning id into v_service;
    insert into public.professional_services(business_id, professional_id, service_id) values(p_business_id, v_professional, v_service);
  end loop;
  -- Sólo sembrar servicios base después de aplicar los propios/elegidos, si el consultorio sigue sin ningún servicio activo.
  perform private.assign_team_default_services(p_business_id, v_professional);
  select booking_availability_revision into v_revision from public.businesses where id = p_business_id;
  perform public.replace_professional_schedule_blocks(p_business_id, v_professional, v_revision, p_configuration->'blocks');
  v_exception := p_configuration->'exception';
  if v_exception is not null and jsonb_typeof(v_exception) <> 'null' then
    if jsonb_typeof(v_exception) is distinct from 'object' or coalesce(v_exception->>'appliesTo', '') not in ('business', 'professional') then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
    select booking_availability_revision into v_revision from public.businesses where id = p_business_id;
    perform public.create_availability_exception_batch(p_business_id, v_revision, gen_random_uuid(), jsonb_build_array(jsonb_build_object(
      'professional_id', case when v_exception->>'appliesTo' = 'business' then null else v_professional end,
      'type', v_exception->>'type', 'starts_at', v_exception->>'startsAt', 'ends_at', v_exception->>'endsAt', 'reason', v_exception->>'reason', 'service_ids', '[]'::jsonb)), false);
  end if;
  select access.status into v_status from public.upsert_business_role_access(p_business_id, v_email, v_role, v_professional) access;
  if coalesce(v_status, '') not in ('active', 'pending', 'already_active', 'already_pending') then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
  update public.professionals set is_public = v_status in ('active', 'already_active'), updated_at = clock_timestamp() where business_id = p_business_id and id = v_professional;
  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(p_business_id, auth.uid(), 'professional.created', 'professional', v_professional, jsonb_build_object(
    'name', trim(p_configuration->>'name'), 'email', v_email,
    'schedule_blocks', (select jsonb_agg(jsonb_build_object('weekdays', block->'weekdays', 'ranges', block->'ranges',
      'slotIntervalMinutes', block->'slot_interval_minutes', 'breakMinutes', block->'break_minutes', 'serviceScope', block->'service_scope', 'allowedServiceIds', block->'service_ids')) from jsonb_array_elements(p_configuration->'blocks') block),
    'service_ids', (select coalesce(jsonb_agg(ps.service_id order by ps.service_id), '[]'::jsonb) from public.professional_services ps where ps.business_id = p_business_id and ps.professional_id = v_professional)));
  return jsonb_build_object('status', v_status, 'professionalId', v_professional);
end $$;

create or replace function public.save_professional_editor(
  p_business_id uuid, p_professional_id uuid, p_expected_revision bigint, p_profile jsonb,
  p_service_ids uuid[], p_blocks jsonb, p_exception_request_id uuid, p_exception_items jsonb,
  p_ack_existing boolean default false
) returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare revision bigint;
begin
  if not coalesce(public.user_can_manage_business(p_business_id), false) or not public.business_allows_operation(p_business_id) then raise exception 'SCHEDULE_ACCESS_DENIED'; end if;
  select booking_availability_revision into revision from public.businesses where id = p_business_id for update;
  if revision is distinct from p_expected_revision then raise exception 'SCHEDULE_CHANGED'; end if;
  perform 1 from public.professionals where id = p_professional_id and business_id = p_business_id for update;
  if not found then raise exception 'SCHEDULE_SCOPE_INVALID'; end if;
  if p_profile is not null then
    if jsonb_typeof(p_profile) <> 'object' or octet_length(p_profile::text) > 4096 or coalesce(length(trim(p_profile->>'name')), 0) not between 1 and 160 then raise exception 'SCHEDULE_PROFILE_INVALID'; end if;
    update public.professionals set name = trim(p_profile->>'name'), specialty = nullif(trim(p_profile->>'specialty'), ''), phone = nullif(trim(p_profile->>'phone'), ''), email = nullif(lower(trim(p_profile->>'email')), ''), is_public = (p_profile->>'is_public')::boolean, is_active = coalesce((p_profile->>'is_active')::boolean, is_active), updated_at = clock_timestamp() where id = p_professional_id and business_id = p_business_id;
  end if;
  if p_service_ids is not null then
    if cardinality(p_service_ids) > 500 or exists(select 1 from unnest(p_service_ids) submitted(id) where submitted.id is null or not exists(select 1 from public.services where business_id = p_business_id and services.id = submitted.id)) then raise exception 'SCHEDULE_SCOPE_INVALID'; end if;
    select coalesce(array_agg(distinct id), '{}'::uuid[]) into p_service_ids from unnest(p_service_ids) id;
    delete from public.professional_services where business_id = p_business_id and professional_id = p_professional_id and not (service_id = any(p_service_ids));
    insert into public.professional_services(business_id, professional_id, service_id) select p_business_id, p_professional_id, unnest(p_service_ids) on conflict do nothing;
  end if;
  if p_blocks is not null then
    select booking_availability_revision into revision from public.businesses where id = p_business_id;
    perform public.replace_professional_schedule_blocks(p_business_id, p_professional_id, revision, p_blocks);
  end if;
  if p_exception_items is not null then
    select booking_availability_revision into revision from public.businesses where id = p_business_id;
    perform public.create_availability_exception_batch(p_business_id, revision, p_exception_request_id, p_exception_items, p_ack_existing);
  end if;
  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata) values(p_business_id, auth.uid(), 'professional.editor_saved', 'professional', p_professional_id, jsonb_build_object('profile', p_profile is not null, 'services', p_service_ids is not null, 'schedule', p_blocks is not null, 'exceptions', p_exception_items is not null));
end $$;

-- ============================================================================
-- AF1-019: get_patient_data_revision respeta rol readonly en can_create_patient
-- ============================================================================

create or replace function public.get_patient_data_revision(p_business_id uuid)
returns table (
  business_id uuid,
  patients_revision bigint,
  realtime_topic text,
  viewer_role text,
  can_create_patient boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.user_has_business_access(p_business_id)
  then
    raise exception using
      errcode = '42501',
      message = 'PATIENT_REVISION_FORBIDDEN';
  end if;

  v_role := public.user_business_role(p_business_id);
  if v_role not in ('owner', 'admin', 'reception', 'professional', 'readonly') then
    raise exception using
      errcode = '42501',
      message = 'PATIENT_REVISION_FORBIDDEN';
  end if;

  insert into public.business_data_revisions (business_id)
  values (p_business_id)
  on conflict on constraint business_data_revisions_pkey do nothing;

  return query
  select
    revisions.business_id,
    revisions.patients_revision,
    'business-data:' || revisions.realtime_topic_token::text,
    v_role,
    v_role <> 'readonly' and public.business_allows_operation(p_business_id)
  from public.business_data_revisions revisions
  where revisions.business_id = p_business_id;
end;
$$;

notify pgrst, 'reload schema';
commit;
