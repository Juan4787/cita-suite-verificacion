import { logServerFailure } from '$lib/server/platform/logging';
import { createClinicalEntry, updateClinicalEntry, parseClinicalEntryInput, type SavedClinicalEntry } from '$lib/server/patients/public/clinical-entries';
import { PatientOperationError, type PatientFailureKind } from '$lib/server/patients/public/patient-operation-error';
import { getProfessionalForUser as getCurrentProfessional } from '$lib/server/team/public/professionals';
import { readPatientDetail, PatientDetailReadError } from '$lib/server/patients/public/patient-detail';
import { isRecord } from '$lib/contracts/json';
import { bookingInformationEnabled } from '$lib/server/patients/public/booking-information';
import { env } from '$env/dynamic/private';
import { resolveActiveBusiness } from '$lib/server/access/public/business';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/platform/demo-store';
import { normalizePhoneE164, normalizePhoneRaw } from '$lib/utils/phone';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/platform/supabase';
import { normalizePhone } from '$lib/utils/format';
import {
	getPatientUniqueConflictField,
	getPatientWriteConflictMessage,
	PATIENT_UNIQUE_CONFLICT_MESSAGES,
	type PatientUniqueField
} from '$lib/server/patients/public/patient-identity';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { businessTodayISO } from '$lib/server/patients/public/follow-ups';
import { resolvePatientPermissions } from '$lib/server/patients/public/patient-permissions';

const getLatestEntryDate = (patientId: string, entries: { patient_id: string; created_at: string }[]) =>
	entries
		.filter((e) => e.patient_id === patientId)
		.reduce<string | null>((latest, entry) => (entry.created_at > (latest ?? '') ? entry.created_at : latest), null);

const COMMERCIAL_RESTRICTED_MESSAGE =
	'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
const PROFESSIONAL_DELETE_PATIENT_MESSAGE =
	'Para eliminar un paciente, consultá al dueño del consultorio.';
const PATIENT_UPDATE_CONFLICT_MESSAGE =
	'La ficha cambió mientras la editabas. Recargá la ficha, revisá los datos y volvé a guardar.';

const isStaleUpdatedAt = (
	expected: string | null | undefined,
	current: string | null | undefined
): boolean => {
	if (!expected || !current) return false;
	if (expected === current) return false;
	const expectedMs = new Date(expected).getTime();
	const currentMs = new Date(current).getTime();
	if (Number.isNaN(expectedMs) || Number.isNaN(currentMs)) {
		return expected !== current;
	}
	return Math.abs(expectedMs - currentMs) > 1000;
};

const cleanText = (value: unknown) => {
	const text = String(value ?? '').trim();
	return text ? text : null;
};

const sentenceJoin = (items: string[]) => {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
};

const patientFieldLabels: Record<string, string> = {
	full_name: 'nombre',
	dni: 'DNI',
	phone: 'teléfono',
	email: 'correo electrónico',
	birth_date: 'fecha de nacimiento',
	address: 'dirección',
	insurance: 'obra social',
	insurance_plan: 'plan de la obra social',
	allergies: 'alergias',
	medication: 'medicación',
	background: 'antecedentes'
};

const currentValue = (value: unknown) => {
	const text = String(value ?? '').trim();
	return text ? text : null;
};

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
	const ownerId = await getAuthUserId(supabase, locals.auth?.access_token);
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

type BusinessActionSession = NonNullable<Awaited<ReturnType<typeof resolveBusinessActionContext>>>;

const ensureProfessionalCanAccessPatient = async ({
	admin,
	businessId,
	patientId,
	professionalId
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	patientId: string;
	professionalId: string;
}) => {
	const { data, error } = await admin
		.from('professional_patient_links')
		.select('id, archived_at')
		.eq('business_id', businessId)
		.eq('patient_id', patientId)
		.eq('professional_id', professionalId)
		.eq('is_active', true)
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return data ? { id: String(data.id), archived_at: data.archived_at ?? null } : null;
};

const findPatientDuplicateDniForUpdate = async ({
	admin,
	businessId,
	patientId,
	dni
}: {
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	patientId: string;
	dni: string;
}): Promise<{ id: string; field: PatientUniqueField } | null> => {
	if (dni) {
		const { data, error } = await admin
			.from('patients')
			.select('id')
			.eq('business_id', businessId)
			.eq('dni', dni)
			.neq('id', patientId)
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		if (data?.id) return { id: String(data.id), field: 'dni' };
	}

	return null;
};

const duplicatePatientActionResult = (existing: { id: string; field: PatientUniqueField }) =>
	fail(409, {
		message: PATIENT_UNIQUE_CONFLICT_MESSAGES[existing.field],
		duplicate: true,
		duplicateField: existing.field,
		existingId: existing.id
	});

const mapDuplicatePatientError = async ({
	error,
	admin,
	businessId,
	patientId,
	dni
}: {
	error:
		| { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }
		| null
		| undefined;
	admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
	businessId: string;
	patientId: string;
	dni: string;
}) => {
	const conflictField = getPatientUniqueConflictField(error);
	if (conflictField) {
		try {
			const duplicate = await findPatientDuplicateDniForUpdate({
				admin,
				businessId,
				patientId,
				dni
			});
			if (duplicate) return duplicatePatientActionResult(duplicate);
		} catch (lookupError) {
			logServerFailure('Error recuperando ficha en conflicto al editar paciente', lookupError);
		}
	}

	const conflictMessage = getPatientWriteConflictMessage(error);
	return conflictMessage ? fail(409, { message: conflictMessage }) : null;
};

const patientUpdateRpcError = (
	error: { message?: string; code?: string } | null | undefined,
	currentPatientUpdatedAt?: string | null,
	currentClinicalProfileUpdatedAt?: string | null
) => {
	const message = `${error?.message ?? ''} ${error?.code ?? ''}`;
	if (message.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return fail(403, { message: COMMERCIAL_RESTRICTED_MESSAGE });
	}
	if (message.includes('PATIENT_NOT_FOUND')) {
		return fail(404, { message: 'Paciente no encontrado.' });
	}
	if (message.includes('PATIENT_ACCESS_DENIED') || message.includes('PATIENT_UPDATE_DENIED')) {
		return fail(403, { message: 'No tenés permiso para editar esta ficha.' });
	}
	if (message.includes('PATIENT_NAME_REQUIRED')) {
		return fail(400, { message: 'Ingresá el nombre del paciente.' });
	}
	if (message.includes('PATIENT_UPDATE_CONFLICT')) {
		return fail(409, {
			message: PATIENT_UPDATE_CONFLICT_MESSAGE,
			currentPatientUpdatedAt: currentPatientUpdatedAt ?? '',
			currentClinicalProfileUpdatedAt: currentClinicalProfileUpdatedAt ?? ''
		});
	}
	return null;
};

const getActorName = (role: BusinessActionSession['context']['role'], professionalName?: string | null) => {
	if (professionalName) return professionalName;
	if (role === 'owner') return 'Dueño';
	if (role === 'admin') return 'Administrador';
	if (role === 'reception') return 'Recepción';
	return 'Usuario del consultorio';
};

const changedFieldsForPatientUpdate = ({
	currentPatient,
	currentProfile,
	updates,
	clinicalUpdates
}: {
	currentPatient: Record<string, unknown> | null | undefined;
	currentProfile: Record<string, unknown> | null | undefined;
	updates: Record<string, unknown>;
	clinicalUpdates: Record<string, unknown>;
}) => {
	const changed: string[] = [];
	for (const key of ['full_name', 'dni', 'phone', 'email', 'birth_date', 'address', 'insurance', 'insurance_plan']) {
		if (currentValue(currentPatient?.[key]) !== currentValue(updates[key])) {
			changed.push(patientFieldLabels[key]);
		}
	}
	for (const key of ['allergies', 'medication', 'background']) {
		if (currentValue(currentProfile?.[key]) !== currentValue(clinicalUpdates[key])) {
			changed.push(patientFieldLabels[key]);
		}
	}
	return changed;
};

const patientArchiveRpcError = (error: { message?: string; code?: string } | null | undefined) => {
	const message = `${error?.message ?? ''} ${error?.code ?? ''}`;

	if (message.includes('BUSINESS_ACCESS_RESTRICTED')) {
		return { status: 403, message: COMMERCIAL_RESTRICTED_MESSAGE };
	}
	if (message.includes('PATIENT_ARCHIVE_DENIED')) {
		return { status: 403, message: 'No tenés permiso para archivar este paciente.' };
	}
	if (message.includes('PATIENT_NOT_FOUND')) {
		return { status: 404, message: 'Paciente no encontrado.' };
	}
	return { status: 500, message: 'No se pudo actualizar el estado de la ficha. Intentá de nuevo.' };
};

const isEnhancedActionRequest = (request: Request) =>
	request.headers.get('x-sveltekit-action') === 'true';

const patientFailureStatus: Record<PatientFailureKind, 400 | 403 | 404 | 409 | 500> = {
 invalid: 400, forbidden: 403, missing: 404, conflict: 409, unavailable: 500
};
function patientActionFailure(cause: unknown) {
 if (cause instanceof PatientOperationError) return fail(patientFailureStatus[cause.kind], { message: cause.message, ...cause.feedback });
 throw cause;
}
const clinicalInputFromForm = (form: FormData) => parseClinicalEntryInput({
 entryType: String(form.get('entry_type') ?? ''), description: String(form.get('description') ?? ''),
 createdAt: String(form.get('created_at') ?? ''), teeth: String(form.get('teeth') ?? ''),
 amount: String(form.get('amount') ?? ''), internalNote: String(form.get('internal_note') ?? '')
});

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
			.sort((a, b) => (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1);
		return {
			patient,
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
	const ownerId = await getAuthUserId(supabase, locals.auth.access_token);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies,
		membershipCache: 'fresh'
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	const admin = await createSupabaseAdminClient('odonto', fetch);
 try {
  return await readPatientDetail({ patientId: params.id, supabase, admin, context, currentUserId: ownerId });
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
   const input = clinicalInputFromForm(await request.formData());
   const enhancedRequest = isEnhancedActionRequest(request);
   let savedEntry: SavedClinicalEntry | null = null;
   if (env.DEMO_MODE === 'true') {
    updateDemoDb(db => {
     const patient = db.patients.find(p => p.id === params.id);
     if (!patient) return;
     const entry = { id: newId('e'), patient_id: params.id, ...input };
     db.clinicalEntries.unshift(entry);
     patient.last_entry_at = getLatestEntryDate(params.id, db.clinicalEntries);
     patient.updated_at = new Date().toISOString();
     savedEntry = { ...entry, created_by_user_id: null, locked_after: null };
    });
    if (!savedEntry) return fail(404, { message: 'Paciente no encontrado' });
   } else {
    const session = await resolveBusinessActionContext({ locals, fetch, cookies, membershipCache: 'fresh' });
    if (!session) return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
    savedEntry = await createClinicalEntry({ supabase: session.supabase, context: session.context, patientId: params.id, input });
   }
   if (!savedEntry || !enhancedRequest) throw redirect(303, patientDetailUrl(params.id, 'historial'));
   return { savedEntry };
  } catch (cause) { return patientActionFailure(cause); }
 },
 update_entry: async ({ request, params, locals, fetch, cookies }) => {
  if (!locals.auth) throw redirect(303, '/login');
  try {
   const form = await request.formData();
   const entryId = String(form.get('entry_id') ?? '').trim();
   if (!entryId) return fail(400, { message: 'Entrada inválida.' });
   const input = clinicalInputFromForm(form);
   if (env.DEMO_MODE === 'true') {
    let updated = false;
    updateDemoDb(db => {
     const entry = db.clinicalEntries.find(e => e.id === entryId && e.patient_id === params.id);
     const patient = db.patients.find(p => p.id === params.id);
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
    await updateClinicalEntry({ supabase: session.supabase, context: session.context, patientId: params.id, entryId, input });
   }
   throw redirect(303, patientDetailUrl(params.id, 'historial'));
  } catch (cause) { return patientActionFailure(cause); }
 },
	update_patient: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');

		const form = await request.formData();
		const full_name = String(form.get('full_name') ?? '').trim().replace(/\s+/g, ' ');
		const dni = String(form.get('dni') ?? '').trim();
		const phoneInput = String(form.get('phone') ?? '');
		const phone = normalizePhone(phoneInput);
		const birthDateRaw = String(form.get('birth_date') ?? '').trim();
		const expectedPatientUpdatedAt = String(form.get('expected_patient_updated_at') ?? '').trim();
		const expectedClinicalProfileUpdatedAt = String(
			form.get('expected_clinical_profile_updated_at') ?? ''
		).trim();

		if (!full_name) {
			return fail(400, { message: 'Ingresá el nombre del paciente.' });
		}

		let birth_date: string | null = null;
		if (birthDateRaw) {
			const birthMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateRaw);
			if (!birthMatch) {
				return fail(400, { message: 'Revisá la fecha de nacimiento. Formato esperado: Año/Mes/Día.' });
			}

			const y = Number(birthMatch[1]);
			const m = Number(birthMatch[2]);
			const d = Number(birthMatch[3]);
			const currentYear = new Date().getFullYear();

			if (!Number.isInteger(y) || y < 1900 || y > currentYear) {
				return fail(400, { message: `Revisá el año: debe estar entre 1900 y ${currentYear}.` });
			}
			if (!Number.isInteger(m) || m < 1 || m > 12) {
				return fail(400, { message: 'Revisá el mes: debe ir del 1 al 12.' });
			}
			const maxDay = new Date(y, m, 0).getDate();
			if (!Number.isInteger(d) || d < 1 || d > maxDay) {
				return fail(400, { message: `Revisá el día: para ese mes debe ir del 1 al ${maxDay}.` });
			}

			birth_date = birthDateRaw;
		}

		const clinicalUpdates = {
			allergies: cleanText(form.get('allergies')),
			medication: cleanText(form.get('medication')),
			background: cleanText(form.get('background'))
		};
		const updates = {
			full_name,
			email: cleanText(form.get('email')),
			dni: dni || null,
			birth_date,
			address: cleanText(form.get('address')),
			insurance: cleanText(form.get('insurance')),
			insurance_plan: cleanText(form.get('insurance_plan')),
			phone: phone || null,
			phone_raw: normalizePhoneRaw(phoneInput),
			phone_e164: normalizePhoneE164(phoneInput),
			updated_at: new Date().toISOString()
		};

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
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canEditPatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Tu rol no permite editar datos de pacientes.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { context, ownerId } = session;
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const currentProfessional =
			context.role === 'professional'
				? await getCurrentProfessional({
						admin,
						businessId: context.business.id,
						userId: ownerId
					})
				: null;

		if (context.role === 'professional') {
			if (!currentProfessional) {
				return fail(403, { message: 'Tu usuario no está vinculado a un profesional del consultorio.' });
			}
			const link = await ensureProfessionalCanAccessPatient({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				professionalId: currentProfessional.id
			});
			if (!link) {
				return fail(403, { message: 'Este paciente no está asignado a tu perfil profesional.' });
			}
		}

		try {
			const duplicate = await findPatientDuplicateDniForUpdate({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				dni
			});
			if (duplicate) return duplicatePatientActionResult(duplicate);
		} catch (duplicateError) {
			logServerFailure('Error verificando duplicados al editar paciente', duplicateError);
			return fail(500, {
				message:
					'No pudimos comprobar si el DNI ya está asociado a otra ficha. Intentá de nuevo antes de guardar.'
			});
		}

		const [{ data: currentPatient, error: currentPatientError }, { data: currentProfile, error: currentProfileError }] =
			await Promise.all([
				admin
					.from('patients')
					.select(
						'full_name, dni, phone, email, birth_date, address, insurance, insurance_plan, updated_at'
					)
					.eq('id', params.id)
					.eq('business_id', context.business.id)
					.maybeSingle(),
				admin
					.from('patient_clinical_profiles')
					.select('allergies, medication, background, updated_at')
					.eq('patient_id', params.id)
					.eq('business_id', context.business.id)
					.maybeSingle()
			]);

		if (currentPatientError) {
			logServerFailure('Error cargando paciente antes de editar', currentPatientError);
			return fail(500, { message: 'No se pudo cargar la ficha antes de guardar.' });
		}
		if (!currentPatient) {
			return fail(404, { message: 'Paciente no encontrado.' });
		}
		if (
			expectedPatientUpdatedAt &&
			isStaleUpdatedAt(expectedPatientUpdatedAt, currentPatient.updated_at)
		) {
			return fail(409, {
				message: PATIENT_UPDATE_CONFLICT_MESSAGE,
				currentPatientUpdatedAt: String(currentPatient.updated_at ?? ''),
				currentClinicalProfileUpdatedAt: String(currentProfile?.updated_at ?? '')
			});
		}
		if (currentProfileError) {
			logServerFailure('Error cargando perfil clínico antes de editar', currentProfileError);
			if (permissions.canEditClinicalProfile) {
				return fail(500, {
					message: 'No se pudo cargar la información clínica antes de guardar. Intentá de nuevo.'
				});
			}
		}
		if (
			permissions.canEditClinicalProfile &&
			expectedClinicalProfileUpdatedAt &&
			isStaleUpdatedAt(expectedClinicalProfileUpdatedAt, currentProfile?.updated_at)
		) {
			return fail(409, {
				message: PATIENT_UPDATE_CONFLICT_MESSAGE,
				currentPatientUpdatedAt: String(currentPatient.updated_at ?? ''),
				currentClinicalProfileUpdatedAt: String(currentProfile?.updated_at ?? '')
			});
		}

		const { data: atomicUpdate, error } = await admin.rpc(
			'update_patient_with_clinical_profile_safely',
			{
				p_actor_id: ownerId,
				p_business_id: context.business.id,
				p_patient_id: params.id,
				p_full_name: updates.full_name,
				p_dni: updates.dni,
				p_phone: updates.phone,
				p_phone_raw: updates.phone_raw,
				p_phone_e164: updates.phone_e164,
				p_email: updates.email,
				p_birth_date: updates.birth_date,
				p_address: updates.address,
				p_insurance: updates.insurance,
				p_insurance_plan: updates.insurance_plan,
				p_update_clinical_profile: permissions.canEditClinicalProfile,
				p_allergies: permissions.canEditClinicalProfile ? clinicalUpdates.allergies : null,
				p_medication: permissions.canEditClinicalProfile ? clinicalUpdates.medication : null,
				p_background: permissions.canEditClinicalProfile ? clinicalUpdates.background : null,
				p_expected_patient_updated_at: currentPatient.updated_at ?? null,
				p_expected_clinical_profile_updated_at: permissions.canEditClinicalProfile
					? (currentProfile?.updated_at ?? null)
					: null
			}
		);

		if (error) {
			logServerFailure('Error actualizando ficha y perfil clínico del paciente', error);
			const mapped = patientUpdateRpcError(
				error,
				currentPatient.updated_at,
				currentProfile?.updated_at
			);
			if (mapped) return mapped;
			const duplicateResult = await mapDuplicatePatientError({
				error,
				admin,
				businessId: context.business.id,
				patientId: params.id,
				dni
			});
			if (duplicateResult) return duplicateResult;
			return fail(500, { message: 'No pudimos actualizar la ficha del paciente. Revisá los datos y volvé a intentar.' });
		}
		const savedAtomicUpdate = Array.isArray(atomicUpdate) ? atomicUpdate[0] : atomicUpdate;
		if (!isRecord(savedAtomicUpdate) || typeof savedAtomicUpdate.patient_id !== 'string' || !savedAtomicUpdate.patient_id) {
			console.error('La actualización de paciente no devolvió una ficha confirmada');
			return fail(500, { message: 'No se pudo confirmar la actualización de la ficha.' });
		}

		const changedFields = changedFieldsForPatientUpdate({
			currentPatient: currentPatient as Record<string, unknown>,
			currentProfile: permissions.canEditClinicalProfile
				? (currentProfile as Record<string, unknown> | null)
				: null,
			updates,
			clinicalUpdates: permissions.canEditClinicalProfile ? clinicalUpdates : {}
		});

		if (changedFields.length > 0) {
			const summary = `Se modificó: ${sentenceJoin(changedFields)}.`;
			const { error: changeLogError } = await admin.from('patient_profile_change_events').insert({
				business_id: context.business.id,
				patient_id: params.id,
				changed_by_user_id: ownerId,
				changed_by_professional_id: currentProfessional?.id ?? null,
				changed_by_name: getActorName(context.role, currentProfessional?.name),
				changed_fields: changedFields,
				summary
			});
			if (changeLogError) {
				logServerFailure('Error registrando cambios visibles del paciente', changeLogError);
			}
		}

		throw redirect(303, patientDetailUrl(params.id, 'datos'));
	},
	archive_patient: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let archived = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				const now = new Date().toISOString();
				patient.archived_at = now;
				patient.updated_at = now;
				archived = true;
			});

			if (!archived) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, '/odonto/pacientes?estado=archivados');
		}
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canArchivePatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Tu rol no permite archivar este paciente.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context, ownerId } = session;

		if (context.role === 'professional') {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			const professional = await getCurrentProfessional({
				admin,
				businessId: context.business.id,
				userId: ownerId
			});
			if (!professional) {
				return fail(403, { message: 'Tu usuario no está vinculado a un profesional del consultorio.' });
			}
			const link = await ensureProfessionalCanAccessPatient({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				professionalId: professional.id
			});
			if (!link) {
				return fail(403, { message: 'Este paciente no está asignado a tu perfil profesional.' });
			}
			const { data: updatedLink, error } = await admin
				.from('professional_patient_links')
				.update({
					archived_at: new Date().toISOString(),
					archived_by: ownerId,
					updated_at: new Date().toISOString()
				})
				.eq('id', link.id)
				.select('id')
				.maybeSingle();

			if (error) {
				logServerFailure('Error archivando paciente para profesional', error);
				return fail(500, { message: 'No se pudo archivar el paciente.' });
			}
			if (!updatedLink) {
				return fail(409, { message: 'El vínculo con el paciente cambió. Recargá la lista y volvé a intentar.' });
			}

			throw redirect(303, '/odonto/pacientes?estado=archivados');
		}

		const { error } = await supabase.rpc('set_patient_archive_state_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_archived: true
		});

		if (error) {
			logServerFailure('Error archivando paciente', error);
			const mapped = patientArchiveRpcError(error);
			return fail(mapped.status, { message: mapped.message });
		}

		throw redirect(303, '/odonto/pacientes?estado=archivados');
	},
	unarchive_patient: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let unarchived = false;
			updateDemoDb((db) => {
				const patient = db.patients.find((p) => p.id === params.id);
				if (!patient) return;
				patient.archived_at = null;
				patient.updated_at = new Date().toISOString();
				unarchived = true;
			});

			if (!unarchived) {
				return fail(404, { message: 'Paciente no encontrado' });
			}

			throw redirect(303, '/odonto/pacientes');
		}
		const session = await resolveBusinessActionContext({ locals, fetch, cookies });
		if (!session) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}
		const permissions = resolvePatientPermissions(session.context);
		if (!permissions.canArchivePatient) {
			return fail(403, {
				message: session.context.access.allowedCapabilities.canEditPatient
					? 'Tu rol no permite desarchivar este paciente.'
					: COMMERCIAL_RESTRICTED_MESSAGE
			});
		}
		const { supabase, context, ownerId } = session;

		if (context.role === 'professional') {
			const admin = await createSupabaseAdminClient('odonto', fetch);
			const professional = await getCurrentProfessional({
				admin,
				businessId: context.business.id,
				userId: ownerId
			});
			if (!professional) {
				return fail(403, { message: 'Tu usuario no está vinculado a un profesional del consultorio.' });
			}
			const link = await ensureProfessionalCanAccessPatient({
				admin,
				businessId: context.business.id,
				patientId: params.id,
				professionalId: professional.id
			});
			if (!link) {
				return fail(403, { message: 'Este paciente no está asignado a tu perfil profesional.' });
			}
			const { data: updatedLink, error } = await admin
				.from('professional_patient_links')
				.update({
					archived_at: null,
					archived_by: null,
					updated_at: new Date().toISOString()
				})
				.eq('id', link.id)
				.select('id')
				.maybeSingle();

			if (error) {
				logServerFailure('Error desarchivando paciente para profesional', error);
				return fail(500, { message: 'No se pudo desarchivar el paciente.' });
			}
			if (!updatedLink) {
				return fail(409, { message: 'El vínculo con el paciente cambió. Recargá la lista y volvé a intentar.' });
			}

			throw redirect(303, '/odonto/pacientes');
		}

		const { error } = await supabase.rpc('set_patient_archive_state_safely', {
			p_business_id: context.business.id,
			p_patient_id: params.id,
			p_archived: false
		});

		if (error) {
			logServerFailure('Error desarchivando paciente', error);
			const mapped = patientArchiveRpcError(error);
			return fail(mapped.status, { message: mapped.message });
		}

		throw redirect(303, '/odonto/pacientes');
	},
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
			message: 'Por seguridad, los pacientes no se eliminan directamente. Archivá el paciente para ocultarlo.'
		});
	}
};
