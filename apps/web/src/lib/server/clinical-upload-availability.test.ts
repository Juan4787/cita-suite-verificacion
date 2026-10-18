import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { loadClinicalUploadsEnabled, loadClinicalUploadAvailability } from '$lib/server/patients/public/clinical-files';

function client(body: unknown, status = 200) {
	return createClient<CitaDatabase>('https://storage-contract.example.test', 'synthetic-key', {
		auth: { autoRefreshToken: false, persistSession: false },
		global: { fetch: vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) }
	});
}
describe('effective document upload capability', () => {
	it('distinguishes an operational module from a legitimate pause', async () => {
		await expect(loadClinicalUploadsEnabled(client(true), 'synthetic')).resolves.toBe(true);
		await expect(loadClinicalUploadAvailability(client(false), 'synthetic')).resolves.toBe('paused');
	});
	it('malformed responses never certify an enabled or deliberately paused module', async () => {
		for (const value of [null, 0, 'false', {}]) {
			await expect(loadClinicalUploadsEnabled(client(value), 'synthetic')).rejects.toMatchObject({ status: 503 });
			await expect(loadClinicalUploadAvailability(client(value), 'synthetic')).resolves.toBe('unavailable');
		}
	});
	it('a provider outage is explicit so historical documents can remain readable', async () => {
		await expect(loadClinicalUploadAvailability(client({ message: 'unavailable' }, 503), 'synthetic')).resolves.toBe('unavailable');
	});
});
