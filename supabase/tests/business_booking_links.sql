-- Booking links name the practice (migration 20261110010000): a new practice takes the address of
-- its name and follows it, an address it leaves keeps leading to it and nobody else can take it, an
-- address written explicitly is kept as written, and only the backend resolves an address.
-- Synthetic data only; everything is rolled back.
begin;
select extensions.plan(17);

create temporary table link_fixture(label text primary key, id uuid not null);
grant select on link_fixture to authenticated, service_role;

do $$
declare v_suffix text:=replace(gen_random_uuid()::text,'-','');
begin
 insert into link_fixture values
  ('admin',gen_random_uuid()),('self',gen_random_uuid()),('north_owner',gen_random_uuid()),
  ('second_owner',gen_random_uuid()),('third_owner',gen_random_uuid()),('fixture',gen_random_uuid());
 insert into auth.users(id,email) select id,'booking-link-'||label||'-'||v_suffix||'@example.test' from link_fixture;
end $$;

-- Creates a practice as the master panel does, through the service role.
create function pg_temp.create_practice(p_name text, p_owner text) returns uuid language plpgsql as $$
declare
 v_id uuid;
 v_email text:=(select email from auth.users where id=(select id from link_fixture where label=p_owner));
 v_admin uuid:=(select id from link_fixture where label='admin');
 v_admin_email text:=(select email from auth.users where id=(select id from link_fixture where label='admin'));
begin
 perform set_config('request.jwt.claim.role','service_role',true);
 execute 'set local role service_role';
 select created.business_id into v_id from public.create_business_with_owner(
  p_name, 'base-que-el-panel-manda', v_email, 30*24*60*60, 'month', false, null, 'Acceso de prueba.',
  v_admin, v_admin_email, gen_random_uuid()::text) created;
 execute 'reset role';
 return v_id;
end $$;

create function pg_temp.slug_of(p_id uuid) returns text language sql as $$ select slug from public.businesses where id=p_id $$;
create function pg_temp.aliases_of(p_id uuid) returns text language sql as $$
 select coalesce(string_agg(slug,',' order by slug),'') from private.business_slug_aliases where business_id=p_id $$;

-- 1. The address a name gives. Same vectors as apps/web/src/lib/booking/booking-link.test.ts.
select extensions.is(
 (select array_agg(private.business_slug_from_text(input) order by ord) from unnest(array[
  'Consultorio Ramírez','  Dra. Natalia   Frutos  ','Ñandú & Peña','ODONTOLOGÍA INTEGRAL','Clínica Dental 24/7',
  'D''Angelo Sonrisas','Øresund Smile','😀 Sonrisas','Caf´e','---','',repeat('a',79)||' b'
 ]) with ordinality v(input,ord)),
 array['consultorio-ramirez','dra-natalia-frutos','nandu-pena','odontologia-integral','clinica-dental-24-7',
  'd-angelo-sonrisas','resund-smile','sonrisas','caf-e','','',repeat('a',79)],
 'a name gives the address the app shows while it is typed');

-- 2. The master panel gives a new practice the address of its name, which follows the name.
insert into link_fixture select 'north',pg_temp.create_practice('Consultorio Enlace Ñandú','north_owner');
select extensions.is(
 (select slug||' '||slug_follows_name from public.businesses where id=(select id from link_fixture where label='north')),
 'consultorio-enlace-nandu true',
 'the master panel gives a new practice the address of its name, not the base it sends');

-- 3. A repeated name gets the next free address.
insert into link_fixture select 'second',pg_temp.create_practice('Consultorio Enlace Ñandú','second_owner');
select extensions.is(pg_temp.slug_of((select id from link_fixture where label='second')), 'consultorio-enlace-nandu-2',
 'a repeated name gets the next free address');

-- 4. Self-service signup takes the address from the name, never from the owner's email.
do $$
declare v_id uuid;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from link_fixture where label='self'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 select created.business_id into v_id from public.ensure_user_default_business('Consultorio','odontology') created;
 execute 'reset role';
 insert into link_fixture values('self_practice',v_id);
end $$;
select extensions.ok(
 (select slug~'^consultorio(-[0-9]+)?$' and slug_follows_name and position('booking-link' in slug)=0
  from public.businesses where id=(select id from link_fixture where label='self_practice')),
 'self-service signup gives the address of the name and nothing of the owner''s email');

-- 5. The owner renames the practice under row level security, as practice settings do: the address
-- follows the name and the previous one keeps leading to the practice.
create temporary table self_before as select pg_temp.slug_of((select id from link_fixture where label='self_practice')) slug;
grant select on self_before to authenticated;
-- Row level security lets the owner save a practice that may operate: a new one starts restricted.
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=(select id from link_fixture where label='self_practice');
do $$
begin
 perform set_config('request.jwt.claim.sub',(select id::text from link_fixture where label='self'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 update public.businesses set name='Odontología Enlace Prueba' where id=(select id from link_fixture where label='self_practice');
 execute 'reset role';
end $$;
select extensions.is(
 pg_temp.slug_of((select id from link_fixture where label='self_practice'))||' '||pg_temp.aliases_of((select id from link_fixture where label='self_practice')),
 'odontologia-enlace-prueba '||(select slug from self_before),
 'renaming moves the address with the name and keeps the previous one for the practice');

-- 6. A name with the same address keeps it and records nothing.
update public.businesses set name='Odontologia enlace PRUEBA' where id=(select id from link_fixture where label='self_practice');
select extensions.is(
 pg_temp.slug_of((select id from link_fixture where label='self_practice'))||' '||pg_temp.aliases_of((select id from link_fixture where label='self_practice')),
 'odontologia-enlace-prueba '||(select slug from self_before),
 'a name with the same address keeps it');

-- 7. An address resolves to its practice: current, typed differently, used before; nothing else.
-- concat_ws writes a boolean as t or f: each one goes through ::text, which writes true or false.
select extensions.is(
 concat_ws(' ',
  (public.resolve_public_business_slug('odontologia-enlace-prueba')=(select id from link_fixture where label='self_practice'))::text,
  (public.resolve_public_business_slug('ODONTOLOGIA-ENLACE-PRUEBA')=(select id from link_fixture where label='self_practice'))::text,
  (public.resolve_public_business_slug(' Odontología Enlace Prueba ')=(select id from link_fixture where label='self_practice'))::text,
  (public.resolve_public_business_slug((select slug from self_before))=(select id from link_fixture where label='self_practice'))::text,
  (coalesce(public.resolve_public_business_slug('enlace-que-nadie-tiene-'||gen_random_uuid()),'00000000-0000-0000-0000-000000000000'::uuid)='00000000-0000-0000-0000-000000000000')::text,
  (coalesce(public.resolve_public_business_slug(repeat('odontologia-enlace-prueba',9)),'00000000-0000-0000-0000-000000000000'::uuid)='00000000-0000-0000-0000-000000000000')::text),
 'true true true true true true',
 'an address resolves to its practice whether current, typed differently or used before');

-- 8 and 9. No other practice takes an address that one used before.
select extensions.throws_ok(
 format('update public.businesses set slug=%L where id=%L',(select slug from self_before),(select id from link_fixture where label='second')),
 '23505', 'BUSINESS_SLUG_UNAVAILABLE',
 'another practice cannot change to an address one used before');
select extensions.throws_ok(
 format('insert into public.businesses(name,slug,industry) values(%L,%L,%L)','Robo de enlace',(select slug from self_before),'other'),
 '23505', 'BUSINESS_SLUG_UNAVAILABLE',
 'a new practice cannot be written with an address one used before');

-- 10. A practice that follows its name skips an address used before.
update public.businesses set name='Clínica Enlace Norte' where id=(select id from link_fixture where label='north');
insert into link_fixture select 'third',pg_temp.create_practice('Consultorio Enlace Ñandú','third_owner');
select extensions.is(
 concat_ws(' ',pg_temp.slug_of((select id from link_fixture where label='north')),pg_temp.aliases_of((select id from link_fixture where label='north')),
  pg_temp.slug_of((select id from link_fixture where label='third'))),
 'clinica-enlace-norte consultorio-enlace-nandu consultorio-enlace-nandu-3',
 'a new practice skips the address another one used before');

-- 11. An address written explicitly is a choice: it stops following the name.
update public.businesses set slug='mi-enlace-elegido' where id=(select id from link_fixture where label='second');
update public.businesses set name='Otro nombre del segundo' where id=(select id from link_fixture where label='second');
select extensions.is(
 (select concat_ws(' ',slug,slug_follows_name::text,pg_temp.aliases_of(id)) from public.businesses where id=(select id from link_fixture where label='second')),
 'mi-enlace-elegido false consultorio-enlace-nandu-2',
 'an address written explicitly stays when the name changes');

-- 12. A practice takes back an address it used before.
update public.businesses set slug='consultorio-enlace-nandu' where id=(select id from link_fixture where label='north');
select extensions.is(
 pg_temp.slug_of((select id from link_fixture where label='north'))||' '||pg_temp.aliases_of((select id from link_fixture where label='north')),
 'consultorio-enlace-nandu clinica-enlace-norte',
 'a practice takes back an address it used before');

-- 13. Following the name again gives the address of the current name.
update public.businesses set slug_follows_name=true where id=(select id from link_fixture where label='second');
select extensions.is(
 (select slug||' '||slug_follows_name from public.businesses where id=(select id from link_fixture where label='second')),
 'otro-nombre-del-segundo true',
 'following the name again gives the address of the current name');

-- 14. An address written by a fixture or an operator is kept exactly as written, even its own id.
insert into public.businesses(id,name,slug,industry)
 values((select id from link_fixture where label='fixture'),'Fixture enlace','fixture-enlace_Exacto','other');
insert into public.businesses(id,name,slug,industry) select gen_random_uuid(),'Fixture con id',gen_random_uuid()::text,'other';
update public.businesses set name='Fixture enlace renombrado' where id=(select id from link_fixture where label='fixture');
select extensions.is(
 (select slug||' '||slug_follows_name from public.businesses where id=(select id from link_fixture where label='fixture')),
 'fixture-enlace_Exacto false',
 'an address written directly is kept as written and does not follow the name');

-- 15. Deleting a practice removes the addresses it used. A fixture's practice, because one created
-- by the master panel keeps an append-only access history and cannot be deleted.
update public.businesses set slug='fixture-enlace-nuevo' where id=(select id from link_fixture where label='fixture');
create temporary table fixture_aliases as
 select count(*)::integer before from private.business_slug_aliases where business_id=(select id from link_fixture where label='fixture');
delete from public.businesses where id=(select id from link_fixture where label='fixture');
select extensions.is(
 (select before from fixture_aliases)||' '||(select count(*) from private.business_slug_aliases where business_id=(select id from link_fixture where label='fixture')),
 '1 0',
 'deleting a practice removes the addresses it used before');

-- 16. Only the backend resolves an address; nothing of the API reaches the rules or the list.
select extensions.ok(
 has_function_privilege('service_role','public.resolve_public_business_slug(text)','execute')
 and not has_function_privilege('anon','public.resolve_public_business_slug(text)','execute')
 and not has_function_privilege('authenticated','public.resolve_public_business_slug(text)','execute')
 and not exists(select 1 from unnest(array['anon','authenticated','service_role']) api_role
  where has_table_privilege(api_role,'private.business_slug_aliases','select,insert,update,delete')
   or has_function_privilege(api_role,'private.business_slug_from_text(text)','execute')
   or has_function_privilege(api_role,'private.available_business_slug(text,uuid)','execute')
   or has_function_privilege(api_role,'private.assign_business_slug()','execute')
   or has_function_privilege(api_role,'private.keep_previous_business_slug()','execute')),
 'only the backend resolves an address and no API role reaches the rules or the list');

-- 17. Both triggers listen to exactly the same columns: one limited to slug alone would miss the
-- address the first one assigns when only the name changes.
select extensions.is(
 (select string_agg(t.tgname||':'||(select string_agg(a.attname,',' order by a.attname) from unnest(t.tgattr::int2[]) column_number
   join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=column_number),' ' order by t.tgname)
  from pg_trigger t where t.tgrelid='public.businesses'::regclass and t.tgname in ('businesses_assign_slug','businesses_keep_previous_slug')),
 'businesses_assign_slug:name,slug,slug_follows_name businesses_keep_previous_slug:name,slug,slug_follows_name',
 'both address triggers listen to the name, the address and whether it follows the name');

select * from extensions.finish();
rollback;
