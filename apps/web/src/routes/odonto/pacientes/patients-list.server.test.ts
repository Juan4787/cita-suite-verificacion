import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: vi.fn() }));
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { actions } from './+page.server';
const businessId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const patientId = '00000000-0000-4000-8000-000000000004';
const calls: { path: string; body: Record<string, unknown> }[] = [];
let reply: (body: Record<string, unknown>) => Response;
const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
	auth: { persistSession: false, autoRefreshToken: false },
	global: {
		fetch: async (input, init) => {
			const body = JSON.parse(String(init?.body));
			calls.push({
				path: new URL(input instanceof Request ? input.url : String(input)).pathname,
				body
			});
			return reply(body);
		}
	}
});
const event = (name: string, phone: string, dni = '') => {
	const form = new FormData();
	form.set('full_name', name);
	form.set('phone', phone);
	form.set('dni', dni);
	return {
		request: new Request('http://localhost/odonto/pacientes', { method: 'POST', body: form }),
		locals: { auth: { module: 'odonto', access_token: 'synthetic', refresh_token: 'synthetic' } },
		fetch,
		cookies: {}
	};
};
function context(role: 'owner' | 'professional') {
	const business = demoBusinessContext();
	return {
		supabase: client,
		userId,
		business: { ...business, role, business: { ...business.business, id: businessId } }
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	calls.length = 0;
	reply = (body) => Response.json({ patientId: body.p_patient_id, duplicate: false });
	vi.mocked(getOdontoContext).mockResolvedValue(context('professional'));
});
describe('patient create route / real SDK, simulated HTTP, context already authorized', () => {
	it('confirms the complete patient+link command before redirecting', async () => {
		await expect(
			actions.create_patient!(event('Paciente Profesional', '+54 9 11 5555-5555') as never)
		).rejects.toMatchObject({
			status: 303,
			location: expect.stringMatching(/^\/odonto\/pacientes\/[0-9a-f-]{36}$/)
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].path).toBe('/rest/v1/rpc/register_patient_safely');
		expect(calls[0].body).toMatchObject({
			p_business_id: businessId,
			p_full_name: 'Paciente Profesional',
			p_phone_e164: '+5491155555555'
		});
	});
	it('submits repeated names without a name uniqueness lookup', async () => {
		await expect(
			actions.create_patient!(event('Juan Carlos Ramírez', '+54 9 11 4444-4444') as never)
		).rejects.toMatchObject({ status: 303 });
		expect(calls).toHaveLength(1);
		expect(calls[0].body.p_full_name).toBe('Juan Carlos Ramírez');
	});
	it('submits another person sharing a phone without using that phone as unique identity', async () => {
		await expect(
			actions.create_patient!(event('Otra persona', '+54 9 11 5555-5555') as never)
		).rejects.toMatchObject({ status: 303 });
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({ p_dni: '', p_phone_e164: '+5491155555555' });
	});
	it('uses the same authenticated command for an owner with no attending profile', async () => {
		vi.mocked(getOdontoContext).mockResolvedValue(context('owner'));
		await expect(
			actions.create_patient!(event('Roberto', '3652697', '4125789') as never)
		).rejects.toMatchObject({ status: 303 });
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({ p_full_name: 'Roberto', p_dni: '4125789' });
	});
	it('returns a DNI duplicate with its original identity and retains submitted values', async () => {
		reply = () => Response.json({ patientId, duplicate: true });
		expect(
			await actions.create_patient!(event('Persona a revisar', '123', '83000001') as never)
		).toMatchObject({
			duplicate: true,
			duplicateField: 'dni',
			existingId: patientId,
			full_name: 'Persona a revisar',
			dni: '83000001'
		});
		expect(calls).toHaveLength(1);
	});
	it('keeps an uncertain result recoverable and never deletes a possibly committed patient', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reply = () => Response.json({ code: 'P0001', message: 'PRIVATE_SENTINEL' }, { status: 400 });
		const result = await actions.create_patient!(event('Paciente', '123') as never);
		expect(result).toMatchObject({ status: 503, data: { full_name: 'Paciente' } });
		expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
		expect(calls).toHaveLength(1);
		vi.restoreAllMocks();
	});
});
