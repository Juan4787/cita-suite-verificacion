export const normalizePatientListQuery = (value: string | null | undefined) => {
	const query = value?.trim().slice(0, 80) ?? '';
	return query.length >= 1 ? query : '';
};
