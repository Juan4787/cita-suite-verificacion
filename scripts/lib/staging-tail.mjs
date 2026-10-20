// Parsing of `wrangler tail --format json` for the staging job measurements. Only
// the fields below survive; request headers, other logs and other paths never do.
const JOB_LOG = 'Tarea programada';

/** Wrangler prints each event as one JSON object, which may span lines and chunks. */
export function splitJsonObjects(onObject) {
	let buffer = '';
	let position = 0;
	let depth = 0;
	let start = 0;
	let inString = false;
	let escaped = false;
	return chunk => {
		buffer += chunk;
		for (; position < buffer.length; position++) {
			const char = buffer[position];
			if (inString) {
				if (escaped) escaped = false;
				else if (char === '\\') escaped = true;
				else if (char === '"') inString = false;
			} else if (char === '"') inString = depth > 0;
			else if (char === '{' && depth++ === 0) start = position;
			else if (char === '}' && depth > 0 && --depth === 0) {
				onObject(buffer.slice(start, position + 1));
				buffer = buffer.slice(position + 1);
				position = -1;
			}
		}
		// Text between events (banners, blank lines) is dropped.
		if (depth === 0) {
			buffer = '';
			position = 0;
		}
	};
}

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The measurement of one scheduled job request, or null for any other event. */
export function jobMeasurement(event) {
	let path;
	try { path = new URL(event?.event?.request?.url).pathname; } catch { return null; }
	if (!path.startsWith('/internal/jobs/')) return null;
	const log = (Array.isArray(event.logs) ? event.logs : [])
		.find(entry => Array.isArray(entry?.message) && entry.message[0] === JOB_LOG);
	const counts = log && typeof log.message[1] === 'object' && log.message[1] !== null ? log.message[1] : null;
	return {
		at: finite(event.eventTimestamp),
		path,
		outcome: typeof event.outcome === 'string' ? event.outcome : null,
		status: finite(event.event?.response?.status),
		cpuTimeMs: finite(event.cpuTime),
		wallTimeMs: finite(event.wallTime),
		exceptions: (Array.isArray(event.exceptions) ? event.exceptions : []).map(exception => String(exception?.name ?? 'Error')),
		job: counts && Object.fromEntries(Object.entries(counts)
			.filter(([, value]) => value === null || typeof value === 'boolean' || finite(value) !== null || typeof value === 'string'))
	};
}

const quantile = (values, q) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
};
const distribution = values => ({ p50: quantile(values, 0.5), p99: quantile(values, 0.99), max: values.length ? Math.max(...values) : null });

/**
 * A path without its data, for the capacity rehearsal: identifiers, integration keys
 * and tokens become placeholders, so patients, practices and links never survive.
 */
export const routeTemplate = path => path
	.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
	.replace(/\/[0-9a-f]{32}(?=\/|$)/gi, '/:key')
	.replace(/\/(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token');

/** The measurement of any request to the app: route template and the platform's view of it. */
export function requestMeasurement(event) {
	let url;
	try { url = new URL(event?.event?.request?.url); } catch { return null; }
	return {
		at: finite(event.eventTimestamp),
		method: typeof event.event.request.method === 'string' ? event.event.request.method.toUpperCase() : null,
		route: routeTemplate(url.pathname),
		outcome: typeof event.outcome === 'string' ? event.outcome : null,
		status: finite(event.event?.response?.status),
		cpuTimeMs: finite(event.cpuTime),
		wallTimeMs: finite(event.wallTime),
		exceptions: (Array.isArray(event.exceptions) ? event.exceptions : []).map(exception => String(exception?.name ?? 'Error'))
	};
}

/** Outcomes, statuses and CPU/wall distributions per method and route. */
export function summarizeRequestMeasurements(measurements) {
	const byRoute = new Map();
	for (const measurement of measurements) {
		const key = `${measurement.method ?? '?'} ${measurement.route}`;
		byRoute.set(key, [...(byRoute.get(key) ?? []), measurement]);
	}
	const count = (list, field) => {
		const counts = {};
		for (const item of list) counts[item[field] ?? 'none'] = (counts[item[field] ?? 'none'] ?? 0) + 1;
		return counts;
	};
	return {
		events: measurements.length,
		cpuReported: measurements.some(measurement => measurement.cpuTimeMs !== null),
		outcomes: count(measurements, 'outcome'),
		routes: Object.fromEntries([...byRoute].sort(([a], [b]) => a.localeCompare(b)).map(([route, list]) => [route, {
			requests: list.length,
			outcomes: count(list, 'outcome'),
			statuses: count(list, 'status'),
			cpuMs: distribution(list.map(item => item.cpuTimeMs).filter(value => value !== null)),
			wallMs: distribution(list.map(item => item.wallTimeMs).filter(value => value !== null))
		}]))
	};
}

/** Outcomes and CPU/wall distributions per job path. */
export function summarizeJobMeasurements(measurements) {
	const byPath = new Map();
	for (const measurement of measurements) byPath.set(measurement.path, [...(byPath.get(measurement.path) ?? []), measurement]);
	return {
		events: measurements.length,
		cpuReported: measurements.some(measurement => measurement.cpuTimeMs !== null),
		jobs: Object.fromEntries([...byPath].map(([path, list]) => {
			const outcomes = {};
			for (const { outcome } of list) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
			return [path, {
				runs: list.length,
				outcomes,
				cpuMs: distribution(list.map(item => item.cpuTimeMs).filter(value => value !== null)),
				wallMs: distribution(list.map(item => item.wallTimeMs).filter(value => value !== null))
			}];
		}))
	};
}
