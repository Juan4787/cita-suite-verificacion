import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recoverDepositAutomation } from './deposit-recovery.mjs';

const rows = { 'public.deposit_policies': 1, 'public.deposit_service_exclusions': 0,
 'public.appointment_deposits': 2, 'private.deposit_automation': 1, 'public.appointment_slot_releases': 1 };
const digest = command => createHash('sha256').update(command).digest('hex');
const metadata = () => ({ globalStopped: true, slotOrderSafe: true, jobs: [
 { name: 'cita-suite-deposit-expiry', schedule: '*/5 * * * *', active: true, commandHash: digest('select private.expire_unpaid_deposits()') },
 { name: 'cita-suite-cron-history-retention', schedule: '37 5 * * *', active: true, commandHash: digest("delete from cron.job_run_details where end_time < now() - interval '14 days'") }
] });
const target = (data = metadata()) => {
 const calls = [];
 const sql = statement => {
  calls.push(statement);
  if (statement.startsWith('select enabled::text')) return 'true';
  if (statement.includes('json_build_object')) return JSON.stringify(data);
  return '';
 };
 return { sql, calls };
};
test('a legacy backup has no deposit recovery to execute', () => {
 const t = target();assert.deepEqual(recoverDepositAutomation({}, t.sql), { applicable: false });assert.equal(t.calls.length, 0);
});
test('a partial deposit family is rejected before changing the restored target', () => {
 const t = target();assert.throws(() => recoverDepositAutomation({ 'public.deposit_policies': 0 }, t.sql), /INCOMPLETE_DEPOSIT_BACKUP/);assert.equal(t.calls.length, 0);
});
test('a B backup recovers jobs without claiming it checked a C identity', () => {
 const { 'public.appointment_slot_releases': unused, ...bRows } = rows;
 const result = recoverDepositAutomation(bRows, target().sql);
 assert.equal(result.slotOrderChecked, false);assert.equal(Object.hasOwn(result.tables, 'public.appointment_slot_releases'), false);
});
test('C without B and invalid row counts are rejected without executing SQL', () => {
 for (const data of [{ 'public.appointment_slot_releases': 1 }, { ...rows, 'public.appointment_deposits': null }]) {
  const t = target();assert.throws(() => recoverDepositAutomation(data, t.sql), /INCOMPLETE_DEPOSIT_BACKUP/);assert.equal(t.calls.length, 0);
 }
});
test('a restored deposit backup stops automation and recovers the versioned jobs idempotently', () => {
 const t = target();const result = recoverDepositAutomation(rows, t.sql);
 assert.equal(result.enabledBeforeRecovery, true);assert.equal(result.enabledAfterRecovery, false);
 assert.equal(result.slotOrderChecked, true);assert.equal(result.slotOrderSafe, true);assert.equal(result.jobs, 2);
 assert.deepEqual(result.tables, rows);
 const operations = t.calls.filter(statement => !statement.startsWith('select'));
 assert.equal(operations.length, 2);assert.equal(operations[0], operations[1]);
});
test('null or false safety checks and missing, repeated or altered jobs cannot certify recovery', () => {
 for (const data of [ { ...metadata(), globalStopped: null }, { ...metadata(), globalStopped: false },
  { ...metadata(), slotOrderSafe: null }, { ...metadata(), slotOrderSafe: false },
  { ...metadata(), jobs: [] }, { ...metadata(), jobs: [metadata().jobs[0], metadata().jobs[0]] },
  { ...metadata(), jobs: metadata().jobs.map(job => ({ ...job, commandHash: 'wrong' })) } ]) {
  assert.throws(() => recoverDepositAutomation(rows, target(data).sql), /DEPOSIT_RECOVERY_NOT_VERIFIED/);
 }
});
