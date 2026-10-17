begin;
select extensions.plan(30);
create temporary table window_fixture(business uuid,other_business uuid,actor uuid,doctor uuid,service uuid,
  private_service uuid,professionals uuid[],private_professional uuid,revision bigint);
do $$
declare b uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); doctor uuid:=gen_random_uuid();
  service uuid:=gen_random_uuid(); private_service uuid:=gen_random_uuid(); private_professional uuid:=gen_random_uuid();
  patient uuid:=gen_random_uuid(); ids uuid[]; p uuid; counter integer;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  insert into auth.users(id,email) values(actor,actor||'@example.test'),(doctor,doctor||'@example.test');
  insert into public.businesses(id,name,slug,industry,timezone)
    values(b,'Synthetic window contract',b::text,'other','UTC'),(other,'Other synthetic window',other::text,'other','UTC');
  update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
    paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
  insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,actor,'owner','active',now());
  insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,doctor,'professional','active',now());
  insert into public.patients(id,business_id,owner_id,full_name) values(patient,b,actor,'Synthetic window patient');
  insert into public.services(id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,is_public)
    values(service,b,'Public synthetic service',30,15,10,true),(private_service,b,'Private synthetic service',30,0,0,false);
  for counter in 1..17 loop
    p:=gen_random_uuid(); ids:=array_append(ids,p);
    insert into public.professionals(id,business_id,name,is_public) values(p,b,'Synthetic professional '||counter,true);
    insert into public.professional_services(business_id,professional_id,service_id) values(b,p,service);
    insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
      select b,p,weekday,'09:00','19:00',30,15 from generate_series(0,6) weekday;
  end loop;
  update public.professionals set email=doctor||'@example.test' where id=ids[1];
  insert into public.professional_users(business_id,professional_id,user_id) values(b,ids[1],doctor);
  insert into public.professionals(id,business_id,name,is_public) values(private_professional,b,'Private synthetic professional',false);
  insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes,service_scope)
    values(b,private_professional,1,'09:00','19:00',30,15,'restricted');
  insert into window_fixture values(b,other,actor,doctor,service,private_service,ids,private_professional,
    (select revision from private.availability_configuration_versions where business_id=b));
  -- 1,001 actual, non-overlapping appointments across 16 professionals and
  -- eleven dates. All ordinary triggers, FK and exclusion constraints remain.
  insert into public.appointments(business_id,patient_id,professional_id,service_id,starts_at,ends_at,status,source,
    service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot,patient_name_at_booking)
    select b,patient,ids[(n%16)+1],service,
      '2099-01-15 09:15+00'::timestamptz+make_interval(days=>n/96,mins=>(n/16%6)*90),
      '2099-01-15 09:45+00'::timestamptz+make_interval(days=>n/96,mins=>(n/16%6)*90),
      'reserved','manual','Synthetic service','Synthetic professional',30,'Synthetic window patient'
    from generate_series(0,1000)n;
  insert into public.availability_exceptions(business_id,professional_id,starts_at,ends_at,type)
    values(b,null,'2099-01-29 00:00+00','2099-01-29 01:00+00','blocked'),
      (b,ids[17],'2099-01-28 00:00+00','2099-01-29 00:00+00','restricted');
end $$;
create temporary table window_catalogs as select
  public.get_availability_catalog(business,true) as public_catalog,
  public.get_availability_catalog(business,false) as internal_catalog from window_fixture;
create temporary table window_response as select public.get_availability_window(business,true,service,
  professionals[1:16],'2099-01-15','2099-01-29',revision) as body from window_fixture;

select extensions.is((select jsonb_array_length(public_catalog->'professionals') from window_catalogs),17,'catalog is not capped at sixteen professionals');
select extensions.is((select jsonb_array_length(internal_catalog->'professionals') from window_catalogs),18,'internal catalog preserves private active professionals');
select extensions.is((select jsonb_array_length(public_catalog->'services') from window_catalogs),1,'public catalog excludes private services');
select extensions.is((select jsonb_array_length(internal_catalog->'services') from window_catalogs),2,'internal catalog preserves private services');
select extensions.is((select revision from private.availability_configuration_versions where business_id=(select business from window_fixture)),(select revision from window_fixture),'occupancy and dated exceptions do not invalidate the configuration');
select extensions.is((select jsonb_array_length(body->'blocks') from window_response),1001,'window returns all 1001 rows beyond PostgREST table-page defaults');
select extensions.is((select (body->'counts'->>'blocks')::integer from window_response),1001,'window explicitly declares its complete block count');
select extensions.is((select (body->>'complete')::boolean from window_response),true,'complete response is explicit');
select extensions.is((select jsonb_array_length(body->'exceptions') from window_response),1,'group includes global exception but excludes another professional exception');
select extensions.ok((select (body->'blocks'->0) ?& array['starts_at','ends_at','base_blocking_starts_at','base_blocking_ends_at','blocking_starts_at','blocking_ends_at'] from window_response),'window preserves all base and expanded intervals');
select extensions.ok((select (body->'blocks'->0->>'blocking_ends_at')::timestamptz>(body->'blocks'->0->>'base_blocking_ends_at')::timestamptz from window_response),'break remains distinct from service base and buffers');
select extensions.ok((select exists(select 1 from jsonb_array_elements(internal_catalog->'rules') r where r->>'service_scope'='restricted' and r->'allowed_service_ids'='[]'::jsonb) from window_catalogs),'restricted rule with no allowed services remains explicitly restricted');
select extensions.is((select jsonb_array_length(public.get_availability_window(business,true,service,array[professionals[17]],'2099-01-15','2099-01-29',revision)->'exceptions') from window_fixture),2,'another group remains independently readable including its scoped exception');
select extensions.throws_ok($q$select public.get_availability_window(business,true,service,professionals,'2099-01-15','2099-01-29',revision) from window_fixture$q$,'P0001','AVAILABILITY_WINDOW_INVALID','seventeen in one query is rejected without limiting catalog/team');
select extensions.throws_ok($q$select public.get_availability_window(business,true,service,professionals[1:16],'2099-01-15','2099-01-30',revision) from window_fixture$q$,'P0001','AVAILABILITY_WINDOW_INVALID','sixteen natural dates exceed the fixed window');
select extensions.throws_ok($q$select public.get_availability_window(business,true,service,array[professionals[1],professionals[1]],'2099-01-15','2099-01-29',revision) from window_fixture$q$,'P0001','AVAILABILITY_WINDOW_INVALID','duplicate identifiers cannot inflate the requested group');
select extensions.throws_ok($q$select public.get_availability_window(business,true,service,array[gen_random_uuid()],'2099-01-15','2099-01-29',revision) from window_fixture$q$,'P0001','AVAILABILITY_SCOPE_INVALID','manipulated professional identifier fails explicitly');
select extensions.throws_ok($q$select public.get_availability_window(business,true,service,array[private_professional],'2099-01-15','2099-01-29',revision) from window_fixture$q$,'P0001','AVAILABILITY_SCOPE_INVALID','private professional cannot enter public window');
select extensions.throws_ok($q$select public.get_availability_window(business,true,private_service,professionals[1:16],'2099-01-15','2099-01-29',revision) from window_fixture$q$,'P0001','AVAILABILITY_SCOPE_INVALID','private service cannot enter public window');
update public.businesses set timezone='America/New_York' where id=(select business from window_fixture);
select extensions.throws_ok($q$select public.get_availability_window(business,true,service,professionals[1:16],'2099-01-15','2099-01-29',revision) from window_fixture$q$,'P0001','AVAILABILITY_CONFIGURATION_CHANGED','changed configuration is never combined silently with an old catalog');
update window_fixture set revision=(select v.revision from private.availability_configuration_versions v where v.business_id=window_fixture.business);
select extensions.lives_ok($q$select public.get_availability_window(business,true,service,professionals[1:16],'2027-11-01','2027-11-15',revision) from window_fixture$q$,'fifteen natural dates spanning fall DST are valid');
select extensions.lives_ok($q$select public.get_availability_window(business,true,service,professionals[1:16],'2027-03-01','2027-03-15',revision) from window_fixture$q$,'fifteen natural dates spanning spring DST are valid');
select extensions.ok(not has_function_privilege('anon','public.get_availability_catalog(uuid,boolean)','execute'),'anonymous clients cannot bypass the public server context');
select extensions.ok(not has_table_privilege('service_role','private.availability_configuration_versions','update'),'backend cannot change configuration revisions directly');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select actor::text from window_fixture),true);
select extensions.lives_ok($q$select public.get_availability_catalog(business,false) from window_fixture$q$,'active member retains the internal read contract');
select extensions.throws_ok($q$select public.get_availability_catalog(other_business,false) from window_fixture$q$,'P0001','AVAILABILITY_ACCESS_DENIED','member cannot read another clinic catalog');
select extensions.throws_ok($q$select public.get_availability_catalog(business,true) from window_fixture$q$,'P0001','AVAILABILITY_ACCESS_DENIED','public scope requires its trusted server even for an internal member');
select set_config('request.jwt.claim.sub',(select doctor::text from window_fixture),true);
grant select on window_fixture to authenticated;
set local role authenticated;
select extensions.is((select jsonb_array_length(public.get_availability_window(business,false,null,professionals[1:2],'2099-01-15','2099-01-29',revision)->'blocks') from window_fixture),63,'professional window preserves the existing RLS scope of their own appointments');
select extensions.is((select jsonb_array_length(public.get_availability_window(business,false,null,array[professionals[2]],'2099-01-15','2099-01-29',revision)->'blocks') from window_fixture),0,'professional does not receive a colleague appointment allocation through the new RPC');
reset role;
select set_config('request.jwt.claim.sub',(select actor::text from window_fixture),true);
update public.business_users set status='disabled' where business_id=(select business from window_fixture);
select extensions.throws_ok($q$select public.get_availability_catalog(business,false) from window_fixture$q$,'P0001','AVAILABILITY_ACCESS_DENIED','revocation takes effect on the next SQL call');
select * from extensions.finish();
rollback;
