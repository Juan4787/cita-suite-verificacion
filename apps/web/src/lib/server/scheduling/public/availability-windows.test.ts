import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { CitaDatabase } from '$lib/types/database';
import { readRecord, readText, readArray } from '$lib/contracts/json';
import { id, catalog as catalogFixture } from '$lib/availability/__fixtures__/availability';
import { loadAvailabilityCatalog, loadAvailabilityWindowRows } from '$lib/server/scheduling/public/availability-windows';

function fixture(override?: (name: string, body: Record<string, unknown>, index: number) => Response | undefined) {
	const source = catalogFixture();
	source.professionals = Array.from({ length: 35 }, (_, index) => ({ ...source.professionals[0], id: id(100 + index), name: `Synthetic professional ${index}` }));
	source.assignments = source.professionals.map(professional => ({ service_id: id(2), professional_id: professional.id }));
	source.rules = [];
	const requests: Array<{ name: string; body: Record<string, unknown> }> = [];
	const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
	const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const name = url.split('/').at(-1) ?? '';
		const body = readRecord(JSON.parse(String(init?.body)), 'synthetic.rpcBody');
		requests.push({ name, body });
		const special = override?.(name, body, requests.length);
		if (special) return special;
		if (name === 'get_availability_catalog') return response(source);
		if (name !== 'get_availability_window') throw new Error('Unexpected synthetic RPC request.');
		return response({ schema_version: 2, complete: true, business_id: body.p_business_id, scope: 'public',
			configuration_revision: body.p_configuration_revision, generated_at: '2026-10-17T12:00:00Z',
			from_date: body.p_from_date, to_date: body.p_to_date, professional_ids: body.p_professional_ids,
			counts: { blocks: 0, exceptions: 0 }, blocks: [], exceptions: [] });
	});
	const client = createClient<CitaDatabase>('https://synthetic.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch }
	});
	return { client, requests, source, response };
}

describe('bounded availability RPC coordination (mock HTTP, not database proof)', () => {
	it('loads catalog once and sends fixed date/professional groups without losing a team member', async () => {
		const { client, requests, source } = fixture();
		const catalog = await loadAvailabilityCatalog(client, id(1), 'public');
		const result = await loadAvailabilityWindowRows(client, catalog, { serviceId: id(2),
			professionalIds: catalog.professionals.map(professional => professional.id), fromDate: '2026-10-19', toDate: '2026-11-18' });
		expect(requests.filter(request => request.name === 'get_availability_catalog')).toHaveLength(1);
		const windows = requests.filter(request => request.name === 'get_availability_window');
		expect(windows).toHaveLength(9);
		expect(windows.slice(0, 3).flatMap(request => readArray(request.body.p_professional_ids, 'fixture.ids')))
			.toEqual(source.professionals.map(professional => professional.id));
		expect(windows.at(-1)?.body).toMatchObject({ p_from_date: '2026-11-18', p_to_date: '2026-11-18' });
		expect(result.blocks).toEqual([]);
	});
	it('never scans the remainder of a horizon when only one date is requested', async () => {
		const { client, requests } = fixture();
		const catalog = await loadAvailabilityCatalog(client, id(1), 'public');
		await loadAvailabilityWindowRows(client, catalog, { serviceId: id(2), professionalIds: [id(100)],
			fromDate: '2026-10-19', toDate: '2026-10-19' });
		expect(requests).toHaveLength(2);
		expect(requests[1].body).toMatchObject({ p_from_date: '2026-10-19', p_to_date: '2026-10-19' });
	});
	it('propagates configuration change without restarting catalog or returning partial success', async () => {
		const { client, requests } = fixture((name, _body, index) => name === 'get_availability_window' && index === 3
			? new Response(JSON.stringify({ code: 'P0001', message: 'AVAILABILITY_CONFIGURATION_CHANGED' }), { status: 409, headers: { 'content-type': 'application/json' } })
			: undefined);
		const catalog = await loadAvailabilityCatalog(client, id(1), 'public');
		await expect(loadAvailabilityWindowRows(client, catalog, { serviceId: id(2),
			professionalIds: catalog.professionals.map(professional => professional.id), fromDate: '2026-10-19', toDate: '2026-10-19' }))
			.rejects.toMatchObject({ message: 'AVAILABILITY_CONFIGURATION_CHANGED' });
		expect(requests).toHaveLength(3);
		expect(requests.filter(request => request.name === 'get_availability_catalog')).toHaveLength(1);
	});
	it('rejects an incomplete successful HTTP response without converting it to empty availability', async () => {
		const { client } = fixture((name, body) => name === 'get_availability_window'
			? new Response(JSON.stringify({ schema_version: 2, complete: true, business_id: id(1), scope: 'public', configuration_revision: 4,
				generated_at: '2026-10-17T12:00:00Z', from_date: readText(body.p_from_date, 'fixture.from'),
				to_date: readText(body.p_to_date, 'fixture.to'), professional_ids: body.p_professional_ids,
				counts: { blocks: 1, exceptions: 0 }, blocks: [], exceptions: [] }), { headers: { 'content-type': 'application/json' } })
			: undefined);
		const catalog = await loadAvailabilityCatalog(client, id(1), 'public');
		await expect(loadAvailabilityWindowRows(client, catalog, { serviceId: id(2), professionalIds: [id(100)],
			fromDate: '2026-10-19', toDate: '2026-10-19' })).rejects.toMatchObject({ name: 'InvalidDataContractError' });
	});
});
