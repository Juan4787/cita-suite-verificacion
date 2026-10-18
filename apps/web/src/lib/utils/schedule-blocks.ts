import { isRecord } from '$lib/contracts/json';
import { formatTimeRanges, parseTimeRanges, type TimeRange } from './time-ranges';

export type ScheduleBlockDraft = {
	serviceScope?: 'all' | 'restricted';
	allowedServiceIds?: string[];
	id?: string;
	weekdays: number[];
	timeRanges: string;
	/**
	 * Descanso real entre consultas. El nombre se conserva para que los
	 * borradores antiguos sigan pudiendo recuperarse sin perder información.
	 */
	slotInterval: string;
	/** Separación interna de la grilla de horarios; no se muestra como descanso. */
	gridInterval?: string;
};

export type NormalizedScheduleBlock = {
	serviceScope?: 'all' | 'restricted';
	allowedServiceIds?: string[];
	weekdays: number[];
	ranges: TimeRange[];
	slotIntervalMinutes: number;
	breakMinutes: number;
};

type RuleLike = {
	service_scope?: 'all' | 'restricted';
	allowed_service_ids?: string[];
	rule_services?: { service_id: string }[];
	weekday: number;
	start_time: string;
	end_time: string;
	slot_interval_minutes: number;
	break_minutes?: number | null;
};

export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export const createEmptyScheduleBlock = (id?: string): ScheduleBlockDraft => ({
	id,
	weekdays: [],
	timeRanges: '',
	slotInterval: '15',
	gridInterval: '15'
});

export const createDefaultScheduleBlock = (id?: string): ScheduleBlockDraft => ({
	id,
	weekdays: [...DEFAULT_WEEKDAYS],
	timeRanges: '',
	slotInterval: '15',
	gridInterval: '15'
});

export const normalizeScheduleWeekdays = (weekdays: unknown) => {
	if (!Array.isArray(weekdays)) return [];
	const values: unknown[] = weekdays;
	return [
		...new Set(
			values
				.filter(
					(value): value is string | number =>
						typeof value === 'string' || typeof value === 'number'
				)
				.map(Number)
				.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
		)
	].sort((a, b) => a - b);
};

export const timeRangesOverlap = (ranges: TimeRange[]) => {
	const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
	return sorted.some((range, index) => index > 0 && range.start < sorted[index - 1].end);
};

export const validateScheduleBlocks = (
	blocks: ScheduleBlockDraft[]
):
	| { ok: true; blocks: NormalizedScheduleBlock[] }
	| { ok: false; message: string; blockIndex?: number } => {
	const normalized: NormalizedScheduleBlock[] = [];
	const usedWeekdays = new Map<number, TimeRange[]>();

	for (const [index, block] of blocks.entries()) {
		const label = `bloque ${index + 1}`;
		const weekdays = normalizeScheduleWeekdays(block.weekdays);
		if (weekdays.length === 0) {
			return { ok: false, message: `Elegí al menos un día en el ${label}.`, blockIndex: index };
		}

		const ranges = parseTimeRanges(block.timeRanges);
		if (!ranges || ranges.length === 0) {
			return { ok: false, message: `Horario inválido en el ${label}.`, blockIndex: index };
		}
		if (timeRangesOverlap(ranges)) {
			return {
				ok: false,
				message: `Los horarios del ${label} no pueden superponerse.`,
				blockIndex: index
			};
		}
		for (const weekday of weekdays) {
			const previous = usedWeekdays.get(weekday) ?? [];
			if (timeRangesOverlap([...previous, ...ranges]))
				return {
					ok: false,
					message: 'Los horarios de un mismo día no pueden superponerse. Revisá las franjas.',
					blockIndex: index
				};
			usedWeekdays.set(weekday, [...previous, ...ranges]);
		}
		if (
			block.serviceScope === 'restricted' &&
			(!Array.isArray(block.allowedServiceIds) ||
				block.allowedServiceIds.length > 100 ||
				new Set(block.allowedServiceIds).size !== block.allowedServiceIds.length)
		)
			return {
				ok: false,
				message: 'Elegí las prestaciones permitidas para esta franja.',
				blockIndex: index
			};

		const rawBreakMinutes = String(block.slotInterval ?? '').trim();
		const breakMinutes = rawBreakMinutes === '' ? Number.NaN : Number(rawBreakMinutes);
		if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
			return {
				ok: false,
				message: `El descanso entre consultas del ${label} debe ser una cantidad entera de minutos igual o superior a 0. Podés usar, por ejemplo, 0, 2, 23 o 60.`,
				blockIndex: index
			};
		}
		const slotIntervalMinutes = Number(block.gridInterval || 15);
		if (
			!Number.isInteger(slotIntervalMinutes) ||
			slotIntervalMinutes < 1 ||
			slotIntervalMinutes > 120
		) {
			return {
				ok: false,
				message: `No pudimos conservar la grilla horaria del ${label}. Volvé a cargar ese bloque y guardalo otra vez.`,
				blockIndex: index
			};
		}

		normalized.push({
			weekdays,
			ranges,
			slotIntervalMinutes,
			breakMinutes,
			...(block.serviceScope === 'restricted'
				? { serviceScope: 'restricted' as const, allowedServiceIds: block.allowedServiceIds }
				: {})
		});
	}

	if (normalized.length === 0) {
		return { ok: false, message: 'Elegí al menos un bloque horario.' };
	}

	return { ok: true, blocks: normalized };
};

const rangeKey = (ranges: TimeRange[]) =>
	ranges.map((range) => `${range.start}-${range.end}`).join(',');

export const canonicalScheduleBlocks = (blocks: ScheduleBlockDraft[]) => {
	const result = validateScheduleBlocks(blocks);
	if (!result.ok) return JSON.stringify(blocks);
	return JSON.stringify(
		result.blocks
			.map((block) => ({
				weekdays: block.weekdays,
				serviceScope: block.serviceScope ?? 'all',
				allowedServiceIds: [...(block.allowedServiceIds ?? [])].sort(),
				ranges: rangeKey(block.ranges),
				slotIntervalMinutes: block.slotIntervalMinutes,
				breakMinutes: block.breakMinutes
			}))
			.sort((a, b) => a.weekdays.join(',').localeCompare(b.weekdays.join(',')))
	);
};

export const serializeScheduleBlocks = (blocks: ScheduleBlockDraft[]) =>
	JSON.stringify(
		blocks.map((block) => ({
			weekdays: normalizeScheduleWeekdays(block.weekdays),
			serviceScope: block.serviceScope ?? 'all',
			allowedServiceIds: block.allowedServiceIds ?? [],
			timeRanges: block.timeRanges,
			slotInterval: String(block.slotInterval),
			gridInterval: String(block.gridInterval || '15')
		}))
	);

export const parseScheduleBlocksJson = (raw: string): ScheduleBlockDraft[] | null => {
	if (!raw.trim()) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const rows: unknown[] = parsed;
	const result: ScheduleBlockDraft[] = [];
	const scalarText = (value: unknown, fallback: string) =>
		value == null
			? fallback
			: typeof value === 'string' || typeof value === 'number'
				? String(value)
				: null;
	for (const item of rows) {
		if (
			!isRecord(item) ||
			(item.serviceScope != null &&
				item.serviceScope !== 'all' &&
				item.serviceScope !== 'restricted')
		)
			return null;
		const serviceIds: unknown = item.allowedServiceIds ?? [];
		if (!Array.isArray(serviceIds)) return null;
		const identifiers: unknown[] = serviceIds;
		if (!identifiers.every((id): id is string => typeof id === 'string')) return null;
		const timeRanges = scalarText(item.timeRanges ?? item.time_ranges, '');
		const slotInterval = scalarText(
			item.breakMinutes ?? item.break_minutes ?? item.slotInterval,
			'15'
		);
		const gridInterval = scalarText(item.gridInterval ?? item.slot_interval_minutes, '15');
		if (timeRanges === null || slotInterval === null || gridInterval === null) return null;
		result.push({
			serviceScope: item.serviceScope === 'restricted' ? 'restricted' : 'all',
			allowedServiceIds: identifiers,
			weekdays: normalizeScheduleWeekdays(item.weekdays),
			timeRanges,
			slotInterval,
			gridInterval
		});
	}
	return result;
};

export const scheduleBlocksFromRules = (
	rules: RuleLike[],
	idPrefix = 'block'
): ScheduleBlockDraft[] => {
	if (rules.length === 0) return [createDefaultScheduleBlock(`${idPrefix}-1`)];

	const groups = new Map<string, ScheduleBlockDraft>();
	for (const rule of [...rules].sort(
		(a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)
	)) {
		const range = { start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) };
		const allowed =
			rule.allowed_service_ids ?? rule.rule_services?.map((row) => row.service_id) ?? [];
		const scope = rule.service_scope ?? 'all';
		const pause = Math.max(0, Number(rule.break_minutes ?? rule.slot_interval_minutes ?? 15));
		const key = JSON.stringify([
			range,
			rule.slot_interval_minutes,
			pause,
			scope,
			[...allowed].sort()
		]);
		const existing = groups.get(key);
		if (existing) {
			existing.weekdays = [...new Set([...existing.weekdays, rule.weekday])].sort((a, b) => a - b);
			continue;
		}
		groups.set(key, {
			id: `${idPrefix}-${groups.size + 1}`,
			weekdays: [rule.weekday],
			timeRanges: formatTimeRanges([range]),
			slotInterval: String(pause),
			gridInterval: String(rule.slot_interval_minutes),
			...(scope === 'restricted' ? { serviceScope: 'restricted', allowedServiceIds: allowed } : {})
		});
	}

	return [...groups.values()];
};
