export const moneyDigits = (value: string | number | null | undefined) =>
	String(value ?? '')
		.replace(/\D/g, '')
		.replace(/^0+(?=\d)/, '');

export const formatMoneyInteger = (value: string | number | null | undefined) => {
	const digits = moneyDigits(value);
	if (!digits) return '';
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export const formatPriceLabel = (value: string | number | null | undefined) => {
	const formatted = formatMoneyInteger(value);
	return formatted ? `$ ${formatted}` : '';
};

export const parseMoneyInteger = (value: string | number | null | undefined) => {
	const digits = moneyDigits(value);
	if (!digits) return null;
	const parsed = Number(digits);
	return Number.isFinite(parsed) ? parsed : null;
};
