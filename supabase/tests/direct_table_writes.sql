-- Direct writes through the Data API to tables whose changes belong to transactional RPCs: the
-- RPCs keep the rules (last owner, role assignment, visible patient history, booking contracts)
-- and the direct path would skip them. The writes the application makes with the user client stay
-- available. Real SQL, simulated Auth.
begin;
select extensions.no_plan();
create temporary table direct_writes_fixture(owner uuid,admin uuid,reception uuid,business uuid,professional uuid,patient uuid,service uuid,exception uuid);
grant select on direct_writes_fixture to authenticated;
do $fixture$
declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();r uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();
 pt uuid:=gen_random_uuid();s uuid:=gen_random_uuid();e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(o,o||'@example.test'),(a,a||'@example.test'),(r,r||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(b,'Synthetic direct writes',b::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,o,'owner','active',now()),(b,a,'admin','active',now()),(b,r,'reception','active',now());
 insert into public.professionals(id,business_id,name) values(p,b,'Synthetic direct professional');
 insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Consulta sintética',30);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s);
 insert into public.patients(id,business_id,owner_id,full_name) values(pt,b,o,'Paciente Directo Sintético');
 insert into public.availability_exceptions(id,business_id,professional_id,starts_at,ends_at,type) values(e,b,p,'2099-01-29 00:00+00','2099-01-29 01:00+00','blocked');
 insert into direct_writes_fixture values(o,a,r,b,p,pt,s,e);
end $fixture$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin::text from direct_writes_fixture),true);
select extensions.throws_ok($t$update public.business_users set role='owner' where user_id=(select admin from direct_writes_fixture)$t$,'42501',null,
  'an administrator cannot promote itself to owner directly');
select extensions.throws_ok($t$insert into public.business_users(business_id,user_id,role,status,accepted_at) select business,reception,'owner','active',now() from direct_writes_fixture$t$,'42501',null,
  'an administrator cannot insert a membership directly');
select extensions.throws_ok($t$delete from public.business_users where user_id=(select owner from direct_writes_fixture)$t$,'42501',null,
  'an administrator cannot remove the owner directly');
select extensions.throws_ok($t$delete from public.patients where id=(select patient from direct_writes_fixture)$t$,'42501',null,
  'a patient is never deleted directly');
select extensions.throws_ok($t$update public.patients set full_name='Paciente Cambiado Directo' where id=(select patient from direct_writes_fixture)$t$,'42501',null,
  'a patient changes only through its RPC, which writes the visible history');
select extensions.throws_ok($t$insert into public.patients(business_id,owner_id,full_name) select business,admin,'Paciente Insertado Directo' from direct_writes_fixture$t$,'42501',null,
  'a patient is registered only through its RPC');
select extensions.throws_ok($t$insert into public.professional_users(business_id,professional_id,user_id) select business,professional,reception from direct_writes_fixture$t$,'42501',null,
  'a professional profile is linked to a user only through its RPC');
select extensions.throws_ok($t$delete from public.professional_services where business_id=(select business from direct_writes_fixture)$t$,'42501',null,
  'service assignments change only through their RPC');
select extensions.throws_ok($t$insert into public.appointments(business_id) select business from direct_writes_fixture$t$,'42501',null,
  'an appointment is created only through the booking RPCs');
select extensions.throws_ok($t$insert into public.availability_exceptions(business_id,starts_at,ends_at,type) select business,'2099-02-01 00:00+00','2099-02-01 01:00+00','blocked' from direct_writes_fixture$t$,'42501',null,
  'an exception is created only through its RPC');
select extensions.throws_ok($t$insert into public.professionals(business_id,name) select business,'Profesional Directo' from direct_writes_fixture$t$,'42501',null,
  'a professional is created only through its RPC');
select extensions.throws_ok($t$insert into public.services(business_id,name,duration_minutes) select business,'Servicio Directo',30 from direct_writes_fixture$t$,'42501',null,
  'a service is created only through its RPC');
select extensions.throws_ok($t$insert into public.audit_logs(business_id,action,entity_type) select business,'forged','business' from direct_writes_fixture$t$,'42501',null,
  'the audit trail is written only by the server');
-- The writes the application makes with the user client.
select extensions.lives_ok($t$update public.services set name='Consulta sintética actualizada' where id=(select service from direct_writes_fixture)$t$,
  'a manager still edits a service');
select extensions.lives_ok($t$update public.professionals set name='Profesional sintético actualizado' where id=(select professional from direct_writes_fixture)$t$,
  'a manager still edits a professional');
select extensions.lives_ok($t$delete from public.availability_exceptions where id=(select exception from direct_writes_fixture)$t$,
  'a manager still deletes an exception');
reset role;
select extensions.is((select role from public.business_users where user_id=(select admin from direct_writes_fixture)),'admin','the administrator keeps its role');
select extensions.is((select count(*) from public.patients where id=(select patient from direct_writes_fixture)),1::bigint,'the patient keeps existing');
select * from extensions.finish();
rollback;
