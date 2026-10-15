import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));

const { GET } = await import('./+server');
const token = 'a'.repeat(43);

const callGet = (value = token) =>
	GET({ params: { token: value }, fetch: vi.fn() } as unknown as Parameters<typeof GET>[0]);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /r/[token]', () => {
	it('registra el hash y redirige inmediatamente al enlace de Google', async () => {
		const rpc = vi.fn(() => ({
			maybeSingle: async () => ({
				data: { review_url: 'https://g.page/r/AbCdEf123/review' },
				error: null
			})
		}));
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc });

		const response = await callGet();
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('https://g.page/r/AbCdEf123/review');
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(rpc).toHaveBeenCalledWith('record_google_review_click', {
			target_click_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
			click_time: expect.any(String)
		});
		expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
	});

	it('rechaza un token mal formado sin consultar la base', async () => {
		const response = await callGet('invalido');
		expect(response.status).toBe(404);
		expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it('no redirige si el destino persistido no pertenece a Google', async () => {
		mocks.createSupabaseAdminClient.mockResolvedValue({
			rpc: () => ({
				maybeSingle: async () => ({
					data: { review_url: 'https://example.com/phishing' },
					error: null
				})
			})
		});

		const response = await callGet();
		expect(response.status).toBe(404);
		expect(response.headers.get('location')).toBeNull();
	});
});
