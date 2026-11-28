-- Pruebas pgTAP del Lote 2A de la entrega a Natalia:
--  P5: límite de horas para autogestión (bordes exactos, confirmar/personal ilimitados, snapshot y guardado)
--  P2: plazo de seña para reservas tardías (tabla completa 6 casos + bordes 168/72/48/24h + medianoche local +
--      turno manual + reprogramación + retrocompatibilidad 11 claves + cancelación automática con motivo)
--  P3: marca «No cancelar sus turnos por seña impaga» (5 roles, auditoría quién/cuándo, supresión/recuperación
--      condicionada, bloqueo en borde de vencimiento, fusión de fichas y privilegios de ejecución)
begin;
select extensions.plan(42);

create function pg_temp.l2a_id(p_key text) returns uuid language sql immutable as $$
  select ('2a000000-0000-4000-8000-' || lpad(abs(hashtext(p_key))::bigint::text, 12, '0'))::uuid
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

-- ============================================================================
-- Fixture aislado: consultorio con 5 usuarios (uno por rol), prestación y profs
-- ============================================================================
do $$
declare
  v_biz uuid := pg_temp.l2a_id('biz');
  v_owner uuid := pg_temp.l2a_id('owner');
  v_admin uuid := pg_temp.l2a_id('admin');
  v_recep uuid := pg_temp.l2a_id('reception');
  v_prof_u uuid := pg_temp.l2a_id('professional');
  v_ro uuid := pg_temp.l2a_id('readonly');
  v_svc uuid := pg_temp.l2a_id('service');
  v_prof1 uuid := pg_temp.l2a_id('prof1');
  v_prof2 uuid := pg_temp.l2a_id('prof2');
  v_prof3 uuid := pg_temp.l2a_id('prof3');
  v_prof4 uuid := pg_temp.l2a_id('prof4');
  v_prof5 uuid := pg_temp.l2a_id('prof5');
  v_prof6 uuid := pg_temp.l2a_id('prof6');
  v_pat1 uuid := pg_temp.l2a_id('pat1');
  v_pat2 uuid := pg_temp.l2a_id('pat2');
begin
  insert into auth.users(id, email) values
    (v_owner, 'owner-l2a@cita-suite.test'),
    (v_admin, 'admin-l2a@cita-suite.test'),
    (v_recep, 'recep-l2a@cita-suite.test'),
    (v_prof_u, 'prof-l2a@cita-suite.test'),
    (v_ro, 'ro-l2a@cita-suite.test');

  insert into public.businesses(id, name, slug, timezone, is_active, public_booking_enabled, allow_same_day_booking, min_booking_notice_minutes, max_booking_days_ahead)
  values (v_biz, 'Consultorio Lote 2A', 'consultorio-l2a', 'America/Argentina/Buenos_Aires', true, true, true, 0, 365);

  insert into public.business_subscriptions(business_id, commercial_access_enabled, is_permanent)
  values (v_biz, true, true)
  on conflict (business_id) do update set commercial_access_enabled = true, is_permanent = true, archived_at = null;

  insert into public.business_users(business_id, user_id, role, status, accepted_at) values
    (v_biz, v_owner, 'owner', 'active', now()),
    (v_biz, v_admin, 'admin', 'active', now()),
    (v_biz, v_recep, 'reception', 'active', now()),
    (v_biz, v_prof_u, 'professional', 'active', now()),
    (v_biz, v_ro, 'readonly', 'active', now());

  insert into public.services(id, business_id, name, duration_minutes, is_active, is_public)
  values (v_svc, v_biz, 'Consulta general', 30, true, true);

  insert into public.professionals(id, business_id, name, is_active, is_public) values
    (v_prof1, v_biz, 'Prof 1', true, true),
    (v_prof2, v_biz, 'Prof 2', true, true),
    (v_prof3, v_biz, 'Prof 3', true, true),
    (v_prof4, v_biz, 'Prof 4', true, true),
    (v_prof5, v_biz, 'Prof 5', true, true),
    (v_prof6, v_biz, 'Prof 6', true, true);

  insert into public.professional_services(business_id, professional_id, service_id)
  select v_biz, id, v_svc from public.professionals where business_id = v_biz;

  insert into public.patients(id, business_id, full_name, email, phone, phone_e164) values
    (v_pat1, v_biz, 'Paciente Uno', 'uno@l2a.test', '+5493415550001', '+5493415550001'),
    (v_pat2, v_biz, 'Paciente Dos', 'dos@l2a.test', '+5493415550002', '+5493415550002');

  update private.deposit_automation set enabled = true where singleton;
end $$;

-- ============================================================================
-- P5: ventana de autogestión (guardado, bordes exactos, confirmar/staff y snapshot)
-- ============================================================================

select extensions.is(
  private.appointment_self_management_open(timestamptz '2026-12-20 13:00:00+00', 48, timestamptz '2026-12-18 12:59:00+00'),
  true, 'P5: 48 h 01 min antes permite autogestión'
);
select extensions.is(
  private.appointment_self_management_open(timestamptz '2026-12-20 13:00:00+00', 48, timestamptz '2026-12-18 13:00:00+00'),
  true, 'P5: exactamente 48 h antes permite autogestión'
);
select extensions.is(
  private.appointment_self_management_open(timestamptz '2026-12-20 13:00:00+00', 48, timestamptz '2026-12-18 13:01:00+00'),
  false, 'P5: 47 h 59 min antes bloquea autogestión'
);
select extensions.is(
  private.appointment_self_management_open(timestamptz '2026-12-20 13:00:00+00', null, timestamptz '2026-12-20 12:59:00+00'),
  true, 'P5: campo vacío permite hasta que empieza el turno'
);

-- Guardar 48h con 7 claves + compatibilidad 6 claves (preserva 48h) + rechazo inválidos
select extensions.is(
  pg_temp.as_role(
    pg_temp.l2a_id('owner'),
    format(
      $q$select public.save_appointment_email_policy(%L, '{"email_enabled":true,"require_email":true,"show_cancel":true,"show_reschedule":true,"require_deposit_on_reschedule":true,"previous_deposit_disposition":"forfeit","self_management_cutoff_hours":48}'::jsonb, 1)::text$q$,
      pg_temp.l2a_id('biz')
    )
  ),
  '2', 'P5: dueño guarda self_management_cutoff_hours = 48 (7 claves)'
);

select extensions.is(
  pg_temp.as_role(
    pg_temp.l2a_id('admin'),
    format(
      $q$select public.save_appointment_email_policy(%L, '{"email_enabled":true,"require_email":false,"show_cancel":true,"show_reschedule":true,"require_deposit_on_reschedule":true,"previous_deposit_disposition":"forfeit"}'::jsonb, 2)::text$q$,
      pg_temp.l2a_id('biz')
    )
  ),
  '3', 'P5: payload de 6 claves (Worker anterior) sigue aceptado y conserva self_management_cutoff_hours'
);

select extensions.is(
  (select self_management_cutoff_hours from public.appointment_email_policies where business_id = pg_temp.l2a_id('biz')),
  48, 'P5: el guardado de 6 claves preservó self_management_cutoff_hours = 48'
);

select extensions.throws_ok(
  format(
    $q$select pg_temp.as_role(%L, 'select public.save_appointment_email_policy(%L, ''{"email_enabled":true,"require_email":true,"show_cancel":true,"show_reschedule":true,"require_deposit_on_reschedule":true,"previous_deposit_disposition":"forfeit","self_management_cutoff_hours":0}''::jsonb, 3)::text')$q$,
    pg_temp.l2a_id('owner'), pg_temp.l2a_id('biz')
  ),
  'P0001', 'EMAIL_POLICY_INVALID', 'P5: rechaza cutoff_hours = 0'
);

select extensions.throws_ok(
  format(
    $q$select pg_temp.as_role(%L, 'select public.save_appointment_email_policy(%L, ''{"email_enabled":true,"require_email":true,"show_cancel":true,"show_reschedule":true,"require_deposit_on_reschedule":true,"previous_deposit_disposition":"forfeit","self_management_cutoff_hours":721}''::jsonb, 3)::text')$q$,
    pg_temp.l2a_id('owner'), pg_temp.l2a_id('biz')
  ),
  'P0001', 'EMAIL_POLICY_INVALID', 'P5: rechaza cutoff_hours = 721'
);

-- Turno dentro de la ventana (24h desde ahora) y turno fuera de la ventana (72h desde ahora)
do $$
declare
  v_biz uuid := pg_temp.l2a_id('biz');
  v_svc uuid := pg_temp.l2a_id('service');
  v_pat1 uuid := pg_temp.l2a_id('pat1');
  v_inside uuid := pg_temp.l2a_id('apt_p5_inside');
  v_outside uuid := pg_temp.l2a_id('apt_p5_outside');
  v_t_in timestamptz := date_trunc('minute', now()) + interval '24 hours';
  v_t_out timestamptz := date_trunc('minute', now()) + interval '72 hours';
begin
  insert into public.appointments(id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, confirmation_token, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot)
  values
    (v_inside, v_biz, v_pat1, v_svc, pg_temp.l2a_id('prof1'), v_t_in, v_t_in + interval '30 minutes', v_t_in, v_t_in + interval '30 minutes', 'reserved', 'manual', repeat('1', 64), 'Consulta general', 'Prof 1', 30),
    (v_outside, v_biz, v_pat1, v_svc, pg_temp.l2a_id('prof2'), v_t_out, v_t_out + interval '30 minutes', v_t_out, v_t_out + interval '30 minutes', 'reserved', 'manual', repeat('2', 64), 'Consulta general', 'Prof 2', 30);
end $$;

-- Snapshot P5: dentro de ventana oculta cancel/reschedule pero conserva confirm
select extensions.is(
  (select jsonb_build_object(
    'can_cancel', s->'can_cancel',
    'can_reschedule', s->'can_reschedule',
    'can_confirm', s->'can_confirm',
    'closed', s->'self_management_window_closed',
    'hours', s->'self_management_cutoff_hours'
  ) from (select private.appointment_management_snapshot(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_inside'), null, now()) s) t),
  '{"can_cancel":false,"can_reschedule":false,"can_confirm":true,"closed":true,"hours":48}'::jsonb,
  'P5: snapshot dentro de 48h bloquea cancelar/reprogramar y conserva confirmar'
);

-- Snapshot P5: fuera de ventana permite cancel
select extensions.is(
  (select (private.appointment_management_snapshot(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_outside'), null, now())->>'can_cancel')::boolean),
  true, 'P5: snapshot fuera de 48h permite cancelar'
);

-- apply_patient_appointment_management rechaza cancel y reschedule dentro de ventana con código propio
select extensions.throws_ok(
  format(
    $q$select public.apply_patient_appointment_management(%L, true, %L, private.appointment_semantic_revision(%L, %L), 'cancel')$q$,
    repeat('1', 64), pg_temp.l2a_id('op_p5_cancel_in'), pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_inside')
  ),
  'P0001', 'APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED', 'P5: cancelar dentro de 48h devuelve APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED'
);

select extensions.throws_ok(
  format(
    $q$select public.apply_patient_appointment_management(%L, true, %L, private.appointment_semantic_revision(%L, %L), 'reschedule', now() + interval '120 hours', 1, '{}'::jsonb, null)$q$,
    repeat('1', 64), pg_temp.l2a_id('op_p5_resched_in'), pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_inside')
  ),
  'P0001', 'APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED', 'P5: reprogramar dentro de 48h devuelve APPOINTMENT_SELF_MANAGEMENT_WINDOW_CLOSED'
);

-- Confirmar asistencia sigue permitido dentro de ventana
select extensions.is(
  (public.apply_patient_appointment_management(
    repeat('1', 64), true, pg_temp.l2a_id('op_p5_confirm_in'),
    private.appointment_semantic_revision(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_inside')),
    'confirm'
  )->>'status'),
  'confirmed', 'P5: confirmar asistencia sigue permitido dentro de la ventana de 48h'
);

-- Cancelar fuera de la ventana funciona normalmente
select extensions.is(
  (public.apply_patient_appointment_management(
    repeat('2', 64), true, pg_temp.l2a_id('op_p5_cancel_out'),
    private.appointment_semantic_revision(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_outside')),
    'cancel'
  )->>'status'),
  'cancelled', 'P5: cancelar fuera de la ventana de 48h funciona normalmente'
);

-- El personal puede cancelar dentro de la ventana sin límite
select extensions.is(
  (public.apply_staff_appointment_management(
    pg_temp.l2a_id('biz'), pg_temp.l2a_id('reception'), pg_temp.l2a_id('apt_p5_inside'),
    pg_temp.l2a_id('op_p5_staff_cancel'),
    private.appointment_semantic_revision(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p5_inside')),
    'cancel', null, false, null, 'Cancelado por recepción', false
  )->>'status'),
  'cancelled', 'P5: el personal no tiene límite para cancelar dentro de 48h'
);

-- ============================================================================
-- P2: tabla completa de 6 casos + bordes 168/72/48/24h + medianoche local + 11/12 claves
-- ============================================================================

-- Referencia: 2026-12-20 10:00 AR (13:00 UTC)
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-10 13:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-13 13:00:00+00', true)::text,
  'P2 fila 1: 10 días antes -> vence 7 días antes, auto_cancel = true'
);
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-12 13:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-14 13:00:00+00', true)::text,
  'P2 fila 2: 8 días antes -> vence 48h después de reservar (6 días antes), auto_cancel = true'
);
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-16 13:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-18 13:00:00+00', true)::text,
  'P2 fila 3: 4 días antes -> vence 48h después de reservar (2 días antes), auto_cancel = true'
);
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-17 13:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-19 13:00:00+00', true)::text,
  'P2 fila 4: exactamente 72h antes -> vence 24h antes, auto_cancel = true'
);
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-17 13:01:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-19 13:01:00+00', false)::text,
  'P2 borde 71h 59m antes -> vence 23h 59m antes, corte 24h -> auto_cancel = false'
);
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-18 11:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-20 11:00:00+00', false)::text,
  'P2 fila 5: 50h antes -> vence 2h antes del turno, auto_cancel = false'
);
select extensions.is(
  (select row(due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-20 10:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-20 13:00:00+00', false)::text,
  'P2 fila 6: el mismo día -> tope al comienzo del turno, auto_cancel = false'
);
select extensions.is(
  (select row(request_from, due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 03:00:00+00', timestamptz '2026-12-10 03:00:00+00', 'America/Argentina/Buenos_Aires', 7, 168, 24, 48)),
  row(timestamptz '2026-12-13 03:00:00+00', timestamptz '2026-12-13 03:00:00+00', true)::text,
  'P2 medianoche en hora local de Argentina (00:00 AR = 03:00 UTC)'
);
select extensions.is(
  (select row(request_from, due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-18 01:00:00+00', 'America/Argentina/Buenos_Aires', 7, 48, 24, null)),
  (select row(request_from, due_at, auto_cancel)::text from private.deposit_schedule(timestamptz '2026-12-20 13:00:00+00', timestamptz '2026-12-18 01:00:00+00', 'America/Argentina/Buenos_Aires', 7, 48, 24)),
  'P2 campo vacío mantiene idéntica la sobrecarga de 6 argumentos'
);

-- save_deposit_policy con 12 claves (48h) + retrocompatibilidad 11 claves + rechazo 169
select extensions.is(
  pg_temp.as_role(
    pg_temp.l2a_id('owner'),
    format(
      $q$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"late_booking_payment_hours":48,"transfer_details":"Alias prueba.l2a","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 0)::text$q$,
      pg_temp.l2a_id('biz')
    )
  ),
  '1', 'P2: save_deposit_policy acepta 12 claves con late_booking_payment_hours = 48'
);

select extensions.is(
  pg_temp.as_role(
    pg_temp.l2a_id('owner'),
    format(
      $q$select public.save_deposit_policy(%L, '{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"transfer_details":"Alias prueba.l2a","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb, 1)::text$q$,
      pg_temp.l2a_id('biz')
    )
  ),
  '2', 'P2: save_deposit_policy sigue aceptando 11 claves (Worker anterior) preservando late_booking_payment_hours'
);

select extensions.is(
  (select late_booking_payment_hours from public.deposit_policies where business_id = pg_temp.l2a_id('biz')),
  48, 'P2: el guardado de 11 claves preservó late_booking_payment_hours = 48'
);

select extensions.throws_ok(
  format(
    $q$select pg_temp.as_role(%L, 'select public.save_deposit_policy(%L, ''{"enabled":true,"auto_cancel_enabled":true,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":168,"min_payment_hours":24,"late_booking_payment_hours":169,"transfer_details":"","applies_to_manual":true,"excluded_service_ids":[]}''::jsonb, 2)::text')$q$,
    pg_temp.l2a_id('owner'), pg_temp.l2a_id('biz')
  ),
  'P0001', 'DEPOSIT_POLICY_INVALID', 'P2: rechaza late_booking_payment_hours = 169'
);

-- Turno manual tardío (50h antes) vs turno a 4 días (96h antes) y 23 claves en reschedule_financial_terms
do $$
declare
  v_biz uuid := pg_temp.l2a_id('biz');
  v_svc uuid := pg_temp.l2a_id('service');
  v_pat1 uuid := pg_temp.l2a_id('pat1');
  v_t50 timestamptz := date_trunc('minute', now()) + interval '50 hours';
  v_t96 timestamptz := date_trunc('minute', now()) + interval '96 hours';
begin
  insert into public.appointments(id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, confirmation_token, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot)
  values
    (pg_temp.l2a_id('apt_p2_50h'), v_biz, v_pat1, v_svc, pg_temp.l2a_id('prof3'), v_t50, v_t50 + interval '30 minutes', v_t50, v_t50 + interval '30 minutes', 'reserved', 'manual', repeat('3', 64), 'Consulta general', 'Prof 3', 30),
    (pg_temp.l2a_id('apt_p2_96h'), v_biz, v_pat1, v_svc, pg_temp.l2a_id('prof4'), v_t96, v_t96 + interval '30 minutes', v_t96, v_t96 + interval '30 minutes', 'reserved', 'manual', repeat('4', 64), 'Consulta general', 'Prof 4', 30);
end $$;

select extensions.is(
  (select row(auto_cancel, late_booking_payment_hours)::text from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p2_50h')),
  row(false, 48)::text,
  'P2 turno manual a 50h: crea seña con snapshot 48h y auto_cancel = false (corte <24h)'
);
select extensions.is(
  (select row(auto_cancel, late_booking_payment_hours)::text from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p2_96h')),
  row(true, 48)::text,
  'P2 turno manual a 96h: crea seña con snapshot 48h y auto_cancel = true'
);
select extensions.is(
  (select count(*) from jsonb_object_keys(private.appointment_reschedule_financial_terms(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p2_96h'), now() + interval '120 hours', now()))),
  23::bigint,
  'P2: appointment_reschedule_financial_terms conserva exactamente 23 claves JSON para compatibilidad de reversión'
);

-- ============================================================================
-- P3: permisos 5 roles, auditoría, supresión/recuperación, no-expiración y fusión
-- ============================================================================

select extensions.is(
  (select exempt_from_deposit_auto_cancel from public.patients where id = pg_temp.l2a_id('pat1')),
  false, 'P3: paciente nuevo nace sin la marca'
);

-- Roles no autorizados (professional y readonly) rechazados
select extensions.throws_ok(
  format($q$select pg_temp.as_role(%L, 'select public.set_patient_deposit_auto_cancel_exemption(%L, %L, true)::text')$q$,
    pg_temp.l2a_id('professional'), pg_temp.l2a_id('biz'), pg_temp.l2a_id('pat1')),
  'P0001', 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN', 'P3: rol professional no puede activar la marca'
);
select extensions.throws_ok(
  format($q$select pg_temp.as_role(%L, 'select public.set_patient_deposit_auto_cancel_exemption(%L, %L, true)::text')$q$,
    pg_temp.l2a_id('readonly'), pg_temp.l2a_id('biz'), pg_temp.l2a_id('pat1')),
  'P0001', 'PATIENT_DEPOSIT_EXEMPTION_FORBIDDEN', 'P3: rol readonly no puede activar la marca'
);

-- Recepción activa la marca: suprime auto_cancel en apt_p2_96h (NO toca apt_p2_50h que ya era false por corte <24h)
select extensions.is(
  (pg_temp.as_role(
    pg_temp.l2a_id('reception'),
    format($q$select public.set_patient_deposit_auto_cancel_exemption(%L, %L, true)::text$q$, pg_temp.l2a_id('biz'), pg_temp.l2a_id('pat1'))
  )::jsonb->>'updated_deposits')::integer,
  1, 'P3: recepción activa la marca y suprime exactamente la seña elegible (apt_p2_96h)'
);

select extensions.is(
  (select row(exempt_from_deposit_auto_cancel, exempt_from_deposit_auto_cancel_updated_by = pg_temp.l2a_id('reception'), exempt_from_deposit_auto_cancel_updated_at is not null, exempt_from_deposit_auto_cancel_updated_by_name)::text
   from public.patients where id = pg_temp.l2a_id('pat1')),
  row(true, true, true, 'recep-l2a@cita-suite.test')::text,
  'P3: queda registrado quién y cuándo activó la marca en la ficha del paciente'
);

select extensions.is(
  (select count(*) from public.audit_logs where business_id = pg_temp.l2a_id('biz') and action = 'patient.deposit_auto_cancel_exemption_updated' and entity_id = pg_temp.l2a_id('pat1')),
  1::bigint, 'P3: queda auditoría del cambio en audit_logs'
);

-- Borde de vencimiento: forzando due_at en el pasado reciente, expire_unpaid_deposits NO cancela al paciente con P3
select extensions.is(
  (select private.expire_unpaid_deposits((select due_at + interval '1 minute' from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p2_96h')), 100)),
  0, 'P3: la cancelación automática no corre en el borde del vencimiento para paciente marcado'
);

-- Nuevo turno para paciente marcado sigue pidiendo seña pero nace con auto_cancel = false
do $$
declare
  v_t10d timestamptz := date_trunc('minute', now()) + interval '240 hours';
begin
  insert into public.appointments(id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, confirmation_token, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot)
  values (pg_temp.l2a_id('apt_p3_new'), pg_temp.l2a_id('biz'), pg_temp.l2a_id('pat1'), pg_temp.l2a_id('service'), pg_temp.l2a_id('prof5'), v_t10d, v_t10d + interval '30 minutes', v_t10d, v_t10d + interval '30 minutes', 'reserved', 'manual', repeat('5', 64), 'Consulta general', 'Prof 5', 30);
end $$;

select extensions.is(
  (select row(status, auto_cancel, auto_cancel_suppressed_by_patient_exemption)::text from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p3_new')),
  row('pending', false, true)::text,
  'P3: turno nuevo de paciente marcado sigue pidiendo seña pero con auto_cancel = false'
);

-- Admin desactiva la marca: apt_p3_new (quedan >24h) recupera auto_cancel = true, apt_p2_50h (corte <24h) SIGUE false!
select extensions.is(
  (pg_temp.as_role(
    pg_temp.l2a_id('admin'),
    format($q$select public.set_patient_deposit_auto_cancel_exemption(%L, %L, false)::text$q$, pg_temp.l2a_id('biz'), pg_temp.l2a_id('pat1'))
  )::jsonb->>'exempt')::boolean,
  false, 'P3: admin puede quitar la marca'
);

select extensions.is(
  (select row(
    (select auto_cancel from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p3_new')),
    (select auto_cancel from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p2_50h'))
  )::text),
  row(true, false)::text,
  'P3: al desactivar la marca recupera auto_cancel sólo cuando queda tiempo mínimo y nunca en reservas tardías (<24h)'
);

-- Dueño también puede activar la marca; regla de fusión y privilegios
select extensions.is(
  (pg_temp.as_role(
    pg_temp.l2a_id('owner'),
    format($q$select public.set_patient_deposit_auto_cancel_exemption(%L, %L, true)::text$q$, pg_temp.l2a_id('biz'), pg_temp.l2a_id('pat2'))
  )::jsonb->>'exempt')::boolean,
  true, 'P3: owner puede activar la marca'
);

-- Auto-cancelación en paciente NO marcado (pat1 ahora desmarcado) marca cancelled_by_deposit_expiry = true en snapshot
select extensions.is(
  (select private.expire_deposit_if_still_due(pg_temp.l2a_id('apt_p2_96h'), (select due_at + interval '1 minute' from public.appointment_deposits where appointment_id = pg_temp.l2a_id('apt_p2_96h')))),
  true, 'P2: paciente sin marca con seña vencida se cancela automáticamente'
);

select extensions.is(
  (select (private.appointment_management_snapshot(pg_temp.l2a_id('biz'), pg_temp.l2a_id('apt_p2_96h'), null, now())->>'cancelled_by_deposit_expiry')::boolean),
  true, 'P2: snapshot de turno cancelado por seña impaga expone cancelled_by_deposit_expiry = true'
);

select extensions.is(
  row(
    private.merge_patient_deposit_exemption(true, false),
    private.merge_patient_deposit_exemption(false, true),
    private.merge_patient_deposit_exemption(false, false)
  )::text,
  row(true, true, false)::text,
  'P3: regla de unificación conserva la marca si cualquiera de las dos fichas la tenía'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.set_patient_deposit_auto_cancel_exemption(uuid,uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_patient_deposit_auto_cancel_exemption(uuid,uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.set_patient_deposit_auto_cancel_exemption(uuid,uuid,boolean)', 'EXECUTE'),
  'P3: privilegios explícitos sólo para authenticated en set_patient_deposit_auto_cancel_exemption'
);

select * from extensions.finish();
rollback;
