import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const tables = ['public.deposit_policies', 'public.deposit_service_exclusions',
 'public.appointment_deposits', 'private.deposit_automation'];
const slotTable = 'public.appointment_slot_releases';
const expectedJobs = [
 ['cita-suite-deposit-expiry', '*/5 * * * *', 'select private.expire_unpaid_deposits()'],
 ['cita-suite-cron-history-retention', '37 5 * * *', "delete from cron.job_run_details where end_time < now() - interval '14 days'"]
];

// restoredSql must be the isolated restore target's adapter, never the backup source.
export function recoverDepositAutomation(rows, restoredSql) {
 const present = tables.filter(table => Object.hasOwn(rows, table));
 const slots = Object.hasOwn(rows, slotTable);
 if (!present.length && !slots) return { applicable: false };
 if (present.length !== tables.length || [...tables, ...(slots ? [slotTable] : [])]
  .some(table => !Number.isSafeInteger(rows[table]) || rows[table] < 0))
  throw new Error('INCOMPLETE_DEPOSIT_BACKUP');
 const before = restoredSql('select enabled::text from private.deposit_automation where singleton;');
 if (!['true', 'false'].includes(before)) throw new Error('DEPOSIT_RECOVERY_NOT_VERIFIED');
 const operation = readFileSync(new URL('../../supabase/operations/recover-deposit-automation.sql', import.meta.url), 'utf8');
 // Repeating the exact versioned operation must leave exactly the same two jobs.
 restoredSql(operation);
 restoredSql(operation);
 const slotCheck = slots ? `(select coalesce(bool_and(max_order is null or last_value > max_order
  or (last_value = max_order and is_called)), false)
  from public.appointment_slot_releases_event_order_seq
  cross join (select max(event_order) as max_order from public.appointment_slot_releases) latest)` : 'true';
 const metadata = JSON.parse(restoredSql(`select json_build_object(
  'globalStopped', (select enabled is false from private.deposit_automation where singleton),
  'slotOrderSafe', ${slotCheck},
  'jobs', (select coalesce(json_agg(json_build_object('name', jobname, 'schedule', schedule,
   'active', active, 'commandHash', encode(sha256(convert_to(command, 'UTF8')), 'hex')) order by jobname), '[]'::json)
   from cron.job where jobname in ('cita-suite-deposit-expiry','cita-suite-cron-history-retention'))
 )::text;`));
 const jobs = metadata?.jobs;
 const validJobs = Array.isArray(jobs) && jobs.length === expectedJobs.length && expectedJobs.every(([name, schedule, command]) => {
  const found = jobs.filter(job => job?.name === name);
  return found.length === 1 && found[0].schedule === schedule && found[0].active === true
   && found[0].commandHash === createHash('sha256').update(command).digest('hex');
 });
 if (metadata?.globalStopped !== true || metadata?.slotOrderSafe !== true || !validJobs)
  throw new Error('DEPOSIT_RECOVERY_NOT_VERIFIED');
 return { applicable: true, enabledBeforeRecovery: before === 'true', enabledAfterRecovery: false,
  slotOrderChecked: slots, slotOrderSafe: true, jobs: jobs.length,
  tables: Object.fromEntries([...tables, ...(slots ? [slotTable] : [])].map(table => [table, rows[table]])) };
}
