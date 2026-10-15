export type TimeRange = {
	start: string;
	end: string;
};

const TIME_TOKEN = /\d{1,2}(?:(?::|\.|,)?\d{2})?/g;
const RANGE_PATTERN = /(\d{1,2}(?:(?::|\.|,)?\d{2})?)\s*-\s*(\d{1,2}(?:(?::|\.|,)?\d{2})?)/g;

export const normalizeTimeValue = (value: string) => {
	const cleaned = value
		.trim()
		.toLowerCase()
		.replace(/\s*(hs?|horas?)\.?$/i, '')
		.replace(/[,.]/g, ':')
		.replace(/\s+/g, '');
	if (!cleaned) return null;

	let hour = '';
	let minute = '00';
	const colonMatch = cleaned.match(/^(\d{1,2}):(\d{1,2})$/);
	if (colonMatch) {
		hour = colonMatch[1];
		minute = colonMatch[2];
	} else if (/^\d{1,2}$/.test(cleaned)) {
		hour = cleaned;
	} else if (/^\d{3,4}$/.test(cleaned)) {
		hour = cleaned.slice(0, cleaned.length - 2);
		minute = cleaned.slice(-2);
	} else {
		return null;
	}

	const hourNumber = Number(hour);
	const minuteNumber = Number(minute);
	if (!Number.isInteger(hourNumber) || !Number.isInteger(minuteNumber)) return null;
	if (hourNumber < 0 || hourNumber > 23 || minuteNumber < 0 || minuteNumber > 59) return null;
	return `${String(hourNumber).padStart(2, '0')}:${String(minuteNumber).padStart(2, '0')}`;
};

const normalizeRange = (startValue: string, endValue: string) => {
	const start = normalizeTimeValue(startValue);
	const end = normalizeTimeValue(endValue);
	if (!start || !end || start >= end) return null;
	return { start, end };
};

const parseCompactDigits = (digits: string) => {
	if (!digits) return null;
	const normalizedDigits = digits.length % 8 === 7 ? `0${digits}` : digits;
	if (normalizedDigits.length < 8 || normalizedDigits.length % 8 !== 0) return null;

	const ranges: TimeRange[] = [];
	for (let index = 0; index < normalizedDigits.length; index += 8) {
		const chunk = normalizedDigits.slice(index, index + 8);
		const range = normalizeRange(chunk.slice(0, 4), chunk.slice(4, 8));
		if (!range) return null;
		ranges.push(range);
	}
	return ranges;
};

const normalizeSeparators = (value: string) =>
	value
		.replace(/[–—]/g, '-')
		.replace(/(\d{1,2})[,.](\d{2})(?=\D|$)/g, '$1:$2')
		.replace(/\b(?:hasta|al|a)\b/gi, '-')
		.replace(/\s+y\s+/gi, ', ');

export const parseTimeRanges = (value: string): TimeRange[] | null => {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const compact = parseCompactDigits(trimmed.replace(/\D/g, ''));
	if (compact && /^[\d\s]+$/.test(trimmed)) return compact;

	const normalized = normalizeSeparators(trimmed);
	const matches = [...normalized.matchAll(RANGE_PATTERN)];
	if (matches.length > 0) {
		const leftover = normalized.replace(RANGE_PATTERN, '').replace(/[,\s;]+/g, '');
		if (leftover) return null;
		const ranges = matches.map((match) => normalizeRange(match[1], match[2]));
		if (ranges.some((range) => !range)) return null;
		return ranges as TimeRange[];
	}

	const rawRanges = normalized
		.split(/[,;\n]+/)
		.map((item) => item.trim())
		.filter(Boolean);

	const ranges = rawRanges.map((range) => {
		const tokens = range.match(TIME_TOKEN) ?? [];
		if (tokens.length !== 2) return null;
		return normalizeRange(tokens[0], tokens[1]);
	});

	if (ranges.length === 0 || ranges.some((range) => !range)) return null;
	return ranges as TimeRange[];
};

export const formatTimeRanges = (ranges: TimeRange[]) =>
	ranges.map((range) => `${range.start}-${range.end}`).join(', ');

export const normalizeTimeRangesInput = (value: string) => {
	const ranges = parseTimeRanges(value);
	return ranges ? formatTimeRanges(ranges) : value;
};

export const normalizeTimeRangesForCommit = (value: string) => {
	const ranges = parseTimeRanges(value);
	if (!ranges || ranges.length === 0) return { ok: false as const };
	return { ok: true as const, value: formatTimeRanges(ranges), ranges };
};
