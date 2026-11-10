-- The upgrade gives the address of the name to every practice whose address was automatic, oldest
-- first and without taking one a practice already holds, keeps each replaced address leading to its
-- practice, and leaves alone every address someone chose or a fixture wrote. The checks are rolled
-- back; the seeded namespace is then removed exactly.
begin;
select extensions.plan(2);
select extensions.is(
 -- format writes a boolean as t or f; ::text writes true or false.
 (select string_agg(format('%s %s %s %s', right(b.id::text,2), b.slug, b.slug_follows_name::text,
   coalesce((select string_agg(a.slug,',' order by a.slug) from private.business_slug_aliases a where a.business_id=b.id),'-')), ' | ' order by b.id)
  from public.businesses b where b.id::text like '6d1a0000-0000-4000-8000-0000000000%'),
 '01 consultorio-sintetico-enlaces true synth-legacy-one-a1110001'
 ||' | 02 consultorio-sintetico-enlaces-2 true synth-legacy-two-a1110002-2'
 ||' | 03 consultorio-sintetico-enlaces-3 true synth-legacy-before-a1110003'
 ||' | 04 clinica-sintetica-petrona true -'
 ||' | 05 consultorio-sintetico-repetido true consultorio-sintetico-repetido-a1b2c3'
 ||' | 06 sintetica-frutos false -'
 ||' | 07 duplicado-sintetico false -'
 ||' | 08 verif-verif_sintetico false -'
 ||' | 09 synth-device-a1110004eaca false -'
 ||' | 10 consultorio-sintetico-ocupado-2 true synth-legacy-five-a1110005'
 ||' | 11 consultorio-sintetico-ocupado true -'
 ||' | 12 6d1a0000-0000-4000-8000-000000000012 false -',
 'automatic addresses take the name, oldest first, and chosen or written ones stay');
select extensions.is(
 concat_ws(' ',
  public.resolve_public_business_slug('synth-legacy-one-a1110001'),
  public.resolve_public_business_slug('consultorio-sintetico-enlaces'),
  public.resolve_public_business_slug('consultorio-sintetico-repetido-a1b2c3')),
 '6d1a0000-0000-4000-8000-000000000001 6d1a0000-0000-4000-8000-000000000001 6d1a0000-0000-4000-8000-000000000005',
 'a replaced address keeps leading to its practice');
select * from extensions.finish();
rollback;
begin;
delete from public.business_users where business_id::text like '6d1a0000-0000-4000-8000-0000000000%';
delete from public.businesses where id::text like '6d1a0000-0000-4000-8000-0000000000%';
delete from auth.users where id::text like 'a111000_-0000-4000-8000-00000000000_';
commit;
