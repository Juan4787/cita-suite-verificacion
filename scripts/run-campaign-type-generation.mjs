import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { runVerificationProcess } from './lib/verification-process.mjs';
import { cleanupFixtureResources } from './lib/fixture-cleanup.mjs';
import { fixturePath } from './lib/fixture-path.mjs';

const verifySql = process.argv[2] === '--verify-sql';
if (process.argv.length !== (verifySql ? 3 : 2)) throw new Error('Only --verify-sql is accepted; remote targets and credentials are forbidden.');
assertHostedIntegrationResources();
const root = fileURLToPath(new URL('../', import.meta.url));
const lease = acquireVerificationLock(root);
const runId = randomUUID();
process.env.CITA_FIXTURE_RUN_ID = runId;
const controller = new AbortController();
const interrupt = () => controller.abort();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt);
const directory = join(root, '.verification');
mkdirSync(directory, { recursive: true });
const receipt = { runId, kind: verifySql ? 'sql-and-types-generation-only' : 'types-generation-only', fullVerification: false,
  sqlVerified: false, startedAt: new Date().toISOString(), steps: [], ok: false };
function save() {
  const path = join(directory, 'type-generation.json');
  writeFileSync(path + '.tmp', JSON.stringify(receipt, null, 2) + '\n');
  renameSync(path + '.tmp', path);
}
try {
  save();
  for (const args of [
    ['scripts/check-refactoring-plan.mjs'],
    ['scripts/test-booking-foundation.mjs', '--real-storage', '--keep', ...(verifySql ? [] : ['--prepare-only'])],
    ['scripts/generate-database-types.mjs', '--export']
  ]) {
    const result = await runVerificationProcess('node', args, { cwd: root, env: process.env, stdio: 'inherit', signal: controller.signal });
    receipt.steps.push({ name: args[0], status: result.status, signal: result.signal });
    save();
    if (controller.signal.aborted || result.error || result.status !== 0) throw new Error('Disposable type generation failed; application verification was not executed.');
  }
  if (verifySql) {
    const database = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8'));
    if (database.runId !== runId || database.sqlVerified !== true) throw new Error('SQL diagnostics did not produce the required complete receipt.');
    receipt.sqlVerified = true;
  }
  receipt.ok = true;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    receipt.cleanup = cleanupFixtureResources(runId);
    let database;
    try { database = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (database?.runId === runId) {
      let storage;
      try { storage = JSON.parse(readFileSync(fixturePath('storage.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (storage?.database === database.container) rmSync(fixturePath('storage.json'));
      rmSync(fixturePath('database.json'));
    }
  } catch (error) { receipt.ok = false; receipt.cleanupFailed = true; console.error(error.message); process.exitCode = 1; }
  receipt.finishedAt = new Date().toISOString();
  save();
  for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt);
  lease.release();
}
