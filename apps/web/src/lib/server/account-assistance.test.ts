import { describe, expect, it, vi } from 'vitest';
import {
	buildAccountAssistanceView,
	formatAccountAssistanceLocalTime,
	loadActiveMasterAccountAssistanceRequests,
	type AccountAssistanceRow
} from './account-assistance';

const baseGrant = (overrides: Partial<AccountAssistanceRow> = {}): AccountAssistanceRow => ({
	id: 'grant-1',
	business_id: 'business-1',
	requested_by_user_id: 'owner-1',
	support_user_id: 'master-1',
	status: 'active',
	starts_at: '2026-07-08T20:45:00.000Z',
	expires_at: '2026-07-08T21:45:00.000Z',
	revoked_at: null,
	dismissed_at: null,
	created_at: '2026-07-08T20:45:00.000Z',
	updated_at: '2026-07-08T20:45:00.000Z',
	...overrides
});

describe('active master assistance requests', () => {
	it('returns only the rows assigned by the query to the current support user', async () => {
		const result = {
			data: [
				{
					id: 'grant-1',
					business_id: 'business-1',
					expires_at: '2026-07-10T22:00:00.000Z',
					business: { name: 'Consultorio Norte', slug: 'norte' }
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
			now: new Date('2026-07-10T20:00:00.000Z')
		});

		expect(query.eq).toHaveBeenCalledWith('support_user_id', 'master-1');
		expect(query.eq).toHaveBeenCalledWith('status', 'active');
		expect(query.gt).toHaveBeenCalledWith('expires_at', '2026-07-10T20:00:00.000Z');
		expect(requests).toEqual([
			{
				id: 'grant-1',
				businessId: 'business-1',
				businessName: 'Consultorio Norte',
				businessSlug: 'norte',
				expiresAt: '2026-07-10T22:00:00.000Z'
			}
		]);
	});
});

describe('account assistance view state', () => {
	it('shows the initial banner only to the owner of an active account', () => {
		const view = buildAccountAssistanceView({
			grant: null,
			role: 'owner',
			timeZone: 'America/Argentina/Buenos_Aires',
			canUseBusiness: true
		});

		expect(view).toMatchObject({
			status: 'available',
			showBanner: true,
			canActivate: true
		});
	});

	it('does not show the initial banner to admins or unavailable accounts', () => {
		expect(
			buildAccountAssistanceView({
				grant: null,
				role: 'admin',
				timeZone: 'America/Argentina/Buenos_Aires',
				canUseBusiness: true
			}).showBanner
		).toBe(false);
		expect(
			buildAccountAssistanceView({
				grant: null,
				role: 'owner',
				timeZone: 'America/Argentina/Buenos_Aires',
				canUseBusiness: false
			}).showBanner
		).toBe(false);
	});

	it('keeps an active grant revocable and formats the local end time', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'owner',
			timeZone: 'America/Argentina/Buenos_Aires',
			now: new Date('2026-07-08T21:15:00.000Z'),
			canUseBusiness: true
		});

		expect(view.status).toBe('active');
		expect(view.canRevoke).toBe(true);
		expect(view.endsAtLabel).toBe('18:45');
	});

	it('marks an expired active row as expired without keeping a stale global banner', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'owner',
			timeZone: 'America/Argentina/Buenos_Aires',
			now: new Date('2026-07-09T10:00:00.000Z'),
			canUseBusiness: true
		});

		expect(view.status).toBe('expired');
		expect(view.showBanner).toBe(false);
		expect(view.canActivate).toBe(true);
		expect(view.canDismiss).toBe(true);
	});

	it('hides final notices after dismissal or after the 24 hour window', () => {
		const dismissed = buildAccountAssistanceView({
			grant: baseGrant({ status: 'revoked', revoked_at: '2026-07-08T21:00:00.000Z', dismissed_at: '2026-07-08T21:05:00.000Z' }),
			role: 'owner',
			timeZone: 'America/Argentina/Buenos_Aires',
			now: new Date('2026-07-08T22:00:00.000Z'),
			canUseBusiness: true
		});
		const old = buildAccountAssistanceView({
			grant: baseGrant({ status: 'revoked', revoked_at: '2026-07-08T21:00:00.000Z' }),
			role: 'owner',
			timeZone: 'America/Argentina/Buenos_Aires',
			now: new Date('2026-07-10T22:00:00.000Z'),
			canUseBusiness: true
		});

		expect(dismissed.showBanner).toBe(false);
		expect(old.showBanner).toBe(false);
	});

	it('does not show owner CTAs while the support user is inside the account', () => {
		const view = buildAccountAssistanceView({
			grant: baseGrant(),
			role: 'admin',
			timeZone: 'America/Argentina/Buenos_Aires',
			now: new Date('2026-07-08T21:00:00.000Z'),
			canUseBusiness: true,
			isAssisting: true
		});

		expect(view.status).toBe('active');
		expect(view.showBanner).toBe(false);
		expect(view.canActivate).toBe(false);
		expect(view.canRevoke).toBe(false);
	});

	it('formats local time with the business timezone', () => {
		expect(
			formatAccountAssistanceLocalTime(
				'2026-07-08T21:45:00.000Z',
				'America/Argentina/Buenos_Aires'
			)
		).toBe('18:45');
		expect(
			formatAccountAssistanceLocalTime(
				'2026-07-09T03:00:00.000Z',
				'America/Argentina/Buenos_Aires'
			)
		).toBe('00:00');
	});
});
