import { describe, expect, it, vi } from 'vitest';
import {
	accountAssistanceErrorMessage,
	accountAssistanceErrorStatus,
	activateAccountAssistance,
	buildAccountAssistanceView,
	endAccountAssistance,
	extendAccountAssistance,
	loadAccountAssistanceHasPatients,
	loadActiveMasterAccountAssistanceRequests,
	type AccountAssistanceRow
} from '$lib/server/access/public/account-assistance';
import { MASTER_EMAIL } from '$lib/server/platform/supabase';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

const baseGrant = (overrides: Partial<AccountAssistanceRow> = {}): AccountAssistanceRow => ({
	id: 'grant-1',
	business_id: 'business-1',
	requested_by_user_id: 'owner-1',
	support_user_id: 'master-1',
	status: 'active',
	kind: 'day',
	starts_at: '2026-11-01T13:15:00.000Z',
	expires_at: '2026-11-02T13:15:00.000Z',
	extended_at: null,
	revoked_at: null,
	revoked_by_role: null,
	dismissed_at: null,
	created_at: '2026-11-01T13:15:00.000Z',
	updated_at: '2026-11-01T13:15:00.000Z',
	...overrides
});

describe('active master assistance requests', () => {
	it('returns only the rows assigned by the query to the current support user, with their duration', async () => {
		const result = {
			data: [
				{
					id: 'grant-1',
					business_id: 'business-1',
					kind: 'initial_setup',
					expires_at: '2026-11-08T13:15:00.000Z',
					business: { name: 'Consultorio Norte', slug: 'norte', timezone: 'America/Argentina/Cordoba' }
				}
			],
			error: null
		};
		const query: any = {
			select: vi.fn(() => query),
			eq: vi.fn(() => query),
			is: vi.fn(() => query),
			gt: vi.fn(() => query),
			order: vi.fn(() => Promise.resolve(result))
		};
		const admin = { from: vi.fn(() => query) } as any;

		const requests = await loadActiveMasterAccountAssistanceRequests({
			admin,
			supportUserId: 'master-1',
			now: new Date('2026-11-01T20:00:00.000Z')
		});

		expect(query.select).toHaveBeenCalledWith(expect.stringContaining('kind'));
		expect(query.eq).toHaveBeenCalledWith('support_user_id', 'master-1');
		expect(query.eq).toHaveBeenCalledWith('status', 'active');
		expect(query.gt).toHaveBeenCalledWith('expires_at', '2026-11-01T20:00:00.000Z');
		expect(requests).toEqual([
			{
				id: 'grant-1',
				businessId: 'business-1',
				businessName: 'Consultorio Norte',
				businessSlug: 'norte',
				timeZone: 'America/Argentina/Cordoba',
				kind: 'initial_setup',
				expiresAt: '2026-11-08T13:15:00.000Z'
			}
		]);
	});
});

describe('account assistance view state', () => {
	it('offers the owner of an active account the durations its patients allow', () => {
		const owner = (hasPatients?: boolean) =>
			buildAccountAssistanceView({ grant: null, role: 'owner', timeZone: BUENOS_AIRES, canUseBusiness: true, hasPatients });

		expect(owner(false)).toMatchObject({
			status: 'available',
			showBanner: true,
			canActivate: true,
			activationKinds: ['hour', 'day', 'initial_setup']
		});
		expect(owner(true).activationKinds).toEqual(['hour', 'day']);
		// The shell does not read the patients: it never lists options it could not check.
		expect(owner(undefined).activationKinds).toEqual([]);
	});

	it('does not offer the assistance to administrators or unavailable accounts', () => {
		for (const view of [
			buildAccountAssistanceView({ grant: null, role: 'admin', timeZone: BUENOS_AIRES, canUseBusiness: true, hasPatients: false }),
			buildAccountAssistanceView({ grant: null, role: 'owner', timeZone: BUENOS_AIRES, canUseBusiness: false, hasPatients: false })
		]) {
			expect(view).toMatchObject({ showBanner: false, canActivate: false, activationKinds: [] });
		}
	});

	it('shows an active grant with its duration and the date and time it ends', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'owner',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-01T21:15:00.000Z'),
			canUseBusiness: true,
			hasPatients: false
		});

		expect(view).toMatchObject({
			status: 'active',
			grantId: 'grant-1',
			kind: 'day',
			showBanner: true,
			canActivate: false,
			canEnd: true,
			canExtend: true,
			extensionKinds: ['initial_setup'],
			expiresAt: '2026-11-02T13:15:00.000Z',
			endedBy: null
		});
		expect(view.endsAt?.full).toBe('el lunes 2 de noviembre a las 10:15');
	});

	it('lets the owner extend only to what the patients allow', () => {
		const view = (kind: string, hasPatients: boolean) =>
			buildAccountAssistanceView({
				grant: baseGrant({ kind }),
				role: 'owner',
				timeZone: BUENOS_AIRES,
				now: new Date('2026-11-01T21:15:00.000Z'),
				canUseBusiness: true,
				hasPatients
			});

		expect(view('day', true)).toMatchObject({ canExtend: false, extensionKinds: [] });
		expect(view('hour', true).extensionKinds).toEqual(['day']);
		expect(view('initial_setup', true).extensionKinds).toEqual(['initial_setup']);
	});

	it('lets the support user inside the account end it, but not extend it or give another', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'admin',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-01T21:00:00.000Z'),
			canUseBusiness: true,
			isAssisting: true
		});

		expect(view).toMatchObject({
			status: 'active',
			showBanner: false,
			canActivate: false,
			canEnd: true,
			canExtend: false,
			extensionKinds: []
		});
		expect(view.endsAt?.full).toBe('el lunes 2 de noviembre a las 10:15');
	});

	it('does not let an administrator of the practice end or extend it', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'admin',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-01T21:00:00.000Z'),
			canUseBusiness: true,
			hasPatients: false
		});

		expect(view).toMatchObject({ status: 'active', showBanner: false, canEnd: false, canExtend: false });
	});

	it('says for 24 hours that the grant expired, and when', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'owner',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-02T20:00:00.000Z'),
			canUseBusiness: true,
			hasPatients: true
		});

		expect(view).toMatchObject({
			status: 'expired',
			endedBy: 'expired',
			endedAt: '2026-11-02T13:15:00.000Z',
			showBanner: true,
			canDismiss: true,
			canActivate: true,
			canEnd: false,
			activationKinds: ['hour', 'day']
		});
		expect(view.endedAtMoment?.full).toBe('el lunes 2 de noviembre a las 10:15');
	});

	it('says who ended it: the owner, Cita Suite, or the owner for grants V10b ended', () => {
		const ended = (revoked_by_role: string | null) =>
			buildAccountAssistanceView({
				grant: baseGrant({ status: 'revoked', revoked_at: '2026-11-01T22:00:00.000Z', revoked_by_role }),
				role: 'owner',
				timeZone: BUENOS_AIRES,
				now: new Date('2026-11-01T22:30:00.000Z'),
				canUseBusiness: true
			});

		expect(ended('support')).toMatchObject({ status: 'revoked', endedBy: 'support', endedAt: '2026-11-01T22:00:00.000Z', showBanner: true });
		expect(ended('owner')).toMatchObject({ endedBy: 'owner', showBanner: true });
		// Before V11 only the owner could end it, and nobody was recorded.
		expect(ended(null)).toMatchObject({ endedBy: 'owner', showBanner: true });
		expect(ended('support').endedAtMoment?.full).toBe('el domingo 1 de noviembre a las 19:00');
	});

	it('stops saying it ended after it is closed or after 24 hours', () => {
		const dismissed = buildAccountAssistanceView({
			grant: baseGrant({ status: 'revoked', revoked_at: '2026-11-01T22:00:00.000Z', dismissed_at: '2026-11-01T22:05:00.000Z' }),
			role: 'owner',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-01T23:00:00.000Z'),
			canUseBusiness: true
		});
		const old = buildAccountAssistanceView({
			grant: baseGrant({ status: 'revoked', revoked_at: '2026-11-01T22:00:00.000Z' }),
			role: 'owner',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-02T22:00:01.000Z'),
			canUseBusiness: true
		});

		expect(dismissed).toMatchObject({ showBanner: false, canDismiss: false, endedBy: 'owner' });
		expect(old).toMatchObject({ showBanner: false, canDismiss: false, endedBy: 'owner' });
	});

	it('keeps a grant of an unknown duration readable without inventing one', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant({ kind: 'week' }),
			role: 'owner',
			timeZone: BUENOS_AIRES,
			now: new Date('2026-11-01T21:15:00.000Z'),
			canUseBusiness: true,
			hasPatients: false
		});

		expect(view).toMatchObject({ status: 'active', kind: null, canEnd: true, canExtend: false, extensionKinds: [] });
	});
});

describe('account assistance commands', () => {
	const rpcClient = (data: unknown = [{ id: 'grant-1', business_id: 'business-1', requested_by_user_id: 'owner-1', support_user_id: 'master-1' }]) => ({
		rpc: vi.fn(async () => ({ data, error: null }))
	});

	it('gives the chosen duration to the master support user', async () => {
		const supabase = rpcClient();
		const admin: any = {
			auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [{ id: 'master-1', email: MASTER_EMAIL.toUpperCase() }] }, error: null })) } },
			from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: null })) }))
		};

		await activateAccountAssistance({ supabase: supabase as any, admin, businessId: 'business-1', kind: 'initial_setup' });

		expect(supabase.rpc).toHaveBeenCalledWith('start_account_assistance', {
			target_business_id: 'business-1',
			target_support_user_id: 'master-1',
			target_kind: 'initial_setup'
		});
	});

	it('extends and ends exactly the grant shown', async () => {
		const supabase = rpcClient();

		await extendAccountAssistance({ supabase: supabase as any, businessId: 'business-1', grantId: 'grant-1', kind: 'day' });
		await endAccountAssistance({ supabase: supabase as any, businessId: 'business-1', grantId: 'grant-1' });

		expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'extend_account_assistance', {
			target_business_id: 'business-1',
			target_grant_id: 'grant-1',
			target_kind: 'day'
		});
		expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'end_account_assistance', {
			target_business_id: 'business-1',
			target_grant_id: 'grant-1'
		});
	});

	it('reads whether the practice has patients and refuses an answer that is not one', async () => {
		await expect(loadAccountAssistanceHasPatients({ supabase: rpcClient(true) as any, businessId: 'business-1' })).resolves.toBe(true);
		await expect(loadAccountAssistanceHasPatients({ supabase: rpcClient(false) as any, businessId: 'business-1' })).resolves.toBe(false);
		await expect(loadAccountAssistanceHasPatients({ supabase: rpcClient(null) as any, businessId: 'business-1' })).rejects.toThrow();
	});

	it('explains each refusal of the database in plain words', () => {
		const message = (code: string) => accountAssistanceErrorMessage({ message: code });
		expect(message('ACCOUNT_ASSISTANCE_INITIAL_SETUP_UNAVAILABLE')).toBe(
			'La configuración inicial se puede dar sólo mientras el consultorio no tiene pacientes. Podés dar ayuda por 1 hora o por 24 horas.'
		);
		expect(message('ACCOUNT_ASSISTANCE_ALREADY_ACTIVE')).toBe(
			'Ya hay una ayuda activa. Podés ver hasta cuándo dura y extenderla desde Ayuda.'
		);
		expect(message('ACCOUNT_ASSISTANCE_EXTENSION_NOT_ALLOWED')).toBe(
			'Esa opción no extiende la ayuda activa. Recargá la página para ver las opciones vigentes.'
		);
		expect(message('ACCOUNT_ASSISTANCE_NOT_ACTIVE')).toBe('La ayuda ya no está activa.');
		expect(message('ACCOUNT_ASSISTANCE_OWNER_REQUIRED')).toBe(
			'Solo el dueño del consultorio puede dar o extender esta ayuda.'
		);
		expect(accountAssistanceErrorStatus({ message: 'ACCOUNT_ASSISTANCE_OWNER_REQUIRED' })).toBe(403);
		for (const code of ['NOT_ACTIVE', 'ALREADY_ACTIVE', 'EXTENSION_NOT_ALLOWED', 'INITIAL_SETUP_UNAVAILABLE'])
			expect(accountAssistanceErrorStatus({ message: `ACCOUNT_ASSISTANCE_${code}` })).toBe(409);
		expect(accountAssistanceErrorStatus(new Error('connection reset'))).toBe(500);
		for (const code of ['ACCOUNT_ASSISTANCE_KIND_INVALID', 'SOMETHING_ELSE'])
			expect(message(code)).toBe(
				'No pudimos actualizar la ayuda. Recargá la página y volvé a intentar; si continúa, contactá a Cita Suite.'
			);
	});
});
