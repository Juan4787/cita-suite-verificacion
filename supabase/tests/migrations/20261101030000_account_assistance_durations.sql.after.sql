-- The upgrade keeps every V10b grant as a one-hour grant, unextended and with nobody recorded as
-- ending it, keeps the active one working, and lets the owner extend and end it with the new
-- functions. The checks are rolled back; the seeded namespace is then removed exactly.
begin;
select extensions.plan(4);
select extensions.is((select string_agg(format('%s %s %s %s', status, kind, extended_at is null, revoked_by_role is null), ', ' order by id)
 from public.account_assistance_grants where business_id='6c170000-0000-4000-8000-000000000003'),
 'expired hour t t, revoked hour t t, active hour t t',
 'every V10b grant becomes a one-hour grant, unextended, with nobody recorded as ending it');
select set_config('request.jwt.claim.sub','6c170000-0000-4000-8000-000000000002',true);
set local role authenticated;
select extensions.ok(public.user_has_active_account_assistance('6c170000-0000-4000-8000-000000000003'),
 'the active V10b grant keeps giving access after the upgrade');
reset role;
select set_config('request.jwt.claim.sub','6c170000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.is((select format('%s %s', kind, expires_at=now()+interval '24 hours') from public.extend_account_assistance(
 '6c170000-0000-4000-8000-000000000003','6c170000-0000-4000-8000-000000000006','day')),
 'day t', 'the owner extends the V10b grant to 24 hours with the new function');
select extensions.is((select format('%s %s', status, revoked_by_role) from public.end_account_assistance(
 '6c170000-0000-4000-8000-000000000003','6c170000-0000-4000-8000-000000000006')),
 'revoked owner', 'the owner ends the V10b grant with the new function');
reset role;
select * from extensions.finish();
rollback;
begin;
delete from public.account_assistance_grants where business_id='6c170000-0000-4000-8000-000000000003';
delete from public.business_users where business_id='6c170000-0000-4000-8000-000000000003';
delete from public.account_assistance_support_users where user_id='6c170000-0000-4000-8000-000000000002';
delete from public.businesses where id='6c170000-0000-4000-8000-000000000003';
delete from auth.users where id in ('6c170000-0000-4000-8000-000000000001','6c170000-0000-4000-8000-000000000002');
commit;
