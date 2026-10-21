import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOdontoContext: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getOdontoContext }));

const { loadPricePolicyEditor } = await import('./price-policy-editor');

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
});
