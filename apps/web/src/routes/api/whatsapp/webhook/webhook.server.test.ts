import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/platform/supabase', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/platform/supabase')>()),
	createSupabaseAdminClient: vi.fn()
}));

const { POST } = await import('./+server');

describe('POST /api/whatsapp/webhook', () => {
	it('rejects without the app secret before reading a body anyone can inflate', async () => {
		const request = new Request('https://app.test/api/whatsapp/webhook', {
			method: 'POST',
			headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
			body: JSON.stringify({ entry: [], padding: 'x'.repeat(70_000) })
		});

		const response = await POST({ request, fetch: vi.fn() } as never);

		expect(response.status).toBe(401);
		expect(request.bodyUsed).toBe(false);
	});
});
