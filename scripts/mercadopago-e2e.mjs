// Prueba de punta a punta de los cobros de Mercado Pago contra producción mientras usa credenciales de
// prueba: sin dinero real, con un consultorio sintético propio. Plan y resultados:
// docs/plans/cobros-mercadopago-20261118.md. Las escrituras exigen --produccion.
//
//   node scripts/mercadopago-e2e.mjs firma --produccion       aviso firmado con la clave del .env local
//   node scripts/mercadopago-e2e.mjs sin-firma --produccion   sin firma, firma ajena y firma vieja: 401
//   node scripts/mercadopago-e2e.mjs crear --produccion       consultorio y dueño sintéticos, restringidos
//   node scripts/mercadopago-e2e.mjs estado                   acceso, asientos, suscripciones y avisos
//   node scripts/mercadopago-e2e.mjs autorizar --produccion [--titular APRO|OTHE|FUND]
//   node scripts/mercadopago-e2e.mjs precio <pesos> --produccion | precio --quitar --produccion
//   node scripts/mercadopago-e2e.mjs archivar --produccion
//
// El correo y la contraseña del dueño sintético se guardan sólo en
// ~/.local/share/cita-suite/mercadopago-e2e/estado.json (permiso 600); nunca se imprimen.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { PRODUCTION_API_ORIGIN, productionKeys, readEnvFile } from './lib/production-database.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readEnvFile(join(root, '.env'));
const APP = 'https://app.cita-suite.com.ar';
const WEBHOOK = `${APP}/api/mercadopago/webhook`;
const MP_API = 'https://api.mercadopago.com';
const STATE_DIR = join(homedir(), '.local/share/cita-suite/mercadopago-e2e');
const STATE_FILE = join(STATE_DIR, 'estado.json');

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name, fallback) => { const i = rest.indexOf(name); return i === -1 ? fallback : rest[i + 1]; };
const fail = (message) => { console.error(message); process.exit(1); };
const requireProduction = () => { if (!flag('--produccion')) fail('Este subcomando escribe en producción: agregá --produccion.'); };

const admin = () => {
	const { serviceKey } = productionKeys(env);
	return createClient(PRODUCTION_API_ORIGIN, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
};
const must = async (promise, what) => {
	const { data, error } = await promise;
	if (error) fail(`${what}: ${error.message}`);
	return data;
};
const readState = () => existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null;
const writeState = (state) => {
	mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
	chmodSync(STATE_DIR, 0o700);
	writeFileSync(STATE_FILE, JSON.stringify(state, null, '\t') + '\n', { mode: 0o600 });
	chmodSync(STATE_FILE, 0o600);
};
const mpToken = () => {
	const token = env.MP_ACCESS_TOKEN?.trim();
	if (!token?.startsWith('TEST-')) fail('La prueba usa sólo el token de prueba (TEST-) del .env local.');
	return token;
};

// Un aviso como los de Mercado Pago, firmado con la clave que se indique.
const signedPost = async ({ dataId, type, secret, tsMs = Date.now(), requestId = randomUUID(), signed = true }) => {
	const headers = { 'content-type': 'application/json', 'x-request-id': requestId };
	if (signed) {
		const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${tsMs};`;
		headers['x-signature'] = `ts=${tsMs},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
	}
	const response = await fetch(`${WEBHOOK}?data.id=${encodeURIComponent(dataId)}&type=${encodeURIComponent(type)}`, {
		method: 'POST', headers, body: JSON.stringify({ action: 'auditoria', type, live_mode: false, data: { id: dataId } }),
		signal: AbortSignal.timeout(20_000)
	});
	return { status: response.status, body: (await response.text()).slice(0, 200) };
};

const commands = {
	async firma() {
		requireProduction();
		const secret = env.MP_WEBHOOK_SECRET?.trim();
		if (!secret) fail('El .env local no tiene MP_WEBHOOK_SECRET.');
		// Un tópico sin manejador: la app sólo registra el aviso, sin consultar a Mercado Pago ni pedir atención.
		const result = await signedPost({ dataId: `auditoria-firma-${Date.now()}`, type: 'auditoria_firma', secret });
		console.log(`aviso firmado con la clave del .env local -> HTTP ${result.status} ${result.body}`);
		console.log(result.status === 200 ? 'La clave del Worker de producción es la misma que la del .env local.' : 'La clave del Worker de producción NO es la del .env local (o el Worker no tiene clave).');
	},
	async 'sin-firma'() {
		requireProduction();
		const secret = env.MP_WEBHOOK_SECRET?.trim() ?? '';
		const cases = [
			['sin x-signature', { signed: false, secret }],
			['firmado con otra clave', { secret: randomBytes(32).toString('hex') }],
			['firma correcta de hace 11 minutos', { secret, tsMs: Date.now() - 11 * 60 * 1000 }]
		];
		for (const [label, opts] of cases) {
			const result = await signedPost({ dataId: `auditoria-rechazo-${Date.now()}`, type: 'payment', ...opts });
			console.log(`${label} -> HTTP ${result.status} ${result.body}`);
		}
	},
	async crear() {
		requireProduction();
		const previous = readState();
		if (previous && !previous.archivedAt && !flag('--nuevo')) fail(`Ya hay un consultorio sintético sin archivar (${previous.businessId}). Usá «archivar» o --nuevo.`);
		const db = admin();
		const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
		const tag = randomBytes(2).toString('hex');
		const email = `citasuite+mp-e2e-${day}-${tag}@gmail.com`;
		const password = `${randomBytes(18).toString('base64url')}Aa1!`;
		const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
		if (created.error || !created.data.user?.id) fail(`No se creó el usuario sintético: ${created.error?.message}`);
		const userId = created.data.user.id;
		const business = await must(db.from('businesses').insert({
			name: `Prueba Mercado Pago ${day.slice(6, 8)}-${day.slice(4, 6)} ${tag}`,
			slug: `prueba-mercadopago-${day}-${tag}`,
			slug_follows_name: false,
			industry: 'odontology',
			timezone: 'America/Argentina/Cordoba',
			email,
			public_booking_enabled: false,
			is_active: true
		}).select('id, slug').single(), 'No se creó el consultorio');
		await must(db.from('allowed_emails').upsert({ email, enabled: true }, { onConflict: 'email' }), 'No se habilitó el correo');
		await must(db.from('business_users').insert({
			business_id: business.id, user_id: userId, role: 'owner', status: 'active', accepted_at: new Date().toISOString()
		}), 'No se asoció el dueño');
		// Igual que un alta propia que todavía no pagó: restringido, sin vencimiento previo.
		await must(db.from('business_subscriptions').upsert({
			business_id: business.id, commercial_access_enabled: true, is_permanent: false, subscription_status: 'restricted',
			paid_until: null, grace_until: null, restricted_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
			archived_at: null, last_payment_at: null
		}, { onConflict: 'business_id' }), 'No se creó la suscripción comercial');
		writeState({ email, password, userId, businessId: business.id, slug: business.slug, createdAt: new Date().toISOString(), archivedAt: null });
		console.log(`consultorio sintético ${business.id} (${business.slug}) con su dueño; credenciales en ${STATE_FILE}`);
	},
	async estado() {
		const state = readState();
		if (!state) fail('No hay consultorio sintético registrado.');
		const db = admin();
		const sub = await must(db.from('business_subscriptions').select('commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at, last_payment_at, last_payment_amount, access_source, mp_price_ars').eq('business_id', state.businessId).maybeSingle(), 'Suscripción comercial');
		console.log(`consultorio ${state.businessId} | creado ${state.createdAt}${state.archivedAt ? ` | archivado ${state.archivedAt}` : ''}`);
		console.log('acceso comercial:', JSON.stringify(sub));
		const grants = await must(db.from('access_grants').select('created_at, operation, source, amount, duration_seconds, idempotency_key, paid_until_before, paid_until_after, status_before, status_after, note').eq('business_id', state.businessId).order('created_at'), 'Asientos');
		console.log(`asientos (${grants.length}):`);
		for (const g of grants) console.log(`  ${g.created_at} | ${g.operation} | ${g.source} | monto ${g.amount ?? '-'} | ${g.duration_seconds ?? '-'} s | clave ${g.idempotency_key} | vence ${g.paid_until_before ?? '-'} -> ${g.paid_until_after ?? '-'} | ${g.status_before} -> ${g.status_after} | ${g.note ?? ''}`);
		const subs = await must(db.from('mp_subscriptions').select('preapproval_id, status, transaction_amount, currency_id, next_charge_at, created_at, last_synced_at').eq('business_id', state.businessId).order('created_at'), 'Suscripciones de Mercado Pago');
		console.log(`suscripciones de Mercado Pago (${subs.length}):`);
		for (const s of subs) console.log(`  ${s.created_at} | ${s.preapproval_id} | ${s.status} | ${s.transaction_amount} ${s.currency_id} | próximo cobro ${s.next_charge_at ?? '-'} | sincronizada ${s.last_synced_at}`);
		const events = await must(db.from('mp_webhook_events').select('received_at, topic, action, resource_id, processing_status, signature_valid, requires_attention, live_mode, business_id, processing_detail').gte('received_at', state.createdAt).order('received_at'), 'Avisos');
		console.log(`avisos desde la creación (${events.length}):`);
		for (const e of events) console.log(`  ${e.received_at} | ${e.topic} | ${e.action ?? '-'} | ${e.resource_id ?? '-'} | ${e.processing_status} | firma ${e.signature_valid} | atención ${e.requires_attention} | live ${e.live_mode} | ${e.business_id === state.businessId ? 'este consultorio' : e.business_id ? 'OTRO consultorio' : 'sin consultorio'} | ${(e.processing_detail ?? '').slice(0, 220)}`);
	},
	async autorizar() {
		requireProduction();
		const state = readState();
		if (!state || state.archivedAt) fail('No hay consultorio sintético activo.');
		const token = mpToken();
		const db = admin();
		const pending = await must(db.from('mp_subscriptions').select('preapproval_id').eq('business_id', state.businessId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1), 'Suscripción pendiente');
		if (!pending.length) fail('El consultorio sintético no tiene una suscripción pendiente.');
		const titular = option('--titular', 'APRO');
		const cardResponse = await fetch(`${MP_API}/v1/card_tokens`, {
			method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ card_number: '5031755734530604', expiration_month: 11, expiration_year: 2030, security_code: '123',
				cardholder: { name: titular, identification: { type: 'DNI', number: '12345678' } } }),
			signal: AbortSignal.timeout(15_000)
		});
		const card = await cardResponse.json().catch(() => ({}));
		console.log(`token de tarjeta de prueba (titular ${titular}) -> HTTP ${cardResponse.status}${card.id ? '' : ` ${JSON.stringify(card).slice(0, 300)}`}`);
		if (!card.id) process.exit(1);
		const id = pending[0].preapproval_id;
		const response = await fetch(`${MP_API}/preapproval/${encodeURIComponent(id)}`, {
			method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ card_token_id: card.id, status: 'authorized' }), signal: AbortSignal.timeout(15_000)
		});
		const body = await response.json().catch(() => ({}));
		console.log(`autorizar ${id} -> HTTP ${response.status} | estado ${body.status ?? '-'}${response.ok ? '' : ` | ${JSON.stringify(body).slice(0, 400)}`}`);
	},
	// Repite con el token de prueba local la creación que hace la app (mismo cuerpo) e imprime la respuesta
	// de Mercado Pago, que la app no registra. Si se crea, se cancela en el acto.
	// --pagador <correo> y --monto <número> prueban variantes.
	async 'probar-creacion'() {
		requireProduction();
		const state = readState();
		if (!state) fail('No hay consultorio sintético registrado.');
		const token = mpToken();
		const body = {
			reason: 'Cita Suite — Suscripción mensual', external_reference: state.businessId,
			payer_email: option('--pagador', state.email),
			back_url: `${APP}/odonto/pago/procesando?mp=retorno`,
			auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(option('--monto', '50000')), currency_id: 'ARS' },
			status: 'pending'
		};
		const response = await fetch(`${MP_API}/preapproval`, {
			method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'X-Idempotency-Key': randomUUID() },
			body: JSON.stringify(body), signal: AbortSignal.timeout(15_000)
		});
		const data = await response.json().catch(() => ({}));
		const pagador = body.payer_email === state.email ? 'el dueño sintético' : 'el indicado';
		console.log(`crear (pagador: ${pagador}, monto ${body.auto_recurring.transaction_amount}) -> HTTP ${response.status}`);
		if (!response.ok) { console.log(JSON.stringify({ message: data.message, error: data.error, status: data.status, cause: data.cause }, null, 1).slice(0, 1500)); return; }
		console.log(`creada ${data.id} | estado ${data.status} | página de pago ${data.init_point ? new URL(data.init_point).host : '-'}`);
		const cancel = await fetch(`${MP_API}/preapproval/${encodeURIComponent(data.id)}`, {
			method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'cancelled' }), signal: AbortSignal.timeout(15_000)
		});
		console.log(`cancelada en el acto -> HTTP ${cancel.status}`);
	},
	// Cancela en Mercado Pago, con el token de prueba local, una suscripción del entorno de prueba.
	async cancelar() {
		requireProduction();
		const token = mpToken();
		const id = rest.find((value) => !value.startsWith('--'));
		if (!id) fail('Indicá el identificador de la suscripción.');
		const response = await fetch(`${MP_API}/preapproval/${encodeURIComponent(id)}`, {
			method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ status: 'cancelled' }), signal: AbortSignal.timeout(15_000)
		});
		const body = await response.json().catch(() => ({}));
		console.log(`cancelar ${id} -> HTTP ${response.status} | estado ${body.status ?? '-'}${response.ok ? '' : ` | ${body.message ?? ''}`}`);
	},
	// Lee en Mercado Pago (sólo GET, token de prueba local) una suscripción y sus cobros.
	async consultar() {
		const token = mpToken();
		const id = rest.find((value) => !value.startsWith('--'));
		if (!id) fail('Indicá el identificador de la suscripción.');
		const get = async (path) => {
			const response = await fetch(`${MP_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
			return { status: response.status, body: await response.json().catch(() => ({})) };
		};
		const pre = await get(`/preapproval/${encodeURIComponent(id)}`);
		const b = pre.body;
		console.log(`suscripción ${id} -> HTTP ${pre.status} | estado ${b.status} | referencia ${b.external_reference} | próximo cobro ${b.next_payment_date ?? '-'} | monto ${b.auto_recurring?.transaction_amount} ${b.auto_recurring?.currency_id} | resumen ${JSON.stringify(b.summarized ?? {})}`);
		const charges = await get(`/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}&limit=50`);
		console.log(`cobros -> HTTP ${charges.status} | ${charges.body.paging ? JSON.stringify(charges.body.paging) : ''}`);
		for (const c of charges.body.results ?? []) console.log(`  cobro ${c.id} | estado ${c.status} | reintento ${c.retry_attempt ?? '-'} | próximo intento ${c.next_retry_date ?? '-'} | débito ${c.debit_date ?? '-'} | pago ${c.payment?.id ?? '-'} ${c.payment?.status ?? '-'} ${c.payment?.status_detail ?? ''} | referencia ${c.external_reference ?? '-'}`);
		for (const c of (charges.body.results ?? []).filter((x) => x.payment?.id)) {
			const pay = await get(`/v1/payments/${c.payment.id}`);
			const p = pay.body;
			console.log(`  pago ${c.payment.id} -> HTTP ${pay.status} | ${p.status} ${p.status_detail} | referencia externa ${p.external_reference ?? '(vacía)'} | metadatos ${JSON.stringify(p.metadata ?? {})} | operación ${p.operation_type} | monto ${p.transaction_amount} ${p.currency_id} | live ${p.live_mode}`);
		}
	},
	// Cambia el correo del dueño sintético (cuenta, lista de permitidos y consultorio) por uno sin «+»:
	// Mercado Pago rechaza como pagador un correo con «+» (sección 5 del plan).
	async 'cambiar-correo'() {
		requireProduction();
		const state = readState();
		if (!state || state.archivedAt) fail('No hay consultorio sintético activo.');
		const email = option('--correo', '');
		if (!/^[a-z0-9.]+@gmail\.com$/.test(email)) fail('Indicá --correo con una dirección de gmail.com sin «+».');
		const db = admin();
		const updated = await db.auth.admin.updateUserById(state.userId, { email, email_confirm: true });
		if (updated.error) fail(`No se cambió el correo de la cuenta: ${updated.error.message}`);
		await must(db.from('allowed_emails').upsert({ email, enabled: true }, { onConflict: 'email' }), 'No se habilitó el correo nuevo');
		await must(db.from('allowed_emails').update({ enabled: false }).eq('email', state.email), 'No se deshabilitó el correo anterior');
		await must(db.from('businesses').update({ email }).eq('id', state.businessId), 'No se cambió el correo del consultorio');
		writeState({ ...state, previousEmail: state.email, email });
		console.log('correo del dueño sintético cambiado (sin mostrarlo); el anterior quedó deshabilitado');
	},
	// Precio propio del consultorio sintético, para la prueba con dinero real a un precio simbólico
	// (decisión de Juan del 18-nov-2026). Sólo ese consultorio, cuyo identificador sale del estado privado,
	// y sólo un precio simbólico: no sirve para fijar el precio de un consultorio real.
	async precio() {
		requireProduction();
		const state = readState();
		if (!state || state.archivedAt) fail('No hay consultorio sintético activo.');
		const value = rest.find((item) => !item.startsWith('--'));
		const clear = flag('--quitar');
		if (clear === Boolean(value)) fail('Uso: precio <pesos> --produccion | precio --quitar --produccion');
		const amount = clear ? null : Number(value);
		if (!clear && !(Number.isFinite(amount) && amount > 0 && amount <= 1000)) {
			fail('El precio de prueba tiene que ser mayor que 0 y de 1.000 pesos como máximo.');
		}
		const db = admin();
		const updated = await must(db.from('business_subscriptions').update({ mp_price_ars: amount }).eq('business_id', state.businessId).select('business_id, mp_price_ars'), 'No se cargó el precio');
		if (!Array.isArray(updated) || updated.length !== 1) fail('El precio no quedó cargado en exactamente un consultorio.');
		console.log(`consultorio ${state.businessId}: ${clear ? 'sin precio propio (rige el general)' : `precio propio ${updated[0].mp_price_ars} pesos por mes`}`);
	},
	async archivar() {
		requireProduction();
		const state = readState();
		if (!state || state.archivedAt) fail('No hay consultorio sintético activo.');
		const db = admin();
		await must(db.rpc('grant_business_access', {
			p_business_id: state.businessId, p_operation: 'archive_business', p_duration_seconds: null, p_duration_unit: null,
			p_is_permanent: false, p_amount: null, p_source: 'internal',
			p_note: 'Consultorio sintético de la prueba de punta a punta de Mercado Pago, archivado al terminar (docs/plans/cobros-mercadopago-20261118.md).',
			p_admin_id: null, p_admin_email: null, p_idempotency_key: `e2e-mercadopago:archivar:${state.businessId}`
		}), 'No se archivó el consultorio');
		await must(db.from('allowed_emails').update({ enabled: false }).eq('email', state.email), 'No se deshabilitó el correo');
		writeState({ ...state, archivedAt: new Date().toISOString() });
		console.log(`consultorio ${state.businessId} archivado y su correo deshabilitado`);
	}
};

if (!commands[command]) fail(`Subcomando desconocido. Opciones: ${Object.keys(commands).join(', ')}`);
await commands[command]();
