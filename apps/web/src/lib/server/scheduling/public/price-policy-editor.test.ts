import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));

const { loadPricePolicyEditor } = await import('./price-policy-editor');

// A query builder: every chained call returns it, and awaiting it gives `result`.
const query = (result: unknown) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
				: () => builder
	});
	return builder;
};

describe('price policy editor', () => {
	it('answers not found for an identifier that is not one, without querying', async () => {
		const from = vi.fn();
		mocks.getOdontoContext.mockResolvedValue({
			supabase: { from },
			business: { canManage: true, role: 'owner', business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' } },
			userId: 'user-1'
		});

		await expect(
			loadPricePolicyEditor({ params: { professionalId: 'x,business_id.is.null' } } as never)
		).rejects.toMatchObject({ status: 404 });
		expect(from).not.toHaveBeenCalled();
	});

	it('answers not found for a professional the practice does not have', async () => {
		mocks.getOdontoContext.mockResolvedValue({
			supabase: {
				from: vi.fn((table: string) => query(table === 'professionals' ? { data: null, error: null } : { data: [], error: null }))
			},
			business: {
				canManage: true,
				role: 'owner',
				business: { id: 'business-1', timezone: 'America/Argentina/Buenos_Aires' },
				access: { canUseBusiness: true }
			},
			userId: 'user-1'
		});

		await expect(
			loadPricePolicyEditor({ params: { professionalId: '00000000-0000-4000-8000-000000000009' } } as never)
		).rejects.toMatchObject({ status: 404 });
	});
});
