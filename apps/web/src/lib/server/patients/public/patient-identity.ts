export type PatientUniqueField = 'dni';

type DatabaseError = {
	code?: string | null;
	message?: string | null;
	details?: string | null;
	hint?: string | null;
};

export const PATIENT_UNIQUE_CONFLICT_MESSAGES: Record<PatientUniqueField, string> = {
	dni: 'Ya hay una ficha asociada a este DNI. Abrila para continuar o revisá el número si está mal cargado.'
};

export const LEGACY_PATIENT_NAME_CONFLICT_MESSAGE =
	'El nombre coincide con otra ficha, pero dos personas pueden llamarse igual. Esta validación está desactualizada; avisale a la administración antes de volver a guardar.';

export const UNKNOWN_PATIENT_UNIQUE_CONFLICT_MESSAGE =
	'No pudimos guardar porque un dato ya está asociado a otra ficha, pero no pudimos identificar cuál con seguridad. No cambies información al azar: intentá de nuevo o contactá a soporte.';

const databaseErrorText = (error: DatabaseError | null | undefined) =>
	[error?.message, error?.details, error?.hint].filter(Boolean).join(' ');

export const isLegacyPatientNameConflict = (error: DatabaseError | null | undefined) =>
	databaseErrorText(error).includes('PATIENT_NAME_ALREADY_EXISTS');

export const getPatientUniqueConflictField = (
	error: DatabaseError | null | undefined
): PatientUniqueField | null => {
	const raw = databaseErrorText(error);
	const normalized = raw.toLowerCase();

	if (raw.includes('PATIENT_DNI_ALREADY_EXISTS')) return 'dni';
	if (error?.code !== '23505') return null;

	if (
		normalized.includes('patients_business_dni_uq') ||
		normalized.includes('patients_owner_dni_uq') ||
		normalized.includes('(business_id, dni)') ||
		normalized.includes('(owner_id, dni)')
	) {
		return 'dni';
	}

	return null;
};

export const getPatientWriteConflictMessage = (
	error: DatabaseError | null | undefined
): string | null => {
	const field = getPatientUniqueConflictField(error);
	if (field) return PATIENT_UNIQUE_CONFLICT_MESSAGES[field];
	if (isLegacyPatientNameConflict(error)) return LEGACY_PATIENT_NAME_CONFLICT_MESSAGE;
	if (error?.code === '23505') return UNKNOWN_PATIENT_UNIQUE_CONFLICT_MESSAGE;
	return null;
};
