import {
	parseScheduleBlocksJson,
	validateScheduleBlocks,
	type NormalizedScheduleBlock,
	type ScheduleBlockDraft
} from '$lib/utils/schedule-blocks';

export const boolFromForm = (form: FormData, key: string) => form.get(key) === 'true';
export const MIN_SERVICE_DURATION_MINUTES = 5;
export const MAX_SERVICE_DURATION_MINUTES = 480;

export const parsePositiveInt = (value: FormDataEntryValue | null, fallback = 0) => {
	const parsed = Number(value ?? fallback);
	return Number.isInteger(parsed) ? parsed : fallback;
};

export const scheduleBlocksFromForm = (
	form: FormData
):
	{ ok: true; blocks: NormalizedScheduleBlock[] } | { ok: false; status: 400; message: string } => {
	const rawBlocks = String(form.get('schedule_blocks') ?? '').trim();
	let draftBlocks: ScheduleBlockDraft[] | null = rawBlocks
		? parseScheduleBlocksJson(rawBlocks)
		: null;
	if (rawBlocks && !draftBlocks) {
		return { ok: false, status: 400, message: 'Los bloques horarios no son válidos.' };
	}
	if (!draftBlocks) {
		draftBlocks = [
			{
				weekdays: form
					.getAll('weekdays')
					.map((value) => Number(value))
					.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
				timeRanges: String(form.get('time_ranges') ?? ''),
				slotInterval: String(form.get('break_minutes') ?? 15),
				gridInterval: String(form.get('slot_interval_minutes') ?? 15)
			}
		];
	}

	const result = validateScheduleBlocks(draftBlocks);
	if (!result.ok) return { ok: false, status: 400, message: result.message };
	return { ok: true, blocks: result.blocks };
};

/** Single mapping from normalized schedule blocks to the existing SQL contract. */
export const professionalSchedulePayload = (blocks: NormalizedScheduleBlock[]) =>
	blocks.map((block) => ({
		weekdays: block.weekdays,
		ranges: block.ranges,
		slot_interval_minutes: block.slotIntervalMinutes,
		break_minutes: block.breakMinutes,
		service_scope: block.serviceScope ?? 'all',
		service_ids: block.allowedServiceIds ?? []
	}));

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
