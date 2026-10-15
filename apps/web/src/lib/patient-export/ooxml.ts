const OOXML_LITERAL_ESCAPE = /_(?=x[0-9a-f]{4}_)/gi;
const OOXML_ESCAPE = /_x([0-9a-f]{4})_/gi;

export class PatientExportTextError extends Error {
	constructor() {
		super('Uno de los textos contiene caracteres que no se pueden exportar. Revisalo y volvé a intentar.');
		this.name = 'PatientExportTextError';
	}
}

export const assertWellFormedUnicode = (value: string): void => {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const low = value.charCodeAt(index + 1);
			if (!(low >= 0xdc00 && low <= 0xdfff)) throw new PatientExportTextError();
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) throw new PatientExportTextError();
	}
};

const isCharacterRemovedByWriter = (codePoint: number): boolean =>
	(codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
	(codePoint >= 0x7f && codePoint <= 0x9f) ||
	codePoint === 0xfffd ||
	(codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
	(codePoint & 0xffff) === 0xfffe ||
	(codePoint & 0xffff) === 0xffff;

const escapeCodeUnit = (codeUnit: number): string =>
	`_x${codeUnit.toString(16).toUpperCase().padStart(4, '0')}_`;

/**
 * Prepara texto para ST_Xstring antes de que `write-excel-file` genere XML.
 *
 * Se protege primero cualquier secuencia `_xHHHH_` escrita literalmente por
 * el usuario. Después se codifican como escapes OOXML los caracteres que el
 * serializador de terceros quitaría, incluidos CR, controles y noncharacters.
 * La transformación es reversible y nunca convierte el texto en una fórmula.
 */
export const escapePatientExportTextForOoxml = (value: string): string => {
	assertWellFormedUnicode(value);
	const protectedValue = value.replace(OOXML_LITERAL_ESCAPE, '_x005F_');
	let escaped = '';

	for (let index = 0; index < protectedValue.length; index += 1) {
		const codeUnit = protectedValue.charCodeAt(index);
		const codePoint = protectedValue.codePointAt(index);
		if (codePoint === undefined) throw new PatientExportTextError();

		if (codePoint > 0xffff) {
			const low = protectedValue.charCodeAt(index + 1);
			if (isCharacterRemovedByWriter(codePoint)) {
				escaped += escapeCodeUnit(codeUnit) + escapeCodeUnit(low);
			} else {
				escaped += protectedValue.slice(index, index + 2);
			}
			index += 1;
			continue;
		}

		escaped += isCharacterRemovedByWriter(codePoint)
			? escapeCodeUnit(codeUnit)
			: protectedValue[index];
	}

	return escaped;
};

/** Decodificador de contrato usado para comprobar la reversibilidad. */
export const decodePatientExportOoxmlText = (value: string): string =>
	value.replace(OOXML_ESCAPE, (_match, hexadecimal: string) =>
		String.fromCharCode(Number.parseInt(hexadecimal, 16))
	);
