import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/business';
import { readDemoDb } from '$lib/server/demo-store';
import {
	getPatientDataRevision,
	patientDataCacheScope,
	type PatientDataRevision
} from '$lib/server/patient-data-revision';
import {
	decodePatientListCursor,
	encodePatientListCursor
} from '$lib/server/patient-list-cursor';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
import { normalizePatientListQuery } from '$lib/utils/patient-list-query';
import { error as kitError, redirect, type Cookies } from '@sveltejs/kit';

export { normalizePatientListQuery } from '$lib/utils/patient-list-query';

const PAGE_SIZE = 30;
type CountsSource = 'rpc' | 'fallback_planned';

export type PatientListData = {
	businessId: string | null;
	patients: any[];
	query: string;
	showArchived: boolean;
	demo: boolean;
	canCreatePatient: boolean;
	canAccessRadiographTrash: boolean;
	totalCount: number;
	activeCount: number;
	archivedCount: number;
	countsIncluded: boolean;
	countsSource: CountsSource;
	hasMore: boolean;
	nextCursor: string | null;
	snapshotAt: string | null;
	pageSize: number;
	cacheable: boolean;
	revision: string | null;
	cacheScope: string | null;
	loadedAt: string;
};

type LoadPatientListOptions = {
	locals: App.Locals;
	url: URL;
	fetch: typeof globalThis.fetch;
	cookies: Cookies;
};

type ListWithoutCacheMetadata = Omit<
	PatientListData,
	'businessId' | 'cacheable' | 'revision' | 'cacheScope' | 'loadedAt'
>;

const withCacheMetadata = (
	data: ListWithoutCacheMetadata,
	{
		businessId,
		revision,
		cacheScope
	}: {
		businessId: string;
		revision: PatientDataRevision;
		cacheScope: string;
	}
): PatientListData => ({
	...data,
	businessId,
	cacheable: revision.cacheable,
	revision: revision.revision,
	cacheScope: revision.cacheable ? cacheScope : null,
	loadedAt: new Date().toISOString()
});

export const withUncacheablePatientListMetadata = (
	data: ListWithoutCacheMetadata,
	businessId: string
): PatientListData => ({
	...data,
	businessId,
	cacheable: false,
	revision: null,
	cacheScope: null,
	loadedAt: new Date().toISOString()
});

export const loadStablePatientListRevision = async ({
	readRevision,
	loadRows,
	cacheScope,
	businessId
}: {
	readRevision: () => Promise<PatientDataRevision>;
	loadRows: () => Promise<ListWithoutCacheMetadata>;
	cacheScope: string;
	businessId: string;
}): Promise<PatientListData> => {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const before = await readRevision();
		const rows = await loadRows();
		if (!before.cacheable) {
			return withCacheMetadata(rows, { businessId, revision: before, cacheScope });
		}

		const after = await readRevision();
		if (after.cacheable && before.revision === after.revision) {
			return withCacheMetadata(rows, { businessId, revision: after, cacheScope });
		}
	}

	throw kitError(
		503,
		'La lista de pacientes cambió mientras se estaba cargando. Esperá un momento y volvé a intentar.'
	);
};

export const loadPatientList = async ({
	locals,
	url,
	fetch,
	cookies
}: LoadPatientListOptions): Promise<PatientListData> => {
	if (!locals.auth) throw redirect(303, '/login');
	const showArchived = url.searchParams.get('estado') === 'archivados';
	const query = normalizePatientListQuery(url.searchParams.get('q'));
	const fastSearch = url.searchParams.get('mode') === 'search' && Boolean(query);
	const rawCursor = url.searchParams.get('cursor')?.trim() ?? '';

	if (env.DEMO_MODE === 'true') {
		const normalized = query.toLocaleLowerCase('es');
		const demoPatients = readDemoDb().patients;
		const activeCount = demoPatients.filter((patient) => !patient.archived_at).length;
		const archivedCount = demoPatients.filter((patient) => patient.archived_at).length;
		const patients = demoPatients
			.filter((patient) => (showArchived ? patient.archived_at !== null : patient.archived_at === null))
			.filter((patient) =>
				normalized
					? `${patient.full_name} ${patient.dni ?? ''} ${patient.phone ?? ''}`
							.toLocaleLowerCase('es')
							.includes(normalized)
					: true
			)
			.sort((a, b) => {
				const aDate = a.updated_at ?? a.last_entry_at ?? a.created_at ?? '';
				const bDate = b.updated_at ?? b.last_entry_at ?? b.created_at ?? '';
				return aDate < bDate ? 1 : -1;
			})
			.slice(0, PAGE_SIZE);
		return {
			businessId: null,
			patients,
			query,
			showArchived,
			demo: true,
			canCreatePatient: true,
			canAccessRadiographTrash: true,
			totalCount: demoPatients.length,
			activeCount,
			archivedCount,
			countsIncluded: true,
			countsSource: 'fallback_planned',
			hasMore: false,
			nextCursor: null,
			snapshotAt: null,
			pageSize: PAGE_SIZE,
			cacheable: false,
			revision: null,
			cacheScope: null,
			loadedAt: new Date().toISOString()
		};
	}

	let supabase;
	try {
		supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	} catch (cause) {
		console.error('Error creando cliente Supabase para listar pacientes', cause);
		throw kitError(500, 'No se pudo conectar para cargar los pacientes. Intentá de nuevo.');
	}

	const [userId, context] = await Promise.all([
		getAuthUserId(supabase, locals.auth.access_token),
		resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies,
			membershipCache: 'fresh'
		})
	]);
	if (!userId) throw redirect(303, '/login');
	if (!context) throw kitError(500, 'No se pudo resolver el consultorio activo.');

	const admin = await createSupabaseAdminClient('odonto', fetch);
	const cacheScope = patientDataCacheScope({
		userId,
		businessId: context.business.id,
		role: context.role,
		canCreatePatient: context.access.allowedCapabilities.canCreatePatient
	});
	const readRevision = () => getPatientDataRevision(admin, context.business.id);
	const cursor = rawCursor
		? decodePatientListCursor(rawCursor, {
				businessId: context.business.id,
				showArchived,
				query
			})
		: null;
	if (rawCursor && !cursor) {
		throw kitError(400, 'La página solicitada ya no es válida. Actualizá la lista.');
	}

	const loadRows = async ({ includeCounts = true }: { includeCounts?: boolean } = {}): Promise<ListWithoutCacheMetadata> => {
		const snapshotAt = cursor?.snapshotAt ?? new Date().toISOString();
		const patientsPromise = supabase.rpc('list_accessible_patients_page' as never, {
				p_business_id: context.business.id,
				p_show_archived: showArchived,
				p_query: query,
				p_limit: PAGE_SIZE,
				p_snapshot_at: snapshotAt,
				p_cursor_rank: cursor?.rank ?? null,
				p_cursor_activity_at: cursor?.activityAt ?? null,
				p_cursor_id: cursor?.id ?? null
			} as never);
		const [patientsResult, countsResult] = includeCounts
			? await Promise.all([
					patientsPromise,
					supabase.rpc('accessible_patient_counts' as never, {
						p_business_id: context.business.id
					} as never)
				])
			: [await patientsPromise, { data: null, error: null }];

		if (patientsResult.error) {
			console.error('Error cargando página autorizada de pacientes', patientsResult.error);
			throw kitError(500, 'No se pudieron cargar los pacientes.');
		}
		if (includeCounts && countsResult.error) {
			console.error('Error contando pacientes autorizados', countsResult.error);
			throw kitError(500, 'No se pudieron cargar los totales de pacientes.');
		}

		const rows = (Array.isArray(patientsResult.data) ? patientsResult.data : []) as Array<any>;
		const hasMore = rows.length > PAGE_SIZE;
		const patients = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
		const last = patients.at(-1);
		const countRow = (Array.isArray(countsResult.data) ? countsResult.data[0] : countsResult.data) as
			| { total_count?: number; active_count?: number; archived_count?: number }
			| null;
		const canAccessRadiographTrash =
			(context.role === 'owner' || context.role === 'admin') &&
			context.access.allowedCapabilities.canViewExistingClinicalNotes &&
			context.access.canEnterApp;

		return {
			patients,
			query,
			showArchived,
			demo: false,
			canCreatePatient: context.access.allowedCapabilities.canCreatePatient,
			canAccessRadiographTrash,
			totalCount: Number(countRow?.total_count ?? 0),
			activeCount: Number(countRow?.active_count ?? 0),
			archivedCount: Number(countRow?.archived_count ?? 0),
			countsIncluded: includeCounts,
			countsSource: includeCounts ? 'rpc' : 'fallback_planned',
			hasMore,
			nextCursor:
				hasMore && last
					? encodePatientListCursor({
							businessId: context.business.id,
							showArchived,
							query,
							snapshotAt,
							rank: Number(last.search_rank ?? 0),
							activityAt: String(last.activity_at),
							id: String(last.id)
						})
					: null,
			snapshotAt,
			pageSize: PAGE_SIZE
		};
	};

	// Mientras se escribe, la autorización sigue resuelta por el mismo RPC, pero no
	// repetimos los recuentos ni las dos lecturas de revisión en cada tecla. La respuesta
	// no se almacena como snapshot y la lista completa conserva el contrato estricto.
	if (fastSearch) {
		return withUncacheablePatientListMetadata(
			await loadRows({ includeCounts: false }),
			context.business.id
		);
	}

	// Las páginas posteriores pertenecen al snapshot temporal firmado por el cursor.
	// No deben publicarse como una nueva instantánea completa bajo la revisión actual:
	// podría haber cambios concurrentes que, correctamente, quedaron fuera de ese snapshot.
	if (cursor) {
		return withUncacheablePatientListMetadata(await loadRows(), context.business.id);
	}

	return loadStablePatientListRevision({
		readRevision,
		loadRows,
		cacheScope,
		businessId: context.business.id
	});
};
