export const PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE =
	'Ingresá tu nombre y apellido para reservar.';

// No se puede verificar la identidad de una persona desde el formulario, pero sí
// explicar con precisión qué formato acepta. Esta distinción evita que un valor
// presente pero artificial (por ejemplo, con números) parezca un campo vacío.
export const PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE =
	'Usá tu nombre y apellido real, sin números. Escribí al menos dos palabras con letras; podés usar guiones o apóstrofes dentro de cada palabra.';

const VALID_NAME_PART = /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u;

/**
 * Keeps the patient's spelling while removing whitespace differences that
 * should never create separate identities or be persisted in the record.
 */
export const normalizePatientFullName = (value: string) =>
	value.normalize('NFC').trim().replace(/\s+/gu, ' ');

/**
 * Public bookings require at least a given name and a surname. Each part must
 * be a real word with at least two letters; apostrophes and hyphens are allowed
 * inside a word so names such as O'Connor and Pérez-Gómez remain valid.
 */
export const isValidPatientFullName = (value: string) => {
	const parts = normalizePatientFullName(value).split(' ').filter(Boolean);
	return (
		parts.length >= 2 &&
		parts.every(
			(part) => VALID_NAME_PART.test(part) && (part.match(/\p{L}/gu)?.length ?? 0) >= 2
		)
	);
};

/**
 * Mensaje accionable para la validación visible del nombre público.
 * El servidor y la validación nativa del navegador comparten este contrato.
 */
export const patientFullNameErrorMessage = (value: string) => {
	const normalized = normalizePatientFullName(value);
	if (!normalized) return PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE;
	return isValidPatientFullName(normalized) ? '' : PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE;
};

// Compatibilidad de importación para consumidores que sólo necesitan el texto
// de campo vacío. Las rutas de reserva usan patientFullNameErrorMessage para no
// perder la causa concreta.
export const PATIENT_FULL_NAME_ERROR_MESSAGE = PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE;

/**
 * Mirrors the database comparison used by the public-booking capacity rule.
 * Spanish vowel accents are ignored, but ñ remains distinct from n because it
 * is a different letter (Peña and Pena must not be merged).
 */
export const normalizePatientNameForComparison = (value: string) =>
	normalizePatientFullName(value)
		.toLocaleLowerCase('es-AR')
		.replace(/[áàâäãå]/g, 'a')
		.replace(/[éèêë]/g, 'e')
		.replace(/[íìîï]/g, 'i')
		.replace(/[óòôöõ]/g, 'o')
		.replace(/[úùûü]/g, 'u')
		.replace(/[ýÿ]/g, 'y');
