-- Contratos SQL del Lote 0 de entrega a Natalia (D1, D2, D3).
-- Todo es sintético y se revierte con rollback.
begin;
select extensions.plan(26);

create temporary table lote0_fixture(label text primary key, value text not null);
grant select on lote0_fixture to authenticated;
create function pg_temp.l0v(label text) returns text language sql as $$select value from lote0_fixture where lote0_fixture.label = $1$$;
create function pg_temp.l0id(label text) returns uuid language sql as $$select pg_temp.l0v($1)::uuid$$;
create function pg_temp.l0ts() returns timestamptz language sql as $$select date_trunc('hour', clock_timestamp()) + interval '10 days'$$;

create function pg_temp.l0_book(
  p_business uuid,
  p_patient uuid,
  p_service uuid,
  p_prof uuid,
  p_starts timestamptz,
  p_status text default 'reserved'
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.appointments(
    id, business_id, patient_id, service_id, professional_id,
    starts_at, ends_at, blocking_starts_at, blocking_ends_at,
    status, source, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
  ) values (
    v_id, p_business, p_patient, p_service, p_prof,
    p_starts, p_starts + interval '30 minutes', p_starts, p_starts + interval '30 minutes',
    p_status, 'manual', 'Consulta sintética', 'Profesional sintético', 30
  );
  return v_id;
end $$;

create function pg_temp.l0_cov(p_business uuid, p_apt uuid, p_now timestamptz) returns boolean
language sql as $$
  select coalesce((select covered from public.list_appointment_email_reminder_coverage(p_business, array[p_apt], p_now) limit 1), false)
$$;

do $$
declare
  b1 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  owner1 uuid := gen_random_uuid();
  admin1 uuid := gen_random_uuid();
  recep1 uuid := gen_random_uuid();
  prof1_u uuid := gen_random_uuid();
  ro1 uuid := gen_random_uuid();
  owner2 uuid := gen_random_uuid();
  owner3 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  f1 uuid := gen_random_uuid();
  f2 uuid := gen_random_uuid();
  f3 uuid := gen_random_uuid();
  integ1 uuid := gen_random_uuid();
  p_ok uuid := gen_random_uuid();
  p_bare uuid := gen_random_uuid();
  p_invalid uuid := gen_random_uuid();
  p_unsub uuid := gen_random_uuid();
  p_bounced uuid := gen_random_uuid();
  p_b2 uuid := gen_random_uuid();
  p_b3 uuid := gen_random_uuid();
begin
  insert into auth.users(id, email)
  select u, 'lote0-' || u || '@example.test'
  from unnest(array[owner1, admin1, recep1, prof1_u, ro1, owner2, owner3]) u;

  insert into public.businesses(id, name, slug, industry, timezone, phone, address, address_instructions, maps_url, public_contact_enabled, whatsapp_contact_enabled, whatsapp_phone, public_booking_enabled)
  values
    (b1, 'Consultorio Lote 0', 'lote0-' || left(b1::text, 8), 'medicine', 'America/Argentina/Cordoba', '+54 342 429-3471', 'Presidente Roca 2906', 'Portón rojo, timbre 4B', 'https://maps.app.goo.gl/lote0', true, true, '+5493424293471', true),
    (b2, 'Consultorio Sin Remitente', 'lote0-sin-' || left(b2::text, 8), 'medicine', 'America/Argentina/Cordoba', null, null, null, null, false, false, null, true),
    (b3, 'Consultorio Correos Apagados', 'lote0-off-' || left(b3::text, 8), 'medicine', 'America/Argentina/Cordoba', null, null, null, null, false, false, null, true);

  update public.business_subscriptions
  set commercial_access_enabled = true, is_permanent = true, subscription_status = 'active',
      paid_until = null, grace_until = null, restricted_until = null, archived_at = null
  where business_id in (b1, b2, b3);

  insert into public.business_users(business_id, user_id, role, status, accepted_at) values
    (b1, owner1, 'owner', 'active', now()),
    (b1, admin1, 'admin', 'active', now()),
    (b1, recep1, 'reception', 'active', now()),
    (b1, prof1_u, 'professional', 'active', now()),
    (b1, ro1, 'readonly', 'active', now()),
    (b2, owner2, 'owner', 'active', now()),
    (b3, owner3, 'owner', 'active', now());

  insert into public.services(id, business_id, name, duration_minutes, is_active, is_public) values
    (s1, b1, 'Primera consulta', 30, true, true),
    (s2, b2, 'Primera consulta', 30, true, true),
    (s3, b3, 'Primera consulta', 30, true, true);

  insert into public.professionals(id, business_id, name, is_active, is_public) values
    (f1, b1, 'Dra. Lote Cero', true, true),
    (f2, b2, 'Dr. Sin Remitente', true, true),
    (f3, b3, 'Dr. Apagado', true, true);

  insert into public.professional_services(business_id, professional_id, service_id) values
    (b1, f1, s1), (b2, f2, s2), (b3, f3, s3);

  insert into public.booking_integrations(id, business_id, public_key, name, theme, is_active, allowed_origins, allowed_service_ids, allowed_professional_ids, allowed_modalities, video_instructions)
  values (integ1, b1, repeat('d', 32), 'Web Lote 0', 'natalia', true, array['https://lote0.example.test'], array[s1], array[f1], array['in_person', 'video'], 'Conectate a la consulta online por Meet 5 min antes.');

  insert into public.patients(id, business_id, owner_id, full_name, phone_e164, email) values
    (p_ok, b1, owner1, 'Paciente Con Correo', '+5493511000001', 'valido@example.test'),
    (p_bare, b1, owner1, 'Paciente Sin Correo', '+5493511000002', null),
    (p_invalid, b1, owner1, 'Paciente Correo Inválido', '+5493511000003', 'no-es-correo'),
    (p_unsub, b1, owner1, 'Paciente Dado de Baja', '+5493511000004', 'baja@example.test'),
    (p_bounced, b1, owner1, 'Paciente Rebotado', '+5493511000005', 'rebote@example.test'),
    (p_b2, b2, owner2, 'Paciente B2', '+5493511000006', 'b2@example.test'),
    (p_b3, b3, owner3, 'Paciente B3', '+5493511000007', 'b3@example.test');

  update private.appointment_management_runtime set email_producer_enabled = true;
  perform public.operator_set_business_email_sender(b1, 'lote0-uno.cita-suite.com.ar', 'verified');
  perform public.operator_set_business_email_sender(b3, 'lote0-tres.cita-suite.com.ar', 'verified');
  update public.appointment_email_policies set email_enabled = false where business_id = b3;

  insert into private.email_suppressions(business_id, email_normalized, reason) values
    (b1, 'baja@example.test', 'unsubscribe'),
    (b1, 'rebote@example.test', 'hard_bounce');

  insert into lote0_fixture values
    ('b1', b1::text), ('b2', b2::text), ('b3', b3::text),
    ('owner1', owner1::text), ('admin1', admin1::text), ('recep1', recep1::text),
    ('prof1_u', prof1_u::text), ('ro1', ro1::text), ('owner2', owner2::text), ('owner3', owner3::text),
    ('s1', s1::text), ('s2', s2::text), ('s3', s3::text),
    ('f1', f1::text), ('f2', f2::text), ('f3', f3::text), ('integ1', integ1::text),
    ('p_ok', p_ok::text), ('p_bare', p_bare::text), ('p_invalid', p_invalid::text),
    ('p_unsub', p_unsub::text), ('p_bounced', p_bounced::text), ('p_b2', p_b2::text), ('p_b3', p_b3::text);
end $$;

-- ============================================================================
-- 1-2. D1: snapshot separa estrictamente address_instructions y video_instructions
-- ============================================================================
do $$
declare
  a_pres uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), pg_temp.l0ts());
  a_virt uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), pg_temp.l0ts() + interval '2 hours');
  snap_pres jsonb;
  snap_virt jsonb;
begin
  insert into public.appointment_booking_contexts(
    appointment_id, business_id, integration_id, integration_revision, contract_version,
    theme_snapshot, entry_point, modality, video_instructions_snapshot, context_fingerprint
  ) values (
    a_virt, pg_temp.l0id('b1'), pg_temp.l0id('integ1'), 1, 1,
    'natalia', 'embed', 'video', 'Conectate a la consulta online por Meet 5 min antes.', repeat('e', 64)
  );
  snap_pres := private.appointment_management_snapshot(pg_temp.l0id('b1'), a_pres, null, clock_timestamp());
  snap_virt := private.appointment_management_snapshot(pg_temp.l0id('b1'), a_virt, null, clock_timestamp());
  insert into lote0_fixture values ('snap_pres', snap_pres::text), ('snap_virt', snap_virt::text);
end $$;

select extensions.ok(
  (pg_temp.l0v('snap_virt')::jsonb->>'modality') = 'video'
  and (pg_temp.l0v('snap_virt')::jsonb->'business'->>'address') is null
  and (pg_temp.l0v('snap_virt')::jsonb->'business'->>'address_instructions') is null
  and (pg_temp.l0v('snap_virt')::jsonb->'business'->>'maps_url') is null
  and (pg_temp.l0v('snap_virt')::jsonb->'integration'->>'video_instructions_snapshot') = 'Conectate a la consulta online por Meet 5 min antes.',
  '1. D1: virtual snapshot keeps business.address_instructions null and exposes online instructions only in integration.video_instructions_snapshot'
);

select extensions.ok(
  (pg_temp.l0v('snap_pres')::jsonb->>'modality') = 'in_person'
  and (pg_temp.l0v('snap_pres')::jsonb->'business'->>'address') = 'Presidente Roca 2906'
  and (pg_temp.l0v('snap_pres')::jsonb->'business'->>'address_instructions') = 'Portón rojo, timbre 4B'
  and (pg_temp.l0v('snap_pres')::jsonb->'business'->>'maps_url') = 'https://maps.app.goo.gl/lote0'
  and (pg_temp.l0v('snap_pres')::jsonb->'integration'->>'video_instructions_snapshot') is null,
  '2. D1: presencial snapshot exposes address, arrival instructions and maps_url without online instructions'
);

-- ============================================================================
-- 3-8. D2: get_email_unsubscribe_state (privilegios, activo, vencido, inválido)
-- ============================================================================
select extensions.ok(
  has_function_privilege('service_role', 'public.get_email_unsubscribe_state(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_email_unsubscribe_state(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_email_unsubscribe_state(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_email_unsubscribe(text)', 'EXECUTE'),
  '3. D2: get_email_unsubscribe_state is service_role-only and preserves get_email_unsubscribe(text)'
);

do $$
declare
  tok_active text := repeat('1', 64);
  tok_expired text := repeat('2', 64);
begin
  insert into private.email_unsubscribe_tokens(token_hash, business_id, email_normalized, expires_at) values
    (encode(extensions.digest(tok_active, 'sha256'), 'hex'), pg_temp.l0id('b1'), 'valido@example.test', clock_timestamp() + interval '1 day'),
    (encode(extensions.digest(tok_expired, 'sha256'), 'hex'), pg_temp.l0id('b1'), 'valido@example.test', clock_timestamp() - interval '1 minute');
  insert into lote0_fixture values ('tok_active', tok_active), ('tok_expired', tok_expired);
end $$;

select extensions.ok(
  (select r->>'status' = 'active' and r->>'business_name' = 'Consultorio Lote 0' and (r->>'unsubscribed')::boolean = false
    and r->'contact'->>'phone' = '+54 342 429-3471' and r->'contact'->>'whatsapp_phone' = '+5493424293471'
   from (select public.get_email_unsubscribe_state(pg_temp.l0v('tok_active')) as r) q),
  '4. D2: active token returns active state, business name and public contact'
);

select extensions.ok(
  (select r->>'status' = 'expired' and r->>'business_name' = 'Consultorio Lote 0'
    and r->'contact'->>'phone' = '+54 342 429-3471' and r->'contact'->>'whatsapp_phone' = '+5493424293471'
    and public.get_email_unsubscribe(pg_temp.l0v('tok_expired')) is null
   from (select public.get_email_unsubscribe_state(pg_temp.l0v('tok_expired')) as r) q),
  '5. D2: expired token exposes public contact via get_email_unsubscribe_state while legacy get_email_unsubscribe keeps returning null'
);

update public.businesses set public_contact_enabled = false where id = pg_temp.l0id('b1');
select extensions.ok(
  (select r->>'status' = 'expired' and r->'contact'->>'phone' is null and r->'contact'->>'whatsapp_phone' = '+5493424293471'
   from (select public.get_email_unsubscribe_state(pg_temp.l0v('tok_expired')) as r) q),
  '6. D2: expired token hides phone when public_contact_enabled=false while keeping public WhatsApp'
);
update public.businesses set public_contact_enabled = true where id = pg_temp.l0id('b1');

select extensions.ok(
  (select r->>'status' = 'invalid' and not (r ? 'business_name') and not (r ? 'contact')
   from (select public.get_email_unsubscribe_state(repeat('f', 64)) as r) q)
  and (public.get_email_unsubscribe_state('malformed-token')->>'status') = 'invalid',
  '7. D2: unknown or malformed token returns invalid without revealing any clinic'
);

select extensions.throws_ok(
  $$select public.apply_email_unsubscribe(pg_temp.l0v('tok_expired'))$$,
  'P0001', 'EMAIL_UNSUBSCRIBE_UNAVAILABLE',
  '8. D2: apply_email_unsubscribe still rejects expired tokens'
);

-- ============================================================================
-- 9-12. D3: privilegios, roles, aislamiento y límites de la RPC autenticada
-- ============================================================================
select extensions.ok(
  has_function_privilege('authenticated', 'public.list_appointment_email_reminder_coverage(uuid,uuid[],timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_appointment_email_reminder_coverage(uuid,uuid[],timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.appointment_email_reminder_24h_covered(uuid,uuid,timestamptz)', 'EXECUTE'),
  '9. D3: authenticated executes only the guarded coverage RPC, never anon or private helpers'
);

do $$
declare
  a_b1 uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), pg_temp.l0ts() + interval '1 day');
  a_b2 uuid := pg_temp.l0_book(pg_temp.l0id('b2'), pg_temp.l0id('p_b2'), pg_temp.l0id('s2'), pg_temp.l0id('f2'), pg_temp.l0ts() + interval '1 day');
  v_role text;
  v_uid text;
begin
  insert into lote0_fixture values ('perm_a1', a_b1::text), ('perm_a2', a_b2::text);
  foreach v_uid in array array['owner1', 'admin1', 'recep1'] loop
    perform set_config('request.jwt.claim.sub', pg_temp.l0v(v_uid), true);
    if not pg_temp.l0_cov(pg_temp.l0id('b1'), a_b1, pg_temp.l0ts() + interval '1 day' - interval '30 hours') then
      raise exception 'ALLOWED_ROLE_DENIED_%', v_uid;
    end if;
    -- Cross-tenant IDs passed in array are ignored and never returned
    if exists(select 1 from public.list_appointment_email_reminder_coverage(pg_temp.l0id('b1'), array[a_b2], clock_timestamp())) then
      raise exception 'CROSS_TENANT_LEAK';
    end if;
  end loop;
  foreach v_uid in array array['prof1_u', 'ro1', 'owner2'] loop
    perform set_config('request.jwt.claim.sub', pg_temp.l0v(v_uid), true);
    begin
      perform * from public.list_appointment_email_reminder_coverage(pg_temp.l0id('b1'), array[a_b1], clock_timestamp());
      raise exception 'FORBIDDEN_ROLE_ALLOWED_%', v_uid;
    exception when others then
      if sqlerrm is distinct from 'APPOINTMENT_MANAGEMENT_FORBIDDEN' then raise; end if;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
select extensions.pass('10. D3: owner/admin/reception allowed with tenant isolation; professional/readonly/outsider forbidden');

update public.business_subscriptions set commercial_access_enabled = false where business_id = pg_temp.l0id('b1');
select set_config('request.jwt.claim.sub', pg_temp.l0v('owner1'), true);
select extensions.throws_ok(
  $$select * from public.list_appointment_email_reminder_coverage(pg_temp.l0id('b1'), array[pg_temp.l0id('perm_a1')], clock_timestamp())$$,
  'P0001', 'APPOINTMENT_MANAGEMENT_FORBIDDEN',
  '11. D3: restricted business cannot query reminder coverage'
);
update public.business_subscriptions set commercial_access_enabled = true where business_id = pg_temp.l0id('b1');

select extensions.throws_ok(
  $$select * from public.list_appointment_email_reminder_coverage(pg_temp.l0id('b1'), array(select gen_random_uuid() from generate_series(1, 501)), clock_timestamp())$$,
  'P0001', 'REMINDER_COVERAGE_BATCH_INVALID',
  '12. D3: batch above 500 appointment IDs is rejected'
);

-- ============================================================================
-- 13-25. D3: todos los casos límite de cobertura por correo
-- ============================================================================
-- Base clock: T = l0ts() + 5 days (e.g. tomorrow 15:00). Morning = T - 30h (today 09:00).
-- Due = T - 24h (today 15:00). Expiry = T - 23h30m (today 15:30).

do $$
declare
  v_t timestamptz := pg_temp.l0ts() + interval '5 days';
  v_morning timestamptz := v_t - interval '30 hours';
  a_morning uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
  a_bare uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_bare'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t + interval '1 hour');
  a_unsub uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_unsub'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t + interval '2 hours');
  a_b2 uuid := pg_temp.l0_book(pg_temp.l0id('b2'), pg_temp.l0id('p_b2'), pg_temp.l0id('s2'), pg_temp.l0id('f2'), v_t + interval '3 hours');
  a_b3 uuid := pg_temp.l0_book(pg_temp.l0id('b3'), pg_temp.l0id('p_b3'), pg_temp.l0id('s3'), pg_temp.l0id('f3'), v_t + interval '4 hours');
begin
  update public.appointment_management_states
  set schedule_changed_at = v_t - interval '48 hours'
  where appointment_id in (a_morning, a_bare, a_unsub, a_b2, a_b3);
  insert into lote0_fixture values
    ('t_base', v_t::text), ('t_morning', v_morning::text),
    ('a_morning', a_morning::text), ('a_bare', a_bare::text), ('a_unsub', a_unsub::text),
    ('a_b2', a_b2::text), ('a_b3', a_b3::text);
end $$;

select set_config('request.jwt.claim.sub', pg_temp.l0v('owner1'), true);
select extensions.is(
  pg_temp.l0_cov(pg_temp.l0id('b1'), pg_temp.l0id('a_morning'), pg_temp.l0v('t_morning')::timestamptz),
  true,
  '13. D3 (defecto base): a la mañana, un turno de mañana a la tarde con correo válido está cubierto antes de que abra la ventana de 24 h'
);

select extensions.is(
  pg_temp.l0_cov(pg_temp.l0id('b1'), pg_temp.l0id('a_bare'), pg_temp.l0v('t_morning')::timestamptz),
  false,
  '14. D3: paciente sin correo no está cubierto'
);

select extensions.is(
  pg_temp.l0_cov(pg_temp.l0id('b1'), pg_temp.l0id('a_unsub'), pg_temp.l0v('t_morning')::timestamptz),
  false,
  '15. D3: paciente dado de baja no está cubierto'
);

select set_config('request.jwt.claim.sub', pg_temp.l0v('owner2'), true);
select extensions.is(
  pg_temp.l0_cov(pg_temp.l0id('b2'), pg_temp.l0id('a_b2'), pg_temp.l0v('t_morning')::timestamptz),
  false,
  '16. D3: consultorio sin remitente listo no está cubierto'
);

select set_config('request.jwt.claim.sub', pg_temp.l0v('owner3'), true);
select extensions.is(
  pg_temp.l0_cov(pg_temp.l0id('b3'), pg_temp.l0id('a_b3'), pg_temp.l0v('t_morning')::timestamptz),
  false,
  '17. D3: consultorio con correos apagados no está cubierto'
);

-- Global producer disabled -> false
select set_config('request.jwt.claim.sub', pg_temp.l0v('owner1'), true);
update private.appointment_management_runtime set email_producer_enabled = false;
select extensions.is(
  pg_temp.l0_cov(pg_temp.l0id('b1'), pg_temp.l0id('a_morning'), pg_temp.l0v('t_morning')::timestamptz),
  false,
  '18. D3: con interruptor global de correo apagado no está cubierto'
);
update private.appointment_management_runtime set email_producer_enabled = true;

-- Reserva dentro de la ventana de 24 h: sin comprobante (false), con comprobante aceptado (true), si rebota (false)
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '10 hours';
  v_booked timestamptz := v_t - interval '18 hours';
  v_check timestamptz := v_t - interval '17 hours';
  a_late uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
  v_before boolean; v_after boolean; v_bounced boolean;
begin
  update public.appointment_management_states set schedule_changed_at = v_booked where appointment_id = a_late;
  v_before := pg_temp.l0_cov(pg_temp.l0id('b1'), a_late, v_check);
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, accepted_at, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_late, 'booking_receipt', 'booking_receipt:1', 1, 'accepted',
    v_booked, v_t, v_booked + interval '2 minutes', pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  v_after := pg_temp.l0_cov(pg_temp.l0id('b1'), a_late, v_check);
  update private.appointment_email_deliveries set state = 'bounced', bounced_at = v_check
  where appointment_id = a_late and purpose = 'booking_receipt';
  v_bounced := pg_temp.l0_cov(pg_temp.l0id('b1'), a_late, v_check);
  if v_before is distinct from false or v_after is distinct from true or v_bounced is distinct from false then
    raise exception 'LATE_RECEIPT_CASE_FAILED before=% after=% bounced=%', v_before, v_after, v_bounced;
  end if;
end $$;
select extensions.pass('19. D3: reserva dentro de la ventana de 24 h cuenta con comprobante salido y deja de contar si rebota');

-- Entrega fallida de reminder_24h -> false (incluso antes de cerrar la ventana de 30 min)
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '12 hours';
  a_fail uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
begin
  update public.appointment_management_states set schedule_changed_at = v_t - interval '48 hours' where appointment_id = a_fail;
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, failure_code, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_fail, 'reminder_24h', 'reminder_24h:1', 1, 'failed',
    v_t - interval '24 hours', v_t - interval '23 hours 30 minutes', 'http_500', pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_fail, v_t - interval '23 hours 50 minutes') then
    raise exception 'FAILED_DELIVERY_STILL_COVERED';
  end if;
end $$;
select extensions.pass('20. D3: entrega fallida de reminder_24h deja de contar de inmediato');

-- Rebote de reminder_24h -> false
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '14 hours';
  a_bounce uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
begin
  update public.appointment_management_states set schedule_changed_at = v_t - interval '48 hours' where appointment_id = a_bounce;
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, accepted_at, bounced_at, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_bounce, 'reminder_24h', 'reminder_24h:1', 1, 'bounced',
    v_t - interval '24 hours', v_t - interval '23 hours 30 minutes', v_t - interval '23 hours 58 minutes', v_t - interval '23 hours 55 minutes',
    pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_bounce, v_t - interval '20 hours') then
    raise exception 'BOUNCED_DELIVERY_STILL_COVERED';
  end if;
end $$;
select extensions.pass('21. D3: rebote de reminder_24h deja de contar y devuelve el turno a la lista');

-- Entrega vencida sin salir (pendiente vencida, descartada:expired y ventana vencida sin fila) -> false
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '16 hours';
  a_exp_pending uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
  a_exp_disc uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t + interval '1 hour');
  a_exp_missed uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t + interval '2 hours');
begin
  update public.appointment_management_states set schedule_changed_at = v_t - interval '48 hours'
  where appointment_id in (a_exp_pending, a_exp_disc, a_exp_missed);
  insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, state, due_at, expires_at)
  values (pg_temp.l0id('b1'), a_exp_pending, 'reminder_24h', 'reminder_24h:1', 1, 'pending', v_t - interval '24 hours', v_t - interval '23 hours 30 minutes');
  insert into private.appointment_email_deliveries(business_id, appointment_id, purpose, dedupe_key, schedule_revision, state, due_at, expires_at, discard_reason)
  values (pg_temp.l0id('b1'), a_exp_disc, 'reminder_24h', 'reminder_24h:1', 1, 'discarded', v_t - interval '23 hours', v_t - interval '22 hours 30 minutes', 'expired');
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_exp_pending, v_t - interval '23 hours 29 minutes') then raise exception 'EXPIRED_PENDING_STILL_COVERED'; end if;
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_exp_disc, v_t - interval '22 hours') then raise exception 'DISCARDED_EXPIRED_STILL_COVERED'; end if;
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_exp_missed, v_t - interval '21 hours 30 minutes') then raise exception 'MISSED_WINDOW_STILL_COVERED'; end if;
end $$;
select extensions.pass('22. D3: entrega vencida sin salir (pendiente vencida, descartada o ventana perdida) deja de contar');

-- Reprogramación: invalida la entrega de la revisión anterior y evalúa la nueva revisión
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '20 hours';
  a_move uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
  v_t_new timestamptz := v_t + interval '4 hours';
begin
  update public.appointment_management_states set schedule_changed_at = v_t - interval '48 hours' where appointment_id = a_move;
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, accepted_at, delivered_at, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_move, 'reminder_24h', 'reminder_24h:1', 1, 'delivered',
    v_t - interval '24 hours', v_t - interval '23 hours 30 minutes', v_t - interval '23 hours 58 minutes', v_t - interval '23 hours 57 minutes',
    pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  if not pg_temp.l0_cov(pg_temp.l0id('b1'), a_move, v_t - interval '20 hours') then raise exception 'REV1_DELIVERED_NOT_COVERED'; end if;
  -- Reprogramar sube schedule_revision a 2 y cambia schedule_changed_at
  update public.appointments set starts_at = v_t_new, ends_at = v_t_new + interval '30 minutes',
    blocking_starts_at = v_t_new, blocking_ends_at = v_t_new + interval '30 minutes' where id = a_move;
  -- Simulamos reprogramación dentro de las 24 h del nuevo horario (sin comprobante todavía)
  update public.appointment_management_states set schedule_changed_at = v_t_new - interval '12 hours' where appointment_id = a_move;
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_move, v_t_new - interval '11 hours') then
    raise exception 'REV1_DELIVERY_LEAKED_TO_REV2';
  end if;
  -- Cuando sale el comprobante de reprogramación (revisión 2), vuelve a quedar cubierto
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, accepted_at, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_move, 'reschedule_receipt', 'reschedule_receipt:2', 2, 'accepted',
    v_t_new - interval '12 hours', v_t_new, v_t_new - interval '11 hours 58 minutes', pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  if not pg_temp.l0_cov(pg_temp.l0id('b1'), a_move, v_t_new - interval '11 hours') then
    raise exception 'REV2_RECEIPT_NOT_COVERED';
  end if;
end $$;
select extensions.pass('23. D3: reprogramación invalida la cobertura de la revisión vieja y vuelve a cubrir cuando sale el comprobante de la nueva');

-- Comprobante aceptado dentro de los 30 min previos al recordatorio (covered_by_receipt)
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '30 hours';
  a_near uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
  v_claim jsonb;
begin
  update private.appointment_email_events set processed_at = clock_timestamp() where processed_at is null;
  update private.appointment_email_deliveries set state = 'discarded', discard_reason = 'test_cleared', lease_token = null, lease_expires_at = null
  where state in ('pending', 'retry', 'sending', 'uncertain');
  update private.appointment_email_deliveries set started_at = null;
  update public.appointment_management_states set schedule_changed_at = v_t - interval '24 hours 20 minutes' where appointment_id = a_near;
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, accepted_at, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_near, 'booking_receipt', 'booking_receipt:1', 1, 'accepted',
    v_t - interval '24 hours 20 minutes', v_t, v_t - interval '24 hours 15 minutes', pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  -- Al abrir la ventana de 24 h, claim descarta reminder_24h como covered_by_receipt
  perform set_config('request.jwt.claim.sub', '', true);
  v_claim := public.claim_appointment_email_batch(20, v_t - interval '24 hours');
  if not exists(select 1 from private.appointment_email_deliveries where appointment_id = a_near and purpose = 'reminder_24h' and state = 'discarded' and discard_reason = 'covered_by_receipt') then
    raise exception 'COVERED_BY_RECEIPT_NOT_DISCARDED';
  end if;
  perform set_config('request.jwt.claim.sub', pg_temp.l0v('owner1'), true);
  if not pg_temp.l0_cov(pg_temp.l0id('b1'), a_near, v_t - interval '23 hours 50 minutes') then
    raise exception 'COVERED_BY_RECEIPT_LOST_COVERAGE';
  end if;
end $$;
select extensions.pass('24. D3: cuando el despachador descarta reminder_24h por covered_by_receipt, la lista mantiene la cobertura');

-- Entrega en estado uncertain (lease vencido) -> false
do $$
declare
  v_t timestamptz := pg_temp.l0v('t_base')::timestamptz + interval '34 hours';
  a_unc uuid := pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t);
begin
  update public.appointment_management_states set schedule_changed_at = v_t - interval '48 hours' where appointment_id = a_unc;
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, failure_code, patient_id, contact_revision, recipient_email
  ) values (
    pg_temp.l0id('b1'), a_unc, 'reminder_24h', 'reminder_24h:1', 1, 'uncertain',
    v_t - interval '24 hours', v_t - interval '23 hours 30 minutes', 'lease_expired', pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  );
  if pg_temp.l0_cov(pg_temp.l0id('b1'), a_unc, v_t - interval '20 hours') then
    raise exception 'UNCERTAIN_STILL_COVERED';
  end if;
end $$;
select extensions.pass('25. D3: entrega en comprobación (uncertain) no oculta el turno');

-- ============================================================================
-- 26. D3 (Aprobación #3): paridad exacta entre el planificador y la lista
--     sobre la misma serie de casos, sin admitir diferencias
-- ============================================================================
do $$
declare
  v_t timestamptz := pg_temp.l0ts() + interval '15 days';
  v_morning timestamptz := v_t - interval '30 hours';
  v_due timestamptz := v_t - interval '24 hours';
  v_claim jsonb;
  v_mismatch integer;
begin
  -- Limpiar trabajo previo pendiente para aislar esta serie de casos
  update private.appointment_email_events set processed_at = clock_timestamp() where processed_at is null;
  update private.appointment_email_deliveries set state = 'discarded', discard_reason = 'test_cleared', lease_token = null, lease_expires_at = null
  where state in ('pending', 'retry', 'sending', 'uncertain');
  update private.appointment_email_deliveries set started_at = null;

  create temporary table parity_cases(
    label text primary key,
    business_id uuid not null,
    owner_id uuid not null,
    appointment_id uuid not null,
    expected boolean not null,
    list_covered boolean,
    planner_covered boolean
  ) on commit drop;

  insert into parity_cases(label, business_id, owner_id, appointment_id, expected) values
    ('valid_email',        pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'),      pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), true),
    ('no_email',           pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_bare'),    pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), false),
    ('invalid_email',      pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_invalid'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), false),
    ('unsubscribed',       pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_unsub'),   pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), false),
    ('hard_bounced',       pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_bounced'), pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), false),
    ('at_boundary_no_rcp', pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'),      pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), false),
    ('near_with_receipt',  pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'),      pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t), true),
    ('sender_not_ready',   pg_temp.l0id('b2'), pg_temp.l0id('owner2'), pg_temp.l0_book(pg_temp.l0id('b2'), pg_temp.l0id('p_b2'),      pg_temp.l0id('s2'), pg_temp.l0id('f2'), v_t), false),
    ('email_disabled',     pg_temp.l0id('b3'), pg_temp.l0id('owner3'), pg_temp.l0_book(pg_temp.l0id('b3'), pg_temp.l0id('p_b3'),      pg_temp.l0id('s3'), pg_temp.l0id('f3'), v_t), false),
    ('cancelled',          pg_temp.l0id('b1'), pg_temp.l0id('owner1'), pg_temp.l0_book(pg_temp.l0id('b1'), pg_temp.l0id('p_ok'),      pg_temp.l0id('s1'), pg_temp.l0id('f1'), v_t, 'cancelled'), false);

  -- Marcar los eventos de booking_receipt de la creación sintética como ya procesados
  update private.appointment_email_events set processed_at = clock_timestamp() where processed_at is null;

  -- Establecer schedule_changed_at de cada caso
  update public.appointment_management_states m
  set schedule_changed_at = case
    when pc.label = 'at_boundary_no_rcp' then v_due
    when pc.label = 'near_with_receipt' then v_due - interval '20 minutes'
    else v_t - interval '48 hours'
  end
  from parity_cases pc
  where m.appointment_id = pc.appointment_id;

  -- Para near_with_receipt, registrar el comprobante aceptado 15 min antes de v_due
  insert into private.appointment_email_deliveries(
    business_id, appointment_id, purpose, dedupe_key, schedule_revision, state,
    due_at, expires_at, accepted_at, patient_id, contact_revision, recipient_email
  )
  select pc.business_id, pc.appointment_id, 'booking_receipt', 'booking_receipt:1', 1, 'accepted',
         v_due - interval '20 minutes', v_t, v_due - interval '15 minutes', pg_temp.l0id('p_ok'), 1, 'valido@example.test'
  from parity_cases pc where pc.label = 'near_with_receipt';

  -- Paso A: consultar la lista autenticada (como cada dueño) ANTES de que abra la ventana de 24 h (a la mañana)
  perform set_config('request.jwt.claim.sub', pg_temp.l0v('owner1'), true);
  update parity_cases pc set list_covered = cov.covered
  from public.list_appointment_email_reminder_coverage(
    pg_temp.l0id('b1'),
    array(select appointment_id from parity_cases where business_id = pg_temp.l0id('b1')),
    v_morning
  ) cov
  where pc.appointment_id = cov.appointment_id;

  perform set_config('request.jwt.claim.sub', pg_temp.l0v('owner2'), true);
  update parity_cases pc set list_covered = cov.covered
  from public.list_appointment_email_reminder_coverage(
    pg_temp.l0id('b2'),
    array(select appointment_id from parity_cases where business_id = pg_temp.l0id('b2')),
    v_morning
  ) cov
  where pc.appointment_id = cov.appointment_id;

  perform set_config('request.jwt.claim.sub', pg_temp.l0v('owner3'), true);
  update parity_cases pc set list_covered = cov.covered
  from public.list_appointment_email_reminder_coverage(
    pg_temp.l0id('b3'),
    array(select appointment_id from parity_cases where business_id = pg_temp.l0id('b3')),
    v_morning
  ) cov
  where pc.appointment_id = cov.appointment_id;

  -- Paso B: ejecutar el planificador/despachador real al abrir la ventana de 24 h (v_due)
  perform set_config('request.jwt.claim.sub', '', true);
  v_claim := public.claim_appointment_email_batch(20, v_due);

  -- Un caso queda cubierto por el planificador/despachador si claim reclamó su reminder_24h
  -- o si lo descartó específicamente por covered_by_receipt.
  update parity_cases pc set planner_covered = (
    exists(
      select 1 from jsonb_array_elements(v_claim->'items') item
      where (item->'snapshot'->>'id')::uuid = pc.appointment_id
        and item->>'purpose' = 'reminder_24h'
    )
    or exists(
      select 1 from private.appointment_email_deliveries d
      where d.appointment_id = pc.appointment_id
        and d.purpose = 'reminder_24h'
        and d.state = 'discarded'
        and d.discard_reason = 'covered_by_receipt'
    )
  );

  select count(*) into v_mismatch
  from parity_cases
  where list_covered is distinct from planner_covered
     or list_covered is distinct from expected;

  if v_mismatch > 0 then
    raise exception 'PLANNER_LIST_PARITY_MISMATCH: %', (
      select string_agg(label || '(exp=' || expected || ',list=' || list_covered || ',plan=' || planner_covered || ')', ', ')
      from parity_cases where list_covered is distinct from planner_covered or list_covered is distinct from expected
    );
  end if;
end $$;
select extensions.pass('26. D3 (Aprobación #3): paridad 10/10 entre lo que decide el planificador y lo que muestra la lista');

select * from extensions.finish();
rollback;
