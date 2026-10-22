// What the anonymous key of a hosted project reaches. `api_exposure_explicit.sql` proves on the
// disposable database that `anon` holds no privilege on any relation; a hosted project can drift
// from its migrations, so every relation its API exposes is read once with the anon key and must
// be refused for the missing privilege (HTTP 401, SQLSTATE 42501). Only the listing uses the
// service key. GET requests of at most one row; only the outcome per relation is kept.
export async function probeAnonymousExposure({ api, serviceKey, anonKey, request = fetch }) {
	const headers = key => ({ apikey: key, authorization: `Bearer ${key}` });
	const listing = await request(`${api}/rest/v1/`, { headers: headers(serviceKey), signal: AbortSignal.timeout(15_000) });
	const spec = listing.ok ? await listing.json().catch(() => null) : null;
	const relations = Object.keys(spec?.paths ?? {}).filter(path => path !== '/' && !path.startsWith('/rpc/')).map(path => path.slice(1)).sort();
	if (!relations.length) throw new Error(`The API listed no relations (HTTP ${listing.status}); its exposure was not verified.`);
	const exposed = [];
	for (const relation of relations) {
		const response = await request(`${api}/rest/v1/${encodeURIComponent(relation)}?select=*&limit=1`,
			{ headers: headers(anonKey), signal: AbortSignal.timeout(15_000) });
		const body = await response.json().catch(() => null);
		if (response.status !== 401 || body?.code !== '42501') exposed.push({ relation, status: response.status, code: body?.code ?? null });
	}
	return { relations: relations.length, exposed };
}
