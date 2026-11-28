-- Lote 2A de la entrega a Natalia (docs/plans/entrega-natalia-implementacion.md):
--  P5: límite de horas antes del turno para autogestión (cancelar y reprogramar) en
--      public.appointment_email_policies.self_management_cutoff_hours, aplicado en la
--      base (APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED), en el snapshot de la página
--      del turno y en los correos reclamados. Confirmar asistencia y el personal no
--      tienen límite.
--  P2: plazo configurable para reservas tardías en deposit_policies.late_booking_payment_hours
--      (snapshot en appointment_deposits y appointment_deposit_requirements), con vencimiento
--      least(starts_at, greatest(normal_due, from + late_booking_payment_hours)) y corte de
--      cancelación automática a las 24 horas antes del turno.
--  P3: marca «No cancelar sus turnos por seña impaga» en public.patients con auditoría de
--      quién y cuándo (RPC autenticada set_patient_deposit_auto_cancel_exemption para
--      owner/admin/reception), supresión/recuperación condicionada de señas pendientes y
--      resguardo en cancelación automática.
--
-- Retrocompatible con el Worker anterior 268b3b1c (aaec6637):
--  - Conserva private.deposit_schedule de 6 argumentos (delega en la de 7 con NULL).
--  - save_deposit_policy acepta 11 claves (Worker anterior) o 12 claves (con late_booking_payment_hours).
--  - save_appointment_email_policy acepta 6 claves (Worker anterior) o 7 claves (con self_management_cutoff_hours).
--  - private.appointment_reschedule_financial_terms conserva exactamente sus 23 claves JSON.
--  - Todas las columnas nuevas admiten NULL o valor seguro por omisión: los consultorios
--    que no configuran nada nuevo se comportan exactamente como hoy.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ============================================================================
-- 1. Cambios aditivos de esquema (P5, P2 y P3)
-- ============================================================================

alter table public.appointment_email_policies
  add column if not exists self_management_cutoff_hours integer default null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_email_policies'::regclass
      and conname = 'appointment_email_policies_cutoff_hours_check'
  ) then
    alter table public.appointment_email_policies
      add constraint appointment_email_policies_cutoff_hours_check
      check (self_management_cutoff_hours is null or self_management_cutoff_hours between 1 and 720);
  end if;
end $$;

alter table public.deposit_policies
  add column if not exists late_booking_payment_hours integer default null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deposit_policies'::regclass
      and conname = 'deposit_policies_late_booking_payment_hours_check'
  ) then
    alter table public.deposit_policies
      add constraint deposit_policies_late_booking_payment_hours_check
      check (late_booking_payment_hours is null or late_booking_payment_hours between 1 and 168);
  end if;
end $$;

alter table public.appointment_deposits
  add column if not exists late_booking_payment_hours integer default null,
  add column if not exists auto_cancel_suppressed_by_patient_exemption boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_deposits'::regclass
      and conname = 'appointment_deposits_late_booking_payment_hours_check'
  ) then
    alter table public.appointment_deposits
      add constraint appointment_deposits_late_booking_payment_hours_check
      check (late_booking_payment_hours is null or late_booking_payment_hours between 1 and 168);
  end if;
end $$;

alter table public.patients
  add column if not exists exempt_from_deposit_auto_cancel boolean not null default false,
  add column if not exists exempt_from_deposit_auto_cancel_updated_at timestamptz,
  add column if not exists exempt_from_deposit_auto_cancel_updated_by uuid,
  add column if not exists exempt_from_deposit_auto_cancel_updated_by_name text;

-- ============================================================================
-- 2. P5: fuente única de ventana de autogestión y guardado de política de correo
-- ============================================================================

create or replace function private.appointment_self_management_cutoff_at(
  p_starts_at timestamptz,
  p_cutoff_hours integer
) returns timestamptz
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case
    when p_starts_at is null or p_cutoff_hours is null then null
    else p_starts_at - make_interval(hours => p_cutoff_hours)
  end
$$;

create or replace function private.appointment_self_management_open(
  p_starts_at timestamptz,
  p_cutoff_hours integer,
  p_now timestamptz
) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select p_starts_at is not null
    and p_now is not null
    and p_starts_at > p_now
    and (p_cutoff_hours is null or p_now <= p_starts_at - make_interval(hours => p_cutoff_hours))
$$;

create or replace function public.save_appointment_email_policy(
  p_business_id uuid,
  p_settings jsonb,
  p_expected_revision bigint
) returns bigint
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  current_policy public.appointment_email_policies;
  next_policy public.appointment_email_policies;
  v_key_count integer;
  v_has_cutoff boolean;
  v_cutoff_num numeric;
  v_cutoff_hours integer;
begin
  if private.business_operation_actor(p_business_id, array['owner', 'admin'], auth.uid()) is null then
    raise exception 'EMAIL_POLICY_FORBIDDEN';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 or jsonb_typeof(p_settings) is distinct from 'object'
    or octet_length(p_settings::text) > 2048 then
    raise exception 'EMAIL_POLICY_INVALID';
  end if;
  select count(*) into v_key_count from jsonb_object_keys(p_settings);
  v_has_cutoff := p_settings ? 'self_management_cutoff_hours';
  if ((v_has_cutoff and v_key_count <> 7) or (not v_has_cutoff and v_key_count <> 6))
    or exists(
      select 1 from unnest(array['email_enabled', 'require_email', 'show_cancel', 'show_reschedule', 'require_deposit_on_reschedule']) k
      where jsonb_typeof(p_settings->k) is distinct from 'boolean'
    )
    or jsonb_typeof(p_settings->'previous_deposit_disposition') is distinct from 'string'
    or (p_settings->>'previous_deposit_disposition' in ('credit', 'forfeit')) is not true
    or (v_has_cutoff and (coalesce(jsonb_typeof(p_settings->'self_management_cutoff_hours'), 'missing') = any(array['number', 'null'])) is not true) then
    raise exception 'EMAIL_POLICY_INVALID';
  end if;

  select * into current_policy from public.appointment_email_policies p where p.business_id = p_business_id for update;
  if not found then raise exception 'EMAIL_POLICY_UNAVAILABLE'; end if;

  if v_has_cutoff then
    if jsonb_typeof(p_settings->'self_management_cutoff_hours') = 'null' then
      v_cutoff_hours := null;
    else
      begin
        v_cutoff_num := (p_settings->>'self_management_cutoff_hours')::numeric;
      exception when others then
        raise exception 'EMAIL_POLICY_INVALID';
      end;
      if v_cutoff_num is null or v_cutoff_num <> trunc(v_cutoff_num) or v_cutoff_num not between 1 and 720 then
        raise exception 'EMAIL_POLICY_INVALID';
      end if;
      v_cutoff_hours := v_cutoff_num::integer;
    end if;
  else
    v_cutoff_hours := current_policy.self_management_cutoff_hours;
  end if;

  next_policy := jsonb_populate_record(current_policy, p_settings - 'self_management_cutoff_hours');
  next_policy.self_management_cutoff_hours := v_cutoff_hours;

  if p_expected_revision > current_policy.revision then raise exception 'EMAIL_POLICY_CHANGED'; end if;
  if row(
    current_policy.email_enabled, current_policy.require_email, current_policy.show_cancel,
    current_policy.show_reschedule, current_policy.require_deposit_on_reschedule,
    current_policy.previous_deposit_disposition, current_policy.self_management_cutoff_hours
  ) is not distinct from row(
    next_policy.email_enabled, next_policy.require_email, next_policy.show_cancel,
    next_policy.show_reschedule, next_policy.require_deposit_on_reschedule,
    next_policy.previous_deposit_disposition, next_policy.self_management_cutoff_hours
  ) then
    if private.business_operation_actor(p_business_id, array['owner', 'admin'], auth.uid()) is null then
      raise exception 'EMAIL_POLICY_FORBIDDEN';
    end if;
    return current_policy.revision;
  end if;

  if p_expected_revision <> current_policy.revision then raise exception 'EMAIL_POLICY_CHANGED'; end if;

  update public.appointment_email_policies
  set email_enabled = next_policy.email_enabled,
      require_email = next_policy.require_email,
      show_cancel = next_policy.show_cancel,
      show_reschedule = next_policy.show_reschedule,
      require_deposit_on_reschedule = next_policy.require_deposit_on_reschedule,
      previous_deposit_disposition = next_policy.previous_deposit_disposition,
      self_management_cutoff_hours = next_policy.self_management_cutoff_hours,
      revision = current_policy.revision + 1,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where business_id = p_business_id;

  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(
    p_business_id, auth.uid(), 'business.appointment_email_policy_updated', 'business', p_business_id,
    jsonb_build_object('previous_revision', current_policy.revision, 'revision', current_policy.revision + 1, 'settings', p_settings)
  );

  if private.business_operation_actor(p_business_id, array['owner', 'admin'], auth.uid()) is null then
    raise exception 'EMAIL_POLICY_FORBIDDEN';
  end if;
  return current_policy.revision + 1;
end $$;

-- ============================================================================
-- 3. P2 y P3: cálculo de plazos de seña, creación, reprogramación, vencimiento
-- ============================================================================

create or replace function private.deposit_schedule(
  p_starts_at timestamptz,
  p_from timestamptz,
  p_timezone text,
  p_request_days integer,
  p_deadline_hours integer,
  p_min_payment_hours integer,
  p_late_booking_payment_hours integer,
  out request_from timestamptz,
  out due_at timestamptz,
  out auto_cancel boolean
)
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  v_normal_request_from timestamptz;
  v_normal_due timestamptz;
  v_late_due timestamptz;
begin
  v_normal_request_from := ((p_starts_at at time zone p_timezone)::date - p_request_days)::timestamp at time zone p_timezone;
  v_normal_due := p_starts_at - make_interval(hours => p_deadline_hours);
  if p_late_booking_payment_hours is null then
    request_from := v_normal_request_from;
    due_at := v_normal_due;
    auto_cancel := (v_normal_due - p_from) >= make_interval(hours => p_min_payment_hours);
    return;
  end if;
  v_late_due := p_from + make_interval(hours => p_late_booking_payment_hours);
  due_at := least(p_starts_at, greatest(v_normal_due, v_late_due));
  request_from := case
    when v_late_due > v_normal_due then least(v_normal_request_from, p_from)
    else v_normal_request_from
  end;
  auto_cancel := (p_starts_at - due_at) >= interval '24 hours';
end $$;

create or replace function private.deposit_schedule(
  p_starts_at timestamptz,
  p_from timestamptz,
  p_timezone text,
  p_request_days integer,
  p_deadline_hours integer,
  p_min_payment_hours integer,
  out request_from timestamptz,
  out due_at timestamptz,
  out auto_cancel boolean
)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select s.request_from, s.due_at, s.auto_cancel
  from private.deposit_schedule(p_starts_at, p_from, p_timezone, p_request_days, p_deadline_hours, p_min_payment_hours, null) s
$$;

create or replace function private.deposit_terms(
  p_business_id uuid,
  p_service_id uuid,
  p_source text,
  p_starts_at timestamptz,
  p_from timestamptz,
  p_quote jsonb
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_policy public.deposit_policies;
  v_timezone text;
  v_amount record;
  v_schedule record;
begin
  if not coalesce((select da.enabled from private.deposit_automation da where da.singleton), false) then
    return jsonb_build_object('required', false);
  end if;
  select * into v_policy from public.deposit_policies dp where dp.business_id = p_business_id;
  if not found or not v_policy.enabled
    or (p_source is distinct from 'public_booking' and not v_policy.applies_to_manual)
    or exists(select 1 from public.deposit_service_exclusions e where e.business_id = p_business_id and e.service_id = p_service_id) then
    return jsonb_build_object('required', false);
  end if;
  select * into v_amount from private.deposit_amount(v_policy, p_business_id, p_quote);
  if v_amount.amount is null then return jsonb_build_object('required', false); end if;
  select b.timezone into v_timezone from public.businesses b where b.id = p_business_id;
  select * into v_schedule from private.deposit_schedule(
    p_starts_at, p_from, v_timezone,
    v_policy.request_days, v_policy.deadline_hours, v_policy.min_payment_hours, v_policy.late_booking_payment_hours
  );
  return jsonb_build_object(
    'required', true,
    'amount', v_amount.amount,
    'currency', 'ARS',
    'percentage', v_amount.percentage,
    'reference_amount', v_amount.reference_amount,
    'request_from', v_schedule.request_from,
    'due_at', v_schedule.due_at,
    'auto_cancel', v_schedule.auto_cancel and v_policy.auto_cancel_enabled,
    'transfer_details', v_policy.transfer_details,
    'policy_revision', v_policy.revision,
    'request_days', v_policy.request_days,
    'deadline_hours', v_policy.deadline_hours,
    'min_payment_hours', v_policy.min_payment_hours,
    'late_booking_payment_hours', v_policy.late_booking_payment_hours
  );
end $$;

create or replace function private.create_appointment_deposit() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v jsonb;
  v_expected jsonb;
  v_raw_expected text;
  v_patient_exempt boolean := false;
  v_policy_auto_cancel boolean;
  v_effective_auto_cancel boolean;
  v_suppressed_by_exemption boolean;
begin
  if new.status <> 'reserved' then return null; end if;
  perform 1 from public.deposit_policies dp where dp.business_id = new.business_id for share;
  v := private.deposit_terms(new.business_id, new.service_id, new.source, new.starts_at, new.created_at, new.price_quote_snapshot);

  select coalesce(pt.exempt_from_deposit_auto_cancel, false)
  into v_patient_exempt
  from public.patients pt
  where pt.business_id = new.business_id and pt.id = new.patient_id;

  v_policy_auto_cancel := coalesce((v->>'auto_cancel')::boolean, false);
  v_effective_auto_cancel := v_policy_auto_cancel and not coalesce(v_patient_exempt, false);
  v_suppressed_by_exemption := v_policy_auto_cancel and coalesce(v_patient_exempt, false);

  if new.source = 'public_booking' then
    begin
      v_raw_expected := nullif(current_setting('request.headers', true), '')::jsonb->>'x-cita-deposit-terms';
      if v_raw_expected is not null then
        v_expected := v_raw_expected::jsonb;
        if v_expected = '"unknown"'::jsonb then null;
        elsif v_expected = '"none"'::jsonb then
          if (v->>'required')::boolean is true then raise exception 'DEPOSIT_TERMS_CHANGED'; end if;
        elsif jsonb_typeof(v_expected) = 'object' then
          if jsonb_typeof(v_expected->'amount') is distinct from 'number'
            or jsonb_typeof(v_expected->'dueAt') is distinct from 'string'
            or jsonb_typeof(v_expected->'autoCancel') is distinct from 'boolean'
            or (v_expected->>'amount')::numeric not between 1 and 1000000000000
            or (v_expected->>'amount')::numeric <> trunc((v_expected->>'amount')::numeric) then
            raise exception 'DEPOSIT_TERMS_CHANGED';
          end if;
          if (v->>'required')::boolean is true and (
            (v_expected->>'amount')::numeric is distinct from (v->>'amount')::numeric
            or (v_expected->>'dueAt')::timestamptz is distinct from (v->>'due_at')::timestamptz
            or ((v_expected->>'autoCancel')::boolean is false and v_effective_auto_cancel is true)
          ) then
            raise exception 'DEPOSIT_TERMS_CHANGED';
          end if;
        else
          raise exception 'DEPOSIT_TERMS_CHANGED';
        end if;
      end if;
    exception when others then
      raise exception 'DEPOSIT_TERMS_CHANGED';
    end;
  end if;

  if (v->>'required')::boolean is not true then return null; end if;

  insert into public.appointment_deposits(
    appointment_id, business_id, amount, percentage, reference_amount,
    request_days, deadline_hours, min_payment_hours, late_booking_payment_hours,
    policy_revision, request_from, due_at, auto_cancel, auto_cancel_suppressed_by_patient_exemption
  )
  values(
    new.id, new.business_id, (v->>'amount')::bigint, (v->>'percentage')::numeric, (v->>'reference_amount')::bigint,
    (v->>'request_days')::integer, (v->>'deadline_hours')::integer, (v->>'min_payment_hours')::integer,
    (v->>'late_booking_payment_hours')::integer,
    (v->>'policy_revision')::bigint, (v->>'request_from')::timestamptz, (v->>'due_at')::timestamptz,
    v_effective_auto_cancel, v_suppressed_by_exemption
  );
  return null;
end $$;

create or replace function private.synchronize_deposit_requirement() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  r public.appointment_deposit_requirements;
  a public.appointments;
  v_terms jsonb;
  v_allocation text;
  v_event text;
begin
  select * into a from public.appointments where business_id = new.business_id and id = new.appointment_id;
  v_terms := jsonb_build_object(
    'percentage', new.percentage,
    'reference_amount', new.reference_amount,
    'request_days', new.request_days,
    'deadline_hours', new.deadline_hours,
    'min_payment_hours', new.min_payment_hours,
    'late_booking_payment_hours', new.late_booking_payment_hours,
    'policy_revision', new.policy_revision,
    'request_from', new.request_from,
    'due_at', new.due_at,
    'auto_cancel', new.auto_cancel,
    'waived_reason', new.waived_reason
  );
  select * into r from public.appointment_deposit_requirements
  where business_id = new.business_id and appointment_id = new.appointment_id and is_current for update;
  if not found then
    if tg_op <> 'INSERT' then raise exception 'APPOINTMENT_DEPOSIT_HISTORY_MISSING'; end if;
    v_allocation := case when new.status <> 'paid' then 'none' when a.status = 'cancelled' then 'unresolved' else 'applied' end;
    insert into public.appointment_deposit_requirements(
      business_id, appointment_id, patient_id, status, amount, base_amount,
      allocation, terms_snapshot, projection_revision, recorded_by, recorded_at
    )
    values(
      new.business_id, new.appointment_id, a.patient_id, new.status, new.amount, new.amount, v_allocation, v_terms,
      new.revision, new.recorded_by, new.recorded_at
    ) returning * into r;
    insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, metadata)
    values(r.business_id, r.appointment_id, r.id, 'requirement_created', jsonb_build_object('status', new.status));
    if new.status <> 'pending' then
      insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, metadata)
      values(r.business_id, r.appointment_id, r.id, 'existing_state_observed', case when new.status = 'paid' then new.amount else 0 end,
        jsonb_build_object('status', new.status, 'recorded_at', new.recorded_at));
    end if;
    return null;
  end if;
  if r.patient_id is distinct from a.patient_id then raise exception 'APPOINTMENT_DEPOSIT_IDENTITY_CHANGE'; end if;
  if r.status = 'paid' and new.amount is distinct from r.amount then raise exception 'APPOINTMENT_DEPOSIT_PAID_AMOUNT_IMMUTABLE'; end if;
  if r.status is distinct from new.status then
    v_event := case
      when r.status = 'paid' and new.status = 'pending' then 'recording_reversed'
      when new.status = 'paid' then 'payment_recorded'
      when new.status = 'waived' then 'requirement_waived'
      when new.status = 'expired' then 'requirement_expired'
      else 'requirement_reopened'
    end;
  elsif (r.amount, r.terms_snapshot) is distinct from (new.amount, v_terms) then
    v_event := 'requirement_updated';
  end if;
  v_allocation := case
    when new.status <> 'paid' then 'none'
    when r.status = 'paid' then r.allocation
    when a.status = 'cancelled' then 'unresolved'
    else 'applied'
  end;
  update public.appointment_deposit_requirements
  set status = new.status,
      amount = new.amount,
      allocation = v_allocation,
      base_amount = greatest(base_amount, new.amount),
      terms_snapshot = v_terms,
      projection_revision = new.revision,
      recorded_by = new.recorded_by,
      recorded_at = new.recorded_at,
      updated_at = now()
  where id = r.id;
  if v_event is not null then
    insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
    values(
      r.business_id, r.appointment_id, r.id, v_event,
      case when v_event in ('payment_recorded', 'recording_reversed') then new.amount else 0 end,
      auth.uid(),
      jsonb_build_object('from_status', r.status, 'to_status', new.status, 'projection_revision', new.revision)
    );
  end if;
  return null;
end $$;

create or replace function private.reschedule_appointment_deposit() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  d public.appointment_deposits;
  v_timezone text;
  s record;
  v_now timestamptz;
  v_patient_exempt boolean := false;
  v_base_auto_cancel boolean;
begin
  if new.starts_at is not distinct from old.starts_at then return null; end if;
  select * into d from public.appointment_deposits ad
  where ad.appointment_id = new.id and ad.business_id = new.business_id and ad.status = 'pending' for update;
  if not found then return null; end if;
  v_now := clock_timestamp();
  select b.timezone into v_timezone from public.businesses b where b.id = new.business_id;
  select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
  from public.patients pt where pt.business_id = new.business_id and pt.id = new.patient_id;
  select * into s from private.deposit_schedule(
    new.starts_at, v_now, v_timezone,
    d.request_days, d.deadline_hours, d.min_payment_hours, d.late_booking_payment_hours
  );
  v_base_auto_cancel := (d.auto_cancel or d.auto_cancel_suppressed_by_patient_exemption) and s.auto_cancel;
  update public.appointment_deposits
  set request_from = s.request_from,
      due_at = s.due_at,
      auto_cancel = v_base_auto_cancel and not coalesce(v_patient_exempt, false),
      auto_cancel_suppressed_by_patient_exemption = v_base_auto_cancel and coalesce(v_patient_exempt, false),
      revision = d.revision + 1,
      updated_at = v_now
  where appointment_id = d.appointment_id;
  return null;
end $$;

create or replace function public.set_appointment_deposit(
  p_business_id uuid,
  p_appointment_id uuid,
  p_action text,
  p_expected_revision bigint,
  p_note text default null
) returns table(status text, revision bigint, appointment_status text)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
declare
  a public.appointments;
  d public.appointment_deposits;
  v_now timestamptz := now();
  v_audit text;
  v_patient_exempt boolean := false;
  v_eligible_auto_cancel boolean;
begin
  if p_action is null or p_action not in ('paid', 'waived', 'pending') or p_expected_revision is null then
    raise exception 'DEPOSIT_ACTION_INVALID';
  end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'DEPOSIT_NOTE_INVALID'; end if;
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then raise exception 'DEPOSIT_FORBIDDEN'; end if;
  select * into a from public.appointments ap where ap.business_id = p_business_id and ap.id = p_appointment_id for no key update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  select * into d from public.appointment_deposits ad where ad.business_id = p_business_id and ad.appointment_id = p_appointment_id for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then raise exception 'DEPOSIT_FORBIDDEN'; end if;
  v_now := clock_timestamp();
  if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or d.status = 'expired' then
    raise exception 'DEPOSIT_APPOINTMENT_CLOSED';
  end if;
  if d.status = p_action then return query select d.status, d.revision, a.status; return; end if;
  if d.revision is distinct from p_expected_revision then raise exception 'DEPOSIT_CHANGED'; end if;
  if p_action in ('paid', 'waived') then
    if d.status <> 'pending' then raise exception 'DEPOSIT_CHANGED'; end if;
    update public.appointment_deposits ad
    set status = p_action,
        waived_reason = case when p_action = 'waived' then 'staff' end,
        recorded_by = auth.uid(),
        recorded_at = v_now,
        note = nullif(btrim(p_note), ''),
        revision = d.revision + 1,
        updated_at = v_now
    where ad.appointment_id = d.appointment_id returning * into d;
    if a.status = 'reserved' then
      update public.appointments ap
      set status = 'confirmed', confirmed_at = v_now, updated_by_user_id = auth.uid(), updated_at = v_now
      where ap.id = a.id and ap.business_id = a.business_id returning * into a;
    end if;
    v_audit := 'appointment.deposit_' || p_action;
  else
    if d.waived_reason = 'policy_disabled' then raise exception 'DEPOSIT_ACTION_INVALID'; end if;
    if a.status = 'confirmed' then
      update public.appointments ap
      set status = 'reserved', confirmed_at = null, updated_by_user_id = auth.uid(), updated_at = v_now
      where ap.id = a.id and ap.business_id = a.business_id returning * into a;
    end if;
    select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
    from public.patients pt where pt.business_id = p_business_id and pt.id = a.patient_id;
    v_eligible_auto_cancel := (d.auto_cancel or d.auto_cancel_suppressed_by_patient_exemption)
      and (d.due_at - v_now >= make_interval(hours => d.min_payment_hours))
      and (d.late_booking_payment_hours is null or a.starts_at - d.due_at >= interval '24 hours');
    update public.appointment_deposits ad
    set status = 'pending',
        waived_reason = null,
        recorded_by = null,
        recorded_at = null,
        note = null,
        auto_cancel = v_eligible_auto_cancel and not coalesce(v_patient_exempt, false),
        auto_cancel_suppressed_by_patient_exemption = v_eligible_auto_cancel and coalesce(v_patient_exempt, false),
        revision = d.revision + 1,
        updated_at = v_now
    where ad.appointment_id = d.appointment_id returning * into d;
    v_audit := 'appointment.deposit_reopened';
  end if;
  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(p_business_id, auth.uid(), v_audit, 'appointment', p_appointment_id,
    jsonb_build_object('deposit_status', d.status, 'appointment_status', a.status, 'amount', d.amount));
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then raise exception 'DEPOSIT_FORBIDDEN'; end if;
  return query select d.status, d.revision, a.status;
end $$;

create or replace function public.save_deposit_policy(
  p_business_id uuid,
  p_settings jsonb,
  p_expected_revision bigint
) returns bigint
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
declare
  v_current public.deposit_policies;
  v_new public.deposit_policies;
  v_excluded uuid[];
  v_now timestamptz := now();
  v_locked uuid[];
  v_waived integer := 0;
  v_fixed numeric;
  v_percentage numeric;
  v_key_count integer;
  v_has_late_hours boolean;
  v_late_hours_num numeric;
begin
  if private.deposit_actor(p_business_id, array['owner', 'admin']) is null then raise exception 'DEPOSIT_POLICY_FORBIDDEN'; end if;
  if p_expected_revision is null or jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text) > 8192 then
    raise exception 'DEPOSIT_POLICY_INVALID';
  end if;
  select count(*) into v_key_count from jsonb_object_keys(p_settings);
  v_has_late_hours := p_settings ? 'late_booking_payment_hours';
  if exists(
    select 1 from (values
      ('enabled', array['boolean']),
      ('auto_cancel_enabled', array['boolean']),
      ('amount_mode', array['string']),
      ('fixed_amount', array['number', 'null']),
      ('percentage', array['number', 'null']),
      ('request_days', array['number']),
      ('deadline_hours', array['number']),
      ('min_payment_hours', array['number']),
      ('transfer_details', array['string', 'null']),
      ('applies_to_manual', array['boolean']),
      ('excluded_service_ids', array['array'])
    ) k(name, types)
    where (coalesce(jsonb_typeof(p_settings->k.name), 'missing') = any(k.types)) is not true
  )
  or (v_has_late_hours and (coalesce(jsonb_typeof(p_settings->'late_booking_payment_hours'), 'missing') = any(array['number', 'null'])) is not true)
  or (v_has_late_hours and v_key_count <> 12)
  or (not v_has_late_hours and v_key_count <> 11) then
    raise exception 'DEPOSIT_POLICY_INVALID';
  end if;

  select * into v_current from public.deposit_policies dp where dp.business_id = p_business_id for update;
  if private.deposit_actor(p_business_id, array['owner', 'admin']) is null then raise exception 'DEPOSIT_POLICY_FORBIDDEN'; end if;
  v_now := clock_timestamp();
  if coalesce(v_current.revision, 0) <> p_expected_revision then raise exception 'DEPOSIT_POLICY_CHANGED'; end if;

  begin
    v_new.business_id := p_business_id;
    v_new.enabled := (p_settings->>'enabled')::boolean;
    v_new.auto_cancel_enabled := (p_settings->>'auto_cancel_enabled')::boolean;
    v_new.amount_mode := p_settings->>'amount_mode';
    v_fixed := (p_settings->>'fixed_amount')::numeric;
    v_percentage := (p_settings->>'percentage')::numeric;
    v_new.request_days := (p_settings->>'request_days')::integer;
    v_new.deadline_hours := (p_settings->>'deadline_hours')::integer;
    v_new.min_payment_hours := (p_settings->>'min_payment_hours')::integer;
    if v_has_late_hours then
      if jsonb_typeof(p_settings->'late_booking_payment_hours') = 'null' then
        v_late_hours_num := null;
        v_new.late_booking_payment_hours := null;
      else
        v_late_hours_num := (p_settings->>'late_booking_payment_hours')::numeric;
        if v_late_hours_num <> trunc(v_late_hours_num) or v_late_hours_num not between 1 and 168 then
          raise exception 'DEPOSIT_POLICY_INVALID';
        end if;
        v_new.late_booking_payment_hours := v_late_hours_num::integer;
      end if;
    else
      v_new.late_booking_payment_hours := v_current.late_booking_payment_hours;
    end if;
    v_new.transfer_details := nullif(btrim(p_settings->>'transfer_details'), '');
    v_new.applies_to_manual := (p_settings->>'applies_to_manual')::boolean;
    select coalesce(array_agg(distinct value::uuid), '{}') into v_excluded from jsonb_array_elements_text(p_settings->'excluded_service_ids');
  exception when others then
    raise exception 'DEPOSIT_POLICY_INVALID';
  end;

  if v_new.amount_mode not in ('fixed', 'percentage')
    or (v_fixed is not null and (v_fixed <> trunc(v_fixed) or v_fixed not between 1 and 1000000000000))
    or (v_percentage is not null and (v_percentage <= 0 or v_percentage > 100 or v_percentage <> round(v_percentage, 2)))
    or v_new.request_days not between 1 and 60
    or v_new.deadline_hours not between 1 and 720
    or v_new.min_payment_hours not between 0 and 168
    or (v_new.late_booking_payment_hours is not null and v_new.late_booking_payment_hours not between 1 and 168)
    or char_length(coalesce(v_new.transfer_details, '')) > 500
    or (v_new.enabled and ((v_new.amount_mode = 'fixed' and v_fixed is null) or (v_new.amount_mode = 'percentage' and v_percentage is null)))
    or exists(
      select 1 from unnest(v_excluded) e(service_id)
      where not exists(select 1 from public.services s where s.business_id = p_business_id and s.id = e.service_id)
    ) then
    raise exception 'DEPOSIT_POLICY_INVALID';
  end if;

  v_new.fixed_amount := v_fixed::bigint;
  v_new.percentage := v_percentage;

  insert into public.deposit_policies(
    business_id, enabled, auto_cancel_enabled, amount_mode, fixed_amount, percentage,
    request_days, deadline_hours, min_payment_hours, late_booking_payment_hours,
    transfer_details, applies_to_manual, revision, updated_at, updated_by
  )
  values(
    p_business_id, v_new.enabled, v_new.auto_cancel_enabled, v_new.amount_mode, v_new.fixed_amount, v_new.percentage,
    v_new.request_days, v_new.deadline_hours, v_new.min_payment_hours, v_new.late_booking_payment_hours,
    v_new.transfer_details, v_new.applies_to_manual, coalesce(v_current.revision, 0) + 1, v_now, auth.uid()
  )
  on conflict (business_id) do update set
    enabled = excluded.enabled,
    auto_cancel_enabled = excluded.auto_cancel_enabled,
    amount_mode = excluded.amount_mode,
    fixed_amount = excluded.fixed_amount,
    percentage = excluded.percentage,
    request_days = excluded.request_days,
    deadline_hours = excluded.deadline_hours,
    min_payment_hours = excluded.min_payment_hours,
    late_booking_payment_hours = excluded.late_booking_payment_hours,
    transfer_details = excluded.transfer_details,
    applies_to_manual = excluded.applies_to_manual,
    revision = excluded.revision,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  where deposit_policies.revision = coalesce(v_current.revision, 0);
  if not found then raise exception 'DEPOSIT_POLICY_CHANGED'; end if;

  delete from public.deposit_service_exclusions e where e.business_id = p_business_id;
  insert into public.deposit_service_exclusions(business_id, service_id)
  select p_business_id, service_id from unnest(v_excluded) service_id;

  if not v_new.enabled then
    select coalesce(array_agg(locked.id), '{}') into v_locked from (
      select a.id from public.appointments a
      join public.appointment_deposits ad on ad.appointment_id = a.id and ad.business_id = a.business_id
      where a.business_id = p_business_id and ad.status = 'pending'
      order by a.id
      for no key update of a
    ) locked;
    update public.appointment_deposits ad
    set status = 'waived', waived_reason = 'policy_disabled', revision = ad.revision + 1, updated_at = v_now
    where ad.business_id = p_business_id and ad.appointment_id = any(v_locked) and ad.status = 'pending';
    get diagnostics v_waived = row_count;
  end if;

  if private.deposit_actor(p_business_id, array['owner', 'admin']) is null then raise exception 'DEPOSIT_POLICY_FORBIDDEN'; end if;
  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(
    p_business_id, auth.uid(), 'business.deposit_policy_saved', 'business', p_business_id,
    jsonb_build_object(
      'enabled', v_new.enabled,
      'auto_cancel_enabled', v_new.auto_cancel_enabled,
      'amount_mode', v_new.amount_mode,
      'late_booking_payment_hours', v_new.late_booking_payment_hours,
      'revision', coalesce(v_current.revision, 0) + 1,
      'waived_pending', v_waived
    )
  );
  return coalesce(v_current.revision, 0) + 1;
end $$;

create or replace function private.expire_deposit_if_still_due(p_appointment_id uuid, p_now timestamptz) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a public.appointments;
  d public.appointment_deposits;
  p public.deposit_policies;
  v_timezone text;
  v_patient_exempt boolean := false;
begin
  select * into a from public.appointments ap where ap.id = p_appointment_id for no key update;
  if not found then return false; end if;
  select * into d from public.appointment_deposits ad where ad.appointment_id = a.id and ad.business_id = a.business_id;
  if not found then return false; end if;
  select * into p from public.deposit_policies dp where dp.business_id = a.business_id;
  select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
  from public.patients pt where pt.business_id = a.business_id and pt.id = a.patient_id;
  if not found or v_patient_exempt or d.status <> 'pending' or not d.auto_cancel or d.due_at > p_now or d.due_at <= p_now - interval '24 hours'
    or a.status <> 'reserved' or a.starts_at <= p_now or not p.enabled or not p.auto_cancel_enabled
    or not coalesce((select da.enabled from private.deposit_automation da where da.singleton), false)
    or not exists(select 1 from public.businesses b where b.id = a.business_id and b.is_active)
    or public.business_allows_operation(a.business_id) is not true then
    return false;
  end if;
  select b.timezone into v_timezone from public.businesses b where b.id = a.business_id;
  update public.appointment_deposits ad
  set status = 'expired', expired_at = p_now, revision = d.revision + 1, updated_at = p_now
  where ad.appointment_id = d.appointment_id;
  update public.appointments ap
  set status = 'cancelled',
      cancelled_at = p_now,
      cancelled_by_user_id = null,
      cancelled_reason = 'Seña no registrada antes del ' || to_char(d.due_at at time zone v_timezone, 'DD/MM/YYYY HH24:MI'),
      updated_by_user_id = null,
      updated_at = p_now
  where ap.id = a.id and ap.business_id = a.business_id;
  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(a.business_id, null, 'appointment.deposit_expired', 'appointment', a.id,
    jsonb_build_object('due_at', d.due_at, 'amount', d.amount, 'from_status', a.status, 'to_status', 'cancelled'));
  return true;
end $$;

create or replace function private.expire_unpaid_deposits(p_now timestamptz default now(), p_limit integer default 100) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_enabled boolean;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_cancelled integer := 0;
begin
  update private.deposit_automation set last_run_started_at = clock_timestamp() where singleton returning enabled into v_enabled;
  if coalesce(v_enabled, false) then
    select coalesce(array_agg(candidate.id order by candidate.due_at, candidate.id), '{}') into v_ids from (
      select a.id, ad.due_at
      from public.appointments a
      join public.appointment_deposits ad on ad.appointment_id = a.id and ad.business_id = a.business_id
      join public.deposit_policies dp on dp.business_id = a.business_id
      join public.patients pt on pt.business_id = a.business_id and pt.id = a.patient_id
      where ad.status = 'pending' and ad.auto_cancel and not pt.exempt_from_deposit_auto_cancel
        and ad.due_at <= p_now and ad.due_at > p_now - interval '24 hours'
        and a.status = 'reserved' and a.starts_at > p_now and dp.enabled and dp.auto_cancel_enabled
      order by ad.due_at, a.id
      limit greatest(1, least(coalesce(p_limit, 100), 500))
      for no key update of a skip locked
    ) candidate;
    foreach v_id in array v_ids loop
      if private.expire_deposit_if_still_due(v_id, p_now) then v_cancelled := v_cancelled + 1; end if;
    end loop;
  end if;
  update private.deposit_automation
  set last_run_finished_at = clock_timestamp(), last_run_processed = cardinality(v_ids), last_run_cancelled = v_cancelled
  where singleton;
  return v_cancelled;
end $$;

-- ============================================================================
-- 4. Reprogramación del paciente y snapshot (P5 + P2 + P3)
-- ============================================================================

create or replace function private.appointment_reschedule_financial_terms(
  p_business_id uuid,
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_from timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  a public.appointments;
  m public.appointment_management_states;
  d public.appointment_deposits;
  r public.appointment_deposit_requirements;
  basis public.appointment_deposit_requirements;
  dp public.deposit_policies;
  preferences public.appointment_email_policies;
  v_kind text := 'none';
  v_reason text;
  v_amount bigint;
  v_base bigint;
  v_quote bigint;
  v_credit numeric := 0;
  v_forfeit bigint := 0;
  v_previous bigint := 0;
  v_disposition text := 'none';
  v_enabled boolean;
  v_has_current boolean;
  v_has_projection boolean;
  v_has_basis boolean;
  v_patient_exempt boolean := false;
  v_request_days integer;
  v_deadline_hours integer;
  v_min_payment_hours integer;
  v_late_booking_payment_hours integer;
  v_timezone text;
  v_request_from timestamptz;
  v_due_at timestamptz;
  v_auto_cancel boolean := false;
  v_last_minute boolean := false;
  schedule record;
begin
  if p_starts_at is null or p_from is null or not isfinite(p_starts_at) or not isfinite(p_from) or p_starts_at <= p_from then
    raise exception 'APPOINTMENT_RESCHEDULE_TIME_INVALID';
  end if;
  select * into a from public.appointments where business_id = p_business_id and id = p_appointment_id;
  if not found then raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or a.starts_at <= p_from then
    raise exception 'APPOINTMENT_CANNOT_RESCHEDULE';
  end if;
  select * into m from public.appointment_management_states where business_id = p_business_id and appointment_id = p_appointment_id;
  if not found then raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  select * into preferences from public.appointment_email_policies where business_id = p_business_id;
  if not found then raise exception 'APPOINTMENT_FINANCIAL_STATE_INVALID'; end if;
  select * into d from public.appointment_deposits where business_id = p_business_id and appointment_id = p_appointment_id;
  v_has_projection := found;
  select * into r from public.appointment_deposit_requirements
  where business_id = p_business_id and appointment_id = p_appointment_id and is_current;
  v_has_current := found;
  if v_has_projection is distinct from v_has_current then raise exception 'APPOINTMENT_FINANCIAL_STATE_INVALID'; end if;
  if v_has_current and (r.status, r.amount, r.patient_id) is distinct from (d.status, d.amount, a.patient_id) then
    raise exception 'APPOINTMENT_FINANCIAL_STATE_INVALID';
  end if;
  select * into basis from public.appointment_deposit_requirements
  where business_id = p_business_id and appointment_id = p_appointment_id and patient_id = a.patient_id order by ordinal desc limit 1;
  v_has_basis := found;
  if v_has_current then basis := r; end if;
  if v_has_basis then v_base := basis.base_amount; end if;
  select coalesce(sum(amount), 0) into v_credit from public.appointment_deposit_requirements
  where business_id = p_business_id and appointment_id = p_appointment_id and patient_id = a.patient_id and status = 'paid' and allocation = 'applied';
  select * into dp from public.deposit_policies where business_id = p_business_id;
  select enabled into v_enabled from private.deposit_automation where singleton;
  select timezone into v_timezone from public.businesses where id = p_business_id;
  select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
  from public.patients pt where pt.business_id = p_business_id and pt.id = a.patient_id;
  v_quote := private.appointment_quote_amount(a.price_quote_snapshot);

  if v_has_basis then
    if v_enabled is not true then v_reason := 'deposit_automation_paused';
    elsif exists(
      select 1 from public.appointment_deposit_requirements
      where business_id = p_business_id and appointment_id = p_appointment_id and patient_id = a.patient_id
        and status = 'paid' and allocation = 'unresolved'
    ) then v_reason := 'payment_unresolved';
    elsif v_has_current and d.status = 'pending' and dp.enabled is not true then v_reason := 'policy_change_pending';
    end if;
  end if;

  <<decision>>
  begin
    if p_starts_at = a.starts_at then
      v_kind := 'unchanged';
      if v_has_current and d.status = 'pending' then
        v_amount := d.amount; v_request_from := d.request_from; v_due_at := d.due_at;
        v_auto_cancel := not coalesce(v_patient_exempt, false) and d.auto_cancel and coalesce(dp.auto_cancel_enabled, false) and coalesce(v_enabled, false);
      end if;
      exit decision;
    end if;
    if not v_has_basis then exit decision; end if;
    if v_reason is not null then v_kind := 'unavailable'; exit decision; end if;
    if v_has_current and d.status = 'pending' then
      v_kind := 'reuse_pending'; v_amount := d.amount; exit decision;
    end if;
    if v_has_current and r.status = 'paid' and r.allocation = 'applied' then
      v_previous := r.amount;
      v_disposition := case
        when m.terms_acknowledged and dp.enabled is true
          and m.previous_deposit_disposition = 'forfeit' and preferences.previous_deposit_disposition = 'forfeit' then 'forfeit'
        else 'credit'
      end;
      if v_disposition = 'forfeit' then v_forfeit := r.amount; v_credit := v_credit - v_forfeit; end if;
    end if;
    if m.terms_acknowledged and dp.enabled is true then
      if m.require_deposit_on_reschedule and preferences.require_deposit_on_reschedule then
        v_amount := v_base;
        if v_quote is not null then v_amount := least(v_base, greatest(v_quote - v_credit, 0))::bigint; end if;
        if v_amount > 0 then v_kind := 'new_requirement'; else v_amount := null; end if;
      end if;
    end if;
  end decision;

  if v_kind in ('reuse_pending', 'new_requirement') then
    begin
      v_request_days := (basis.terms_snapshot->>'request_days')::integer;
      v_deadline_hours := (basis.terms_snapshot->>'deadline_hours')::integer;
      v_min_payment_hours := (basis.terms_snapshot->>'min_payment_hours')::integer;
      v_late_booking_payment_hours := (basis.terms_snapshot->>'late_booking_payment_hours')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'APPOINTMENT_FINANCIAL_STATE_INVALID';
    end;
    if v_request_days is null or v_request_days not between 1 and 60
      or v_deadline_hours is null or v_deadline_hours not between 1 and 720
      or v_min_payment_hours is null or v_min_payment_hours not between 0 and 168
      or (v_late_booking_payment_hours is not null and v_late_booking_payment_hours not between 1 and 168) then
      raise exception 'APPOINTMENT_FINANCIAL_STATE_INVALID';
    end if;
    select * into schedule from private.deposit_schedule(
      p_starts_at, p_from, v_timezone, v_request_days, v_deadline_hours, v_min_payment_hours, v_late_booking_payment_hours
    );
    v_request_from := schedule.request_from; v_due_at := schedule.due_at;
    v_last_minute := not schedule.auto_cancel;
    v_auto_cancel := not coalesce(v_patient_exempt, false) and schedule.auto_cancel and dp.auto_cancel_enabled
      and (v_kind = 'new_requirement' or d.auto_cancel);
  end if;

  -- Exact same 23 keys as migration 20261103030000 for strict parser & rollback compatibility.
  return jsonb_build_object(
    'kind', v_kind,
    'unavailable_reason', v_reason,
    'required', v_amount is not null,
    'amount', v_amount::text,
    'base_amount', v_base::text,
    'currency', 'ARS',
    'previous_applicable_payment_amount', v_previous::text,
    'previous_payment_disposition', v_disposition,
    'forfeit_amount', v_forfeit::text,
    'credit_amount', v_credit::text,
    'quote_amount', v_quote::text,
    'quote_remainder', case when v_quote is not null then greatest(v_quote - v_credit, 0)::text end,
    'request_from', to_char(v_request_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'due_at', to_char(v_due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'auto_cancel', v_auto_cancel,
    'last_minute', v_last_minute,
    'terms_informed', m.terms_acknowledged,
    'current_deposit_status', d.status,
    'current_deposit_amount', d.amount::text,
    'current_payment_allocation', r.allocation,
    'request_days', v_request_days,
    'deadline_hours', v_deadline_hours,
    'min_payment_hours', v_min_payment_hours
  );
end $$;

create or replace function public.apply_patient_appointment_management(
  p_token text, p_legacy boolean, p_operation_id uuid, p_expected_revision text, p_action text,
  p_starts_at timestamptz default null, p_availability_revision bigint default null,
  p_financial_terms jsonb default null, p_integration_revision bigint default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  access jsonb; locked_access jsonb; a public.appointments; before_a public.appointments;
  b public.businesses; s public.services; context public.appointment_booking_contexts; integration public.booking_integrations;
  d public.appointment_deposits; r public.appointment_deposit_requirements; basis public.appointment_deposit_requirements;
  v_email_policy public.appointment_email_policies; dp public.deposit_policies;
  prior private.appointment_management_operations; v_business uuid; v_appointment uuid; v_now timestamptz;
  v_fingerprint text; v_result jsonb; v_terms jsonb; v_scope jsonb; v_requirement uuid; v_revision bigint; v_teams uuid[]; v_locked_teams uuid[];
  v_professional uuid; v_ends_at timestamptz; v_status text; v_changed boolean := true; v_kind text;
  v_projection_revision bigint; v_snapshot jsonb; v_has_projection boolean; v_has_current boolean; v_previous_disposition text;
  v_patient_exempt boolean := false; v_late_hours integer; v_suppressed_by_exemption boolean := false;
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
    select * into dp from public.deposit_policies where business_id = v_business for share;
    select * into v_email_policy from public.appointment_email_policies where business_id = v_business for share;
    perform 1 from private.appointment_management_runtime where singleton for share;
    select array_agg(professional_id order by professional_id) into v_teams from public.appointment_professionals
      where business_id = v_business and appointment_id = v_appointment;
    for v_professional in select unnest(v_teams) loop
      perform pg_advisory_xact_lock(hashtextextended(v_business::text || ':' || v_professional::text, 0));
    end loop;
  elsif p_action = 'cancel' then
    select * into v_email_policy from public.appointment_email_policies where business_id = v_business for share;
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
    if not private.appointment_self_management_open(a.starts_at, v_email_policy.self_management_cutoff_hours, v_now) then
      raise exception 'APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED';
    end if;
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
    if not private.appointment_self_management_open(a.starts_at, v_email_policy.self_management_cutoff_hours, v_now) then
      raise exception 'APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED';
    end if;
    if p_starts_at = a.starts_at then v_changed := false;
    else
      if p_availability_revision is null or p_availability_revision is distinct from
        (select booking_availability_revision from public.businesses where id = v_business) then raise exception 'APPOINTMENT_AVAILABILITY_CHANGED'; end if;
      v_now := clock_timestamp();
      if not private.appointment_self_management_open(a.starts_at, v_email_policy.self_management_cutoff_hours, v_now) then
        raise exception 'APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED';
      end if;
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
        select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
        from public.patients pt where pt.business_id = v_business and pt.id = a.patient_id;
        v_late_hours := (basis.terms_snapshot->>'late_booking_payment_hours')::integer;
        v_suppressed_by_exemption := coalesce(v_patient_exempt, false)
          and coalesce(dp.auto_cancel_enabled, false)
          and not coalesce((v_terms->>'last_minute')::boolean, false);
        select coalesce(max(projection_revision), 0) + 1 into v_projection_revision from public.appointment_deposit_requirements where business_id = v_business and appointment_id = a.id;
        v_snapshot := basis.terms_snapshot || jsonb_build_object(
          'request_from', v_terms->'request_from',
          'due_at', v_terms->'due_at',
          'auto_cancel', v_terms->'auto_cancel',
          'late_booking_payment_hours', v_late_hours,
          'waived_reason', null
        );
        insert into public.appointment_deposit_requirements(business_id, appointment_id, patient_id, status, amount, base_amount, allocation, terms_snapshot, projection_revision)
        values(v_business, a.id, a.patient_id, 'pending', (v_terms->>'amount')::bigint, (v_terms->>'base_amount')::bigint, 'none', v_snapshot, v_projection_revision) returning id into v_requirement;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, metadata)
        values(v_business, a.id, v_requirement, 'requirement_created', jsonb_build_object('origin', 'patient', 'operation_id', p_operation_id));
        insert into public.appointment_deposits(
          business_id, appointment_id, status, amount, currency, percentage, reference_amount,
          request_days, deadline_hours, min_payment_hours, late_booking_payment_hours,
          policy_revision, request_from, due_at, auto_cancel, auto_cancel_suppressed_by_patient_exemption, revision
        )
        values(
          v_business, a.id, 'pending', (v_terms->>'amount')::bigint, 'ARS', (basis.terms_snapshot->>'percentage')::numeric,
          (basis.terms_snapshot->>'reference_amount')::bigint, (v_terms->>'request_days')::integer, (v_terms->>'deadline_hours')::integer,
          (v_terms->>'min_payment_hours')::integer, v_late_hours, (basis.terms_snapshot->>'policy_revision')::bigint,
          (v_terms->>'request_from')::timestamptz, (v_terms->>'due_at')::timestamptz, (v_terms->>'auto_cancel')::boolean,
          v_suppressed_by_exemption, v_projection_revision
        )
        on conflict(appointment_id) do update set
          status = 'pending', amount = excluded.amount, percentage = excluded.percentage, reference_amount = excluded.reference_amount,
          request_days = excluded.request_days, deadline_hours = excluded.deadline_hours, min_payment_hours = excluded.min_payment_hours,
          late_booking_payment_hours = excluded.late_booking_payment_hours, policy_revision = excluded.policy_revision,
          request_from = excluded.request_from, due_at = excluded.due_at, auto_cancel = excluded.auto_cancel,
          auto_cancel_suppressed_by_patient_exemption = excluded.auto_cancel_suppressed_by_patient_exemption,
          revision = excluded.revision, waived_reason = null, note = null, recorded_by = null, recorded_at = null,
          reminder_opened_at = null, reminder_opened_by = null, expired_at = null, updated_at = v_now;
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
  ep public.appointment_email_policies;
  c public.appointment_booking_contexts;
  i public.booking_integrations;
  v_scope jsonb;
  v_terms jsonb;
  v_deposit jsonb;
  v_financial_summary jsonb;
  v_patient_name text;
  v_patient_exempt boolean := false;
  v_integration jsonb;
  v_patient_active boolean;
  v_auxiliary boolean;
  v_active_future boolean;
  v_operable boolean;
  v_booking boolean;
  v_cutoff_hours integer;
  v_cutoff_at timestamptz;
  v_self_mgmt_open boolean;
  v_self_mgmt_window_closed boolean;
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
  select * into ep from public.appointment_email_policies where business_id = p_business_id;
  select * into c from public.appointment_booking_contexts where business_id = p_business_id and appointment_id = p_appointment_id;
  select full_name, archived_at is null, coalesce(exempt_from_deposit_auto_cancel, false)
  into v_patient_name, v_patient_active, v_patient_exempt
  from public.patients where business_id = p_business_id and id = a.patient_id;

  v_active_future := a.status in ('reserved', 'confirmed', 'reschedule_requested') and a.starts_at > p_now;
  v_operable := b.is_active and coalesce(private.appointment_business_allows_operation_at(b.id, p_now), false);
  v_booking := v_operable and b.public_booking_enabled;
  v_auxiliary := v_active_future and v_operable and coalesce(v_patient_active, false);
  v_cutoff_hours := ep.self_management_cutoff_hours;
  v_cutoff_at := private.appointment_self_management_cutoff_at(a.starts_at, v_cutoff_hours);
  v_self_mgmt_open := private.appointment_self_management_open(a.starts_at, v_cutoff_hours, p_now);
  v_self_mgmt_window_closed := v_active_future and not v_self_mgmt_open;

  v_scope := private.appointment_reschedule_scope(p_business_id, p_appointment_id, p_now);
  if v_active_future then
    v_terms := private.appointment_reschedule_financial_terms(p_business_id, p_appointment_id, coalesce(p_starts_at, a.starts_at), p_now);
  end if;
  v_cancel := v_active_future and v_self_mgmt_open;
  v_reschedule := v_active_future and v_self_mgmt_open and coalesce((v_scope->>'can_select')::boolean, false) and v_terms->>'unavailable_reason' is null;
  v_confirm := v_active_future and a.status = 'reserved' and v_operable and coalesce(d.status not in ('pending', 'expired'), true);
  v_auto_cancel := d.status = 'pending' and a.status = 'reserved' and a.starts_at > p_now
    and d.auto_cancel and not coalesce(v_patient_exempt, false)
    and dp.enabled and dp.auto_cancel_enabled
    and v_operable and p_now < d.due_at + interval '24 hours'
    and coalesce((select enabled from private.deposit_automation where singleton), false);

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
    'self_management_cutoff_hours', v_cutoff_hours,
    'self_management_cutoff_at', v_cutoff_at,
    'self_management_window_closed', v_self_mgmt_window_closed,
    'cancelled_by_deposit_expiry', (a.status = 'cancelled' and d.status = 'expired'),
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
-- 5. P3: comando autenticado para marcar/desmarcar paciente + regla de fusión
-- ============================================================================

create or replace function private.merge_patient_deposit_exemption(
  p_first boolean,
  p_second boolean
) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(p_first, false) or coalesce(p_second, false)
$$;

create or replace function public.set_patient_deposit_auto_cancel_exemption(
  p_business_id uuid,
  p_patient_id uuid,
  p_exempt boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_patient public.patients;
  v_policy public.deposit_policies;
  v_now timestamptz;
  v_actor_name text;
  v_locked_ids uuid[] := '{}';
  v_updated_deposits integer := 0;
begin
  if p_business_id is null or p_patient_id is null or p_exempt is null then
    raise exception 'PATIENT_DEPOSIT_EXEMPTION_INVALID';
  end if;
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN';
  end if;

  select * into v_patient
  from public.patients pt
  where pt.business_id = p_business_id and pt.id = p_patient_id
  for no key update;
  if not found then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN';
  end if;

  select * into v_policy
  from public.deposit_policies dp
  where dp.business_id = p_business_id
  for share;

  v_now := clock_timestamp();

  select coalesce(
    (
      select nullif(btrim(pr.name), '')
      from public.professional_users pu
      join public.professionals pr on pr.business_id = pu.business_id and pr.id = pu.professional_id
      where pu.business_id = p_business_id and pu.user_id = v_actor
      limit 1
    ),
    (
      select nullif(btrim(u.email), '')
      from auth.users u
      where u.id = v_actor
    ),
    'Equipo del consultorio'
  ) into v_actor_name;

  select coalesce(array_agg(locked.id), '{}') into v_locked_ids
  from (
    select a.id
    from public.appointments a
    join public.appointment_deposits ad on ad.business_id = a.business_id and ad.appointment_id = a.id
    where a.business_id = p_business_id
      and a.patient_id = p_patient_id
      and a.status in ('reserved', 'confirmed', 'reschedule_requested')
      and a.starts_at > v_now
      and ad.status = 'pending'
    order by a.id
    for no key update of a
  ) locked;

  if cardinality(v_locked_ids) > 0 then
    perform 1
    from public.appointment_deposits ad
    where ad.business_id = p_business_id and ad.appointment_id = any(v_locked_ids)
    order by ad.appointment_id
    for update;

    if p_exempt then
      update public.appointment_deposits ad
      set auto_cancel = false,
          auto_cancel_suppressed_by_patient_exemption = true,
          revision = ad.revision + 1,
          updated_at = v_now
      where ad.business_id = p_business_id
        and ad.appointment_id = any(v_locked_ids)
        and ad.status = 'pending'
        and ad.auto_cancel = true;
      get diagnostics v_updated_deposits = row_count;
    else
      update public.appointment_deposits ad
      set auto_cancel = (
            coalesce(v_policy.enabled, false)
            and coalesce(v_policy.auto_cancel_enabled, false)
            and (ad.due_at - v_now >= make_interval(hours => ad.min_payment_hours))
            and (ad.late_booking_payment_hours is null or (a.starts_at - ad.due_at >= interval '24 hours'))
          ),
          auto_cancel_suppressed_by_patient_exemption = false,
          revision = ad.revision + 1,
          updated_at = v_now
      from public.appointments a
      where a.business_id = ad.business_id
        and a.id = ad.appointment_id
        and ad.business_id = p_business_id
        and ad.appointment_id = any(v_locked_ids)
        and ad.status = 'pending'
        and ad.auto_cancel = false
        and ad.auto_cancel_suppressed_by_patient_exemption = true;
      get diagnostics v_updated_deposits = row_count;
    end if;
  end if;

  if v_patient.exempt_from_deposit_auto_cancel is distinct from p_exempt then
    update public.patients pt
    set exempt_from_deposit_auto_cancel = p_exempt,
        exempt_from_deposit_auto_cancel_updated_at = v_now,
        exempt_from_deposit_auto_cancel_updated_by = v_actor,
        exempt_from_deposit_auto_cancel_updated_by_name = v_actor_name,
        updated_at = v_now
    where pt.business_id = p_business_id and pt.id = p_patient_id;

    insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
    values(
      p_business_id, v_actor, 'patient.deposit_auto_cancel_exemption_updated', 'patient', p_patient_id,
      jsonb_build_object(
        'previous_exempt', v_patient.exempt_from_deposit_auto_cancel,
        'exempt', p_exempt,
        'actor_name', v_actor_name,
        'updated_deposits', v_updated_deposits
      )
    );

    insert into public.patient_profile_change_events(
      business_id, patient_id, changed_by_user_id, changed_by_professional_id, changed_by_name, changed_fields, summary
    )
    values(
      p_business_id, p_patient_id, v_actor, null, v_actor_name,
      jsonb_build_array('exempt_from_deposit_auto_cancel'),
      case
        when p_exempt then 'Activó «No cancelar sus turnos por seña impaga».'
        else 'Quitó «No cancelar sus turnos por seña impaga».'
      end
    );
  end if;

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'exempt', p_exempt,
    'updated_at', case
      when v_patient.exempt_from_deposit_auto_cancel is distinct from p_exempt then v_now
      else coalesce(v_patient.exempt_from_deposit_auto_cancel_updated_at, v_now)
    end,
    'updated_by_name', case
      when v_patient.exempt_from_deposit_auto_cancel is distinct from p_exempt then v_actor_name
      else coalesce(v_patient.exempt_from_deposit_auto_cancel_updated_by_name, v_actor_name)
    end,
    'updated_deposits', v_updated_deposits
  );
end $$;

-- ============================================================================
-- 6. Privilegios explícitos (ninguna función privada expuesta)
-- ============================================================================

revoke all on function
  private.appointment_self_management_cutoff_at(timestamptz, integer),
  private.appointment_self_management_open(timestamptz, integer, timestamptz),
  private.deposit_schedule(timestamptz, timestamptz, text, integer, integer, integer),
  private.deposit_schedule(timestamptz, timestamptz, text, integer, integer, integer, integer),
  private.deposit_terms(uuid, uuid, text, timestamptz, timestamptz, jsonb),
  private.create_appointment_deposit(),
  private.synchronize_deposit_requirement(),
  private.reschedule_appointment_deposit(),
  private.expire_deposit_if_still_due(uuid, timestamptz),
  private.expire_unpaid_deposits(timestamptz, integer),
  private.appointment_reschedule_financial_terms(uuid, uuid, timestamptz, timestamptz),
  private.appointment_management_snapshot(uuid, uuid, timestamptz, timestamptz),
  private.merge_patient_deposit_exemption(boolean, boolean)
from public, anon, authenticated, service_role;

revoke all on function
  public.save_appointment_email_policy(uuid, jsonb, bigint),
  public.save_deposit_policy(uuid, jsonb, bigint),
  public.set_appointment_deposit(uuid, uuid, text, bigint, text),
  public.set_patient_deposit_auto_cancel_exemption(uuid, uuid, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  public.save_appointment_email_policy(uuid, jsonb, bigint),
  public.save_deposit_policy(uuid, jsonb, bigint),
  public.set_appointment_deposit(uuid, uuid, text, bigint, text),
  public.set_patient_deposit_auto_cancel_exemption(uuid, uuid, boolean)
to authenticated;

revoke all on function
  public.apply_patient_appointment_management(text, boolean, uuid, text, text, timestamptz, bigint, jsonb, bigint)
from public, anon, authenticated, service_role;

grant execute on function
  public.apply_patient_appointment_management(text, boolean, uuid, text, text, timestamptz, bigint, jsonb, bigint)
to service_role;

notify pgrst, 'reload schema';
commit;
