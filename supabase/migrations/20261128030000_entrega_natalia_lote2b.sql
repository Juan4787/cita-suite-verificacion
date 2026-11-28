-- Lote 2B de la entrega a Natalia (docs/plans/entrega-natalia-implementacion.md):
--  P1: aviso de seña por vencer (`deposit_expiring_reminder`, configurable 24h / 48h / Desactivado,
--      por omisión 24h, lectura al enviar y un solo envío por seña aunque cambie configuración) +
--      registro de «Ya transferí» (rate-limited, primer aviso preservado, bloquea cancelación automática,
--      lista «Avisó que pagó: verificar» y acción «No llegó el pago» con permisos explícitos).
--  P4: seña a cuenta al reprogramar o cancelar según corte en horas configurable (48 para Natalia,
--      vacío = comportamiento actual), créditos en `public.patient_deposit_credits`, «Aplicar» en un
--      paso con nota de diferencia, excepción por fuerza mayor al cancelar, decisiones de Juan del
--      28-nov-2026 (#1 «¿Quién pidió el cambio?» obligatorio en reprogramación tardía/pasada del personal,
--      #2 sin segunda seña al reprogramar >= corte con nota de diferencia, #3 monto real pagado al volver
--      a cancelar a tiempo, #4 «Deshacer» restituye crédito con auditoría y unicidad estricta).
-- Retrocompatible con el Worker productivo vigente (Lote 2A 16493ccb):
--  - conserva firma de 11 parámetros de `public.apply_staff_appointment_management`;
--  - `save_deposit_policy` sigue aceptando payloads de 11 y 12 claves además de los nuevos campos;
--  - `appointment_reschedule_financial_terms` conserva exactamente sus 23 claves JSON.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ============================================================================
-- 1. Esquema aditivo (P1 + P4) y nuevas restricciones
-- ============================================================================

alter table public.deposit_policies
  add column if not exists expiring_reminder_hours integer default 24,
  add column if not exists deposit_credit_cutoff_hours integer default null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deposit_policies_expiring_reminder_hours_check'
      and conrelid = 'public.deposit_policies'::regclass
  ) then
    alter table public.deposit_policies
      add constraint deposit_policies_expiring_reminder_hours_check
      check (expiring_reminder_hours is null or expiring_reminder_hours in (24, 48));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'deposit_policies_deposit_credit_cutoff_hours_check'
      and conrelid = 'public.deposit_policies'::regclass
  ) then
    alter table public.deposit_policies
      add constraint deposit_policies_deposit_credit_cutoff_hours_check
      check (deposit_credit_cutoff_hours is null or deposit_credit_cutoff_hours between 1 and 720);
  end if;
end $$;

-- Actualizar constraints de allocation en appointment_deposit_requirements (sumar 'credited') y actual_paid_amount
alter table public.appointment_deposit_requirements
  add column if not exists actual_paid_amount bigint;

do $$
declare v_con text;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_deposit_requirements_actual_paid_amount_check'
      and conrelid = 'public.appointment_deposit_requirements'::regclass
  ) then
    alter table public.appointment_deposit_requirements
      add constraint appointment_deposit_requirements_actual_paid_amount_check
      check (actual_paid_amount is null or actual_paid_amount between 1 and 1000000000000);
  end if;

  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.appointment_deposit_requirements'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%allocation%'
  loop
    execute format('alter table public.appointment_deposit_requirements drop constraint %I', v_con);
  end loop;

  alter table public.appointment_deposit_requirements
    add constraint appointment_deposit_requirements_allocation_check
    check (allocation in ('none', 'applied', 'forfeited', 'unresolved', 'credited'));
  alter table public.appointment_deposit_requirements
    add constraint appointment_deposit_requirements_status_allocation_check
    check ((status = 'paid' and allocation in ('applied', 'forfeited', 'unresolved', 'credited')) or (status <> 'paid' and allocation = 'none'));
end $$;

-- Ampliar event_type en appointment_deposit_events
do $$
declare v_con text;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.appointment_deposit_events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%event_type%'
      and pg_get_constraintdef(c.oid) like '%payment_forfeited%'
  loop
    execute format('alter table public.appointment_deposit_events drop constraint %I', v_con);
  end loop;

  alter table public.appointment_deposit_events
    add constraint appointment_deposit_events_event_type_check
    check (event_type in (
      'existing_state_observed', 'requirement_created', 'payment_recorded',
      'recording_reversed', 'requirement_waived', 'requirement_expired',
      'requirement_reopened', 'requirement_updated', 'payment_unresolved',
      'payment_applied', 'payment_forfeited', 'late_payment_recorded',
      'payment_credited', 'credit_applied', 'credit_released',
      'payment_notice_recorded', 'payment_notice_cleared'
    ));
end $$;

-- Ampliar purpose en private.appointment_email_deliveries (7º propósito: deposit_expiring_reminder)
do $$
declare v_con text;
begin
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'private.appointment_email_deliveries'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%purpose%'
  loop
    execute format('alter table private.appointment_email_deliveries drop constraint %I', v_con);
  end loop;

  alter table private.appointment_email_deliveries
    add constraint appointment_email_deliveries_purpose_check
    check (purpose in (
      'booking_receipt', 'reschedule_receipt', 'cancellation_receipt',
      'deposit_request', 'deposit_expiring_reminder', 'reminder_72h', 'reminder_24h'
    ));
end $$;

-- Tabla de señas a cuenta en la ficha del paciente (P4)
create table if not exists public.patient_deposit_credits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  patient_id uuid not null,
  source_appointment_id uuid not null,
  source_requirement_id uuid not null references public.appointment_deposit_requirements(id) on delete cascade unique,
  amount bigint not null check (amount between 1 and 1000000000000),
  currency text not null default 'ARS' check (currency = 'ARS'),
  status text not null default 'available' check (status in ('available', 'applied')),
  reason text not null check (reason in ('cancelled_in_time', 'force_majeure')),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete set null,
  applied_appointment_id uuid,
  applied_requirement_id uuid references public.appointment_deposit_requirements(id) on delete set null,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  last_released_at timestamptz,
  last_released_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, patient_id) references public.patients(business_id, id) on delete cascade,
  foreign key (business_id, source_appointment_id) references public.appointments(business_id, id) on delete cascade,
  foreign key (business_id, applied_appointment_id) references public.appointments(business_id, id) on delete cascade,
  constraint patient_deposit_credits_status_consistency check (
    (status = 'available' and applied_appointment_id is null and applied_requirement_id is null and applied_at is null)
    or (status = 'applied' and applied_appointment_id is not null and applied_at is not null)
  )
);

create unique index if not exists patient_deposit_credits_one_applied_per_appointment
  on public.patient_deposit_credits(business_id, applied_appointment_id)
  where status = 'applied' and applied_appointment_id is not null;

create index if not exists patient_deposit_credits_available_idx
  on public.patient_deposit_credits(business_id, patient_id, created_at, id)
  where status = 'available';

alter table public.patient_deposit_credits enable row level security;
revoke all on public.patient_deposit_credits from public, anon, authenticated, service_role;
grant select on public.patient_deposit_credits to authenticated, service_role;

drop policy if exists patient_deposit_credits_select on public.patient_deposit_credits;
create policy patient_deposit_credits_select on public.patient_deposit_credits
  for select to authenticated
  using (
    public.user_business_role(business_id) in ('owner', 'admin', 'reception', 'readonly')
    or (business_id, patient_id) in (
      select l.business_id, l.patient_id
      from public.professional_patient_links l
      join public.professional_users pu
        on pu.business_id = l.business_id and pu.professional_id = l.professional_id
      where pu.user_id = (select auth.uid()) and l.is_active
    )
  );

-- Columnas P1 y P4 en appointment_deposits
alter table public.appointment_deposits
  add column if not exists patient_payment_notice_at timestamptz,
  add column if not exists auto_cancel_suppressed_by_payment_notice boolean not null default false,
  add column if not exists applied_credit_id uuid references public.patient_deposit_credits(id) on delete set null,
  add column if not exists applied_credit_amount bigint,
  add column if not exists amount_difference_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_deposits_payment_notice_suppression_check'
      and conrelid = 'public.appointment_deposits'::regclass
  ) then
    alter table public.appointment_deposits
      add constraint appointment_deposits_payment_notice_suppression_check
      check (not auto_cancel_suppressed_by_payment_notice or patient_payment_notice_at is not null);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_deposits_applied_credit_pair_check'
      and conrelid = 'public.appointment_deposits'::regclass
  ) then
    alter table public.appointment_deposits
      add constraint appointment_deposits_applied_credit_pair_check
      check (
        (applied_credit_id is null or applied_credit_amount is not null)
        and (applied_credit_amount is null or applied_credit_amount between 1 and 1000000000000)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_deposits_amount_difference_note_check'
      and conrelid = 'public.appointment_deposits'::regclass
  ) then
    alter table public.appointment_deposits
      add constraint appointment_deposits_amount_difference_note_check
      check (amount_difference_note is null or char_length(amount_difference_note) <= 300);
  end if;
end $$;

-- Garantía estructural (decisión #4 de Juan): una misma seña a cuenta jamás puede quedar aplicada a dos turnos a la vez
create unique index if not exists appointment_deposits_unique_applied_credit
  on public.appointment_deposits(applied_credit_id)
  where applied_credit_id is not null;

create index if not exists appointment_deposits_payment_notice_idx
  on public.appointment_deposits(business_id, patient_payment_notice_at)
  where status = 'pending' and patient_payment_notice_at is not null;

-- ============================================================================
-- 2. Helpers privados únicos (formato de montos, notas de diferencia y fusión)
-- ============================================================================

create or replace function private.format_ars_amount(p_amount bigint) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select '$ ' || replace(to_char(p_amount, 'FM999,999,999,999'), ',', '.')
$$;

create or replace function private.deposit_difference_note(
  p_paid_amount bigint,
  p_target_amount bigint,
  p_context text
) returns text
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_diff bigint;
  v_paid text;
  v_target text;
  v_diff_text text;
begin
  if p_paid_amount is null or p_target_amount is null or p_paid_amount = p_target_amount then
    return null;
  end if;
  v_paid := private.format_ars_amount(p_paid_amount);
  v_target := private.format_ars_amount(p_target_amount);
  if p_target_amount > p_paid_amount then
    v_diff := p_target_amount - p_paid_amount;
    v_diff_text := private.format_ars_amount(v_diff);
    if p_context = 'rescheduled' then
      return 'Se conserva la seña pagada de ' || v_paid || '. Como el monto vigente es ' || v_target || ', falta cobrar ' || v_diff_text || ' de diferencia.';
    end if;
    return 'Se aplicó la seña a cuenta de ' || v_paid || '. Falta cobrar ' || v_diff_text || ' de diferencia.';
  else
    v_diff := p_paid_amount - p_target_amount;
    v_diff_text := private.format_ars_amount(v_diff);
    if p_context = 'rescheduled' then
      return 'Se conserva la seña pagada de ' || v_paid || '. Como el monto vigente es ' || v_target || ', queda ' || v_diff_text || ' de saldo a favor.';
    end if;
    return 'Se aplicó la seña a cuenta de ' || v_paid || '. Queda ' || v_diff_text || ' de saldo a favor.';
  end if;
end $$;

create or replace function private.resolve_current_deposit_amount(
  p_business_id uuid,
  p_service_id uuid,
  p_source text,
  p_starts_at timestamptz,
  p_from timestamptz,
  p_quote jsonb
) returns bigint
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare v_terms jsonb;
begin
  v_terms := private.deposit_terms(p_business_id, p_service_id, p_source, p_starts_at, p_from, p_quote);
  if (v_terms->>'required')::boolean is true then
    return (v_terms->>'amount')::bigint;
  end if;
  return null;
end $$;

create or replace function private.merge_patient_deposit_credits(
  p_business_id uuid,
  p_from_patient_id uuid,
  p_to_patient_id uuid
) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_moved integer := 0;
begin
  if p_business_id is null or p_from_patient_id is null or p_to_patient_id is null or p_from_patient_id = p_to_patient_id then
    return 0;
  end if;
  perform 1
  from public.patient_deposit_credits c
  where c.business_id = p_business_id and c.patient_id = p_from_patient_id and c.status = 'available'
  order by c.id
  for update;

  update public.patient_deposit_credits
  set patient_id = p_to_patient_id,
      updated_at = clock_timestamp()
  where business_id = p_business_id
    and patient_id = p_from_patient_id
    and status = 'available';
  get diagnostics v_moved = row_count;
  return v_moved;
end $$;

-- Columna computada sobre public.patients (0 subpedidos HTTP extra en ficha del paciente y en /odonto/senas)
create or replace function public.patient_available_deposit_credits(public.patients) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select coalesce(
    (
      select jsonb_agg(t.payload order by t.created_at asc, t.id asc)
      from (
        select
          c.id,
          c.created_at,
          jsonb_build_object(
            'id', c.id,
            'amount', c.amount,
            'currency', c.currency,
            'reason', c.reason,
            'source_appointment_id', c.source_appointment_id,
            'created_at', c.created_at
          ) as payload
        from public.patient_deposit_credits c
        join public.patients p on p.business_id = c.business_id and p.id = c.patient_id
        where auth.uid() is not null
          and p.business_id = ($1).business_id
          and p.id = ($1).id
          and c.status = 'available'
          and (
            public.user_business_role(p.business_id) in ('owner', 'admin', 'reception', 'readonly')
            or exists(
              select 1
              from public.professional_patient_links l
              join public.professional_users pu
                on pu.business_id = l.business_id and pu.professional_id = l.professional_id
              where l.business_id = p.business_id
                and l.patient_id = p.id
                and pu.user_id = auth.uid()
                and l.is_active
            )
          )
        order by c.created_at asc, c.id asc
        limit 50
      ) t
    ),
    '[]'::jsonb
  )
$$;

-- Helper de resumen financiero actualizado (contabiliza monto real pagado `coalesce(actual_paid_amount, amount)`)
create or replace function private.appointment_deposit_summary(p_business_id uuid, p_appointment_id uuid, p_patient_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'applied_amount', coalesce(sum(coalesce(actual_paid_amount, amount)) filter(where allocation = 'applied'), 0)::text,
    'forfeited_amount', coalesce(sum(coalesce(actual_paid_amount, amount)) filter(where allocation = 'forfeited'), 0)::text,
    'unresolved_amount', (
      coalesce(sum(coalesce(actual_paid_amount, amount)) filter(where allocation = 'unresolved'), 0)
      + private.appointment_late_deposit_balance(p_business_id, p_appointment_id, p_patient_id)
    )::text
  )
  from public.appointment_deposit_requirements
  where business_id = p_business_id and appointment_id = p_appointment_id and patient_id = p_patient_id and status = 'paid'
$$;

-- ============================================================================
-- 3. Rate limiting público para «Ya transferí» (P1)
-- ============================================================================

create or replace function public.consume_server_rate_limits(
  p_action text,
  p_subject_hash text,
  p_windows jsonb
)
returns table(allowed boolean, used integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_action text := lower(nullif(trim(coalesce(p_action, '')), ''));
  v_subject_hash text := lower(nullif(trim(coalesce(p_subject_hash, '')), ''));
  v_window record;
  v_since timestamptz;
  v_used integer;
  v_oldest timestamptz;
  v_max_used integer := 0;
  v_retry_after integer := 0;
begin
  if v_action is null or v_subject_hash is null
    or jsonb_typeof(p_windows) <> 'array'
    or jsonb_array_length(p_windows) = 0
  then
    raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
  end if;

  if v_action not in (
    'signup_email_by_email',
    'signup_email_by_ip',
    'signup_google_by_ip',
    'login_password_by_email',
    'login_password_by_ip',
    'pending_business_creation_by_user',
    'pending_business_creation_by_ip',
    'mp_subscription_create_by_business',
    'radiograph_upload_by_user',
    'radiograph_original_access_by_user',
    'radiograph_trash_by_user',
    'radiograph_restore_by_user',
    'patient_export_individual_by_user',
    'patient_export_global_by_business',
    'deposit_payment_notice_by_ip',
    'deposit_payment_notice_by_token'
  ) then
    raise exception 'RATE_LIMIT_UNKNOWN_ACTION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_action || ':' || v_subject_hash, 0));
  delete from public.server_rate_limit_events
  where created_at < now() - interval '7 days';

  for v_window in
    select *
    from jsonb_to_recordset(p_windows) as window_defs(limit_count integer, window_seconds integer)
  loop
    if coalesce(v_window.limit_count, 0) <= 0 or coalesce(v_window.window_seconds, 0) <= 0 then
      raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
    end if;

    v_since := now() - make_interval(secs => v_window.window_seconds);
    select count(*)::integer, min(created_at)
    into v_used, v_oldest
    from public.server_rate_limit_events
    where action = v_action
      and subject_hash = v_subject_hash
      and created_at >= v_since;

    v_max_used := greatest(v_max_used, v_used);
    if v_used >= v_window.limit_count then
      v_retry_after := greatest(
        v_retry_after,
        greatest(
          1,
          ceil(extract(epoch from (v_oldest + make_interval(secs => v_window.window_seconds) - now())))::integer
        )
      );
    end if;
  end loop;

  if v_retry_after > 0 then
    allowed := false;
    used := v_max_used;
    retry_after_seconds := v_retry_after;
    return next;
    return;
  end if;

  insert into public.server_rate_limit_events (action, subject_hash)
  values (v_action, v_subject_hash);

  allowed := true;
  used := v_max_used + 1;
  retry_after_seconds := 0;
  return next;
end;
$$;

-- ============================================================================
-- 4. Configuración de señas (P1 + P4, retrocompatible con 11 y 12 claves)
-- ============================================================================

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
  v_expected_keys integer := 11;
  v_has_late_hours boolean;
  v_has_expiring_hours boolean;
  v_has_credit_cutoff boolean;
  v_num numeric;
begin
  if private.deposit_actor(p_business_id, array['owner', 'admin']) is null then raise exception 'DEPOSIT_POLICY_FORBIDDEN'; end if;
  if p_expected_revision is null or jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text) > 8192 then
    raise exception 'DEPOSIT_POLICY_INVALID';
  end if;

  select count(*) into v_key_count from jsonb_object_keys(p_settings);
  v_has_late_hours := p_settings ? 'late_booking_payment_hours';
  v_has_expiring_hours := p_settings ? 'expiring_reminder_hours';
  v_has_credit_cutoff := p_settings ? 'deposit_credit_cutoff_hours';
  if v_has_late_hours then v_expected_keys := v_expected_keys + 1; end if;
  if v_has_expiring_hours then v_expected_keys := v_expected_keys + 1; end if;
  if v_has_credit_cutoff then v_expected_keys := v_expected_keys + 1; end if;

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
  or (v_has_expiring_hours and (coalesce(jsonb_typeof(p_settings->'expiring_reminder_hours'), 'missing') = any(array['number', 'null'])) is not true)
  or (v_has_credit_cutoff and (coalesce(jsonb_typeof(p_settings->'deposit_credit_cutoff_hours'), 'missing') = any(array['number', 'null'])) is not true)
  or v_key_count <> v_expected_keys then
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
        v_new.late_booking_payment_hours := null;
      else
        v_num := (p_settings->>'late_booking_payment_hours')::numeric;
        if v_num <> trunc(v_num) or v_num not between 1 and 168 then raise exception 'DEPOSIT_POLICY_INVALID'; end if;
        v_new.late_booking_payment_hours := v_num::integer;
      end if;
    else
      v_new.late_booking_payment_hours := v_current.late_booking_payment_hours;
    end if;

    if v_has_expiring_hours then
      if jsonb_typeof(p_settings->'expiring_reminder_hours') = 'null' then
        v_new.expiring_reminder_hours := null;
      else
        v_num := (p_settings->>'expiring_reminder_hours')::numeric;
        if v_num <> trunc(v_num) or v_num::integer not in (24, 48) then raise exception 'DEPOSIT_POLICY_INVALID'; end if;
        v_new.expiring_reminder_hours := v_num::integer;
      end if;
    else
      v_new.expiring_reminder_hours := case when v_current.business_id is not null then v_current.expiring_reminder_hours else 24 end;
    end if;

    if v_has_credit_cutoff then
      if jsonb_typeof(p_settings->'deposit_credit_cutoff_hours') = 'null' then
        v_new.deposit_credit_cutoff_hours := null;
      else
        v_num := (p_settings->>'deposit_credit_cutoff_hours')::numeric;
        if v_num <> trunc(v_num) or v_num not between 1 and 720 then raise exception 'DEPOSIT_POLICY_INVALID'; end if;
        v_new.deposit_credit_cutoff_hours := v_num::integer;
      end if;
    else
      v_new.deposit_credit_cutoff_hours := v_current.deposit_credit_cutoff_hours;
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
    or (v_new.expiring_reminder_hours is not null and v_new.expiring_reminder_hours not in (24, 48))
    or (v_new.deposit_credit_cutoff_hours is not null and v_new.deposit_credit_cutoff_hours not between 1 and 720)
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
    expiring_reminder_hours, deposit_credit_cutoff_hours,
    transfer_details, applies_to_manual, revision, updated_at, updated_by
  )
  values(
    p_business_id, v_new.enabled, v_new.auto_cancel_enabled, v_new.amount_mode, v_new.fixed_amount, v_new.percentage,
    v_new.request_days, v_new.deadline_hours, v_new.min_payment_hours, v_new.late_booking_payment_hours,
    v_new.expiring_reminder_hours, v_new.deposit_credit_cutoff_hours,
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
    expiring_reminder_hours = excluded.expiring_reminder_hours,
    deposit_credit_cutoff_hours = excluded.deposit_credit_cutoff_hours,
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
    set status = 'waived',
        waived_reason = 'policy_disabled',
        patient_payment_notice_at = null,
        auto_cancel_suppressed_by_payment_notice = false,
        revision = ad.revision + 1,
        updated_at = v_now
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
      'expiring_reminder_hours', v_new.expiring_reminder_hours,
      'deposit_credit_cutoff_hours', v_new.deposit_credit_cutoff_hours,
      'revision', coalesce(v_current.revision, 0) + 1,
      'waived_pending', v_waived
    )
  );
  return coalesce(v_current.revision, 0) + 1;
end $$;

-- ============================================================================
-- 5. Triggers y estado de señas (actual_paid_amount, cancelación P4 y reprogramación pendiente)
-- ============================================================================

create or replace function private.synchronize_deposit_requirement() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  r public.appointment_deposit_requirements;
  a public.appointments;
  v_terms jsonb;
  v_allocation text;
  v_event text;
  v_actual_paid bigint;
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
    v_actual_paid := case when new.status = 'paid' then coalesce(new.applied_credit_amount, new.amount) else null end;
    insert into public.appointment_deposit_requirements(
      business_id, appointment_id, patient_id, status, amount, base_amount, actual_paid_amount,
      allocation, terms_snapshot, projection_revision, recorded_by, recorded_at
    )
    values(
      new.business_id, new.appointment_id, a.patient_id, new.status, new.amount, new.amount, v_actual_paid, v_allocation, v_terms,
      new.revision, new.recorded_by, new.recorded_at
    ) returning * into r;
    insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, metadata)
    values(r.business_id, r.appointment_id, r.id, 'requirement_created', jsonb_build_object('status', new.status));
    if new.status <> 'pending' then
      insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, metadata)
      values(r.business_id, r.appointment_id, r.id, 'existing_state_observed', case when new.status = 'paid' then v_actual_paid else 0 end,
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
  v_actual_paid := case
    when new.status <> 'paid' then null
    when new.applied_credit_amount is not null then new.applied_credit_amount
    when r.status = 'paid' then coalesce(r.actual_paid_amount, r.amount)
    else new.amount
  end;
  update public.appointment_deposit_requirements
  set status = new.status,
      amount = new.amount,
      actual_paid_amount = v_actual_paid,
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
      case
        when v_event = 'payment_recorded' then coalesce(v_actual_paid, new.amount)
        when v_event = 'recording_reversed' then coalesce(r.actual_paid_amount, new.amount)
        else 0
      end,
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
  v_base_auto_cancel := (d.auto_cancel or d.auto_cancel_suppressed_by_patient_exemption or d.auto_cancel_suppressed_by_payment_notice) and s.auto_cancel;
  update public.appointment_deposits
  set request_from = s.request_from,
      due_at = s.due_at,
      patient_payment_notice_at = null,
      auto_cancel_suppressed_by_payment_notice = false,
      auto_cancel = v_base_auto_cancel and not coalesce(v_patient_exempt, false),
      auto_cancel_suppressed_by_patient_exemption = v_base_auto_cancel and coalesce(v_patient_exempt, false),
      revision = d.revision + 1,
      updated_at = v_now
  where appointment_id = d.appointment_id;
  return null;
end $$;

-- Trigger de gestión de turno actualizado para cancelar con regla P4 (en plazo / fuerza mayor / fuera de plazo)
create or replace function private.track_appointment_management_state() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  r public.appointment_deposit_requirements;
  v_cutoff_hours integer;
  v_force_majeure boolean;
  v_cancel_at timestamptz;
  v_credit_amount bigint;
  v_credit_id uuid;
  v_reason text;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_management_states(business_id, appointment_id)
    values(new.business_id, new.id)
    on conflict (appointment_id) do nothing;
    return null;
  end if;

  if (new.business_id, new.patient_id) is distinct from (old.business_id, old.patient_id) then
    if exists(
      select 1 from public.appointment_deposit_requirements
      where business_id = old.business_id and appointment_id = old.id and status = 'paid'
    ) then
      raise exception 'APPOINTMENT_DEPOSIT_IDENTITY_CHANGE';
    end if;
    for r in
      select * from public.appointment_deposit_requirements
      where business_id = old.business_id and appointment_id = old.id and is_current
      order by ordinal for update
    loop
      update public.appointment_deposit_requirements set is_current = false, updated_at = clock_timestamp() where id = r.id;
      insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, actor_id, metadata)
      values(r.business_id, r.appointment_id, r.id, 'requirement_updated', new.updated_by_user_id,
        jsonb_build_object('reason', 'patient_reassigned', 'closed', true));
    end loop;
    delete from public.appointment_deposits where business_id = old.business_id and appointment_id = old.id;
    update public.appointment_management_states
    set terms_acknowledged = false, require_deposit_on_reschedule = false,
        previous_deposit_disposition = 'credit', accepted_at = null, accepted_policy_revision = null, terms_snapshot = '{}'::jsonb
    where business_id = old.business_id and appointment_id = old.id;
  end if;

  if (new.business_id, new.patient_id, new.service_id, new.professional_id, new.starts_at, new.ends_at, new.blocking_starts_at,
    new.blocking_ends_at, new.status, new.price_quote_snapshot, new.duration_minutes_snapshot, new.ignore_break,
    new.break_minutes_snapshot, new.buffer_before_minutes_snapshot, new.buffer_after_minutes_snapshot)
    is distinct from
    (old.business_id, old.patient_id, old.service_id, old.professional_id, old.starts_at, old.ends_at, old.blocking_starts_at,
    old.blocking_ends_at, old.status, old.price_quote_snapshot, old.duration_minutes_snapshot, old.ignore_break,
    old.break_minutes_snapshot, old.buffer_before_minutes_snapshot, old.buffer_after_minutes_snapshot) then
    update public.appointment_management_states
    set appointment_revision = appointment_revision + 1,
        generation = case when new.patient_id is distinct from old.patient_id then generation + 1 else generation end,
        legacy_management_allowed = case when new.patient_id is distinct from old.patient_id then false else legacy_management_allowed end
    where business_id = new.business_id and appointment_id = new.id;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    select dp.deposit_credit_cutoff_hours into v_cutoff_hours
    from public.deposit_policies dp
    where dp.business_id = new.business_id;
    v_force_majeure := coalesce(current_setting('cita.cancel_keep_deposit_credit', true), '') = new.id::text;
    v_cancel_at := coalesce(new.cancelled_at, clock_timestamp());
    v_actor := coalesce(new.cancelled_by_user_id, auth.uid());

    for r in
      select * from public.appointment_deposit_requirements
      where business_id = new.business_id and appointment_id = new.id and status = 'paid' and allocation = 'applied'
      order by ordinal for update
    loop
      v_credit_amount := coalesce(r.actual_paid_amount, r.amount);
      if v_cutoff_hours is null and not v_force_majeure then
        update public.appointment_deposit_requirements set allocation = 'unresolved', updated_at = now() where id = r.id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
        values(r.business_id, r.appointment_id, r.id, 'payment_unresolved', v_credit_amount, v_actor, jsonb_build_object('reason', 'appointment_cancelled'));
      elsif v_force_majeure or (v_cutoff_hours is not null and (new.starts_at - v_cancel_at) >= make_interval(hours => v_cutoff_hours)) then
        v_reason := case
          when v_cutoff_hours is not null and (new.starts_at - v_cancel_at) >= make_interval(hours => v_cutoff_hours) then 'cancelled_in_time'
          else 'force_majeure'
        end;
        update public.appointment_deposit_requirements set allocation = 'credited', updated_at = v_cancel_at where id = r.id;
        insert into public.patient_deposit_credits(
          business_id, patient_id, source_appointment_id, source_requirement_id,
          amount, currency, status, reason, created_at, created_by
        )
        values(
          r.business_id, r.patient_id, r.appointment_id, r.id,
          v_credit_amount, 'ARS', 'available', v_reason, v_cancel_at, v_actor
        )
        returning id into v_credit_id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
        values(
          r.business_id, r.appointment_id, r.id, 'payment_credited', v_credit_amount, v_actor,
          jsonb_build_object('reason', v_reason, 'credit_id', v_credit_id, 'cutoff_hours', v_cutoff_hours)
        );
      else
        update public.appointment_deposit_requirements set allocation = 'forfeited', updated_at = v_cancel_at where id = r.id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
        values(
          r.business_id, r.appointment_id, r.id, 'payment_forfeited', v_credit_amount, v_actor,
          jsonb_build_object('reason', 'cancelled_late', 'cutoff_hours', v_cutoff_hours)
        );
      end if;
    end loop;
  end if;
  return null;
end $$;

-- Revisión semántica: incluye patient_payment_notice_at, applied_credit_id y deposit_credit_cutoff_hours
create or replace function private.appointment_semantic_revision(p_business_id uuid, p_appointment_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select encode(extensions.digest(jsonb_build_object(
    'contract', 1, 'appointment_revision', m.appointment_revision,
    'identity', jsonb_build_array(a.business_id, a.id, a.patient_id, a.service_id, a.professional_id),
    'interval', jsonb_build_array(extract(epoch from a.starts_at), extract(epoch from a.ends_at),
      extract(epoch from a.blocking_starts_at), extract(epoch from a.blocking_ends_at)),
    'status', a.status, 'quote', a.price_quote_snapshot,
    'management', jsonb_build_array(m.generation, m.legacy_management_allowed, m.terms_acknowledged,
      m.require_deposit_on_reschedule, m.previous_deposit_disposition, m.accepted_policy_revision),
    'financial_preferences', jsonb_build_array(p.require_deposit_on_reschedule, p.previous_deposit_disposition, dp.deposit_credit_cutoff_hours),
    'context', (select jsonb_build_array(c.modality, c.integration_id, c.integration_revision)
      from public.appointment_booking_contexts c where c.business_id = a.business_id and c.appointment_id = a.id),
    'team', (select jsonb_agg(jsonb_build_array(t.professional_id, t.is_primary, t.position, t.ignore_break,
      extract(epoch from t.starts_at), extract(epoch from t.ends_at), extract(epoch from t.blocking_starts_at), extract(epoch from t.blocking_ends_at))
      order by t.professional_id) from public.appointment_professionals t where t.business_id = a.business_id and t.appointment_id = a.id),
    'deposit', (select jsonb_build_array(d.status, d.amount, d.percentage, d.reference_amount, d.policy_revision, d.request_days,
      d.deadline_hours, d.min_payment_hours, extract(epoch from d.request_from), extract(epoch from d.due_at), d.auto_cancel, d.waived_reason,
      extract(epoch from d.patient_payment_notice_at), d.applied_credit_id)
      from public.appointment_deposits d where d.business_id = a.business_id and d.appointment_id = a.id),
    'requirements', (select jsonb_agg(jsonb_build_array(r.id, r.patient_id, r.is_current, r.status, r.amount, r.base_amount, r.allocation)
      order by r.ordinal) from public.appointment_deposit_requirements r where r.business_id = a.business_id and r.appointment_id = a.id),
    'economic_event', (select max(e.ordinal) from public.appointment_deposit_events e where e.business_id = a.business_id and e.appointment_id = a.id)
  )::text, 'sha256'), 'hex')
  from public.appointments a
  join public.appointment_management_states m on (m.business_id, m.appointment_id) = (a.business_id, a.id)
  join public.appointment_email_policies p on p.business_id = a.business_id
  left join public.deposit_policies dp on dp.business_id = a.business_id
  where a.business_id = p_business_id and a.id = p_appointment_id
$$;

-- ============================================================================
-- 6. P1: «Ya transferí», «No llegó el pago», protección en vencimiento y P3
-- ============================================================================

create or replace function public.report_appointment_deposit_payment(
  p_token text,
  p_legacy boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_access jsonb;
  v_locked_access jsonb;
  v_business uuid;
  v_appointment uuid;
  a public.appointments;
  d public.appointment_deposits;
  r public.appointment_deposit_requirements;
  v_now timestamptz;
  v_suppressed boolean := false;
begin
  if p_legacy is null then raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  v_access := public.resolve_appointment_management_access(p_token, p_legacy);
  v_business := (v_access->>'business_id')::uuid;
  v_appointment := (v_access->>'appointment_id')::uuid;

  select * into a from public.appointments where business_id = v_business and id = v_appointment for no key update;
  if not found then raise exception 'APPOINTMENT_LINK_UNAVAILABLE'; end if;
  v_locked_access := public.resolve_appointment_management_access(p_token, p_legacy);
  if (v_locked_access->>'business_id', v_locked_access->>'appointment_id') is distinct from (v_business::text, v_appointment::text) then
    raise exception 'APPOINTMENT_LINK_UNAVAILABLE';
  end if;

  select * into d from public.appointment_deposits where business_id = v_business and appointment_id = v_appointment for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;

  v_now := clock_timestamp();
  if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or a.starts_at <= v_now or d.status = 'expired' then
    raise exception 'DEPOSIT_APPOINTMENT_CLOSED';
  end if;
  if d.status <> 'pending' then
    raise exception 'DEPOSIT_NOT_PENDING';
  end if;

  -- Múltiples toques: siempre conserva el primer aviso registrado.
  if d.patient_payment_notice_at is not null then
    return jsonb_build_object(
      'recorded', true,
      'already_recorded', true,
      'payment_notice_at', d.patient_payment_notice_at,
      'revision', d.revision
    );
  end if;

  v_suppressed := d.auto_cancel;
  update public.appointment_deposits
  set patient_payment_notice_at = v_now,
      auto_cancel = false,
      auto_cancel_suppressed_by_payment_notice = v_suppressed,
      revision = d.revision + 1,
      updated_at = v_now
  where appointment_id = d.appointment_id
  returning * into d;

  select * into r from public.appointment_deposit_requirements
  where business_id = v_business and appointment_id = v_appointment and is_current;
  if found then
    insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
    values(
      v_business, v_appointment, r.id, 'payment_notice_recorded', 0, null,
      jsonb_build_object('origin', 'patient', 'auto_cancel_suppressed', v_suppressed)
    );
  end if;

  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(
    v_business, null, 'appointment.deposit_payment_notice_recorded', 'appointment', v_appointment,
    jsonb_build_object('amount', d.amount, 'auto_cancel_suppressed', v_suppressed)
  );

  return jsonb_build_object(
    'recorded', true,
    'already_recorded', false,
    'payment_notice_at', d.patient_payment_notice_at,
    'revision', d.revision
  );
end $$;

create or replace function public.clear_appointment_deposit_payment_notice(
  p_business_id uuid,
  p_appointment_id uuid,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a public.appointments;
  d public.appointment_deposits;
  dp public.deposit_policies;
  r public.appointment_deposit_requirements;
  v_patient_exempt boolean := false;
  v_now timestamptz;
  v_restore_auto_cancel boolean := false;
begin
  if p_business_id is null or p_appointment_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'DEPOSIT_ACTION_INVALID';
  end if;
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'DEPOSIT_FORBIDDEN';
  end if;

  select * into a from public.appointments where business_id = p_business_id and id = p_appointment_id for no key update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  select * into d from public.appointment_deposits where business_id = p_business_id and appointment_id = p_appointment_id for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  select * into dp from public.deposit_policies where business_id = p_business_id for share;

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'DEPOSIT_FORBIDDEN';
  end if;

  v_now := clock_timestamp();
  if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or d.status = 'expired' then
    raise exception 'DEPOSIT_APPOINTMENT_CLOSED';
  end if;
  if d.status <> 'pending' then
    raise exception 'DEPOSIT_NOT_PENDING';
  end if;
  if d.revision is distinct from p_expected_revision then
    raise exception 'DEPOSIT_CHANGED';
  end if;
  if d.patient_payment_notice_at is null then
    raise exception 'DEPOSIT_ACTION_INVALID';
  end if;

  select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
  from public.patients pt where pt.business_id = p_business_id and pt.id = a.patient_id;

  -- Devuelve el turno al circuito normal: si todavía corresponde (no venció, sin P3, sin corte < 24h),
  -- vuelve la cancelación automática; si ya venció, queda en «Vencidas sin cancelar: decidir».
  v_restore_auto_cancel := d.auto_cancel_suppressed_by_payment_notice
    and not coalesce(v_patient_exempt, false)
    and coalesce(dp.enabled, false)
    and coalesce(dp.auto_cancel_enabled, false)
    and d.due_at > v_now
    and (d.late_booking_payment_hours is null or (a.starts_at - d.due_at >= interval '24 hours'));

  update public.appointment_deposits
  set patient_payment_notice_at = null,
      auto_cancel_suppressed_by_payment_notice = false,
      auto_cancel = v_restore_auto_cancel,
      revision = d.revision + 1,
      updated_at = v_now
  where appointment_id = d.appointment_id
  returning * into d;

  select * into r from public.appointment_deposit_requirements
  where business_id = p_business_id and appointment_id = p_appointment_id and is_current;
  if found then
    insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
    values(
      p_business_id, p_appointment_id, r.id, 'payment_notice_cleared', 0, auth.uid(),
      jsonb_build_object('restored_auto_cancel', v_restore_auto_cancel)
    );
  end if;

  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(
    p_business_id, auth.uid(), 'appointment.deposit_payment_notice_cleared', 'appointment', p_appointment_id,
    jsonb_build_object('amount', d.amount, 'restored_auto_cancel', v_restore_auto_cancel)
  );

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'DEPOSIT_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'revision', d.revision,
    'auto_cancel', v_restore_auto_cancel,
    'due_at', d.due_at
  );
end $$;

-- Defensa en profundidad: nunca vence automáticamente un turno con aviso «Ya transferí»
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
  if not found or v_patient_exempt or d.patient_payment_notice_at is not null
    or d.status <> 'pending' or not d.auto_cancel or d.due_at > p_now or d.due_at <= p_now - interval '24 hours'
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
      where ad.status = 'pending' and ad.auto_cancel and ad.patient_payment_notice_at is null
        and not pt.exempt_from_deposit_auto_cancel
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

-- P3 actualizado: quitar exención nunca reactiva auto_cancel sobre un turno con aviso «Ya transferí»
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
  if not found then raise exception 'PATIENT_NOT_FOUND'; end if;

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN';
  end if;

  select * into v_policy from public.deposit_policies dp where dp.business_id = p_business_id for share;
  v_now := clock_timestamp();

  select coalesce(
    (
      select nullif(btrim(pr.name), '')
      from public.professional_users pu
      join public.professionals pr on pr.business_id = pu.business_id and pr.id = pu.professional_id
      where pu.business_id = p_business_id and pu.user_id = v_actor
      limit 1
    ),
    (select nullif(btrim(u.email), '') from auth.users u where u.id = v_actor),
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
            ad.patient_payment_notice_at is null
            and coalesce(v_policy.enabled, false)
            and coalesce(v_policy.auto_cancel_enabled, false)
            and (ad.due_at - v_now >= make_interval(hours => ad.min_payment_hours))
            and (ad.late_booking_payment_hours is null or (a.starts_at - ad.due_at >= interval '24 hours'))
          ),
          auto_cancel_suppressed_by_payment_notice = case
            when ad.patient_payment_notice_at is not null
              and coalesce(v_policy.enabled, false)
              and coalesce(v_policy.auto_cancel_enabled, false)
              and (ad.due_at - v_now >= make_interval(hours => ad.min_payment_hours))
              and (ad.late_booking_payment_hours is null or (a.starts_at - ad.due_at >= interval '24 hours'))
            then true
            else ad.auto_cancel_suppressed_by_payment_notice
          end,
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
      jsonb_build_object('previous_exempt', v_patient.exempt_from_deposit_auto_cancel, 'exempt', p_exempt,
        'actor_name', v_actor_name, 'updated_deposits', v_updated_deposits)
    );

    insert into public.patient_profile_change_events(
      business_id, patient_id, changed_by_user_id, changed_by_professional_id, changed_by_name, changed_fields, summary
    )
    values(
      p_business_id, p_patient_id, v_actor, null, v_actor_name,
      jsonb_build_array('exempt_from_deposit_auto_cancel'),
      case when p_exempt then 'Activó «No cancelar sus turnos por seña impaga».' else 'Quitó «No cancelar sus turnos por seña impaga».' end
    );
  end if;

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'exempt', p_exempt,
    'updated_at', case when v_patient.exempt_from_deposit_auto_cancel is distinct from p_exempt then v_now else coalesce(v_patient.exempt_from_deposit_auto_cancel_updated_at, v_now) end,
    'updated_by_name', case when v_patient.exempt_from_deposit_auto_cancel is distinct from p_exempt then v_actor_name else coalesce(v_patient.exempt_from_deposit_auto_cancel_updated_by_name, v_actor_name) end,
    'updated_deposits', v_updated_deposits
  );
end $$;

-- ============================================================================
-- 7. P4: «Aplicar» crédito a un turno y «Deshacer» restituyendo crédito (decisión #4)
-- ============================================================================

create or replace function public.apply_patient_deposit_credit(
  p_business_id uuid,
  p_appointment_id uuid,
  p_expected_revision bigint,
  p_credit_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  a public.appointments;
  d public.appointment_deposits;
  r public.appointment_deposit_requirements;
  c public.patient_deposit_credits;
  v_now timestamptz;
  v_diff_amount bigint;
  v_diff_note text;
begin
  if p_business_id is null or p_appointment_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'DEPOSIT_ACTION_INVALID';
  end if;
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'DEPOSIT_FORBIDDEN';
  end if;

  -- Orden estricto de bloqueos (libre de interbloqueos): appointments -> appointment_deposits -> requirements -> patient_deposit_credits
  select * into a from public.appointments where business_id = p_business_id and id = p_appointment_id for no key update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  select * into d from public.appointment_deposits where business_id = p_business_id and appointment_id = p_appointment_id for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  select * into r from public.appointment_deposit_requirements where business_id = p_business_id and appointment_id = p_appointment_id and is_current for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'DEPOSIT_FORBIDDEN';
  end if;

  v_now := clock_timestamp();
  if a.status not in ('reserved', 'confirmed', 'reschedule_requested') or a.starts_at <= v_now or d.status = 'expired' then
    raise exception 'DEPOSIT_APPOINTMENT_CLOSED';
  end if;
  if d.status <> 'pending' then
    raise exception 'DEPOSIT_NOT_PENDING';
  end if;
  if d.revision is distinct from p_expected_revision then
    raise exception 'DEPOSIT_CHANGED';
  end if;

  if p_credit_id is not null then
    select * into c
    from public.patient_deposit_credits pc
    where pc.business_id = p_business_id
      and pc.patient_id = a.patient_id
      and pc.id = p_credit_id
      and pc.status = 'available'
    for update;
  else
    select * into c
    from public.patient_deposit_credits pc
    where pc.business_id = p_business_id
      and pc.patient_id = a.patient_id
      and pc.status = 'available'
    order by pc.created_at asc, pc.id asc
    limit 1
    for update;
  end if;
  if not found then
    raise exception 'DEPOSIT_CREDIT_UNAVAILABLE';
  end if;

  select coalesce(
    (
      select nullif(btrim(pr.name), '')
      from public.professional_users pu
      join public.professionals pr on pr.business_id = pu.business_id and pr.id = pu.professional_id
      where pu.business_id = p_business_id and pu.user_id = v_actor
      limit 1
    ),
    (select nullif(btrim(u.email), '') from auth.users u where u.id = v_actor),
    'Equipo del consultorio'
  ) into v_actor_name;

  v_diff_amount := d.amount - c.amount;
  v_diff_note := private.deposit_difference_note(c.amount, d.amount, 'credit_applied');

  update public.patient_deposit_credits
  set status = 'applied',
      applied_appointment_id = a.id,
      applied_requirement_id = r.id,
      applied_at = v_now,
      applied_by = v_actor,
      updated_at = v_now
  where id = c.id;

  update public.appointment_deposits
  set status = 'paid',
      waived_reason = null,
      recorded_by = v_actor,
      recorded_at = v_now,
      applied_credit_id = c.id,
      applied_credit_amount = c.amount,
      amount_difference_note = v_diff_note,
      patient_payment_notice_at = null,
      auto_cancel_suppressed_by_payment_notice = false,
      note = coalesce(v_diff_note, 'Cubierta con seña a cuenta de ' || private.format_ars_amount(c.amount) || '.'),
      revision = d.revision + 1,
      updated_at = v_now
  where appointment_id = d.appointment_id
  returning * into d;

  if a.status = 'reserved' then
    update public.appointments
    set status = 'confirmed', confirmed_at = v_now, updated_by_user_id = v_actor, updated_at = v_now
    where id = a.id and business_id = a.business_id
    returning * into a;
  end if;

  insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
  values(
    p_business_id, a.id, r.id, 'credit_applied', c.amount, v_actor,
    jsonb_build_object(
      'credit_id', c.id,
      'source_appointment_id', c.source_appointment_id,
      'target_deposit_amount', d.amount,
      'difference_amount', v_diff_amount,
      'difference_note', v_diff_note
    )
  );

  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(
    p_business_id, v_actor, 'appointment.deposit_credit_applied', 'appointment', a.id,
    jsonb_build_object(
      'credit_id', c.id,
      'credit_amount', c.amount,
      'deposit_amount', d.amount,
      'difference_amount', v_diff_amount,
      'difference_note', v_diff_note,
      'appointment_status', a.status
    )
  );

  insert into public.patient_profile_change_events(
    business_id, patient_id, changed_by_user_id, changed_by_professional_id, changed_by_name, changed_fields, summary
  )
  values(
    p_business_id, a.patient_id, v_actor, null, v_actor_name,
    jsonb_build_array('deposit_credits'),
    coalesce(v_diff_note, 'Aplicó seña a cuenta de ' || private.format_ars_amount(c.amount) || ' a un nuevo turno.')
  );

  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then
    raise exception 'DEPOSIT_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'status', d.status,
    'revision', d.revision,
    'appointment_status', a.status,
    'credit_id', c.id,
    'credit_amount', c.amount,
    'deposit_amount', d.amount,
    'difference_amount', v_diff_amount,
    'difference_note', v_diff_note
  );
end $$;

-- set_appointment_deposit: al marcar paid/waived limpia aviso P1; al hacer «Deshacer» (pending) sobre seña aplicada
-- restituye el crédito a la ficha del paciente y registra quién lo hizo (decisión #4 de Juan).
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
  v_actor uuid := auth.uid();
  v_actor_name text;
  a public.appointments;
  d public.appointment_deposits;
  r public.appointment_deposit_requirements;
  v_now timestamptz := now();
  v_audit text;
  v_patient_exempt boolean := false;
  v_eligible_auto_cancel boolean;
  v_released_credit_id uuid := null;
  v_released_credit_amount bigint := null;
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
        recorded_by = v_actor,
        recorded_at = v_now,
        note = nullif(btrim(p_note), ''),
        patient_payment_notice_at = null,
        auto_cancel_suppressed_by_payment_notice = false,
        revision = d.revision + 1,
        updated_at = v_now
    where ad.appointment_id = d.appointment_id returning * into d;
    if a.status = 'reserved' then
      update public.appointments ap
      set status = 'confirmed', confirmed_at = v_now, updated_by_user_id = v_actor, updated_at = v_now
      where ap.id = a.id and ap.business_id = a.business_id returning * into a;
    end if;
    v_audit := 'appointment.deposit_' || p_action;
  else
    if d.waived_reason = 'policy_disabled' then raise exception 'DEPOSIT_ACTION_INVALID'; end if;
    v_released_credit_id := d.applied_credit_id;
    v_released_credit_amount := d.applied_credit_amount;

    if v_released_credit_id is not null then
      select * into r from public.appointment_deposit_requirements
      where business_id = p_business_id and appointment_id = p_appointment_id and is_current for update;
      perform 1 from public.patient_deposit_credits pc
      where pc.id = v_released_credit_id and pc.business_id = p_business_id for update;
      update public.patient_deposit_credits
      set status = 'available',
          applied_appointment_id = null,
          applied_requirement_id = null,
          applied_at = null,
          applied_by = null,
          last_released_at = v_now,
          last_released_by = v_actor,
          updated_at = v_now
      where id = v_released_credit_id
        and business_id = p_business_id
        and status = 'applied'
        and applied_appointment_id = a.id;
    end if;

    if a.status = 'confirmed' then
      update public.appointments ap
      set status = 'reserved', confirmed_at = null, updated_by_user_id = v_actor, updated_at = v_now
      where ap.id = a.id and ap.business_id = a.business_id returning * into a;
    end if;
    select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
    from public.patients pt where pt.business_id = p_business_id and pt.id = a.patient_id;
    v_eligible_auto_cancel := (d.auto_cancel or d.auto_cancel_suppressed_by_patient_exemption or d.auto_cancel_suppressed_by_payment_notice)
      and (d.due_at - v_now >= make_interval(hours => d.min_payment_hours))
      and (d.late_booking_payment_hours is null or a.starts_at - d.due_at >= interval '24 hours');
    update public.appointment_deposits ad
    set status = 'pending',
        waived_reason = null,
        recorded_by = null,
        recorded_at = null,
        note = null,
        applied_credit_id = null,
        applied_credit_amount = null,
        amount_difference_note = null,
        patient_payment_notice_at = null,
        auto_cancel_suppressed_by_payment_notice = false,
        auto_cancel = v_eligible_auto_cancel and not coalesce(v_patient_exempt, false),
        auto_cancel_suppressed_by_patient_exemption = v_eligible_auto_cancel and coalesce(v_patient_exempt, false),
        revision = d.revision + 1,
        updated_at = v_now
    where ad.appointment_id = d.appointment_id returning * into d;

    if v_released_credit_id is not null then
      if r.id is not null then
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
        values(
          p_business_id, p_appointment_id, r.id, 'credit_released', v_released_credit_amount, v_actor,
          jsonb_build_object('credit_id', v_released_credit_id, 'reason', 'deposit_reopened')
        );
      end if;
      select coalesce(
        (
          select nullif(btrim(pr.name), '')
          from public.professional_users pu
          join public.professionals pr on pr.business_id = pu.business_id and pr.id = pu.professional_id
          where pu.business_id = p_business_id and pu.user_id = v_actor
          limit 1
        ),
        (select nullif(btrim(u.email), '') from auth.users u where u.id = v_actor),
        'Equipo del consultorio'
      ) into v_actor_name;
      insert into public.patient_profile_change_events(
        business_id, patient_id, changed_by_user_id, changed_by_professional_id, changed_by_name, changed_fields, summary
      )
      values(
        p_business_id, a.patient_id, v_actor, null, v_actor_name,
        jsonb_build_array('deposit_credits'),
        'Devolvió a la ficha la seña a cuenta de ' || private.format_ars_amount(v_released_credit_amount) || ' al deshacer el registro de un turno.'
      );
    end if;

    v_audit := 'appointment.deposit_reopened';
  end if;

  insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
  values(
    p_business_id, v_actor, v_audit, 'appointment', p_appointment_id,
    jsonb_build_object(
      'deposit_status', d.status,
      'appointment_status', a.status,
      'amount', d.amount,
      'released_credit_id', v_released_credit_id,
      'released_credit_amount', v_released_credit_amount
    )
  );
  if private.deposit_actor(p_business_id, array['owner', 'admin', 'reception']) is null then raise exception 'DEPOSIT_FORBIDDEN'; end if;
  return query select d.status, d.revision, a.status;
end $$;

-- ============================================================================
-- 8. P4: Reprogramación del paciente (decisión #2: >= corte sin segunda seña y nota de diferencia; 23 claves exactas)
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
  v_p4_active boolean := false;
  v_new_terms jsonb;
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
  select coalesce(sum(coalesce(actual_paid_amount, amount)), 0) into v_credit
  from public.appointment_deposit_requirements
  where business_id = p_business_id and appointment_id = p_appointment_id and patient_id = a.patient_id and status = 'paid' and allocation = 'applied';
  select * into dp from public.deposit_policies where business_id = p_business_id;
  select enabled into v_enabled from private.deposit_automation where singleton;
  select timezone into v_timezone from public.businesses where id = p_business_id;
  select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
  from public.patients pt where pt.business_id = p_business_id and pt.id = a.patient_id;
  v_quote := private.appointment_quote_amount(a.price_quote_snapshot);
  v_p4_active := dp.deposit_credit_cutoff_hours is not null;

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
        v_auto_cancel := not coalesce(v_patient_exempt, false) and d.patient_payment_notice_at is null
          and d.auto_cancel and coalesce(dp.auto_cancel_enabled, false) and coalesce(v_enabled, false);
      end if;
      exit decision;
    end if;
    if not v_has_basis then exit decision; end if;
    if v_reason is not null then v_kind := 'unavailable'; exit decision; end if;
    if v_has_current and d.status = 'pending' then
      v_kind := 'reuse_pending'; v_amount := d.amount; exit decision;
    end if;

    if v_p4_active then
      -- P4 cargado (decisión #2 de Juan): reemplaza previous_deposit_disposition y NO aplica require_deposit_on_reschedule.
      if v_has_current and r.status = 'paid' and r.allocation = 'applied' then
        v_previous := coalesce(r.actual_paid_amount, r.amount);
        if (a.starts_at - p_from) >= make_interval(hours => dp.deposit_credit_cutoff_hours) then
          -- Reprogramación a tiempo (>= corte): la seña pagada cubre el horario nuevo sin pedir una segunda.
          v_disposition := 'credit';
          v_kind := 'none';
          v_amount := null;
        elsif m.terms_acknowledged and dp.enabled is true then
          -- Reprogramación fuera de plazo (< corte): se pierde la seña anterior y se pide nueva si corresponde.
          v_disposition := 'forfeit';
          v_forfeit := v_previous;
          v_credit := greatest(v_credit - v_forfeit, 0);
          v_new_terms := private.deposit_terms(p_business_id, a.service_id, a.source, p_starts_at, p_from, a.price_quote_snapshot);
          if (v_new_terms->>'required')::boolean is true then
            v_base := (v_new_terms->>'amount')::bigint;
            v_amount := v_base;
            if v_quote is not null then v_amount := least(v_base, greatest(v_quote - v_credit, 0))::bigint; end if;
            if v_amount > 0 then v_kind := 'new_requirement'; else v_amount := null; end if;
          end if;
        else
          v_disposition := 'credit';
        end if;
      end if;
    else
      -- Sin corte P4 configurado: comportamiento exactamente igual al anterior.
      if v_has_current and r.status = 'paid' and r.allocation = 'applied' then
        v_previous := coalesce(r.actual_paid_amount, r.amount);
        v_disposition := case
          when m.terms_acknowledged and dp.enabled is true
            and m.previous_deposit_disposition = 'forfeit' and preferences.previous_deposit_disposition = 'forfeit' then 'forfeit'
          else 'credit'
        end;
        if v_disposition = 'forfeit' then v_forfeit := v_previous; v_credit := greatest(v_credit - v_forfeit, 0); end if;
      end if;
      if m.terms_acknowledged and dp.enabled is true then
        if m.require_deposit_on_reschedule and preferences.require_deposit_on_reschedule then
          v_amount := v_base;
          if v_quote is not null then v_amount := least(v_base, greatest(v_quote - v_credit, 0))::bigint; end if;
          if v_amount > 0 then v_kind := 'new_requirement'; else v_amount := null; end if;
        end if;
      end if;
    end if;
  end decision;

  if v_kind in ('reuse_pending', 'new_requirement') then
    if v_p4_active and v_kind = 'new_requirement' and v_new_terms is not null then
      v_request_days := (v_new_terms->>'request_days')::integer;
      v_deadline_hours := (v_new_terms->>'deadline_hours')::integer;
      v_min_payment_hours := (v_new_terms->>'min_payment_hours')::integer;
      v_late_booking_payment_hours := (v_new_terms->>'late_booking_payment_hours')::integer;
    else
      begin
        v_request_days := (basis.terms_snapshot->>'request_days')::integer;
        v_deadline_hours := (basis.terms_snapshot->>'deadline_hours')::integer;
        v_min_payment_hours := (basis.terms_snapshot->>'min_payment_hours')::integer;
        v_late_booking_payment_hours := (basis.terms_snapshot->>'late_booking_payment_hours')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'APPOINTMENT_FINANCIAL_STATE_INVALID';
      end;
    end if;
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
      and (v_kind = 'new_requirement' or d.auto_cancel or d.auto_cancel_suppressed_by_payment_notice);
  end if;

  -- Exactamente las mismas 23 claves JSON para compatibilidad estricta de parser y reversión.
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
  v_keep_paid_under_p4 boolean := false; v_paid_real bigint; v_new_amount bigint; v_diff_note text;
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
    select * into dp from public.deposit_policies where business_id = v_business for share;
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
      if v_teams is distinct from v_locked_teams then raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
      select * into context from public.appointment_booking_contexts where business_id = v_business and appointment_id = a.id;
      if found then
        begin
          select * into integration from public.booking_integrations where business_id = v_business and id = context.integration_id for share nowait;
        exception when lock_not_available then raise exception 'APPOINTMENT_AVAILABILITY_CHANGED'; end;
        if integration.id is null then raise exception 'APPOINTMENT_RESCHEDULE_UNAVAILABLE'; end if;
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
      v_previous_disposition := v_terms->>'previous_payment_disposition';
      v_keep_paid_under_p4 := dp.deposit_credit_cutoff_hours is not null
        and v_has_current and r.status = 'paid' and r.allocation = 'applied'
        and v_kind = 'none' and v_previous_disposition = 'credit';

      if v_kind <> 'reuse_pending' and v_has_current and not v_keep_paid_under_p4 then
        update public.appointment_deposit_requirements set is_current = false,
          allocation = case when v_previous_disposition = 'forfeit' then 'forfeited' else allocation end, updated_at = v_now where id = r.id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, metadata)
        values(v_business, a.id, r.id, case when v_previous_disposition = 'forfeit' then 'payment_forfeited'
          when v_previous_disposition = 'credit' then 'payment_applied' else 'requirement_updated' end,
          case when v_previous_disposition in ('forfeit', 'credit') then coalesce(r.actual_paid_amount, r.amount) else 0 end,
          jsonb_build_object('origin', 'patient', 'operation_id', p_operation_id, 'reason', 'rescheduled', 'closed', true));
        if v_kind <> 'new_requirement' then delete from public.appointment_deposits where business_id = v_business and appointment_id = a.id; end if;
      end if;

      v_status := case when v_kind in ('reuse_pending', 'new_requirement') then 'reserved'
        when v_keep_paid_under_p4 then 'confirmed'
        when a.status = 'confirmed' then 'confirmed' else 'reserved' end;
      update public.appointments set starts_at = p_starts_at, ends_at = v_ends_at, status = v_status,
        confirmed_at = case when v_status = 'confirmed' then coalesce(a.confirmed_at, v_now) end, reschedule_requested_at = null, reminder_due_at = null,
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

      if v_keep_paid_under_p4 then
        v_paid_real := coalesce(r.actual_paid_amount, r.amount);
        v_new_amount := private.resolve_current_deposit_amount(v_business, a.service_id, a.source, a.starts_at, v_now, a.price_quote_snapshot);
        v_diff_note := private.deposit_difference_note(v_paid_real, v_new_amount, 'rescheduled');
        update public.appointment_deposits
        set amount_difference_note = v_diff_note,
            revision = d.revision + 1,
            updated_at = v_now
        where appointment_id = d.appointment_id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, metadata)
        values(
          v_business, a.id, r.id, 'payment_applied', v_paid_real,
          jsonb_build_object(
            'origin', 'patient', 'operation_id', p_operation_id, 'reason', 'rescheduled_in_time',
            'cutoff_hours', dp.deposit_credit_cutoff_hours, 'new_deposit_amount', v_new_amount, 'difference_note', v_diff_note
          )
        );
      elsif v_kind = 'new_requirement' then
        select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
        from public.patients pt where pt.business_id = v_business and pt.id = a.patient_id;
        v_late_hours := case when dp.deposit_credit_cutoff_hours is not null then dp.late_booking_payment_hours else (basis.terms_snapshot->>'late_booking_payment_hours')::integer end;
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
          policy_revision, request_from, due_at, auto_cancel, auto_cancel_suppressed_by_patient_exemption,
          patient_payment_notice_at, auto_cancel_suppressed_by_payment_notice,
          applied_credit_id, applied_credit_amount, amount_difference_note, revision
        )
        values(
          v_business, a.id, 'pending', (v_terms->>'amount')::bigint, 'ARS', (basis.terms_snapshot->>'percentage')::numeric,
          (basis.terms_snapshot->>'reference_amount')::bigint, (v_terms->>'request_days')::integer, (v_terms->>'deadline_hours')::integer,
          (v_terms->>'min_payment_hours')::integer, v_late_hours, (basis.terms_snapshot->>'policy_revision')::bigint,
          (v_terms->>'request_from')::timestamptz, (v_terms->>'due_at')::timestamptz, (v_terms->>'auto_cancel')::boolean,
          v_suppressed_by_exemption, null, false, null, null, null, v_projection_revision
        )
        on conflict(appointment_id) do update set
          status = 'pending', amount = excluded.amount, percentage = excluded.percentage, reference_amount = excluded.reference_amount,
          request_days = excluded.request_days, deadline_hours = excluded.deadline_hours, min_payment_hours = excluded.min_payment_hours,
          late_booking_payment_hours = excluded.late_booking_payment_hours, policy_revision = excluded.policy_revision,
          request_from = excluded.request_from, due_at = excluded.due_at, auto_cancel = excluded.auto_cancel,
          auto_cancel_suppressed_by_patient_exemption = excluded.auto_cancel_suppressed_by_patient_exemption,
          patient_payment_notice_at = null, auto_cancel_suppressed_by_payment_notice = false,
          applied_credit_id = null, applied_credit_amount = null, amount_difference_note = null,
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

-- ============================================================================
-- 9. P4: Gestión del personal (decisiones #1 y #2 de Juan + fuerza mayor al cancelar)
-- ============================================================================

create or replace function private.apply_staff_appointment_management_core(
  p_business_id uuid,
  p_actor_id uuid,
  p_appointment_id uuid,
  p_operation_id uuid,
  p_expected_revision text,
  p_action text,
  p_starts_at timestamptz,
  p_ignore_break boolean,
  p_availability_revision bigint,
  p_reason text,
  p_replay_only boolean,
  p_keep_deposit_as_credit boolean,
  p_reschedule_requester text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  a public.appointments;
  before_a public.appointments;
  b public.businesses;
  s public.services;
  dp public.deposit_policies;
  d public.appointment_deposits;
  r public.appointment_deposit_requirements;
  prior private.appointment_management_operations;
  m public.appointment_management_states;
  v_fingerprint text;
  v_result jsonb;
  v_now timestamptz;
  v_teams uuid[];
  v_locked_teams uuid[];
  v_professional uuid;
  v_deposit_status text;
  v_status text;
  v_changed boolean := true;
  v_action text;
  v_revision bigint;
  v_keep_credit boolean := coalesce(p_keep_deposit_as_credit, false);
  v_p4_paid boolean := false;
  v_in_time boolean := true;
  v_paid_real bigint;
  v_new_amount bigint;
  v_diff_note text;
  v_new_terms jsonb;
  v_new_req_id uuid;
  v_proj_rev bigint;
  v_patient_exempt boolean := false;
  v_policy_auto_cancel boolean;
  v_eff_auto_cancel boolean;
  v_suppressed_by_exemption boolean;
  v_forfeited_on_reschedule boolean := false;
  v_new_deposit_required boolean := false;
begin
  if p_business_id is null or p_actor_id is null or p_appointment_id is null or p_operation_id is null
    or not coalesce(p_expected_revision ~ '^[0-9a-f]{64}$', false)
    or not coalesce(p_action in ('cancel', 'confirm', 'request_reschedule', 'reschedule'), false)
    or p_ignore_break is null or p_replay_only is null then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'APPOINTMENT_REASON_INVALID'; end if;
  if p_action <> 'reschedule' and (p_starts_at is not null or p_availability_revision is not null or p_ignore_break or p_reschedule_requester is not null) then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED';
  end if;
  if p_action <> 'cancel' and v_keep_credit then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED';
  end if;
  if p_reschedule_requester is not null and p_reschedule_requester not in ('patient', 'practice_or_force_majeure') then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED';
  end if;
  if p_action = 'reschedule' and (p_starts_at is null or not isfinite(p_starts_at) or p_reason is not null) then
    raise exception 'APPOINTMENT_RESCHEDULE_TIME_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('appointment-management-operation:' || p_business_id::text || ':' || p_operation_id::text, 0));
  if p_action = 'reschedule' and not p_replay_only then
    select * into b from public.businesses where id = p_business_id for share;
    select * into dp from public.deposit_policies where business_id = p_business_id for share;
  elsif p_action = 'cancel' and not p_replay_only then
    select * into dp from public.deposit_policies where business_id = p_business_id for share;
  end if;
  if private.business_operation_actor(p_business_id, array['owner', 'admin', 'reception'], p_actor_id) is null then
    raise exception 'APPOINTMENT_MANAGEMENT_FORBIDDEN';
  end if;
  if p_action = 'reschedule' and not p_replay_only then
    select array_agg(professional_id order by professional_id) into v_teams from public.appointment_professionals
      where business_id = p_business_id and appointment_id = p_appointment_id;
    for v_professional in select unnest(v_teams) loop
      perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || v_professional::text, 0));
    end loop;
  end if;

  select * into a from public.appointments where business_id = p_business_id and id = p_appointment_id for no key update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if private.business_operation_actor(p_business_id, array['owner', 'admin', 'reception'], p_actor_id) is null then
    raise exception 'APPOINTMENT_MANAGEMENT_FORBIDDEN';
  end if;
  select * into m from public.appointment_management_states where business_id = p_business_id and appointment_id = a.id;
  if not found then raise exception 'APPOINTMENT_MANAGEMENT_CHANGED'; end if;

  if not v_keep_credit and p_reschedule_requester is null then
    v_fingerprint := encode(extensions.digest(jsonb_build_object(
      'contract', 'staff-agenda-1', 'actor_id', p_actor_id,
      'appointment_id', a.id, 'patient_id', a.patient_id, 'generation', m.generation, 'action', p_action,
      'expected_revision', p_expected_revision, 'starts_at', extract(epoch from p_starts_at), 'ignore_break', p_ignore_break,
      'availability_revision', p_availability_revision, 'reason', p_reason
    )::text, 'sha256'), 'hex');
  else
    v_fingerprint := encode(extensions.digest(jsonb_build_object(
      'contract', 'staff-agenda-2b', 'actor_id', p_actor_id,
      'appointment_id', a.id, 'patient_id', a.patient_id, 'generation', m.generation, 'action', p_action,
      'expected_revision', p_expected_revision, 'starts_at', extract(epoch from p_starts_at), 'ignore_break', p_ignore_break,
      'availability_revision', p_availability_revision, 'reason', p_reason,
      'keep_deposit_as_credit', v_keep_credit, 'reschedule_requester', p_reschedule_requester
    )::text, 'sha256'), 'hex');
  end if;

  select * into prior from private.appointment_management_operations where business_id = p_business_id and operation_id = p_operation_id;
  if found then
    if prior.appointment_id is distinct from a.id or prior.actor_id is distinct from p_actor_id or prior.origin <> 'staff'
      or prior.action is distinct from p_action or prior.request_fingerprint is distinct from v_fingerprint then
      raise exception 'APPOINTMENT_OPERATION_CONFLICT';
    end if;
    return prior.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if p_replay_only then return null; end if;
  if private.appointment_semantic_revision(p_business_id, a.id) is distinct from p_expected_revision then
    raise exception 'APPOINTMENT_MANAGEMENT_CHANGED';
  end if;

  v_now := clock_timestamp();
  before_a := a;
  if a.status not in ('reserved', 'confirmed', 'reschedule_requested') then raise exception 'APPOINTMENT_TERMINAL_STATUS'; end if;
  if p_action = 'cancel' and a.starts_at <= v_now then raise exception 'APPOINTMENT_ALREADY_STARTED'; end if;

  if p_action = 'reschedule' then
    if p_starts_at = a.starts_at then
      v_changed := false;
    else
      if p_starts_at <= v_now then raise exception 'APPOINTMENT_RESCHEDULE_TIME_INVALID'; end if;
      if p_availability_revision is null or p_availability_revision is distinct from b.booking_availability_revision then
        raise exception 'APPOINTMENT_AVAILABILITY_CHANGED';
      end if;
      select array_agg(professional_id order by professional_id) into v_locked_teams from public.appointment_professionals
        where business_id = p_business_id and appointment_id = a.id;
      if v_teams is distinct from v_locked_teams then raise exception 'APPOINTMENT_MANAGEMENT_CHANGED'; end if;
      select * into s from public.services where business_id = p_business_id and id = a.service_id and is_active;
      if not found then raise exception 'SERVICE_NOT_FOUND'; end if;

      select * into d from public.appointment_deposits where business_id = p_business_id and appointment_id = a.id for update;
      v_deposit_status := d.status;
      select * into r from public.appointment_deposit_requirements
      where business_id = p_business_id and appointment_id = a.id and is_current for update;

      v_p4_paid := dp.deposit_credit_cutoff_hours is not null and d.appointment_id is not null
        and d.status = 'paid' and r.id is not null and r.status = 'paid' and r.allocation = 'applied';

      if v_p4_paid then
        v_paid_real := coalesce(r.actual_paid_amount, r.amount);
        v_in_time := (a.starts_at > v_now) and ((a.starts_at - v_now) >= make_interval(hours => dp.deposit_credit_cutoff_hours));
        -- Decisión #1 de Juan: con menos horas que el corte o turno pasado, pregunta obligatoria sin opción marcada.
        if not v_in_time and p_reschedule_requester is null then
          raise exception 'APPOINTMENT_RESCHEDULE_REQUESTER_REQUIRED';
        end if;
        if not v_in_time and p_reschedule_requester = 'patient' then
          v_forfeited_on_reschedule := true;
          v_status := 'reserved';
        else
          v_status := 'confirmed';
        end if;
      else
        v_status := case when v_deposit_status in ('paid', 'waived') then 'confirmed' else 'reserved' end;
      end if;

      if v_forfeited_on_reschedule then
        update public.appointment_deposit_requirements
        set is_current = false, allocation = 'forfeited', updated_at = v_now
        where id = r.id;
        insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
        values(
          p_business_id, a.id, r.id, 'payment_forfeited', v_paid_real, p_actor_id,
          jsonb_build_object(
            'origin', 'staff', 'operation_id', p_operation_id, 'reason', 'rescheduled_late_by_patient',
            'reschedule_requester', 'patient', 'cutoff_hours', dp.deposit_credit_cutoff_hours, 'closed', true
          )
        );
      end if;

      update public.appointments
      set starts_at = p_starts_at,
          ends_at = p_starts_at + make_interval(mins => s.duration_minutes),
          status = v_status,
          confirmed_at = case when v_status = 'confirmed' then coalesce(a.confirmed_at, v_now) else null end,
          reschedule_requested_at = null,
          reminder_due_at = null,
          calendar_sequence = a.calendar_sequence + 1,
          calendar_update_required_at = case when a.calendar_action_count > 0 then v_now end,
          ignore_break = p_ignore_break,
          updated_by_user_id = p_actor_id,
          updated_at = v_now
      where business_id = p_business_id and id = a.id
      returning * into a;

      if v_p4_paid then
        if v_forfeited_on_reschedule then
          v_new_terms := private.deposit_terms(p_business_id, a.service_id, a.source, a.starts_at, v_now, a.price_quote_snapshot);
          v_new_deposit_required := (v_new_terms->>'required')::boolean is true;
          if v_new_deposit_required then
            select coalesce(pt.exempt_from_deposit_auto_cancel, false) into v_patient_exempt
            from public.patients pt where pt.business_id = p_business_id and pt.id = a.patient_id;
            v_policy_auto_cancel := coalesce((v_new_terms->>'auto_cancel')::boolean, false);
            v_eff_auto_cancel := v_policy_auto_cancel and not coalesce(v_patient_exempt, false);
            v_suppressed_by_exemption := v_policy_auto_cancel and coalesce(v_patient_exempt, false);
            select coalesce(max(projection_revision), 0) + 1 into v_proj_rev
            from public.appointment_deposit_requirements where business_id = p_business_id and appointment_id = a.id;

            insert into public.appointment_deposit_requirements(
              business_id, appointment_id, patient_id, status, amount, base_amount, allocation, terms_snapshot, projection_revision
            )
            values(
              p_business_id, a.id, a.patient_id, 'pending', (v_new_terms->>'amount')::bigint, (v_new_terms->>'amount')::bigint, 'none',
              jsonb_build_object(
                'percentage', (v_new_terms->>'percentage')::numeric,
                'reference_amount', (v_new_terms->>'reference_amount')::bigint,
                'request_days', (v_new_terms->>'request_days')::integer,
                'deadline_hours', (v_new_terms->>'deadline_hours')::integer,
                'min_payment_hours', (v_new_terms->>'min_payment_hours')::integer,
                'late_booking_payment_hours', (v_new_terms->>'late_booking_payment_hours')::integer,
                'policy_revision', (v_new_terms->>'policy_revision')::bigint,
                'request_from', (v_new_terms->>'request_from')::timestamptz,
                'due_at', (v_new_terms->>'due_at')::timestamptz,
                'auto_cancel', v_eff_auto_cancel,
                'waived_reason', null
              ),
              v_proj_rev
            ) returning id into v_new_req_id;

            insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, actor_id, metadata)
            values(p_business_id, a.id, v_new_req_id, 'requirement_created', p_actor_id,
              jsonb_build_object('origin', 'staff', 'operation_id', p_operation_id, 'reschedule_requester', 'patient'));

            insert into public.appointment_deposits(
              business_id, appointment_id, status, amount, currency, percentage, reference_amount,
              request_days, deadline_hours, min_payment_hours, late_booking_payment_hours,
              policy_revision, request_from, due_at, auto_cancel, auto_cancel_suppressed_by_patient_exemption,
              patient_payment_notice_at, auto_cancel_suppressed_by_payment_notice,
              applied_credit_id, applied_credit_amount, amount_difference_note, revision
            )
            values(
              p_business_id, a.id, 'pending', (v_new_terms->>'amount')::bigint, 'ARS',
              (v_new_terms->>'percentage')::numeric, (v_new_terms->>'reference_amount')::bigint,
              (v_new_terms->>'request_days')::integer, (v_new_terms->>'deadline_hours')::integer,
              (v_new_terms->>'min_payment_hours')::integer, (v_new_terms->>'late_booking_payment_hours')::integer,
              (v_new_terms->>'policy_revision')::bigint, (v_new_terms->>'request_from')::timestamptz,
              (v_new_terms->>'due_at')::timestamptz, v_eff_auto_cancel, v_suppressed_by_exemption,
              null, false, null, null, null, v_proj_rev
            )
            on conflict(appointment_id) do update set
              status = 'pending', amount = excluded.amount, percentage = excluded.percentage, reference_amount = excluded.reference_amount,
              request_days = excluded.request_days, deadline_hours = excluded.deadline_hours, min_payment_hours = excluded.min_payment_hours,
              late_booking_payment_hours = excluded.late_booking_payment_hours, policy_revision = excluded.policy_revision,
              request_from = excluded.request_from, due_at = excluded.due_at, auto_cancel = excluded.auto_cancel,
              auto_cancel_suppressed_by_patient_exemption = excluded.auto_cancel_suppressed_by_patient_exemption,
              patient_payment_notice_at = null, auto_cancel_suppressed_by_payment_notice = false,
              applied_credit_id = null, applied_credit_amount = null, amount_difference_note = null,
              revision = excluded.revision, waived_reason = null, note = null, recorded_by = null, recorded_at = null,
              reminder_opened_at = null, reminder_opened_by = null, expired_at = null, updated_at = v_now;
          else
            delete from public.appointment_deposits where business_id = p_business_id and appointment_id = a.id;
          end if;
        else
          -- Reprogramación >= corte o por «El consultorio o fuerza mayor»: cubre sin segunda seña y guarda nota si cambió el monto.
          v_new_amount := private.resolve_current_deposit_amount(p_business_id, a.service_id, a.source, a.starts_at, v_now, a.price_quote_snapshot);
          v_diff_note := private.deposit_difference_note(v_paid_real, v_new_amount, 'rescheduled');
          update public.appointment_deposits
          set amount_difference_note = v_diff_note,
              revision = d.revision + 1,
              updated_at = v_now
          where appointment_id = d.appointment_id;
          insert into public.appointment_deposit_events(business_id, appointment_id, requirement_id, event_type, amount, actor_id, metadata)
          values(
            p_business_id, a.id, r.id, 'payment_applied', v_paid_real, p_actor_id,
            jsonb_build_object(
              'origin', 'staff',
              'operation_id', p_operation_id,
              'reason', case when v_in_time then 'rescheduled_in_time' else 'rescheduled_practice_or_force_majeure' end,
              'reschedule_requester', p_reschedule_requester,
              'cutoff_hours', dp.deposit_credit_cutoff_hours,
              'new_deposit_amount', v_new_amount,
              'difference_note', v_diff_note
            )
          );
        end if;
      end if;
      v_action := 'appointment.rescheduled';
    end if;
  else
    v_status := case p_action when 'cancel' then 'cancelled' when 'confirm' then 'confirmed' else 'reschedule_requested' end;
    if a.status = v_status then raise exception 'APPOINTMENT_STATUS_UNCHANGED'; end if;
    if (p_action = 'confirm' and a.status <> 'reserved') or (p_action = 'request_reschedule' and a.status = 'reschedule_requested') then
      raise exception 'APPOINTMENT_INVALID_TRANSITION';
    end if;
    if p_action = 'cancel' and v_keep_credit then
      perform set_config('cita.cancel_keep_deposit_credit', a.id::text, true);
    end if;
    update public.appointments
    set status = v_status,
        confirmed_at = case when p_action = 'confirm' then v_now else a.confirmed_at end,
        cancelled_at = case when p_action = 'cancel' then v_now else a.cancelled_at end,
        cancelled_by_user_id = case when p_action = 'cancel' then p_actor_id else a.cancelled_by_user_id end,
        cancelled_reason = case when p_action = 'cancel' then p_reason else a.cancelled_reason end,
        reschedule_requested_at = case when p_action = 'request_reschedule' then v_now else a.reschedule_requested_at end,
        calendar_sequence = a.calendar_sequence + case when p_action = 'cancel' then 1 else 0 end,
        calendar_update_required_at = case when p_action = 'cancel' and a.calendar_action_count > 0 then v_now else a.calendar_update_required_at end,
        updated_by_user_id = p_actor_id,
        updated_at = v_now
    where business_id = p_business_id and id = a.id
    returning * into a;
    if p_action = 'cancel' and v_keep_credit then
      perform set_config('cita.cancel_keep_deposit_credit', '', true);
    end if;
    v_action := 'appointment.' || v_status;
  end if;

  if v_changed then
    insert into public.audit_logs(business_id, user_id, action, entity_type, entity_id, metadata)
    values(
      p_business_id, p_actor_id, v_action, 'appointment', a.id,
      jsonb_build_object(
        'origin', 'staff', 'operation_id', p_operation_id,
        'from_status', before_a.status, 'to_status', a.status,
        'from_starts_at', before_a.starts_at, 'from_ends_at', before_a.ends_at,
        'to_starts_at', a.starts_at, 'to_ends_at', a.ends_at,
        'reason', p_reason, 'ignore_break', a.ignore_break,
        'calendar_update_required', a.calendar_update_required_at is not null
      )
      || case when p_action = 'cancel' and v_keep_credit then jsonb_build_object('keep_deposit_as_credit', true) else '{}'::jsonb end
      || case when p_reschedule_requester is not null then jsonb_build_object(
          'reschedule_requester', p_reschedule_requester,
          'previous_deposit_forfeited', v_forfeited_on_reschedule,
          'new_deposit_required', v_new_deposit_required
        ) else '{}'::jsonb end
    );
  end if;

  if private.business_operation_actor(p_business_id, array['owner', 'admin', 'reception'], p_actor_id) is null then
    raise exception 'APPOINTMENT_MANAGEMENT_FORBIDDEN';
  end if;
  select schedule_revision into v_revision from public.appointment_management_states where business_id = p_business_id and appointment_id = a.id;
  v_result := jsonb_build_object(
    'appointment_id', a.id, 'status', a.status, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
    'changed', v_changed, 'schedule_revision', v_revision,
    'revision', private.appointment_semantic_revision(p_business_id, a.id), 'idempotent_replay', false
  );
  insert into private.appointment_management_operations(business_id, operation_id, appointment_id, actor_id, origin, action, request_fingerprint, result)
  values(p_business_id, p_operation_id, a.id, p_actor_id, 'staff', p_action, v_fingerprint, v_result);
  return v_result;
end $$;

-- Conserva intacta la firma de 11 parámetros para pruebas existentes y vuelta atrás del Worker Lote 2A
create or replace function public.apply_staff_appointment_management(
  p_business_id uuid, p_actor_id uuid, p_appointment_id uuid,
  p_operation_id uuid, p_expected_revision text, p_action text, p_starts_at timestamptz default null,
  p_ignore_break boolean default false, p_availability_revision bigint default null, p_reason text default null,
  p_replay_only boolean default false
) returns jsonb
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select private.apply_staff_appointment_management_core(
    p_business_id, p_actor_id, p_appointment_id, p_operation_id, p_expected_revision, p_action,
    p_starts_at, p_ignore_break, p_availability_revision, p_reason, p_replay_only, false, null
  )
$$;

-- Comando de 13 parámetros con las decisiones de seña de P4 (fuerza mayor al cancelar / quién pidió reprogramar)
create or replace function public.apply_staff_appointment_management_with_deposit_decision(
  p_business_id uuid, p_actor_id uuid, p_appointment_id uuid,
  p_operation_id uuid, p_expected_revision text, p_action text, p_starts_at timestamptz default null,
  p_ignore_break boolean default false, p_availability_revision bigint default null, p_reason text default null,
  p_replay_only boolean default false, p_keep_deposit_as_credit boolean default false, p_reschedule_requester text default null
) returns jsonb
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select private.apply_staff_appointment_management_core(
    p_business_id, p_actor_id, p_appointment_id, p_operation_id, p_expected_revision, p_action,
    p_starts_at, p_ignore_break, p_availability_revision, p_reason, p_replay_only,
    coalesce(p_keep_deposit_as_credit, false), p_reschedule_requester
  )
$$;

-- ============================================================================
-- 10. Snapshot del turno (expone aviso de pago P1, corte P4 y resultado de cancelación P4)
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
  ep public.appointment_email_policies;
  c public.appointment_booking_contexts;
  i public.booking_integrations;
  v_scope jsonb;
  v_terms jsonb;
  v_deposit jsonb;
  v_financial_summary jsonb;
  v_cancel_outcome jsonb := null;
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
    and d.auto_cancel and d.patient_payment_notice_at is null and not coalesce(v_patient_exempt, false)
    and dp.enabled and dp.auto_cancel_enabled
    and v_operable and p_now < d.due_at + interval '24 hours'
    and coalesce((select enabled from private.deposit_automation where singleton), false);

  if d.appointment_id is not null then
    v_deposit := jsonb_build_object(
      'appointment_id', d.appointment_id, 'status', d.status, 'amount', d.amount, 'currency', d.currency,
      'request_from', d.request_from, 'due_at', d.due_at, 'auto_cancel', coalesce(v_auto_cancel, false),
      'waived_reason', d.waived_reason, 'recorded_at', d.recorded_at, 'reminder_opened_at', d.reminder_opened_at,
      'expired_at', d.expired_at, 'revision', d.revision,
      'patient_payment_notice_at', d.patient_payment_notice_at,
      'applied_credit_id', d.applied_credit_id,
      'applied_credit_amount', d.applied_credit_amount,
      'amount_difference_note', d.amount_difference_note
    );
  end if;

  if a.status = 'cancelled' then
    select jsonb_build_object(
      'outcome', case when e.event_type = 'payment_credited' then 'credit' else 'forfeit' end,
      'amount', e.amount::text,
      'reason', e.metadata->>'reason',
      'cutoff_hours', (e.metadata->>'cutoff_hours')::integer
    )
    into v_cancel_outcome
    from public.appointment_deposit_events e
    where e.business_id = p_business_id
      and e.appointment_id = p_appointment_id
      and e.event_type in ('payment_credited', 'payment_forfeited')
      and e.metadata->>'reason' in ('cancelled_in_time', 'force_majeure', 'cancelled_late')
    order by e.ordinal desc
    limit 1;
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
    'deposit_credit_cutoff_hours', dp.deposit_credit_cutoff_hours,
    'cancellation_deposit_outcome', v_cancel_outcome,
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
-- 11. P1: Planificador y despacho de correos (7º propósito: deposit_expiring_reminder)
-- ============================================================================

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
  where r.is_current and r.status = 'pending' and d.status = 'pending' and d.patient_payment_notice_at is null
    and v_enabled_at is not null and r.created_at >= v_enabled_at
    and private.email_sender_ready(a.business_id)
    and a.status in ('reserved', 'confirmed', 'reschedule_requested') and a.starts_at > p_now and d.due_at > p_now
    and not exists(select 1 from private.appointment_email_deliveries x
      where (x.business_id, x.appointment_id) = (a.business_id, a.id) and x.schedule_revision = m.schedule_revision
        and x.purpose in ('booking_receipt', 'reschedule_receipt') and x.state <> 'discarded')
  on conflict(business_id, appointment_id, dedupe_key) do nothing;

  -- P1: aviso de seña por vencer (24h o 48h antes de due_at; dedupe único por r.id + schedule_revision)
  insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, due_at, expires_at)
  select
    a.business_id,
    a.id,
    'deposit_expiring_reminder',
    'deposit_expiring_reminder:' || r.id || ':' || m.schedule_revision,
    m.schedule_revision,
    d.due_at - make_interval(hours => dp.expiring_reminder_hours),
    least(d.due_at, a.starts_at)
  from public.appointment_deposit_requirements r
  join public.appointment_deposits d on (d.business_id, d.appointment_id) = (r.business_id, r.appointment_id)
  join public.deposit_policies dp on dp.business_id = r.business_id
  join public.appointments a on (a.business_id, a.id) = (r.business_id, r.appointment_id)
  join public.appointment_management_states m on (m.business_id, m.appointment_id) = (a.business_id, a.id)
  where r.is_current
    and r.status = 'pending'
    and d.status = 'pending'
    and d.patient_payment_notice_at is null
    and dp.expiring_reminder_hours is not null
    and v_enabled_at is not null
    and r.created_at >= v_enabled_at
    and private.email_sender_ready(a.business_id)
    and a.status in ('reserved', 'confirmed', 'reschedule_requested')
    and a.starts_at > p_now
    and d.due_at > p_now
    and greatest(r.created_at, m.schedule_changed_at) < d.due_at - make_interval(hours => dp.expiring_reminder_hours)
    and p_now >= d.due_at - make_interval(hours => dp.expiring_reminder_hours)
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
  dp public.deposit_policies;
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
  v_effective_due timestamptz;
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
    order by case when x.purpose in ('booking_receipt', 'reschedule_receipt', 'cancellation_receipt') then 0
      when x.purpose in ('deposit_request', 'deposit_expiring_reminder') then 1 else 2 end, x.due_at, x.id
    limit p_limit * 3 for update of x skip locked loop
    exit when v_taken >= p_limit or v_budget <= 0;
    select * into a from public.appointments where business_id = d.business_id and id = d.appointment_id for no key update skip locked;
    continue when not found;
    select * into m from public.appointment_management_states where business_id = d.business_id and appointment_id = d.appointment_id;
    select * into pol from public.appointment_email_policies where business_id = d.business_id;
    select * into dp from public.deposit_policies where business_id = d.business_id;
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

    if d.purpose in ('deposit_request', 'deposit_expiring_reminder') then
      if dep.appointment_id is null or dep.status <> 'pending' then
        perform private.discard_appointment_email(d.id, 'deposit_not_pending'); v_discarded := v_discarded + 1; continue;
      end if;
      if dep.patient_payment_notice_at is not null then
        perform private.discard_appointment_email(d.id, 'payment_notice_registered'); v_discarded := v_discarded + 1; continue;
      end if;
    end if;

    if d.purpose = 'deposit_expiring_reminder' then
      -- Configuración leída al momento de enviar (P1).
      if dp.business_id is null or dp.expiring_reminder_hours is null then
        perform private.discard_appointment_email(d.id, 'deposit_reminder_disabled'); v_discarded := v_discarded + 1; continue;
      end if;
      if dep.due_at <= v_now then
        perform private.discard_appointment_email(d.id, 'expired'); v_discarded := v_discarded + 1; continue;
      end if;
      v_effective_due := dep.due_at - make_interval(hours => dp.expiring_reminder_hours);
      if v_now < v_effective_due then
        update private.appointment_email_deliveries
        set due_at = v_effective_due, next_attempt_at = v_effective_due
        where id = d.id;
        continue;
      end if;
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

-- ============================================================================
-- 12. Privilegios explícitos (ninguna función privada expuesta)
-- ============================================================================

revoke all on function
  private.format_ars_amount(bigint),
  private.deposit_difference_note(bigint, bigint, text),
  private.resolve_current_deposit_amount(uuid, uuid, text, timestamptz, timestamptz, jsonb),
  private.merge_patient_deposit_credits(uuid, uuid, uuid),
  private.appointment_deposit_summary(uuid, uuid, uuid),
  private.synchronize_deposit_requirement(),
  private.reschedule_appointment_deposit(),
  private.track_appointment_management_state(),
  private.appointment_semantic_revision(uuid, uuid),
  private.expire_deposit_if_still_due(uuid, timestamptz),
  private.expire_unpaid_deposits(timestamptz, integer),
  private.appointment_reschedule_financial_terms(uuid, uuid, timestamptz, timestamptz),
  private.appointment_management_snapshot(uuid, uuid, timestamptz, timestamptz),
  private.apply_staff_appointment_management_core(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, bigint, text, boolean, boolean, text),
  private.plan_appointment_email_work(timestamptz, integer)
from public, anon, authenticated, service_role;

revoke all on function
  public.save_deposit_policy(uuid, jsonb, bigint),
  public.set_appointment_deposit(uuid, uuid, text, bigint, text),
  public.set_patient_deposit_auto_cancel_exemption(uuid, uuid, boolean),
  public.clear_appointment_deposit_payment_notice(uuid, uuid, bigint),
  public.apply_patient_deposit_credit(uuid, uuid, bigint, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.save_deposit_policy(uuid, jsonb, bigint),
  public.set_appointment_deposit(uuid, uuid, text, bigint, text),
  public.set_patient_deposit_auto_cancel_exemption(uuid, uuid, boolean),
  public.clear_appointment_deposit_payment_notice(uuid, uuid, bigint),
  public.apply_patient_deposit_credit(uuid, uuid, bigint, uuid)
to authenticated;

revoke all on function
  public.patient_available_deposit_credits(public.patients)
from public, anon, authenticated, service_role;

grant execute on function
  public.patient_available_deposit_credits(public.patients)
to authenticated, service_role;

revoke all on function
  public.consume_server_rate_limits(text, text, jsonb),
  public.report_appointment_deposit_payment(text, boolean),
  public.apply_patient_appointment_management(text, boolean, uuid, text, text, timestamptz, bigint, jsonb, bigint),
  public.apply_staff_appointment_management(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, bigint, text, boolean),
  public.apply_staff_appointment_management_with_deposit_decision(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, bigint, text, boolean, boolean, text),
  public.claim_appointment_email_batch(integer, timestamptz)
from public, anon, authenticated, service_role;

grant execute on function
  public.consume_server_rate_limits(text, text, jsonb),
  public.report_appointment_deposit_payment(text, boolean),
  public.apply_patient_appointment_management(text, boolean, uuid, text, text, timestamptz, bigint, jsonb, bigint),
  public.apply_staff_appointment_management(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, bigint, text, boolean),
  public.apply_staff_appointment_management_with_deposit_decision(uuid, uuid, uuid, uuid, text, text, timestamptz, boolean, bigint, text, boolean, boolean, text),
  public.claim_appointment_email_batch(integer, timestamptz)
to service_role;

notify pgrst, 'reload schema';
commit;
