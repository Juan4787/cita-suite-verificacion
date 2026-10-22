-- Removing a user never removes clinical history. The legacy owner reference of a clinical entry
-- becomes empty, as it already does for patients and documents; authorship columns keep refusing
-- the removal of a user who wrote history. Real SQL.
begin;
select extensions.plan(3);
create temporary table owner_deletion_fixture(owner uuid,author uuid,business uuid,patient uuid,entry uuid);
do $fixture$
declare o uuid:=gen_random_uuid();w uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(o,o||'@example.test'),(w,w||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(b,'Synthetic owner deletion',b::text,'other');
 insert into public.patients(id,business_id,owner_id,full_name) values(p,b,o,'Paciente Historia Sintética');
 insert into public.clinical_entries(id,business_id,patient_id,owner_id,created_by_user_id,entry_type,description)
  values(e,b,p,o,w,'Consulta','Historia que sobrevive al usuario');
 insert into owner_deletion_fixture values(o,w,b,p,e);
end $fixture$;
delete from auth.users where id=(select owner from owner_deletion_fixture);
select extensions.is((select count(*) from public.clinical_entries where id=(select entry from owner_deletion_fixture)),1::bigint,
  'the clinical entry of a removed owner remains');
select extensions.is((select owner_id from public.clinical_entries where id=(select entry from owner_deletion_fixture)),null::uuid,
  'its owner reference becomes empty');
select extensions.throws_ok($t$delete from auth.users where id=(select author from owner_deletion_fixture)$t$,'23503',null,
  'the author of clinical history cannot be removed');
select * from extensions.finish();
rollback;
