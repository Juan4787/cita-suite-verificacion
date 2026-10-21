import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { CitaDatabase } from '$lib/types/database';
import {
	saveProfessionalServices,
	saveProfessionalEditor,
	loadProfessionalEditor
} from './professional-editor';
import { demoBusinessContext } from '$lib/server/access/public/business';
const businessId = 'e8800000-0000-4000-8000-000000000001',
	professionalId = 'e8800000-0000-4000-8000-000000000002';
function sdk(reply: (path: string) => Response) {
	const calls: { path: string; body: unknown }[] = [];
	const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input, init) => {
				const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
				calls.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
				return reply(path);
			}
		}
	});
	return { client, calls };
}
describe('team editor operations with real typed SDK and simulated HTTP', () => {
	it('assigns the exact selected services in one SQL transaction and carries the revision', async () => {
		const { client, calls } = sdk(() => new Response(null, { status: 204 }));
		const form = new FormData();
		form.set('availability_revision', '42');
		form.append('service_id', 'service-one');
		form.append('service_id', 'service-one');
		expect(await saveProfessionalServices(client, businessId, professionalId, form)).toEqual({
			ok: true,
			data: { serviceIds: ['service-one'] }
		});
		expect(calls).toEqual([
			{
				path: '/rest/v1/rpc/save_professional_editor',
				body: {
					p_business_id: businessId,
					p_professional_id: professionalId,
					p_expected_revision: 42,
					p_profile: null,
					p_service_ids: ['service-one'],
					p_blocks: null,
					p_exception_request_id: null,
					p_exception_items: null,
					p_ack_existing: false
				}
			}
		]);
	});
	it('returns a recoverable conflict and never falls back to partial table writes', async () => {
		const { client, calls } = sdk(() =>
			Response.json({ code: 'P0001', message: 'SCHEDULE_CHANGED' }, { status: 400 })
		);
		const form = new FormData();
		form.set('availability_revision', '42');
		expect(await saveProfessionalServices(client, businessId, professionalId, form)).toMatchObject({
			ok: false,
			status: 409,
			message: expect.stringContaining('no se aplicó ningún cambio')
		});
		expect(calls).toHaveLength(1);
	});
	it('rejects invalid combined schedule without performing another section write', async () => {
		const { client, calls } = sdk(() => {
			throw new Error('Unexpected write');
		});
		const form = new FormData();
		form.set('save_schedule', 'true');
		form.set('schedule_blocks', 'not-json');
		form.set('save_services', 'true');
		expect(
			await saveProfessionalEditor(client, businessId, professionalId, 'UTC', form)
		).toMatchObject({ ok: false, status: 400 });
		expect(calls).toEqual([]);
	});
	it.each(['services', 'professional_services', 'availability_rules', 'availability_exceptions'])(
		'does not fabricate an empty %s editor when the read failed',
		async (table) => {
			const { client } = sdk((path) => {
				if (path.endsWith('/businesses'))
					return Response.json({ booking_availability_revision: 42 });
				if (path.endsWith('/professionals'))
					return Response.json({
						id: professionalId,
						name: 'Synthetic professional',
						specialty: null,
						phone: null,
						email: null,
						is_active: true,
						is_public: true
					});
				if (path.endsWith('/' + table))
					return Response.json({ code: 'XX000', message: 'PRIVATE_SENTINEL' }, { status: 500 });
				return Response.json([]);
			});
			const context = demoBusinessContext();
			context.business.id = businessId;
			expect(
				await loadProfessionalEditor(client, context, 'actor-one', professionalId, 'perfil')
			).toEqual({
				ok: false,
				status: 503,
				message: 'No pudimos cargar toda la configuración. Volvé a intentar.'
			});
		}
	);

	it('answers not found for an identifier that is not one, without querying', async () => {
		// As PostgREST answers a malformed uuid: before the check this surfaced as a 503.
		const { client, calls } = sdk((path) =>
			path.endsWith('/professionals')
				? Response.json({ code: '22P02', message: 'invalid input syntax for type uuid' }, { status: 400 })
				: Response.json({ booking_availability_revision: 42 })
		);
		const context = demoBusinessContext();
		context.business.id = businessId;
		expect(await loadProfessionalEditor(client, context, 'actor-one', 'no-es-un-id', 'perfil')).toEqual({
			ok: false,
			status: 404,
			message: 'Profesional no encontrado'
		});
		expect(calls).toEqual([]);
	});
});
