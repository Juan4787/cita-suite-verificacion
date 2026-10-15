import { env } from '$env/dynamic/private';
import type { BusinessRole } from '$lib/server/business';
import { getOdontoContext } from '$lib/server/odonto-context';
import {
	getPatientDataRevision,
	getViewerPatientDataRevision,
	patientDataCacheScope,
	type PatientDataRevision
} from '$lib/server/patient-data-revision';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getUserIdFromAccessToken
} from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const isMissingCompactRevisionRpc = (error: unknown) => {
	const row = (error ?? {}) as { code?: string | null; message?: string | null };
	const message = String(row.message ?? '').toLowerCase();
	return (
		row.code === '42883' ||
		row.code === 'PGRST202' ||
		message.includes('get_patient_data_revision')
	);
};

const isForbiddenRevision = (error: unknown) => {
	const row = (error ?? {}) as { code?: string | null; message?: string | null };
	return row.code === '42501' || String(row.message ?? '').includes('PATIENT_REVISION_FORBIDDEN');
};

export const GET: RequestHandler = async ({ locals, fetch, cookies, setHeaders, url }) => {
	setHeaders({
		'cache-control': 'private, no-store',
		vary: 'Cookie'
	});
	if (!locals.auth) {
		return json(
			{ message: 'Tu sesión terminó. Volvé a iniciar sesión.' },
			{ status: 401 }
		);
	}

	if (env.DEMO_MODE === 'true') {
		return json({
			resource: 'patients',
			businessId: 'demo-business',
			cacheable: false,
			revision: null,
			cacheScope: null,
			topic: null,
			checkedAt: new Date().toISOString()
		});
	}

	const requestedBusinessId = String(url.searchParams.get('business_id') ?? '').trim();
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBusinessId)) {
		return json({ message: 'No se pudo verificar el consultorio activo.' }, { status: 400 });
	}

	const userId = getUserIdFromAccessToken(locals.auth.access_token);
	if (!userId) {
		return json({ message: 'Tu sesión terminó. Volvé a iniciar sesión.' }, { status: 401 });
	}

	let businessId = requestedBusinessId;
	let role: BusinessRole;
	let canCreatePatient: boolean;
	let revision: PatientDataRevision;
	try {
		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const compact = await getViewerPatientDataRevision(supabase, requestedBusinessId);
		role = compact.role;
		canCreatePatient = compact.canCreatePatient;
		revision = compact;
	} catch (error) {
		if (isForbiddenRevision(error)) {
			return json({ message: 'No tenés acceso a ese consultorio.' }, { status: 403 });
		}
		if (!isMissingCompactRevisionRpc(error)) {
			console.error('Error verificando revisión compacta de pacientes', error);
			return json({ message: 'No se pudo verificar la lista de pacientes.' }, { status: 500 });
		}
		// Compatibilidad durante un despliegue escalonado: conserva la ruta previa.
		try {
			const { business } = await getOdontoContext({
				locals,
				fetch,
				cookies,
				membershipCache: 'fresh'
			});
			if (business.business.id !== requestedBusinessId) {
				return json({ message: 'No tenés acceso a ese consultorio.' }, { status: 403 });
			}
			businessId = business.business.id;
			role = business.role;
			canCreatePatient = business.access.allowedCapabilities.canCreatePatient;
			const admin = await createSupabaseAdminClient('odonto', fetch);
			revision = await getPatientDataRevision(admin, businessId);
		} catch (fallbackError) {
			console.error('Error verificando revisión compatible de pacientes', fallbackError);
			return json({ message: 'No se pudo verificar la lista de pacientes.' }, { status: 500 });
		}
	}
	return json({
		resource: 'patients',
		businessId,
		cacheable: revision.cacheable,
		revision: revision.revision,
		cacheScope: revision.cacheable
			? patientDataCacheScope({
					userId,
					businessId,
					role,
					canCreatePatient
				})
			: null,
		topic: revision.topic,
		checkedAt: new Date().toISOString()
	});
};
