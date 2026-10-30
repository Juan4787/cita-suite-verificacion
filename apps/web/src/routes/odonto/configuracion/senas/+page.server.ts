// Configuración de señas del consultorio (plan, sección 4.3 y ajuste 1). Sólo dueña y
// administración. La base valida y guarda la política entera a la revisión que se leyó; esta
// página arma el pedido con las 11 claves explícitas y avisa lo que la política no puede cubrir.
import { env } from '$env/dynamic/private';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import { demoBusinessContext, resolveActiveBusiness } from '$lib/server/access/public/business';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { logServerFailure } from '$lib/server/platform/logging';
import {
	DEFAULT_DEPOSIT_POLICY,
	DepositError,
	getDepositErrorMessage,
	getDepositErrorStatus,
	loadDepositAutomationStatus,
	loadDepositPolicy,
	saveDepositPolicy
} from '$lib/server/scheduling/public/deposits';
import { parsePolicyForm } from '$lib/server/scheduling/public/deposit-policy-form';
import type { CitaSupabaseClient } from '$lib/types/database';
import type { Actions, PageServerLoad } from './$types';

// How each service gets a fee, as private.resolve_service_price looks for it: a policy for every
// professional, policies only for some of them, or none. A percentage needs a fee.
type ServiceFee = 'all' | 'some' | 'none';
type ServiceView = { id: string; name: string; fee: ServiceFee };

const loadServices = async (supabase: CitaSupabaseClient, businessId: string) => {
	const [servicesResult, feesResult] = await Promise.all([
		supabase.from('services').select('id, name').eq('business_id', businessId).eq('is_active', true).order('name'),
		supabase.from('service_price_policies').select('service_id, professional_id').eq('business_id', businessId)
	]);
	if (servicesResult.error) throw servicesResult.error;
	if (feesResult.error) throw feesResult.error;
	const general = new Set<string>();
	const partial = new Set<string>();
	for (const fee of feesResult.data ?? []) {
		(fee.professional_id === null ? general : partial).add(String(fee.service_id));
	}
	return (servicesResult.data ?? []).map(
		(service): ServiceView => ({
			id: String(service.id),
			name: String(service.name),
			fee: general.has(String(service.id)) ? 'all' : partial.has(String(service.id)) ? 'some' : 'none'
		})
	);
};

const demoServices: ServiceView[] = [
	{ id: 'demo-consulta', name: 'Consulta', fee: 'all' },
	{ id: 'demo-limpieza', name: 'Limpieza', fee: 'none' }
];

export const load: PageServerLoad = async ({ locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			demo: true,
			context: demoBusinessContext(),
			policy: { ...DEFAULT_DEPOSIT_POLICY, enabled: true, autoCancelEnabled: true, fixedAmount: 40000, transferDetails: 'Alias demo.consultorio' },
			services: demoServices,
			whatsappConfigured: true,
			automationStopped: false
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (!context.canManage) throw redirect(303, '/odonto/agenda');

	try {
		const [policy, services, business, automation] = await Promise.all([
			loadDepositPolicy(supabase, context.business.id),
			loadServices(supabase, context.business.id),
			supabase
				.from('businesses')
				.select('whatsapp_phone, whatsapp_contact_enabled')
				.eq('id', context.business.id)
				.maybeSingle()
				.then(({ data, error }) => {
					if (error) throw error;
					return data;
				}),
			loadDepositAutomationStatus(supabase).catch((statusError) => {
				// Only an informative line depends on it: the page still configures.
				logServerFailure('Error cargando la revisión automática de señas', statusError);
				return null;
			})
		]);
		return {
			demo: false,
			context,
			policy,
			services,
			// Without the practice's WhatsApp the person's buttons do not appear (plan, section 4.7).
			whatsappConfigured: Boolean(business?.whatsapp_contact_enabled && String(business.whatsapp_phone ?? '').trim()),
			automationStopped: automation ? !automation.enabled : false
		};
	} catch (loadError) {
		logServerFailure('Error cargando la configuración de señas', loadError);
		throw kitError(503, 'No pudimos cargar la configuración de señas. Volvé a intentar en unos segundos.');
	}
};

export const actions: Actions = {
	save: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({ supabase, accessToken: locals.auth.access_token, cookies });
		if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');

		const form = await request.formData();
		// Digits only: Number('') is 0, which would read a missing revision as «never saved».
		const rawRevision = String(form.get('expected_revision') ?? '').trim();
		const expectedRevision = /^\d{1,15}$/.test(rawRevision) ? Number(rawRevision) : Number.NaN;
		if (!Number.isSafeInteger(expectedRevision)) {
			return fail(409, { message: getDepositErrorMessage('DEPOSIT_POLICY_CHANGED') });
		}
		let serviceIds: Set<string>;
		try {
			serviceIds = new Set((await loadServices(supabase, context.business.id)).map((service) => service.id));
		} catch (servicesError) {
			logServerFailure('Error cargando las prestaciones para guardar las señas', servicesError);
			return fail(503, { message: 'No pudimos comprobar las prestaciones. No se guardó nada; probá otra vez.' });
		}
		const { policy, errors, values } = parsePolicyForm(form, serviceIds);
		if (Object.keys(errors).length > 0) {
			return fail(400, { message: 'Revisá los datos marcados. No se guardó nada.', errors, values });
		}
		try {
			const revision = await saveDepositPolicy(supabase, { businessId: context.business.id, policy, expectedRevision });
			return {
				success: true,
				revision,
				message: policy.enabled
					? 'Configuración de señas guardada. Se aplica a las reservas nuevas.'
					: 'Configuración guardada: el consultorio no pide señas. Si había señas pendientes, quedaron exceptuadas.'
			};
		} catch (saveError) {
			const code = saveError instanceof DepositError ? saveError.code : 'DEPOSIT_UNEXPECTED';
			if (code === 'DEPOSIT_UNEXPECTED') logServerFailure('Error guardando la configuración de señas', saveError);
			return fail(getDepositErrorStatus(code), { message: getDepositErrorMessage(code), values });
		}
	}
};
