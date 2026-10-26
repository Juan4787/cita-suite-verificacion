import { createHash, createHmac, randomUUID } from 'node:crypto';

// Virtual users of the capacity scenarios: one per practice, logged in once through
// the app's own login, 80 % reads and 20 % internal writes with pauses of three to
// eight seconds, over the synthetic data of scripts/capacity/seed-practices.sql.
export const OPERATIONS = Object.freeze([
	{ name: 'agenda_day', category: 'read', weight: 20 },
	{ name: 'agenda_week', category: 'read', weight: 8 },
	{ name: 'patient_search', category: 'read', weight: 14 },
	{ name: 'patient_list', category: 'read', weight: 8 },
	{ name: 'patient_detail', category: 'read', weight: 14 },
	{ name: 'patient_history', category: 'read', weight: 6 },
	{ name: 'appointment_detail', category: 'read', weight: 5 },
	{ name: 'availability', category: 'read', weight: 5 },
	{ name: 'create_appointment', category: 'write', weight: 8 },
	{ name: 'cancel_appointment', category: 'write', weight: 5 },
	{ name: 'add_clinical_entry', category: 'write', weight: 7 }
]);
const totalWeight = OPERATIONS.reduce((sum, operation) => sum + operation.weight, 0);
if (totalWeight !== 100) throw new Error('Capacity operation weights must add up to 100.');

// The plan's acceptance criteria for this scenario.
export const ACCEPTANCE = Object.freeze({
	read: { p95: 1000, p99: 2000 }, write: { p95: 1500, p99: 3000 }, maximumErrorRate: 0.01
});

/** Deterministic generator: the same seed gives the same sequence of choices. */
export function createRandom(seed) {
	let state = Number.parseInt(createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

export function pickOperation(random) {
	let threshold = random() * totalWeight;
	for (const operation of OPERATIONS) {
		threshold -= operation.weight;
		if (threshold < 0) return operation;
	}
	return OPERATIONS.at(-1);
}

/** Cookies of one session, updated from every response like a browser would. */
export class CookieJar {
	#cookies = new Map();
	absorb(response) {
		for (const header of response.headers.getSetCookie()) {
			const [pair, ...attributes] = header.split(';');
			const separator = pair.indexOf('=');
			if (separator < 1) continue;
			const name = pair.slice(0, separator).trim();
			const value = pair.slice(separator + 1).trim();
			const expired = value === '' || attributes.some(attribute => /^\s*max-age\s*=\s*0\s*$/i.test(attribute) ||
				(/^\s*expires\s*=/i.test(attribute) && Date.parse(attribute.split('=').slice(1).join('=')) <= Date.now()));
			if (expired) this.#cookies.delete(name);
			else this.#cookies.set(name, value);
		}
	}
	has(name) { return this.#cookies.has(name); }
	header() { return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
}

/**
 * The synthetic owners' password of a hosted capacity run, derived from that environment's own secret
 * (staging: its service key; production: the measurement secret). It is never stored.
 */
export const capacityOwnersPassword = (secret, environment) =>
	createHmac('sha256', secret).update(`cita-suite-${environment}-capacity-owners`).digest('base64url');

/** The deterministic ids of the seed: an MD5 shaped as a valid version-4 UUID (pg_temp.capacity_uuid). */
export const uuidFrom = text => {
	const hex = createHash('md5').update(text).digest('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};

/** The synthetic data a virtual user of practice `practice` works with. */
export function practiceData(practice) {
	const tag = String(practice).padStart(2, '0');
	return {
		practice,
		email: `capacity-owner-${tag}@example.test`,
		slug: `capacity-${tag}`,
		// The shared link /reservar/<slug> redirects here: the canonical public page.
		business: uuidFrom(`capacity-practice-${practice}`),
		integrationKey: createHash('md5').update(`capacity-integration-${practice}`).digest('hex'),
		professionals: [1, 2, 3].map(k => uuidFrom(`capacity-professional-${practice}-${k}`)),
		services: [1, 2, 3, 4, 5].map(k => uuidFrom(`capacity-service-${practice}-${k}`)),
		patient: index => uuidFrom(`capacity-patient-${practice}-${index}`),
		appointment: index => uuidFrom(`capacity-appointment-${practice}-${index}`)
	};
}

/**
 * Removes the synthetic owners of the capacity practices through the Auth admin API,
 * once their practices are gone. Each id is the deterministic one of its practice,
 * and an account is removed only while it carries that practice's synthetic email.
 * `request(path, init)` calls the admin API under /auth/v1/admin.
 */
export async function removeCapacityOwners({ practices, request }) {
	let removed = 0;
	for (let practice = 1; practice <= practices; practice++) {
		const id = uuidFrom('capacity-owner-' + practice);
		const found = await request('/users/' + id);
		if (found.status === 404) continue;
		const user = await found.json().catch(() => null);
		if (!found.ok || user?.id !== id) throw new Error(`Could not read capacity owner ${practice} (HTTP ${found.status}).`);
		if (user.email !== practiceData(practice).email)
			throw new Error(`The account ${id} is not the synthetic owner of practice ${practice}; stopped before removing it.`);
		const deleted = await request('/users/' + id, { method: 'DELETE' });
		if (!deleted.ok && deleted.status !== 404) throw new Error(`Could not remove capacity owner ${practice} (HTTP ${deleted.status}).`);
		removed++;
	}
	return removed;
}

/**
 * Isolation and double booking after the load, over the synthetic practices: every
 * appointment their owners created belongs to the owner's own practice, and no active
 * appointment of a professional starts before an earlier one of theirs has ended. An
 * ordered window instead of a pairwise join, so it stays short on a hosted project.
 */
export const INTEGRITY_SQL = `with capacity as (select id from public.businesses where slug like 'capacity-%'),
active as (select a.blocking_starts_at,max(a.blocking_ends_at) over (partition by a.business_id,a.professional_id
  order by a.blocking_starts_at,a.id rows between unbounded preceding and 1 preceding) as previous_end
 from public.appointments a where a.business_id in (select id from capacity) and a.status in ('reserved','confirmed','reschedule_requested'))
select jsonb_build_object(
 'crossPractice',(select count(*) from public.appointments a join public.business_users u on u.user_id=a.created_by_user_id
   where a.created_at>now()-interval '2 hours' and u.role='owner' and u.business_id in (select id from capacity) and u.business_id<>a.business_id),
 'overlaps',(select count(*) from active where previous_end>blocking_starts_at),
 'createdByLoad',(select count(*) from public.appointments where business_id in (select id from capacity)
   and created_at>now()-interval '2 hours' and created_by_user_id is not null),
 'entriesByLoad',(select count(*) from public.clinical_entries where business_id in (select id from capacity) and description='Control de capacidad'))::text`;

/**
 * Whether a cleanup removed exactly the synthetic scenario: every practice and owner,
 * at least the seeded patients and appointments (the load and the public bookings add
 * their own to the same practices) and nothing of them left behind.
 */
export function evaluateCleanup({ practices, removed, ownersRemoved, remaining }) {
	return removed.practices === practices && removed.patients >= 6000 * practices && removed.appointments >= 12000 * practices &&
		ownersRemoved === practices && remaining.practices === 0 && remaining.owners === 0;
}

const SEARCH_TERMS = ['Acosta', 'Benítez', 'García', 'Martínez', 'Pereyra', 'Sosa', 'Torres', 'Vega', 'Ruiz', 'Luna',
	'Ana', 'Carla', 'Diego', 'María', 'Pablo', 'Valeria', 'Lucas', 'gar', 'mar', 'sos'];

// Dates and times as the practice sees them (the seed uses this zone).
const ZONE = 'America/Argentina/Buenos_Aires';
const zoned = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
	hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = date => Object.fromEntries(zoned.formatToParts(date).map(part => [part.type, part.value]));
export const localDate = (now, offsetDays = 0) => {
	const value = parts(new Date(now.getTime() + offsetDays * 86_400_000));
	return `${value.year}-${value.month}-${value.day}`;
};
export const localDateTime = now => {
	const value = parts(now);
	return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
};

/** A request of one operation; writes may first read what they need, like the UI. */
export function planOperation(operation, data, random, state, now = new Date()) {
	const integer = limit => Math.floor(random() * limit);
	const patient = () => data.patient(integer(6000));
	switch (operation.name) {
		case 'agenda_day': return { path: `/odonto/agenda/__data.json?date=${localDate(now, integer(41) - 20)}` };
		case 'agenda_week': return { path: `/odonto/agenda/semana/__data.json?date=${localDate(now, integer(41) - 20)}` };
		case 'patient_search': return { path: `/odonto/pacientes/buscar?q=${encodeURIComponent(SEARCH_TERMS[integer(SEARCH_TERMS.length)])}` };
		case 'patient_list': return { path: '/odonto/pacientes/lista' };
		case 'patient_detail': return { path: `/odonto/pacientes/${patient()}/__data.json` };
		case 'patient_history': return { path: `/odonto/pacientes/${patient()}/historial` };
		case 'appointment_detail': return { path: `/odonto/turnos/${data.appointment(1 + integer(12000))}/__data.json` };
		case 'availability': {
			const from = localDate(now, integer(20));
			return { path: `/odonto/disponibilidad/slots?service_id=${data.services[integer(5)]}&professional_id=${data.professionals[integer(3)]}&from=${from}&to=${from}` };
		}
		case 'create_appointment': {
			const professional = data.professionals[integer(3)];
			const service = data.services[integer(5)];
			const from = localDate(now, 1 + integer(30));
			return {
				prepare: `/odonto/disponibilidad/slots?service_id=${service}&professional_id=${professional}&from=${from}&to=${from}`,
				path: '/odonto/agenda?/create_appointment',
				form: slot => ({ service_id: service, professional_id: professional, date: slot.date, time: slot.time,
					patient_mode: 'existing', patient_id: patient(), idempotency_key: randomUUID() })
			};
		}
		case 'cancel_appointment': {
			const created = state.created.pop();
			return created
				? { path: `/odonto/turnos/${created}?/update_status`, form: () => ({ status: 'cancelled' }) }
				: { path: `/odonto/turnos/${data.appointment(1 + integer(12000))}/__data.json`, substitute: 'appointment_detail' };
		}
		case 'add_clinical_entry':
			return { path: `/odonto/pacientes/${patient()}?/add_entry`,
				form: () => ({ entry_type: 'Consulta', description: 'Control de capacidad', created_at: localDateTime(now) }) };
		default: throw new Error('Unknown capacity operation ' + operation.name);
	}
}

/**
 * A load that failed inside a data response. SvelteKit answers a client navigation
 * with HTTP 200 and puts each failed load in its node, with its status.
 */
export const nodeError = body => Array.isArray(body?.nodes) ? body.nodes.find(node => node?.type === 'error') ?? null : null;

/** How long one request may take before it counts as failed: a hung answer must not stop a run. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The code of a Cloudflare error page, which is the platform's answer and not the app's:
 * plain (`error code: 1102`) or HTML, where markup separates the word from the code.
 * Only the code is kept; the page itself (with the client's address) is never stored.
 */
const cloudflareCode = text => /cf-error-code[^>]*>\s*(1\d{3})\s*</i.exec(text)?.[1] ?? /error code:?\s*(1\d{3})\b/i.exec(text)?.[1] ??
	(/Worker exceeded resource limits/i.test(text) ? '1102' : null);

/**
 * One request with a deadline: its status, its JSON body and, without JSON, a hint of
 * what answered (a Cloudflare error code, a timeout or the network). A request whose
 * answer never completed has status 0. `request(signal)` makes the call; `onResponse`
 * sees the response before its body is read.
 */
export async function exchange(request, { timeoutMs = REQUEST_TIMEOUT_MS, onResponse } = {}) {
	let status = 0;
	let body = null;
	let hint = null;
	try {
		const response = await request(AbortSignal.timeout(timeoutMs));
		status = response.status;
		onResponse?.(response);
		const text = await response.text();
		try { body = JSON.parse(text); } catch {
			const code = cloudflareCode(text);
			hint = code ? 'cf' + code : 'not-json';
		}
	} catch (error) {
		status = 0;
		hint = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network';
	}
	return { status, body, hint };
}

/** Why a response counts as an error, in a few words and without data, for the run's evidence. */
export function failureReason({ status, body, hint }) {
	if (status === 0) return hint ?? 'network';
	// The hint tells a platform page (`cf1102`) or another answer without JSON from the app's own JSON error.
	if (status !== 200) return `http-${status}` + (hint ? '-' + hint : '');
	if (!body || typeof body !== 'object') return hint ?? 'not-json';
	if (body.type === 'redirect') return String(body.location).startsWith('/login') ? 'login' : 'redirect';
	const node = nodeError(body);
	if (node) return `node-${node.status ?? '?'}`;
	if (body.type === 'failure') return `failure-${body.status ?? '?'}`;
	return `type-${body.type ?? '?'}`;
}

/**
 * Classifies a response. A conflict on a slot taken meanwhile is the expected
 * answer of the system, not a technical error; a lost session, a server error or
 * an unexpected answer is.
 */
export function classifyResponse(operation, status, body) {
	if (status >= 500 || status === 0) return 'error';
	if (operation.category === 'read') {
		if (status !== 200) return 'error';
		if (body && typeof body === 'object' && 'type' in body && (body.type !== 'data' || nodeError(body))) return 'error';
		return 'ok';
	}
	if (status !== 200 || !body || typeof body !== 'object') return 'error';
	if (body.type === 'success' || (body.type === 'redirect' && !String(body.location).startsWith('/login'))) return 'ok';
	if (body.type === 'failure' && body.status === 409) return 'conflict';
	return 'error';
}

export function percentile(sorted, q) {
	if (!sorted.length) return null;
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

/** Latency distributions and error rates per operation and per category. */
export function summarize(samples) {
	const group = list => {
		const durations = list.filter(sample => sample.outcome !== 'error').map(sample => sample.durationMs).sort((a, b) => a - b);
		const failed = list.filter(sample => sample.outcome === 'error');
		const errorReasons = {};
		for (const sample of failed) errorReasons[sample.reason ?? 'unknown'] = (errorReasons[sample.reason ?? 'unknown'] ?? 0) + 1;
		return { count: list.length, errors: failed.length, conflicts: list.filter(sample => sample.outcome === 'conflict').length,
			errorRate: list.length ? failed.length / list.length : 0,
			p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99), max: durations.at(-1) ?? null,
			errorReasons };
	};
	const byOperation = {};
	for (const name of new Set(samples.map(sample => sample.operation))) byOperation[name] = group(samples.filter(sample => sample.operation === name));
	return {
		read: group(samples.filter(sample => sample.category === 'read')),
		write: group(samples.filter(sample => sample.category === 'write')),
		all: group(samples),
		byOperation
	};
}

export function evaluateAcceptance(summary) {
	const checks = {
		readP95: summary.read.p95 !== null && summary.read.p95 < ACCEPTANCE.read.p95,
		readP99: summary.read.p99 !== null && summary.read.p99 < ACCEPTANCE.read.p99,
		writeP95: summary.write.p95 !== null && summary.write.p95 < ACCEPTANCE.write.p95,
		writeP99: summary.write.p99 !== null && summary.write.p99 < ACCEPTANCE.write.p99,
		errorRate: summary.all.count > 0 && summary.all.errorRate < ACCEPTANCE.maximumErrorRate
	};
	return { ...checks, passed: Object.values(checks).every(Boolean) };
}

const actionHeaders = (origin, jar) => ({ origin, cookie: jar.header(), 'x-sveltekit-action': 'true', accept: 'application/json',
	'content-type': 'application/x-www-form-urlencoded' });

/** Logs one owner in through the app's own login action, as the login page does. */
export async function login(origin, email, password, fetchFn = fetch) {
	const jar = new CookieJar();
	const response = await fetchFn(origin + '/login?/login', { method: 'POST', redirect: 'manual', headers: actionHeaders(origin, jar),
		body: new URLSearchParams({ email, password }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
	jar.absorb(response);
	const body = await response.json().catch(() => null);
	if (body?.type !== 'redirect' || !jar.has('sb-access-token')) throw new Error(`The capacity login of ${email} failed (HTTP ${response.status}).`);
	return jar;
}

/** One measured sample; an error carries its reason, never data. */
const sample = (operation, durationMs, result) => {
	const outcome = classifyResponse(operation, result.status, result.body);
	return { operation: operation.name, category: operation.category, durationMs, outcome,
		...(outcome === 'error' ? { reason: failureReason(result) } : {}) };
};

/** Requests at least this long are kept one by one, so a pause can be placed in time. */
export const SLOW_SAMPLE_MS = 1_000;

/**
 * A slow sample with the moment its request started, recorded as it finishes; null for a faster
 * one. Only the phase, operation, outcome and times: what placing a pause against the instance's
 * metrics needs, and no data.
 */
export function slowSample(measured, phase, finishedAt = Date.now()) {
	if (!(measured.durationMs >= SLOW_SAMPLE_MS)) return null;
	return { phase, startedAt: new Date(finishedAt - measured.durationMs).toISOString(), operation: measured.operation,
		category: measured.category, durationMs: measured.durationMs, outcome: measured.outcome };
}

/**
 * Runs one virtual user until `until`, recording every request made after
 * `measureFrom`. Pauses are three to eight seconds between operations, and no
 * request waits longer than `requestTimeoutMs`.
 */
export async function runVirtualUser({ origin, jar, data, random, measureFrom, until, record, fetchFn = fetch,
	sleep = ms => new Promise(done => setTimeout(done, ms)), requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
	const state = { created: [] };
	while (Date.now() < until) {
		let operation = pickOperation(random);
		const plan = planOperation(operation, data, random, state);
		if (plan.substitute) operation = OPERATIONS.find(candidate => candidate.name === plan.substitute);
		const timed = async (entry, call) => {
			const started = Date.now();
			const result = await exchange(call, { timeoutMs: requestTimeoutMs, onResponse: response => jar.absorb(response) });
			if (started >= measureFrom && Date.now() <= until) record(sample(entry, Date.now() - started, result));
			return result;
		};
		let slot;
		if (plan.prepare) {
			const availability = OPERATIONS.find(candidate => candidate.name === 'availability');
			const prepared = await timed(availability, signal => fetchFn(origin + plan.prepare, { headers: { cookie: jar.header() }, signal }));
			const slots = Array.isArray(prepared.body?.slots) ? prepared.body.slots : [];
			slot = slots[Math.floor(random() * Math.min(slots.length, 6))];
		}
		if (!plan.prepare || slot) {
			const result = await timed(operation, signal => plan.form
				? fetchFn(origin + plan.path, { method: 'POST', redirect: 'manual', headers: actionHeaders(origin, jar), body: new URLSearchParams(plan.form(slot)), signal })
				: fetchFn(origin + plan.path, { headers: { cookie: jar.header() }, signal }));
			const created = operation.name === 'create_appointment' && result.body?.type === 'redirect'
				? /\/odonto\/turnos\/([0-9a-f-]{36})/.exec(String(result.body.location))?.[1] : null;
			if (created) state.created.push(created);
		}
		await sleep(3000 + Math.floor(random() * 5001));
	}
}

// Public booking, measured on its own as the plan asks: one generator reads the
// public pages of the shared link and of the site integration (Natalia's path),
// within the limits, and books one appointment every four minutes with a different
// synthetic phone. The limits stay as they are; the abuse checks expect them to act.
export const PUBLIC_OPERATIONS = Object.freeze({
	page: { name: 'public_page', category: 'read' },
	embed: { name: 'public_embed', category: 'read' },
	booking: { name: 'public_booking', category: 'write' }
});
export const PUBLIC_WRITE_INTERVAL_MS = 4 * 60_000;
const PUBLIC_READ_INTERVAL_MS = 1_500;

/** The page's own data in a client navigation (its node is the last), decoded like the client does. */
export function pageData(body, unflatten) {
	if (body?.type !== 'data' || !Array.isArray(body.nodes)) return null;
	const node = body.nodes.at(-1);
	return node?.type === 'data' ? unflatten(node.data) : null;
}

/** What one public page answers, without personal data: for the run's diagnostics. */
export function describePublicPage(status, body, unflatten) {
	const state = pageData(body, unflatten)?.state;
	return { status, type: body?.type ?? null, location: body?.location ?? null,
		nodes: Array.isArray(body?.nodes) ? body.nodes.map(node => node?.type === 'error' ? `error:${node.status ?? '?'}:${String(node.error?.message ?? '').slice(0, 120)}` : node?.type) : null,
		state: state ? { business: Boolean(state.business), services: state.services?.length ?? null, professionals: state.professionals?.length ?? null,
			days: state.days?.length ?? null, slots: state.slots?.length ?? null, issue: state.issue ?? null } : null };
}

/**
 * The confirmation form as PublicBookingConfirmation.svelte submits it: the hidden
 * fields echo what the page sent (integration revision, quote and schema hashes and
 * the request id that makes the booking idempotent).
 */
export function publicBookingForm(page, query, slot, patientName, patientPhone) {
	const parameters = new URLSearchParams(query);
	return {
		...(page?.integration ? { integration_revision: String(page.integration.revision), modality: 'in_person' } : {}),
		service_id: parameters.get('service_id'), booking_mode: 'individual', professional_id: parameters.get('professional_id'),
		slot_starts_at: slot.starts_at, price_quote_hash: page?.priceQuote?.hash ?? '', patient_schema_hash: page?.patientFields?.hash ?? '',
		idempotency_key: page?.bookingRequestId ?? randomUUID(), patient_name: patientName, patient_phone: patientPhone
	};
}

const publicQuery = (data, random, now) => {
	const service = data.services[Math.floor(random() * 5)];
	const professional = data.professionals[Math.floor(random() * 3)];
	return `service_id=${service}&professional_id=${professional}&date=${localDate(now, 1 + Math.floor(random() * 30))}`;
};

/**
 * A free slot found the way a person finds one: the page first lists the days with
 * availability of the next two weeks, then the chosen day lists its slots. Null when
 * the system offers none. `read` performs each page read (the generator measures them).
 */
export async function findPublicSlot({ origin, data, random, unflatten, fetchFn = fetch, read = request => exchange(request) }) {
	const selection = `service_id=${data.services[Math.floor(random() * 5)]}&professional_id=${data.professionals[Math.floor(random() * 3)]}`;
	const listed = pageData((await read(signal => fetchFn(`${origin}/reservar/${data.business}/__data.json?${selection}`, { signal }))).body, unflatten);
	const days = Array.isArray(listed?.state?.days) ? listed.state.days : [];
	if (!days.length) return null;
	const query = `${selection}&date=${days[Math.floor(random() * Math.min(days.length, 5))].date}`;
	const page = pageData((await read(signal => fetchFn(`${origin}/reservar/${data.business}/__data.json?${query}`, { signal }))).body, unflatten);
	const slots = Array.isArray(page?.state?.slots) ? page.state.slots : [];
	const slot = slots[Math.floor(random() * Math.min(slots.length, 6))];
	return slot?.starts_at ? { query, page, slot } : null;
}

/** What a public booking answered, without personal data: the app's own message when it refused. */
function bookingAnswer(result, parse) {
	const { status, body } = result;
	let detail = null;
	try { detail = body?.type === 'failure' && typeof body.data === 'string' ? parse(body.data) : null; } catch {}
	const message = typeof detail?.message === 'string' ? detail.message.slice(0, 160) : null;
	return { type: body?.type ?? null, status: body?.status ?? status, message,
		rateLimited: body?.type === 'failure' && body.status === 400 && String(message ?? '').startsWith(IP_LIMIT_MESSAGE),
		reason: body?.type === 'redirect' ? null : failureReason(result) };
}

/** The confirmation of a found slot, as the public page submits it; `exchange` performs it. */
export const submitPublicBooking = (origin, data, found, name, phone, fetchFn = fetch) => signal => fetchFn(`${origin}/reservar/${data.business}?/create_booking`, {
	method: 'POST', redirect: 'manual', headers: actionHeaders(origin, new CookieJar()),
	body: new URLSearchParams(publicBookingForm(found.page, found.query, found.slot, name, phone)), signal
});

/**
 * Runs the public generator until `until`. Returns the next synthetic phone and the
 * scheduled bookings that did not succeed, with the app's own answer.
 */
export async function runPublicGenerator({ origin, practices, random, measureFrom, until, record, unflatten, parse, phone,
	fetchFn = fetch, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
	let nextWrite = Date.now() + 30_000;
	const failures = [];
	const timed = async (operation, request) => {
		const started = Date.now();
		const result = await exchange(request);
		if (started >= measureFrom && Date.now() <= until) record(sample(operation, Date.now() - started, result));
		return result;
	};
	while (Date.now() < until) {
		const data = practiceData(1 + Math.floor(random() * practices));
		if (Date.now() >= nextWrite) {
			nextWrite += PUBLIC_WRITE_INTERVAL_MS;
			const found = await findPublicSlot({ origin, data, random, unflatten, fetchFn, read: request => timed(PUBLIC_OPERATIONS.page, request) });
			if (!found) failures.push({ outcome: 'no-slot' });
			else {
				const answer = bookingAnswer(await timed(PUBLIC_OPERATIONS.booking,
					submitPublicBooking(origin, data, found, syntheticName('Reserva Pública', phone), phone, fetchFn)), parse);
				phone = nextPhone(phone);
				if (answer.type !== 'redirect') failures.push({ type: answer.type, status: answer.status, message: answer.message, reason: answer.reason });
			}
		} else {
			const query = publicQuery(data, random, new Date());
			const embed = random() < 0.5;
			await timed(embed ? PUBLIC_OPERATIONS.embed : PUBLIC_OPERATIONS.page, signal =>
				fetchFn(embed ? `${origin}/embed/v1/${data.integrationKey}/__data.json?${query}` : `${origin}/reservar/${data.business}/__data.json?${query}`, { signal }));
		}
		await sleep(PUBLIC_READ_INTERVAL_MS);
	}
	return { phone, failures };
}

// The app's own answer when one address exceeds three bookings in ten minutes.
const IP_LIMIT_MESSAGE = 'Se alcanzó el máximo de 3 intentos desde esta conexión en 10 minutos.';

/** A letters-only synthetic name from the phone: public names admit no digits. */
export const syntheticName = (prefix, phone) => {
	const letters = [...phone.slice(-4)].map(digit => 'abcdefghij'[Number(digit)]).join('');
	return `${prefix} ${letters[0].toUpperCase()}${letters.slice(1)}`;
};

/** A different synthetic phone for every public booking. */
export const nextPhone = phone => '+5491177' + String(Number(phone.slice(-6)) + 1).padStart(6, '0');

/**
 * Abuse checks: a burst of reads on the site integration beyond its 120 per minute,
 * and bookings from one address until the limit of three per ten minutes refuses
 * one. Every attempt counts, so the refusal comes by the fourth booking at the
 * latest, sooner when the generator booked in the last ten minutes. Both must act.
 * The burst runs ten requests at a time, so it falls within one minute of the limit
 * even where each read takes a second, as on a hosted project.
 */
export async function runPublicAbuse({ origin, unflatten, parse, phone, fetchFn = fetch, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
	const data = practiceData(1);
	// Start at the beginning of a minute: the read limit counts per minute bucket.
	while (new Date().getUTCSeconds() > 5) await sleep(1_000);
	const outcomes = new Array(130);
	const otherReasons = {};
	let next = 0;
	await Promise.all(Array.from({ length: 10 }, async () => {
		while (next < outcomes.length) {
			const index = next++;
			const result = await exchange(signal => fetchFn(`${origin}/embed/v1/${data.integrationKey}/__data.json?${publicQuery(data, () => 0.5, new Date())}`, { signal }));
			const { status, body } = result;
			// The limit answers 429, as the HTTP status or inside the failed node of a navigation.
			const refused = status === 429 || nodeError(body)?.status === 429;
			outcomes[index] = refused ? 'refused' : status === 200 && body?.type === 'data' && !nodeError(body) ? 'accepted' : 'other';
			if (outcomes[index] === 'other') otherReasons[failureReason(result)] = (otherReasons[failureReason(result)] ?? 0) + 1;
		}
	}));
	const reads = { requests: outcomes.length, accepted: outcomes.filter(outcome => outcome === 'accepted').length,
		refused: outcomes.filter(outcome => outcome === 'refused').length, firstRefusal: outcomes.indexOf('refused') + 1 || null,
		other: outcomes.filter(outcome => outcome === 'other').length, otherReasons };
	const bookings = [];
	for (let attempt = 0; attempt < 4; attempt++) {
		const found = await findPublicSlot({ origin, data, random: createRandom(`abuse-${attempt}`), unflatten, fetchFn });
		if (!found) { bookings.push({ attempt, outcome: 'no-slot' }); break; }
		const answer = bookingAnswer(await exchange(submitPublicBooking(origin, data, found, syntheticName('Abuso Prueba', phone), phone, fetchFn)), parse);
		phone = nextPhone(phone);
		// The app's own message, synthetic data only: a refusal other than the limit must be visible.
		bookings.push({ attempt, ...answer });
		if (answer.type !== 'redirect') break;
	}
	const refusedBooking = bookings.at(-1)?.rateLimited === true && bookings.slice(0, -1).every(booking => booking.type === 'redirect');
	// Within one minute the limit admits 120 reads: not far fewer, never more, and refuses the rest.
	const burstLimited = reads.other === 0 && reads.accepted >= 100 && reads.accepted <= 120 && reads.refused === reads.requests - reads.accepted;
	return { reads, bookings, phone, passed: burstLimited && refusedBooking };
}
