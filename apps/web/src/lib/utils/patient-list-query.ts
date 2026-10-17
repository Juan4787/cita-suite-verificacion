export const normalizePatientListQuery = (value: string | null | undefined) => {
	const query = value?.trim().slice(0, 80) ?? '';
	return query.length >= 1 ? query : '';
};

// Cache identity and response scope use the same case-insensitive search key.
export const patientListQueryKey = (value: string | null | undefined) =>
	normalizePatientListQuery(value).toLocaleLowerCase('es');
