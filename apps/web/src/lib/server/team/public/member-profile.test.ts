import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import {
	createTeamMemberProfile,
	makeTeamMemberAttending,
	prepareTeamMemberProfile,
	teamMemberFailure
} from './member-profile';
import {
	grantBusinessRoleAccess,
	listBusinessRoleAccess
} from '$lib/server/access/public/team-access';
const business = 'e8900000-0000-4000-8000-000000000001';
function sdk(reply: (path: string, body: Record<string, unknown>) => Response) {
	const calls: { path: string; body: Record<string, unknown> }[] = [];
	const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input, init) => {
				const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
				const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
				calls.push({ path, body });
				return reply(path, body);
			}
		}
	});
	return { client, calls };
}
function form() {
	const f = new FormData();
	f.set('professional_name', 'Profesional sintética');
	f.set(
		'schedule_blocks',
		JSON.stringify([
			{
				weekdays: [1],
				timeRanges: '9 a 12',
				slotInterval: '0',
				gridInterval: '15',
				serviceScope: 'restricted',
				allowedServiceIds: []
			}
		])
	);
	return f;
}
describe('Equipo onboarding: typed SDK with simulated HTTP', () => {
	it('keeps restrictions closed and normalizes before a single atomic command', async () => {
		const prepared = prepareTeamMemberProfile(
			form(),
			'professional',
			'synthetic@example.test',
			'America/Argentina/Buenos_Aires'
		);
		expect(prepared.ok).toBe(true);
		if (!prepared.ok || !prepared.data) throw new Error('fixture');
		const configuration = prepared.data;
		expect(configuration.blocks[0]).toMatchObject({ service_scope: 'restricted', service_ids: [] });
		const { client, calls } = sdk(() =>
			Response.json({ professionalId: configuration.professionalId, status: 'pending' })
		);
		expect(await createTeamMemberProfile(client, business, configuration)).toEqual({
			professionalId: configuration.professionalId,
			status: 'pending'
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].path).toBe('/rest/v1/rpc/create_team_member_profile');
	});
	it.each([
		'[null]',
		'[{"name":{},"duration_minutes":30}]',
		'[{"name":"Consulta","duration_minutes":true}]',
		'[{"name":"Consulta","duration_minutes":5.5}]'
	])('rejects invalid services %s before writing', (raw) => {
		const f = form();
		f.set('new_services', raw);
		expect(
			prepareTeamMemberProfile(f, 'professional', 'synthetic@example.test', 'UTC')
		).toMatchObject({ ok: false, status: 400 });
	});
	it('does not acknowledge a confirmation for another professional', async () => {
		const prepared = prepareTeamMemberProfile(form(), 'admin', 'synthetic@example.test', 'UTC');
		if (!prepared.ok || !prepared.data) throw new Error('fixture');
		const { client, calls } = sdk(() =>
			Response.json({ professionalId: business, status: 'pending' })
		);
		await expect(createTeamMemberProfile(client, business, prepared.data)).rejects.toThrow();
		expect(calls).toHaveLength(1);
	});
	it('never falls back to administrative writes on failure', async () => {
		const { client, calls } = sdk(() =>
			Response.json({ code: '42501', message: 'PRIVATE_SENTINEL' }, { status: 403 })
		);
		await expect(
			makeTeamMemberAttending(client, business, business, 'Sintético')
		).rejects.toBeDefined();
		expect(calls).toHaveLength(1);
		expect(calls[0].path).toBe('/rest/v1/rpc/make_team_member_attending');
		expect(teamMemberFailure({ code: '42501', message: 'PRIVATE_SENTINEL' })).toEqual({
			status: 503,
			message: 'No pudimos confirmar el cambio. Revisá Equipo antes de volver a intentarlo.'
		});
	});
	it('requires a complete role acknowledgement and never scans the Auth user directory', async () => {
		const { client, calls } = sdk(() =>
			Response.json([
				{ status: 'pending', invite_id: business, membership_id: null, user_id: null }
			])
		);
		expect(
			await grantBusinessRoleAccess(client, business, ' SYNTHETIC@example.test ', 'admin')
		).toEqual({ status: 'pending' });
		expect(calls).toEqual([
			{
				path: '/rest/v1/rpc/upsert_business_role_access',
				body: {
					target_business_id: business,
					target_email: 'synthetic@example.test',
					target_role: 'admin',
					target_professional_id: null
				}
			}
		]);
	});
	it('does not silently remove corrupt members from the owner count', async () => {
		const { client } = sdk(() => Response.json([{ id: business, business_id: 'foreign' }]));
		await expect(listBusinessRoleAccess(client, business)).rejects.toThrow();
	});
});
