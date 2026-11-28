import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	rpc: vi.fn()
}));

vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: vi.fn(async () => ({ rpc: mocks.rpc }))
}));
vi.mock('$lib/server/platform/rate-limits', () => ({
	hashRateLimitSubject: () => 'hashed-ip'
}));

const { GET } = await import('./+server');

const KEY = 'ab'.repeat(16);

describe('AF1-010: GET /api/public/contacto/[integrationKey]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns HTTP 200 with CORS headers and null phone/address when public_contact_enabled is off', async () => {
		mocks.rpc.mockImplementation(async (name: string) => {
			if (name === 'consume_booking_integration_read_limit') return { data: true, error: null };
			if (name === 'get_public_practice_contact') {
				return {
					data: {
						allowed_origins: ['https://natalia.example.test'],
						contact: {
							phone: null,
							address: null,
							whatsapp_phone: null,
							whatsapp_message: null
						}
					},
					error: null
				};
			}
			throw new Error(`Unexpected rpc: ${name}`);
		});

		const response = await GET({
			params: { integrationKey: KEY },
			request: new Request(`https://app.test/api/public/contacto/${KEY}`, {
				headers: { origin: 'https://natalia.example.test' }
			}),
			fetch: vi.fn(),
			setHeaders: vi.fn(),
			getClientAddress: () => '127.0.0.1'
		} as never);

		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe('https://natalia.example.test');
		await expect(response.json()).resolves.toEqual({
			contact: {
				phone: null,
				email: null,
				address: null,
				whatsapp_phone: null,
				whatsapp_message: null
			}
		});
	});

	it('P9: devuelve contact.email cuando public_contact_enabled está prendido y null si está vacío', async () => {
		mocks.rpc.mockImplementation(async (name: string) => {
			if (name === 'consume_booking_integration_read_limit') return { data: true, error: null };
			if (name === 'get_public_practice_contact') {
				return {
					data: {
						allowed_origins: ['https://natalia.example.test'],
						contact: {
							phone: '+5493415550000',
							email: 'consultas@consultorio.test',
							address: 'Calle 123',
							whatsapp_phone: null,
							whatsapp_message: null
						}
					},
					error: null
				};
			}
			throw new Error(`Unexpected rpc: ${name}`);
		});

		const response = await GET({
			params: { integrationKey: KEY },
			request: new Request(`https://app.test/api/public/contacto/${KEY}`, {
				headers: { origin: 'https://natalia.example.test' }
			}),
			fetch: vi.fn(),
			setHeaders: vi.fn(),
			getClientAddress: () => '127.0.0.1'
		} as never);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			contact: {
				phone: '+5493415550000',
				email: 'consultas@consultorio.test',
				address: 'Calle 123',
				whatsapp_phone: null,
				whatsapp_message: null
			}
		});
	});
});
