import { InvalidDataContractError } from '$lib/contracts/json';
import { readSavedPatientEntry, type SavedPatientEntry } from '$lib/patients/history-contract';
import type { BusinessContext } from '$lib/access/contracts';
import type { CitaSupabaseClient } from '$lib/types/database';
import { readClinicalAmount } from '$lib/patients/clinical-amount';
import { logServerFailure } from '$lib/server/platform/logging';
import { resolvePatientPermissions } from './patient-permissions';
import { zonedDateTimeToUtc } from '$lib/availability/calculate';
import { COMMERCIAL_RESTRICTED_MESSAGE, PatientOperationError } from './patient-operation-error';

export type ClinicalEntryInput = {
	entry_type: string;
	description: string;
	created_at: string;
	teeth: string | null;
	amount: number | null;
	internal_note: string | null;
};
export type SavedClinicalEntry = SavedPatientEntry;

/** The existing local datetime contract is shared by create/edit and demo. */
export function parseClinicalEntryInput(
	raw: {
		entryType: string;
		description: string;
		createdAt: string;
		teeth: string;
		amount: string;
		amountFormat?: string;
		internalNote: string;
	},
	timeZone = 'UTC'
): ClinicalEntryInput {
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
	const amount = readClinicalAmount(raw.amount, raw.amountFormat === 'canonical');
	if (!amount.valid || (raw.amountFormat && raw.amountFormat !== 'canonical'))
		throw new PatientOperationError('invalid', 'Revisá el importe de la consulta.');
	const instant = zonedDateTimeToUtc(createdAtRaw.slice(0, 10), createdAtRaw.slice(11), timeZone);
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(instant);
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
	if (
		`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}` !==
		createdAtRaw
	)
		throw new PatientOperationError(
			'invalid',
			'Esa hora no existe en la zona horaria del consultorio. Elegí otra hora.'
		);
	// This is a text column: preserve existing custom/historical labels. The demo's
	// narrower display type does not impose a new database constraint.
	return {
		entry_type: entryType,
		description,
		created_at: instant.toISOString(),
		teeth: raw.teeth.trim() || null,
		amount: amount.value,
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
	if (message.includes('CLINICAL_ENTRY_DATE_EDIT_DENIED'))
		return new PatientOperationError(
			'forbidden',
			'La fecha y hora de registro de esta consulta se conservan.'
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
	try {
		return readSavedPatientEntry(data, patientId);
	} catch (cause) {
		if (!(cause instanceof InvalidDataContractError)) throw cause;
		// A committed write with an invalid projection reloads; it never retries the INSERT.
		logServerFailure('clinical.entry.create.result_invalid');
		return null;
	}
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
	const { error } = await supabase.rpc('update_clinical_entry_with_date_safely', {
		p_business_id: context.business.id,
		p_patient_id: patientId,
		p_entry_id: entryId,
		p_entry_type: input.entry_type,
		p_description: input.description,
		p_created_at: input.created_at,
		p_teeth: input.teeth,
		p_internal_note: input.internal_note,
		p_amount: input.amount
	});
	if (error) {
		logServerFailure('clinical.entry.update.failed', error);
		throw clinicalFailure(error);
	}
}
