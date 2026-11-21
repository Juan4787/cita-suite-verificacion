-- Contratos SQL del Paso 1 de entrega a Natalia (AF1-001, AF1-002, AF1-010, AF1-012, AF1-019).
-- Todo es sintético y se revierte con rollback.
begin;
select extensions.plan(17);

create temporary table paso1_fixture(label text primary key, value text not null);
grant select on paso1_fixture to authenticated;
create function pg_temp.p1v(label text) returns text language sql as $$select value from paso1_fixture where paso1_fixture.label=$1$$;
create function pg_temp.p1id(label text) returns uuid language sql as $$select pg_temp.p1v($1)::uuid$$;

do $$
declare
  b uuid := gen_random_uuid();
  owner_u uuid := gen_random_uuid();
  admin_u uuid := gen_random_uuid();
  readonly_u uuid := gen_random_uuid();
  svc uuid := gen_random_uuid();
  prof uuid := gen_random_uuid();
  integ uuid := gen_random_uuid();
  integ_key text := repeat('a', 32);
begin
  insert into auth.users(id, email) values
    (owner_u, 'paso1-owner-' || owner_u || '@example.test'),
    (admin_u, 'paso1-admin-' || admin_u || '@example.test'),
    (readonly_u, 'paso1-readonly-' || readonly_u || '@example.test');
  insert into public.allowed_emails(email, enabled) values
    ('paso1-owner-' || owner_u || '@example.test', true),
    ('paso1-admin-' || admin_u || '@example.test', true),
    ('paso1-readonly-' || readonly_u || '@example.test', true);
  insert into public.businesses(id, name, slug, industry, timezone, phone, address, public_booking_enabled, allow_same_day_booking, public_contact_enabled, whatsapp_contact_enabled, whatsapp_phone, max_booking_days_ahead, min_booking_notice_minutes)
  values(b, 'Consultorio Paso 1', 'paso1-' || left(b::text, 8), 'medicine', 'America/Argentina/Cordoba', '+5493511111111', 'Av. Privada 999', true, false, false, false, '+5493512222222', 90, 0);
  update public.business_subscriptions set commercial_access_enabled=true, is_permanent=true, subscription_status='active', paid_until=null, grace_until=null, restricted_until=null, archived_at=null where business_id=b;
  insert into public.business_users(business_id, user_id, role, status, accepted_at) values
    (b, owner_u, 'owner', 'active', now()),
    (b, admin_u, 'admin', 'active', now()),
    (b, readonly_u, 'readonly', 'active', now());
  insert into public.services(id, business_id, name, duration_minutes, is_active, is_public) values(svc, b, 'Primera consulta', 60, true, true);
  insert into public.professionals(id, business_id, name, is_active, is_public) values(prof, b, 'Dra. Paso Uno', true, true);
  insert into public.professional_services(business_id, professional_id, service_id) values(b, prof, svc);
  insert into public.availability_rules(business_id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active)
  select b, prof, day, '00:00', '23:59', 60, 0, true from generate_series(0, 6) day;
  insert into public.booking_integrations(id, business_id, public_key, name, is_active, allowed_origins, allowed_service_ids, allowed_professional_ids)
  values(integ, b, integ_key, 'Web Paso 1', true, array['https://paso1.example.test'], array[svc], array[prof]);
  update private.appointment_management_runtime set reschedule_enabled=true, email_producer_enabled=true;
  insert into paso1_fixture values
    ('business', b::text), ('owner', owner_u::text), ('admin', admin_u::text), ('readonly', readonly_u::text),
    ('service', svc::text), ('professional', prof::text), ('integration', integ::text), ('key', integ_key);
end $$;

-- AF1-001: get_availability_catalog expone allow_same_day_booking y los triggers suben revisiones al cambiarlo
select extensions.is(
  (public.get_availability_catalog(pg_temp.p1id('business'), true)->'business'->>'allow_same_day_booking')::boolean,
  false,
  '1. AF1-001: availability catalog exposes allow_same_day_booking=false'
);

do $$
declare rev_before bigint; cfg_before bigint; rev_after bigint; cfg_after bigint;
begin
  select booking_availability_revision into rev_before from public.businesses where id = pg_temp.p1id('business');
  select revision into cfg_before from private.availability_configuration_versions where business_id = pg_temp.p1id('business');
  update public.businesses set allow_same_day_booking = true where id = pg_temp.p1id('business');
  select booking_availability_revision into rev_after from public.businesses where id = pg_temp.p1id('business');
  select revision into cfg_after from private.availability_configuration_versions where business_id = pg_temp.p1id('business');
  if rev_after <= rev_before or cfg_after <= cfg_before then raise exception 'ALLOW_SAME_DAY_REVISION_NOT_BUMPED'; end if;
  update public.businesses set allow_same_day_booking = false where id = pg_temp.p1id('business');
end $$;
select extensions.pass('2. AF1-001: toggling allow_same_day_booking advances both availability revisions');

-- AF1-001: reserva pública para hoy se rechaza cuando allow_same_day_booking=false, pero turno manual se permite
do $$
declare
  b uuid := pg_temp.p1id('business');
  p uuid := pg_temp.p1id('professional');
  s uuid := pg_temp.p1id('service');
  o uuid := pg_temp.p1id('owner');
  v_today_local date := (clock_timestamp() at time zone 'America/Argentina/Cordoba')::date;
  v_same_day timestamptz := least(clock_timestamp() + interval '5 minutes', ((v_today_local + time '23:55') at time zone 'America/Argentina/Cordoba'));
  v_manual record;
begin
  -- Si ya pasaron las 23:55 hora local, usar el instante actual + 1 min (sigue siendo hoy si < 23:59)
  if (v_same_day at time zone 'America/Argentina/Cordoba')::date > v_today_local then
    v_same_day := clock_timestamp();
  end if;
  begin
    perform * from public.create_appointment_with_patient_identity(
      b, 'public', null, 'Paciente Hoy', '3515000001', '+5493515000001', null,
      false, null, s, array[p], v_same_day, null, null, false, 'public_booking', 'valid', false, gen_random_uuid()::text
    );
    raise exception 'SAME_DAY_PUBLIC_BYPASSED';
  exception when others then
    if sqlerrm is distinct from 'PUBLIC_SAME_DAY_BOOKING_DISABLED' then raise; end if;
  end;
  select * into v_manual from public.create_appointment_with_patient_identity(
    b, 'new', null, 'Paciente Manual Hoy', '3515000002', '+5493515000002', null,
    false, o, s, array[p], v_same_day, null, o, false, 'manual', 'valid', false, gen_random_uuid()::text
  );
  if v_manual.id is null then raise exception 'MANUAL_SAME_DAY_FAILED'; end if;
  update public.appointments set status = 'cancelled', cancelled_at = clock_timestamp() where id = v_manual.id;
end $$;
select extensions.pass('3. AF1-001: public same-day booking is blocked when disabled while manual staff booking still works');

-- AF1-002: sin remitente listo se puede reservar online sin email y NO se generan eventos ni entregas muertas
do $$
declare
  b uuid := pg_temp.p1id('business');
  p uuid := pg_temp.p1id('professional');
  s uuid := pg_temp.p1id('service');
  v_tomorrow timestamptz := (((clock_timestamp() at time zone 'America/Argentina/Cordoba')::date + 2) + time '10:00') at time zone 'America/Argentina/Cordoba';
  v_created record;
  v_claim jsonb;
begin
  select * into v_created from public.create_appointment_with_patient_identity(
    b, 'public', null, 'Paciente Sin Remitente', '3515000003', '+5493515000003', null,
    false, null, s, array[p], v_tomorrow, null, null, false, 'public_booking', 'valid', false, gen_random_uuid()::text
  );
  insert into paso1_fixture values('apt_future', v_created.id::text), ('apt_token', v_created.confirmation_token);
  v_claim := public.claim_appointment_email_batch(10, clock_timestamp());
  if exists(select 1 from private.appointment_email_events where business_id = b) then
    raise exception 'DEAD_EMAIL_EVENT_CREATED';
  end if;
  if exists(select 1 from private.appointment_email_deliveries where business_id = b) then
    raise exception 'DEAD_EMAIL_DELIVERY_CREATED';
  end if;
end $$;
select extensions.pass('4. AF1-002: clinic without verified sender allows booking without email and produces zero dead email events/deliveries');

-- AF1-001: reprogramación del paciente hacia el mismo día también se rechaza cuando allow_same_day_booking=false
do $$
declare
  b uuid := pg_temp.p1id('business');
  v_token text := pg_temp.p1v('apt_token');
  v_view jsonb := public.get_patient_appointment_management_view(v_token, true, null);
  v_rev bigint;
  v_today_local date := (clock_timestamp() at time zone 'America/Argentina/Cordoba')::date;
  v_same_day timestamptz := least(clock_timestamp() + interval '5 minutes', ((v_today_local + time '23:55') at time zone 'America/Argentina/Cordoba'));
begin
  select booking_availability_revision into v_rev from public.businesses where id = b;
  if (v_same_day at time zone 'America/Argentina/Cordoba')::date = v_today_local and v_same_day > clock_timestamp() then
    begin
      perform public.apply_patient_appointment_management(
        v_token, true, gen_random_uuid(), v_view->>'revision', 'reschedule', v_same_day, v_rev, v_view->'financial_terms', null
      );
      raise exception 'SAME_DAY_RESCHEDULE_BYPASSED';
    exception when others then
      if sqlerrm is distinct from 'APPOINTMENT_RESCHEDULE_TIME_INVALID' then raise; end if;
    end;
  end if;
end $$;
select extensions.pass('5. AF1-001: patient self-reschedule into today is rejected when allow_same_day_booking=false');

-- AF1-002: al verificar remitente sí exige email y genera eventos/entregas normalmente
select public.operator_set_business_email_sender(pg_temp.p1id('business'), 'paso1-sender.cita-suite.com.ar', 'verified');
select extensions.ok((select sender_verified from public.appointment_email_policies where business_id = pg_temp.p1id('business')), '6. AF1-002: verified sender mirrors sender_verified=true');
select extensions.throws_ok(
  $$select * from public.create_appointment_with_patient_identity(
    pg_temp.p1id('business'), 'public', null, 'Paciente Sin Mail Con Remitente', '3515000004', '+5493515000004', null,
    false, null, pg_temp.p1id('service'), array[pg_temp.p1id('professional')],
    (((clock_timestamp() at time zone 'America/Argentina/Cordoba')::date + 3) + time '10:00') at time zone 'America/Argentina/Cordoba',
    null, null, false, 'public_booking', 'valid', false, gen_random_uuid()::text
  )$$,
  'P0001', 'PUBLIC_PATIENT_EMAIL_REQUIRED',
  '7. AF1-002: once sender is ready and require_email=true, booking without email is rejected'
);

-- AF1-010: contacto público apagado devuelve 200-compatible JSON con phone/address nulos en ambos RPCs
select extensions.ok(
  (select (c->'contact'->>'phone') is null and (c->'contact'->>'address') is null and (c->'contact'->>'whatsapp_phone') is null
   from (select public.get_public_practice_contact(pg_temp.p1v('key')) as c) q),
  '8. AF1-010: get_public_practice_contact succeeds with null phone/address when public_contact_enabled=false'
);
select extensions.ok(
  (select (c->'contact'->>'phone') is null and (c->'contact'->>'address') is null
   from (select public.get_public_booking_catalogue(pg_temp.p1id('integration')) as c) q),
  '9. AF1-010: get_public_booking_catalogue also omits phone/address when public_contact_enabled=false'
);
update public.businesses set public_contact_enabled = true where id = pg_temp.p1id('business');
select extensions.ok(
  (select (public.get_public_practice_contact(pg_temp.p1v('key'))->'contact'->>'phone') = '+5493511111111'
   and (public.get_public_booking_catalogue(pg_temp.p1id('integration'))->'contact'->>'address') = 'Av. Privada 999'),
  '10. AF1-010: enabling public_contact_enabled exposes phone and address coherently in both RPCs'
);

-- AF1-012: agregar integrante o habilitar admin que atiende NO crea Consulta / Otro servicio si ya hay servicios activos
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.p1v('owner'), true);
do $$
declare
  v_new_prof uuid := gen_random_uuid();
  v_attending uuid;
begin
  perform public.create_team_member_profile(
    pg_temp.p1id('business'),
    jsonb_build_object(
      'professionalId', v_new_prof,
      'email', 'paso1-nuevo-' || left(v_new_prof::text, 8) || '@example.test',
      'role', 'professional',
      'name', 'Dra. Nueva Sin Genericos',
      'specialty', 'Medicina',
      'serviceIds', jsonb_build_array(pg_temp.p1id('service')),
      'newServices', '[]'::jsonb,
      'blocks', jsonb_build_array(jsonb_build_object('weekdays', jsonb_build_array(1), 'ranges', jsonb_build_array(jsonb_build_object('start', '09:00', 'end', '12:00')), 'slot_interval_minutes', 60, 'break_minutes', 0, 'service_scope', 'all', 'service_ids', '[]'::jsonb)),
      'exception', null
    )
  );
  v_attending := public.make_team_member_attending(
    pg_temp.p1id('business'),
    (select id from public.business_users where business_id = pg_temp.p1id('business') and user_id = pg_temp.p1id('admin')),
    'Admin Que Atiende'
  );
end $$;
reset role;
select extensions.is(
  (select count(*) from public.services where business_id = pg_temp.p1id('business') and lower(trim(name)) in ('consulta', 'otro servicio')),
  0::bigint,
  '11. AF1-012: adding/enabling team members does not create Consulta or Otro servicio when clinic already has active services'
);

-- AF1-012: si existiera un servicio llamado Consulta, save_professional_editor permite desasignarlo
do $$
declare
  v_generic uuid := gen_random_uuid();
  v_rev bigint;
begin
  insert into public.services(id, business_id, name, duration_minutes, is_active, is_public)
  values(v_generic, pg_temp.p1id('business'), 'Consulta', 30, true, true);
  insert into public.professional_services(business_id, professional_id, service_id)
  values(pg_temp.p1id('business'), pg_temp.p1id('professional'), v_generic);
  select booking_availability_revision into v_rev from public.businesses where id = pg_temp.p1id('business');
  perform set_config('request.jwt.claim.sub', pg_temp.p1v('owner'), true);
  execute 'set local role authenticated';
  perform public.save_professional_editor(
    pg_temp.p1id('business'), pg_temp.p1id('professional'), v_rev, null,
    array[pg_temp.p1id('service')], null, null, null, false
  );
  execute 'reset role';
  if exists(select 1 from public.professional_services where business_id = pg_temp.p1id('business') and professional_id = pg_temp.p1id('professional') and service_id = v_generic) then
    raise exception 'DEFAULT_SERVICE_FORCED_BACK';
  end if;
end $$;
select extensions.pass('12. AF1-012: save_professional_editor allows unassigning Consulta without forcing it back');

-- AF1-019: get_patient_data_revision devuelve can_create_patient=false para readonly y true para owner
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.p1v('readonly'), true);
select extensions.is(
  (select can_create_patient from public.get_patient_data_revision(pg_temp.p1id('business'))),
  false,
  '13. AF1-019: get_patient_data_revision returns can_create_patient=false for readonly role'
);
select set_config('request.jwt.claim.sub', pg_temp.p1v('owner'), true);
select extensions.is(
  (select can_create_patient from public.get_patient_data_revision(pg_temp.p1id('business'))),
  true,
  '14. AF1-019: get_patient_data_revision returns can_create_patient=true for owner role'
);
reset role;

-- Permisos de la nueva función privada
select extensions.ok(
  not has_function_privilege('anon', 'private.assert_public_booking_same_day(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.assert_public_booking_same_day(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.assert_public_booking_same_day(uuid,timestamptz)', 'EXECUTE'),
  '15. Private helper assert_public_booking_same_day has no direct API grants'
);

-- AF1-001: si se activa allow_same_day_booking=true, la reserva pública para hoy SÍ funciona
update public.businesses set allow_same_day_booking = true where id = pg_temp.p1id('business');
do $$
declare
  b uuid := pg_temp.p1id('business');
  p uuid := pg_temp.p1id('professional');
  s uuid := pg_temp.p1id('service');
  v_today_local date := (clock_timestamp() at time zone 'America/Argentina/Cordoba')::date;
  v_same_day timestamptz := least(clock_timestamp() + interval '5 minutes', ((v_today_local + time '23:55') at time zone 'America/Argentina/Cordoba'));
  v_created record;
begin
  if (v_same_day at time zone 'America/Argentina/Cordoba')::date = v_today_local and v_same_day > clock_timestamp() then
    select * into v_created from public.create_appointment_with_patient_identity(
      b, 'public', null, 'Paciente Hoy Habilitado', '3515000005', '+5493515000005', 'hoy@example.test',
      false, null, s, array[p], v_same_day, null, null, false, 'public_booking', 'valid', false, gen_random_uuid()::text
    );
    if v_created.id is null then raise exception 'SAME_DAY_ENABLED_FAILED'; end if;
  end if;
end $$;
select extensions.pass('16. AF1-001: public same-day booking succeeds when allow_same_day_booking=true');

-- AF1-010: clave inexistente sigue devolviendo PUBLIC_CONTACT_UNAVAILABLE
select extensions.throws_ok(
  $$select public.get_public_practice_contact(repeat('f', 32))$$,
  'P0001', 'PUBLIC_CONTACT_UNAVAILABLE',
  '17. AF1-010: unknown integration key still raises PUBLIC_CONTACT_UNAVAILABLE'
);

select * from extensions.finish();
rollback;
