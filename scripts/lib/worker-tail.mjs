// Parsing of `wrangler tail --format json` for the job and request measurements of an app
// Worker, staging or production. Only the fields below survive; request headers, other logs
// and other paths never do.
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
const jobKinds = ['push', 'calendar', 'reviews', 'uploads', 'commercial', 'storage'];
const exceptionNames = event => (Array.isArray(event.exceptions) ? event.exceptions : []).map(exception =>
	['Error', 'TypeError', 'RangeError', 'AbortError', 'TimeoutError', 'JobBudgetExhaustedError'].includes(exception?.name) ? exception.name : 'OtherError');
const numericJobFields = new Set([
	'calls', 'maxCalls', 'usedCalls', 'databaseRequests', 'providerRequests', 'elapsedMs',
	'claimed', 'processed', 'completed', 'released', 'sent', 'failed', 'retried', 'pending',
	'invalidated', 'prepared', 'skipped', 'gone', 'active', 'deleted', 'retrying', 'attention',
	'stale', 'deadEndpoints', 'scanned', 'credited', 'errors', 'files', 'objects',
	'unattributedBytes', 'unknownSizeObjects', 'overBusinessLimit'
]);
const jobCounts = counts => counts && Object.fromEntries(Object.entries(counts).filter(([key, value]) =>
	(numericJobFields.has(key) && finite(value) !== null) ||
	(['ok', 'configured', 'overGlobalLimit'].includes(key) && typeof value === 'boolean') ||
	(key === 'kind' && jobKinds.includes(value)) ||
	(key === 'profile' && ['free', 'paid'].includes(value)) ||
	(key === 'scheduledFor' && (value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))))
));

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
		path: routeTemplate(path),
		outcome: typeof event.outcome === 'string' ? event.outcome : null,
		status: finite(event.event?.response?.status),
		cpuTimeMs: finite(event.cpuTime),
		wallTimeMs: finite(event.wallTime),
		exceptions: exceptionNames(event),
		job: jobCounts(counts)
	};
}

const quantile = (values, q) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
};
const distribution = values => ({ p50: quantile(values, 0.5), p99: quantile(values, 0.99), max: values.length ? Math.max(...values) : null });

/**
 * Classify paths from code-owned route names. Never guess confidentiality from the
 * contents or length of a value: even short names and unknown paths stay private.
 * This module is a Node-only operations tool; it reads route filenames, never data.
 */
const routeFiles = readdirSync(new URL('../../apps/web/src/routes/', import.meta.url), { recursive: true })
	.filter(path => /(?:^|\/)\+(?:page|server)\.(?:server\.)?(?:ts|js|svelte)$/.test(path));
const routeTemplates = [...new Set(routeFiles.map(path => '/' + path.split('/').slice(0, -1)
	.filter(segment => !/^\(.*\)$/.test(segment)).join('/')))];
// Prefer literal paths such as /pacientes/papelera over /pacientes/[id].
routeTemplates.sort((a, b) => b.split('/').filter(segment => !segment.startsWith('[')).length - a.split('/').filter(segment => !segment.startsWith('[')).length);
const escape = segment => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const routes = routeTemplates.map(template => ({
	pattern: new RegExp('^' + template.split('/').map(segment => segment.startsWith('[') ? '[^/]+' : escape(segment)).join('/') + '/?$'),
	template: template.replace(/\[([^\]=]+)(?:=[^\]]+)?\]/g, (_, name) => name === 'kind' ? ':kind' : name === 'token' ? ':token' : name === 'integrationKey' ? ':key' : ':id')
}));
export const routeCatalogSha256 = createHash('sha256').update(JSON.stringify(routeTemplates)).digest('hex');
export function routeTemplate(path) {
	if (typeof path !== 'string') return '/:unmatched';
	if (/^\/internal\/jobs\/(?:push|calendar|reviews|uploads|commercial|storage)$/.test(path)) return path;
	if (/^\/_app\/immutable\//.test(path)) return '/_app/immutable/:asset';
	if (path === '/_app/version.json') return path;
	const data = path.endsWith('/__data.json');
	const target = data ? path.slice(0, -'/__data.json'.length) || '/' : path;
	const match = routes.find(route => route.pattern.test(target));
	return match ? match.template + (data ? '/__data.json' : '') : '/:unmatched';
}

/** The measurement of any request to the app: route template and the platform's view of it. */
export function requestMeasurement(event) {
	let url;
	try { url = new URL(event?.event?.request?.url); } catch { return null; }
	return {
		at: finite(event.eventTimestamp),
		method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(event.event.request.method?.toUpperCase?.()) ? event.event.request.method.toUpperCase() : 'OTHER',
		route: routeTemplate(url.pathname),
		outcome: typeof event.outcome === 'string' ? event.outcome : null,
		status: finite(event.event?.response?.status),
		cpuTimeMs: finite(event.cpuTime),
		wallTimeMs: finite(event.wallTime),
		exceptions: exceptionNames(event)
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
