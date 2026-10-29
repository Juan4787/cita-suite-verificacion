-- Señas de los turnos (campaña de señas y avisos, etapa B; plan aprobado el 29 de
-- octubre de 2026, secciones 4.1 a 4.6 y 5, y ajuste 1). La seña es un dato propio del
-- turno: la base la crea al reservar, calcula sus fechas en la zona del consultorio,
-- decide quién la registra, une «seña resuelta» con Confirmado y cancela sola sólo
-- cuando no hay ninguna duda. Datos sintéticos; todo se deshace al final.
--
-- Two rules for every check below. A NULL never passes: comparisons use IS DISTINCT FROM,
-- because `if NULL then raise` does not raise. A function and the reading of what it wrote
-- never share a statement: a statement does not see the writes of the functions it calls.
-- The automatic cancellation runs from pg_cron without a user, so each call below clears the
-- user claim that an earlier actor left in the transaction.
begin;
select extensions.plan(24);

create temporary table dep_fixture(label text primary key, id uuid not null);
grant select on dep_fixture to authenticated;

do $$
declare
 b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); s_free uuid:=gen_random_uuid();
 s_priced uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
 u_owner uuid:=gen_random_uuid(); u_reception uuid:=gen_random_uuid(); u_pro uuid:=gen_random_uuid();
 u_readonly uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid(); u_other_owner uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) select id,'deposits-'||id||'@example.test'
  from unnest(array[u_owner,u_reception,u_pro,u_readonly,u_stranger,u_other_owner]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Señas',b::text,'other','America/Argentina/Cordoba'),
  (b2,'Otro consultorio',b2::text,'other','America/Argentina/Cordoba');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in (b,b2);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
  (b,u_owner,'owner','active',now()),(b,u_reception,'reception','active',now()),
  (b,u_pro,'professional','active',now()),(b,u_readonly,'readonly','active',now()),(b2,u_other_owner,'owner','active',now());
 insert into public.professionals(id,business_id,name) values(p,b,'Dra. Señas'),(p2,b,'Dra. Equipo');
 insert into public.professional_users(business_id,user_id,professional_id) values(b,u_pro,p);
 insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Primera consulta',60),(s_free,b,'Control sin seña',60),
  (s_priced,b,'Consulta con arancel',60);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s),(b,p,s_free),(b,p,s_priced),(b,p2,s);
 -- A fee adjusted every month: a later month's fee differs from this month's.
 insert into public.service_price_policies(business_id,service_id,professional_id,base_amount,base_month,first_adjustment_month,monthly_percentage,rounding_unit)
 values(b,s_priced,null,100000,date_trunc('month',now()-interval '1 month')::date,date_trunc('month',now())::date,10,100);
 insert into dep_fixture values('business',b),('business2',b2),('service',s),('service_free',s_free),('service_priced',s_priced),
  ('professional',p),('professional2',p2),('owner',u_owner),('reception',u_reception),('pro',u_pro),('readonly',u_readonly),
  ('stranger',u_stranger),('other_owner',u_other_owner);
 update private.deposit_automation set enabled=true;
end $$;

create function pg_temp.fid(p_label text) returns uuid language sql as $$ select id from dep_fixture where label=p_label $$;

-- Runs a statement as the actor and returns its result, or the error it raised.
create function pg_temp.as_actor(p_actor text, p_statement text) returns text language plpgsql as $$
declare v_result text;
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from dep_fixture where label=p_actor),''),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  execute 'set local role authenticated';
  execute p_statement into v_result;
  execute 'reset role';
 exception when others then
  execute 'reset role';
  return 'ERROR '||sqlerrm;
 end;
 return coalesce(v_result,'');
end $$;

-- A reservation of one hour for a new patient (the public booking limit counts per
-- patient), at whole hours so that no two appointments of the professional overlap.
create function pg_temp.appt(p_label text, p_starts timestamptz, p_source text default 'public_booking',
 p_service text default 'service', p_professional text default 'professional') returns uuid language plpgsql as $$
declare v_patient uuid; v uuid;
begin
 insert into public.patients(owner_id,business_id,full_name)
 values(pg_temp.fid('owner'),pg_temp.fid('business'),'Paciente '||p_label) returning id into v_patient;
 insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(pg_temp.fid('business'),v_patient,pg_temp.fid(p_service),pg_temp.fid(p_professional),p_starts,p_starts+interval '60 minutes',
  p_starts,p_starts+interval '60 minutes','reserved',p_source,'Primera consulta','Dra. Señas',60)
 returning id into v;
 insert into dep_fixture values(p_label,v);
 return v;
end $$;
create function pg_temp.deposit(p_label text) returns public.appointment_deposits language sql as $$
 select * from public.appointment_deposits where appointment_id=pg_temp.fid(p_label)
$$;
create function pg_temp.audits(p_label text, p_action text) returns bigint language sql as $$
 select count(*) from public.audit_logs where entity_id=pg_temp.fid(p_label) and action=p_action
$$;
create function pg_temp.save_policy(p_settings jsonb, p_expected bigint) returns text language sql as $$
 select pg_temp.as_actor('owner', format('select public.save_deposit_policy(%L,%L::jsonb,%s)',pg_temp.fid('business'),p_settings,p_expected))
$$;
create function pg_temp.set_deposit(p_actor text, p_label text, p_action text) returns text language sql as $$
 select pg_temp.as_actor(p_actor, format('select status from public.set_appointment_deposit(%L,%L,%L,%s)',
  pg_temp.fid('business'),pg_temp.fid(p_label),p_action,(pg_temp.deposit(p_label)).revision))
$$;

-- Provoked failures (checks 7b and 12c): the target appointment is named in a setting, so the
-- triggers below stay inert for every other check.
create function public.deposit_test_fail() returns trigger language plpgsql as $$
begin
 if coalesce(to_jsonb(new)->>'appointment_id',to_jsonb(new)->>'id') is not distinct from current_setting('cita.deposit_test_fail',true) then
  raise exception 'TEST_PROVOKED_FAILURE';
 end if;
 return new;
end $$;
create trigger zz_deposit_test_fail_confirm before update of status on public.appointments
 for each row when (new.status='confirmed') execute function public.deposit_test_fail();
create trigger zz_deposit_test_fail_cancel before update of status on public.appointments
 for each row when (new.status='cancelled') execute function public.deposit_test_fail();
create trigger zz_deposit_test_fail_reopen before update on public.appointment_deposits
 for each row when (new.status='pending') execute function public.deposit_test_fail();

-- 1. Before the practice turns the policy on, no appointment gets a deposit, and the
-- migration created none for the appointments that already existed.
select pg_temp.appt('before_policy', date_trunc('hour',now())+interval '10 days');
select extensions.ok(not exists(select 1 from public.appointment_deposits),
 'sin política activa no se crea ninguna seña, y la migración no creó ninguna');

-- 2. Only owners and administrators save the policy, always with a valid amount and
-- without overwriting a version saved by someone else.
do $$
declare v text; v_full jsonb:=jsonb_build_object('enabled',true,'auto_cancel_enabled',true,'amount_mode','fixed','fixed_amount',40000,
 'percentage',null,'request_days',7,'deadline_hours',48,'min_payment_hours',24,'transfer_details','Alias natalia.frutos','applies_to_manual',true,
 'excluded_service_ids',jsonb_build_array(pg_temp.fid('service_free')));
begin
 v:=pg_temp.as_actor('reception',format('select public.save_deposit_policy(%L,%L::jsonb,0)',pg_temp.fid('business'),v_full));
 if v not like 'ERROR %DEPOSIT_POLICY_FORBIDDEN%' then raise exception 'TEST_POLICY_RECEPTION %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"fixed_amount":null}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_WITHOUT_AMOUNT %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"fixed_amount":0}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_ZERO_AMOUNT %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"amount_mode":"percentage","percentage":0}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_ZERO_PERCENTAGE %',v; end if;
 -- Never rounded silently: the stored value must be exactly the one the practice wrote.
 v:=pg_temp.save_policy(v_full||'{"fixed_amount":40000.5}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_FRACTIONAL_AMOUNT %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"amount_mode":"percentage","percentage":33.333}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_FRACTIONAL_PERCENTAGE %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"fixed_amount":"40000"}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_TEXT_AMOUNT %',v; end if;
 -- No silent defaults: a missing key, a boolean written as text, a fractional number of days or
 -- an unknown key is an error; so are a list instead of an object and a missing revision.
 v:=pg_temp.save_policy(v_full-'applies_to_manual',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_MISSING_KEY %',v; end if;
 v:=pg_temp.save_policy(v_full-'fixed_amount',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_MISSING_NULLABLE_KEY %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"enabled":"true"}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_TEXT_BOOLEAN %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"transfer_details":7}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_NUMBER_TEXT %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"request_days":7.5}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_FRACTIONAL_DAYS %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"auto_cancel":true}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_UNKNOWN_KEY %',v; end if;
 v:=pg_temp.save_policy(jsonb_build_array(v_full),0);
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_NOT_OBJECT %',v; end if;
 v:=pg_temp.as_actor('owner',format('select public.save_deposit_policy(%L,%L::jsonb,null)',pg_temp.fid('business'),v_full));
 if v not like 'ERROR %DEPOSIT_POLICY_INVALID%' then raise exception 'TEST_POLICY_NULL_REVISION %',v; end if;
 if exists(select 1 from public.deposit_policies where business_id=pg_temp.fid('business')) then
  raise exception 'TEST_POLICY_SAVED_INVALID'; end if;
 v:=pg_temp.save_policy(v_full,0);
 if v<>'1' then raise exception 'TEST_POLICY_SAVE %',v; end if;
 v:=pg_temp.save_policy(v_full||'{"fixed_amount":1}',0);
 if v not like 'ERROR %DEPOSIT_POLICY_CHANGED%' then raise exception 'TEST_POLICY_STALE %',v; end if;
 if (select count(*) from public.audit_logs where business_id=pg_temp.fid('business') and action='business.deposit_policy_saved')<>1 then
  raise exception 'TEST_POLICY_AUDIT'; end if;
end $$;
select extensions.pass('sólo dueña o administración guardan la política, con monto válido y sin pisar una versión ajena');

-- 3. A public booking creates the pending deposit with its amount and its dates in the
-- practice's timezone: requested from the local midnight seven days before, due 48 h before.
do $$
declare a uuid:=pg_temp.appt('public_far', date_trunc('hour',now())+interval '10 days 13 hours'); d public.appointment_deposits; v_starts timestamptz;
begin
 d:=pg_temp.deposit('public_far');
 select starts_at into v_starts from public.appointments where id=a;
 if d.status is distinct from 'pending' or d.amount is distinct from 40000::bigint or d.percentage is not null
  or d.reference_amount is not null or d.due_at is distinct from v_starts-interval '48 hours'
  or d.request_from is distinct from (((v_starts at time zone 'America/Argentina/Cordoba')::date-7)::timestamp at time zone 'America/Argentina/Cordoba')
  or d.auto_cancel is not true or d.request_days is distinct from 7 or d.deadline_hours is distinct from 48
  or d.min_payment_hours is distinct from 24 or d.revision is distinct from 1::bigint or d.policy_revision is distinct from 1::bigint
  or d.business_id is distinct from pg_temp.fid('business') or d.recorded_by is not null or d.recorded_at is not null then
  raise exception 'TEST_DEPOSIT_CREATED %',row_to_json(d); end if;
end $$;
select extensions.pass('una reserva pública crea la seña pendiente con monto, pedido y vencimiento del consultorio');

-- 3b. A turn at 22:30 in Córdoba starts on the next day in UTC: the deposit is requested from
-- the local midnight seven local days before, never from the UTC date. The expected instant
-- comes from the local day itself, not from the turn's instant.
do $$
declare v_day date:=(now() at time zone 'America/Argentina/Cordoba')::date+30;
 v_starts timestamptz:=(v_day+time '22:30') at time zone 'America/Argentina/Cordoba'; d public.appointment_deposits;
begin
 if (v_starts at time zone 'UTC')::date is distinct from v_day+1 then raise exception 'TEST_UTC_MIDNIGHT_FIXTURE %',v_starts; end if;
 perform pg_temp.appt('utc_midnight', v_starts);
 d:=pg_temp.deposit('utc_midnight');
 if d.request_from is distinct from ((v_day-7)::timestamp at time zone 'America/Argentina/Cordoba')
  or d.due_at is distinct from v_starts-interval '48 hours' then
  raise exception 'TEST_UTC_MIDNIGHT %',row_to_json(d); end if;
end $$;
select extensions.pass('un turno que cruza la medianoche de UTC se pide desde la medianoche local, siete días locales antes');

-- 4. Last-minute bookings never cancel themselves: less than 24 h between booking and due
-- date, or the due date already passed when booking. Exactly 24 h is enough; one second less
-- is not (the booking instant is the transaction's, as in production).
do $$
begin
 perform pg_temp.appt('late_window', date_trunc('hour',now())+interval '60 hours');
 perform pg_temp.appt('late_past', date_trunc('hour',now())+interval '30 hours');
 perform pg_temp.appt('boundary_exact', now()+interval '72 hours');
 perform pg_temp.appt('boundary_short', now()+interval '72 hours'-interval '1 second','public_booking','service','professional2');
 if (pg_temp.deposit('late_window')).status is distinct from 'pending' or (pg_temp.deposit('late_window')).auto_cancel is not false
  or (pg_temp.deposit('late_past')).status is distinct from 'pending' or (pg_temp.deposit('late_past')).auto_cancel is not false
  or (pg_temp.deposit('boundary_exact')).auto_cancel is not true or (pg_temp.deposit('boundary_short')).auto_cancel is not false then
  raise exception 'TEST_LAST_MINUTE % % % %',row_to_json(pg_temp.deposit('late_window')),row_to_json(pg_temp.deposit('late_past')),
   row_to_json(pg_temp.deposit('boundary_exact')),row_to_json(pg_temp.deposit('boundary_short')); end if;
end $$;
select extensions.pass('una reserva de último momento queda pendiente pero no se cancela sola; 24 horas justas alcanzan');

-- 5. Excluded services never ask for a deposit; a fixed deposit is the same on a service with
-- a fee; bookings made by the practice follow the policy, and a policy change only affects new
-- bookings.
do $$
declare v text;
begin
 perform pg_temp.appt('excluded', date_trunc('hour',now())+interval '11 days 13 hours','public_booking','service_free');
 perform pg_temp.appt('manual_with', date_trunc('hour',now())+interval '11 days 15 hours','manual');
 perform pg_temp.appt('fixed_priced', date_trunc('hour',now())+interval '11 days 21 hours','public_booking','service_priced');
 if exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.fid('excluded'))
  or not exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.fid('manual_with')) then
  raise exception 'TEST_EXCLUSION_OR_MANUAL'; end if;
 if (select price_quote_snapshot->>'amount' from public.appointments where id=pg_temp.fid('fixed_priced')) is null then
  raise exception 'TEST_FIXED_PRICED_FIXTURE'; end if;
 if (pg_temp.deposit('fixed_priced')).amount is distinct from 40000::bigint or (pg_temp.deposit('fixed_priced')).percentage is not null
  or (pg_temp.deposit('fixed_priced')).reference_amount is not null then
  raise exception 'TEST_FIXED_ON_PRICED %',row_to_json(pg_temp.deposit('fixed_priced')); end if;
 v:=pg_temp.save_policy(jsonb_build_object('enabled',true,'auto_cancel_enabled',true,'amount_mode','fixed','fixed_amount',45000,
  'percentage',null,'request_days',14,'deadline_hours',72,'min_payment_hours',24,'transfer_details','Alias natalia.frutos','applies_to_manual',false,
  'excluded_service_ids',jsonb_build_array(pg_temp.fid('service_free'))),1);
 if v<>'2' then raise exception 'TEST_POLICY_UPDATE %',v; end if;
 perform pg_temp.appt('manual_without', date_trunc('hour',now())+interval '11 days 17 hours','manual');
 perform pg_temp.appt('public_new_policy', date_trunc('hour',now())+interval '11 days 19 hours');
 if exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.fid('manual_without'))
  or (pg_temp.deposit('public_new_policy')).amount is distinct from 45000::bigint
  or (pg_temp.deposit('public_new_policy')).deadline_hours is distinct from 72
  or (pg_temp.deposit('public_new_policy')).policy_revision is distinct from 2::bigint
  or (pg_temp.deposit('public_far')).amount is distinct from 40000::bigint or (pg_temp.deposit('public_far')).deadline_hours is distinct from 48
  or (pg_temp.deposit('fixed_priced')).amount is distinct from 40000::bigint then
  raise exception 'TEST_POLICY_SNAPSHOT'; end if;
end $$;
select extensions.pass('las prestaciones excluidas no piden seña, la seña fija no depende del arancel y cambiar la política sólo afecta las reservas nuevas');

-- 6. A turn with a pending deposit cannot become Confirmado by any path: a direct write, the
-- person's link (the server's update as service_role, at the observed status) or a status
-- update of the practice (as reception, through row level security).
do $$
-- Resolved before changing roles: service_role does not read the fixture table.
declare v text; v_appointment uuid:=pg_temp.fid('public_far'); v_business uuid:=pg_temp.fid('business');
begin
 begin
  update public.appointments set status='confirmed',confirmed_at=now() where id=v_appointment;
  raise exception 'TEST_INVARIANT_NOT_ENFORCED';
 exception when others then
  if sqlerrm not like '%APPOINTMENT_DEPOSIT_PENDING%' then raise; end if;
 end;
 begin
  set local role service_role;
  update public.appointments set status='confirmed',confirmed_at=now()
  where id=v_appointment and business_id=v_business and status='reserved';
  raise exception 'TEST_LINK_NOT_ENFORCED';
 exception when others then
  if sqlerrm not like '%APPOINTMENT_DEPOSIT_PENDING%' then raise; end if;
 end;
 reset role;
 v:=pg_temp.as_actor('reception',format('update public.appointments set status=%L,confirmed_at=now() where id=%L and business_id=%L and status=%L returning status',
  'confirmed',pg_temp.fid('public_far'),pg_temp.fid('business'),'reserved'));
 if v not like 'ERROR %APPOINTMENT_DEPOSIT_PENDING%' then raise exception 'TEST_STAFF_NOT_ENFORCED %',v; end if;
end $$;
select extensions.ok((select status from public.appointments where id=pg_temp.fid('public_far'))='reserved',
 'un turno con la seña pendiente no puede pasar a Confirmado por ninguna vía');

-- 7. Reception records the deposit: the deposit is received and the turn confirmed in
-- the same transaction, with one audit entry; repeating it changes nothing.
do $$
declare v text; v_rev bigint;
begin
 v:=pg_temp.set_deposit('reception','public_far','paid');
 if v<>'paid' then raise exception 'TEST_PAID %',v; end if;
 v_rev:=(pg_temp.deposit('public_far')).revision;
 v:=pg_temp.as_actor('reception',format('select status from public.set_appointment_deposit(%L,%L,%L,%s)',
  pg_temp.fid('business'),pg_temp.fid('public_far'),'paid',v_rev-1));
 if v<>'paid' then raise exception 'TEST_PAID_REPEAT %',v; end if;
 if (select status from public.appointments where id=pg_temp.fid('public_far')) is distinct from 'confirmed'
  or (pg_temp.deposit('public_far')).recorded_by is distinct from pg_temp.fid('reception')
  or (pg_temp.deposit('public_far')).revision is distinct from v_rev
  or pg_temp.audits('public_far','appointment.deposit_paid')<>1 then
  raise exception 'TEST_PAID_EFFECTS'; end if;
end $$;
select extensions.pass('confirmar la seña confirma el turno, audita una vez y repetirla no cambia nada');

-- 7b. A failure provoked in the middle of «Confirmar seña» (after the deposit changed) or of
-- «Deshacer» (after the turn changed) leaves no mixed state and no audit entry.
do $$
declare v text; v_rev bigint; v_audits bigint;
begin
 perform pg_temp.appt('fail_confirm', date_trunc('hour',now())+interval '16 days 13 hours');
 v_rev:=(pg_temp.deposit('fail_confirm')).revision;
 v_audits:=(select count(*) from public.audit_logs where entity_id=pg_temp.fid('fail_confirm'));
 perform set_config('cita.deposit_test_fail',pg_temp.fid('fail_confirm')::text,true);
 v:=pg_temp.set_deposit('reception','fail_confirm','paid');
 perform set_config('cita.deposit_test_fail','',true);
 if v not like 'ERROR %TEST_PROVOKED_FAILURE%' then raise exception 'TEST_CONFIRM_FAILURE_NOT_PROVOKED %',v; end if;
 if (pg_temp.deposit('fail_confirm')).status is distinct from 'pending' or (pg_temp.deposit('fail_confirm')).revision is distinct from v_rev
  or (pg_temp.deposit('fail_confirm')).recorded_by is not null
  or (select status from public.appointments where id=pg_temp.fid('fail_confirm')) is distinct from 'reserved'
  or (select count(*) from public.audit_logs where entity_id=pg_temp.fid('fail_confirm')) is distinct from v_audits then
  raise exception 'TEST_CONFIRM_MIXED %',row_to_json(pg_temp.deposit('fail_confirm')); end if;
 v:=pg_temp.set_deposit('reception','fail_confirm','paid');
 if v<>'paid' then raise exception 'TEST_CONFIRM_AFTER_FAILURE %',v; end if;
 v_rev:=(pg_temp.deposit('fail_confirm')).revision;
 v_audits:=(select count(*) from public.audit_logs where entity_id=pg_temp.fid('fail_confirm'));
 perform set_config('cita.deposit_test_fail',pg_temp.fid('fail_confirm')::text,true);
 v:=pg_temp.set_deposit('reception','fail_confirm','pending');
 perform set_config('cita.deposit_test_fail','',true);
 if v not like 'ERROR %TEST_PROVOKED_FAILURE%' then raise exception 'TEST_UNDO_FAILURE_NOT_PROVOKED %',v; end if;
 if (pg_temp.deposit('fail_confirm')).status is distinct from 'paid' or (pg_temp.deposit('fail_confirm')).revision is distinct from v_rev
  or (select status from public.appointments where id=pg_temp.fid('fail_confirm')) is distinct from 'confirmed'
  or (select count(*) from public.audit_logs where entity_id=pg_temp.fid('fail_confirm')) is distinct from v_audits then
  raise exception 'TEST_UNDO_MIXED %',row_to_json(pg_temp.deposit('fail_confirm')); end if;
end $$;
select extensions.pass('una falla a mitad de «Confirmar seña» o de «Deshacer» no deja seña y turno mezclados ni auditoría');

-- 8. Professionals, read-only users, strangers and members of another practice cannot touch
-- deposits, nor can a practice that does not operate; a stale or missing revision is a
-- conflict, never a silent overwrite; only an active turn changes its deposit.
do $$
declare v text;
begin
 foreach v in array array['pro','readonly','stranger','other_owner'] loop
  if pg_temp.set_deposit(v,'manual_with','paid') not like 'ERROR %DEPOSIT_FORBIDDEN%' then raise exception 'TEST_FORBIDDEN %',v; end if;
 end loop;
 v:=pg_temp.as_actor('other_owner',format('select status from public.set_appointment_deposit(%L,%L,%L,%s)',
  pg_temp.fid('business2'),pg_temp.fid('manual_with'),'paid',(pg_temp.deposit('manual_with')).revision));
 if v not like 'ERROR %DEPOSIT_NOT_FOUND%' then raise exception 'TEST_OTHER_PRACTICE_OWN_ID %',v; end if;
 update public.business_subscriptions set commercial_access_enabled=false where business_id=pg_temp.fid('business');
 v:=pg_temp.set_deposit('reception','manual_with','paid');
 update public.business_subscriptions set commercial_access_enabled=true where business_id=pg_temp.fid('business');
 if v not like 'ERROR %DEPOSIT_FORBIDDEN%' then raise exception 'TEST_RESTRICTED_PRACTICE %',v; end if;
 v:=pg_temp.as_actor('reception',format('select status from public.set_appointment_deposit(%L,%L,%L,%s)',
  pg_temp.fid('business'),pg_temp.fid('manual_with'),'paid',(pg_temp.deposit('manual_with')).revision+5));
 if v not like 'ERROR %DEPOSIT_CHANGED%' then raise exception 'TEST_STALE_REVISION %',v; end if;
 v:=pg_temp.as_actor('reception',format('select status from public.set_appointment_deposit(%L,%L,%L,null)',
  pg_temp.fid('business'),pg_temp.fid('manual_with'),'paid'));
 if v not like 'ERROR %DEPOSIT_ACTION_INVALID%' then raise exception 'TEST_NULL_REVISION %',v; end if;
 if (pg_temp.deposit('manual_with')).status is distinct from 'pending' then raise exception 'TEST_FORBIDDEN_CHANGED'; end if;
 perform pg_temp.appt('attended_turn', date_trunc('hour',now())-interval '3 hours');
 perform set_config('request.jwt.claim.sub','',true);
 update public.appointments set status='attended',attended_at=now() where id=pg_temp.fid('attended_turn');
 v:=pg_temp.set_deposit('reception','attended_turn','paid');
 if v not like 'ERROR %DEPOSIT_APPOINTMENT_CLOSED%' then raise exception 'TEST_ATTENDED_CLOSED %',v; end if;
 if (pg_temp.deposit('attended_turn')).status is distinct from 'pending' then raise exception 'TEST_ATTENDED_CHANGED'; end if;
end $$;
select extensions.pass('sólo dueña, administración y recepción de un consultorio que opera registran señas de turnos activos, sin pisar versiones');

-- 9. Undo returns the deposit to pending and the turn to Reservado; an undo once the due
-- date passed, or within the minimum payment window, never makes the turn cancel itself.
do $$
declare v text;
begin
 v:=pg_temp.set_deposit('owner','public_far','pending');
 if v<>'pending' or (select status from public.appointments where id=pg_temp.fid('public_far')) is distinct from 'reserved'
  or (pg_temp.deposit('public_far')).auto_cancel is not true then raise exception 'TEST_UNDO %',v; end if;
 v:=pg_temp.set_deposit('owner','public_far','paid');
 if v<>'paid' then raise exception 'TEST_REPAY %',v; end if;
 update public.appointment_deposits set due_at=now()-interval '1 hour' where appointment_id=pg_temp.fid('public_far');
 v:=pg_temp.set_deposit('owner','public_far','pending');
 if v<>'pending' or (pg_temp.deposit('public_far')).auto_cancel is not false then raise exception 'TEST_UNDO_AFTER_DUE %',v; end if;
end $$;
select extensions.pass('deshacer vuelve a pendiente y a Reservado, y después del vencimiento ya no cancela solo');

-- 10. Waiving confirms the turn as well, and is recorded as a decision of the practice; repeating
-- a waiver or undoing a pending deposit succeeds without a second audit entry.
do $$
declare v text:=pg_temp.set_deposit('reception','manual_with','waived');
begin
 if v<>'waived' or (pg_temp.deposit('manual_with')).waived_reason is distinct from 'staff'
  or (select status from public.appointments where id=pg_temp.fid('manual_with')) is distinct from 'confirmed' then
  raise exception 'TEST_WAIVE %',v; end if;
 v:=pg_temp.set_deposit('reception','manual_with','waived');
 if v<>'waived' or pg_temp.audits('manual_with','appointment.deposit_waived')<>1 then raise exception 'TEST_WAIVE_REPEAT %',v; end if;
 v:=pg_temp.set_deposit('reception','public_new_policy','pending');
 if v<>'pending' or pg_temp.audits('public_new_policy','appointment.deposit_reopened')<>0 then raise exception 'TEST_UNDO_PENDING %',v; end if;
end $$;
select extensions.pass('exceptuar la seña confirma el turno, queda como decisión del consultorio y repetir no duplica nada');

-- 11. Moving a turn recomputes a pending deposit with its own snapshot, measured from
-- the moment it moves; a received deposit travels with the turn unchanged.
do $$
declare d_before public.appointment_deposits; d_after public.appointment_deposits; v_new timestamptz:=date_trunc('hour',now())+interval '20 days 13 hours';
begin
 perform pg_temp.appt('moved_pending', date_trunc('hour',now())+interval '12 days 13 hours');
 update public.appointments set starts_at=v_new,ends_at=v_new+interval '60 minutes',blocking_starts_at=v_new,blocking_ends_at=v_new+interval '60 minutes'
 where id=pg_temp.fid('moved_pending');
 d_after:=pg_temp.deposit('moved_pending');
 if d_after.status is distinct from 'pending' or d_after.deadline_hours is distinct from 72 or d_after.request_days is distinct from 14
  or d_after.due_at is distinct from v_new-interval '72 hours'
  or d_after.request_from is distinct from (((v_new at time zone 'America/Argentina/Cordoba')::date-14)::timestamp at time zone 'America/Argentina/Cordoba')
  or d_after.auto_cancel is not true or d_after.revision is distinct from 2::bigint then
  raise exception 'TEST_MOVE_PENDING %',row_to_json(d_after); end if;
 d_before:=pg_temp.deposit('manual_with');
 if d_before.appointment_id is null or d_before.status is distinct from 'waived' then raise exception 'TEST_MOVE_SETTLED_FIXTURE'; end if;
 v_new:=date_trunc('hour',now())+interval '21 days 13 hours';
 update public.appointments set starts_at=v_new,ends_at=v_new+interval '60 minutes',blocking_starts_at=v_new,blocking_ends_at=v_new+interval '60 minutes'
 where id=pg_temp.fid('manual_with');
 if row_to_json(pg_temp.deposit('manual_with'))::text is distinct from row_to_json(d_before)::text then raise exception 'TEST_MOVE_SETTLED'; end if;
end $$;
select extensions.pass('reprogramar recalcula una seña pendiente con su fotografía y no toca una resuelta');

-- 12. The automatic cancellation acts only with no doubt at all. At a simulated time P,
-- one turn is eligible and each other one breaks exactly one condition.
do $$
declare v_now timestamptz:=date_trunc('hour',now())+interval '100 days'; v_count integer; d public.appointment_deposits; v text;
begin
 perform pg_temp.appt('expire_ok', v_now+interval '47 hours');
 perform pg_temp.appt('expire_paid', v_now+interval '49 hours');
 perform pg_temp.appt('expire_reschedule', v_now+interval '51 hours');
 perform pg_temp.appt('expire_stale', v_now+interval '53 hours');
 perform pg_temp.appt('expire_manual_decision', v_now+interval '55 hours');
 perform pg_temp.appt('expire_waived', v_now+interval '57 hours');
 perform pg_temp.appt('expire_started', v_now-interval '1 hour');
 update public.appointment_deposits set due_at=v_now-interval '1 hour',auto_cancel=true
  where appointment_id in (pg_temp.fid('expire_ok'),pg_temp.fid('expire_paid'),pg_temp.fid('expire_reschedule'),
   pg_temp.fid('expire_waived'),pg_temp.fid('expire_started'));
 update public.appointment_deposits set due_at=v_now-interval '25 hours',auto_cancel=true where appointment_id=pg_temp.fid('expire_stale');
 update public.appointment_deposits set due_at=v_now-interval '1 hour',auto_cancel=false where appointment_id=pg_temp.fid('expire_manual_decision');
 v:=pg_temp.set_deposit('reception','expire_paid','paid');
 if v<>'paid' then raise exception 'TEST_EXPIRE_FIXTURE_PAID %',v; end if;
 v:=pg_temp.set_deposit('reception','expire_waived','waived');
 if v<>'waived' then raise exception 'TEST_EXPIRE_FIXTURE_WAIVED %',v; end if;
 perform set_config('request.jwt.claim.sub','',true);
 update public.appointments set status='reschedule_requested',reschedule_requested_at=now() where id=pg_temp.fid('expire_reschedule');
 v_count:=private.expire_unpaid_deposits(v_now,100);
 if v_count<>1 then raise exception 'TEST_EXPIRE_COUNT %',v_count; end if;
 d:=pg_temp.deposit('expire_ok');
 if d.status is distinct from 'expired' or d.expired_at is distinct from v_now
  or (select status from public.appointments where id=pg_temp.fid('expire_ok')) is distinct from 'cancelled'
  or (select cancelled_at from public.appointments where id=pg_temp.fid('expire_ok')) is distinct from v_now
  or (select cancelled_by_user_id from public.appointments where id=pg_temp.fid('expire_ok')) is not null
  or (select cancelled_reason from public.appointments where id=pg_temp.fid('expire_ok')) is distinct from
   'Seña no registrada antes del '||to_char((v_now-interval '1 hour') at time zone 'America/Argentina/Cordoba','DD/MM/YYYY HH24:MI')
  or pg_temp.audits('expire_ok','appointment.deposit_expired')<>1 then
  raise exception 'TEST_EXPIRE_EFFECTS %',row_to_json(d); end if;
 if exists(select 1 from public.appointments where id in (pg_temp.fid('expire_paid'),pg_temp.fid('expire_reschedule'),pg_temp.fid('expire_stale'),
  pg_temp.fid('expire_manual_decision'),pg_temp.fid('expire_waived'),pg_temp.fid('expire_started')) and status='cancelled') then
  raise exception 'TEST_EXPIRE_TOO_MUCH'; end if;
 if (select last_run_finished_at from private.deposit_automation) is null
  or (select last_run_processed from private.deposit_automation) is distinct from 1
  or (select last_run_cancelled from private.deposit_automation) is distinct from 1 then raise exception 'TEST_EXPIRE_HEARTBEAT'; end if;
end $$;
select extensions.pass('la baja automática cancela sólo el turno sin ninguna duda, y deja su registro');

-- 12b. The job may hold a stale list: a deposit recorded after its query started, on a turn
-- whose row did not change (a reschedule request), still looks pending in that list.
-- Each turn is decided by a function that re-reads everything under the turn's lock.
do $$
declare v_now timestamptz:=date_trunc('hour',now())+interval '100 days';
begin
 if private.expire_deposit_if_still_due(pg_temp.fid('expire_paid'),v_now)
  or private.expire_deposit_if_still_due(pg_temp.fid('expire_reschedule'),v_now)
  or private.expire_deposit_if_still_due(pg_temp.fid('expire_stale'),v_now) then raise exception 'TEST_RECHECK'; end if;
 if (pg_temp.deposit('expire_paid')).status is distinct from 'paid' or (pg_temp.deposit('expire_reschedule')).status is distinct from 'pending'
  or (pg_temp.deposit('expire_stale')).status is distinct from 'pending'
  or (select status from public.appointments where id=pg_temp.fid('expire_reschedule')) is distinct from 'reschedule_requested' then
  raise exception 'TEST_RECHECK_CHANGED'; end if;
end $$;
select extensions.pass('cada turno se decide releyendo seña, turno y política con el turno bloqueado');

-- 12c. A failure provoked inside the automatic cancellation undoes everything: the turn stays
-- Reservado and keeps its slot, the deposit stays pending, and neither an audit entry nor the
-- heartbeat of that run remains. Without the failure, the same turn is cancelled.
do $$
declare v_now timestamptz:=date_trunc('hour',now())+interval '130 days'; v_before text; v_rev bigint; v_count integer;
begin
 perform pg_temp.appt('fail_job', v_now+interval '47 hours');
 update public.appointment_deposits set due_at=v_now-interval '1 hour',auto_cancel=true where appointment_id=pg_temp.fid('fail_job');
 v_rev:=(pg_temp.deposit('fail_job')).revision;
 v_before:=(select row(last_run_started_at,last_run_finished_at,last_run_processed,last_run_cancelled)::text from private.deposit_automation);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('cita.deposit_test_fail',pg_temp.fid('fail_job')::text,true);
 begin
  v_count:=private.expire_unpaid_deposits(v_now,100);
  raise exception 'TEST_JOB_FAILURE_NOT_PROVOKED %',v_count;
 exception when others then
  if sqlerrm not like '%TEST_PROVOKED_FAILURE%' then raise; end if;
 end;
 perform set_config('cita.deposit_test_fail','',true);
 if (pg_temp.deposit('fail_job')).status is distinct from 'pending' or (pg_temp.deposit('fail_job')).expired_at is not null
  or (pg_temp.deposit('fail_job')).revision is distinct from v_rev
  or (select status from public.appointments where id=pg_temp.fid('fail_job')) is distinct from 'reserved'
  or pg_temp.audits('fail_job','appointment.deposit_expired')<>0
  or (select row(last_run_started_at,last_run_finished_at,last_run_processed,last_run_cancelled)::text from private.deposit_automation)
   is distinct from v_before then
  raise exception 'TEST_JOB_FAILURE_LEFT_CHANGES %',row_to_json(pg_temp.deposit('fail_job')); end if;
 begin
  perform pg_temp.appt('fail_job_overlap', v_now+interval '47 hours','manual');
  raise exception 'TEST_JOB_FAILURE_FREED_SLOT';
 exception when exclusion_violation then null;
 end;
 v_count:=private.expire_unpaid_deposits(v_now,100);
 if v_count<>1 or (pg_temp.deposit('fail_job')).status is distinct from 'expired' then raise exception 'TEST_JOB_AFTER_FAILURE %',v_count; end if;
end $$;
select extensions.pass('una falla dentro de la baja automática deshace turno, seña, auditoría y registro de la ejecución');

-- 13. The cancelled slot is free again: another turn of the same professional fits it, also
-- when the cancelled turn was a team turn (the second professional's slot is released too).
do $$
declare v_starts timestamptz:=(select starts_at from public.appointments where id=pg_temp.fid('expire_ok'));
 v_now timestamptz:=date_trunc('hour',now())+interval '120 days'; v_count integer;
begin
 perform pg_temp.appt('slot_reused', v_starts,'manual');
 perform pg_temp.appt('team_due', v_now+interval '47 hours');
 insert into public.appointment_professionals(business_id,appointment_id,professional_id,position,is_primary)
 values(pg_temp.fid('business'),pg_temp.fid('team_due'),pg_temp.fid('professional2'),1,false);
 begin
  perform pg_temp.appt('team_overlap_before', v_now+interval '47 hours','manual','service','professional2');
  raise exception 'TEST_TEAM_SLOT_NOT_TAKEN';
 exception when exclusion_violation then null;
 end;
 update public.appointment_deposits set due_at=v_now-interval '1 hour',auto_cancel=true where appointment_id=pg_temp.fid('team_due');
 perform set_config('request.jwt.claim.sub','',true);
 v_count:=private.expire_unpaid_deposits(v_now,100);
 if v_count<>1 then raise exception 'TEST_TEAM_EXPIRE %',v_count; end if;
 perform pg_temp.appt('team_reused', v_now+interval '47 hours','manual','service','professional2');
end $$;
select extensions.ok(pg_temp.fid('slot_reused') is not null and pg_temp.fid('team_reused') is not null,
 'el horario de un turno cancelado por la seña vuelve a estar libre, también en un turno de equipo');

-- 14. Nothing is cancelled with the global switch off, the practice's automatic cancellation
-- off, its deposit policy off, a restricted practice or an inactive one; each run still
-- records its heartbeat.
do $$
declare v_now timestamptz:=date_trunc('hour',now())+interval '110 days'; v text; v_before timestamptz; v_count integer;
begin
 perform pg_temp.appt('guard_target', v_now+interval '47 hours');
 update public.appointment_deposits set due_at=v_now-interval '1 hour',auto_cancel=true where appointment_id=pg_temp.fid('guard_target');
 perform set_config('request.jwt.claim.sub','',true);
 update private.deposit_automation set enabled=false;
 v_before:=(select last_run_finished_at from private.deposit_automation);
 v_count:=private.expire_unpaid_deposits(v_now,100);
 if v_count<>0 or (select last_run_finished_at from private.deposit_automation) is not distinct from v_before
  or (select last_run_processed from private.deposit_automation) is distinct from 0 then
  raise exception 'TEST_GLOBAL_SWITCH %',v_count; end if;
 update private.deposit_automation set enabled=true;
 v:=pg_temp.save_policy(jsonb_build_object('enabled',true,'auto_cancel_enabled',false,'amount_mode','fixed','fixed_amount',45000,
  'percentage',null,'request_days',14,'deadline_hours',72,'min_payment_hours',24,'transfer_details','Alias natalia.frutos','applies_to_manual',false,
  'excluded_service_ids',jsonb_build_array(pg_temp.fid('service_free'))),2);
 perform set_config('request.jwt.claim.sub','',true);
 if v<>'3' or private.expire_unpaid_deposits(v_now,100)<>0 then raise exception 'TEST_PRACTICE_SWITCH %',v; end if;
 v:=pg_temp.save_policy(jsonb_build_object('enabled',true,'auto_cancel_enabled',true,'amount_mode','fixed','fixed_amount',45000,
  'percentage',null,'request_days',14,'deadline_hours',72,'min_payment_hours',24,'transfer_details','Alias natalia.frutos','applies_to_manual',false,
  'excluded_service_ids',jsonb_build_array(pg_temp.fid('service_free'))),3);
 perform set_config('request.jwt.claim.sub','',true);
 if v<>'4' then raise exception 'TEST_PRACTICE_SWITCH_BACK %',v; end if;
 -- The policy itself off, without the waiver that saving it would apply.
 update public.deposit_policies set enabled=false where business_id=pg_temp.fid('business');
 if private.expire_unpaid_deposits(v_now,100)<>0 then raise exception 'TEST_POLICY_OFF'; end if;
 update public.deposit_policies set enabled=true where business_id=pg_temp.fid('business');
 update public.business_subscriptions set commercial_access_enabled=false where business_id=pg_temp.fid('business');
 if private.expire_unpaid_deposits(v_now,100)<>0 then raise exception 'TEST_RESTRICTED'; end if;
 update public.business_subscriptions set commercial_access_enabled=true where business_id=pg_temp.fid('business');
 update public.businesses set is_active=false where id=pg_temp.fid('business');
 if private.expire_unpaid_deposits(v_now,100)<>0 then raise exception 'TEST_INACTIVE'; end if;
 update public.businesses set is_active=true where id=pg_temp.fid('business');
 if private.expire_unpaid_deposits(v_now,100)<>1 then raise exception 'TEST_GUARDS_RELEASED'; end if;
end $$;
select extensions.pass('sin interruptor general, sin cancelación o seña del consultorio, o con el consultorio restringido o inactivo, no se cancela nada');

-- 15. A percentage of the fee quoted for the turn's month, rounded with the fee's own unit
-- (adjustment 1 keeps both forms). Without a fee and without a fixed fallback no deposit is
-- asked; with the fallback, the fixed amount; with a monthly adjustment, the fee of the turn's
-- month, not this month's.
do $$
declare v text; v_rev bigint:=(select revision from public.deposit_policies where business_id=pg_temp.fid('business'));
 v_starts timestamptz:=date_trunc('hour',now())+interval '70 days 13 hours'; v_quote jsonb; v_today jsonb;
 v_policy jsonb:=jsonb_build_object('enabled',true,'auto_cancel_enabled',true,'amount_mode','percentage','percentage',35,
  'fixed_amount',null,'request_days',7,'deadline_hours',48,'min_payment_hours',24,'transfer_details','Alias natalia.frutos',
  'applies_to_manual',true,'excluded_service_ids','[]'::jsonb);
begin
 v:=pg_temp.save_policy(v_policy,v_rev);
 if v_rev is null or v is distinct from (v_rev+1)::text then raise exception 'TEST_PERCENTAGE_POLICY %',v; end if;
 perform pg_temp.appt('percentage_no_fee', date_trunc('hour',now())+interval '13 days 15 hours','manual');
 if exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.fid('percentage_no_fee')) then
  raise exception 'TEST_PERCENTAGE_WITHOUT_AMOUNT'; end if;
 v:=pg_temp.save_policy(v_policy||'{"fixed_amount":30000}',v_rev+1);
 if v is distinct from (v_rev+2)::text then raise exception 'TEST_PERCENTAGE_FALLBACK_POLICY %',v; end if;
 perform pg_temp.appt('percentage_fallback', date_trunc('hour',now())+interval '13 days 17 hours','manual');
 if (pg_temp.deposit('percentage_fallback')).amount is distinct from 30000::bigint or (pg_temp.deposit('percentage_fallback')).percentage is not null
  or (pg_temp.deposit('percentage_fallback')).reference_amount is not null then
  raise exception 'TEST_PERCENTAGE_FALLBACK %',row_to_json(pg_temp.deposit('percentage_fallback')); end if;
 v_quote:=private.resolve_service_price(pg_temp.fid('business'),pg_temp.fid('service_priced'),array[pg_temp.fid('professional')],
  (v_starts at time zone 'America/Argentina/Cordoba')::date);
 v_today:=private.resolve_service_price(pg_temp.fid('business'),pg_temp.fid('service_priced'),array[pg_temp.fid('professional')],
  (now() at time zone 'America/Argentina/Cordoba')::date);
 if (v_quote->>'amount')::bigint is null or (v_quote->>'amount')::bigint is not distinct from (v_today->>'amount')::bigint then
  raise exception 'TEST_MONTHLY_FIXTURE % %',v_quote,v_today; end if;
 perform pg_temp.appt('percentage_adjusted', v_starts,'manual','service_priced');
 if (pg_temp.deposit('percentage_adjusted')).reference_amount is distinct from (v_quote->>'amount')::bigint
  or (pg_temp.deposit('percentage_adjusted')).amount is distinct from (round((v_quote->>'amount')::numeric*35/100/100)*100)::bigint
  or (pg_temp.deposit('percentage_adjusted')).percentage is distinct from 35::numeric then
  raise exception 'TEST_PERCENTAGE_MONTH % %',v_quote,row_to_json(pg_temp.deposit('percentage_adjusted')); end if;
 -- 35 % of 115.000 is 40.250, rounded to the fee's unit of 100: 40.300.
 insert into public.service_price_policies(business_id,service_id,professional_id,base_amount,base_month,first_adjustment_month,monthly_percentage,rounding_unit)
 values(pg_temp.fid('business'),pg_temp.fid('service'),null,115000,date_trunc('month',now()-interval '1 month')::date,
  date_trunc('month',now())::date,0,100);
 v:=pg_temp.save_policy(v_policy,v_rev+2);
 if v is distinct from (v_rev+3)::text then raise exception 'TEST_PERCENTAGE_POLICY_BACK %',v; end if;
 perform pg_temp.appt('percentage', date_trunc('hour',now())+interval '13 days 13 hours','manual');
 if (pg_temp.deposit('percentage')).amount is distinct from 40300::bigint or (pg_temp.deposit('percentage')).percentage is distinct from 35::numeric
  or (pg_temp.deposit('percentage')).reference_amount is distinct from 115000::bigint then
  raise exception 'TEST_PERCENTAGE %',row_to_json(pg_temp.deposit('percentage')); end if;
end $$;
select extensions.pass('la seña puede ser un porcentaje del arancel del mes del turno, con su redondeo y su respaldo fijo');

-- 16. The terms shown before booking come from the same rule, through the server only:
-- with the quote the booking page holds, the same amount; without a quote a percentage
-- policy has no amount, and then no deposit is asked, exactly as the booking would do.
do $$
declare v_starts timestamptz:=date_trunc('hour',now())+interval '15 days 13 hours'; v jsonb; v_without jsonb; v_denied text;
 v_business uuid:=pg_temp.fid('business'); v_service uuid:=pg_temp.fid('service');
 v_quote jsonb:=private.resolve_service_price(pg_temp.fid('business'),pg_temp.fid('service'),array[pg_temp.fid('professional')],
  (v_starts at time zone 'America/Argentina/Cordoba')::date);
begin
 set local role service_role;
 v:=public.get_deposit_terms(v_business,v_service,v_starts,'public_booking',v_quote);
 v_without:=public.get_deposit_terms(v_business,v_service,v_starts,'public_booking',null);
 reset role;
 if v->>'required' is distinct from 'true' or (v->>'amount')::bigint is distinct from 40300::bigint
  or (v->>'due_at')::timestamptz is distinct from v_starts-interval '48 hours'
  or v->>'auto_cancel' is distinct from 'true' or v->>'transfer_details' is distinct from 'Alias natalia.frutos' then
  raise exception 'TEST_TERMS %',v; end if;
 if v_without->>'required' is distinct from 'false' then raise exception 'TEST_TERMS_WITHOUT_QUOTE %',v_without; end if;
 v_denied:=pg_temp.as_actor('stranger',format('select public.get_deposit_terms(%L,%L,%L,%L,null)::text',
  v_business,v_service,v_starts,'public_booking'));
 if v_denied not like 'ERROR %permission denied%' then raise exception 'TEST_TERMS_PRIVILEGE %',v_denied; end if;
end $$;
select extensions.pass('las condiciones previas a reservar usan la misma regla y sólo las pide el servidor');

-- 16b. Opening the WhatsApp that asks for the deposit records who and when, without a new
-- revision of the deposit, so it never turns another person's «Confirmar seña» into a
-- conflict; only staff who record deposits open it, and only for a pending deposit.
do $$
declare v text; v_rev bigint; d public.appointment_deposits;
begin
 perform pg_temp.appt('reminder', date_trunc('hour',now())+interval '17 days 13 hours');
 v_rev:=(pg_temp.deposit('reminder')).revision;
 if v_rev is null then raise exception 'TEST_REMINDER_FIXTURE'; end if;
 v:=pg_temp.as_actor('pro',format('select coalesce(previously_opened_at::text,%L) from public.open_appointment_deposit_reminder(%L,%L)',
  'never',pg_temp.fid('business'),pg_temp.fid('reminder')));
 if v not like 'ERROR %DEPOSIT_FORBIDDEN%' then raise exception 'TEST_REMINDER_PROFESSIONAL %',v; end if;
 v:=pg_temp.as_actor('reception',format('select coalesce(previously_opened_at::text,%L) from public.open_appointment_deposit_reminder(%L,%L)',
  'never',pg_temp.fid('business'),pg_temp.fid('reminder')));
 if v is distinct from 'never' then raise exception 'TEST_REMINDER_FIRST %',v; end if;
 d:=pg_temp.deposit('reminder');
 if d.reminder_opened_at is null or d.reminder_opened_by is distinct from pg_temp.fid('reception') or d.revision is distinct from v_rev
  or pg_temp.audits('reminder','appointment.deposit_reminder_opened')<>1 then
  raise exception 'TEST_REMINDER_RECORDED %',row_to_json(d); end if;
 v:=pg_temp.as_actor('owner',format('select coalesce(previously_opened_at::text,%L) from public.open_appointment_deposit_reminder(%L,%L)',
  'never',pg_temp.fid('business'),pg_temp.fid('reminder')));
 if v is distinct from d.reminder_opened_at::text then raise exception 'TEST_REMINDER_SECOND % %',v,d.reminder_opened_at; end if;
 v:=pg_temp.as_actor('reception',format('select status from public.set_appointment_deposit(%L,%L,%L,%s)',
  pg_temp.fid('business'),pg_temp.fid('reminder'),'paid',v_rev));
 if v<>'paid' then raise exception 'TEST_REMINDER_NO_CONFLICT %',v; end if;
 v:=pg_temp.as_actor('reception',format('select coalesce(previously_opened_at::text,%L) from public.open_appointment_deposit_reminder(%L,%L)',
  'never',pg_temp.fid('business'),pg_temp.fid('reminder')));
 if v not like 'ERROR %DEPOSIT_APPOINTMENT_CLOSED%' then raise exception 'TEST_REMINDER_SETTLED %',v; end if;
end $$;
select extensions.pass('abrir el pedido por WhatsApp queda registrado sin crear un conflicto, y sólo sobre una seña pendiente');

-- 17. Turning the policy off waives every pending deposit; no turn is confirmed by it and
-- no turn cancels itself afterwards.
do $$
declare v text; v_rev bigint:=(select revision from public.deposit_policies where business_id=pg_temp.fid('business'));
begin
 v:=pg_temp.save_policy(jsonb_build_object('enabled',false,'auto_cancel_enabled',false,'amount_mode','fixed','fixed_amount',40000,
  'percentage',null,'request_days',7,'deadline_hours',48,'min_payment_hours',24,'transfer_details','','applies_to_manual',true,
  'excluded_service_ids','[]'::jsonb),v_rev);
 if v_rev is null or v is distinct from (v_rev+1)::text then raise exception 'TEST_DISABLE %',v; end if;
 if exists(select 1 from public.appointment_deposits where business_id=pg_temp.fid('business') and status='pending')
  or (pg_temp.deposit('late_window')).status is distinct from 'waived'
  or (pg_temp.deposit('late_window')).waived_reason is distinct from 'policy_disabled'
  or (select status from public.appointments where id=pg_temp.fid('late_window')) is distinct from 'reserved' then
  raise exception 'TEST_DISABLE_EFFECTS'; end if;
 perform pg_temp.appt('after_disable', date_trunc('hour',now())+interval '14 days 13 hours');
 if exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.fid('after_disable')) then
  raise exception 'TEST_DISABLE_NEW'; end if;
end $$;
select extensions.pass('apagar la política exceptúa las pendientes sin confirmar turnos ni crear señas nuevas');

-- 18. Each role reads exactly the deposits of the appointments it reads, with the appointments'
-- rule evaluated once per statement, not once per deposit; nobody writes the tables directly
-- through the Data API, and each function is executable only by the role that uses it.
create temporary table dep_all as select appointment_id from public.appointment_deposits;
grant select on dep_all to authenticated;
set local track_functions='all';
do $$
declare actor text; v_deposits uuid[]; v_appointments uuid[]; v_total integer:=(select count(*) from dep_all); v_calls bigint;
 v_readers regprocedure:='public.user_appointment_reader_business_ids()'; v text;
begin
 if v_total<20 then raise exception 'TEST_RLS_FIXTURE %',v_total; end if;
 foreach actor in array array['owner','reception','readonly','pro','stranger','other_owner'] loop
  perform set_config('request.jwt.claim.sub',pg_temp.fid(actor)::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  v_calls:=coalesce(pg_stat_get_xact_function_calls(v_readers),0);
  execute 'set local role authenticated';
  select coalesce(array_agg(d.appointment_id order by d.appointment_id),'{}') into v_deposits from public.appointment_deposits d;
  execute 'reset role';
  v_calls:=coalesce(pg_stat_get_xact_function_calls(v_readers),0)-v_calls;
  execute 'set local role authenticated';
  select coalesce(array_agg(a.id order by a.id),'{}') into v_appointments from public.appointments a join dep_all on dep_all.appointment_id=a.id;
  execute 'reset role';
  if v_deposits is distinct from v_appointments then raise exception 'TEST_RLS_EQUIVALENCE % % %',actor,v_deposits,v_appointments; end if;
  if v_calls>2 then raise exception 'TEST_RLS_PER_ROW % %',actor,v_calls; end if;
  if (actor in ('owner','reception','readonly') and cardinality(v_deposits)<>v_total)
   or (actor='pro' and (cardinality(v_deposits)=0 or cardinality(v_deposits)>=v_total))
   or (actor in ('stranger','other_owner') and cardinality(v_deposits)<>0) then
   raise exception 'TEST_RLS_VISIBILITY % % of %',actor,cardinality(v_deposits),v_total; end if;
 end loop;
 v:=pg_temp.as_actor('owner',format('update public.appointment_deposits set status=''paid'' where appointment_id=%L returning status',pg_temp.fid('late_past')));
 if v not like 'ERROR %permission denied%' then raise exception 'TEST_DIRECT_WRITE %',v; end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role)
   cross join unnest(array['public.appointment_deposits','public.deposit_policies','public.deposit_service_exclusions']) t(name)
   where has_table_privilege(r.role,t.name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or (r.role='anon' and has_table_privilege(r.role,t.name,'SELECT')))
  or exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role)
   where has_table_privilege(r.role,'private.deposit_automation','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) then
  raise exception 'TEST_WRITE_GRANTS'; end if;
 if exists(select 1 from (values
   ('public.set_appointment_deposit(uuid,uuid,text,bigint,text)',false,true,false),
   ('public.open_appointment_deposit_reminder(uuid,uuid)',false,true,false),
   ('public.save_deposit_policy(uuid,jsonb,bigint)',false,true,false),
   ('public.get_deposit_terms(uuid,uuid,timestamptz,text,jsonb)',false,false,true),
   ('public.get_deposit_automation_status()',false,true,true),
   ('private.deposit_schedule(timestamptz,timestamptz,text,integer,integer,integer)',false,false,false),
   ('private.deposit_amount(public.deposit_policies,uuid,jsonb)',false,false,false),
   ('private.deposit_terms(uuid,uuid,text,timestamptz,timestamptz,jsonb)',false,false,false),
   ('private.create_appointment_deposit()',false,false,false),
   ('private.reschedule_appointment_deposit()',false,false,false),
   ('private.enforce_deposit_before_confirmation()',false,false,false),
   ('private.deposit_actor(uuid,text[])',false,false,false),
   ('private.expire_deposit_if_still_due(uuid,timestamptz)',false,false,false),
   ('private.expire_unpaid_deposits(timestamptz,integer)',false,false,false)
  ) f(signature,anon_can,authenticated_can,service_can)
  where has_function_privilege('anon',f.signature::regprocedure,'EXECUTE') is distinct from f.anon_can
   or has_function_privilege('authenticated',f.signature::regprocedure,'EXECUTE') is distinct from f.authenticated_can
   or has_function_privilege('service_role',f.signature::regprocedure,'EXECUTE') is distinct from f.service_can) then
  raise exception 'TEST_FUNCTION_GRANTS'; end if;
end $$;
select extensions.pass('cada rol lee exactamente las señas de los turnos que lee, en una sola evaluación, y nadie escribe ni ejecuta de más');

-- 19. pg_cron runs the cancellation every five minutes and prunes its own history daily.
select extensions.ok(
 exists(select 1 from cron.job where jobname='cita-suite-deposit-expiry' and schedule='*/5 * * * *'
  and command='select private.expire_unpaid_deposits()')
 and exists(select 1 from cron.job where jobname='cita-suite-cron-history-retention' and schedule='37 5 * * *'),
 'pg_cron corre la baja automática cada 5 minutos y poda su historial');

select * from extensions.finish();
rollback;
