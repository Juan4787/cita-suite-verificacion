import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import {
	authorizeGoogleCalendarAppointment,
	consumeGoogleCalendarOAuthAttempt,
	createGoogleCalendarAuthorizationUrl,
	decryptGoogleCalendarSecret,
	deterministicGoogleCalendarEventId,
	encryptGoogleCalendarSecret,
	googleCalendarEventResource,
	googleCalendarReminderMinutes,
	isGoogleCalendarConfigured,
	loadGoogleCalendarUiState,
	parseGoogleCalendarEncryptionKey,
	requestGoogleCalendarEventDeletion
} from './google-calendar';
import type { PublicAppointmentView } from './public-appointments';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const KEY = Buffer.alloc(32, 7);

const appointment = (overrides: Partial<PublicAppointmentView> = {}): PublicAppointmentView => ({
	id: '11111111-1111-4111-8111-111111111111',
	token: 'turno-secreto',
	status: 'reserved',
	starts_at: '2026-08-10T15:00:00.000Z',
	ends_at: '2026-08-10T15:30:00.000Z',
	service_name_snapshot: 'Tratamiento que no debe exponerse',
	professional_name_snapshot: 'Dra. Ramírez',
	professional_count: 1,
	is_joint: false,
	calendar_action_status: 'offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 3,
	calendar_update_required_at: null,
	business: {
		id: '22222222-2222-4222-8222-222222222222',
		name: 'Consultorio Ramírez',
		slug: 'consultorio-ramirez',
		phone: null,
		address: 'Av. Siempre Viva 123',
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		timezone: 'America/Argentina/Buenos_Aires',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: 'Paciente que no debe exponerse',
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false,
	...overrides
});

beforeEach(() => {
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	for (const key of Object.keys(envState.publicEnv)) delete envState.publicEnv[key];
	envState.privateEnv.GOOGLE_CALENDAR_MANAGED_ENABLED = 'true';
	envState.privateEnv.GOOGLE_CALENDAR_CLIENT_ID = 'calendar-client.apps.googleusercontent.com';
	envState.privateEnv.GOOGLE_CALENDAR_CLIENT_SECRET = 'server-secret';
	envState.privateEnv.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = KEY.toString('base64');
	envState.privateEnv.PUBLIC_SITE_URL = 'https://cita-suite.example';
});

describe('secretos Google Calendar', () => {
	it('cifra con AES-GCM y detecta clave, propósito o contenido incorrectos', () => {
		const ciphertext = encryptGoogleCalendarSecret('refresh-token', KEY);
		expect(ciphertext).not.toContain('refresh-token');
		expect(decryptGoogleCalendarSecret(ciphertext, KEY)).toBe('refresh-token');
		expect(() => decryptGoogleCalendarSecret(ciphertext, Buffer.alloc(32, 8))).toThrow(
			'GOOGLE_CALENDAR_SECRET_INVALID'
		);
		expect(() => decryptGoogleCalendarSecret(ciphertext, KEY, 'oauth_verifier')).toThrow(
			'GOOGLE_CALENDAR_SECRET_INVALID'
		);
		const tamperedParts = ciphertext.split('.');
		tamperedParts[3] = `${tamperedParts[3]?.startsWith('A') ? 'B' : 'A'}${tamperedParts[3]?.slice(1)}`;
		const tampered = tamperedParts.join('.');
		expect(() => decryptGoogleCalendarSecret(tampered, KEY)).toThrow(
			'GOOGLE_CALENDAR_SECRET_INVALID'
		);
	});

	it('acepta únicamente claves de 32 bytes y configuración dedicada', () => {
		expect(parseGoogleCalendarEncryptionKey(KEY.toString('hex'))).toEqual(KEY);
		expect(parseGoogleCalendarEncryptionKey(KEY.toString('base64url'))).toEqual(KEY);
		expect(() => parseGoogleCalendarEncryptionKey('no-es-una-clave')).toThrow();
		expect(isGoogleCalendarConfigured()).toBe(true);
		delete envState.privateEnv.GOOGLE_CALENDAR_CLIENT_ID;
		envState.publicEnv.PUBLIC_GOOGLE_CLIENT_ID = 'legacy-public-client.apps.googleusercontent.com';
		expect(isGoogleCalendarConfigured()).toBe(false);
	});

	it('queda deshabilitado por defecto aunque las credenciales sigan disponibles', async () => {
		envState.privateEnv.GOOGLE_CALENDAR_CLIENT_ID = 'calendar-client.apps.googleusercontent.com';
		envState.privateEnv.GOOGLE_CALENDAR_MANAGED_ENABLED = 'false';
		expect(isGoogleCalendarConfigured()).toBe(false);
		const from = vi.fn(() => {
			throw new Error('no debe consultar vínculos mientras está apagado');
		});
		await expect(loadGoogleCalendarUiState({ from } as any, appointment())).resolves.toMatchObject({
			available: false,
			state: 'none',
			current: false
		});
		expect(from).not.toHaveBeenCalled();

		const rpc = vi.fn();
		await expect(
			consumeGoogleCalendarOAuthAttempt(
				{ rpc } as any,
				'state-abcdefghijklmnopqrstuvwxyz-123456'
			)
		).rejects.toThrow('GOOGLE_CALENDAR_NOT_CONFIGURED');
		expect(rpc).not.toHaveBeenCalled();

		await expect(
			requestGoogleCalendarEventDeletion({ rpc } as any, appointment().id, fetch)
		).resolves.toEqual({ status: 'not_configured' });
		expect(rpc).not.toHaveBeenCalled();
	});
});

describe('inicio OAuth', () => {
	it('usa state de un solo uso, PKCE, acceso offline y no persiste secretos en claro', async () => {
		let inserted: Record<string, unknown> | null = null;
		const chain: any = {
			delete: () => chain,
			lt: async () => ({ data: null, error: null }),
			insert: async (value: Record<string, unknown>) => {
				inserted = value;
				return { error: null };
			}
		};
		const supabase = { from: () => chain } as any;

		const authorizationUrl = new URL(
			await createGoogleCalendarAuthorizationUrl(supabase, appointment(), {
				now: new Date('2026-08-04T12:00:00.000Z')
			})
		);
		const state = authorizationUrl.searchParams.get('state')!;
		expect(authorizationUrl.origin).toBe('https://accounts.google.com');
		expect(authorizationUrl.searchParams.get('access_type')).toBe('offline');
		expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorizationUrl.searchParams.get('prompt')).toBe('select_account');
		expect(authorizationUrl.searchParams.get('scope')).toContain(CALENDAR_SCOPE);
		expect(authorizationUrl.searchParams.has('include_granted_scopes')).toBe(false);
		expect(inserted).not.toBeNull();
		expect(inserted!.state_hash).toBe(crypto.createHash('sha256').update(state).digest('hex'));
		expect(inserted!.state_hash).not.toBe(state);
		expect(String(inserted!.code_verifier_ciphertext)).toMatch(/^v1\./);
		expect(JSON.stringify(inserted)).not.toContain('turno-secreto');

		const verifier = decryptGoogleCalendarSecret(
			String(inserted!.code_verifier_ciphertext),
			KEY,
			'oauth_verifier'
		);
		const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
		expect(authorizationUrl.searchParams.get('code_challenge')).toBe(challenge);
	});

	it('fuerza consentimiento solamente al reconectar', async () => {
		const chain: any = {
			delete: () => chain,
			lt: async () => ({ data: null, error: null }),
			insert: async () => ({ error: null })
		};
		const url = new URL(
			await createGoogleCalendarAuthorizationUrl({ from: () => chain } as any, appointment(), {
				forceConsent: true
			})
		);
		expect(url.searchParams.get('prompt')).toBe('consent select_account');
	});
});

describe('evento y autorización', () => {
	it('genera un ID remoto estable e idempotente', () => {
		const first = deterministicGoogleCalendarEventId(appointment().id);
		expect(first).toBe(deterministicGoogleCalendarEventId(appointment().id));
		expect(first).toMatch(/^[a-v0-9]{5,1024}$/);
		expect(first).not.toBe(deterministicGoogleCalendarEventId('otro-turno'));
	});

	it('crea un evento privado, neutral, versionado y con avisos explícitos', () => {
		const event = googleCalendarEventResource(
			appointment(),
			new Date('2026-08-08T12:00:00.000Z')
		);
		expect(event.visibility).toBe('private');
		expect(event.extendedProperties.private.citaSuiteSequence).toBe('3');
		expect(event.reminders).toEqual({
			useDefault: false,
			overrides: [
				{ method: 'popup', minutes: 1440 },
				{ method: 'popup', minutes: 120 }
			]
		});
		expect(event.summary).toBe('Turno en Consultorio Ramírez');
		expect(event.description).not.toContain('Tratamiento que no debe exponerse');
		expect(event.description).not.toContain('Paciente que no debe exponerse');
	});

	it('reduce avisos según la proximidad y nunca programa uno que ya pasó', () => {
		const start = new Date('2026-08-10T15:00:00.000Z');
		expect(googleCalendarReminderMinutes(start, new Date('2026-08-08T12:00:00.000Z'))).toEqual([
			1440,
			120
		]);
		expect(googleCalendarReminderMinutes(start, new Date('2026-08-10T13:30:00.000Z'))).toEqual([
			30
		]);
		expect(googleCalendarReminderMinutes(start, new Date('2026-08-10T14:45:00.000Z'))).toEqual([]);
	});

	it('cifra el refresh token y persiste solo un subject contextual', async () => {
		let rpcInput: Record<string, unknown> | null = null;
		const supabase = {
			rpc: async (_name: string, input: Record<string, unknown>) => {
				rpcInput = input;
				return {
					data: [{ event_row_id: '33333333-3333-4333-8333-333333333333' }],
					error: null
				};
			}
		} as any;
		const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/token')) {
				return new Response(
					JSON.stringify({
						access_token: 'access-secret',
						refresh_token: 'refresh-secret',
						scope: `openid ${CALENDAR_SCOPE}`
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			return new Response(JSON.stringify({ sub: 'google-subject-in-clear' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as unknown as typeof fetch;

		await authorizeGoogleCalendarAppointment(
			supabase,
			{
				attemptId: 'attempt',
				businessId: appointment().business.id,
				appointmentId: appointment().id,
				codeVerifier: 'verifier',
				forceConsent: false
			},
			'authorization-code',
			fetchFn
		);

		expect(rpcInput).not.toBeNull();
		expect(rpcInput!.p_google_subject).toMatch(/^[0-9a-f]{64}$/);
		expect(rpcInput!.p_google_subject).not.toBe('google-subject-in-clear');
		expect(String(rpcInput!.p_refresh_token_ciphertext)).not.toContain('refresh-secret');
		expect(
			decryptGoogleCalendarSecret(String(rpcInput!.p_refresh_token_ciphertext), KEY)
		).toBe('refresh-secret');
	});
});
