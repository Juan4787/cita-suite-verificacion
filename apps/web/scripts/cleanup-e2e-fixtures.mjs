// Limpieza de fixtures de prueba "E2E " que el flujo E2E (odonto.full.spec.ts)
// crea en la base. Por defecto SÓLO LISTA (dry-run). Para borrar de verdad:
//   node scripts/cleanup-e2e-fixtures.mjs --apply
//
// Lee ODONTO_SUPABASE_URL y ODONTO_SUPABASE_SERVICE_ROLE_KEY del .env de la raíz.
// Patrón acotado: nombres que empiezan con "E2E " (ej. "E2E Profesional 178...",
// "E2E Paciente 178...", "E2E Limpieza 178..."). Ningún dato real usa ese prefijo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const readEnv = () => {
	let current = path.resolve(__dirname, '..');
	for (let depth = 0; depth < 5; depth += 1) {
		const candidate = path.join(current, '.env');
		if (fs.existsSync(candidate)) {
			const env = {};
			for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
				const t = line.trim();
				if (!t || t.startsWith('#') || !t.includes('=')) continue;
				const i = t.indexOf('=');
				let v = t.slice(i + 1).trim();
				if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
				env[t.slice(0, i).trim()] = v;
			}
			return env;
		}
		current = path.dirname(current);
	}
	return {};
};

const env = readEnv();
const URL = process.env.ODONTO_SUPABASE_URL ?? env.ODONTO_SUPABASE_URL;
const KEY = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
	console.error('Faltan ODONTO_SUPABASE_URL / ODONTO_SUPABASE_SERVICE_ROLE_KEY en .env');
	process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

const get = async (p) => {
	const r = await fetch(`${URL}/rest/v1/${p}`, { headers: H });
	if (!r.ok) throw new Error(`GET ${p}: ${await r.text()}`);
	return r.json();
};
const del = async (p) => {
	if (!APPLY) return;
	const r = await fetch(`${URL}/rest/v1/${p}`, { method: 'DELETE', headers: { ...H, prefer: 'return=minimal' } });
	if (!r.ok) throw new Error(`DELETE ${p}: ${await r.text()}`);
};

const inList = (ids) => `(${ids.join(',')})`;
// PostgREST espera el comodín SQL codificado como `%25`; `*` se interpreta como
// texto literal y deja residuos aunque el script termine sin error.
const E2E_LIKE = 'E2E%25';

const run = async () => {
	const profs = await get(`professionals?name=ilike.${E2E_LIKE}&select=id,name`);
	const services = await get(`services?name=ilike.${E2E_LIKE}&select=id,name`);
	const patients = await get(`patients?full_name=ilike.${E2E_LIKE}&select=id,full_name`);
	const profIds = profs.map((p) => p.id);
	const patientIds = patients.map((p) => p.id);

	console.log(`\n=== Fixtures E2E encontradas ===`);
	console.log(`profesionales: ${profs.length}`, profs.map((p) => p.name));
	console.log(`servicios:     ${services.length}`, services.map((s) => s.name));
	console.log(`pacientes:     ${patients.length}`, patients.map((p) => p.full_name));

	if (!APPLY) {
		console.log(`\n(DRY-RUN) Nada borrado. Para borrar: node scripts/cleanup-e2e-fixtures.mjs --apply\n`);
		return;
	}

	if (profIds.length) await del(`appointments?professional_id=in.${inList(profIds)}`);
	if (patientIds.length) await del(`appointments?patient_id=in.${inList(patientIds)}`);
	if (profIds.length) await del(`availability_rules?professional_id=in.${inList(profIds)}`);
	if (profIds.length) await del(`professional_services?professional_id=in.${inList(profIds)}`);
	if (patientIds.length) await del(`professional_patient_links?patient_id=in.${inList(patientIds)}`);
	if (profIds.length) await del(`professional_patient_links?professional_id=in.${inList(profIds)}`);
	await del(`services?name=ilike.${E2E_LIKE}`);
	await del(`professionals?name=ilike.${E2E_LIKE}`);
	await del(`patients?full_name=ilike.${E2E_LIKE}`);
	console.log(`\n✅ Limpieza aplicada.\n`);
};

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
