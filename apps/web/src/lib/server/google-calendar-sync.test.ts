import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>,
	appointment: null as any
}));
vi.mock('$env/dynamic/private', () => ({ env: testState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: testState.publicEnv }));
vi.mock('./public-appointments', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./public-appointments')>();
	return {
		...actual,
		loadPublicAppointmentByToken: vi.fn(async () => testState.appointment)
	};
});

import {
	deterministicGoogleCalendarEventId,
	encryptGoogleCalendarSecret,
	processGoogleCalendarEvent
} from './google-calendar';
import type { PublicAppointmentView } from './public-appointments';

const appointment = (overrides: Partial<PublicAppointmentView> = {}): PublicAppointmentView => ({
	id: '11111111-1111-4111-8111-111111111111',
	token: 'token',
	status: 'reserved',
	starts_at: '2026-08-10T15:00:00.000Z',
	ends_at: '2026-08-10T15:30:00.000Z',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Profesional',
	professional_count: 1,
	is_joint: false,
	calendar_action_status: 'offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 4,
	calendar_update_required_at: null,
	business: {
		id: '22222222-2222-4222-8222-222222222222',
		name: 'Consultorio',
		slug: 'consultorio',
		phone: null,
		address: null,
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		timezone: 'America/Argentina/Buenos_Aires',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: null,
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false,
	...overrides
});

type EventOverrides = Partial<{
	event_id: string | null;
	sync_status: string;
	synced_sequence: number;
	attempt_count: number;
	claimed_at: string | null;
}>;

const makeSupabase = (
	eventOverrides: EventOverrides,
	rpcResult: (name: string, input: Record<string, unknown>) => unknown,
	connectionOverrides: Partial<{
		refresh_token_ciphertext: string | null;
		revoked_at: string | null;
	}> = {}
) => {
	const event = {
		id: '33333333-3333-4333-8333-333333333333',
		business_id: testState.appointment.business.id,
		appointment_id: testState.appointment.id,
		connection_id: '44444444-4444-4444-8444-444444444444',
		calendar_id: 'primary',
		event_id: null,
		sync_status: 'pending_create',
		synced_sequence: -1,
		attempt_count: 0,
		claimed_at: null,
		...eventOverrides
	};
	const rows: Record<string, unknown> = {
		appointment_google_calendar_events: event,
		google_calendar_connections: {
			id: event.connection_id,
			refresh_token_ciphertext: null,
			revoked_at: null,
			...connectionOverrides
		},
		appointments: { confirmation_token: 'token' }
	};
	const chainFor = (table: string) => {
		const chain: any = {};
		for (const method of ['select', 'eq']) chain[method] = () => chain;
		chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
		return chain;
	};
	return {
		client: {
			from: (table: string) => chainFor(table),
			rpc: vi.fn(async (name: string, input: Record<string, unknown>) => ({
				data: rpcResult(name, input),
				error: null
			}))
		} as any,
		event
	};
};

beforeEach(() => {
	for (const key of Object.keys(testState.privateEnv)) delete testState.privateEnv[key];
	for (const key of Object.keys(testState.publicEnv)) delete testState.publicEnv[key];
	testState.privateEnv.GOOGLE_CALENDAR_MANAGED_ENABLED = 'true';
	testState.privateEnv.GOOGLE_CALENDAR_CLIENT_ID = 'calendar-client.apps.googleusercontent.com';
	testState.privateEnv.GOOGLE_CALENDAR_CLIENT_SECRET = 'secret';
	testState.privateEnv.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
	testState.privateEnv.PUBLIC_SITE_URL = 'https://cita-suite.example';
	testState.appointment = appointment();
});

describe('ejecutor de sincronización Google Calendar', () => {
	it('crea con ID determinista y confirma exactamente la sequence enviada', async () => {
		const rpcInputs: Array<{ name: string; input: Record<string, unknown> }> = [];
		const { client } = makeSupabase({}, (name, input) => {
			rpcInputs.push({ name, input });
			return name === 'complete_google_calendar_event_sync' ? 'active' : null;
		});
		let requestBody: any = null;
		const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ id: requestBody.id }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as unknown as typeof fetch;

		const result = await processGoogleCalendarEvent(client, 'event-row', fetchFn, {
			accessToken: 'access-token',
			now: new Date('2026-08-08T12:00:00.000Z')
		});

		expect(result).toEqual({ status: 'active' });
		expect(requestBody.id).toBe(deterministicGoogleCalendarEventId(testState.appointment.id));
		expect(requestBody.visibility).toBe('private');
		expect(requestBody.reminders.overrides).toHaveLength(2);
		expect(rpcInputs).toContainEqual({
			name: 'complete_google_calendar_event_sync',
			input: {
				p_event_row_id: '33333333-3333-4333-8333-333333333333',
				p_google_event_id: deterministicGoogleCalendarEventId(testState.appointment.id),
				p_synced_sequence: 4,
				p_now: '2026-08-08T12:00:00.000Z'
			}
		});
	});

	it('recupera una creación cuya respuesta se perdió sin duplicar el evento', async () => {
		const { client } = makeSupabase({}, (name) =>
			name === 'complete_google_calendar_event_sync' ? 'active' : null
		);
		let calls = 0;
		const fetchFn = vi.fn(async () => {
			calls += 1;
			if (calls === 1) {
				return new Response(JSON.stringify({ error: { status: 'ALREADY_EXISTS' } }), {
					status: 409,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(
				JSON.stringify({ id: deterministicGoogleCalendarEventId(testState.appointment.id) }),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}) as unknown as typeof fetch;

		await expect(
			processGoogleCalendarEvent(client, 'event-row', fetchFn, { accessToken: 'access-token' })
		).resolves.toEqual({ status: 'active' });
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(String(vi.mocked(fetchFn).mock.calls[1][0])).toContain(
			deterministicGoogleCalendarEventId(testState.appointment.id)
		);
	});

	it('borra un evento cancelado y confirma la eliminación remota', async () => {
		testState.appointment = appointment({ status: 'cancelled' });
		const rpcNames: string[] = [];
		const { client } = makeSupabase(
			{ event_id: 'google-event', sync_status: 'pending_delete', synced_sequence: 4 },
			(name) => {
				rpcNames.push(name);
				return null;
			}
		);
		const fetchFn = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

		await expect(
			processGoogleCalendarEvent(client, 'event-row', fetchFn, { accessToken: 'access-token' })
		).resolves.toEqual({ status: 'deleted' });
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(vi.mocked(fetchFn).mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
		expect(rpcNames).toContain('complete_google_calendar_event_delete');
	});

	it('si la creación todavía no salió, cancela sin pedir un token ni llamar a Google', async () => {
		testState.appointment = appointment({ status: 'cancelled' });
		const { client } = makeSupabase(
			{ event_id: null, sync_status: 'pending_delete' },
			() => null
		);
		const fetchFn = vi.fn() as unknown as typeof fetch;

		await expect(processGoogleCalendarEvent(client, 'event-row', fetchFn)).resolves.toEqual({
			status: 'deleted'
		});
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('revoca el refresh token cuando se elimina el último vínculo', async () => {
		testState.appointment = appointment({ status: 'cancelled' });
		const key = Buffer.alloc(32, 3);
		const connectionId = '44444444-4444-4444-8444-444444444444';
		const { client } = makeSupabase(
			{ event_id: 'google-event', sync_status: 'pending_delete' },
			(name) => (name === 'complete_google_calendar_event_delete' ? connectionId : null),
			{ refresh_token_ciphertext: encryptGoogleCalendarSecret('refresh-token', key) }
		);
		const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
			return String(input).includes('/revoke')
				? new Response(null, { status: 200 })
				: new Response(null, { status: 204 });
		}) as unknown as typeof fetch;

		await expect(
			processGoogleCalendarEvent(client, 'event-row', fetchFn, { accessToken: 'access-token' })
		).resolves.toEqual({ status: 'deleted' });
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(String(vi.mocked(fetchFn).mock.calls[1][0])).toBe(
			'https://oauth2.googleapis.com/revoke'
		);
		expect(String(vi.mocked(fetchFn).mock.calls[1][1]?.body)).toContain(
			'token=refresh-token'
		);
	});

	it('un cliente OAuth inválido no se confunde con una revocación del usuario', async () => {
		let failureInput: Record<string, unknown> | null = null;
		const key = Buffer.alloc(32, 3);
		const { client } = makeSupabase(
			{},
			(name, input) => {
				if (name === 'fail_google_calendar_event_sync') failureInput = input;
				return 'pending_create';
			},
			{ refresh_token_ciphertext: encryptGoogleCalendarSecret('refresh-token', key) }
		);
		const fetchFn = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: 'invalid_client' }), {
					status: 401,
					headers: { 'content-type': 'application/json' }
				})
		) as unknown as typeof fetch;

		await expect(processGoogleCalendarEvent(client, 'event-row', fetchFn)).resolves.toEqual({
			status: 'pending_create',
			errorCode: 'oauth_client_unavailable'
		});
		expect(failureInput!.p_failure_category).toBe('transient');
		expect(failureInput!.p_error_code).toBe('oauth_client_unavailable');
	});

	it('clasifica un 503 como transitorio sin persistir el cuerpo recibido', async () => {
		let failureInput: Record<string, unknown> | null = null;
		const { client } = makeSupabase({}, (name, input) => {
			if (name === 'fail_google_calendar_event_sync') failureInput = input;
			return 'pending_create';
		});
		const fetchFn = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: 'detalle sensible remoto' } }), {
					status: 503,
					headers: { 'content-type': 'application/json' }
				})
		) as unknown as typeof fetch;

		await expect(
			processGoogleCalendarEvent(client, 'event-row', fetchFn, { accessToken: 'access-token' })
		).resolves.toEqual({ status: 'pending_create', errorCode: 'calendar_service_busy' });
		expect(failureInput!.p_failure_category).toBe('transient');
		expect(failureInput!.p_error_code).toBe('calendar_service_busy');
		expect(JSON.stringify(failureInput)).not.toContain('detalle sensible remoto');
	});
});
