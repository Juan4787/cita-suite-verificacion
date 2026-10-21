type AmountRead = { valid: true; value: number | null } | { valid: false };

/** Clinical costs include historical fractions. Booking tariffs have a separate integer contract. */
export function readClinicalAmount(value: string, canonical = false): AmountRead {
	let text = value.trim();
	if (!text) return { valid: true, value: null };
	if (!canonical) {
		// Preserve older form submissions using Argentine thousands separators.
		// New forms explicitly mark the hidden numeric value as canonical, so a
		// historical 0.001 cannot accidentally become one peso.
		if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
		else if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text))
			text = text.replace(/\./g, '').replace(',', '.');
	}
	if (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return { valid: false };
	const amount = Number(text);
	return Number.isFinite(amount) ? { valid: true, value: amount } : { valid: false };
}

export function clinicalAmountForEdit(value: number | null | undefined) {
	return value == null
		? { raw: '', display: '' }
		: {
				raw: String(value),
				display: new Intl.NumberFormat('es-AR', { maximumFractionDigits: 20 }).format(value)
			};
}

/** A clinical cost as shown: with its cents when it has a fraction, never rounding a historical one. */
export function formatClinicalAmount(value: number) {
	const fraction = !Number.isInteger(value);
	return `$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: fraction ? 2 : 0, maximumFractionDigits: 20 }).format(value)}`;
}

/** Keep display punctuation separate from the canonical submitted number. */
export function clinicalAmountFromDisplay(value: string) {
	const text = value.trim();
	if (!text) return { valid: true, raw: '', display: '' };
	const match = /^(-?)(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d*))?$/.exec(text);
	if (!match) return { valid: false, raw: '', display: value };
	const integer = match[2].replace(/\./g, '').replace(/^0+(?=\d)/, '');
	const decimal = match[3];
	const parsed = readClinicalAmount(`${match[1]}${integer}${decimal ? '.' + decimal : ''}`, true);
	if (!parsed.valid) return { valid: false, raw: '', display: value };
	return {
		valid: true,
		raw: parsed.value == null ? '' : String(parsed.value),
		display:
			match[1] +
			integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') +
			(decimal === undefined ? '' : ',' + decimal)
	};
}
