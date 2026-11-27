import { beforeEach, describe, expect, it, vi } from 'vitest';

// The page and its action against a database double: proves that reading never unsubscribes and
// what each answer becomes. The SQL suite proves the scope and permanence of the suppression.
const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn(), rpc: vi.fn() }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

const { load, actions } = await import('./+page.server');

const TOKEN = 'b'.repeat(64);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createSupabaseAdminClient.mockResolvedValue({ rpc: mocks.rpc });
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('baja de correos', () => {
	it('abrir el enlace sólo lee: los lectores automáticos de correo no dan de baja a nadie', async () => {
		mocks.rpc.mockResolvedValue({
			data: {
				status: 'active',
				business_name: 'Consultorio de prueba',
				unsubscribed: false,
				contact: { phone: '+54 342 429-3471', whatsapp_phone: '+5493424293471' }
			},
			error: null
		});
		const setHeaders = vi.fn();
		const data = await load({ params: { token: TOKEN }, setHeaders } as never);
		expect(data).toEqual({
			available: true,
			businessName: 'Consultorio de prueba',
			unsubscribed: false,
			contact: {
				phone: '+54 342 429-3471',
				whatsappPhone: '+5493424293471',
				whatsappUrl: expect.stringContaining('https://wa.me/5493424293471?text='),
				whatsappWebUrl: expect.stringContaining('https://web.whatsapp.com/send?phone=5493424293471&text=')
			}
		});
		expect(mocks.rpc.mock.calls).toEqual([['get_email_unsubscribe_state', { p_token: TOKEN }]]);
		expect(setHeaders).toHaveBeenCalledWith(expect.objectContaining({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }));
		expect(setHeaders.mock.calls[0][0]['x-robots-tag']).toContain('noindex');
	});

	it('un enlace vencido muestra sólo los datos de contacto públicos del consultorio (D2)', async () => {
		mocks.rpc.mockResolvedValue({
			data: {
				status: 'expired',
				business_name: 'Dra. Natalia Frutos',
				contact: { phone: '+54 342 429-3471', whatsapp_phone: '+5493424293471' }
			},
			error: null
		});
		const data = await load({ params: { token: TOKEN }, setHeaders: vi.fn() } as never);
		expect(data).toEqual({
			available: false,
			unavailableReason: 'expired',
			businessName: 'Dra. Natalia Frutos',
			contact: {
				phone: '+54 342 429-3471',
				whatsappPhone: '+5493424293471',
				whatsappUrl: expect.stringContaining('https://wa.me/5493424293471?text='),
				whatsappWebUrl: expect.stringContaining('https://web.whatsapp.com/send?phone=5493424293471&text=')
			}
		});
	});

	it('un enlace vencido de un consultorio sin contacto público habilitado no inventa enlaces', async () => {
		mocks.rpc.mockResolvedValue({
			data: {
				status: 'expired',
				business_name: 'Consultorio Privado',
				contact: { phone: null, whatsapp_phone: null }
			},
			error: null
		});
		expect(await load({ params: { token: TOKEN }, setHeaders: vi.fn() } as never)).toEqual({
			available: false,
			unavailableReason: 'expired',
			businessName: 'Consultorio Privado',
			contact: { phone: null, whatsappPhone: null, whatsappUrl: null, whatsappWebUrl: null }
		});
	});

	it('un enlace inválido o desconocido no revela de qué consultorio era (D2)', async () => {
		mocks.rpc.mockResolvedValue({ data: { status: 'invalid' }, error: null });
		expect(await load({ params: { token: TOKEN }, setHeaders: vi.fn() } as never)).toEqual({
			available: false,
			unavailableReason: 'invalid',
			businessName: null,
			contact: null
		});
	});

	it('una falla temporal de lectura se distingue de un enlace vencido o inválido (D2)', async () => {
		mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
		expect(await load({ params: { token: TOKEN }, setHeaders: vi.fn() } as never)).toEqual({
			available: false,
			unavailableReason: 'error',
			businessName: null,
			contact: null
		});
	});

	it('sólo el envío explícito da de baja', async () => {
		mocks.rpc.mockResolvedValue({ data: { business_name: 'Consultorio de prueba', unsubscribed: true }, error: null });
		const result = await actions.default({ params: { token: TOKEN } } as never);
		expect(result).toEqual({ done: true, businessName: 'Consultorio de prueba', unsubscribed: true });
		expect(mocks.rpc.mock.calls).toEqual([['apply_email_unsubscribe', { p_token: TOKEN }]]);
	});

	it('si no se pudo registrar, indica pedir la baja por WhatsApp o teléfono y nunca responder un correo (D2)', async () => {
		mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
		const result = await actions.default({ params: { token: TOKEN } } as never);
		expect(result).toMatchObject({
			status: 400,
			data: { message: expect.stringMatching(/No pudimos registrar tu pedido.*WhatsApp.*teléfono/i) }
		});
		expect((result as { data: { message: string } }).data.message).not.toMatch(/respond[eé]|contest[eé]|correos del consultorio/i);
	});
});
