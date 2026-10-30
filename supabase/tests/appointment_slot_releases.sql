-- Stage C: owned synthetic rows, rollback at the end. Each assertion uses IS DISTINCT
-- FROM, and writes and their readback are separate statements (no NULL or snapshot pass).
begin;
select extensions.plan(15);
create temporary table slot_fixture(label text primary key,id uuid not null);
grant select on slot_fixture to authenticated;
do $$
declare b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
 ro uuid:=gen_random_uuid(); pro uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 p2 uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) select u,'slot-'||u||'@example.test' from unnest(array[o,r,ro,pro,outsider]) u;
 insert into public.businesses(id,name,slug,industry,timezone) values
 (b,'Horarios liberados',b::text,'other','America/Argentina/Cordoba'),(b2,'Ajeno',b2::text,'other','UTC');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in (b,b2);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
 (b,o,'owner','active',now()),(b,r,'reception','active',now()),(b,ro,'readonly','active',now()),
 (b,pro,'professional','active',now()),(b2,outsider,'owner','active',now());
 insert into public.professionals(id,business_id,name) values(p,b,'Primera profesional'),(p2,b,'Segunda profesional');
 insert into public.professional_users(business_id,user_id,professional_id) values(b,pro,p);
 insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Consulta',60);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s),(b,p2,s);
 insert into slot_fixture values('business',b),('business2',b2),('owner',o),('reception',r),('readonly',ro),
 ('pro',pro),('outsider',outsider),('professional',p),('professional2',p2),('service',s);
end $$;
create function pg_temp.sid(label text) returns uuid language sql as $$select id from slot_fixture where slot_fixture.label=$1$$;
create function pg_temp.actor(label text,statement text) returns text language plpgsql as $$
declare answer text;
begin
 perform set_config('request.jwt.claim.sub',coalesce(pg_temp.sid(label)::text,''),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  execute 'set local role authenticated'; execute statement into answer; execute 'reset role';
 exception when others then execute 'reset role'; return 'ERROR '||sqlerrm; end;
 return coalesce(answer,'');
end $$;
create function pg_temp.slot_appt(label text,start_at timestamptz,age interval default interval '1 hour',joint boolean default false,
 professional_label text default 'professional')
returns uuid language plpgsql as $$
declare patient uuid; a uuid;
begin
 perform set_config('request.jwt.claim.sub','',true);
 insert into public.patients(owner_id,business_id,full_name) values(pg_temp.sid('owner'),pg_temp.sid('business'),'Paciente '||label) returning id into patient;
 insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
 status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot,created_at)
 values(pg_temp.sid('business'),patient,pg_temp.sid('service'),pg_temp.sid(professional_label),start_at,start_at+interval '1 hour',
 start_at,start_at+interval '1 hour','reserved','manual','Consulta','Primera profesional',60,statement_timestamp()-age) returning id into a;
 if joint then insert into public.appointment_professionals(business_id,appointment_id,professional_id,position,is_primary)
 values(pg_temp.sid('business'),a,pg_temp.sid('professional2'),1,false); end if;
 insert into slot_fixture values(label,a); return a;
end $$;
create function pg_temp.visible(label text,days integer default 14) returns bigint language plpgsql as $$
declare answer text;
begin
 answer:=pg_temp.actor('reception',format('select count(*) from public.get_appointment_slot_releases(%L,%s,51,0) where appointment_id=%L',
 pg_temp.sid('business'),days,pg_temp.sid(label)));
 if answer like 'ERROR %' then raise exception '%',answer; end if;
 return answer::bigint;
end $$;

-- 1. A cancellation is a ledger entry in the same transaction; no policy is required.
select pg_temp.slot_appt('cancel',date_trunc('day',now())+interval '3 days 9 hours');
update public.appointments set status='cancelled',cancelled_by_user_id=pg_temp.sid('reception'),cancelled_at=now() where id=pg_temp.sid('cancel');
do $$begin
 if (select count(*) from public.appointment_slot_releases where appointment_id=pg_temp.sid('cancel')) is distinct from 1::bigint
 or (select reason from public.appointment_slot_releases where appointment_id=pg_temp.sid('cancel')) is distinct from 'practice_cancelled'
 or pg_temp.visible('cancel') is distinct from 1::bigint then raise exception 'SLOT_CANCEL_RECORD'; end if;
end $$;
select extensions.ok(true,'cancelar un turno futuro registra el horario y no depende de la política de seña');

-- 2. An update that leaves status/time unchanged never invents another release.
update public.appointments set status='cancelled',updated_at=now() where id=pg_temp.sid('cancel');
do $$begin if (select count(*) from public.appointment_slot_releases where appointment_id=pg_temp.sid('cancel')) is distinct from 1::bigint
then raise exception 'SLOT_DUPLICATE'; end if; end $$;
select extensions.ok(true,'repetir el estado no duplica el registro');

-- 3. A joint move must retain OLD time for both professionals even though their allocation
-- rows have already been synchronized by the time we read them after the update.
select pg_temp.slot_appt('joint',date_trunc('day',now())+interval '4 days 9 hours',interval '1 hour',true);
update public.appointments set starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours' where id=pg_temp.sid('joint');
do $$begin
 if (select count(*) from public.appointment_slot_releases where appointment_id=pg_temp.sid('joint') and reason='rescheduled'
 and starts_at=date_trunc('day',now())+interval '4 days 9 hours' and ends_at=date_trunc('day',now())+interval '4 days 10 hours') is distinct from 2::bigint
 or (select count(distinct professional_id) from public.appointment_slot_releases where appointment_id=pg_temp.sid('joint')) is distinct from 2::bigint
 or pg_temp.visible('joint') is distinct from 2::bigint then raise exception 'SLOT_OLD_JOINT'; end if;
end $$;
select extensions.ok(true,'reprogramar un equipo registra el horario anterior de las dos profesionales');

-- 4. Quick corrections stay in the ledger but do not appear in the alert.
select pg_temp.slot_appt('quick',date_trunc('day',now())+interval '5 days 9 hours',interval '1 minute');
update public.appointments set status='cancelled',cancelled_at=now() where id=pg_temp.sid('quick');
do $$begin if (select count(*) from public.appointment_slot_releases where appointment_id=pg_temp.sid('quick')) is distinct from 1::bigint
 or pg_temp.visible('quick') is distinct from 0::bigint then raise exception 'SLOT_QUICK'; end if; end $$;
select extensions.ok(true,'la corrección rápida queda registrada pero no alerta');

-- 5. The age belongs to the exact interval, not to the old appointment. Returning a moved
-- old appointment immediately must suppress the intermediate slot (and the occupied original).
select pg_temp.slot_appt('return',date_trunc('day',now())+interval '6 days 9 hours',interval '20 days');
update public.appointments set starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours' where id=pg_temp.sid('return');
update public.appointments set starts_at=starts_at-interval '2 hours',ends_at=ends_at-interval '2 hours' where id=pg_temp.sid('return');
do $$begin if (select count(*) from public.appointment_slot_releases where appointment_id=pg_temp.sid('return')) is distinct from 2::bigint
 or pg_temp.visible('return') is distinct from 0::bigint then raise exception 'SLOT_OLD_QUICK_RETURN'; end if; end $$;
select extensions.ok(true,'un turno viejo movido y devuelto al minuto no anuncia el horario intermedio');

-- 6. Partial occupation and a block both remove the whole interval, and freeing them makes
-- it available again. We do not advertise the remaining fragment as a whole free hour.
select pg_temp.slot_appt('occupier',date_trunc('day',now())+interval '3 days 9 hours 30 minutes');
do $$begin if pg_temp.visible('cancel') is distinct from 0::bigint then raise exception 'SLOT_PARTIAL_OCCUPIED'; end if; end $$;
update public.appointments set status='cancelled',cancelled_at=now() where id=pg_temp.sid('occupier');
insert into public.availability_exceptions(business_id,professional_id,starts_at,ends_at,type)
values(pg_temp.sid('business'),null,date_trunc('day',now())+interval '3 days 9 hours',date_trunc('day',now())+interval '3 days 10 hours','blocked');
do $$begin if pg_temp.visible('cancel') is distinct from 0::bigint then raise exception 'SLOT_BLOCKED'; end if; end $$;
delete from public.availability_exceptions where business_id=pg_temp.sid('business');
do $$begin if pg_temp.visible('cancel') is distinct from 1::bigint then raise exception 'SLOT_FREE_AGAIN'; end if; end $$;
select extensions.ok(true,'ocupación parcial y bloqueo general ocultan el intervalo; al liberarlo vuelve');

-- 7. Default 14 days, bounded configurable view, and no alerts for started intervals.
select pg_temp.slot_appt('far',date_trunc('day',now())+interval '20 days 9 hours');
update public.appointments set status='cancelled',cancelled_at=now() where id=pg_temp.sid('far');
select pg_temp.slot_appt('past',date_trunc('day',now())-interval '2 days');
update public.appointments set status='cancelled',cancelled_at=now() where id=pg_temp.sid('past');
do $$begin if pg_temp.visible('far') is distinct from 0::bigint or pg_temp.visible('far',30) is distinct from 1::bigint
 or pg_temp.visible('past') is distinct from 0::bigint then raise exception 'SLOT_WINDOW'; end if;
 if pg_temp.actor('reception',format('select count(*) from public.get_appointment_slot_releases(%L,61,51,0)',pg_temp.sid('business')))
 not like 'ERROR %SLOT_RELEASE_WINDOW_INVALID%' then raise exception 'SLOT_UNBOUNDED'; end if;
end $$;
select extensions.ok(true,'ventana por defecto de 14 días, configurable y acotada, sin horarios pasados');

-- 8. A past→future move must also reset interval age, although the old past slot never alerts.
select pg_temp.slot_appt('revived',date_trunc('day',now())-interval '3 days',interval '20 days');
update public.appointments set starts_at=date_trunc('day',now())+interval '8 days 9 hours',ends_at=date_trunc('day',now())+interval '8 days 10 hours' where id=pg_temp.sid('revived');
update public.appointments set status='cancelled',cancelled_at=now() where id=pg_temp.sid('revived');
do $$begin if pg_temp.visible('revived') is distinct from 0::bigint then raise exception 'SLOT_PAST_TO_FUTURE_AGE'; end if; end $$;
select extensions.ok(true,'mover un turno pasado al futuro tampoco hace antigua su ocupación nueva');

-- 9. Hiding is authorized, idempotent and audited once; it does not change availability.
do $$declare release uuid; result text; begin
 select id into release from public.appointment_slot_releases where appointment_id=pg_temp.sid('cancel');
 foreach result in array array['readonly','pro','outsider'] loop
  if pg_temp.actor(result,format('select public.hide_appointment_slot_release(%L,%L)',pg_temp.sid('business'),release))
   not like 'ERROR %SLOT_RELEASE_FORBIDDEN%' then raise exception 'SLOT_HIDE_ROLE %',result; end if;
 end loop;
 result:=pg_temp.actor('reception',format('select public.hide_appointment_slot_release(%L,%L)',pg_temp.sid('business'),release));
 if result like 'ERROR %' then raise exception 'SLOT_HIDE %',result; end if;
 result:=pg_temp.actor('reception',format('select public.hide_appointment_slot_release(%L,%L)',pg_temp.sid('business'),release));
 if result like 'ERROR %' or pg_temp.visible('cancel') is distinct from 0::bigint
 or (select count(*) from public.audit_logs where action='appointment.slot_release_hidden' and metadata->>'release_id'=release::text) is distinct from 1::bigint
 then raise exception 'SLOT_HIDE_IDEMPOTENT'; end if;
end $$;
select extensions.ok(true,'recepción oculta con auditoría única; profesional, sólo lectura y ajenos no escriben');

-- 10. Direct writes and anonymous execution stay forbidden. The database owns creation.
do $$begin
 if has_table_privilege('authenticated','public.appointment_slot_releases','insert,update,delete')
 or has_table_privilege('service_role','public.appointment_slot_releases','insert,update,delete')
 or has_function_privilege('anon','public.get_appointment_slot_releases(uuid,integer,integer,integer)','execute')
 or has_function_privilege('anon','public.hide_appointment_slot_release(uuid,uuid)','execute')
 then raise exception 'SLOT_PRIVILEGES'; end if;
 if pg_temp.actor('outsider',format('select count(*) from public.appointment_slot_releases where business_id=%L',pg_temp.sid('business'))) is distinct from '0'
 then raise exception 'SLOT_OTHER_BUSINESS_READ'; end if;
end $$;
select extensions.ok(true,'RLS y permisos explícitos impiden lecturas ajenas, escrituras directas y ejecución anónima');

-- 11. The actual deposit job creates a release with the right reason; the deposit is already
-- expired before its appointment changes, so no message matching or request setting is needed.
update private.deposit_automation set enabled=true where singleton;
insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,fixed_amount) values(pg_temp.sid('business'),true,true,40000);
select pg_temp.slot_appt('expiry',date_trunc('day',now())+interval '10 days 9 hours');
update public.appointment_deposits set due_at=now()-interval '5 minutes',request_from=now()-interval '1 day',auto_cancel=true where appointment_id=pg_temp.sid('expiry');
select set_config('request.jwt.claim.sub','',true);
select private.expire_unpaid_deposits(now(),100);
do $$begin if (select reason from public.appointment_slot_releases where appointment_id=pg_temp.sid('expiry')) is distinct from 'deposit_expired'
 or pg_temp.visible('expiry') is distinct from 1::bigint then raise exception 'SLOT_EXPIRY_REASON'; end if; end $$;
select extensions.ok(true,'la tarea real de señas registra el motivo de liberación en su misma transacción');

-- 12. A failure while recording the release rolls back the cancellation, not just its alert.
create function pg_temp.fail_slot_release() returns trigger language plpgsql as $$begin raise exception 'SLOT_TEST_PROVOKED'; end$$;
create trigger zz_slot_test_failure before insert on public.appointment_slot_releases for each row execute function pg_temp.fail_slot_release();
select pg_temp.slot_appt('rollback',date_trunc('day',now())+interval '11 days 9 hours');
do $$begin
 begin update public.appointments set status='cancelled',cancelled_at=now() where id=pg_temp.sid('rollback');
  raise exception 'SLOT_TEST_DID_NOT_FAIL';
 exception when others then if sqlerrm is distinct from 'SLOT_TEST_PROVOKED' then raise; end if; end;
 if (select status from public.appointments where id=pg_temp.sid('rollback')) is distinct from 'reserved'
 or exists(select 1 from public.appointment_slot_releases where appointment_id=pg_temp.sid('rollback')) then raise exception 'SLOT_PARTIAL_WRITE'; end if;
end $$;
select extensions.ok(true,'una falla del registro revierte también la cancelación');
drop trigger zz_slot_test_failure on public.appointment_slot_releases;

-- 14 (before 13 so each independently reproduced defect can reach its assertion).
-- Statement start is earlier than the effective move (and can precede a lock wait).
-- Occupation of the new interval begins when the change actually runs.
select pg_temp.slot_appt('clock',date_trunc('day',now())+interval '13 days 9 hours');
do $$declare before_update timestamptz:=clock_timestamp(); actual timestamptz; begin
 update public.appointments set starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours' where id=pg_temp.sid('clock');
 select released_at into actual from public.appointment_slot_releases where appointment_id=pg_temp.sid('clock');
 if (actual>=before_update and actual<=clock_timestamp()) is not true then raise exception 'SLOT_EFFECTIVE_MOVE_TIME'; end if;
end $$;
select extensions.ok(true,'la ocupación nueva comienza al mover efectivamente, no al empezar una sentencia que pudo esperar');

-- 13. A timestamp is not a total event order: two releases in one statement can have the
-- same timestamp and UUIDs sort randomly. A newer quick correction must suppress the older
-- qualifying duplicate, rather than resurrect its alert. Explicit inverted UUIDs make this
-- probe deterministic instead of hoping for a random ordering.
insert into public.appointment_slot_releases(business_id,id,event_id,appointment_id,professional_id,service_id,professional_name,
 starts_at,ends_at,occupied_since,released_at,reason)
values(pg_temp.sid('business'),'ffffffff-ffff-4fff-8fff-fffffffffff1',gen_random_uuid(),pg_temp.sid('cancel'),pg_temp.sid('professional'),pg_temp.sid('service'),'Primera profesional',
 date_trunc('day',now())+interval '12 days 9 hours',date_trunc('day',now())+interval '12 days 10 hours',now()-interval '1 hour',now(),'patient_cancelled');
insert into public.appointment_slot_releases(business_id,id,event_id,appointment_id,professional_id,service_id,professional_name,
 starts_at,ends_at,occupied_since,released_at,reason)
values(pg_temp.sid('business'),'00000000-0000-4000-8000-000000000001',gen_random_uuid(),pg_temp.sid('cancel'),pg_temp.sid('professional'),pg_temp.sid('service'),'Primera profesional',
 date_trunc('day',now())+interval '12 days 9 hours',date_trunc('day',now())+interval '12 days 10 hours',now(),now(),'patient_cancelled');
do $$begin if pg_temp.visible('cancel') is distinct from 0::bigint then raise exception 'SLOT_SAME_TIMESTAMP_ORDER'; end if; end $$;
select extensions.ok(true,'el orden de registro desambigua horas iguales y no revive un aviso viejo');

-- 15. Professional/read-only visibility and commercial revocation. Deliberately broaden
-- the policy and require the same actor/read to observe the leak, then restore it and
-- require isolation again: the negative check is not passing because its fixture is absent.
select pg_temp.slot_appt('other_professional',date_trunc('day',now())+interval '9 days 15 hours',interval '1 hour',false,'professional2');
update public.appointments set status='cancelled',cancelled_at=now(),cancelled_by_user_id=null where id=pg_temp.sid('other_professional');
do $$declare read_other text; release uuid; begin
 if (select reason from public.appointment_slot_releases where appointment_id=pg_temp.sid('other_professional')) is distinct from 'patient_cancelled'
 then raise exception 'SLOT_PATIENT_REASON'; end if;
 read_other:=format('select count(*) from public.appointment_slot_releases where appointment_id=%L',pg_temp.sid('other_professional'));
 if pg_temp.actor('pro',read_other) is distinct from '0'
 or pg_temp.actor('readonly',read_other) is distinct from '1'
 or pg_temp.actor('pro',format('select count(*) from public.appointment_slot_releases where appointment_id=%L',pg_temp.sid('joint'))) is distinct from '2'
 then raise exception 'SLOT_READ_SET'; end if;
 execute format('create policy slot_release_read_probe on public.appointment_slot_releases for select to authenticated using (business_id=%L::uuid)',pg_temp.sid('business'));
 if pg_temp.actor('pro',read_other) is distinct from '1' then raise exception 'SLOT_READ_ORACLE_MISSED_LEAK'; end if;
 execute 'drop policy slot_release_read_probe on public.appointment_slot_releases';
 if pg_temp.actor('pro',read_other) is distinct from '0' then raise exception 'SLOT_READ_POLICY_NOT_RESTORED'; end if;
 update public.business_subscriptions set commercial_access_enabled=false where business_id=pg_temp.sid('business');
 if pg_temp.actor('readonly',read_other) is distinct from '0' then raise exception 'SLOT_RESTRICTED_READ'; end if;
 select id into release from public.appointment_slot_releases where appointment_id=pg_temp.sid('other_professional');
 if pg_temp.actor('reception',format('select public.hide_appointment_slot_release(%L,%L)',pg_temp.sid('business'),release))
 not like 'ERROR %SLOT_RELEASE_FORBIDDEN%' then raise exception 'SLOT_RESTRICTED_HIDE'; end if;
 update public.business_subscriptions set commercial_access_enabled=true where business_id=pg_temp.sid('business');
end $$;
select extensions.ok(true,'profesional ve sólo sus turnos, sólo lectura ve el consultorio y la restricción comercial retira lectura y escritura');
select * from extensions.finish();
rollback;
