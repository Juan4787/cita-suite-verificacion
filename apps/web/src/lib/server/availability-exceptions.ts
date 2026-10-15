import { parseTimeRanges } from '$lib/utils/time-ranges';
import { zonedDateTimeToUtc } from './availability';

export type AvailabilityExceptionPeriodMode = 'single' | 'range';

type AvailabilityExceptionIntervalInput = {
	type: string;
	periodMode?: string;
	date?: string;
	dateFrom?: string;
	dateTo?: string;
	timeRange?: string;
	timeZone: string;
};

export type AvailabilityExceptionIntervalResult =
	| {
			ok: true;
			periodMode: AvailabilityExceptionPeriodMode;
			startDate: string;
			endDate: string;
			startsAt: Date;
			endsAt: Date;
		}
	| { ok: false; message: string };

const pad = (value: number) => String(value).padStart(2, '0');

export const normalizeAvailabilityDate = (value: string) => {
	const trimmed = value.trim();
	const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	const localMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	const year = Number(isoMatch?.[1] ?? localMatch?.[3]);
	const month = Number(isoMatch?.[2] ?? localMatch?.[2]);
	const day = Number(isoMatch?.[3] ?? localMatch?.[1]);
	if (!year || !month || !day) return '';

	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return '';
	}
	return `${year}-${pad(month)}-${pad(day)}`;
};

const addCalendarDays = (date: string, days: number) => {
	const cursor = new Date(`${date}T12:00:00.000Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
};

const localDateTime = (date: string, time: string, timeZone: string) => {
	try {
		const value = zonedDateTimeToUtc(date, time, timeZone);
		return Number.isNaN(value.getTime()) ? null : value;
	} catch {
		return null;
	}
};

export const parseAvailabilityExceptionInterval = (
	input: AvailabilityExceptionIntervalInput
): AvailabilityExceptionIntervalResult => {
	if (input.type !== 'blocked' && input.type !== 'extra_available' && input.type !== 'restricted') {
		return { ok: false, message: 'El tipo de cambio no es válido.' };
	}

	const periodMode: AvailabilityExceptionPeriodMode = input.periodMode === 'range' ? 'range' : 'single';
	if (periodMode === 'range') {
		if (input.type !== 'blocked') {
			return { ok: false, message: 'Los rangos de fechas están disponibles sólo para bloqueos.' };
		}

		const startDate = normalizeAvailabilityDate(input.dateFrom ?? '');
		const endDate = normalizeAvailabilityDate(input.dateTo ?? '');
		if (!startDate || !endDate) {
			return { ok: false, message: 'Completá las fechas Desde y Hasta.' };
		}
		if (endDate < startDate) {
			return { ok: false, message: 'La fecha Hasta no puede ser anterior a Desde.' };
		}

		const startsAt = localDateTime(startDate, '00:00', input.timeZone);
		const endsAt = localDateTime(addCalendarDays(endDate, 1), '00:00', input.timeZone);
		if (!startsAt || !endsAt || startsAt >= endsAt) {
			return { ok: false, message: 'El rango de fechas no es válido.' };
		}
		return { ok: true, periodMode, startDate, endDate, startsAt, endsAt };
	}

	const startDate = normalizeAvailabilityDate(input.date ?? '');
	const ranges = parseTimeRanges(input.timeRange ?? '');
	if (!startDate || !ranges || ranges.length !== 1) {
		return { ok: false, message: 'Completá una fecha y una sola franja horaria válida.' };
	}

	const startsAt = localDateTime(startDate, ranges[0].start, input.timeZone);
	const endsAt = localDateTime(startDate, ranges[0].end, input.timeZone);
	if (!startsAt || !endsAt || startsAt >= endsAt) {
		return { ok: false, message: 'La franja horaria no es válida.' };
	}
	return { ok: true, periodMode, startDate, endDate: startDate, startsAt, endsAt };
};
