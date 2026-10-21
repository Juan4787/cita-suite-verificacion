import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import type { BusinessRole } from '$lib/server/access/public/business';
import {
	getViewerPatientDataRevision,
	patientDataCacheScope,
	type PatientDataRevision
} from '$lib/server/patients/public/patient-data-revision';
import { createSupabaseServerClient } from '$lib/server/platform/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const isForbiddenRevision = (error: unknown) => {
	const row = (error ?? {}) as { code?: string | null; message?: string | null };
	return row.code === '42501' || String(row.message ?? '').includes('PATIENT_REVISION_FORBIDDEN');
};

export const GET: RequestHandler = async ({ locals, fetch, setHeaders, url }) => {
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
	if (!isUuid(requestedBusinessId)) {
		return json({ message: 'No se pudo verificar el consultorio activo.' }, { status: 400 });
	}

	// Hooks verified this request's identity with Auth.
	const userId = locals.verifiedUser?.id;
	if (!userId) {
		return json({ message: 'Tu sesión terminó. Volvé a iniciar sesión.' }, { status: 401 });
	}

	const businessId = requestedBusinessId;
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
		// The viewer function exists in every environment since 20260726030000.
		logServerFailure('Error verificando revisión compacta de pacientes', error);
		return json({ message: 'No se pudo verificar la lista de pacientes.' }, { status: 500 });
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
