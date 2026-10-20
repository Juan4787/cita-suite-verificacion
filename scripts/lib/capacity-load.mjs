import { createHash, randomUUID } from 'node:crypto';

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

export const uuidFrom = text => createHash('md5').update(text).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** The synthetic data a virtual user of practice `practice` works with. */
export function practiceData(practice) {
	const tag = String(practice).padStart(2, '0');
	return {
		practice,
		email: `capacity-owner-${tag}@example.test`,
		professionals: [1, 2, 3].map(k => uuidFrom(`capacity-professional-${practice}-${k}`)),
		services: [1, 2, 3, 4, 5].map(k => uuidFrom(`capacity-service-${practice}-${k}`)),
		patient: index => uuidFrom(`capacity-patient-${practice}-${index}`),
		appointment: index => uuidFrom(`capacity-appointment-${practice}-${index}`)
	};
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
 * Classifies a response. A conflict on a slot taken meanwhile is the expected
 * answer of the system, not a technical error; a lost session, a server error or
 * an unexpected answer is.
 */
export function classifyResponse(operation, status, body) {
	if (status >= 500 || status === 0) return 'error';
	if (operation.category === 'read') {
		if (status !== 200) return 'error';
		if (body && typeof body === 'object' && 'type' in body && body.type !== 'data') return 'error';
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
		const errors = list.filter(sample => sample.outcome === 'error').length;
		return { count: list.length, errors, conflicts: list.filter(sample => sample.outcome === 'conflict').length,
			errorRate: list.length ? errors / list.length : 0,
			p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99), max: durations.at(-1) ?? null };
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
		body: new URLSearchParams({ email, password }) });
	jar.absorb(response);
	const body = await response.json().catch(() => null);
	if (body?.type !== 'redirect' || !jar.has('sb-access-token')) throw new Error(`The capacity login of ${email} failed (HTTP ${response.status}).`);
	return jar;
}

/**
 * Runs one virtual user until `until`, recording every request made after
 * `measureFrom`. Pauses are three to eight seconds between operations.
 */
export async function runVirtualUser({ origin, jar, data, random, measureFrom, until, record, fetchFn = fetch, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
	const state = { created: [] };
	while (Date.now() < until) {
		let operation = pickOperation(random);
		const plan = planOperation(operation, data, random, state);
		if (plan.substitute) operation = OPERATIONS.find(candidate => candidate.name === plan.substitute);
		const timed = async (entry, call) => {
			const started = Date.now();
			let status = 0;
			let body = null;
			try {
				const response = await call();
				status = response.status;
				jar.absorb(response);
				body = await response.json().catch(() => null);
			} catch {}
			const durationMs = Date.now() - started;
			if (started >= measureFrom && Date.now() <= until)
				record({ operation: entry.name, category: entry.category, durationMs, outcome: classifyResponse(entry, status, body) });
			return { status, body };
		};
		let slot;
		if (plan.prepare) {
			const availability = OPERATIONS.find(candidate => candidate.name === 'availability');
			const prepared = await timed(availability, () => fetchFn(origin + plan.prepare, { headers: { cookie: jar.header() } }));
			const slots = Array.isArray(prepared.body?.slots) ? prepared.body.slots : [];
			slot = slots[Math.floor(random() * Math.min(slots.length, 6))];
		}
		if (!plan.prepare || slot) {
			const result = await timed(operation, () => plan.form
				? fetchFn(origin + plan.path, { method: 'POST', redirect: 'manual', headers: actionHeaders(origin, jar), body: new URLSearchParams(plan.form(slot)) })
				: fetchFn(origin + plan.path, { headers: { cookie: jar.header() } }));
			const created = operation.name === 'create_appointment' && result.body?.type === 'redirect'
				? /\/odonto\/turnos\/([0-9a-f-]{36})/.exec(String(result.body.location))?.[1] : null;
			if (created) state.created.push(created);
		}
		await sleep(3000 + Math.floor(random() * 5001));
	}
}
