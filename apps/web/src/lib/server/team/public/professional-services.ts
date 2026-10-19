/** Normalization only; assignment mutations belong to the authenticated SQL commands. */
export const idsFromForm = (form: FormData, key: string) => [
	...new Set(
		form
			.getAll(key)
			.map(String)
			.map((value) => value.trim())
			.filter(Boolean)
	)
];
