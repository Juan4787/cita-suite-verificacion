import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repositoryRoot, 'apps', 'web');

const statusOutput = execFileSync(
	'pnpm',
	['exec', 'supabase', 'status', '-o', 'env'],
	{ cwd: repositoryRoot, encoding: 'utf8' }
);

const readStatusValue = (name) => {
	const match = statusOutput.match(new RegExp(`^${name}="([^"]*)"$`, 'm'));
	if (!match?.[1]) throw new Error(`Supabase local no informó ${name}.`);
	return match[1];
};

const apiUrl = readStatusValue('API_URL');
const databaseUrl = readStatusValue('DB_URL');
const anonKey = readStatusValue('ANON_KEY');
const serviceRoleKey = readStatusValue('SERVICE_ROLE_KEY');
const apiHost = new URL(apiUrl).hostname;
const databaseHost = new URL(databaseUrl).hostname;
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (!localHosts.has(apiHost) || !localHosts.has(databaseHost)) {
	throw new Error('Este ejecutor sólo puede usarse contra Supabase local.');
}

const runPsql = (statement) =>
	execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
		stdio: 'ignore'
	});

let testResult;
let revokeError;
try {
	// Fase 1 prohíbe la purga desde la aplicación. El E2E local necesita borrar
	// exclusivamente su fixture después de haber probado una carga real.
	runPsql('grant delete on table public.patient_radiographs to service_role');
	const requestedTests = process.argv.slice(2).filter((argument) => argument !== '--');
	testResult = spawnSync(
		'pnpm',
		[
			'exec',
			'playwright',
			'test',
			...(requestedTests.length > 0 ? requestedTests : []),
			'--workers=1'
		],
		{
			cwd: webRoot,
			stdio: 'inherit',
			env: {
				...process.env,
				E2E_ALLOW_DESTRUCTIVE: 'true',
				CITA_E2E_ENVIRONMENT: 'supabase-local',
				SUPABASE_DB_URL: databaseUrl,
				ODONTO_SUPABASE_URL: apiUrl,
				ODONTO_SUPABASE_ANON_KEY: anonKey,
				ODONTO_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
				PUBLIC_ODONTO_SUPABASE_URL: apiUrl,
				PUBLIC_ODONTO_SUPABASE_ANON_KEY: anonKey
			}
		}
	);
} finally {
	try {
		runPsql('revoke delete on table public.patient_radiographs from service_role');
	} catch (error) {
		revokeError = error;
	}
}

if (revokeError) {
	throw new Error('No se pudo revocar el permiso temporal del E2E local.', {
		cause: revokeError
	});
}
if (testResult?.error) throw testResult.error;
if (testResult?.status !== 0) process.exitCode = testResult?.status ?? 1;
