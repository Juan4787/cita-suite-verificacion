import { fixtureDatabaseBudget } from './fixture-database-budget.mjs';

// This is a bounded read-only integration probe, not the capacity benchmark.
// Four in-flight HTTP requests exercise the actual Auth/REST/Storage services
// sharing the small database. No retries or fabricated client addresses.
export async function checkFixtureConnections(runtime) {
	const origin = new URL(runtime.apiOrigin);
	if (!runtime.realAuth || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
		origin.origin !== runtime.apiOrigin || !/^cita-booking-test-[a-f0-9]{12}$/.test(runtime.container))
		throw new Error('Connection probe requires the verified disposable real-Auth stack.');
	const started = Date.now();
	const totals = { auth: 0, rest: 0, storage: 0 };
	let failed = false;
	async function request(kind, path, token, key, valid) {
		const response = await fetch(origin.origin + path, {
			headers: { authorization: 'Bearer ' + token, apikey: key }, redirect: 'error', signal: AbortSignal.timeout(5000)
		});
		if (!response.ok) { await response.body?.cancel(); throw new Error('Disposable ' + kind + ' connection probe failed.'); }
		const body = await response.json();
		if (!valid(body)) throw new Error('Disposable ' + kind + ' returned an invalid integration contract.');
		totals[kind]++;
	}
	const results = await Promise.allSettled(Array.from({ length: 4 }, async (_, index) => {
		const id = index % 2 ? '90000000-0000-4000-8000-000000000007' : '90000000-0000-4000-8000-000000000004';
		const token = index % 2 ? runtime.doctorToken : runtime.ownerToken;
		try {
			for (let round = 0; round < 20 && !failed; round++) {
				await request('auth', '/auth/v1/user', token, runtime.anon, body => body.id === id && body.role === 'authenticated');
				await request('rest', '/rest/v1/business_users?select=business_id,user_id&business_id=eq.' + runtime.businessId + '&user_id=eq.' + id,
					token, runtime.anon, body => Array.isArray(body) && body.length === 1 && body[0].business_id === runtime.businessId && body[0].user_id === id);
				await request('storage', '/storage/v1/bucket/patient-clinical-files', runtime.service, runtime.service,
					body => body.id === 'patient-clinical-files');
			}
		} catch { failed = true; throw new Error('Real service connection budget probe failed; no retry performed.'); }
	}));
	if (results.some(result => result.status !== 'fulfilled') || Object.values(totals).some(count => count !== 80))
		throw new Error('Real service connection budget was not verified.');
	return { ok: true, scope: 'Disposable real Auth/REST/Storage; read-only; not hosted capacity.',
		maximumConcurrentHttp: 4, roundsPerWorker: 20, requests: totals, durationMs: Date.now() - started, databaseBudget: fixtureDatabaseBudget };
}
