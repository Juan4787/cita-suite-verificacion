begin;
select extensions.plan(13);

do $$
declare
  v_owner uuid := '11111111-1111-4111-8111-000000001719';
  v_biz uuid := '11111111-1111-4111-8111-000000001720';
  v_srv uuid := '11111111-1111-4111-8111-000000001721';
  v_prof uuid := '11111111-1111-4111-8111-000000001722';
  v_pat uuid := '11111111-1111-4111-8111-000000001723';
  v_int uuid := '11111111-1111-4111-8111-000000001724';
  v_apt_v uuid := '11111111-1111-4111-8111-000000001725';
  v_apt_p uuid := '11111111-1111-4111-8111-000000001726';
  v_key text := repeat('e', 32);
  v_token text := repeat('f', 64);
  v_now timestamptz := clock_timestamp();
  v_today date;
  v_day365 timestamptz;
  v_day366 timestamptz;
  v_rev text;
  v_avail_rev bigint;
  v_terms jsonb;
  v_snap jsonb;
  v_contact jsonb;
  v_cat jsonb;
  v_err text;
begin
  insert into auth.users(id, email)
  values (v_owner, 'lote1-sql-owner@example.test');

  -- Seed business with 365 days horizon and valid contact email.
  insert into public.businesses(
    id, name, slug, industry, timezone, phone, email, address, address_instructions,
    public_booking_enabled, allow_same_day_booking, public_contact_enabled,
    whatsapp_contact_enabled, whatsapp_phone, max_booking_days_ahead, min_booking_notice_minutes, is_active
  ) values (
    v_biz, 'Consultorio Lote 1', 'lote-1-sql', 'medicine', 'America/Argentina/Buenos_Aires',
    '+54 341 555 0000', 'contacto@lote1.test', 'Calle Falsa 123', 'Timbre 1A',
    true, true, true, true, '+5493415550000', 365, 0, true
  );
  update public.business_subscriptions
  set commercial_access_enabled = true, is_permanent = true, subscription_status = 'active',
      paid_until = null, grace_until = null, restricted_until = null, archived_at = null
  where business_id = v_biz;

  insert into public.business_users(business_id, user_id, role, status, accepted_at)
  values (v_biz, v_owner, 'owner', 'active', now());

  insert into public.services(id, business_id, name, duration_minutes, is_active, is_public)
  values (v_srv, v_biz, 'Primera consulta', 60, true, true);
  insert into public.professionals(id, business_id, name, is_active, is_public)
  values (v_prof, v_biz, 'Dra. Prueba', true, true);
  insert into public.professional_services(business_id, professional_id, service_id)
  values (v_biz, v_prof, v_srv);
  insert into public.availability_rules(
    business_id, professional_id, weekday, start_time, end_time,
    slot_interval_minutes, break_minutes, is_active, service_scope, allowed_service_ids
  )
  select v_biz, v_prof, wd, '09:00'::time, '12:00'::time, 60, 0, true, 'all', '{}'::uuid[]
  from generate_series(0, 6) as wd;

  insert into public.patients(id, business_id, owner_id, full_name, phone_e164, email)
  values (v_pat, v_biz, v_owner, 'Paciente Lote Uno', '+5493415559999', 'paciente@lote1.test');
  insert into public.booking_integrations(
    id, business_id, public_key, name, theme, is_active, is_default,
    allowed_origins, allowed_service_ids, allowed_professional_ids,
    allowed_modalities, video_instructions, intake_schema, modality_windows
  ) values (
    v_int, v_biz, v_key, 'Web Lote 1', 'cita-suite', true, true,
    array['https://lote1.example.test'], array[v_srv], array[v_prof],
    array['in_person', 'video'], 'Conectate en https://meet.google.com/viejo-link', '[]'::jsonb, '[]'::jsonb
  );

  -- Enable reschedule runtime so patient reschedule path is active.
  update private.appointment_management_runtime set reschedule_enabled = true;

  -- Virtual and in-person appointments (trigger syncs primary appointment_professionals).
  insert into public.appointments(
    id, business_id, patient_id, service_id, professional_id,
    starts_at, ends_at, blocking_starts_at, blocking_ends_at,
    status, source, confirmation_token,
    service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
  ) values (
    v_apt_v, v_biz, v_pat, v_srv, v_prof,
    v_now + interval '2 days', v_now + interval '2 days 1 hour',
    v_now + interval '2 days', v_now + interval '2 days 1 hour',
    'reserved', 'public_booking', v_token,
    'Primera consulta', 'Dra. Prueba', 60
  ), (
    v_apt_p, v_biz, v_pat, v_srv, v_prof,
    v_now + interval '3 days', v_now + interval '3 days 1 hour',
    v_now + interval '3 days', v_now + interval '3 days 1 hour',
    'reserved', 'public_booking', repeat('d', 64),
    'Primera consulta', 'Dra. Prueba', 60
  );
  insert into public.appointment_booking_contexts(
    appointment_id, business_id, integration_id, integration_revision, contract_version,
    theme_snapshot, entry_point, modality, video_instructions_snapshot, context_fingerprint
  ) values (
    v_apt_v, v_biz, v_int, 1, 1, 'cita-suite', 'public_page', 'video',
    'Conectate en https://meet.google.com/viejo-link', repeat('1', 64)
  ), (
    v_apt_p, v_biz, v_int, 1, 1, 'cita-suite', 'public_page', 'in_person',
    null, repeat('2', 64)
  );

  -- 1 & 2. P6: constraint accepts 365, rejects 0 and 366.
  v_err := null;
  begin
    update public.businesses set max_booking_days_ahead = 366 where id = v_biz;
  exception when check_violation then
    v_err := sqlerrm;
  end;
  perform set_config('test.p6_reject_366', coalesce(v_err, ''), true);

  v_err := null;
  begin
    update public.businesses set max_booking_days_ahead = 0 where id = v_biz;
  exception when check_violation then
    v_err := sqlerrm;
  end;
  perform set_config('test.p6_reject_0', coalesce(v_err, ''), true);

  -- 3 & 4. P6: reschedule accepts day 365 and rejects day 366 in practice timezone.
  v_today := (v_now at time zone 'America/Argentina/Buenos_Aires')::date;
  v_day365 := ((v_today + 365)::timestamp + time '10:00') at time zone 'America/Argentina/Buenos_Aires';
  v_day366 := ((v_today + 366)::timestamp + time '10:00') at time zone 'America/Argentina/Buenos_Aires';
  select booking_availability_revision into v_avail_rev from public.businesses where id = v_biz;
  v_rev := private.appointment_semantic_revision(v_biz, v_apt_v);
  v_terms := private.appointment_reschedule_financial_terms(v_biz, v_apt_v, v_day366, clock_timestamp());

  v_err := null;
  begin
    perform public.apply_patient_appointment_management(
      v_token, true, gen_random_uuid(), v_rev, 'reschedule',
      v_day366, v_avail_rev, v_terms, 1
    );
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('test.p6_resched_366', coalesce(v_err, ''), true);

  v_terms := private.appointment_reschedule_financial_terms(v_biz, v_apt_v, v_day365, clock_timestamp());
  perform public.apply_patient_appointment_management(
    v_token, true, gen_random_uuid(), v_rev, 'reschedule',
    v_day365, v_avail_rev, v_terms, 1
  );
  perform set_config('test.p6_resched_365_ok',
    case when (select starts_at from public.appointments where id = v_apt_v) = v_day365 then 'ok' else 'fail' end,
    true
  );

  -- 5, 6, 7. P7: changing integration video_instructions updates snapshot live for virtual appointments only.
  update public.booking_integrations
  set video_instructions = 'Nuevo Meet: https://meet.google.com/nuevo-link'
  where id = v_int;

  v_snap := private.appointment_management_snapshot(v_biz, v_apt_v, null, clock_timestamp());
  perform set_config('test.p7_live_virtual', coalesce(v_snap->'integration'->>'video_instructions_snapshot', ''), true);

  v_snap := private.appointment_management_snapshot(v_biz, v_apt_p, null, clock_timestamp());
  perform set_config('test.p7_in_person_null', coalesce(v_snap->'integration'->>'video_instructions_snapshot', 'NULL'), true);

  -- Fallback to snapshot if integration disabled video and cleared video_instructions.
  update public.booking_integrations
  set allowed_modalities = array['in_person'], video_instructions = null
  where id = v_int;
  v_snap := private.appointment_management_snapshot(v_biz, v_apt_v, null, clock_timestamp());
  perform set_config('test.p7_fallback_virtual', coalesce(v_snap->'integration'->>'video_instructions_snapshot', ''), true);

  -- 8..13. P9: contact.email on get_public_practice_contact and get_public_booking_catalogue.
  v_contact := public.get_public_practice_contact(v_key);
  v_cat := public.get_public_booking_catalogue(v_int);
  perform set_config('test.p9_contact_on', coalesce(v_contact->'contact'->>'email', 'NULL'), true);
  perform set_config('test.p9_cat_on', coalesce(v_cat->'contact'->>'email', 'NULL'), true);

  update public.businesses set public_contact_enabled = false where id = v_biz;
  v_contact := public.get_public_practice_contact(v_key);
  v_cat := public.get_public_booking_catalogue(v_int);
  perform set_config('test.p9_contact_off', coalesce(v_contact->'contact'->>'email', 'NULL'), true);
  perform set_config('test.p9_cat_off', coalesce(v_cat->'contact'->>'email', 'NULL'), true);

  update public.businesses set public_contact_enabled = true, email = '   ' where id = v_biz;
  v_contact := public.get_public_practice_contact(v_key);
  perform set_config('test.p9_contact_empty', coalesce(v_contact->'contact'->>'email', 'NULL'), true);

  update public.businesses set email = 'invalido-sin-arroba' where id = v_biz;
  v_contact := public.get_public_practice_contact(v_key);
  perform set_config('test.p9_contact_invalid', coalesce(v_contact->'contact'->>'email', 'NULL'), true);
end $$;

select extensions.ok(current_setting('test.p6_reject_366') <> '', 'P6: businesses rechaza max_booking_days_ahead = 366');
select extensions.ok(current_setting('test.p6_reject_0') <> '', 'P6: businesses rechaza max_booking_days_ahead = 0');
select extensions.is(current_setting('test.p6_resched_366'), 'APPOINTMENT_RESCHEDULE_TIME_INVALID', 'P6: reprogramar al día 366 se rechaza');
select extensions.is(current_setting('test.p6_resched_365_ok'), 'ok', 'P6: reprogramar al día 365 se permite');
select extensions.is(current_setting('test.p7_live_virtual'), 'Nuevo Meet: https://meet.google.com/nuevo-link', 'P7: snapshot virtual refleja enlace actualizado de la integración');
select extensions.is(current_setting('test.p7_in_person_null'), 'NULL', 'P7: snapshot presencial nunca devuelve indicaciones online');
select extensions.is(current_setting('test.p7_fallback_virtual'), 'Conectate en https://meet.google.com/viejo-link', 'P7: snapshot virtual respalda con snapshot guardado si se apaga video');
select extensions.is(current_setting('test.p9_contact_on'), 'contacto@lote1.test', 'P9: get_public_practice_contact expone email con interruptor encendido');
select extensions.is(current_setting('test.p9_cat_on'), 'contacto@lote1.test', 'P9: get_public_booking_catalogue expone email con interruptor encendido');
select extensions.is(current_setting('test.p9_contact_off'), 'NULL', 'P9: get_public_practice_contact oculta email con interruptor apagado');
select extensions.is(current_setting('test.p9_cat_off'), 'NULL', 'P9: get_public_booking_catalogue oculta email con interruptor apagado');
select extensions.is(current_setting('test.p9_contact_empty'), 'NULL', 'P9: get_public_practice_contact devuelve null cuando email está vacío');
select extensions.is(current_setting('test.p9_contact_invalid'), 'NULL', 'P9: get_public_practice_contact nunca expone un email mal formado');

select * from extensions.finish();
rollback;
