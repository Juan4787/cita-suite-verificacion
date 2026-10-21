import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMocks = vi.hoisted(() => ({
	enforceRateLimits: vi.fn(),
	pendingBusinessCreationRateLimitRules: vi.fn((userId: string, ip?: string | null) => [
		{ action: 'pending_business_creation_by_user', subject: userId },
		...(ip ? [{ action: 'pending_business_creation_by_ip', subject: ip }] : [])
	])
}));

const supabaseMocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(async () => {
		throw new Error('admin no disponible en test unitario');
	})
}));

vi.mock('$lib/server/platform/supabase', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/platform/supabase')>('$lib/server/platform/supabase');
	return {
		...actual,
		createSupabaseAdminClient: supabaseMocks.createSupabaseAdminClient
	};
});

vi.mock('$lib/server/platform/rate-limits', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/platform/rate-limits')>('$lib/server/platform/rate-limits');
	return {
		...actual,
		enforceRateLimits: rateLimitMocks.enforceRateLimits,
		pendingBusinessCreationRateLimitRules: rateLimitMocks.pendingBusinessCreationRateLimitRules
	};
});

import {
	DefaultBusinessSetupUnavailableError,
	resolveActiveBusiness
} from '$lib/server/access/public/business';
import { RateLimitUnavailableError } from '$lib/server/platform/rate-limits';

const accessTokenFor = (userId: string, email?: string) => {
	const payload = Buffer.from(JSON.stringify({ sub: userId, ...(email ? { email } : {}) })).toString('base64url');
	return `test.${payload}.signature`;
};

const businessRow = {
	id: 'business-1',
	name: 'Consultorio test',
	slug: 'consultorio-test',
	industry: 'odontology',
	phone: null,
	email: null,
	address: null,
	logo_url: null,
	timezone: 'America/Argentina/Cordoba',
	public_booking_enabled: true,
	whatsapp_enabled: false,
	allow_same_day_booking: false,
	min_booking_notice_minutes: 1440,
	max_booking_days_ahead: 60,
	cancellation_policy: null,
	is_active: true,
	created_at: '2026-06-01T00:00:00.000Z',
	updated_at: '2026-06-01T00:00:00.000Z'
};

const subscriptionRow = {
	id: 'subscription-1',
	business_id: 'business-1',
	commercial_access_enabled: true,
	is_permanent: true,
	subscription_status: 'active',
	access_starts_at: null,
	paid_until: null,
	grace_until: null,
	restricted_until: null,
	archived_at: null,
	last_payment_at: null,
	last_payment_amount: null,
	last_grant_duration_seconds: null,
	expiration_notice_enabled: false,
	access_source: null,
	access_note: null,
	updated_by: null,
	created_at: '2026-06-01T00:00:00.000Z',
	updated_at: '2026-06-01T00:00:00.000Z'
};

describe('resolveActiveBusiness', () => {
	beforeEach(() => {
	rateLimitMocks.enforceRateLimits.mockReset();
		rateLimitMocks.enforceRateLimits.mockResolvedValue(undefined);
		rateLimitMocks.pendingBusinessCreationRateLimitRules.mockClear();
		supabaseMocks.createSupabaseAdminClient.mockReset();
		supabaseMocks.createSupabaseAdminClient.mockRejectedValue(new Error('admin no disponible en test unitario'));
	});

	it('loads the auto-created owner business after allowed-email bootstrap', async () => {
		const userId = 'user-allowed';
		const pendingSubscription = {
			...subscriptionRow,
			commercial_access_enabled: true,
			is_permanent: false,
			subscription_status: 'restricted',
			paid_until: null,
			grace_until: null,
			restricted_until: '2099-07-30T00:00:00.000Z',
			access_note: 'Cuenta pendiente de activación de suscripción.'
		};
		let contextReads = 0;
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn((name: string) => {
				if (name === 'list_user_business_contexts') {
					contextReads += 1;
					return Promise.resolve({
						data:
							contextReads === 1
								? []
								: [{ business: businessRow, role: 'owner', assistance: null, subscription: pendingSubscription }],
						error: null
					});
				}
				return Promise.resolve({ data: [{ business_id: 'business-1', role: 'owner' }], error: null });
			})
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context?.business.id).toBe('business-1');
		expect(context?.role).toBe('owner');
		expect(context?.access.commercialAccessEnabled).toBe(true);
		expect(context?.access.commercialStatus).toBe('restricted');
		expect(context?.access.canUseBusiness).toBe(false);
		expect(supabase.rpc).toHaveBeenCalledWith('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
		expect(rateLimitMocks.pendingBusinessCreationRateLimitRules).toHaveBeenCalledWith(
			userId,
			undefined
		);
		expect(rateLimitMocks.enforceRateLimits).toHaveBeenCalledOnce();
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('detiene el alta con un error específico si no puede comprobar su límite', async () => {
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async (name: string) => {
				if (name === 'list_user_business_contexts') return { data: [], error: null };
				throw new Error(`No debía ejecutar ${name}`);
			})
		} as any;
		rateLimitMocks.enforceRateLimits.mockRejectedValueOnce(
			new RateLimitUnavailableError(new Error('service role ausente'))
		);

		await expect(
			resolveActiveBusiness({
				supabase,
				accessToken: accessTokenFor('user-sin-control')
			})
		).rejects.toBeInstanceOf(DefaultBusinessSetupUnavailableError);
		expect(supabase.rpc).not.toHaveBeenCalledWith('ensure_user_default_business', expect.anything());
	});

	it('las invitaciones pendientes no consumen el límite de altas por IP', async () => {
		const inviteQuery = {
			select: vi.fn(() => inviteQuery),
			eq: vi.fn(() => inviteQuery),
			limit: vi.fn(() => inviteQuery),
			maybeSingle: vi.fn(async () => ({ data: { id: 'invite-1' }, error: null }))
		};
		supabaseMocks.createSupabaseAdminClient.mockResolvedValue({ from: vi.fn(() => inviteQuery) } as never);
		const userId = 'user-invited';
		const email = 'invited@example.com';
		let contextReads = 0;
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async (name: string) => {
				if (name === 'list_user_business_contexts') {
					contextReads += 1;
					return contextReads === 1
						? { data: [], error: null }
						: { data: [{ role: 'owner', business: businessRow, subscription: subscriptionRow }], error: null };
				}
				if (name === 'ensure_user_default_business') return { data: [], error: null };
				throw new Error(`Unexpected RPC ${name}`);
			})
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			userId,
			accessToken: accessTokenFor(userId, email),
			defaultBusinessCreationIp: '203.0.113.10'
		} as any);

		expect(context?.business.id).toBe('business-1');
		expect(rateLimitMocks.enforceRateLimits).not.toHaveBeenCalled();
		expect(rateLimitMocks.pendingBusinessCreationRateLimitRules).not.toHaveBeenCalled();
		expect(supabase.rpc).toHaveBeenCalledWith('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
	});

	it('no devuelve null silenciosamente si el alta terminó pero la membresía no aparece', async () => {
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async (name: string) => {
				if (name === 'list_user_business_contexts') return { data: [], error: null };
				if (name === 'ensure_user_default_business') {
					return { data: [{ business_id: 'business-1', role: 'owner' }], error: null };
				}
				throw new Error(`Unexpected RPC ${name}`);
			})
		} as any;

		await expect(
			resolveActiveBusiness({
				supabase,
				accessToken: accessTokenFor('user-sin-membresia-visible')
			})
		).rejects.toBeInstanceOf(DefaultBusinessSetupUnavailableError);
	});

	it('coalesce dos cargas concurrentes para no crear ni contabilizar el consultorio dos veces', async () => {
		let membershipReads = 0;
		let ensureCalls = 0;
		let releaseEnsure: () => void = () => {};
		const ensurePending = new Promise<void>((resolve) => {
			releaseEnsure = resolve;
		});
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async (name: string) => {
				if (name === 'list_user_business_contexts') {
					membershipReads += 1;
					return {
						data:
							membershipReads <= 2
								? []
								: [
										{
											business: businessRow,
											role: 'owner',
											assistance: null,
											subscription: subscriptionRow
										}
									],
						error: null
					};
				}
				if (name === 'ensure_user_default_business') {
					ensureCalls += 1;
					await ensurePending;
					return { data: [{ business_id: 'business-1', role: 'owner' }], error: null };
				}
				throw new Error(`Unexpected RPC ${name}`);
			})
		} as any;
		const options = () => ({
			supabase,
			accessToken: accessTokenFor('concurrent-bootstrap-user')
		});

		const first = resolveActiveBusiness(options());
		const second = resolveActiveBusiness(options());
		await vi.waitFor(() => expect(ensureCalls).toBe(1));
		releaseEnsure();

		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(ensureCalls).toBe(1);
		expect(rateLimitMocks.enforceRateLimits).toHaveBeenCalledOnce();
	});

	it('recovers an accepted invite membership after bootstrap race', async () => {
		const userId = 'user-1';
		let contextReads = 0;
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn((name: string) => {
				if (name === 'list_user_business_contexts') {
					contextReads += 1;
					return Promise.resolve({
						data:
							contextReads === 1
								? []
								: [{ business: businessRow, role: 'professional', assistance: null, subscription: subscriptionRow }],
						error: null
					});
				}
				return Promise.resolve({
					data: null,
					error: { message: 'DEFAULT_BUSINESS_CREATION_DISABLED' }
				});
			})
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context?.business.id).toBe('business-1');
		expect(context?.role).toBe('professional');
		expect(context?.canManage).toBe(false);
		expect(context?.canOperate).toBe(false);
		expect(context?.access.commercialStatus).toBe('active');
		expect(supabase.rpc).toHaveBeenCalledWith('ensure_user_default_business', {
			p_name: 'Consultorio',
			p_industry: 'odontology'
		});
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('recovers the accepted invite when a concurrent bootstrap sees the email association', async () => {
		const userId = 'user-concurrent-invite';
		let contextReads = 0;
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn((name: string) => {
				if (name === 'list_user_business_contexts') {
					contextReads += 1;
					return Promise.resolve({
						data:
							contextReads === 1
								? []
								: [
										{
											business: businessRow,
											role: 'professional',
											assistance: null,
											subscription: subscriptionRow
										}
									],
						error: null
					});
				}
				if (name === 'ensure_user_default_business') {
					return Promise.resolve({
						data: null,
						error: { code: 'P0001', message: 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS' }
					});
				}
				throw new Error(`Unexpected RPC ${name}`);
			})
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context).toMatchObject({
			business: { id: 'business-1' },
			role: 'professional'
		});
		expect(contextReads).toBe(2);
	});

	it('resolves an active account assistance grant as an admin context for support', async () => {
		const userId = 'master-user';
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn((name: string) => {
				if (name !== 'list_user_business_contexts') throw new Error(`Unexpected RPC ${name}`);
				return Promise.resolve({
					data: [
						{
							business: businessRow,
							role: 'admin',
							assistance: {
								grantId: 'assist-1',
								requestedByUserId: 'owner-1',
								supportUserId: userId,
								startsAt: '2026-07-08T20:45:00.000Z',
								expiresAt: '2099-07-08T21:45:00.000Z'
							},
							subscription: subscriptionRow
						}
					],
					error: null
				});
			})
		} as any;

		const context = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor(userId)
		});

		expect(context?.business.id).toBe('business-1');
		expect(context?.role).toBe('admin');
		expect(context?.canManage).toBe(true);
		expect(context?.canOperate).toBe(true);
		expect(context?.assistance).toMatchObject({
			grantId: 'assist-1',
			requestedByUserId: 'owner-1',
			supportUserId: userId
		});
		// Which grants count is decided in SQL (supabase/tests/user_business_contexts.sql).
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('uses the consolidated RPC and reuses it inside the same request', async () => {
		const supabase = {
			from: vi.fn(() => {
				throw new Error('Legacy queries must not run when the RPC is available');
			}),
			rpc: vi.fn((name: string) => {
				if (name !== 'list_user_business_contexts') throw new Error(`Unexpected RPC ${name}`);
				return Promise.resolve({
					data: [
						{
							business: businessRow,
							role: 'owner',
							assistance: null,
							subscription: subscriptionRow
						}
					],
					error: null
				});
			})
		} as any;
		const cookies = {
			get: vi.fn(() => null),
			set: vi.fn()
		} as any;

		const first = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor('rpc-user'),
			cookies
		});
		const second = await resolveActiveBusiness({
			supabase,
			accessToken: accessTokenFor('rpc-user'),
			cookies
		});

		expect(first?.business.id).toBe('business-1');
		expect(second?.access.canUseBusiness).toBe(true);
		expect(supabase.rpc).toHaveBeenCalledTimes(1);
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it.each([
		null,
		{ business: businessRow },
		[{ business: null, role: 'owner', subscription: subscriptionRow }],
		[{ business: { ...businessRow, is_active: 'true' }, role: 'owner', subscription: subscriptionRow }],
		[{ business: businessRow, role: 'unknown-role', subscription: subscriptionRow }],
		[{ business: businessRow, role: 'owner', subscription: { ...subscriptionRow, is_permanent: 'true' } }],
		[{ business: businessRow, role: 'owner', subscription: { ...subscriptionRow, business_id: 'other-business' } }]
	])('rejects an invalid or cross-tenant JSON context without attempting bootstrap (%#)', async (data) => {
		const supabase = { rpc: vi.fn().mockResolvedValue({ data, error: null }) } as any;
		await expect(resolveActiveBusiness({ supabase, accessToken: accessTokenFor('json-user') }))
			.rejects.toMatchObject({ name: 'InvalidDataContractError' });
		expect(supabase.rpc).toHaveBeenCalledTimes(1);
		expect(supabase.rpc).toHaveBeenCalledWith('list_user_business_contexts');
	});

	it('revalidates membership on a different request with the same authenticated session', async () => {
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async (name: string) => {
				if (name !== 'list_user_business_contexts') throw new Error(`Unexpected RPC ${name}`);
				return {
					data: [
						{
							business: businessRow,
							role: 'owner',
							assistance: null,
							subscription: subscriptionRow
						}
					],
					error: null
				};
			})
		} as any;
		const firstCookies = { get: vi.fn(() => null), set: vi.fn() } as any;
		const secondCookies = { get: vi.fn(() => null), set: vi.fn() } as any;
		const accessToken = accessTokenFor('short-cache-user');

		const first = await resolveActiveBusiness({
			supabase,
			accessToken,
			cookies: firstCookies,
			membershipCache: 'request'
		});
		const second = await resolveActiveBusiness({
			supabase,
			accessToken,
			cookies: secondCookies,
			membershipCache: 'request'
		});

		expect(first?.business.id).toBe('business-1');
		expect(second?.business.id).toBe('business-1');
		expect(supabase.rpc).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent reads only inside the same request', async () => {
		let releaseRpc: (value: unknown) => void = () => {};
		const rpcResult = new Promise((resolve) => {
			releaseRpc = resolve;
		});
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(() => rpcResult)
		} as any;
		const accessToken = accessTokenFor('single-flight-user');
		const cookies = { get: vi.fn(() => null), set: vi.fn() } as any;

		const firstPending = resolveActiveBusiness({
			supabase,
			accessToken,
			cookies,
			membershipCache: 'request'
		});
		const secondPending = resolveActiveBusiness({
			supabase,
			accessToken,
			cookies,
			membershipCache: 'request'
		});

		await Promise.resolve();
		expect(supabase.rpc).toHaveBeenCalledTimes(1);
		releaseRpc({
			data: [
				{
					business: businessRow,
					role: 'owner',
					assistance: null,
					subscription: subscriptionRow
				}
			],
			error: null
		});

		await expect(Promise.all([firstPending, secondPending])).resolves.toHaveLength(2);
		expect(supabase.rpc).toHaveBeenCalledTimes(1);
	});

	it('does not reuse a revoked membership or role across requests', async () => {
		const supabase = {
			rpc: vi.fn()
				.mockResolvedValueOnce({ data: [{ business: businessRow, role: 'owner', subscription: subscriptionRow }], error: null })
				.mockResolvedValueOnce({ data: [{ business: businessRow, role: 'readonly', subscription: subscriptionRow }], error: null })
				.mockResolvedValueOnce({ data: [], error: null })
		} as any;
		const request = () => ({ supabase, accessToken: accessTokenFor('revoked-user'),
			cookies: { get: vi.fn(() => null), set: vi.fn() } as any,
			ensureDefault: false, membershipCache: 'request' as const });
		await expect(resolveActiveBusiness(request())).resolves.toMatchObject({ role: 'owner', canManage: true });
		await expect(resolveActiveBusiness(request())).resolves.toMatchObject({ role: 'readonly', canManage: false });
		await expect(resolveActiveBusiness(request())).resolves.toBeNull();
		expect(supabase.rpc).toHaveBeenCalledTimes(3);
	});

	it('does not share a request read when the identity or its token changes', async () => {
		const supabase = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as any;
		const cookies = { get: vi.fn(() => null), set: vi.fn() } as any;
		for (const accessToken of [accessTokenFor('first-user'), accessTokenFor('second-user'), accessTokenFor('second-user', 'renewed@example.test')]) {
			await resolveActiveBusiness({ supabase, cookies, accessToken, ensureDefault: false, membershipCache: 'request' });
		}
		expect(supabase.rpc).toHaveBeenCalledTimes(3);
	});

	it('fresh reads revalidate authorization even inside the same request', async () => {
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async () => ({
				data: [
					{
						business: businessRow,
						role: 'owner',
						assistance: null,
						subscription: subscriptionRow
					}
				],
				error: null
			}))
		} as any;
		const accessToken = accessTokenFor('fresh-bypass-user');
		const cookies = { get: vi.fn(() => null), set: vi.fn() } as any;

		await resolveActiveBusiness({
			supabase,
			accessToken,
			cookies,
			membershipCache: 'request'
		});
		await resolveActiveBusiness({
			supabase,
			accessToken,
			cookies,
			membershipCache: 'fresh'
		});

		expect(supabase.rpc).toHaveBeenCalledTimes(2);
	});

	it('observes commercial restriction on the next request and a fresh child check', async () => {
		const restrictedSubscription = {
			...subscriptionRow,
			is_permanent: false,
			subscription_status: 'restricted',
			paid_until: '2026-07-20T00:00:00.000Z',
			grace_until: '2026-07-21T00:00:00.000Z',
			restricted_until: '2099-07-21T00:00:00.000Z'
		};
		const supabase = {
			from: vi.fn(),
			rpc: vi
				.fn()
				.mockResolvedValueOnce({
					data: [
						{
							business: businessRow,
							role: 'owner',
							assistance: null,
							subscription: subscriptionRow
						}
					],
					error: null
				})
				.mockResolvedValue({
					data: [
						{
							business: businessRow,
							role: 'owner',
							assistance: null,
							subscription: restrictedSubscription
						}
					],
					error: null
				})
		} as any;
		const accessToken = accessTokenFor('mixed-cache-user');
		const makeCookies = () => ({ get: vi.fn(() => null), set: vi.fn() }) as any;

		await resolveActiveBusiness({
			supabase,
			accessToken,
			cookies: makeCookies(),
			membershipCache: 'request'
		});

		const requestCookies = makeCookies();
		await expect(
			resolveActiveBusiness({
				supabase,
				accessToken,
				cookies: requestCookies,
				membershipCache: 'request'
			})
		).resolves.toMatchObject({ access: { canUseBusiness: false } });
		await expect(
			resolveActiveBusiness({
				supabase,
				accessToken,
				cookies: requestCookies,
				membershipCache: 'fresh'
			})
		).resolves.toMatchObject({ access: { canUseBusiness: false } });

		expect(supabase.rpc).toHaveBeenCalledTimes(3);
	});

	it('stops using a cached assistance grant as soon as its exact expiry is reached', async () => {
		let now = Date.parse('2026-07-25T12:00:00.000Z');
		const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
		const supabase = {
			from: vi.fn(),
			rpc: vi.fn(async () => ({
				data: [
					{
						business: businessRow,
						role: 'admin',
						assistance: {
							grantId: 'grant-1',
							requestedByUserId: 'owner-1',
							supportUserId: 'support-1',
							startsAt: '2026-07-25T11:59:00.000Z',
							expiresAt: '2026-07-25T12:00:05.000Z'
						},
						subscription: subscriptionRow
					}
				],
				error: null
			}))
		} as any;
		const accessToken = accessTokenFor('support-1');

		try {
			await expect(
				resolveActiveBusiness({
					supabase,
					accessToken,
					cookies: { get: vi.fn(() => null), set: vi.fn() } as any,
					ensureDefault: false,
					membershipCache: 'request'
				})
			).resolves.toMatchObject({ assistance: { grantId: 'grant-1' } });

			now += 6_000;
			await expect(
				resolveActiveBusiness({
					supabase,
					accessToken,
					cookies: { get: vi.fn(() => null), set: vi.fn() } as any,
					ensureDefault: false,
					membershipCache: 'request'
				})
			).resolves.toBeNull();
			expect(supabase.rpc).toHaveBeenCalledTimes(2);
		} finally {
			nowSpy.mockRestore();
		}
	});

	it('does not retain failed or empty reads', async () => {
		const supabase = {
			from: vi.fn(),
			rpc: vi
				.fn()
				.mockRejectedValueOnce(new Error('temporary failure'))
				.mockResolvedValueOnce({ data: [], error: null })
				.mockResolvedValueOnce({
					data: [
						{
							business: businessRow,
							role: 'owner',
							assistance: null,
							subscription: subscriptionRow
						}
					],
					error: null
				})
		} as any;
		const accessToken = accessTokenFor('retry-cache-user');
		const options = () => ({
			supabase,
			accessToken,
			cookies: { get: vi.fn(() => null), set: vi.fn() } as any,
			ensureDefault: false,
			membershipCache: 'request' as const
		});

		await expect(resolveActiveBusiness(options())).rejects.toThrow('temporary failure');
		await expect(resolveActiveBusiness(options())).resolves.toBeNull();
		await expect(resolveActiveBusiness(options())).resolves.toMatchObject({
			business: { id: 'business-1' }
		});
		expect(supabase.rpc).toHaveBeenCalledTimes(3);
	});
});
