-- Deterministic synthetic practices for the capacity scenarios of the plan: per
-- practice 3 professionals, 5 services, weekday schedules, 6,000 patients and
-- 12,000 appointments over twelve months (nine past, three ahead), with the states
-- the system admits today: reserved, confirmed, cancelled and reschedule requested.
-- The passing of time writes no state, so past appointments stay reserved or
-- confirmed. Identities are fictitious; every row belongs to a `capacity-` practice.
-- Run after the migrations, on a disposable database or the staging project, through
-- the real triggers:
--   psql -v practices=5 -v owners='["<auth user id>", ...]' -f seed-practices.sql
-- The owners are created first through the Auth admin API, one per practice.
-- Patients and appointments go in batches of 500 and 1,000, each its own statement
-- and transaction: their identity and booking triggers take advisory locks per row,
-- so one transaction for a whole scenario would exceed any lock table, and a hosted
-- project limits how long one statement runs, unlike every real operation.
\set ON_ERROR_STOP on
-- Deterministic ids shaped as valid version-4 UUIDs, like every id gen_random_uuid()
-- gives in production: the app validates the version and variant digits.
create function pg_temp.capacity_uuid(p_text text) returns uuid language sql immutable as $$
 select overlay(overlay(md5(p_text) placing '4' from 13) placing '8' from 17)::uuid
$$;
select set_config('cita.capacity.practices', :'practices', false),
 set_config('cita.capacity.owners', :'owners', false);

create temporary table capacity_practice as
select p as practice,
 pg_temp.capacity_uuid('capacity-practice-'||p) as business_id,
 (current_setting('cita.capacity.owners')::jsonb->>(p-1))::uuid as owner_id,
 lpad(p::text,2,'0') as tag
from generate_series(1,current_setting('cita.capacity.practices')::integer) p;
do $$
begin
 if (select count(*) from capacity_practice where owner_id is null)>0
  or jsonb_array_length(current_setting('cita.capacity.owners')::jsonb)<>(select count(*) from capacity_practice) then
  raise exception 'CAPACITY_OWNERS_MISMATCH';
 end if;
 if exists(select 1 from public.businesses where slug like 'capacity-%') then raise exception 'CAPACITY_ALREADY_SEEDED'; end if;
end $$;

begin;
insert into public.businesses(id,name,slug,industry,timezone,min_booking_notice_minutes,max_booking_days_ahead,address)
select business_id,'Consultorio de capacidad '||tag,'capacity-'||tag,'odontology','America/Argentina/Buenos_Aires',60,180,'Dirección sintética '||practice
from capacity_practice;
update public.business_subscriptions s set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null
from capacity_practice c where s.business_id=c.business_id;
insert into public.business_users(business_id,user_id,role,status,accepted_at)
select business_id,owner_id,'owner','active',now()-interval '1 year' from capacity_practice;
insert into public.professionals(id,business_id,name)
select pg_temp.capacity_uuid('capacity-professional-'||c.practice||'-'||k),c.business_id,'Profesional '||c.tag||'-'||k
from capacity_practice c cross join generate_series(1,3) k;
insert into public.services(id,business_id,name,duration_minutes)
select pg_temp.capacity_uuid('capacity-service-'||c.practice||'-'||k),c.business_id,(array['Consulta','Control','Limpieza','Urgencia','Seguimiento'])[k],30
from capacity_practice c cross join generate_series(1,5) k;
insert into public.professional_services(business_id,professional_id,service_id)
select c.business_id,pg_temp.capacity_uuid('capacity-professional-'||c.practice||'-'||k),pg_temp.capacity_uuid('capacity-service-'||c.practice||'-'||s)
from capacity_practice c cross join generate_series(1,3) k cross join generate_series(1,5) s;
insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
select c.business_id,pg_temp.capacity_uuid('capacity-professional-'||c.practice||'-'||k),d,'09:00','18:00',30,0
from capacity_practice c cross join generate_series(1,3) k cross join generate_series(1,5) d;
-- The site integration a practice's website uses to open its booking (Natalia's path).
insert into public.booking_integrations(business_id,public_key,name,is_active,is_default,theme,allowed_origins,allowed_modalities,intake_schema)
select business_id,md5('capacity-integration-'||practice),'Sitio sintético '||tag,true,true,'cita-suite',
 array['https://sitio-capacidad-'||tag||'.example'],array['in_person'],'[]' from capacity_practice;
commit;

-- 12,000 appointments per practice out of the weekday slots of twelve months: three
-- professionals with eighteen 30-minute slots a day, chosen by a fixed hash order
-- so every day keeps some free slots and no two appointments overlap.
create temporary table capacity_appointment as
select s.practice,s.business_id,s.professional,s.pick as n,
 ((s.day::timestamp+interval '9 hours'+make_interval(mins=>30*s.slot)) at time zone 'America/Argentina/Buenos_Aires') as starts_at,
 1+(s.pick%5) as service,(s.pick*7919)%6000 as patient,('x'||substr(md5('state-'||s.practice||'-'||s.pick),1,7))::bit(28)::integer%100 as roll
from (
 select c.practice,c.business_id,k as professional,d::date as day,sl as slot,
  row_number() over(partition by c.practice order by md5(c.practice||'-'||k||'-'||d::date||'-'||sl)) as pick
 from capacity_practice c
 cross join generate_series(date_trunc('day',now())-interval '270 days',date_trunc('day',now())+interval '95 days',interval '1 day') d
 cross join generate_series(1,3) k cross join generate_series(0,17) sl
 where extract(isodow from d) between 1 and 5
) s where s.pick<=12000;
create index on capacity_appointment(practice,n);
do $$
begin
 if (select count(*) from capacity_appointment)<>12000*(select count(*) from capacity_practice) then raise exception 'CAPACITY_SLOTS_SHORT'; end if;
end $$;

-- 6,000 patients per practice in batches of 500: 40 first names by 50 surnames, with
-- unique documents and phones.
create procedure pg_temp.capacity_seed_patients(p_practice integer,p_batch integer) language plpgsql as $$
declare c record;
begin
 select * into strict c from capacity_practice where practice=p_practice;
 insert into public.patients(id,owner_id,business_id,full_name,dni,phone,birth_date,insurance,created_at,updated_at)
 select pg_temp.capacity_uuid('capacity-patient-'||c.practice||'-'||i),c.owner_id,c.business_id,
  (array['Ana','Bruno','Carla','Diego','Elena','Facundo','Gabriela','Hernán','Inés','Javier','Karina','Lucas','María','Nicolás','Olga','Pablo',
   'Romina','Santiago','Tamara','Ulises','Valeria','Walter','Ximena','Yamila','Zulema','Agustina','Bautista','Camila','Dante','Emilia','Federico',
   'Guadalupe','Hugo','Isabel','Julián','Lorena','Mateo','Natalia','Octavio','Paula'])[1+i%40]||' '||
  (array['Acosta','Benítez','Castro','Díaz','Escobar','Fernández','García','Herrera','Ibarra','Juárez','Ledesma','Martínez','Núñez','Ortiz','Pereyra',
   'Quiroga','Ríos','Sosa','Torres','Urquiza','Vega','Zárate','Álvarez','Blanco','Cabrera','Domínguez','Figueroa','Giménez','Ruiz','Molina',
   'Navarro','Ojeda','Ponce','Ramos','Suárez','Toledo','Vargas','Aguirre','Bustos','Correa','Duarte','Farías','Gutiérrez','Luna','Medina',
   'Paz','Rojas','Silva','Villalba','Moreno'])[1+(i/40)%50],
  (20000000+c.practice*100000+i)::text,'+54911'||lpad((c.practice*100000+i)::text,8,'0'),
  date '1950-01-01'+((i*7919)%25000),case when i%3=0 then 'OSDE' when i%3=1 then 'Swiss Medical' else null end,
  now()-interval '1 year'+make_interval(mins=>i*80),now()-interval '1 year'+make_interval(mins=>i*80)
 from generate_series(p_batch*500,p_batch*500+499) i;
end $$;

-- 12,000 appointments per practice in batches of 1,000. The appointment trigger links
-- each patient to the professionals who attend them. Three in ten past appointments
-- came from the public booking; future ones are manual, so the real limit of four
-- active public bookings per name never decides whether a deterministic seed succeeds.
create procedure pg_temp.capacity_seed_appointments(p_practice integer,p_batch integer) language plpgsql as $$
declare c record;
begin
 select * into strict c from capacity_practice where practice=p_practice;
 insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot,confirmed_at,cancelled_at,reschedule_requested_at,created_at,updated_at)
 select pg_temp.capacity_uuid('capacity-appointment-'||a.practice||'-'||a.n),a.business_id,pg_temp.capacity_uuid('capacity-patient-'||a.practice||'-'||a.patient),
  pg_temp.capacity_uuid('capacity-service-'||a.practice||'-'||a.service),pg_temp.capacity_uuid('capacity-professional-'||a.practice||'-'||a.professional),
  a.starts_at,a.starts_at+interval '30 minutes',a.starts_at,a.starts_at+interval '30 minutes',
  state.status,case when a.n%10<3 and a.starts_at<now() then 'public_booking' else 'manual' end,
  (array['Consulta','Control','Limpieza','Urgencia','Seguimiento'])[a.service],'Profesional '||c.tag||'-'||a.professional,30,
  case when state.status='confirmed' then least(a.starts_at-interval '1 day',now()) end,
  case when state.status='cancelled' then least(a.starts_at-interval '2 days',now()) end,
  case when state.status='reschedule_requested' then least(a.starts_at-interval '1 day',now()) end,
  least(a.starts_at-interval '7 days',now()),least(a.starts_at-interval '1 day',now())
 from capacity_appointment a
 cross join lateral (select case
   when a.starts_at<now() then case when a.roll<15 then 'cancelled' when a.roll<75 then 'confirmed' else 'reserved' end
   else case when a.roll<10 then 'cancelled' when a.roll<40 then 'confirmed' when a.roll<45 then 'reschedule_requested' else 'reserved' end
  end as status) state
 where a.practice=c.practice and a.n between p_batch*1000+1 and p_batch*1000+1000;
end $$;

-- Three in ten past confirmed appointments carry a clinical entry.
create procedure pg_temp.capacity_seed_entries(p_practice integer) language plpgsql as $$
declare c record;
begin
 select * into strict c from capacity_practice where practice=p_practice;
 insert into public.clinical_entries(business_id,patient_id,owner_id,entry_type,description,created_by_professional_id,created_at,updated_at)
 select a.business_id,a.patient_id,c.owner_id,'Consulta','Control sintético de capacidad',a.professional_id,a.starts_at+interval '30 minutes',a.starts_at+interval '30 minutes'
 from public.appointments a
 where a.business_id=c.business_id and a.status='confirmed' and a.starts_at<now() and ('x'||substr(md5(a.id::text),1,7))::bit(28)::integer%10<3;
end $$;

-- One statement and one transaction per batch, practice by practice: a hosted project
-- limits how long a statement runs (two minutes in staging), and every real operation
-- is far shorter than a whole scenario.
select statement from (
 select c.practice,1 as phase,b as batch,format('call pg_temp.capacity_seed_patients(%s,%s)',c.practice,b) as statement
 from capacity_practice c cross join generate_series(0,11) b
 union all
 select c.practice,2,b,format('call pg_temp.capacity_seed_appointments(%s,%s)',c.practice,b) from capacity_practice c cross join generate_series(0,11) b
 union all
 select c.practice,3,0,format('call pg_temp.capacity_seed_entries(%s)',c.practice) from capacity_practice c
) planned order by practice,phase,batch \gexec

-- The tables the scenario fills (a whole-database analyze would be one long statement).
analyze public.businesses,public.professionals,public.services,public.professional_services,public.availability_rules,
 public.booking_integrations,public.patients,public.appointments,public.appointment_professionals,public.professional_patient_links,
 public.clinical_entries,public.business_data_revisions;
-- One line, marked, whatever else psql printed before it.
select 'capacity-seed '||jsonb_build_object(
 'practices',(select count(*) from public.businesses where slug like 'capacity-%'),
 'patients',(select count(*) from public.patients p join public.businesses b on b.id=p.business_id where b.slug like 'capacity-%'),
 'appointments',(select count(*) from public.appointments a join public.businesses b on b.id=a.business_id where b.slug like 'capacity-%'),
 'appointmentStates',(select jsonb_object_agg(status,n) from (select a.status,count(*) n from public.appointments a join public.businesses b on b.id=a.business_id
   where b.slug like 'capacity-%' group by a.status) s),
 'professionalLinks',(select count(*) from public.professional_patient_links l join public.businesses b on b.id=l.business_id where b.slug like 'capacity-%'),
 'clinicalEntries',(select count(*) from public.clinical_entries e join public.businesses b on b.id=e.business_id where b.slug like 'capacity-%'),
 'databaseBytes',pg_database_size(current_database()),
 'largestTables',(select jsonb_agg(t order by t.bytes desc) from (select c.relname as table,pg_total_relation_size(c.oid) as bytes
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
   order by pg_total_relation_size(c.oid) desc limit 8) t)
)::text;
