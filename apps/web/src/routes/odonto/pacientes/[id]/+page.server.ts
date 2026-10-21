import { setPatientArchived } from '$lib/server/patients/public/patient-archive';
import {
	updatePatientProfile,
	parsePatientProfileUpdate,
	type PatientProfileUpdate
} from '$lib/server/patients/public/patient-profile';
import {
	createClinicalEntry,
	updateClinicalEntry,
	parseClinicalEntryInput,
	type SavedClinicalEntry
} from '$lib/server/patients/public/clinical-entries';
import {
	PatientOperationError,
	type PatientFailureKind
} from '$lib/server/patients/public/patient-operation-error';
import {
	readPatientDetail,
	PatientDetailReadError
} from '$lib/server/patients/public/patient-detail';
import { isRecord } from '$lib/contracts/json';
import { bookingInformationEnabled } from '$lib/server/patients/public/booking-information';
import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/platform/demo-store';
import { createSupabaseAdminClient, createSupabaseServerClient } from '$lib/server/platform/supabase';
import {
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	type PatientUniqueField
} from '$lib/server/patients/public/patient-identity';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { businessTodayISO } from '$lib/server/patients/public/follow-ups';
import { resolvePatientPermissions } from '$lib/server/patients/public/patient-permissions';
import { readPatientBookingAge } from '$lib/patients/booking-profile';

const getLatestEntryDate = (
	patientId: string,
	entries: { patient_id: string; created_at: string }[]
) =>
	entries
		.filter((e) => e.patient_id === patientId)
		.reduce<string | null>(
			(latest, entry) => (entry.created_at > (latest ?? '') ? entry.created_at : latest),
			null
		);

const COMMERCIAL_RESTRICTED_MESSAGE =
	'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
const PROFESSIONAL_DELETE_PATIENT_MESSAGE =
	'Para eliminar un paciente, consultá al dueño del consultorio.';

const patientDetailUrl = (patientId: string, tab: 'historial' | 'datos') =>
	`/odonto/pacientes/${patientId}?tab=${tab}`;

const resolveBusinessActionContext = async ({
	locals,
	fetch,
	cookies,
	membershipCache = 'fresh'
}: {
	locals: App.Locals;
	fetch: typeof globalThis.fetch;
	cookies: import('@sveltejs/kit').Cookies;
	membershipCache?: 'fresh' | 'request';
}) => {
	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	// Hooks verified this request's identity with Auth.
	const ownerId = locals.verifiedUser?.id ?? null;
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth?.access_token,
		cookies,
		membershipCache
	});

	if (!ownerId || !context) {
		return null;
	}

	return { supabase, ownerId, context };
};

const duplicatePatientActionResult = (existing: { id: string; field: PatientUniqueField }) =>
	fail(409, {
		message: PATIENT_UNIQUE_CONFLICT_MESSAGES[existing.field],
		duplicate: true,
		duplicateField: existing.field,
		existingId: existing.id
	});

const isEnhancedActionRequest = (request: Request) =>
	request.headers.get('x-sveltekit-action') === 'true';

const patientFailureStatus: Record<PatientFailureKind, 400 | 403 | 404 | 409 | 500> = {
	invalid: 400,
	forbidden: 403,
	missing: 404,
	conflict: 409,
	unavailable: 500
};
function patientActionFailure(cause: unknown) {
	if (cause instanceof PatientOperationError)
		return fail(patientFailureStatus[cause.kind], { message: cause.message, ...cause.feedback });
	throw cause;
}
const clinicalInputFromForm = (form: FormData, timeZone: string) =>
	parseClinicalEntryInput(
		{
			entryType: String(form.get('entry_type') ?? ''),
			description: String(form.get('description') ?? ''),
			createdAt: String(form.get('created_at') ?? ''),
			teeth: String(form.get('teeth') ?? ''),
			amount: String(form.get('amount') ?? ''),
			amountFormat: String(form.get('amount_format') ?? ''),
			internalNote: String(form.get('internal_note') ?? '')
		},
		timeZone
	);

async function updatePatientArchive(
	{ params, locals, fetch, cookies }: RequestEvent,
	archived: boolean
) {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		let found = false;
		updateDemoDb((db) => {
			const patient = db.patients.find((item) => item.id === params.id);
			if (!patient) return;
			const now = new Date().toISOString();
			patient.archived_at = archived ? now : null;
			patient.updated_at = now;
			found = true;
		});
		if (!found) return fail(404, { message: 'Paciente no encontrado' });
	} else {
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		try {
			await setPatientArchived({
				supabase: session.supabase,
				context: session.context,
				patientId: params.id,
				archived
			});
		} catch (cause) {
			return patientActionFailure(cause);
		}
	}
	throw redirect(303, archived ? '/odonto/pacientes?estado=archivados' : '/odonto/pacientes');
}

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, depends }) => {
	depends(`app:patient:${params.id}`);
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	if (env.DEMO_MODE === 'true') {
		const db = readDemoDb();
		const patient = db.patients.find((p) => p.id === params.id);
		if (!patient) throw kitError(404, 'Paciente no encontrado');
		const entries = db.clinicalEntries
			.filter((e) => e.patient_id === params.id)
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		const radiographs = db.radiographs
			.filter((r) => r.patient_id === params.id)
			.sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1));
		return {
			patient: { ...patient, booking_age: readPatientBookingAge(patient.custom_fields) },
			entries,
			radiographs,
			appointments: [],
			businessTimeZone: 'America/Argentina/Buenos_Aires',
			hasMoreEntries: false,
			permissions: {
				canReadClinicalHistory: true,
				canReadClinicalProfile: true,
				canEditClinicalProfile: true,
				canViewCosts: true,
				canEditPatient: true,
				canArchivePatient: true,
				canCreateClinicalEntry: true,
				canEditClinicalEntry: true,
				canCreateAppointment: true,
				canViewRadiographs: true,
				canUploadRadiographs: true,
				canViewRadiographTrash: true,
				canTrashRadiographs: true,
				canExportPatientData: false
			},
			documentUploads: 'available' as const,
			followUpParticipates: false,
			followUpCanAssign: false,
			followUpTodayISO: '',
			clinicalTodayISO: businessTodayISO('America/Argentina/Buenos_Aires'),
			demo: true
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const ownerId = locals.verifiedUser?.id ?? null;
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies,
		membershipCache: locals.membershipCache ?? 'fresh'
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	const admin = await createSupabaseAdminClient('odonto', fetch);
	try {
		return await readPatientDetail({
			patientId: params.id,
			supabase,
			admin,
			context,
			currentUserId: ownerId
		});
	} catch (cause) {
		if (cause instanceof PatientDetailReadError) {
			if (cause.kind === 'not_found') throw kitError(404, 'Paciente no encontrado');
			throw kitError(500, 'No se pudo cargar el paciente');
		}
		throw cause;
	}
};

export const actions: Actions = {
	add_entry: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		try {
			const form = await request.formData();
			const enhancedRequest = isEnhancedActionRequest(request);
			let savedEntry: SavedClinicalEntry | null = null;
			if (env.DEMO_MODE === 'true') {
				const input = clinicalInputFromForm(form, 'America/Argentina/Buenos_Aires');
				updateDemoDb((db) => {
					const patient = db.patients.find((p) => p.id === params.id);
					if (!patient) return;
					const entry = { id: newId('e'), patient_id: params.id, ...input };
					db.clinicalEntries.unshift(entry);
					patient.last_entry_at = getLatestEntryDate(params.id, db.clinicalEntries);
					patient.updated_at = new Date().toISOString();
					savedEntry = { ...entry, created_by_user_id: null, locked_after: null };
				});
				if (!savedEntry) return fail(404, { message: 'Paciente no encontrado' });
			} else {
				const session = await resolveBusinessActionContext({
					locals,
					fetch,
					cookies,
					membershipCache: 'fresh'
				});
				if (!session) return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
				savedEntry = await createClinicalEntry({
					supabase: session.supabase,
					context: session.context,
					patientId: params.id,
					input: clinicalInputFromForm(form, session.context.business.timezone)
				});
			}
			if (!savedEntry || !enhancedRequest)
				throw redirect(303, patientDetailUrl(params.id, 'historial'));
			return { savedEntry };
		} catch (cause) {
			return patientActionFailure(cause);
		}
	},
	update_entry: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		try {
			const form = await request.formData();
			const entryId = String(form.get('entry_id') ?? '').trim();
			if (!entryId) return fail(400, { message: 'Entrada inválida.' });
			if (env.DEMO_MODE === 'true') {
				const input = clinicalInputFromForm(form, 'America/Argentina/Buenos_Aires');
				let updated = false;
				updateDemoDb((db) => {
					const entry = db.clinicalEntries.find(
						(e) => e.id === entryId && e.patient_id === params.id
					);
					const patient = db.patients.find((p) => p.id === params.id);
					if (!entry || !patient) return;
					Object.assign(entry, input);
					patient.last_entry_at = getLatestEntryDate(params.id, db.clinicalEntries);
					patient.updated_at = new Date().toISOString();
					updated = true;
				});
				if (!updated) return fail(404, { message: 'Entrada no encontrada' });
			} else {
				const session = await resolveBusinessActionContext({ locals, fetch, cookies });
				if (!session) return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
				await updateClinicalEntry({
					supabase: session.supabase,
					context: session.context,
					patientId: params.id,
					entryId,
					input: clinicalInputFromForm(form, session.context.business.timezone)
				});
			}
			throw redirect(303, patientDetailUrl(params.id, 'historial'));
		} catch (cause) {
			return patientActionFailure(cause);
		}
	},
	update_patient: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');

		let input: PatientProfileUpdate;
		try {
			input = parsePatientProfileUpdate(Object.fromEntries((await request.formData()).entries()));
		} catch (cause) {
			return patientActionFailure(cause);
		}
		const { updates, clinicalUpdates, dni } = input;

		if (env.DEMO_MODE === 'true') {
			const demoPatients = readDemoDb().patients;
			const duplicateByDni = dni
				? demoPatients.find((patient) => patient.id !== params.id && patient.dni === dni)
				: null;
			if (duplicateByDni) {
				return duplicatePatientActionResult({ id: duplicateByDni.id, field: 'dni' });
			}

			let updated = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				Object.assign(patient, updates, clinicalUpdates);
				updated = true;
			});

			if (!updated) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, patientDetailUrl(params.id, 'datos'));
		}

		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		try {
			await updatePatientProfile({
				admin: await createSupabaseAdminClient('odonto', fetch),
				context: session.context,
				ownerId: session.ownerId,
				patientId: params.id,
				input
			});
		} catch (cause) {
			return patientActionFailure(cause);
		}
		throw redirect(303, patientDetailUrl(params.id, 'datos'));
	},
	archive_patient: (event) => updatePatientArchive(event, true),
	unarchive_patient: (event) => updatePatientArchive(event, false),
	delete_patient: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let deleted = false;
			updateDemoDb((db) => {
				const patientIndex = db.patients.findIndex((p) => p.id === params.id);
				if (patientIndex === -1) return;
				db.clinicalEntries = db.clinicalEntries.filter((e) => e.patient_id !== params.id);
				db.patients.splice(patientIndex, 1);
				deleted = true;
			});

			if (!deleted) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, '/odonto/pacientes');
		}
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (session.context.role === 'professional') {
			return fail(403, { message: PROFESSIONAL_DELETE_PATIENT_MESSAGE });
		}
		if (!permissions.canArchivePatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Los pacientes no se eliminan directamente. Archivá el paciente para ocultarlo.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		return fail(403, {
			message:
				'Por seguridad, los pacientes no se eliminan directamente. Archivá el paciente para ocultarlo.'
		});
	}
};
