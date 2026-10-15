#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BOT_REPLY_TEMPLATE_BODY =
	'Hola. Somos {{business_name}}.\n\nPara sacar turno, entrá acá:\n{{booking_url}}\n\nAhí elegís servicio, profesional, día y horario disponible.\n\nPara hablar con una persona, escribí "asesor".';

const readEnv = () => {
	let current = process.cwd();
	for (let depth = 0; depth < 6; depth += 1) {
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

const parseArgs = () => {
	const args = process.argv.slice(2);
	const result = {};
	for (let i = 0; i < args.length; i += 1) {
		const item = args[i];
		if (!item.startsWith('--')) continue;
		const key = item.slice(2);
		if (key === 'paused' || key === 'dry-run' || key === 'help') {
			result[key] = true;
			continue;
		}
		result[key] = args[i + 1];
		i += 1;
	}
	return result;
};

const usage = () => {
	console.log(`
Uso:
  node apps/web/scripts/upsert-whatsapp-account.mjs \\
    --business consultorio-slug-o-id \\
    --phone "+54 9 ..." \\
    --phone-number-id "123456789012345" \\
    --waba-id "123456789012345" \\
    --display-name "Consultorio" \\
    --message "Hola. Para reservar: {{booking_url}}"

Opcionales:
  --token-secret WHATSAPP_ACCESS_TOKEN
  --message-file ./mensaje.txt
  --paused
  --dry-run
`);
};

const arg = parseArgs();
if (arg.help) {
	usage();
	process.exit(0);
}

const envFile = readEnv();
const env = { ...envFile, ...process.env };
const supabaseUrl = String(env.ODONTO_SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceRoleKey = String(env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? '');
if (!supabaseUrl || !serviceRoleKey) {
	console.error('Faltan ODONTO_SUPABASE_URL / ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	process.exit(1);
}

const businessKey = String(arg.business ?? '').trim();
const phone = String(arg.phone ?? '').trim();
const phoneNumberId = String(arg['phone-number-id'] ?? '').trim();
const wabaId = String(arg['waba-id'] ?? '').trim() || null;
const displayName = String(arg['display-name'] ?? '').trim() || null;
const tokenSecret = String(arg['token-secret'] ?? 'WHATSAPP_ACCESS_TOKEN').trim();
const message = arg['message-file']
	? fs.readFileSync(String(arg['message-file']), 'utf8').trim()
	: String(arg.message ?? DEFAULT_BOT_REPLY_TEMPLATE_BODY).trim();
const dryRun = Boolean(arg['dry-run']);

if (!businessKey || !phone || !phoneNumberId || !tokenSecret || !message) {
	usage();
	console.error('Faltan campos obligatorios: business, phone, phone-number-id, token-secret o message.');
	process.exit(1);
}

if (message.length > 1000) {
	console.error('El mensaje automático no puede superar 1000 caracteres.');
	process.exit(1);
}

const headers = {
	apikey: serviceRoleKey,
	authorization: `Bearer ${serviceRoleKey}`,
	'content-type': 'application/json'
};

const request = async (path, options = {}) => {
	const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
		...options,
		headers: { ...headers, ...(options.headers ?? {}) }
	});
	if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
	return response.status === 204 ? null : response.json();
};

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessKey);
const businessRows = await request(
	`businesses?${isUuid ? 'id' : 'slug'}=eq.${encodeURIComponent(businessKey)}&select=id,name,slug&limit=1`
);
const business = businessRows[0];
if (!business) {
	console.error(`No se encontró el consultorio "${businessKey}".`);
	process.exit(1);
}

const existingRows = await request(
	`messaging_accounts?business_id=eq.${business.id}&select=id,provider,status,phone_number,phone_number_id&order=created_at.asc&limit=1`
);
const existing = existingRows[0];
const now = new Date().toISOString();
const accountPayload = {
	business_id: business.id,
	provider: 'meta_cloud',
	status: arg.paused ? 'paused' : 'active',
	phone_number: phone,
	phone_number_id: phoneNumberId,
	waba_id: wabaId,
	display_name: displayName ?? business.name,
	access_token_secret_name: tokenSecret,
	bot_enabled: !arg.paused,
	reminders_enabled: false,
	updated_at: now
};

console.log(`Consultorio: ${business.name} (${business.slug ?? business.id})`);
console.log(`Cuenta: ${existing ? `actualizar ${existing.id}` : 'crear nueva'}`);
console.log(`Phone Number ID: ${phoneNumberId}`);
console.log(`Token env: ${tokenSecret}`);
console.log(`Estado: ${accountPayload.status}`);

if (dryRun) {
	console.log('Dry-run: no se aplicaron cambios.');
	process.exit(0);
}

if (existing?.id) {
	await request(`messaging_accounts?id=eq.${existing.id}&business_id=eq.${business.id}`, {
		method: 'PATCH',
		headers: { prefer: 'return=minimal' },
		body: JSON.stringify(accountPayload)
	});
} else {
	await request('messaging_accounts', {
		method: 'POST',
		headers: { prefer: 'return=minimal' },
		body: JSON.stringify({ ...accountPayload, created_at: now })
	});
}

await request('message_templates?on_conflict=business_id,name,language', {
	method: 'POST',
	headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
	body: JSON.stringify({
		business_id: business.id,
		provider: 'meta_cloud',
		name: 'bot_reply',
		category: 'service',
		language: 'es_AR',
		status: 'approved',
		body: message,
		updated_at: now,
		created_at: now
	})
});

await request(`businesses?id=eq.${business.id}`, {
	method: 'PATCH',
	headers: { prefer: 'return=minimal' },
	body: JSON.stringify({ whatsapp_enabled: !arg.paused })
});

console.log('Respuesta automática de WhatsApp configurada.');
