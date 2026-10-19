import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import {
	preparePatientRegistration,
	registerPatient,
	patientRegistrationFailure
} from './patient-registration';
const business = 'e8900000-0000-4000-8000-000000000001';
function sdk(reply: (body: Record<string, unknown>) => Response) {
	const paths: string[] = [];
	const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input, init) => {
				paths.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
				return reply(JSON.parse(String(init?.body)));
			}
		}
	});
	return { client, paths };
}
function input() {
	const f = new FormData();
	f.set('full_name', ' Paciente sintético ');
	f.set('dni', '83000001');
	f.set('phone', '364 1234567');
	return preparePatientRegistration(f);
}
describe('manual patient registration with actual SDK and simulated HTTP', () => {
	it('creates and links using one authenticated transaction, no admin directory or compensation', async () => {
		const { client, paths } = sdk((body) =>
			Response.json({ patientId: body.p_patient_id, duplicate: false })
		);
		expect(await registerPatient(client, business, input())).toMatchObject({ duplicate: false });
		expect(paths).toEqual(['/rest/v1/rpc/register_patient_safely']);
	});
	it('resolves an existing DNI without overwriting it', async () => {
		const { client } = sdk(() => Response.json({ patientId: business, duplicate: true }));
		expect(await registerPatient(client, business, input())).toEqual({
			patientId: business,
			duplicate: true
		});
	});
	it.each([
		{ patientId: business, duplicate: false },
		{ patientId: business },
		{ patientId: 'invalid', duplicate: true }
	])('rejects invalid acknowledgements %j', async (row) => {
		const { client, paths } = sdk(() => Response.json(row));
		await expect(registerPatient(client, business, input())).rejects.toThrow();
		expect(paths).toHaveLength(1);
	});
	it('does not retry an uncertain result or expose its provider message', async () => {
		const { client, paths } = sdk(() =>
			Response.json({ code: 'P0001', message: 'PRIVATE_SENTINEL' }, { status: 400 })
		);
		await expect(registerPatient(client, business, input())).rejects.toBeDefined();
		expect(paths).toHaveLength(1);
		expect(patientRegistrationFailure({ message: 'PRIVATE_SENTINEL' })).toEqual({
			status: 503,
			message:
				'No pudimos confirmar el alta. Revisá la lista de pacientes antes de volver a intentarlo.'
		});
	});
});
