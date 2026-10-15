type SearchablePatient = {
	full_name?: string | null;
	dni?: string | null;
	phone?: string | null;
	phone_raw?: string | null;
	phone_e164?: string | null;
};

const normalizeText = (value: unknown) =>
	String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('es')
		.replace(/\s+/g, ' ')
		.trim();

const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '');

export const patientMatchesListQuery = (patient: SearchablePatient, query: string) => {
	const normalizedQuery = normalizeText(query);
	if (!normalizedQuery) return true;
	if (normalizeText(patient.full_name).includes(normalizedQuery)) return true;

	const queryDigits = digitsOnly(query);
	if (!queryDigits) return false;
	return [patient.dni, patient.phone_raw, patient.phone, patient.phone_e164].some((value) =>
		digitsOnly(value).includes(queryDigits)
	);
};
