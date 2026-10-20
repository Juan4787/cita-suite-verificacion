import { expect, test } from '@playwright/test';
import { SCHEDULED_JOB_KINDS } from '@cita-suite/shared/scheduled-jobs';

// Every scheduled job category through its real route, the server code and the
// disposable PostgREST, which runs each request as the hosted platform does
// (authenticator with safeupdate). Unit tests use doubles and the SQL suites call
// the functions directly, so neither would see a failure that only happens inside a
// request, like the unqualified UPDATE that stopped the storage reconciliation on
// staging. Without Web Push or Google credentials in this fixture, push, reviews and
// calendar report that they are not configured; their database entry points are
// covered under the same guard by supabase/tests/hosted_request_guards.sql.
const secret = process.env.INTERNAL_JOB_SECRET ?? '';
const notConfigured = new Set(['push', 'reviews', 'calendar']);

test.describe('tareas programadas sobre los servicios descartables', () => {
	// Without the guard the receipts below would pass whatever the functions contain.
	// The server role cannot update this table: without safeupdate the request would
	// be refused for permissions (42501), so nothing is written either way.
	test('PostgREST rechaza un UPDATE sin filtro, como el alojado', async ({ request }) => {
		const api = process.env.ODONTO_SUPABASE_URL ?? '';
		const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? '';
		const response = await request.patch(`${api}/rest/v1/clinical_storage_budget`, {
			headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			data: { updated_at: new Date().toISOString() }
		});
		expect({ status: response.status(), body: await response.json() }).toMatchObject({
			status: 400,
			body: { code: '21000', message: 'UPDATE requires a WHERE clause' }
		});
	});

	test('cada categoría completa su ejecución y devuelve su recibo', async ({ request }) => {
		expect(secret, 'the integration run provides the internal job secret').toMatch(/^[0-9a-f]{64}$/);
		for (const kind of SCHEDULED_JOB_KINDS) {
			const response = await request.post(`/internal/jobs/${kind}`, {
				headers: { authorization: `Bearer ${secret}`, 'x-cita-scheduled-time': new Date().toISOString() }
			});
			const receipt: unknown = await response.json();
			expect({ kind, status: response.status(), receipt }).toMatchObject({
				kind,
				status: 200,
				receipt: { ok: true, kind, budget: { profile: 'free', maxCalls: 40 } }
			});
			if (notConfigured.has(kind)) expect(receipt).toMatchObject({ result: { configured: false } });
		}
	});

	test('sin el secreto interno ninguna categoría se ejecuta', async ({ request }) => {
		const attempts: Record<string, string>[] = [{}, { authorization: `Bearer ${'0'.repeat(64)}` }];
		for (const headers of attempts) {
			const response = await request.post('/internal/jobs/storage', { headers });
			expect(response.status()).toBe(401);
		}
	});
});
