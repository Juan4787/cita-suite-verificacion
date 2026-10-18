import { isRecord } from '$lib/contracts/json';
import type { BusinessContext } from '$lib/access/contracts';
import type { CitaSupabaseClient } from '$lib/types/database';
import { parseMoneyInteger } from '$lib/utils/money-input';
import { logServerFailure } from '$lib/server/platform/logging';
import { resolvePatientPermissions } from './patient-permissions';
import { COMMERCIAL_RESTRICTED_MESSAGE, PatientOperationError } from './patient-operation-error';

export type ClinicalEntryInput = {
	entry_type: string;
	description: string;
	created_at: string;
	teeth: string | null;
	amount: number | null;
	internal_note: string | null;
};
export type SavedClinicalEntry = {
	id: string;
	patient_id: string;
	created_at: string;
	entry_type: string;
	description: string;
	teeth: string | null;
	internal_note: string | null;
	created_by_user_id: string | null;
	locked_after: string | null;
	amount: number | null;
};

/** The existing local datetime contract is shared by create/edit and demo. */
export function parseClinicalEntryInput(raw: {
	entryType: string;
	description: string;
	createdAt: string;
	teeth: string;
	amount: string;
	internalNote: string;
}): ClinicalEntryInput {
	const createdAtRaw = raw.createdAt.trim();
	if (!createdAtRaw) throw new PatientOperationError('invalid', 'Completá la fecha y hora.');
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(createdAtRaw);
	if (!match)
		throw new PatientOperationError(
			'invalid',
			'Revisá la fecha y hora. Formato esperado: Año/Mes/Día y Hora.'
		);
	const y = Number(match[1]),
		m = Number(match[2]),
		d = Number(match[3]),
		hh = Number(match[4]),
		mm = Number(match[5]);
	if (!Number.isInteger(y) || y < 2000 || y > 2045)
		throw new PatientOperationError('invalid', 'Revisá el año: debe estar entre 2000 y 2045.');
	if (!Number.isInteger(m) || m < 1 || m > 12)
		throw new PatientOperationError('invalid', 'Revisá el mes: debe ir del 1 al 12.');
	const maxDay = new Date(y, m, 0).getDate();
	if (!Number.isInteger(d) || d < 1 || d > maxDay)
		throw new PatientOperationError(
			'invalid',
			`Revisá el día: para ese mes debe ir del 1 al ${maxDay}.`
		);
	if (!Number.isInteger(hh) || hh < 0 || hh > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59)
		throw new PatientOperationError('invalid', 'Revisá la hora: debe estar entre 00:00 y 23:59.');
	const entryType = raw.entryType.trim();
	const description = raw.description.trim();
	if (!entryType || !description)
		throw new PatientOperationError('invalid', 'Tipo y descripción son obligatorios');
	// This is a text column: preserve existing custom/historical labels. The demo's
	// narrower display type does not impose a new database constraint.
	return {
		entry_type: entryType,
		description,
		created_at: new Date(y, m - 1, d, hh, mm, 0, 0).toISOString(),
		teeth: raw.teeth.trim() || null,
		amount: parseMoneyInteger(raw.amount.trim()),
		internal_note: raw.internalNote.trim() || null
	};
}

function clinicalFailure(cause: { message?: string; code?: string }): PatientOperationError {
	const message = `${cause.message ?? ''} ${cause.code ?? ''}`;
	if (message.includes('BUSINESS_ACCESS_RESTRICTED'))
		return new PatientOperationError('forbidden', COMMERCIAL_RESTRICTED_MESSAGE);
	if (message.includes('PATIENT_NOT_FOUND'))
		return new PatientOperationError('missing', 'Paciente no encontrado en este consultorio.');
	if (message.includes('ENTRY_TYPE_REQUIRED') || message.includes('DESCRIPTION_REQUIRED'))
		return new PatientOperationError('invalid', 'Tipo y descripcion son obligatorios.');
	if (message.includes('INVALID_CLINICAL_ENTRY_DATE'))
		return new PatientOperationError(
			'invalid',
			'La fecha de la consulta no puede estar en el futuro.'
		);
	if (message.includes('CLINICAL_COST_DENIED'))
		return new PatientOperationError('forbidden', 'Tu rol no permite registrar importes.');
	if (
		[
			'CLINICAL_ENTRY_DENIED',
			'CLINICAL_ENTRY_EDIT_DENIED',
			'PATIENT_ACCESS_DENIED',
			'PROFESSIONAL_LINK_REQUIRED'
		].some((code) => message.includes(code))
	)
		return new PatientOperationError(
			'forbidden',
			'Tu rol no permite modificar la historia clinica de este paciente.'
		);
	if (message.includes('CLINICAL_ENTRY_LOCKED'))
		return new PatientOperationError('forbidden', 'Esta entrada ya no se puede editar.');
	if (message.includes('CLINICAL_ENTRY_NOT_FOUND'))
		return new PatientOperationError('missing', 'Entrada no encontrada o sin permiso de edicion.');
	return new PatientOperationError(
		'unavailable',
		'No pudimos guardar la entrada clínica. Revisá los datos y volvé a intentar.'
	);
}

function readSavedClinicalEntry(value: unknown, patientId: string): SavedClinicalEntry | null {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		!value.id ||
		value.patient_id !== patientId ||
		typeof value.created_at !== 'string' ||
		typeof value.entry_type !== 'string' ||
		typeof value.description !== 'string'
	)
		return null;
	const amount = value.amount == null ? null : Number(value.amount);
	return {
		id: value.id,
		patient_id: patientId,
		created_at: value.created_at,
		entry_type: value.entry_type,
		description: value.description,
		teeth: typeof value.teeth === 'string' ? value.teeth : null,
		internal_note: typeof value.internal_note === 'string' ? value.internal_note : null,
		created_by_user_id:
			typeof value.created_by_user_id === 'string' ? value.created_by_user_id : null,
		locked_after: typeof value.locked_after === 'string' ? value.locked_after : null,
		amount: amount != null && Number.isFinite(amount) ? amount : null
	};
}

function assertClinicalWrite(context: BusinessContext, input: ClinicalEntryInput, edit: boolean) {
	const permissions = resolvePatientPermissions(context);
	const permitted = edit ? permissions.canEditClinicalEntry : permissions.canCreateClinicalEntry;
	if (!permitted)
		throw new PatientOperationError(
			'forbidden',
			(
				edit
					? context.access.allowedCapabilities.canEditClinicalEntry
					: context.access.allowedCapabilities.canCreateClinicalEntry
			)
				? edit
					? 'Tu rol no permite editar consultas clínicas.'
					: 'Tu rol no permite registrar consultas clínicas.'
				: COMMERCIAL_RESTRICTED_MESSAGE
		);
	if (input.amount != null && !permissions.canViewCosts)
		throw new PatientOperationError('forbidden', 'Tu rol no permite registrar importes.');
}

/** PostgreSQL owns authorization revalidation, atomicity and provenance. */
export async function createClinicalEntry({
	supabase,
	context,
	patientId,
	input
}: {
	supabase: CitaSupabaseClient;
	context: BusinessContext;
	patientId: string;
	input: ClinicalEntryInput;
}): Promise<SavedClinicalEntry | null> {
	assertClinicalWrite(context, input, false);
	const { data, error } = await supabase.rpc('create_clinical_entry_with_result_safely', {
		p_business_id: context.business.id,
		p_patient_id: patientId,
		p_entry_type: input.entry_type,
		p_description: input.description,
		p_created_at: input.created_at,
		p_teeth: input.teeth,
		p_internal_note: input.internal_note,
		p_amount: input.amount
	});
	if (error) {
		logServerFailure('clinical.entry.create.failed', error);
		throw clinicalFailure(error);
	}
	const saved = readSavedClinicalEntry(data, patientId);
	// A successful commit with an unusable result must reload, never invite a
	// second INSERT. The HTTP adapter preserves the non-enhanced redirect too.
	if (!saved) logServerFailure('clinical.entry.create.result_invalid');
	return saved;
}

export async function updateClinicalEntry({
	supabase,
	context,
	patientId,
	entryId,
	input
}: {
	supabase: CitaSupabaseClient;
	context: BusinessContext;
	patientId: string;
	entryId: string;
	input: ClinicalEntryInput;
}): Promise<void> {
	if (!entryId) throw new PatientOperationError('invalid', 'Entrada inválida.');
	assertClinicalWrite(context, input, true);
	const { error } = await supabase.rpc('update_clinical_entry_safely', {
		p_business_id: context.business.id,
		p_patient_id: patientId,
		p_entry_id: entryId,
		p_entry_type: input.entry_type,
		p_description: input.description,
		p_teeth: input.teeth,
		p_internal_note: input.internal_note,
		p_amount: input.amount
	});
	if (error) {
		logServerFailure('clinical.entry.update.failed', error);
		throw clinicalFailure(error);
	}
}
