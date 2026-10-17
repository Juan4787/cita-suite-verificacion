-- Actual policy edits between quote/confirmation, and replay after another edit.
-- All data and outcomes are synthetic and rolled back; no provider calls.
begin;
select extensions.plan(14);
create temporary table price_lifecycle_fixture(business uuid,service uuid,professional uuid,owner_id uuid,
  policy jsonb,slot timestamptz,original_quote jsonb,current_quote jsonb,payload jsonb,saved_snapshot jsonb);
create temporary table price_lifecycle_receipts(appointment uuid,patient uuid,replay boolean);
grant select on price_lifecycle_fixture to service_role;
grant select,insert on price_lifecycle_receipts to service_role;
do $$
declare b uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
  policy jsonb; original_quote jsonb; current_quote jsonb; schema jsonb; slot timestamptz; payload jsonb;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.test');
  insert into public.businesses(id,name,slug,industry,timezone,min_booking_notice_minutes,max_booking_days_ahead)
    values(b,'Synthetic quote lifecycle',b::text,'other','America/Argentina/Buenos_Aires',0,90);
  insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,actor,'owner','active',now());
  update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
    paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
  insert into public.services(id,business_id,name,duration_minutes) values(s,b,'Synthetic priced consultation',30);
  insert into public.professionals(id,business_id,name) values(p,b,'Synthetic price professional');
  insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s);
  insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
    select b,p,weekday,'09:00','19:00',30,0 from generate_series(0,6) weekday;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  policy:=jsonb_build_object('base_amount',10000,'currency','ARS','base_month',date_trunc('month',now())::date,
    'first_adjustment_month',(date_trunc('month',now())+interval '1 month')::date,'monthly_percentage',0,'rounding_unit',1,'adjustments','[]'::jsonb);
  perform public.save_service_price_policy(b,s,p,0,policy);
  slot:=(((now() at time zone 'America/Argentina/Buenos_Aires')::date+5)::timestamp+interval '12 hours') at time zone 'America/Argentina/Buenos_Aires';
  original_quote:=public.get_public_service_price_quote(b,s,array[p],(slot at time zone 'America/Argentina/Buenos_Aires')::date);
  schema:=public.get_public_patient_booking_schema(b,array[p]);
  payload:=jsonb_build_object('business_id',b,'professional_ids',array[p],'service_id',s,'starts_at',slot,'request_key',gen_random_uuid(),
    'patient_name','Synthetic Price Patient','patient_phone_raw','3425048299','patient_phone_e164','+5493425048299','phone_status','valid',
    'schema_hash',schema->>'hash','answers','{}'::jsonb,'price_quote_hash',original_quote->>'hash');
  -- A real edit after displaying 10,000, rather than a fabricated invalid hash.
  perform public.save_service_price_policy(b,s,p,1,policy||'{"base_amount":12000}');
  current_quote:=public.get_public_service_price_quote(b,s,array[p],(slot at time zone 'America/Argentina/Buenos_Aires')::date);
  insert into price_lifecycle_fixture values(b,s,p,actor,policy,slot,original_quote,current_quote,payload,null);
end $$;
select extensions.is((select original_quote->>'amount' from price_lifecycle_fixture),'10000','original displayed fee is 10,000');
select extensions.is((select current_quote->>'amount' from price_lifecycle_fixture),'12000','actual policy edit changes the authoritative quote');
select extensions.ok((select original_quote->>'hash' <> current_quote->>'hash' from price_lifecycle_fixture),'policy edit changes the binding quote hash');
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select extensions.throws_ok($q$select * from price_lifecycle_fixture f cross join lateral public.create_public_booking_with_information(f.payload)$q$,
  'P0001','PRICE_QUOTE_CHANGED','the previously valid quote is rejected after the edit');
reset role;
select extensions.is((select count(*) from public.appointments where business_id=(select business from price_lifecycle_fixture)),0::bigint,'stale quote leaves no booking');
select extensions.is((select count(*) from public.patients where business_id=(select business from price_lifecycle_fixture)),0::bigint,'stale quote leaves no patient');
select extensions.is((select count(*) from public.appointment_intake_submissions where business_id=(select business from price_lifecycle_fixture)),0::bigint,'stale quote leaves no questionnaire submission');
update price_lifecycle_fixture set payload=payload||jsonb_build_object('price_quote_hash',current_quote->>'hash');
set local role service_role;
select extensions.lives_ok($q$insert into price_lifecycle_receipts select result.id,result.patient_id,result.idempotent_replay
  from price_lifecycle_fixture f cross join lateral public.create_public_booking_with_information(f.payload) result$q$,
  'explicitly accepting the fresh quote creates the booking');
reset role;
select extensions.is((select count(*) from price_lifecycle_receipts where not replay),1::bigint,'confirmation creates exactly one receipt');
select extensions.is((select a.price_quote_snapshot->>'amount' from public.appointments a join price_lifecycle_receipts r on r.appointment=a.id),'12000','booking stores the newly accepted fee');
update price_lifecycle_fixture set saved_snapshot=(select a.price_quote_snapshot from public.appointments a join price_lifecycle_receipts r on r.appointment=a.id);
do $$
declare f price_lifecycle_fixture%rowtype;
begin
  select * into f from price_lifecycle_fixture;
  perform set_config('request.jwt.claim.sub',f.owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform public.save_service_price_policy(f.business,f.service,f.professional,2,f.policy||'{"base_amount":14000}');
end $$;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select extensions.lives_ok($q$insert into price_lifecycle_receipts select result.id,result.patient_id,result.idempotent_replay
  from price_lifecycle_fixture f cross join lateral public.create_public_booking_with_information(f.payload) result$q$,
  'a lost-response retry returns the committed booking despite a newer policy');
reset role;
select extensions.is((select count(*) from price_lifecycle_receipts where replay),1::bigint,'retry is explicitly marked as an idempotent replay');
select extensions.is((select count(distinct appointment) from price_lifecycle_receipts),1::bigint,'retry returns the same booking identity');
select extensions.ok((select a.price_quote_snapshot=f.saved_snapshot from public.appointments a join price_lifecycle_receipts r on r.appointment=a.id
  cross join price_lifecycle_fixture f limit 1),'all historical price fields remain byte-equivalent after policy edit and replay');
select * from extensions.finish();
rollback;
