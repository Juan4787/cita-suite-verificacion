-- Committed synthetic pre-upgrade state: the grants V10b leaves in a practice (one hour each),
-- one active, one expired and one ended by the owner. Runs only in the owned disposable DB.
begin;
insert into auth.users(id,email) values
 ('6c170000-0000-4000-8000-000000000001','assistance-upgrade-owner@example.test'),
 ('6c170000-0000-4000-8000-000000000002','assistance-upgrade-support@example.test');
insert into public.businesses(id,name,slug,industry,timezone)
 values('6c170000-0000-4000-8000-000000000003','Synthetic assistance upgrade','synthetic-assistance-upgrade','other','America/Argentina/Buenos_Aires');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='6c170000-0000-4000-8000-000000000003';
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 values('6c170000-0000-4000-8000-000000000003','6c170000-0000-4000-8000-000000000001','owner','active',now());
insert into public.account_assistance_support_users(user_id,email,enabled)
 values('6c170000-0000-4000-8000-000000000002','assistance-upgrade-support@example.test',true);
insert into public.account_assistance_grants(id,business_id,requested_by_user_id,support_user_id,status,starts_at,expires_at,revoked_at,revoked_by_user_id) values
 ('6c170000-0000-4000-8000-000000000004','6c170000-0000-4000-8000-000000000003','6c170000-0000-4000-8000-000000000001',
  '6c170000-0000-4000-8000-000000000002','expired',now()-interval '3 hours',now()-interval '2 hours',null,null),
 ('6c170000-0000-4000-8000-000000000005','6c170000-0000-4000-8000-000000000003','6c170000-0000-4000-8000-000000000001',
  '6c170000-0000-4000-8000-000000000002','revoked',now()-interval '90 minutes',now()-interval '30 minutes',now()-interval '80 minutes',
  '6c170000-0000-4000-8000-000000000001'),
 ('6c170000-0000-4000-8000-000000000006','6c170000-0000-4000-8000-000000000003','6c170000-0000-4000-8000-000000000001',
  '6c170000-0000-4000-8000-000000000002','active',now()-interval '10 minutes',now()+interval '50 minutes',null,null);
commit;
