-- Account assistance with three durations (plan 12.17): one hour and 24 hours always, and a
-- seven-day initial setup only while the practice has no patients. Once given it lasts what
-- was chosen: loading patients neither ends nor shortens it. Only the owner gives and extends
-- it, each extension counts from that moment and never shortens it; the owner and the support
-- user of the grant can end it, and the grant and the audit log record who did. The functions
-- of V10b keep working on the same table. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(47);

create temporary table durations_fixture(label text primary key, id uuid not null);
grant select on durations_fixture to authenticated;

do $$
declare b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); u_owner uuid:=gen_random_uuid(); u_owner2 uuid:=gen_random_uuid(); u_admin uuid:=gen_random_uuid();
 u_support uuid:=gen_random_uuid(); u_other_support uuid:=gen_random_uuid(); u_disabled uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) select id,'assistance-durations-'||id||'@example.test'
  from unnest(array[u_owner,u_owner2,u_admin,u_support,u_other_support,u_disabled,u_stranger]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values
  (b,'Ayuda con duraciones',b::text,'other','America/Argentina/Buenos_Aires'),
  (b2,'Ayuda sin acceso',b2::text,'other','America/Argentina/Buenos_Aires');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 update public.business_subscriptions set commercial_access_enabled=false where business_id=b2;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
  (b,u_owner,'owner','active',now()),(b,u_admin,'admin','active',now()),(b2,u_owner2,'owner','active',now());
 insert into public.account_assistance_support_users(user_id,email,enabled) values
  (u_support,'assistance-durations-support-'||u_support||'@example.test',true),
  (u_other_support,'assistance-durations-other-'||u_other_support||'@example.test',true),
  (u_disabled,'assistance-durations-disabled-'||u_disabled||'@example.test',false);
 insert into durations_fixture values('business',b),('restricted',b2),('owner',u_owner),('owner2',u_owner2),('admin',u_admin),('support',u_support),
  ('other_support',u_other_support),('disabled',u_disabled),('stranger',u_stranger);
end $$;

create function pg_temp.fid(p_label text) returns uuid language sql stable as $$ select id from durations_fixture where label=p_label $$;

-- Runs one statement as an authenticated user and returns its first value, 'ok' when it returns
-- nothing, or the error it raised. A failed statement leaves nothing behind.
create function pg_temp.run_as(p_actor text, p_sql text) returns text language plpgsql as $$
declare v_result text;
begin
 perform set_config('request.jwt.claim.sub',coalesce(pg_temp.fid(p_actor)::text,''),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 begin
  execute p_sql into v_result;
  v_result:=coalesce(v_result,'ok');
 exception when others then
  v_result:=sqlerrm;
 end;
 execute 'reset role';
 return v_result;
end $$;

-- A direct write, as the table owner: 'ok' or the name of the condition it raised.
create function pg_temp.direct(p_sql text) returns text language plpgsql as $$
begin
 execute p_sql;
 return 'ok';
exception when check_violation then return 'check_violation';
end $$;

create function pg_temp.start(p_actor text, p_kind text, p_support text default 'support') returns text language sql as $$
 select pg_temp.run_as(p_actor, format('select id::text from public.start_account_assistance(%L::uuid, %L::uuid, %L)',
  pg_temp.fid('business'), pg_temp.fid(p_support), p_kind))
$$;
create function pg_temp.extend(p_actor text, p_grant text, p_kind text) returns text language sql as $$
 select pg_temp.run_as(p_actor, format('select kind from public.extend_account_assistance(%L::uuid, %L::uuid, %L)',
  pg_temp.fid('business'), p_grant, p_kind))
$$;
create function pg_temp.finish_grant(p_actor text, p_grant text) returns text language sql as $$
 select pg_temp.run_as(p_actor, format('select status from public.end_account_assistance(%L::uuid, %L::uuid)',
  pg_temp.fid('business'), p_grant))
$$;
create function pg_temp.active_grant() returns setof public.account_assistance_grants language sql stable as $$
 select * from public.account_assistance_grants where business_id=pg_temp.fid('business') and status='active' and revoked_at is null
$$;
create function pg_temp.has_patients(p_actor text) returns text language sql as $$
 select pg_temp.run_as(p_actor, format('select public.account_assistance_has_patients(%L::uuid)::text', pg_temp.fid('business')))
$$;
create function pg_temp.support_has_access() returns text language sql as $$
 select pg_temp.run_as('support', format('select public.user_has_active_account_assistance(%L::uuid)::text', pg_temp.fid('business')))
$$;
-- Simulates time passing for the active grant: the test runs in one transaction, where now() never moves.
create function pg_temp.age_active_grant(p_by interval) returns void language sql as $$
 update public.account_assistance_grants set starts_at=starts_at-p_by, extended_at=extended_at-p_by, expires_at=expires_at-p_by
 where business_id=pg_temp.fid('business') and status='active' and revoked_at is null
$$;

-- 1-3. Only the owner gives it; a duration outside the three is rejected.
select extensions.is(pg_temp.start('admin','day'), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'an administrator cannot give the assistance');
select extensions.is(pg_temp.start('support','day'), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'the support user cannot give itself the assistance');
select extensions.is(pg_temp.start('owner','week'), 'ACCOUNT_ASSISTANCE_KIND_INVALID', 'a duration outside the three is rejected');
-- 4-6. A disabled support user or a practice that cannot operate gets nothing, and nothing is written.
select extensions.is(pg_temp.start('owner','hour','disabled'), 'ACCOUNT_ASSISTANCE_SUPPORT_USER_NOT_ENABLED', 'a disabled support user is never granted');
select extensions.is(pg_temp.run_as('owner2', format('select id::text from public.start_account_assistance(%L::uuid, %L::uuid, %L)',
 pg_temp.fid('restricted'), pg_temp.fid('support'), 'hour')), 'ACCOUNT_ASSISTANCE_BUSINESS_NOT_AVAILABLE', 'a practice without access cannot give assistance');
select extensions.is((select count(*) from public.account_assistance_grants where business_id in (pg_temp.fid('business'),pg_temp.fid('restricted'))),
 0::bigint, 'the refused attempts wrote no grant');

-- 7-9. The owner gives one hour: it starts now, ends one hour later and the audit log records the duration.
select set_config('cita.test.grant', pg_temp.start('owner','hour'), true);
select extensions.is((select format('%s %s %s %s', kind, expires_at-starts_at, starts_at=now(), extended_at is null) from pg_temp.active_grant()),
 'hour 01:00:00 t t', 'one hour starts now and ends one hour later');
select extensions.is((select format('%s %s', metadata->>'kind', (metadata->>'expires_at')::timestamptz=now()+interval '1 hour')
 from public.audit_logs where entity_id=current_setting('cita.test.grant')::uuid and action='account_assistance.activated'),
 'hour t', 'the activation is audited with its duration and its end');
select extensions.is(pg_temp.support_has_access(), 'true', 'the support user has access while the hour lasts');

-- 10-11. The same duration again returns the same grant; another duration does not replace it.
select extensions.is(pg_temp.start('owner','hour'), current_setting('cita.test.grant'), 'a repeated request returns the active grant');
select extensions.is(pg_temp.start('owner','day'), 'ACCOUNT_ASSISTANCE_ALREADY_ACTIVE', 'another duration does not silently replace the active one');

-- 12-15. Forty minutes later, extending: only the owner, only the grant shown, only to a longer duration.
-- With 20 minutes left another hour would end later, so only the rule of durations refuses it.
select pg_temp.age_active_grant(interval '40 minutes');
select extensions.is(pg_temp.extend('admin', current_setting('cita.test.grant'), 'day'), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'an administrator cannot extend it');
select extensions.is(pg_temp.extend('support', current_setting('cita.test.grant'), 'day'), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'the support user cannot extend it');
select extensions.is(pg_temp.extend('owner', gen_random_uuid()::text, 'day'), 'ACCOUNT_ASSISTANCE_NOT_ACTIVE', 'a grant that is not the active one is not extended');
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'hour'), 'ACCOUNT_ASSISTANCE_EXTENSION_NOT_ALLOWED', 'the same duration is not an extension');

-- 16-18. One hour becomes 24 hours from now, on the same grant, audited with both.
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'day'), 'day', 'the owner extends one hour to 24 hours');
select extensions.is((select format('%s %s %s %s', id::text=current_setting('cita.test.grant'), expires_at=now()+interval '24 hours', extended_at=now(),
 starts_at=now()-interval '40 minutes') from pg_temp.active_grant()), 't t t t', 'the extension counts from now and keeps the grant and its start');
select extensions.is((select format('%s %s %s %s', metadata->>'previous_kind', metadata->>'kind', (metadata->>'previous_expires_at')::timestamptz=now()+interval '20 minutes',
 (metadata->>'expires_at')::timestamptz=now()+interval '24 hours') from public.audit_logs
 where entity_id=current_setting('cita.test.grant')::uuid and action='account_assistance.extended'),
 'hour day t t', 'the extension is audited with the previous and the new duration');
-- 19. A shorter duration never replaces a longer one.
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'hour'), 'ACCOUNT_ASSISTANCE_EXTENSION_NOT_ALLOWED', 'an extension never shortens the assistance');

-- 20-22. Without patients only the owner learns it, and 24 hours become the seven-day initial setup.
select extensions.is(pg_temp.has_patients('owner'), 'false', 'the owner learns the practice has no patients');
select extensions.is(pg_temp.has_patients('admin'), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'only the owner asks whether the initial setup is available');
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'initial_setup'), 'initial_setup', 'without patients 24 hours become the initial setup');

-- 23-25. Loading patients, even an archived one, neither ends nor shortens it.
create temporary table grant_before_patients as select * from pg_temp.active_grant();
do $$
declare v_patient uuid;
begin
 insert into public.patients(business_id,owner_id,full_name) values(pg_temp.fid('business'),pg_temp.fid('owner'),'Paciente de prueba de la ayuda')
 returning id into v_patient;
 update public.patients set archived_at=now() where id=v_patient;
end $$;
select extensions.is((select to_jsonb(g) from pg_temp.active_grant() g), (select to_jsonb(g) from grant_before_patients g),
 'loading patients leaves the grant untouched');
select extensions.is(pg_temp.support_has_access(), 'true', 'the support user keeps access after patients are loaded');
select extensions.is(pg_temp.has_patients('owner'), 'true', 'an archived patient still counts as a patient');

-- 26-27. With patients the initial setup can still be renewed: seven days from now, never shorter.
select pg_temp.age_active_grant(interval '6 days');
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'initial_setup'), 'initial_setup', 'the initial setup gets seven more days with patients');
select extensions.is((select format('%s %s', expires_at=now()+interval '7 days', extended_at=now()) from pg_temp.active_grant()),
 't t', 'the renewal counts seven days from now');

-- 28-31. Ending: not an administrator, another support user or a stranger, and only the grant shown.
select extensions.is(pg_temp.finish_grant('admin', current_setting('cita.test.grant')), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'an administrator cannot end it');
select extensions.is(pg_temp.finish_grant('other_support', current_setting('cita.test.grant')), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'another support user cannot end it');
select extensions.is(pg_temp.finish_grant('stranger', current_setting('cita.test.grant')), 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED', 'a stranger cannot end it');
select extensions.is(pg_temp.finish_grant('owner', gen_random_uuid()::text), 'ACCOUNT_ASSISTANCE_NOT_ACTIVE', 'a grant that is not the active one is not ended');

-- 32-35. The support user of the grant ends it: access stops, and the grant and the audit log say who.
select extensions.is(pg_temp.finish_grant('support', current_setting('cita.test.grant')), 'revoked', 'the support user ends the assistance');
select extensions.is((select format('%s %s %s', revoked_by_role, revoked_by_user_id=pg_temp.fid('support'), revoked_at=now()) from public.account_assistance_grants
 where id=current_setting('cita.test.grant')::uuid), 'support t t', 'the grant records that the support user ended it');
select extensions.is((select format('%s %s', metadata->>'revoked_by_role', user_id=pg_temp.fid('support')) from public.audit_logs
 where entity_id=current_setting('cita.test.grant')::uuid and action='account_assistance.revoked'),
 'support t', 'the audit log records that the support user ended it');
select extensions.is(pg_temp.support_has_access(), 'false', 'the support user has no access once it ends');

-- 36-38. With patients a new initial setup is refused, 24 hours are not, and 24 hours cannot become it.
select extensions.is(pg_temp.start('owner','initial_setup'), 'ACCOUNT_ASSISTANCE_INITIAL_SETUP_UNAVAILABLE', 'with patients a new initial setup is refused');
select set_config('cita.test.grant', pg_temp.start('owner','day'), true);
select extensions.is((select format('%s %s', kind, expires_at=now()+interval '24 hours') from pg_temp.active_grant()), 'day t', 'with patients the owner still gives 24 hours');
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'initial_setup'), 'ACCOUNT_ASSISTANCE_INITIAL_SETUP_UNAVAILABLE', 'with patients 24 hours cannot become the initial setup');

-- 39. The owner ends it and the grant records that the owner did.
select pg_temp.finish_grant('owner', current_setting('cita.test.grant'));
select extensions.is((select format('%s %s', revoked_by_role, revoked_by_user_id=pg_temp.fid('owner')) from public.account_assistance_grants
 where id=current_setting('cita.test.grant')::uuid), 'owner t', 'the grant records that the owner ended it');

-- 40-42. An expired grant is neither extended nor ended, and a new request replaces it with a new grant.
select set_config('cita.test.grant', pg_temp.start('owner','day'), true);
select pg_temp.age_active_grant(interval '25 hours');
select extensions.is(pg_temp.extend('owner', current_setting('cita.test.grant'), 'initial_setup'), 'ACCOUNT_ASSISTANCE_NOT_ACTIVE', 'an expired grant is not extended');
select extensions.is(pg_temp.finish_grant('support', current_setting('cita.test.grant')), 'ACCOUNT_ASSISTANCE_NOT_ACTIVE', 'an expired grant is not ended');
select set_config('cita.test.new_grant', pg_temp.start('owner','hour'), true);
select extensions.is((select format('%s %s', status, current_setting('cita.test.new_grant')<>current_setting('cita.test.grant'))
 from public.account_assistance_grants where id=current_setting('cita.test.grant')::uuid), 'expired t', 'a new request marks the old grant expired and creates another');

-- 43. V10b still gives one hour with its own function on the same table, and ends it.
select pg_temp.finish_grant('owner', current_setting('cita.test.new_grant'));
select set_config('cita.test.legacy_grant', pg_temp.run_as('owner', format('select id::text from public.activate_account_assistance(%L::uuid, %L::uuid)',
 pg_temp.fid('business'), pg_temp.fid('support'))), true);
select set_config('cita.test.legacy_end', pg_temp.run_as('owner', format('select status from public.revoke_account_assistance(%L::uuid)',
 pg_temp.fid('business'))), true);
select extensions.is((select format('%s %s %s %s %s', kind, expires_at-starts_at, status, revoked_by_role is null, revoked_by_user_id=pg_temp.fid('owner'))
 from public.account_assistance_grants where id=current_setting('cita.test.legacy_grant')::uuid) || ' ' || current_setting('cita.test.legacy_end'),
 'hour 01:00:00 revoked t t revoked', 'the V10b functions still give one hour and end it');

-- 44-46. Whatever writes the table, no grant lasts more than seven days from its last activation
-- or extension, has a fourth duration, or names who ended it before it ends.
select extensions.is(pg_temp.direct(format($sql$update public.account_assistance_grants
 set expires_at=coalesce(extended_at,starts_at)+interval '7 days 1 second' where id=%L$sql$, current_setting('cita.test.grant'))),
 'check_violation', 'no grant lasts more than seven days from its last activation or extension');
select extensions.is(pg_temp.direct(format($sql$update public.account_assistance_grants set kind='week' where id=%L$sql$, current_setting('cita.test.grant'))),
 'check_violation', 'no grant has a fourth duration');
select extensions.is(pg_temp.direct(format($sql$update public.account_assistance_grants set revoked_by_role='support' where id=%L$sql$, current_setting('cita.test.grant'))),
 'check_violation', 'only an ended grant names who ended it');

-- 47. Signed-in users execute the new functions; the public key executes none.
select extensions.is((select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
 from unnest(array['public.start_account_assistance(uuid,uuid,text)', 'public.extend_account_assistance(uuid,uuid,text)',
  'public.end_account_assistance(uuid,uuid)', 'public.account_assistance_has_patients(uuid)']::regprocedure[]) f),
 true, 'signed-in users execute the new functions and the public key executes none');

select * from extensions.finish();
rollback;
