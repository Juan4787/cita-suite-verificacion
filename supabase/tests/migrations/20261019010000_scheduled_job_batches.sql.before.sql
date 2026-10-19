-- Committed synthetic pre-upgrade state: a reminder the previous scheduler claimed
-- moments before the migration. Runs only in the owned disposable DB.
begin;
insert into auth.users(id,email) values('6b000000-0000-4000-8000-000000000001','scheduled-upgrade@example.test');
insert into public.businesses(id,name,slug,industry,timezone)
  values('6b000000-0000-4000-8000-000000000002','Synthetic scheduled upgrade','synthetic-scheduled-upgrade','odontology','America/Argentina/Buenos_Aires');
insert into public.services(id,business_id,name,duration_minutes)
  values('6b000000-0000-4000-8000-000000000003','6b000000-0000-4000-8000-000000000002','Consulta',30);
insert into public.professionals(id,business_id,name)
  values('6b000000-0000-4000-8000-000000000004','6b000000-0000-4000-8000-000000000002','Synthetic upgrade professional');
insert into public.professional_services(business_id,professional_id,service_id)
  values('6b000000-0000-4000-8000-000000000002','6b000000-0000-4000-8000-000000000004','6b000000-0000-4000-8000-000000000003');
insert into public.patients(id,owner_id,business_id,full_name)
  values('6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000001','6b000000-0000-4000-8000-000000000002','Synthetic upgrade patient');
insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
  values('6b000000-0000-4000-8000-000000000006','6b000000-0000-4000-8000-000000000002','6b000000-0000-4000-8000-000000000005',
    '6b000000-0000-4000-8000-000000000003','6b000000-0000-4000-8000-000000000004',
    now()+interval '10 hours',now()+interval '10 hours 30 minutes',now()+interval '10 hours',now()+interval '10 hours 30 minutes',
    'reserved','manual','Consulta','Synthetic upgrade professional',30);
select subscription_id from public.save_appointment_push_subscription('6b000000-0000-4000-8000-000000000002','6b000000-0000-4000-8000-000000000006',
  'https://push.example/scheduled-upgrade','key-upgrade','auth-upgrade','Android test',now());
-- The previous scheduler claimed the 24 h reminder just before the upgrade.
update public.push_subscriptions set push_24h_claimed_at=now(),failed_count=2
  where appointment_id='6b000000-0000-4000-8000-000000000006';
commit;
