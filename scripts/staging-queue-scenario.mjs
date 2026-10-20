import { createECDH, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';

// Queue scenario of the plan on the deployed staging: 25 synthetic practices with
// five due reminders each plus one practice with 150 that are due first. Every row
// belongs to one run (slug and endpoint prefix), so the report and the cleanup touch
// only that run. Reminders go to the synthetic push sink of the staging project.
// `seed-abandoned` also simulates, in the same transaction, a run that claimed every
// reminder 15 minutes ago and died without results: whatever is sent afterwards was
// recovered by the scheduled runs.
const root = fileURLToPath(new URL('../', import.meta.url));
const [operation, runArgument] = process.argv.slice(2);
if (!['seed', 'seed-abandoned', 'report', 'cleanup'].includes(operation))
	throw new Error('Usage: staging-queue-scenario.mjs seed|seed-abandoned|report <run>|cleanup <run>');
const seeding = operation.startsWith('seed');
const run = seeding ? randomBytes(6).toString('hex') : runArgument;
if (!/^[a-f0-9]{12}$/.test(run ?? '')) throw new Error('A run identifier of 12 hexadecimal characters is required.');
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const sink = `https://${STAGING_PROJECT_REF}.supabase.co/functions/v1/push-sink/${run}`;
const slug = `staging-scenario-${run}-`;
const options = '-c application_name=cita_suite_staging_queue_scenario';

const execute = (sql, args = ['-q']) => {
	const result = stagingPsql(url, [...args, '-f', '-'], { input: sql, options });
	if (result.error || result.status !== 0) throw new Error(`Staging ${operation} failed.\n` + psqlDiagnostics(result.stderr));
	return result.stdout.trim();
};

if (seeding) {
	// A valid browser key pair: encryption is real, only the push service is synthetic.
	const browser = createECDH('prime256v1');
	browser.generateKeys();
	const p256dh = browser.getPublicKey().toString('base64url');
	const auth = randomBytes(16).toString('base64url');
	execute(`begin;
do $$
declare
 v_owner uuid:=gen_random_uuid(); v_business uuid; v_service uuid; v_professional uuid; v_patient uuid; v_appointment uuid;
 v_t timestamptz:=date_trunc('minute',now())+interval '4 hours'; v_starts timestamptz; v_minutes integer;
begin
 insert into auth.users(id,email) values(v_owner,'${slug}owner@example.test');
 for clinic in 0..25 loop
  insert into public.businesses(name,slug,industry,timezone)
  values('Escenario staging '||clinic,'${slug}'||clinic,'odontology','America/Argentina/Buenos_Aires') returning id into v_business;
  insert into public.services(business_id,name,duration_minutes) values(v_business,'Consulta',30) returning id into v_service;
  insert into public.professionals(business_id,name) values(v_business,'Profesional sintético '||clinic) returning id into v_professional;
  insert into public.professional_services(business_id,professional_id,service_id) values(v_business,v_professional,v_service);
  for item in 0..(case when clinic=0 then 149 else 4 end) loop
   -- Practice 0 holds the long queue and is due first; the others come later in the day.
   v_minutes:=case when clinic=0 then 5 else 30 end;
   v_starts:=case when clinic=0 then v_t+make_interval(mins=>5*item) else v_t+interval '12 hours 30 minutes'+make_interval(mins=>30*item) end;
   insert into public.patients(owner_id,business_id,full_name) values(v_owner,v_business,'Paciente sintético') returning id into v_patient;
   insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
    status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
   values(v_business,v_patient,v_service,v_professional,v_starts,v_starts+make_interval(mins=>v_minutes),v_starts,v_starts+make_interval(mins=>v_minutes),
    'reserved','manual','Consulta','Profesional sintético '||clinic,v_minutes)
   returning id into v_appointment;
   perform public.save_appointment_push_subscription(v_business,v_appointment,'${sink}/'||clinic||'-'||item,'${p256dh}','${auth}','Escenario staging',now());
  end loop;
 end loop;
end $$;
${operation === 'seed-abandoned' ? `do $$
declare v_claimed integer; v_total integer:=0;
begin
 -- The claim is not scoped to a practice: refuse if anything else is due.
 if exists(select 1 from public.push_subscriptions s join public.businesses b on b.id=s.business_id
  join public.appointments a on a.business_id=s.business_id and a.id=s.appointment_id
  where b.slug not like '${slug}%' and (s.push_24h_sent_at is null or s.push_2h_sent_at is null)
  and a.starts_at>now() and a.starts_at<=now()+interval '24 hours') then
  raise exception 'STAGING_SCENARIO_FOREIGN_DUE_REMINDERS';
 end if;
 loop
  select count(*) into v_claimed from public.claim_push_reminder_batch(now()-interval '15 minutes',100,gen_random_uuid());
  v_total:=v_total+v_claimed;
  exit when v_claimed=0;
 end loop;
 if v_total<>275 then raise exception 'STAGING_SCENARIO_ABANDON_INCOMPLETE %',v_total; end if;
end $$;` : ''}
commit;`);
}

const report = () => JSON.parse(execute(`select json_build_object(
 'run','${run}','reportedAt',now(),
 'seededAt',(select min(created_at) from public.businesses where slug like '${slug}%'),
 'practices',coalesce((select json_agg(p order by p.slug) from (
  select b.slug,count(s.id) as reminders,count(s.push_24h_sent_at) as sent,
   extract(epoch from min(s.push_24h_sent_at)-b.created_at)::integer as first_sent_seconds,
   extract(epoch from max(s.push_24h_sent_at)-b.created_at)::integer as last_sent_seconds,
   (select count(*) from public.push_delivery_attempts a where a.business_id=b.id and a.failed_at is not null) as failed_attempts
  from public.businesses b join public.push_subscriptions s on s.business_id=b.id
  where b.slug like '${slug}%' group by b.id,b.slug,b.created_at) p),'[]'::json)
)`, ['-Atq']));

if (operation === 'cleanup') {
	execute(`begin;
delete from public.businesses where slug like '${slug}%';
delete from public.push_devices where endpoint like '${sink}/%';
delete from auth.users where email='${slug}owner@example.test';
commit;`);
	const remaining = report();
	if (remaining.practices.length || remaining.seededAt !== null) throw new Error('The scenario cleanup left rows of its run.');
	console.log(JSON.stringify({ run, cleaned: true }));
} else {
	const result = report();
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, `.verification/staging-queue-${run}-${operation}.json`), JSON.stringify(result, null, 2) + '\n');
	console.log(JSON.stringify(result, null, 2));
}
