import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	GOOGLE_REVIEW_DEFAULT_ACTION_LABEL,
	GOOGLE_REVIEW_DEFAULT_BODY,
	GOOGLE_REVIEW_DEFAULT_TITLE
} from '$lib/google-reviews';

const state = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	context: {
		business: { id: 'business-1', name: 'Consultorio Uno' },
		role: 'owner',
		canManage: true,
		assistance: null as null | { grantId: string }
	}
}));
const mocks = vi.hoisted(() => ({
	resolveActiveBusiness: vi.fn(),
	createSupabaseServerClient: vi.fn(),
	createSupabaseAdminClient: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: state.privateEnv }));
vi.mock('$lib/server/business', () => ({
	demoBusinessContext: vi.fn(),
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));

const { load, actions } = await import('./+page.server');

const createDatabaseClient = (options: {
	settings?: Record<string, unknown> | null;
	assistanceActive?: boolean;
	upsertError?: unknown;
} = {}) => {
	const upserts: Array<{ payload: Record<string, unknown>; options?: Record<string, unknown> }> = [];
	const client = {
		rpc: vi.fn(async () => ({ data: options.assistanceActive ?? true, error: null })),
		from: vi.fn(() => {
			const chain: any = {
				select: () => chain,
				eq: () => chain,
				maybeSingle: async () => ({ data: options.settings ?? null, error: null }),
				upsert: async (
					payload: Record<string, unknown>,
					upsertOptions?: Record<string, unknown>
				) => {
					upserts.push({ payload, options: upsertOptions });
					return { error: options.upsertError ?? null };
				}
			};
			return chain;
		})
	};
	return { client, upserts };
};

const requestFor = (values: Record<string, string>) =>
	new Request('https://app.test/odonto/configuracion/resena-google', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(values)
	});

const actionEvent = (request: Request) =>
	({
		request,
		locals: { auth: { access_token: 'access', refresh_token: 'refresh' } },
		fetch: vi.fn(),
		cookies: {}
	}) as unknown as Parameters<NonNullable<(typeof actions)['default']>>[0];

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(state.privateEnv)) delete state.privateEnv[key];
	state.context = {
		business: { id: 'business-1', name: 'Consultorio Uno' },
		role: 'owner',
		canManage: true,
		assistance: null
	};
	mocks.resolveActiveBusiness.mockImplementation(async () => state.context);
});

describe('Configuración · Reseña de Google', () => {
	it('carga desactivada y con la frase original si el consultorio todavía no configuró nada', async () => {
		const { client } = createDatabaseClient();
		mocks.createSupabaseServerClient.mockResolvedValue(client);

		const data = await load({
			locals: { auth: { access_token: 'access', refresh_token: 'refresh' } },
			fetch: vi.fn(),
			cookies: {}
		} as unknown as Parameters<typeof load>[0]);
		if (!data) throw new Error('La carga debe devolver la configuración');

		expect(data.settings).toEqual({
			enabled: false,
			reviewUrl: '',
			title: GOOGLE_REVIEW_DEFAULT_TITLE,
			body: GOOGLE_REVIEW_DEFAULT_BODY,
			actionLabel: GOOGLE_REVIEW_DEFAULT_ACTION_LABEL
		});
	});

	it('valida el enlace antes de tocar la base', async () => {
		const result = await actions.default(
			actionEvent(
				requestFor({
					enabled: 'true',
					review_url: 'https://example.com/review',
					notification_title: GOOGLE_REVIEW_DEFAULT_TITLE,
					notification_body: GOOGLE_REVIEW_DEFAULT_BODY,
					notification_action_label: GOOGLE_REVIEW_DEFAULT_ACTION_LABEL
				})
			)
		);

		expect(result).toMatchObject({ status: 400 });
		expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
	});

	it('guarda una configuración válida normalizada para el consultorio activo', async () => {
		const { client, upserts } = createDatabaseClient();
		mocks.createSupabaseServerClient.mockResolvedValue(client);
		const result = await actions.default(
			actionEvent(
				requestFor({
					enabled: 'true',
					review_url: '  https://g.page/r/AbCdEf123/review  ',
					notification_title: '  ✨ Gracias por elegirnos  ',
					notification_body: '  Tu opinión nos ayuda.  ',
					notification_action_label: '  Compartir  '
				})
			)
		);

		expect(result).toMatchObject({ success: true });
		expect(upserts).toHaveLength(1);
		expect(upserts[0]).toMatchObject({
			payload: {
				business_id: 'business-1',
				enabled: true,
				review_url: 'https://g.page/r/AbCdEf123/review',
				notification_title: '✨ Gracias por elegirnos',
				notification_body: 'Tu opinión nos ayuda.',
				notification_action_label: 'Compartir'
			},
			options: { onConflict: 'business_id' }
		});
	});

	it('una ayuda activa revalida en servidor y escribe con el cliente administrativo', async () => {
		state.context.assistance = { grantId: 'grant-1' };
		const regular = createDatabaseClient({ assistanceActive: true });
		const admin = createDatabaseClient();
		mocks.createSupabaseServerClient.mockResolvedValue(regular.client);
		mocks.createSupabaseAdminClient.mockResolvedValue(admin.client);

		const result = await actions.default(
			actionEvent(
				requestFor({
					review_url: 'https://g.page/r/AbCdEf123/review',
					notification_title: GOOGLE_REVIEW_DEFAULT_TITLE,
					notification_body: GOOGLE_REVIEW_DEFAULT_BODY,
					notification_action_label: GOOGLE_REVIEW_DEFAULT_ACTION_LABEL
				})
			)
		);

		expect(result).toMatchObject({ success: true });
		expect(regular.client.rpc).toHaveBeenCalledWith('user_has_active_account_assistance', {
			target_business_id: 'business-1'
		});
		expect(regular.upserts).toHaveLength(0);
		expect(admin.upserts).toHaveLength(1);
	});
});
