import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import {
	accountAssistanceErrorMessage,
	accountAssistanceErrorStatus,
	activateAccountAssistance,
	buildAccountAssistanceView,
	dismissAccountAssistanceNotice,
	endAccountAssistance,
	extendAccountAssistance,
	loadAccountAssistanceHasPatients,
	loadAccountAssistanceView,
	safeAssistanceReturnTo
} from '$lib/server/access/public/account-assistance';
import { isAccountAssistanceKind } from '$lib/access/assistance-durations';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/access/public/business';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	isMasterEmail
} from '$lib/server/platform/supabase';
import { verifiedRequestEmail } from '$lib/server/access/public/odonto-context';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const isMasterSession = (locals: App.Locals) => isMasterEmail(verifiedRequestEmail(locals));

const MASTER_DOES_NOT_GIVE = 'La cuenta maestra no da ni extiende la ayuda: lo hace el dueño del consultorio.';
// Giving, extending and ending are sent only by the confirmation dialog (plan 12.17, point 8).
const UNCONFIRMED = 'Confirmá la acción para continuar.';
const isConfirmed = (form: FormData) => form.get('confirmed') === '1';

const loadContext = async ({
	locals,
	fetch,
	cookies
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
}) => {
	if (!locals.auth) throw redirect(303, '/login');
	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	return { supabase, context };
};

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');

	if (env.DEMO_MODE === 'true') {
		const context = demoBusinessContext();
		return {
			context,
			assistance: buildAccountAssistanceView({
				grant: null,
				role: 'owner',
				timeZone: context.business.timezone,
				canUseBusiness: true,
				hasPatients: true
			}),
			serverNow: new Date().toISOString(),
			demo: true
		};
	}

	const { supabase, context } = await loadContext({ locals, fetch, cookies });
	if (isMasterSession(locals) && !context.assistance) throw redirect(303, '/odonto/maestro');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role !== 'owner' && context.role !== 'admin') throw redirect(303, '/odonto/agenda');

	const isAssisting = Boolean(context.assistance);
	let assistance;
	try {
		// Only the owner chooses a duration, and the initial setup depends on the patients.
		const hasPatients =
			context.role === 'owner' && !isAssisting && context.access.canUseBusiness
				? await loadAccountAssistanceHasPatients({ supabase, businessId: context.business.id })
				: undefined;
		assistance = await loadAccountAssistanceView({
			supabase,
			businessId: context.business.id,
			role: context.role,
			timeZone: context.business.timezone,
			canUseBusiness: context.access.canUseBusiness,
			isAssisting,
			hasPatients
		});
	} catch (assistanceError) {
		logServerFailure('Error cargando ayuda para configurar', assistanceError);
		throw kitError(503, 'No pudimos cargar la ayuda para configurar. Volvé a intentar.');
	}

	return {
		context,
		assistance,
		// The confirmation dialog says when a new grant would end with the server clock.
		serverNow: new Date().toISOString(),
		demo: false
	};
};

export const actions: Actions = {
	activate: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (isMasterSession(locals)) return fail(403, { message: MASTER_DOES_NOT_GIVE });
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		const kind = form.get('kind');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!isConfirmed(form)) return fail(400, { message: UNCONFIRMED });
		if (!isAccountAssistanceKind(kind)) return fail(400, { message: 'Elegí por cuánto tiempo querés dar la ayuda.' });

		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			if (context.assistance || context.role !== 'owner') {
				return fail(403, { message: 'Solo el dueño del consultorio puede dar esta ayuda.' });
			}
			if (!context.access.canUseBusiness) {
				return fail(409, { message: 'La cuenta debe estar activa para pedir ayuda de configuración.' });
			}
			const admin = await createSupabaseAdminClient('odonto', fetch);
			await activateAccountAssistance({ supabase, admin, businessId: context.business.id, kind });
		} catch (error) {
			logServerFailure('Error activando ayuda para configurar', error);
			return fail(accountAssistanceErrorStatus(error), { message: accountAssistanceErrorMessage(error) });
		}

		throw redirect(303, returnTo);
	},
	extend: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (isMasterSession(locals)) return fail(403, { message: MASTER_DOES_NOT_GIVE });
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		const kind = form.get('kind');
		const grantId = String(form.get('grant_id') ?? '').trim();
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!isConfirmed(form)) return fail(400, { message: UNCONFIRMED });
		if (!grantId || !isAccountAssistanceKind(kind)) {
			return fail(400, { message: 'No pudimos extender la ayuda. Recargá la página y volvé a intentar.' });
		}

		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			if (context.assistance || context.role !== 'owner') {
				return fail(403, { message: 'Solo el dueño del consultorio puede extender esta ayuda.' });
			}
			await extendAccountAssistance({ supabase, businessId: context.business.id, grantId, kind });
		} catch (error) {
			logServerFailure('Error extendiendo ayuda para configurar', error);
			return fail(accountAssistanceErrorStatus(error), { message: accountAssistanceErrorMessage(error) });
		}

		throw redirect(303, returnTo);
	},
	// The owner, or the master inside the account it is helping: the database checks that the
	// master is the support user of that grant.
	end: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		const grantId = String(form.get('grant_id') ?? '').trim();
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!isConfirmed(form)) return fail(400, { message: UNCONFIRMED });
		if (!grantId) return fail(400, { message: 'No pudimos terminar la ayuda. Recargá la página y volvé a intentar.' });

		const isMaster = isMasterSession(locals);
		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			const allowed = isMaster ? Boolean(context.assistance) : !context.assistance && context.role === 'owner';
			if (!allowed) {
				return fail(403, { message: 'Solo el dueño del consultorio o Cita Suite pueden terminar esta ayuda.' });
			}
			await endAccountAssistance({ supabase, businessId: context.business.id, grantId });
		} catch (error) {
			logServerFailure('Error terminando ayuda para configurar', error);
			return fail(accountAssistanceErrorStatus(error), { message: accountAssistanceErrorMessage(error) });
		}

		// Without the grant the master no longer has access to this practice.
		throw redirect(303, isMaster ? '/odonto/maestro' : returnTo);
	},
	dismiss: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (isMasterSession(locals)) {
			return fail(403, {
				message: 'La cuenta maestra no cierra los avisos del consultorio.'
			});
		}
		const form = await request.formData();
		const returnTo = safeAssistanceReturnTo(form.get('return_to'));
		const grantId = String(form.get('grant_id') ?? '').trim();
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		if (!grantId) return fail(400, { message: 'No pudimos cerrar este aviso.' });

		try {
			const { supabase, context } = await loadContext({ locals, fetch, cookies });
			if (context.assistance || context.role !== 'owner') {
				return fail(403, { message: 'Solo el dueño del consultorio puede cerrar este aviso.' });
			}
			await dismissAccountAssistanceNotice({
				supabase,
				businessId: context.business.id,
				grantId
			});
		} catch (error) {
			logServerFailure('Error cerrando aviso de ayuda para configurar', error);
			return fail(accountAssistanceErrorStatus(error), { message: accountAssistanceErrorMessage(error) });
		}

		throw redirect(303, returnTo);
	}
};
