export { normalizeArgentineWhatsAppPhone } from '$lib/utils/communication-phone';

export const normalizePhoneE164 = (value?: string | null) => {
	const digits = String(value ?? '').replace(/\D/g, '');
	if (!digits) return null;
	if (digits.startsWith('00')) return `+${digits.slice(2)}`;
	if (digits.startsWith('549')) return `+${digits}`;
	if (digits.startsWith('54')) return `+549${digits.slice(2)}`;
	if (digits.length === 10) return `+549${digits}`;
	return `+${digits}`;
};

export const normalizePhoneRaw = (value?: string | null) => {
	const trimmed = String(value ?? '').trim();
	return trimmed || null;
};

export const isLikelyPhoneE164 = (value?: string | null) => {
	const normalized = normalizePhoneE164(value);
	if (!normalized) return false;
	const digits = normalized.replace(/\D/g, '');
	return digits.length >= 8 && digits.length <= 15;
};
