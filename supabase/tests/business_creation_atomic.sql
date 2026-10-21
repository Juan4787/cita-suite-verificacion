-- The master panel creates a practice in one transaction: the owner's access email, the
-- practice, its owner membership or invitation and its initial access are all written,
-- or none is. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(7);

create temporary table creation_fixture(label text primary key, id uuid, email text);

do $$
declare v_admin uuid:=gen_random_uuid(); v_owner uuid:=gen_random_uuid(); v_taken_owner uuid:=gen_random_uuid(); v_taken uuid:=gen_random_uuid();
 v_suffix text:=replace(gen_random_uuid()::text,'-','');
begin
 insert into auth.users(id,email) values
  (v_admin,'creation-master-'||v_suffix||'@example.test'),
  (v_owner,'creation-owner-'||v_suffix||'@example.test'),
  (v_taken_owner,'creation-taken-'||v_suffix||'@example.test');
 insert into public.businesses(id,name,slug,industry,timezone) values(v_taken,'Consultorio ocupado','creation-taken-'||v_suffix,'odontology','America/Argentina/Buenos_Aires');
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(v_taken,v_taken_owner,'owner','active',now());
 insert into public.allowed_emails(email,enabled,onboarding_mode) values('creation-taken-'||v_suffix||'@example.test',false,'manual');
 insert into creation_fixture values
  ('admin',v_admin,'creation-master-'||v_suffix||'@example.test'),
  ('owner',v_owner,'creation-owner-'||v_suffix||'@example.test'),
  ('taken',v_taken_owner,'creation-taken-'||v_suffix||'@example.test'),
  ('new',null,'creation-new-'||v_suffix||'@example.test'),
  ('new-repeated',null,'creation-new-repeated-'||v_suffix||'@example.test'),
  ('new-id-shaped',null,'creation-new-id-shaped-'||v_suffix||'@example.test'),
  ('suffix',null,v_suffix);
end $$;

-- Creates a practice as the master panel does, through the service role.
create function pg_temp.create_practice(p_name text, p_slug_base text, p_owner text, p_key text)
returns table(business_id uuid, owner_linked boolean) language plpgsql as $$
declare v_email text:=(select email from creation_fixture where label=p_owner);
 v_admin uuid:=(select id from creation_fixture where label='admin');
 v_admin_email text:=(select email from creation_fixture where label='admin');
begin
 perform set_config('request.jwt.claim.role','service_role',true);
 execute 'set local role service_role';
 return query select created.business_id, created.owner_linked from public.create_business_with_owner(
  p_name, p_slug_base, v_email, 30*24*60*60, 'month', false, null,
  'Consultorio creado con acceso inicial: 1 mes.', v_admin, v_admin_email, p_key) created;
 execute 'reset role';
end $$;

-- 1. An existing account becomes the practice's active owner, and the practice gets
-- its email enabled for manual onboarding and its initial access.
create temporary table first_creation as select * from pg_temp.create_practice('Consultorio Primero', 'consultorio-primero-'||(select email from creation_fixture where label='suffix'), 'owner', 'creation-first');
select extensions.is(
 (select concat_ws(' ',
   (select owner_linked::text from first_creation),
   (select membership.role||':'||membership.status||':'||(membership.accepted_at is not null)::text from public.business_users membership
     where membership.business_id=(select business_id from first_creation) and membership.user_id=(select id from creation_fixture where label='owner')),
   (select allowed.enabled::text||':'||allowed.onboarding_mode from public.allowed_emails allowed where allowed.email=(select email from creation_fixture where label='owner')),
   (select (subscription.commercial_access_enabled and subscription.paid_until > now())::text from public.business_subscriptions subscription
     where subscription.business_id=(select business_id from first_creation)),
   (select count(*)::text from public.access_grants access_grant where access_grant.idempotency_key='creation-first'
     and access_grant.business_id=(select business_id from first_creation)))),
 'true owner:active:true true:manual true 1',
 'an existing account becomes the active owner of a practice with its email and initial access');

-- The role a practice's context gives a user when they sign in.
create function pg_temp.context_role(p_user uuid, p_business uuid) returns text language plpgsql as $$
declare v_role text;
begin
 perform set_config('request.jwt.claim.sub', p_user::text, true);
 perform set_config('request.jwt.claim.role', 'authenticated', true);
 execute 'set local role authenticated';
 select context.role into v_role from public.list_user_business_contexts() context
 where context.business->>'id' = p_business::text;
 execute 'reset role';
 return v_role;
end $$;

-- 2. The owner's first sign-in finds the practice ready, with nothing configured by
-- hand: their context as owner, the storage quota account and the availability
-- configuration the practice's triggers create.
select extensions.is(
 (select concat_ws(' ',
   pg_temp.context_role((select id from creation_fixture where label='owner'), (select business_id from first_creation)),
   (select count(*)::text from public.clinical_business_storage_budget where business_id=(select business_id from first_creation)),
   (select count(*)::text from private.availability_configuration_versions where business_id=(select business_id from first_creation)))),
 'owner 1 1',
 'a new practice is ready for its owner without manual configuration');

-- 3. An email without an account receives a pending owner invitation.
create temporary table invited_creation as select * from pg_temp.create_practice('Consultorio Invitado', 'consultorio-invitado-'||(select email from creation_fixture where label='suffix'), 'new', 'creation-invited');
select extensions.is(
 (select concat_ws(' ',
   (select owner_linked::text from invited_creation),
   (select invite.role||':'||invite.status from public.business_user_invites invite
     where invite.business_id=(select business_id from invited_creation) and invite.email=(select email from creation_fixture where label='new')),
   (select count(*)::text from public.business_users membership where membership.business_id=(select business_id from invited_creation)))),
 'false owner:pending 0',
 'an email without an account receives a pending owner invitation');

-- 4. An email that already belongs to another practice is refused, and nothing of the
-- attempt remains: no practice, the email stays disabled and no access was granted.
select extensions.throws_ok(
 $$select * from pg_temp.create_practice('Consultorio Rechazado', 'consultorio-rechazado-'||(select email from creation_fixture where label='suffix'), 'taken', 'creation-refused')$$,
 'P0001', 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS',
 'an email that belongs to another practice is refused');
reset role;
select extensions.is(
 (select concat_ws(' ',
   (select count(*)::text from public.businesses where name='Consultorio Rechazado'),
   (select enabled::text from public.allowed_emails where email=(select email from creation_fixture where label='taken')),
   (select count(*)::text from public.access_grants where idempotency_key='creation-refused'))),
 '0 false 0',
 'a refused creation leaves no practice, no enabled email and no access');

-- 5. Two practices with the same name get distinct slugs, and a base shaped like an id
-- never becomes a slug that the booking link would read as an id.
create temporary table repeated_creation as select * from pg_temp.create_practice('Consultorio Primero', 'consultorio-primero-'||(select email from creation_fixture where label='suffix'), 'new-repeated', 'creation-repeated');
create temporary table id_shaped_creation as select * from pg_temp.create_practice('Consultorio Id', gen_random_uuid()::text, 'new-id-shaped', 'creation-id-shaped');
select extensions.ok(
 (select slug from public.businesses where id=(select business_id from repeated_creation))
  <> (select slug from public.businesses where id=(select business_id from first_creation))
 and (select slug from public.businesses where id=(select business_id from id_shaped_creation))
  !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
 'repeated names get distinct slugs and no slug is shaped like an id');

-- 6. Only the backend, after the panel verified the master, can create a practice.
select extensions.ok(
 has_function_privilege('service_role','public.create_business_with_owner(text,text,text,integer,text,boolean,text,text,uuid,text,text)','execute')
 and not has_function_privilege('authenticated','public.create_business_with_owner(text,text,text,integer,text,boolean,text,text,uuid,text,text)','execute')
 and not has_function_privilege('anon','public.create_business_with_owner(text,text,text,integer,text,boolean,text,text,uuid,text,text)','execute'),
 'only the backend can create a practice');

select * from extensions.finish();
rollback;
