export type CommunicationPhoneStatus = 'valid' | 'missing' | 'invalid';

export type CommunicationPhone = {
	status: CommunicationPhoneStatus;
	normalized: string | null;
};

export type CommunicationPhoneDecision = CommunicationPhone & {
	acknowledged: boolean;
	warning: Exclude<CommunicationPhoneStatus, 'valid'> | null;
};

const isArgentineNationalNumber = (digits: string) =>
	/^\d{10}$/.test(digits) && (digits.startsWith('11') || /^[23]/.test(digits));

const normalizeArgentineNationalNumber = (rawDigits: string): string | null => {
	const digits = rawDigits.startsWith('0') ? rawDigits.slice(1) : rawDigits;
	if (isArgentineNationalNumber(digits)) return digits;

	if (digits.length !== 12) return null;
	const areaCodeLengths = digits.startsWith('11')
		? [2]
		: /^[23]/.test(digits)
			? [3, 4]
			: [];
	const candidates = [
		...new Set(
			areaCodeLengths
				.filter((areaLength) => digits.slice(areaLength, areaLength + 2) === '15')
				.map((areaLength) => digits.slice(0, areaLength) + digits.slice(areaLength + 2))
				.filter(isArgentineNationalNumber)
		)
	];
	return candidates.length === 1 ? candidates[0] : null;
};

export const normalizeArgentineWhatsAppPhone = (value?: string | null): string | null => {
	let digits = String(value ?? '').replace(/\D/g, '');
	if (!digits) return null;
	if (digits.startsWith('00')) digits = digits.slice(2);

	let national: string | null;
	if (digits.startsWith('549')) {
		national = isArgentineNationalNumber(digits.slice(3)) ? digits.slice(3) : null;
	} else if (digits.startsWith('54')) {
		national = normalizeArgentineNationalNumber(digits.slice(2));
	} else {
		national = normalizeArgentineNationalNumber(digits);
	}

	return national ? `+549${national}` : null;
};

export const classifyCommunicationPhone = (value?: string | null): CommunicationPhone => {
	const raw = String(value ?? '').trim();
	if (!raw) return { status: 'missing', normalized: null };
	const normalized = normalizeArgentineWhatsAppPhone(raw);
	return normalized
		? { status: 'valid', normalized }
		: { status: 'invalid', normalized: null };
};

export const resolveCommunicationPhoneDecision = (
	value?: string | null,
	override?: string | null
): CommunicationPhoneDecision => {
	const phone = classifyCommunicationPhone(value);
	if (phone.status === 'valid') return { ...phone, acknowledged: false, warning: null };
	const acknowledged = override === phone.status;
	return {
		...phone,
		acknowledged,
		warning: acknowledged ? null : phone.status
	};
};
