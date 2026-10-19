import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { findProfessionalByEmail } from './professionals';
describe('professional email identity lookup / actual SDK, simulated HTTP', () => {
	it('looks up the canonical identity in the clinic, excludes self and does not paginate a full team', async () => {
		const urls: URL[] = [];
		const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
			auth: { persistSession: false, autoRefreshToken: false },
			global: {
				fetch: async (input) => {
					urls.push(new URL(input instanceof Request ? input.url : String(input)));
					return Response.json({ id: 'p2', name: 'Sintética', email: 'ana_%@example.test' });
				}
			}
		});
		expect(await findProfessionalByEmail(client, 'clinic', ' ANA_%@EXAMPLE.TEST ', 'p1')).toEqual({
			id: 'p2',
			name: 'Sintética',
			email: 'ana_%@example.test'
		});
		expect(urls).toHaveLength(1);
		expect(urls[0].searchParams.get('business_id')).toBe('eq.clinic');
		expect(urls[0].searchParams.get('email')).toBe('eq.ana_%@example.test');
		expect(urls[0].searchParams.get('id')).toBe('neq.p1');
		expect(urls[0].searchParams.has('limit')).toBe(false);
		expect(urls[0].searchParams.has('offset')).toBe(false);
	});
	it('does not turn provider failure into absence of a duplicate', async () => {
		const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
			auth: { persistSession: false, autoRefreshToken: false },
			global: {
				fetch: async () =>
					Response.json({ code: '53300', message: 'synthetic unavailable' }, { status: 503 })
			}
		});
		await expect(
			findProfessionalByEmail(client, 'clinic', 'ana@example.test')
		).rejects.toMatchObject({ code: '53300' });
	});
});
