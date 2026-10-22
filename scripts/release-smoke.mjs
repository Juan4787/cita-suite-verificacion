import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	capacityOwnersPassword, createRandom, exchange, findPublicSlot, login, pageData, practiceData, submitPublicBooking
} from './lib/capacity-load.mjs';
import { PRODUCTION_API_ORIGIN, productionEnvironment, productionKeys, readEnvFile } from './lib/production-database.mjs';
import { PRODUCTION_APP_ORIGIN } from './lib/production-deploy.mjs';
import { STAGING_PROJECT_REF, psqlDiagnostics, stagingConnection } from './lib/staging-database.mjs';
import { STAGING_APP_ORIGIN, stagingSupabaseKey } from './lib/staging-deploy.mjs';

// The release's smoke test on a deployed environment, after its deployment: a public booking and
// a clinical document, the two writes whose providers differ between environments. It works only
// on the synthetic practice `capacity-01`, which the capacity seed of that environment creates
// (staging-capacity.mjs or production-capacity.mjs `seed`), and logs in as its synthetic owner.
// 1. Booking: a free slot of the shared link is booked as a person books it, the management page
//    shows it, and it is cancelled from that page.
// 2. Document: the owner uploads a small PDF to one of the practice's synthetic patients through
//    the app (signed URL, completion), lists it, downloads it through an access grant with the
//    same bytes, and moves it to the trash. The counters must hold exactly its bytes.
// `cleanup` removes the smoke documents afterwards. Removing an object does not revoke its signed
// upload URL, and Storage accounting reserves 5 MB again until that URL expires (stage 3); so the
// cleanup waits for the expiration the run reports, then removes each object through the Storage
// API, releases the expired reservations as the system does, removes the rows, and requires the
// practice's counters at zero and the global ones moved exactly as the practice's did.
// Nothing is printed or kept beyond outcomes: no token, phone, key, URL or file content.
const root = fileURLToPath(new URL('../', import.meta.url));
const [target, mode = 'run'] = process.argv.slice(2);
if (!['staging', 'production'].includes(target) || !['run', 'cleanup'].includes(mode) || process.argv.length > 4)
	throw new Error('Usage: release-smoke.mjs staging|production [cleanup]');
const BUCKET = 'patient-clinical-files';
const FILENAME = 'prueba-de-humo.pdf';
const data = practiceData(1);

let origin, api, serviceKey, password, database;
if (target === 'staging') {
	const config = join(homedir(), '.config/cita-suite/staging');
	serviceKey = stagingSupabaseKey(JSON.parse(readFileSync(join(config, 'api-keys.json'), 'utf8')), 'service_role');
	[origin, api, password] = [STAGING_APP_ORIGIN, `https://${STAGING_PROJECT_REF}.supabase.co`, capacityOwnersPassword(serviceKey, 'staging')];
	database = stagingConnection(readEnvFile(join(config, 'connection.env')).CITA_STAGING_DATABASE_URL);
} else {
	const production = productionEnvironment(root);
	({ serviceKey } = productionKeys(production.env));
	const secret = readFileSync(join(homedir(), '.config/cita-suite/production/capacity-secret'), 'utf8').trim();
	if (secret.length < 32) throw new Error('The measurement secret is missing: run production-capacity.mjs secret and seed first. Nothing was done.');
	[origin, api, password, database] = [PRODUCTION_APP_ORIGIN, PRODUCTION_API_ORIGIN, capacityOwnersPassword(secret, 'production'), production.database];
}
const dbPassword = decodeURIComponent(database.password);
const sql = (text, { readOnly = true } = {}) => {
	const result = spawnSync('psql', ['-X', '-h', database.hostname, '-p', database.port, '-U', decodeURIComponent(database.username), '-d', 'postgres',
		'-v', 'ON_ERROR_STOP=1', '-Atq', '-f', '-'], {
		input: readOnly ? `begin transaction read only;\n${text}\ncommit;\n` : `begin;\nset local lock_timeout = '5s';\n${text}\ncommit;\n`,
		encoding: 'utf8', timeout: 120_000,
		env: { ...process.env, PGPASSWORD: dbPassword, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'cita_suite_release_smoke' }
	});
	if (result.error || result.status !== 0) throw new Error('The database query failed.\n' + psqlDiagnostics(result.stderr).replaceAll(dbPassword, '[secret]'));
	return result.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
};
const checks = [];
const check = (name, passed, detail = {}) => {
	checks.push({ name, passed: Boolean(passed), ...detail });
	if (!passed) throw new Error(`Release smoke failed: ${name} ${JSON.stringify(detail)}`);
};
const finish = (extra) => {
	const receipt = { at: new Date().toISOString(), target, mode, origin, practice: data.slug, checks, ...extra };
	mkdirSync(join(root, '.verification'), { recursive: true });
	writeFileSync(join(root, `.verification/release-smoke-${target}-${mode}-${receipt.at.replace(/[:.]/g, '-')}.json`), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify({ target, mode, passed: checks.length, ...extra }));
};

// The practice must be the synthetic one of the seed, with its synthetic owner and patient, and
// its only documents may be earlier smoke documents in the trash.
const [practice] = sql(`select json_build_object('slug', b.slug,
	'owner', exists(select 1 from public.business_users u join auth.users a on a.id = u.user_id
		where u.business_id = b.id and u.role = 'owner' and a.email = '${data.email}'),
	'patient', exists(select 1 from public.patients p where p.business_id = b.id and p.id = '${data.patient(1)}'),
	'otherDocuments', (select count(*) from public.patient_radiographs r where r.business_id = b.id
		and (r.original_filename is distinct from '${FILENAME}' or r.status <> 'trashed')))
	from public.businesses b where b.id = '${data.business}';`);
check('synthetic practice', practice?.slug === data.slug && practice.owner && practice.patient && practice.otherDocuments === 0,
	{ practice: practice ?? null });
const counters = () => sql(`select json_build_object(
	'global', (select json_build_object('used', used_bytes, 'reserved', reserved_bytes) from public.clinical_storage_budget where singleton),
	'practice', (select json_build_object('used', used_bytes, 'reserved', reserved_bytes) from public.clinical_business_storage_budget
		where business_id = '${data.business}'),
	'files', (select count(*) from public.patient_radiographs where business_id = '${data.business}'),
	'slots', (select count(*) from public.clinical_upload_slots where business_id = '${data.business}'));`)[0];

if (mode === 'cleanup') {
	const [listing] = sql(`select json_build_object('files', coalesce(json_agg(json_build_object('id', r.id, 'path', r.storage_path,
		'thumbnail', r.thumbnail_path, 'pendingUntil', (select max(s.expires_at) from public.clinical_upload_slots s
			where s.file_id = r.id and s.expires_at > clock_timestamp()))), '[]'::json))
		from public.patient_radiographs r where r.business_id = '${data.business}';`);
	const pending = listing.files.filter((file) => file.pendingUntil !== null);
	check('every signed upload URL expired', pending.length === 0, { cleanupAfter: pending.map((file) => file.pendingUntil).sort().at(-1) ?? null });
	const before = counters();
	const paths = listing.files.flatMap((file) => [file.path, file.thumbnail]).filter(Boolean);
	check('smoke documents of the practice', paths.every((path) => String(path).startsWith(`${data.business}/`)), { files: listing.files.length });
	if (paths.length) {
		const removed = await fetch(`${api}/storage/v1/object/${BUCKET}`, { method: 'DELETE', signal: AbortSignal.timeout(30_000),
			headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
			body: JSON.stringify({ prefixes: paths }) });
		check('objects removed through the Storage API', removed.ok, { status: removed.status });
	}
	const ids = listing.files.map((file) => `'${file.id}'`).join(',') || 'null';
	const [removedRows] = sql(`select private.release_expired_clinical_reservations();
	with gone as (delete from public.patient_radiographs r where r.id in (${ids}) and r.business_id = '${data.business}'
		and not exists(select 1 from public.clinical_upload_slots s where s.file_id = r.id) returning r.id)
	select json_build_object('rows', (select count(*) from gone),
		'objects', (select count(*) from storage.objects where bucket_id = '${BUCKET}' and name like '${data.business}/%'));`, { readOnly: false });
	check('rows and objects removed', removedRows.rows === listing.files.length && removedRows.objects === 0, removedRows);
	const after = counters();
	check('practice counters at zero', after.files === 0 && after.slots === 0 && after.practice.used === 0 && after.practice.reserved === 0, { after });
	check('global counters moved as the practice did',
		after.global.used - before.global.used === after.practice.used - before.practice.used &&
		after.global.reserved - before.global.reserved === after.practice.reserved - before.practice.reserved, { before, after });
	finish({ removedDocuments: listing.files.length });
	process.exit(0);
}

const kitRequire = createRequire(createRequire(join(root, 'apps/web/package.json')).resolve('@sveltejs/kit/package.json'));
const devalue = await import(pathToFileURL(kitRequire.resolve('devalue')).href);

// 1. A public booking from the shared link, then its cancellation from the management page.
// A random service and professional may have no free day: a few choices, as a person would try.
const random = createRandom(`release-smoke-${target}-${Date.now()}`);
let found = null;
for (let attempt = 0; attempt < 5 && !found; attempt++) found = await findPublicSlot({ origin, data, random, unflatten: devalue.unflatten });
check('free public slot', found !== null);
const phone = `+54911772${String(Date.now()).slice(-5)}`;
const booked = await exchange(submitPublicBooking(origin, data, found, 'Prueba de humo del release', phone));
const location = booked.body?.type === 'redirect' ? String(booked.body.location) : '';
const token = /^\/turno\/([^/?#]+)/.exec(location)?.[1];
check('public booking', Boolean(token), { status: booked.status, type: booked.body?.type ?? null });
const management = async () => pageData((await exchange((signal) => fetch(`${origin}/turno/${token}/__data.json`, { signal }))).body,
	devalue.unflatten)?.appointment ?? null;
const shown = await management();
check('management page shows the booking', shown && shown.status !== 'cancelled', { status: shown?.status ?? null });
const cancelled = await exchange((signal) => fetch(`${origin}/turno/${token}?/cancel`, { method: 'POST', redirect: 'manual', signal,
	headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ confirm_cancel: 'true' }) }));
check('cancellation from the management page', cancelled.body?.type === 'success', { status: cancelled.status, type: cancelled.body?.type ?? null });
check('management page shows the cancellation', (await management())?.status === 'cancelled');

// 2. A clinical document through the app, kept in the trash for the cleanup.
const before = counters();
const run = randomUUID();
const pdf = Buffer.from(['%PDF-1.4', `% Cita Suite release smoke ${run}`, '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
	'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj', '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj',
	'trailer<</Root 1 0 R>>', '%%EOF', ''].join('\n'));
const sha256 = createHash('sha256').update(pdf).digest('hex');
const jar = await login(origin, data.email, password);
const owner = (path, init = {}) => exchange((signal) => fetch(origin + path, { ...init, redirect: 'manual', signal,
	headers: { origin, cookie: jar.header(), accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } }));
const files = `/odonto/pacientes/${data.patient(1)}/radiografias`;
const started = await owner(`${files}/uploads`, { method: 'POST', body: JSON.stringify({ clientRequestId: run,
	originalFilename: FILENAME, mimeType: 'application/pdf', bytes: pdf.length, sha256, takenAt: null, note: null }) });
const fileId = started.body?.id;
check('upload prepared', started.status === 200 && fileId && started.body.upload_url && !started.body.thumbnail_upload_url,
	{ status: started.status, code: started.body?.code ?? null });
const form = new FormData();
form.append('cacheControl', '0');
form.append('', new Blob([pdf], { type: 'application/pdf' }));
const stored = await exchange((signal) => fetch(started.body.upload_url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal }));
check('file stored through the signed URL', stored.status >= 200 && stored.status < 300, { status: stored.status });
const completed = await owner(`${files}/${fileId}/complete`, { method: 'POST', body: JSON.stringify({ thumbnailUploaded: false }) });
check('upload completed', completed.status === 200 && completed.body?.ready === true, { status: completed.status, code: completed.body?.code ?? null });
const listed = await owner(files);
const item = listed.body?.items?.find((entry) => entry.id === fileId);
check('document listed', item?.status === 'ready' && Number(item.bytes) === pdf.length, { status: item?.status ?? null });
const grant = await owner(`${files}/${fileId}/access-grants`, { method: 'POST', body: '{}' });
const download = grant.body?.url ? await fetch(grant.body.url, { signal: AbortSignal.timeout(30_000) }) : null;
const downloaded = download?.ok ? Buffer.from(await download.arrayBuffer()) : Buffer.alloc(0);
check('document downloaded with the same bytes', createHash('sha256').update(downloaded).digest('hex') === sha256, { status: download?.status ?? grant.status });
const held = counters();
check('counters hold exactly the document',
	held.practice.used === before.practice.used + pdf.length && held.practice.reserved === before.practice.reserved &&
	held.global.used === before.global.used + pdf.length && held.global.reserved === before.global.reserved, { before, held });
const trashed = await owner(`${files}/${fileId}/trash`, { method: 'POST', body: '{}' });
check('document moved to the trash', trashed.status === 200, { status: trashed.status, code: trashed.body?.code ?? null });
const kept = counters();
check('the trash keeps its bytes', JSON.stringify(kept) === JSON.stringify(held), { held, kept });
const [slot] = sql(`select json_build_object('expiresAt', max(expires_at)) from public.clinical_upload_slots where file_id = '${fileId}';`);
finish({ cleanupAfter: slot.expiresAt });
