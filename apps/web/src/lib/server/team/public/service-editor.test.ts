import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { updateProfessionalService } from './service-editor';

const businessId = 'e8800000-0000-4000-8000-000000000001';
const serviceId = 'e8800000-0000-4000-8000-000000000009';
const userId = 'e8800000-0000-4000-8000-000000000003';

describe('AF1-012: service editor allows hiding, deactivating and renaming default services', () => {
	const updates: Record<string, unknown>[] = [];
	const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input, init) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
				if (url.pathname.endsWith('/services') && method === 'GET') {
					return Response.json({ id: serviceId, name: 'Consulta', updated_at: '2026-11-20T10:00:00Z' });
				}
				if (url.pathname.endsWith('/services') && method === 'PATCH') {
					updates.push(JSON.parse(String(init?.body)));
					return Response.json({ id: serviceId });
				}
				return Response.json([]);
			}
		}
	});

	beforeEach(() => {
		updates.length = 0;
	});

	it('saves is_public=false, is_active=false and a new name for a service named Consulta', async () => {
		const form = new FormData();
		form.set('service_id', serviceId);
		form.set('service_updated_at', '2026-11-20T10:00:00Z');
		form.set('name', 'Primera entrevista');
		form.set('duration_minutes', '60');
		form.set('buffer_before_minutes', '0');
		form.set('buffer_after_minutes', '0');

		const result = await updateProfessionalService(client, businessId, userId, form);
		expect(result).toEqual({ ok: true, data: { message: 'Servicio guardado.' } });
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			name: 'Primera entrevista',
			is_public: false,
			is_active: false
		});
	});
});
