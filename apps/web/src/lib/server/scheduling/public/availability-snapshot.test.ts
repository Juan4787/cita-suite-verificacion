import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { CitaDatabase } from '$lib/types/database';
import { id, catalog as catalogFixture } from '$lib/availability/__fixtures__/availability';
import { readRecord } from '$lib/contracts/json';
import { loadInternalAvailabilitySnapshot, defaultInternalAvailabilitySnapshotRange } from '$lib/server/scheduling/public/availability-snapshot';

function fixture(override?: (name: string, body: Record<string, unknown>) => Response | undefined) {
 const source = { ...catalogFixture(), scope: 'internal' };
 const requests: Array<{ name: string; body: Record<string, unknown> }> = [];
 const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
  const name = (input instanceof Request ? input.url : String(input)).split('/').at(-1) ?? '';
  const body = readRecord(JSON.parse(String(init?.body)), 'synthetic.rpcBody');
  requests.push({ name, body });
  const special = override?.(name, body);
  if (special) return special;
  return new Response(JSON.stringify(name === 'get_availability_catalog' ? source : {
   schema_version: 2, complete: true, business_id: id(1), scope: 'internal', configuration_revision: 4,
   generated_at: source.generated_at, from_date: body.p_from_date, to_date: body.p_to_date,
   professional_ids: body.p_professional_ids, counts: { blocks: 0, exceptions: 0 }, blocks: [], exceptions: []
  }), { headers: { 'content-type': 'application/json' } });
 });
 const client = createClient<CitaDatabase>('https://synthetic.example.test', 'synthetic-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch }
 });
 return { source, client, requests, business: { id: id(1), ...source.business } };
}

describe('internal availability snapshot over bounded contracts', () => {
 it('normalizes one catalog and its window while exposing only agenda data', async () => {
  const { source, client, requests, business } = fixture();
  const snapshot = await loadInternalAvailabilitySnapshot(client, { business, fromDate: '2026-10-19', toDate: '2026-10-20' });
  expect(requests.map(request => request.name)).toEqual(['get_availability_catalog', 'get_availability_window']);
  expect(requests[1].body).toMatchObject({ p_from_date: '2026-10-19', p_to_date: '2026-10-20', p_public: false });
  expect(snapshot).toMatchObject({ schema_version: 1, generated_at: source.generated_at,
   valid_until: '2026-10-17T12:00:20.000Z', from_date: '2026-10-19', to_date: '2026-10-20' });
  expect(snapshot.services[0]).toMatchObject({ id: id(2), duration_minutes: 30 });
  expect(snapshot.professionals[0]).toMatchObject({ id: id(3), name: 'Synthetic professional' });
  expect(snapshot.business).not.toHaveProperty('id');
  expect(JSON.stringify(snapshot)).not.toContain('patient');
 });
 it('does not fall back to truncatable table reads when the RPC is absent', async () => {
  const { client, requests, business } = fixture(() => new Response(JSON.stringify({ code: 'PGRST202', message: 'Function is unavailable.' }),
   { status: 404, headers: { 'content-type': 'application/json' } }));
  await expect(loadInternalAvailabilitySnapshot(client, { business, fromDate: '2026-10-19', toDate: '2026-10-20' }))
   .rejects.toMatchObject({ code: 'PGRST202' });
  expect(requests).toHaveLength(1);
  expect(requests[0].name).toBe('get_availability_catalog');
 });
 it('preserves a real permission error without a table fallback', async () => {
  const { client, requests, business } = fixture(() => new Response(JSON.stringify({ code: '42501', message: 'Permission denied.' }),
   { status: 403, headers: { 'content-type': 'application/json' } }));
  await expect(loadInternalAvailabilitySnapshot(client, { business, fromDate: '2026-10-19', toDate: '2026-10-20' }))
   .rejects.toMatchObject({ code: '42501' });
  expect(requests).toHaveLength(1);
 });
 it('rejects an excessive overall request before reading the database', async () => {
  const { client, requests, business } = fixture();
  await expect(loadInternalAvailabilitySnapshot(client, { business, fromDate: '2026-07-01', toDate: '2026-08-01' })).rejects.toThrow('supera el rango permitido');
  expect(requests).toHaveLength(0);
 });
 it('rejects nonexistent ISO-looking dates before reading the database', async () => {
  const { client, requests, business } = fixture();
  await expect(loadInternalAvailabilitySnapshot(client, { business, fromDate: '2026-02-30', toDate: '2026-03-01' })).rejects.toThrow('Rango inválido');
  expect(requests).toHaveLength(0);
 });
 it('rejects incomplete successful responses instead of showing an empty agenda', async () => {
  const { client, business } = fixture(name => name === 'get_availability_window'
   ? new Response(JSON.stringify({ blocks: [] }), { headers: { 'content-type': 'application/json' } }) : undefined);
  await expect(loadInternalAvailabilitySnapshot(client, { business, fromDate: '2026-10-19', toDate: '2026-10-20' })).rejects.toThrow();
 });
 it('prepares only the first fifteen natural dates in the clinic timezone', () => {
  expect(defaultInternalAvailabilitySnapshotRange({ timezone: 'America/Argentina/Buenos_Aires' }, undefined,
   new Date('2026-11-01T01:00:00Z'))).toEqual({ fromDate: '2026-10-31', toDate: '2026-11-14' });
 });
});
