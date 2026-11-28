-- Pruebas pgTAP del Lote 2B de la entrega a Natalia:
--  P1: aviso de seña por vencer (deposit_expiring_reminder, 24h/48h/Desactivado, lectura al enviar,
--      un solo envío por seña aunque cambie configuración, descartes, P3, reprogramación, ya pasó la hora,
--      sin correo/baja/remitente) + registro de «Ya transferí» (bloqueo de cancelación automática,
--      primer aviso preservado, rate limit, «No llegó el pago» con permisos de 5 roles y retorno a circuito)
--  P4: seña a cuenta al reprogramar o cancelar (bordes 48h/47h59m, reprogramación paciente y personal,
--      decisiones de Juan #1–#4: pregunta obligatoria «¿Quién pidió el cambio?», sin segunda seña >= 48h
--      con nota de diferencia, monto real pagado al re-cancelar, «Deshacer» restituye crédito con auditoría
--      e invariante de unicidad, fuerza mayor, ausencia sin aviso, auto-cancelación sin crédito, múltiples
--      créditos, pacientes unificados y permisos de 5 roles).
begin;
select extensions.plan(49);

create function pg_temp.l2b_id(p_key text) returns uuid language sql immutable as $$
  select ('2b000000-0000-4000-8000-' || lpad(abs(hashtext(p_key))::bigint::text, 12, '0'))::uuid
$$;

create function pg_temp.as_role(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v_res;
  execute 'reset role';
  return v_res;
exception when others then
  execute 'reset role';
  raise;
end $$;

create function pg_temp.book_turn(
  p_biz uuid,
  p_pat uuid,
  p_svc uuid,
  p_prof uuid,
  p_starts timestamptz,
  p_source text default 'manual',
  p_ack_terms boolean default true
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.appointments(
    id, business_id, patient_id, service_id, professional_id,
    starts_at, ends_at, blocking_starts_at, blocking_ends_at,
    status, source, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
  )
  values(
    v_id, p_biz, p_pat, p_svc, p_prof,
    p_starts, p_starts + interval '30 minutes', p_starts, p_starts + interval '30 minutes',
    'reserved', p_source, 'Consulta general', 'Prof L2B', 30
  );
  if p_ack_terms then
    update public.appointment_management_states
    set terms_acknowledged = true,
        require_deposit_on_reschedule = true,
        previous_deposit_disposition = 'forfeit',
        accepted_at = clock_timestamp(),
        accepted_policy_revision = 1
    where business_id = p_biz and appointment_id = v_id;
  end if;
  return v_id;
end $$;

-- ============================================================================
-- Fixture aislado: consultorio principal (5 roles) + segundo consultorio ajeno
-- ============================================================================
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_other_biz uuid := pg_temp.l2b_id('other_biz');
  v_owner uuid := pg_temp.l2b_id('owner');
  v_admin uuid := pg_temp.l2b_id('admin');
  v_recep uuid := pg_temp.l2b_id('reception');
  v_prof_u uuid := pg_temp.l2b_id('professional');
  v_ro uuid := pg_temp.l2b_id('readonly');
  v_outsider uuid := pg_temp.l2b_id('outsider');
  v_svc uuid := pg_temp.l2b_id('service');
  v_prof1 uuid := pg_temp.l2b_id('prof1');
  v_prof2 uuid := pg_temp.l2b_id('prof2');
  v_pat1 uuid := pg_temp.l2b_id('pat1');
  v_pat2 uuid := pg_temp.l2b_id('pat2');
  v_pat_no_email uuid := pg_temp.l2b_id('pat_no_email');
  v_pat_exempt uuid := pg_temp.l2b_id('pat_exempt');
  v_pat_merge_dst uuid := pg_temp.l2b_id('pat_merge_dst');
begin
  insert into auth.users(id, email) values
    (v_owner, 'owner-l2b@cita-suite.test'),
    (v_admin, 'admin-l2b@cita-suite.test'),
    (v_recep, 'recep-l2b@cita-suite.test'),
    (v_prof_u, 'prof-l2b@cita-suite.test'),
    (v_ro, 'ro-l2b@cita-suite.test'),
    (v_outsider, 'outsider-l2b@cita-suite.test');

  insert into public.businesses(id, name, slug, industry, timezone, is_active, public_booking_enabled, allow_same_day_booking, min_booking_notice_minutes, max_booking_days_ahead)
  values
    (v_biz, 'Consultorio Lote 2B', 'consultorio-l2b', 'medicine', 'America/Argentina/Buenos_Aires', true, true, true, 0, 365),
    (v_other_biz, 'Consultorio Ajeno L2B', 'consultorio-ajeno-l2b', 'medicine', 'America/Argentina/Buenos_Aires', true, true, true, 0, 365);

  update public.business_subscriptions
  set commercial_access_enabled = true, is_permanent = true, subscription_status = 'active',
      paid_until = null, grace_until = null, restricted_until = null, archived_at = null
  where business_id in (v_biz, v_other_biz);

  update private.appointment_management_runtime
  set reschedule_enabled = true, email_producer_enabled = true,
      email_daily_limit = 500, email_daily_reserve = 10, email_paused_until = null
  where singleton;
  -- El trigger stamp_email_producer_activation sella email_producer_enabled_at con clock_timestamp() al activar;
  -- fijarlo luego en una segunda sentencia permite probar turnos creados en la misma transacción.
  update private.appointment_management_runtime
  set email_producer_enabled_at = now() - interval '1 hour'
  where singleton;

  update private.deposit_automation set enabled = true where singleton;

  insert into public.business_users(business_id, user_id, role, status, accepted_at) values
    (v_biz, v_owner, 'owner', 'active', now()),
    (v_biz, v_admin, 'admin', 'active', now()),
    (v_biz, v_recep, 'reception', 'active', now()),
    (v_biz, v_prof_u, 'professional', 'active', now()),
    (v_biz, v_ro, 'readonly', 'active', now()),
    (v_other_biz, v_outsider, 'owner', 'active', now());

  insert into public.services(id, business_id, name, duration_minutes, is_active, is_public)
  values (v_svc, v_biz, 'Consulta general', 30, true, true);

  insert into public.professionals(id, business_id, name, is_active, is_public) values
    (v_prof1, v_biz, 'Prof L2B 1', true, true),
    (v_prof2, v_biz, 'Prof L2B 2', true, true);

  insert into public.professional_services(business_id, professional_id, service_id) values
    (v_biz, v_prof1, v_svc),
    (v_biz, v_prof2, v_svc);

  insert into public.patients(id, business_id, owner_id, full_name, email, phone, phone_e164, exempt_from_deposit_auto_cancel) values
    (v_pat1, v_biz, v_owner, 'Paciente Uno L2B', 'uno@l2b.test', '+5493415551001', '+5493415551001', false),
    (v_pat2, v_biz, v_owner, 'Paciente Dos L2B', 'dos@l2b.test', '+5493415551002', '+5493415551002', false),
    (v_pat_no_email, v_biz, v_owner, 'Paciente Sin Correo', null, '+5493415551003', '+5493415551003', false),
    (v_pat_exempt, v_biz, v_owner, 'Paciente Exento P3', 'exento@l2b.test', '+5493415551004', '+5493415551004', true),
    (v_pat_merge_dst, v_biz, v_owner, 'Paciente Destino Fusion', 'destino@l2b.test', '+5493415551005', '+5493415551005', false);

  perform public.operator_set_business_email_sender(v_biz, 'l2b-prueba.cita-suite.com.ar', 'verified');
end $$;

-- ============================================================================
-- 1–4. Política de señas: campos P1 (24/48/null) y P4 (1..720/null) + compatibilidad
-- ============================================================================
select extensions.is(
  pg_temp.as_role(
    pg_temp.l2b_id('owner'),
    format(
      $q$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"late_booking_payment_hours":48,"expiring_reminder_hours":48,"deposit_credit_cutoff_hours":48,"transfer_details":"Alias l2b.prueba","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 0)::text$q$,
      pg_temp.l2b_id('biz')
    )
  ),
  '1',
  '1. save_deposit_policy acepta 14 claves con expiring_reminder_hours=48 y deposit_credit_cutoff_hours=48'
);

-- Compatibilidad retroactiva: payload de 11 claves (Lote 1) y 12 claves (Lote 2A) preservan los campos Lote 2B
select extensions.ok(
  pg_temp.as_role(
    pg_temp.l2b_id('owner'),
    format(
      $q$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"transfer_details":"Alias l2b.prueba","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 1)::text$q$,
      pg_temp.l2b_id('biz')
    )
  ) = '2'
  and pg_temp.as_role(
    pg_temp.l2b_id('owner'),
    format(
      $q$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"late_booking_payment_hours":48,"transfer_details":"Alias l2b.prueba","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 2)::text$q$,
      pg_temp.l2b_id('biz')
    )
  ) = '3'
  and exists(
    select 1 from public.deposit_policies
    where business_id = pg_temp.l2b_id('biz')
      and expiring_reminder_hours = 48
      and deposit_credit_cutoff_hours = 48
  ),
  '2. Payloads retrocompatibles de 11 y 12 claves preservan expiring_reminder_hours y deposit_credit_cutoff_hours'
);

select extensions.throws_ok(
  format(
    $q$select pg_temp.as_role(%L, $inner$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"late_booking_payment_hours":48,"expiring_reminder_hours":12,"deposit_credit_cutoff_hours":48,"transfer_details":"","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 3)::text$inner$)$q$,
    pg_temp.l2b_id('owner'), pg_temp.l2b_id('biz')
  ),
  'P0001', 'DEPOSIT_POLICY_INVALID',
  '3. Rechaza expiring_reminder_hours fuera de {null, 24, 48}'
);

select extensions.throws_ok(
  format(
    $q$select pg_temp.as_role(%L, $inner$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"late_booking_payment_hours":48,"expiring_reminder_hours":24,"deposit_credit_cutoff_hours":721,"transfer_details":"","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 3)::text$inner$)$q$,
    pg_temp.l2b_id('owner'), pg_temp.l2b_id('biz')
  ),
  'P0001', 'DEPOSIT_POLICY_INVALID',
  '4. Rechaza deposit_credit_cutoff_hours fuera de 1..720'
);

-- ============================================================================
-- 5–16. P1: planificador y despacho de deposit_expiring_reminder
-- ============================================================================
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_pat uuid := pg_temp.l2b_id('pat1');
  v_svc uuid := pg_temp.l2b_id('service');
  v_prof uuid := pg_temp.l2b_id('prof1');
  v_a uuid;
  v_due timestamptz;
  v_claim jsonb;
  v_item jsonb;
begin
  -- Turno a 15 días: due_at = starts_at - 7 días; con 48h el aviso toca a due_at - 48h
  v_a := pg_temp.book_turn(v_biz, v_pat, v_svc, v_prof, clock_timestamp() + interval '15 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;

  -- Consumir booking_receipt inicial
  v_claim := public.claim_appointment_email_batch(20, clock_timestamp());
  perform public.record_appointment_email_results(
    coalesce((select jsonb_agg(jsonb_build_object('delivery_id', i->>'delivery_id', 'lease_token', i->>'lease_token', 'outcome', 'accepted', 'request_id', 'r-' || (i->>'delivery_id'))) from jsonb_array_elements(v_claim->'items') i), '[]'::jsonb),
    clock_timestamp()
  );

  -- 1 minuto antes de due_at - 48h: todavía no se planifica
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '48 hours 1 minute');
  if exists(select 1 from private.appointment_email_deliveries where appointment_id = v_a and purpose = 'deposit_expiring_reminder') then
    raise exception 'P1_EARLY_PLAN';
  end if;

  -- Exactamente en due_at - 48h: sale exactamente 1 aviso con auto_cancel=true
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '48 hours');
  select i into v_item from jsonb_array_elements(v_claim->'items') i
  where i->'snapshot'->>'id' = v_a::text and i->>'purpose' = 'deposit_expiring_reminder';
  if v_item is null or (v_item#>>'{snapshot,deposit,auto_cancel}')::boolean is not true then
    raise exception 'P1_48H_MISSING';
  end if;
  perform public.record_appointment_email_results(
    jsonb_build_array(jsonb_build_object('delivery_id', v_item->>'delivery_id', 'lease_token', v_item->>'lease_token', 'outcome', 'accepted', 'request_id', 'req-p1-48h')),
    v_due - interval '48 hours'
  );
  perform set_config('l2b.p1_a1', v_a::text, true);
  perform set_config('l2b.p1_a1_due', v_due::text, true);
end $$;
select extensions.pass('5. P1: deposit_expiring_reminder sale exactamente a due_at - 48h (y no 1 min antes)');

-- 6. Un solo aviso por seña pedida aunque el consultorio cambie de 48h a 24h después del envío
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid := current_setting('l2b.p1_a1')::uuid;
  v_due timestamptz := current_setting('l2b.p1_a1_due')::timestamptz;
  v_claim jsonb;
begin
  update public.deposit_policies set expiring_reminder_hours = 24 where business_id = v_biz;
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  if (select count(*) from private.appointment_email_deliveries where appointment_id = v_a and purpose = 'deposit_expiring_reminder') <> 1 then
    raise exception 'P1_DUPLICATE_AFTER_CONFIG_CHANGE';
  end if;
end $$;
select extensions.pass('6. P1: un solo aviso por seña pedida aunque la configuración cambie de 48h a 24h');

-- 7. Configuración leída al momento de enviar: si se desactiva antes de reclamar, se descarta
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid;
  v_due timestamptz;
  v_claim jsonb;
begin
  update public.deposit_policies set expiring_reminder_hours = 48 where business_id = v_biz;
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '16 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due - interval '48 hours', 50);
  update public.deposit_policies set expiring_reminder_hours = null where business_id = v_biz;
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '48 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a and purpose = 'deposit_expiring_reminder'
      and state = 'discarded' and discard_reason = 'expiring_reminder_disabled'
  ) then
    raise exception 'P1_NOT_DISCARDED_WHEN_DISABLED';
  end if;
end $$;
select extensions.pass('7. P1: si el consultorio desactiva el aviso antes del envío, se descarta con expiring_reminder_disabled');

-- 8. Configuración leída al momento de enviar: si pasa de 48h a 24h antes de salir, espera a 24h y sale una sola vez
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid;
  v_due timestamptz;
  v_claim jsonb;
begin
  update public.deposit_policies set expiring_reminder_hours = 48 where business_id = v_biz;
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '17 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due - interval '48 hours', 50);
  update public.deposit_policies set expiring_reminder_hours = 24 where business_id = v_biz;
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '47 hours');
  if exists(
    select 1 from jsonb_array_elements(v_claim->'items') i
    where i->'snapshot'->>'id' = v_a::text and i->>'purpose' = 'deposit_expiring_reminder'
  ) then
    raise exception 'P1_SENT_TOO_EARLY_AFTER_SWITCH_TO_24H';
  end if;
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  if not exists(
    select 1 from jsonb_array_elements(v_claim->'items') i
    where i->'snapshot'->>'id' = v_a::text and i->>'purpose' = 'deposit_expiring_reminder'
  ) then
    raise exception 'P1_NOT_SENT_AT_24H_AFTER_DEFER';
  end if;
end $$;
select extensions.pass('8. P1: cambio de 48h a 24h antes de salir difiere el envío hasta due_at - 24h y sale una vez');

-- 9. Seña pagada antes del envío: se descarta (deposit_not_pending)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_due timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '18 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due - interval '24 hours', 50);
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  perform public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a and purpose = 'deposit_expiring_reminder' and state = 'discarded' and discard_reason = 'deposit_not_pending'
  ) then raise exception 'P1_PAID_NOT_DISCARDED'; end if;
end $$;
select extensions.pass('9. P1: si la seña se paga antes del envío, el aviso se descarta');

-- 10. Seña eximida antes del envío: se descarta (deposit_not_pending)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_due timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '19 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due - interval '24 hours', 50);
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''waived'',1,null)).status', v_biz, v_a));
  perform public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a and purpose = 'deposit_expiring_reminder' and state = 'discarded' and discard_reason = 'deposit_not_pending'
  ) then raise exception 'P1_WAIVED_NOT_DISCARDED'; end if;
end $$;
select extensions.pass('10. P1: si la seña se exime antes del envío, el aviso se descarta');

-- 11. Turno cancelado antes del envío: se descarta (appointment_cancelled)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_due timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '20 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due - interval '24 hours', 50);
  update public.appointments set status = 'cancelled', cancelled_at = clock_timestamp() where id = v_a;
  perform public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a and purpose = 'deposit_expiring_reminder' and state = 'discarded' and discard_reason = 'appointment_cancelled'
  ) then raise exception 'P1_CANCELLED_NOT_DISCARDED'; end if;
end $$;
select extensions.pass('11. P1: si el turno se cancela antes del envío, el aviso se descarta');

-- 12. Reprogramación: descarta el aviso viejo (superseded_schedule) y evalúa el nuevo vencimiento
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_due1 timestamptz; v_due2 timestamptz; v_claim jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '21 days');
  select due_at into v_due1 from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due1 - interval '24 hours', 50);
  update public.appointments
  set starts_at = starts_at + interval '4 days', ends_at = ends_at + interval '4 days',
      blocking_starts_at = blocking_starts_at + interval '4 days', blocking_ends_at = blocking_ends_at + interval '4 days'
  where id = v_a;
  select due_at into v_due2 from public.appointment_deposits where appointment_id = v_a;
  perform public.claim_appointment_email_batch(20, v_due1 - interval '23 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a and purpose = 'deposit_expiring_reminder' and schedule_revision = 1
      and state = 'discarded' and discard_reason = 'superseded_schedule'
  ) then raise exception 'P1_RESCHED_OLD_NOT_DISCARDED'; end if;
  v_claim := public.claim_appointment_email_batch(20, v_due2 - interval '24 hours');
  if not exists(
    select 1 from jsonb_array_elements(v_claim->'items') i
    where i->'snapshot'->>'id' = v_a::text and i->>'purpose' = 'deposit_expiring_reminder'
  ) then raise exception 'P1_RESCHED_NEW_NOT_SENT'; end if;
end $$;
select extensions.pass('12. P1: reprogramar descarta el aviso viejo (superseded_schedule) y programa el nuevo');

-- 13. Reserva cuando ya pasó la hora del aviso (ej. turno en 20 horas): no se crea
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '20 hours');
  perform private.plan_appointment_email_work(clock_timestamp() + interval '1 hour', 50);
  if exists(select 1 from private.appointment_email_deliveries where appointment_id = v_a and purpose = 'deposit_expiring_reminder') then
    raise exception 'P1_CREATED_PAST_REMINDER_TIME';
  end if;
end $$;
select extensions.pass('13. P1: si al reservar ya pasó la hora del aviso o el vencimiento, no se crea');

-- 14. Sin correo / baja: no sale
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a_no_mail uuid; v_a_sup uuid; v_due1 timestamptz; v_due2 timestamptz;
begin
  v_a_no_mail := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat_no_email'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '22 days');
  select due_at into v_due1 from public.appointment_deposits where appointment_id = v_a_no_mail;
  perform public.claim_appointment_email_batch(20, v_due1 - interval '24 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a_no_mail and purpose = 'deposit_expiring_reminder' and state = 'discarded' and discard_reason = 'no_recipient'
  ) then raise exception 'P1_NO_EMAIL_NOT_DISCARDED'; end if;

  insert into private.email_suppressions(business_id, email_normalized, reason)
  values (v_biz, 'dos@l2b.test', 'unsubscribe');
  v_a_sup := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat2'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '23 days');
  select due_at into v_due2 from public.appointment_deposits where appointment_id = v_a_sup;
  perform public.claim_appointment_email_batch(20, v_due2 - interval '24 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a_sup and purpose = 'deposit_expiring_reminder' and state = 'discarded' and discard_reason = 'suppressed'
  ) then raise exception 'P1_SUPPRESSED_NOT_DISCARDED'; end if;
  delete from private.email_suppressions where business_id = v_biz;
end $$;
select extensions.pass('14. P1: paciente sin correo o dado de baja no recibe el aviso');

-- 15. Paciente con marca P3 recibe el aviso con auto_cancel = false
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_due timestamptz; v_claim jsonb; v_item jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat_exempt'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '24 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  v_claim := public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  select i into v_item from jsonb_array_elements(v_claim->'items') i
  where i->'snapshot'->>'id' = v_a::text and i->>'purpose' = 'deposit_expiring_reminder';
  if v_item is null or (v_item#>>'{snapshot,deposit,auto_cancel}')::boolean is distinct from false then
    raise exception 'P1_P3_EXEMPT_WRONG_SNAPSHOT';
  end if;
end $$;
select extensions.pass('15. P1: paciente con marca P3 recibe deposit_expiring_reminder con auto_cancel=false');

-- 16. Aviso «Ya transferí» registrado antes del envío descarta deposit_expiring_reminder
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_tok text; v_due timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '29 days');
  select confirmation_token into v_tok from public.appointments where id = v_a;
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  perform private.plan_appointment_email_work(v_due - interval '24 hours', 50);
  perform public.report_appointment_deposit_payment(v_tok, true);
  perform public.claim_appointment_email_batch(20, v_due - interval '24 hours');
  if not exists(
    select 1 from private.appointment_email_deliveries
    where appointment_id = v_a and purpose = 'deposit_expiring_reminder'
      and state = 'discarded' and discard_reason = 'payment_notice_recorded'
  ) then raise exception 'P1_NOTICE_NOT_DISCARDED'; end if;
end $$;
select extensions.pass('16. P1: si el paciente ya registró «Ya transferí», deposit_expiring_reminder se descarta');

-- ============================================================================
-- 17–25. P1: «Ya transferí», bloqueo en vencimiento, «No llegó el pago» y permisos
-- ============================================================================
select extensions.ok(
  has_function_privilege('service_role', 'public.report_appointment_deposit_payment(text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.report_appointment_deposit_payment(text,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.report_appointment_deposit_payment(text,boolean)', 'EXECUTE'),
  '17. P1: report_appointment_deposit_payment sólo ejecutable por service_role'
);

do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid;
  v_tok text;
  v_r1 jsonb;
  v_r2 jsonb;
  v_due timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '26 days');
  select confirmation_token into v_tok from public.appointments where id = v_a;
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  v_r1 := public.report_appointment_deposit_payment(v_tok, true);
  if (v_r1->>'recorded')::boolean is not true or (v_r1->>'already_recorded')::boolean is not false
    or not exists(
      select 1 from public.appointment_deposits
      where appointment_id = v_a and patient_payment_notice_at is not null
        and auto_cancel = false and auto_cancel_suppressed_by_payment_notice = true
    ) then
    raise exception 'P1_NOTICE_FIRST_FAILED';
  end if;
  perform pg_sleep(0.02);
  v_r2 := public.report_appointment_deposit_payment(v_tok, true);
  if (v_r2->>'already_recorded')::boolean is not true
    or (v_r2->>'payment_notice_at') is distinct from (v_r1->>'payment_notice_at') then
    raise exception 'P1_NOTICE_SECOND_OVERWROTE';
  end if;
  perform set_config('l2b.notice_appt', v_a::text, true);
  perform set_config('l2b.notice_due', v_due::text, true);
end $$;
select extensions.pass('18. P1: primer aviso «Ya transferí» persiste marca y suprime auto_cancel');
select extensions.pass('19. P1: toques repetidos de «Ya transferí» conservan el primer aviso');

select extensions.ok(
  private.expire_deposit_if_still_due(current_setting('l2b.notice_appt')::uuid, current_setting('l2b.notice_due')::timestamptz) = false
  and private.expire_deposit_if_still_due(current_setting('l2b.notice_appt')::uuid, current_setting('l2b.notice_due')::timestamptz + interval '10 minutes') = false
  and (select status from public.appointments where id = current_setting('l2b.notice_appt')::uuid) = 'reserved',
  '20. P1: aviso registrado impide la cancelación automática en el borde exacto del vencimiento'
);

-- 21. Permisos de clear_appointment_deposit_payment_notice («No llegó el pago») en los 5 roles + otro consultorio + restringido
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid := current_setting('l2b.notice_appt')::uuid;
  v_rev bigint;
  v_role text;
begin
  select revision into v_rev from public.appointment_deposits where appointment_id = v_a;
  foreach v_role in array array['professional', 'readonly', 'outsider'] loop
    begin
      perform pg_temp.as_role(
        pg_temp.l2b_id(v_role),
        format('select public.clear_appointment_deposit_payment_notice(%L,%L,%s)::text', v_biz, v_a, v_rev)
      );
      raise exception 'P1_ROLE_NOT_BLOCKED:%', v_role;
    exception when others then
      if sqlerrm <> 'DEPOSIT_FORBIDDEN' then raise; end if;
    end;
  end loop;
  -- Consultorio restringido tampoco puede
  update public.business_subscriptions set commercial_access_enabled = false where business_id = v_biz;
  begin
    perform pg_temp.as_role(
      pg_temp.l2b_id('owner'),
      format('select public.clear_appointment_deposit_payment_notice(%L,%L,%s)::text', v_biz, v_a, v_rev)
    );
    raise exception 'P1_RESTRICTED_NOT_BLOCKED';
  exception when others then
    if sqlerrm <> 'DEPOSIT_FORBIDDEN' then raise; end if;
  end;
  update public.business_subscriptions set commercial_access_enabled = true where business_id = v_biz;
end $$;
select extensions.pass('21. P1: «No llegó el pago» rechaza professional, readonly, ajeno y consultorio restringido');

-- 22. «No llegó el pago» con vencimiento futuro: limpia aviso y restaura auto_cancel = true (admite owner/admin/reception)
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid := current_setting('l2b.notice_appt')::uuid;
  v_due timestamptz := current_setting('l2b.notice_due')::timestamptz;
  v_rev bigint;
  v_res jsonb;
begin
  select revision into v_rev from public.appointment_deposits where appointment_id = v_a;
  v_res := pg_temp.as_role(
    pg_temp.l2b_id('reception'),
    format('select public.clear_appointment_deposit_payment_notice(%L,%L,%s)::text', v_biz, v_a, v_rev)
  )::jsonb;
  if (v_res->>'auto_cancel')::boolean is not true
    or not exists(select 1 from public.appointment_deposits where appointment_id = v_a and patient_payment_notice_at is null and auto_cancel = true)
    or private.expire_deposit_if_still_due(v_a, v_due) is not true then
    raise exception 'P1_CLEAR_FUTURE_FAILED';
  end if;
end $$;
select extensions.pass('22. P1: «No llegó el pago» antes del vencimiento restaura auto_cancel y vuelve al circuito automático');

-- 23. «No llegó el pago» ya vencido (due_at <= now): limpia aviso y deja auto_cancel = false (decidir a mano)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_tok text; v_rev bigint; v_res jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '27 days');
  select confirmation_token into v_tok from public.appointments where id = v_a;
  perform public.report_appointment_deposit_payment(v_tok, true);
  update public.appointment_deposits set due_at = clock_timestamp() - interval '10 minutes' where appointment_id = v_a returning revision into v_rev;
  v_res := pg_temp.as_role(
    pg_temp.l2b_id('admin'),
    format('select public.clear_appointment_deposit_payment_notice(%L,%L,%s)::text', v_biz, v_a, v_rev)
  )::jsonb;
  if (v_res->>'auto_cancel')::boolean is distinct from false
    or not exists(select 1 from public.appointment_deposits where appointment_id = v_a and patient_payment_notice_at is null and auto_cancel = false) then
    raise exception 'P1_CLEAR_OVERDUE_RESTORED_AUTOCANCEL';
  end if;
end $$;
select extensions.pass('23. P1: «No llegó el pago» con seña ya vencida deja auto_cancel=false (decidir a mano)');

-- 24. «No llegó el pago» en paciente con marca P3 mantiene auto_cancel = false
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_tok text; v_rev bigint; v_res jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat_exempt'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '28 days');
  select confirmation_token into v_tok from public.appointments where id = v_a;
  perform public.report_appointment_deposit_payment(v_tok, true);
  select revision into v_rev from public.appointment_deposits where appointment_id = v_a;
  v_res := pg_temp.as_role(
    pg_temp.l2b_id('owner'),
    format('select public.clear_appointment_deposit_payment_notice(%L,%L,%s)::text', v_biz, v_a, v_rev)
  )::jsonb;
  if (v_res->>'auto_cancel')::boolean is distinct from false then
    raise exception 'P1_CLEAR_EXEMPT_RESTORED_AUTOCANCEL';
  end if;
end $$;
select extensions.pass('24. P1: «No llegó el pago» en paciente P3 nunca reactiva auto_cancel');

-- 25. Rate limit allowlist acepta las acciones públicas de «Ya transferí»
select extensions.ok(
  (select allowed from public.consume_server_rate_limits('deposit_payment_notice_by_ip', repeat('a', 64), '[{"limit_count":10,"window_seconds":900}]'::jsonb) limit 1)
  and (select allowed from public.consume_server_rate_limits('deposit_payment_notice_by_token', repeat('b', 64), '[{"limit_count":10,"window_seconds":900}]'::jsonb) limit 1),
  '25. P1: consume_server_rate_limits admite deposit_payment_notice_by_ip y deposit_payment_notice_by_token'
);

-- ============================================================================
-- 26–32. P4: cancelaciones (sin corte, borde 48h vs 47h59m, fuerza mayor, auto-cancel, ausencia)
-- ============================================================================
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text;
begin
  update public.deposit_policies set deposit_credit_cutoff_hours = null where business_id = v_biz;
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '10 days');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Sin P4', false);
  if not exists(select 1 from public.appointment_deposit_requirements where appointment_id = v_a and allocation = 'unresolved')
    or exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a) then
    raise exception 'P4_NULL_CUTOFF_CHANGED_BEHAVIOR';
  end if;
  update public.deposit_policies set deposit_credit_cutoff_hours = 48 where business_id = v_biz;
end $$;
select extensions.pass('26. P4: con deposit_credit_cutoff_hours vacío se conserva el comportamiento actual (unresolved, 0 créditos)');

-- 27. Borde exacto >= 48h (cancelación por paciente a exactamente 48h 00m 05s -> queda a cuenta)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_tok text; v_rev text; v_snap jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '48 hours 5 seconds');
  select confirmation_token into v_tok from public.appointments where id = v_a;
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  perform public.apply_patient_appointment_management(v_tok, true, gen_random_uuid(), v_rev, 'cancel');
  v_snap := private.appointment_management_snapshot(v_biz, v_a, null, clock_timestamp());
  if not exists(select 1 from public.appointment_deposit_requirements where appointment_id = v_a and allocation = 'credited')
    or not exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a and status = 'available' and amount = 40000 and reason = 'cancelled_in_time')
    or v_snap#>>'{cancellation_deposit_outcome,outcome}' <> 'credit' then
    raise exception 'P4_CANCEL_IN_TIME_FAILED: %', v_snap->'cancellation_deposit_outcome';
  end if;
  delete from public.patient_deposit_credits where source_appointment_id = v_a;
end $$;
select extensions.pass('27. P4: cancelar con >= 48h convierte la seña pagada en crédito disponible y lo expone para el correo');

-- 28. Borde < 48h (47h 59m, cancelación por paciente cuando P5 está vacío -> se pierde)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_tok text; v_rev text; v_snap jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '47 hours 59 minutes');
  select confirmation_token into v_tok from public.appointments where id = v_a;
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  perform public.apply_patient_appointment_management(v_tok, true, gen_random_uuid(), v_rev, 'cancel');
  v_snap := private.appointment_management_snapshot(v_biz, v_a, null, clock_timestamp());
  if not exists(select 1 from public.appointment_deposit_requirements where appointment_id = v_a and allocation = 'forfeited')
    or exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a)
    or v_snap#>>'{cancellation_deposit_outcome,outcome}' <> 'forfeit'
    or (v_snap#>>'{cancellation_deposit_outcome,cutoff_hours}')::int <> 48 then
    raise exception 'P4_CANCEL_LATE_PATIENT_FAILED';
  end if;
end $$;
select extensions.pass('28. P4: cancelar a 47h 59m pierde la seña, crea 0 créditos y expone forfeit para el correo');

-- 29. Cancelar < 48h por personal sin fuerza mayor -> se pierde
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '16 hours');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Canceló tarde', false);
  if not exists(select 1 from public.appointment_deposit_requirements where appointment_id = v_a and allocation = 'forfeited')
    or exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a) then
    raise exception 'P4_STAFF_CANCEL_LATE_FAILED';
  end if;
end $$;
select extensions.pass('29. P4: cancelar < 48h por personal sin fuerza mayor pierde la seña');

-- 30. Cancelar < 48h por personal CON excepción por fuerza mayor -> queda a cuenta
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text; v_snap jsonb;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '18 hours');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  perform public.apply_staff_appointment_management_with_deposit_decision(
    v_biz, pg_temp.l2b_id('reception'), v_a, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Internación', false, true, null
  );
  v_snap := private.appointment_management_snapshot(v_biz, v_a, null, clock_timestamp());
  if not exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a and status = 'available' and reason = 'force_majeure' and amount = 40000)
    or v_snap#>>'{cancellation_deposit_outcome,reason}' <> 'force_majeure' then
    raise exception 'P4_FORCE_MAJEURE_FAILED';
  end if;
  delete from public.patient_deposit_credits where source_appointment_id = v_a;
end $$;
select extensions.pass('30. P4: excepción por fuerza mayor al cancelar < 48h deja la seña a cuenta');

-- 31. Auto-cancelación por seña impaga no deja nada a cuenta
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_due timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '12 days');
  select due_at into v_due from public.appointment_deposits where appointment_id = v_a;
  if private.expire_deposit_if_still_due(v_a, v_due) is not true
    or exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a) then
    raise exception 'P4_AUTOCANCEL_CREATED_CREDIT';
  end if;
end $$;
select extensions.pass('31. P4: un turno cancelado solo por seña impaga no deja nada a cuenta');

-- 32. Ausencia sin aviso (turno pasado): no se puede cancelar ni genera crédito
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '11 days');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  update public.appointments set starts_at = clock_timestamp() - interval '2 hours', ends_at = clock_timestamp() - interval '90 minutes',
    blocking_starts_at = clock_timestamp() - interval '2 hours', blocking_ends_at = clock_timestamp() - interval '90 minutes'
  where id = v_a;
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  begin
    perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'No vino', false);
    raise exception 'P4_PAST_CANCEL_ALLOWED';
  exception when others then
    if sqlerrm <> 'APPOINTMENT_ALREADY_STARTED' then raise; end if;
  end;
  if exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_a) then
    raise exception 'P4_NO_SHOW_CREATED_CREDIT';
  end if;
  perform set_config('l2b.past_paid_appt', v_a::text, true);
end $$;
select extensions.pass('32. P4: ausencia sin aviso (turno pasado) no puede cancelarse ni genera seña a cuenta');

-- ============================================================================
-- 33–39. P4: reprogramación del paciente y del personal (decisiones #1 y #2 de Juan)
-- ============================================================================
-- 33. Reprogramación del paciente >= 48h con monto cambiado ($40.000 -> $50.000): NO pide segunda seña y guarda nota de diferencia; exacto 23 claves JSON
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_a uuid;
  v_tok text;
  v_rev text;
  v_terms jsonb;
  v_avail_rev bigint;
  v_target timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '5 days', 'public_booking', true);
  select confirmation_token into v_tok from public.appointments where id = v_a;
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  -- El consultorio sube la seña vigente a $ 50.000
  update public.deposit_policies set fixed_amount = 50000 where business_id = v_biz;
  v_target := clock_timestamp() + interval '6 days';
  v_terms := private.appointment_reschedule_financial_terms(v_biz, v_a, v_target, clock_timestamp());
  if (select count(*) from jsonb_object_keys(v_terms)) <> 23
    or v_terms->>'kind' <> 'none'
    or (v_terms->>'required')::boolean is not false
    or v_terms->>'previous_payment_disposition' <> 'credit' then
    raise exception 'P4_PATIENT_RESCHED_INTIME_TERMS_WRONG: %', v_terms;
  end if;
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  perform public.apply_patient_appointment_management(v_tok, true, gen_random_uuid(), v_rev, 'reschedule', v_target, v_avail_rev, v_terms, null);
  if not exists(
    select 1 from public.appointment_deposits
    where appointment_id = v_a and status = 'paid' and amount = 40000
      and amount_difference_note like '%10.000%'
  ) or (select status from public.appointments where id = v_a) <> 'confirmed' then
    raise exception 'P4_PATIENT_RESCHED_INTIME_DEPOSIT_WRONG';
  end if;
  update public.deposit_policies set fixed_amount = 40000 where business_id = v_biz;
end $$;
select extensions.pass('33. P4 decisión #2: reprogramación del paciente >= 48h cubre sin pedir segunda seña (23 claves exactas) y guarda nota de diferencia');

-- 34. Reprogramación del paciente < 48h (cuando P5 está vacío): pierde seña anterior y pide nueva seña
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_tok text; v_rev text; v_terms jsonb; v_avail_rev bigint; v_target timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '47 hours 59 minutes', 'public_booking', true);
  select confirmation_token into v_tok from public.appointments where id = v_a;
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_target := clock_timestamp() + interval '8 days';
  v_terms := private.appointment_reschedule_financial_terms(v_biz, v_a, v_target, clock_timestamp());
  if v_terms->>'previous_payment_disposition' <> 'forfeit' or v_terms->>'kind' <> 'new_requirement' or (v_terms->>'required')::boolean is not true then
    raise exception 'P4_PATIENT_RESCHED_LATE_TERMS_WRONG: %', v_terms;
  end if;
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  perform public.apply_patient_appointment_management(v_tok, true, gen_random_uuid(), v_rev, 'reschedule', v_target, v_avail_rev, v_terms, null);
  if (select status from public.appointments where id = v_a) <> 'reserved'
    or not exists(select 1 from public.appointment_deposits where appointment_id = v_a and status = 'pending')
    or not exists(select 1 from public.appointment_deposit_requirements where appointment_id = v_a and allocation = 'forfeited') then
    raise exception 'P4_PATIENT_RESCHED_LATE_FAILED';
  end if;
end $$;
select extensions.pass('34. P4: reprogramación del paciente < 48h pierde la seña anterior y genera nueva seña pendiente');

-- 35. Reprogramación del personal >= 48h (decisión #2): sin preguntar quién pidió el cambio, cubre sin segunda seña y nota si bajó ($40.000 -> $30.000)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text; v_avail_rev bigint; v_target timestamptz;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '7 days');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  update public.deposit_policies set fixed_amount = 30000 where business_id = v_biz;
  v_target := clock_timestamp() + interval '9 days';
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'reschedule', v_target, false, v_avail_rev, null, false);
  if (select status from public.appointments where id = v_a) <> 'confirmed'
    or not exists(select 1 from public.appointment_deposits where appointment_id = v_a and status = 'paid' and amount_difference_note like '%saldo a favor%') then
    raise exception 'P4_STAFF_RESCHED_INTIME_FAILED';
  end if;
  update public.deposit_policies set fixed_amount = 40000 where business_id = v_biz;
end $$;
select extensions.pass('35. P4 decisión #2: reprogramación del personal >= 48h cubre sin pedir segunda seña y guarda nota de saldo a favor');

-- 36. Reprogramación del personal < 48h SIN indicar quién pidió el cambio -> rechazada (decisión #1)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text; v_avail_rev bigint;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof1'), clock_timestamp() + interval '24 hours');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  begin
    perform public.apply_staff_appointment_management_with_deposit_decision(
      v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'reschedule', clock_timestamp() + interval '10 days', false, v_avail_rev, null, false, false, null
    );
    raise exception 'P4_MISSING_REQUESTER_ALLOWED';
  exception when others then
    if sqlerrm <> 'APPOINTMENT_RESCHEDULE_REQUESTER_REQUIRED' then raise; end if;
  end;
  perform set_config('l2b.late_staff_appt', v_a::text, true);
end $$;
select extensions.pass('36. P4 decisión #1: reprogramación del personal < 48h sin «¿Quién pidió el cambio?» es rechazada');

-- 37. Reprogramación de un turno pasado con seña pagada SIN indicar quién pidió el cambio -> rechazada (decisión #1)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid := current_setting('l2b.past_paid_appt')::uuid; v_rev text; v_avail_rev bigint;
begin
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  begin
    perform public.apply_staff_appointment_management(
      v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'reschedule', clock_timestamp() + interval '10 days 1 hour', false, v_avail_rev, null, false
    );
    raise exception 'P4_PAST_MISSING_REQUESTER_ALLOWED';
  exception when others then
    if sqlerrm <> 'APPOINTMENT_RESCHEDULE_REQUESTER_REQUIRED' then raise; end if;
  end;
end $$;
select extensions.pass('37. P4 decisión #1: reprogramación de un turno pasado con seña pagada exige «¿Quién pidió el cambio?»');

-- 38. Reprogramación del personal < 48h con «El paciente» -> pierde seña, pide nueva seña y registra respuesta (decisión #1)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid := current_setting('l2b.late_staff_appt')::uuid; v_rev text; v_avail_rev bigint;
begin
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  perform public.apply_staff_appointment_management_with_deposit_decision(
    v_biz, pg_temp.l2b_id('reception'), v_a, gen_random_uuid(), v_rev, 'reschedule', clock_timestamp() + interval '10 days 2 hours', false, v_avail_rev, null, false, false, 'patient'
  );
  if (select status from public.appointments where id = v_a) <> 'reserved'
    or not exists(select 1 from public.appointment_deposits where appointment_id = v_a and status = 'pending')
    or not exists(select 1 from public.appointment_deposit_requirements where appointment_id = v_a and allocation = 'forfeited')
    or not exists(select 1 from public.audit_logs where entity_id = v_a and action = 'appointment.rescheduled' and metadata->>'reschedule_requester' = 'patient') then
    raise exception 'P4_STAFF_RESCHED_PATIENT_FAILED';
  end if;
end $$;
select extensions.pass('38. P4 decisión #1: personal reprograma < 48h («El paciente») pierde seña, pide nueva y registra respuesta');

-- 39. Reprogramación del personal < 48h con «El consultorio o fuerza mayor» -> conserva seña y registra respuesta (decisión #1)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid := current_setting('l2b.past_paid_appt')::uuid; v_rev text; v_avail_rev bigint;
begin
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  perform public.apply_staff_appointment_management_with_deposit_decision(
    v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'reschedule', clock_timestamp() + interval '10 days 3 hours', false, v_avail_rev, null, false, false, 'practice_or_force_majeure'
  );
  if (select status from public.appointments where id = v_a) <> 'confirmed'
    or not exists(select 1 from public.appointment_deposits where appointment_id = v_a and status = 'paid')
    or not exists(select 1 from public.audit_logs where entity_id = v_a and action = 'appointment.rescheduled' and metadata->>'reschedule_requester' = 'practice_or_force_majeure') then
    raise exception 'P4_STAFF_RESCHED_PRACTICE_FAILED';
  end if;
end $$;
select extensions.pass('39. P4 decisión #1: personal reprograma < 48h/pasado («El consultorio o fuerza mayor») conserva seña y registra respuesta');

-- ============================================================================
-- 40–48. P4: «Aplicar» crédito, diferencias, re-cancelación (decisión #3), «Deshacer» (decisión #4), múltiples, fusión y columna computada
-- ============================================================================
-- Preparar 1 crédito de $ 40.000 para pat2
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid; v_rev text;
begin
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat2'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '14 days');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_a));
  v_rev := private.appointment_semantic_revision(v_biz, v_a);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_a, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'En plazo', false);
end $$;

-- 40. Permisos de apply_patient_deposit_credit en los 5 roles + ajeno + restringido
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_target uuid; v_role text;
begin
  v_target := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat2'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '15 days 1 hour');
  foreach v_role in array array['professional', 'readonly', 'outsider'] loop
    begin
      perform pg_temp.as_role(pg_temp.l2b_id(v_role), format('select public.apply_patient_deposit_credit(%L,%L,1,null)::text', v_biz, v_target));
      raise exception 'P4_APPLY_ROLE_NOT_BLOCKED:%', v_role;
    exception when others then
      if sqlerrm <> 'DEPOSIT_FORBIDDEN' then raise; end if;
    end;
  end loop;
  update public.business_subscriptions set commercial_access_enabled = false where business_id = v_biz;
  begin
    perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select public.apply_patient_deposit_credit(%L,%L,1,null)::text', v_biz, v_target));
    raise exception 'P4_APPLY_RESTRICTED_NOT_BLOCKED';
  exception when others then
    if sqlerrm <> 'DEPOSIT_FORBIDDEN' then raise; end if;
  end;
  update public.business_subscriptions set commercial_access_enabled = true where business_id = v_biz;
  perform set_config('l2b.apply_equal_appt', v_target::text, true);
end $$;
select extensions.pass('40. P4: «Aplicar» rechaza professional, readonly, ajeno y consultorio restringido');

-- 41. «Aplicar» con mismo monto ($40.000 -> $40.000): sin nota de diferencia, turno Confirmado
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_a uuid := current_setting('l2b.apply_equal_appt')::uuid; v_res jsonb;
begin
  v_res := pg_temp.as_role(pg_temp.l2b_id('reception'), format('select public.apply_patient_deposit_credit(%L,%L,1,null)::text', v_biz, v_a))::jsonb;
  if v_res->>'status' <> 'paid' or v_res->>'appointment_status' <> 'confirmed' or (v_res->>'difference_note') is not null then
    raise exception 'P4_APPLY_EQUAL_FAILED: %', v_res;
  end if;
end $$;
select extensions.pass('41. P4: «Aplicar» con mismo monto cubre la seña en un paso sin nota de diferencia');

-- 42. «Aplicar» cuando el monto subió ($40.000 a cuenta sobre nueva seña de $50.000)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_prev uuid := current_setting('l2b.apply_equal_appt')::uuid; v_rev text; v_a uuid; v_res jsonb;
begin
  -- Cancelar en plazo el turno anterior para recuperar crédito $ 40.000
  v_rev := private.appointment_semantic_revision(v_biz, v_prev);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_prev, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Reusar', false);
  update public.deposit_policies set fixed_amount = 50000 where business_id = v_biz;
  v_a := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat2'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '16 days 1 hour');
  v_res := pg_temp.as_role(pg_temp.l2b_id('admin'), format('select public.apply_patient_deposit_credit(%L,%L,1,null)::text', v_biz, v_a))::jsonb;
  if v_res->>'status' <> 'paid' or (v_res->>'difference_amount')::bigint <> 10000 or (v_res->>'difference_note') not like '%Falta cobrar $ 10.000%' then
    raise exception 'P4_APPLY_HIGHER_FAILED: %', v_res;
  end if;
  perform set_config('l2b.apply_higher_appt', v_a::text, true);
end $$;
select extensions.pass('42. P4: «Aplicar» cuando subió el monto ($40.000 -> $50.000) cubre y registra «Falta cobrar $ 10.000 de diferencia»');

-- 43 & 44. Decisión #3 (re-cancelar en plazo turno de $50.000 cubierto con $40.000 devuelve $40.000 reales!) y aplicar a turno de $30.000 (saldo a favor)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_hi uuid := current_setting('l2b.apply_higher_appt')::uuid; v_rev text; v_lo uuid; v_res jsonb;
begin
  v_rev := private.appointment_semantic_revision(v_biz, v_hi);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_hi, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Re-cancelar en plazo', false);
  if not exists(select 1 from public.patient_deposit_credits where source_appointment_id = v_hi and status = 'available' and amount = 40000) then
    raise exception 'P4_DECISION3_WRONG_CREDIT_AMOUNT';
  end if;
  update public.deposit_policies set fixed_amount = 30000 where business_id = v_biz;
  v_lo := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat2'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '17 days 1 hour');
  v_res := pg_temp.as_role(pg_temp.l2b_id('owner'), format('select public.apply_patient_deposit_credit(%L,%L,1,null)::text', v_biz, v_lo))::jsonb;
  if v_res->>'status' <> 'paid' or (v_res->>'difference_amount')::bigint <> -10000 or (v_res->>'difference_note') not like '%Queda $ 10.000 de saldo a favor%' then
    raise exception 'P4_APPLY_LOWER_FAILED: %', v_res;
  end if;
  update public.deposit_policies set fixed_amount = 40000 where business_id = v_biz;
  perform set_config('l2b.apply_lower_appt', v_lo::text, true);
  perform set_config('l2b.apply_lower_credit', v_res->>'credit_id', true);
end $$;
select extensions.pass('43. P4: «Aplicar» cuando bajó el monto ($40.000 -> $30.000) cubre y registra «Queda $ 10.000 de saldo a favor»');
select extensions.pass('44. P4 decisión #3: volver a cancelar a tiempo un turno con seña aplicada devuelve el monto real pagado ($40.000) sin límite de reutilizaciones');

-- 45. Múltiples señas a cuenta: se aplica una por turno (la más antigua primero)
do $$
declare v_biz uuid := pg_temp.l2b_id('biz'); v_c1 uuid; v_c2 uuid; v_t1 uuid; v_rev text;
begin
  v_c1 := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '18 days 1 hour');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_c1));
  v_rev := private.appointment_semantic_revision(v_biz, v_c1);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_c1, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Crédito 1', false);

  v_c2 := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '19 days 1 hour');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select (public.set_appointment_deposit(%L,%L,''paid'',1,null)).status', v_biz, v_c2));
  v_rev := private.appointment_semantic_revision(v_biz, v_c2);
  perform public.apply_staff_appointment_management(v_biz, pg_temp.l2b_id('owner'), v_c2, gen_random_uuid(), v_rev, 'cancel', null, false, null, 'Crédito 2', false);

  v_t1 := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat1'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '20 days 1 hour');
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select public.apply_patient_deposit_credit(%L,%L,1,null)::text', v_biz, v_t1));
  if (select count(*) from public.patient_deposit_credits where business_id = v_biz and patient_id = pg_temp.l2b_id('pat1') and status = 'available') <> 1 then
    raise exception 'P4_MULTI_CREDIT_COUNT_WRONG';
  end if;
end $$;
select extensions.pass('45. P4: con varias señas a cuenta se aplica exactamente una por turno y las demás siguen disponibles');

-- 46. Decisión #4: no puede aplicarse el mismo crédito a 2 turnos a la vez; «Deshacer» devuelve el crédito a la ficha y registra quién lo hizo
do $$
declare
  v_biz uuid := pg_temp.l2b_id('biz');
  v_lo uuid := current_setting('l2b.apply_lower_appt')::uuid;
  v_cid uuid := current_setting('l2b.apply_lower_credit')::uuid;
  v_other uuid;
  v_dep_rev bigint;
begin
  v_other := pg_temp.book_turn(v_biz, pg_temp.l2b_id('pat2'), pg_temp.l2b_id('service'), pg_temp.l2b_id('prof2'), clock_timestamp() + interval '21 days 1 hour');
  -- Intentar aplicar el mismo crédito ya aplicado a otro turno -> error explícito
  begin
    perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select public.apply_patient_deposit_credit(%L,%L,1,%L)::text', v_biz, v_other, v_cid));
    raise exception 'P4_DOUBLE_APPLY_ALLOWED';
  exception when others then
    if sqlerrm <> 'DEPOSIT_CREDIT_UNAVAILABLE' then raise; end if;
  end;

  -- «Deshacer» por recepción -> crédito vuelve a available con last_released_by = reception, auditoría y evento de ficha
  select revision into v_dep_rev from public.appointment_deposits where appointment_id = v_lo;
  perform pg_temp.as_role(pg_temp.l2b_id('reception'), format('select (public.set_appointment_deposit(%L,%L,''pending'',%s,null)).status', v_biz, v_lo, v_dep_rev));
  if not exists(
    select 1 from public.patient_deposit_credits
    where id = v_cid and status = 'available' and applied_appointment_id is null and last_released_by = pg_temp.l2b_id('reception')
  ) or not exists(
    select 1 from public.appointment_deposit_events
    where appointment_id = v_lo and event_type = 'credit_released' and actor_id = pg_temp.l2b_id('reception')
  ) or not exists(
    select 1 from public.patient_profile_change_events
    where business_id = v_biz and patient_id = pg_temp.l2b_id('pat2') and changed_by_user_id = pg_temp.l2b_id('reception')
      and summary like '%seña a cuenta%'
  ) then
    raise exception 'P4_UNDO_RELEASE_FAILED';
  end if;

  -- Ahora sí puede aplicarse al otro turno
  perform pg_temp.as_role(pg_temp.l2b_id('owner'), format('select public.apply_patient_deposit_credit(%L,%L,1,%L)::text', v_biz, v_other, v_cid));
  if not exists(select 1 from public.patient_deposit_credits where id = v_cid and status = 'applied' and applied_appointment_id = v_other) then
    raise exception 'P4_REAPPLY_AFTER_UNDO_FAILED';
  end if;
end $$;
select extensions.pass('46. P4 decisión #4: un crédito nunca se aplica a dos turnos a la vez y «Deshacer» lo restituye a la ficha registrando quién lo hizo');

-- 47. Pacientes unificados: private.merge_patient_deposit_credits mueve los créditos disponibles
select extensions.ok(
  private.merge_patient_deposit_credits(pg_temp.l2b_id('biz'), pg_temp.l2b_id('pat1'), pg_temp.l2b_id('pat_merge_dst')) = 1
  and exists(
    select 1 from public.patient_deposit_credits
    where business_id = pg_temp.l2b_id('biz') and patient_id = pg_temp.l2b_id('pat_merge_dst') and status = 'available'
  )
  and not exists(
    select 1 from public.patient_deposit_credits
    where business_id = pg_temp.l2b_id('biz') and patient_id = pg_temp.l2b_id('pat1') and status = 'available'
  ),
  '47. P4: private.merge_patient_deposit_credits transfiere señas a cuenta disponibles al unificar fichas'
);

-- 48. Columna computada public.patient_available_deposit_credits respeta aislamiento multi-tenant
do $$
declare
  v_pat public.patients;
  v_auth_credits jsonb;
  v_outsider_credits jsonb;
begin
  select * into v_pat from public.patients where id = pg_temp.l2b_id('pat_merge_dst');
  v_auth_credits := pg_temp.as_role(
    pg_temp.l2b_id('reception'),
    format('select public.patient_available_deposit_credits(p)::text from public.patients p where p.id = %L', v_pat.id)
  )::jsonb;
  if jsonb_array_length(v_auth_credits) <> 1 then
    raise exception 'P4_COMPUTED_CREDITS_MISSING: %', v_auth_credits;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.l2b_id('outsider'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_outsider_credits := public.patient_available_deposit_credits(v_pat);
  execute 'reset role';
  if coalesce(jsonb_array_length(v_outsider_credits), 0) <> 0 then
    raise exception 'P4_COMPUTED_CREDITS_LEAKED: %', v_outsider_credits;
  end if;
end $$;
select extensions.pass('48. P4: patient_available_deposit_credits expone los créditos al equipo autorizado y nunca filtra entre consultorios');

-- 49. Privilegios explícitos y preservación de firma 11-arg de apply_staff_appointment_management
select extensions.ok(
  has_function_privilege('authenticated', 'public.clear_appointment_deposit_payment_notice(uuid,uuid,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.clear_appointment_deposit_payment_notice(uuid,uuid,bigint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.apply_patient_deposit_credit(uuid,uuid,bigint,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_patient_deposit_credit(uuid,uuid,bigint,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.apply_staff_appointment_management(uuid,uuid,uuid,uuid,text,text,timestamptz,boolean,bigint,text,boolean)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.apply_staff_appointment_management_with_deposit_decision(uuid,uuid,uuid,uuid,text,text,timestamptz,boolean,bigint,text,boolean,boolean,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_staff_appointment_management_with_deposit_decision(uuid,uuid,uuid,uuid,text,text,timestamptz,boolean,bigint,text,boolean,boolean,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.merge_patient_deposit_credits(uuid,uuid,uuid)', 'EXECUTE'),
  '49. Privilegios explícitos correctos en todas las funciones nuevas y compatibilidad 11-arg intacta'
);

select * from extensions.finish();
rollback;
