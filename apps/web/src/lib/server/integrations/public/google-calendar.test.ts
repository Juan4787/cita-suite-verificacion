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
	processGoogleCalendarSyncBatch,
	requestGoogleCalendarEventDeletion
} from '$lib/server/integrations/public/google-calendar';
import { WORK_DEADLINE_MS, createJobBudget } from '$lib/server/integrations/internal/job-budget';
import type { PublicAppointmentView } from '$lib/server/scheduling/public/public-appointments';

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

describe('sincronización programada por lotes', () => {
	const now = new Date('2026-08-09T12:00:00.000Z');
	const claimedEvent = (index: number, overrides: Record<string, unknown> = {}) => ({
		event_row_id: `event-${index}`,
		business_id: '22222222-2222-4222-8222-222222222222',
		appointment_id: `apt-${index}`,
		connection_id: 'connection-1',
		calendar_id: 'primary',
		event_id: null,
		sync_status: 'pending_create',
		synced_sequence: -1,
		attempt_count: 0,
		business_turn: 1,
		refresh_token_ciphertext: encryptGoogleCalendarSecret('refresh-token', KEY),
		connection_revoked_at: null,
		...overrides
	});
	const appointmentRow = (id: string, overrides: Record<string, unknown> = {}) => ({
		id,
		confirmation_token: `turno-${id}`,
		status: 'reserved',
		starts_at: '2026-08-10T15:00:00.000Z',
		ends_at: '2026-08-10T15:30:00.000Z',
		professional_name_snapshot: 'Dra. Ramírez',
		calendar_sequence: 3,
		businesses: {
			name: 'Consultorio Ramírez',
			timezone: 'America/Argentina/Buenos_Aires',
			address: 'Av. Siempre Viva 123',
			address_instructions: null,
			maps_url: null
		},
		...overrides
	});
	const statusFor = (result: { outcome: string; failure_category?: string }) =>
		result.outcome === 'synced' ? 'active'
			: result.outcome === 'deleted' ? 'deleted'
				: result.outcome === 'delete_requested' ? 'pending_delete'
					: result.failure_category === 'authorization' ? 'needs_reconnect' : 'pending_create';
	const calendarDatabase = (options: {
		claimed: unknown[];
		appointments: Array<{ id: string }>;
		removedConnection?: string;
		released?: number;
	}) => {
		const timeline: string[] = [];
		const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
		const reads: string[][] = [];
		const supabase = {
			rpc: async (name: string, args: Record<string, unknown>) => {
				rpcCalls.push({ name, args });
				timeline.push(name);
				if (name === 'claim_google_calendar_sync_batch') return { data: options.claimed, error: null };
				if (name === 'complete_google_calendar_sync_batch') {
					const results = (args.p_results as Array<{ event_row_id: string; outcome: string; failure_category?: string }>).map((result) => ({
						event_row_id: result.event_row_id,
						status: statusFor(result),
						removed_connection_id: result.outcome === 'deleted' ? (options.removedConnection ?? null) : null
					}));
					return { data: { results, released: args.p_finish ? (options.released ?? 0) : 0 }, error: null };
				}
				return { data: null, error: { message: `unexpected ${name}` } };
			},
			from: (table: string) => {
				let ids: string[] = [];
				const chain: any = {
					select: () => chain,
					in: (_column: string, values: string[]) => {
						ids = values;
						reads.push(values);
						timeline.push(`read:${table}`);
						return chain;
					},
					retry: () => chain,
					then: (resolve: (value: unknown) => unknown) =>
						Promise.resolve({ data: options.appointments.filter((row) => ids.includes(row.id)), error: null }).then(resolve)
				};
				return chain;
			}
		} as any;
		return { supabase, rpcCalls, reads, timeline, completions: () => rpcCalls.filter((call) => call.name === 'complete_google_calendar_sync_batch') };
	};
	const google = (timeline: string[], handler?: (request: Request) => Response | Promise<Response> | undefined) => {
		const requests: Request[] = [];
		const fetchFn: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			requests.push(request);
			timeline.push(`${request.method} ${new URL(request.url).pathname}`);
			const answer = await handler?.(request.clone());
			if (answer) return answer;
			if (request.url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access-1', expires_in: 3600 });
			if (request.url === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 });
			if (request.method === 'POST') return Response.json({ id: (await request.json()).id });
			if (request.method === 'PATCH') return Response.json({ id: 'evt-existing' });
			if (request.method === 'DELETE') return new Response(null, { status: 204 });
			return new Response('{}', { status: 404 });
		};
		return { fetchFn, requests };
	};

	it.each([
		['manual sin contexto', null],
		['reserva virtual con contexto', {
			theme_snapshot: 'natalia',
			modality: 'video',
			video_instructions_snapshot: 'El consultorio coordina el acceso virtual.'
		}]
	])('procesa la relación uno a uno real de PostgREST: %s', async (_label, context) => {
		envState.privateEnv.BOOKING_CONTEXTS_AVAILABLE = 'true';
		const database = calendarDatabase({
			claimed: [claimedEvent(1, { sync_status: 'pending_update', event_id: 'evt-existing' })],
			appointments: [appointmentRow('apt-1', { appointment_booking_contexts: context })]
		});
		const service = google(database.timeline);
		const summary = await processGoogleCalendarSyncBatch({
			supabase: database.supabase,
			budget: createJobBudget('free'),
			providerFetch: service.fetchFn,
			now
		});
		expect(summary).toMatchObject({ claimed: 1, active: 1, attention: 0, retrying: 0 });
		const changed = service.requests.filter(request => request.method === 'PATCH');
		expect(changed).toHaveLength(1);
		const event = await changed[0].json();
		expect(event.extendedProperties.private.citaSuiteSequence).toBe('3');
		expect(event.location).toBe(context === null ? 'Av. Siempre Viva 123' : 'Consulta virtual');
		expect(event.description).not.toContain('Tratamiento que no debe exponerse');
		expect(event.description).not.toContain('Paciente que no debe exponerse');
		if (context !== null) expect(event.description).not.toContain('Av. Siempre Viva 123');
		expect(database.completions()).toHaveLength(1);
		expect(database.completions()[0].args.p_results).toEqual([
			{ event_row_id: 'event-1', outcome: 'synced', google_event_id: 'evt-existing', synced_sequence: 3 }
		]);
	});

	it.each([
		undefined,
		[],
		[{ theme_snapshot: 'natalia', modality: 'video', video_instructions_snapshot: null }],
		{ theme_snapshot: 'natalia', modality: 'video', video_instructions_snapshot: 123 },
		{ theme_snapshot: 'natalia', modality: 'invalid', video_instructions_snapshot: null }
	])(
		'rechaza contexto uno a uno ausente o con forma de lista sin operar en Google',
		async context => {
			envState.privateEnv.BOOKING_CONTEXTS_AVAILABLE = 'true';
			const database = calendarDatabase({
				claimed: [claimedEvent(1)],
				appointments: [appointmentRow('apt-1', { appointment_booking_contexts: context })]
			});
			const service = google(database.timeline);
			await expect(processGoogleCalendarSyncBatch({
				supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now
			})).rejects.toThrow();
			expect(service.requests).toHaveLength(0);
			expect(database.completions()).toHaveLength(1);
			expect(database.completions()[0].args).toMatchObject({ p_results: [], p_finish: true });
		}
	);

	it('reparte el trabajo, refresca el token una vez por conexión y registra cada tramo', async () => {
		const database = calendarDatabase({
			claimed: [1, 2, 3, 4, 5].map((index) => claimedEvent(index)),
			appointments: [1, 2, 3, 4, 5].map((index) => appointmentRow(`apt-${index}`))
		});
		const service = google(database.timeline);
		const budget = createJobBudget('free');

		const summary = await processGoogleCalendarSyncBatch({
			supabase: database.supabase,
			budget,
			providerFetch: budget.fetchFor('provider', service.fetchFn),
			now
		});

		expect(summary).toMatchObject({ configured: true, claimed: 5, active: 5, attention: 0 });
		// Free: 39 calls after the Service Binding; chunks of four cost 2 + 3 per event.
		expect(database.rpcCalls[0]).toMatchObject({ name: 'claim_google_calendar_sync_batch', args: { p_limit: 10, p_now: now.toISOString() } });
		expect(service.requests.filter((request) => request.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
		expect(database.reads).toEqual([['apt-1', 'apt-2', 'apt-3', 'apt-4'], ['apt-5']]);
		const [first, last] = database.completions();
		expect(first.args.p_finish).toBe(false);
		expect(last.args.p_finish).toBe(true);
		expect(database.completions()).toHaveLength(2);
		expect(first.args.p_results).toEqual(
			[1, 2, 3, 4].map((index) => ({
				event_row_id: `event-${index}`,
				outcome: 'synced',
				google_event_id: deterministicGoogleCalendarEventId(`apt-${index}`),
				synced_sequence: 3
			}))
		);
		expect(budget.summary()).toMatchObject({ providerRequests: 6 });
	});

	it('con el perfil Paid reclama los eventos cuyos tramos entran en 300 llamadas', async () => {
		const database = calendarDatabase({ claimed: [], appointments: [] });
		await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('paid'), providerFetch: fetch, now });
		// 297 calls left: 21 chunks of four events at 14 calls each.
		expect(database.rpcCalls[0]).toMatchObject({ name: 'claim_google_calendar_sync_batch', args: { p_limit: 84 } });
	});

	it('una cancelación posterior a la reclamación borra el evento en vez de actualizarlo', async () => {
		const database = calendarDatabase({
			claimed: [claimedEvent(1, { sync_status: 'pending_update', event_id: 'evt-1' }), claimedEvent(2, { sync_status: 'pending_update', event_id: 'evt-2' })],
			appointments: [appointmentRow('apt-1', { status: 'cancelled' }), appointmentRow('apt-2', { status: 'cancelled' })]
		});
		const service = google(database.timeline, (request) =>
			request.method === 'DELETE' && request.url.endsWith('/evt-2') ? new Response('{}', { status: 410 }) : undefined
		);

		const summary = await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		expect(service.requests.filter((request) => request.method === 'DELETE')).toHaveLength(2);
		expect(service.requests.some((request) => request.method === 'PATCH')).toBe(false);
		// Already missing at Google counts as deleted too.
		expect(database.completions()[0].args.p_results).toEqual([
			{ event_row_id: 'event-1', outcome: 'deleted' },
			{ event_row_id: 'event-2', outcome: 'deleted' }
		]);
		expect(summary.deleted).toBe(2);
	});

	it('una creación cuya respuesta se perdió se recupera con el ID determinista', async () => {
		const database = calendarDatabase({ claimed: [claimedEvent(1)], appointments: [appointmentRow('apt-1')] });
		const deterministic = deterministicGoogleCalendarEventId('apt-1');
		const service = google(database.timeline, (request) => {
			if (request.method === 'POST' && request.url.endsWith('/events')) return new Response('{}', { status: 409 });
			if (request.method === 'GET' && request.url.endsWith(`/events/${deterministic}`)) return Response.json({ id: deterministic });
			return undefined;
		});

		await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		expect(database.completions()[0].args.p_results).toEqual([
			{ event_row_id: 'event-1', outcome: 'synced', google_event_id: deterministic, synced_sequence: 3 }
		]);
	});

	it('una autorización revocada pide reconectar todos sus eventos con un solo intento de token', async () => {
		const database = calendarDatabase({
			claimed: [claimedEvent(1), claimedEvent(2)],
			appointments: [appointmentRow('apt-1'), appointmentRow('apt-2')]
		});
		const service = google(database.timeline, (request) =>
			request.url === 'https://oauth2.googleapis.com/token' ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : undefined
		);

		const summary = await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		expect(service.requests).toHaveLength(1);
		expect(database.completions()[0].args.p_results).toEqual(
			[1, 2].map((index) => expect.objectContaining({ event_row_id: `event-${index}`, outcome: 'failed', failure_category: 'authorization', error_code: 'oauth_revoked' }))
		);
		expect(summary.attention).toBe(2);
	});

	it('un fallo transitorio programa el reintento con la espera creciente existente', async () => {
		const database = calendarDatabase({
			claimed: [claimedEvent(1, { sync_status: 'pending_update', event_id: 'evt-1', attempt_count: 2 })],
			appointments: [appointmentRow('apt-1')]
		});
		const service = google(database.timeline, (request) => (request.method === 'PATCH' ? new Response('{}', { status: 503 }) : undefined));

		const summary = await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		// Third attempt: 2^3 minutes plus a deterministic jitter of (3 * 37) % 60 seconds.
		expect(database.completions()[0].args.p_results).toEqual([
			{
				event_row_id: 'event-1',
				outcome: 'failed',
				failure_category: 'transient',
				error_code: 'calendar_service_busy',
				next_attempt_at: new Date(now.getTime() + (8 * 60 + 51) * 1000).toISOString()
			}
		]);
		expect(summary.retrying).toBe(1);
	});

	it('revoca la autorización recién después de confirmar el borrado de su último evento', async () => {
		const database = calendarDatabase({
			claimed: [claimedEvent(1, { sync_status: 'pending_delete', event_id: 'evt-1' })],
			appointments: [appointmentRow('apt-1')],
			removedConnection: 'connection-1'
		});
		const service = google(database.timeline);

		await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		expect(database.timeline).toEqual([
			'claim_google_calendar_sync_batch',
			'read:appointments',
			'POST /token',
			'DELETE /calendar/v3/calendars/primary/events/evt-1',
			'complete_google_calendar_sync_batch',
			'POST /revoke'
		]);
	});

	it('deja de empezar tramos cuando ya no entran en el tiempo y libera el resto', async () => {
		let clock = 0;
		const budget = createJobBudget('free', () => clock);
		const database = calendarDatabase({
			claimed: [1, 2, 3, 4, 5, 6].map((index) => claimedEvent(index)),
			appointments: [1, 2, 3, 4, 5, 6].map((index) => appointmentRow(`apt-${index}`)),
			released: 2
		});
		const service = google(database.timeline, () => {
			clock = WORK_DEADLINE_MS;
			return undefined;
		});

		const summary = await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget, providerFetch: service.fetchFn, now });

		expect(database.reads).toHaveLength(1);
		const [first, last] = database.completions();
		expect(first.args).toMatchObject({ p_finish: false });
		expect(last.args).toMatchObject({ p_results: [], p_finish: true });
		expect(summary).toMatchObject({ claimed: 6, active: 4, released: 2 });
	});

	it('un turno que la lectura ya no encuentra queda para reintentar sin tocar Google', async () => {
		const database = calendarDatabase({ claimed: [claimedEvent(1)], appointments: [] });
		const service = google(database.timeline);

		await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: service.fetchFn, now });

		expect(service.requests).toHaveLength(0);
		expect(database.completions()[0].args.p_results).toEqual([
			expect.objectContaining({ event_row_id: 'event-1', outcome: 'failed', failure_category: 'transient', error_code: 'calendar_appointment_unavailable' })
		]);
	});

	it('sin configuración no reclama nada', async () => {
		delete envState.privateEnv.GOOGLE_CALENDAR_MANAGED_ENABLED;
		const database = calendarDatabase({ claimed: [claimedEvent(1)], appointments: [] });

		const summary = await processGoogleCalendarSyncBatch({ supabase: database.supabase, budget: createJobBudget('free'), providerFetch: fetch, now });

		expect(summary).toMatchObject({ configured: false, claimed: 0 });
		expect(database.rpcCalls).toHaveLength(0);
	});
});
