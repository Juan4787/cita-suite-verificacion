import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_REF, productionEnvironment, productionPsql } from './lib/production-database.mjs';

// The transition switch of the previous scheduler on production (migration 20261019010000).
// `off` makes the legacy job claims return nothing and the legacy job endpoints answer 410,
// whatever app version or caller reaches them; `on` restores them for a rollback; `status` only
// reads. The new scheduler's batch claims do not depend on it. The publication turns it off
// right after batch 1 (docs/architecture/publicacion-y-reversion.md). Every call leaves a receipt.
const root = fileURLToPath(new URL('../', import.meta.url));
const [action] = process.argv.slice(2);
if (!['status', 'off', 'on'].includes(action) || process.argv.length !== 3) throw new Error('Usage: production-legacy-jobs.mjs status|off|on');
const { database } = productionEnvironment(root);
const psql = (input) => productionPsql(database, input, { application: 'cita_suite_legacy_job_switch' })
	.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
const STATE = "select json_build_object('enabled', public.legacy_job_entrypoints_enabled(), 'updatedAt', " +
	'(select updated_at from private.scheduled_job_settings where singleton));';

const [{ exists }] = psql("begin transaction read only;\nselect json_build_object('exists', " +
	"to_regprocedure('public.set_legacy_job_entrypoints(boolean)') is not null);\ncommit;\n");
if (!exists) throw new Error('The switch does not exist yet: it arrives with batch 1 of the publication. Nothing was changed.');
const [before, after] = action === 'status'
	? psql(`begin transaction read only;\n${STATE}\ncommit;\n`)
	: psql(`begin;\nset local lock_timeout = '5s';\n${STATE}\nselect public.set_legacy_job_entrypoints(${action === 'on'});\n${STATE}\ncommit;\n`);
const receipt = { at: new Date().toISOString(), project: PRODUCTION_REF, action, before, after: after ?? before };
if (action !== 'status' && receipt.after.enabled !== (action === 'on')) throw new Error('The switch did not change. Check it with status.');
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, `.verification/production-legacy-jobs-${receipt.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
