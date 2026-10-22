import { isUuid } from '@cita-suite/shared/uuid';
import {
	canonicalScheduleBlocks,
	serializeScheduleBlocks,
	validateScheduleBlocks,
	type ScheduleBlockDraft
} from '$lib/utils/schedule-blocks';
import { isRecord } from '$lib/contracts/json';

/** A local editing draft, never an authorization or availability authority. */

export type ProfessionalDraft = {
	name: string;
	specialty: string;
	phone: string;
	email: string;
	isAvailable: boolean;
	serviceIds: string[];
	schedule: {
		blocks: ScheduleBlockDraft[];
	};
	exception: {
		appliesTo: 'professional' | 'business';
		type: 'blocked' | 'extra_available' | 'restricted';
		periodMode: 'single' | 'range' | 'multiple';
		allowedServiceIds: string[];
		requestId: string;
		dates: string[];
		date: string;
		dateFrom: string;
		dateTo: string;
		timeRange: string;
		reason: string;
	};
};

/** Copy every mutable collection; editing a draft must not change its baseline. */
export function cloneProfessionalDraft(value: ProfessionalDraft): ProfessionalDraft {
	return {
		...value,
		serviceIds: [...value.serviceIds],
		schedule: {
			blocks: value.schedule.blocks.map((block) => ({
				...block,
				weekdays: [...block.weekdays],
				...(block.allowedServiceIds ? { allowedServiceIds: [...block.allowedServiceIds] } : {})
			}))
		},
		exception: {
			...value.exception,
			dates: [...value.exception.dates],
			allowedServiceIds: [...value.exception.allowedServiceIds]
		}
	};
}

const strings = (value: unknown): string[] => {
	const items: unknown[] = Array.isArray(value) ? value : [];
	return items.filter((item): item is string => typeof item === 'string');
};
const weekdays = (value: unknown): number[] => {
	const items: unknown[] = Array.isArray(value) ? value : [];
	return items
		.filter((item): item is string | number => typeof item === 'number' || typeof item === 'string')
		.map(Number)
		.filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
};
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
function schedule(value: unknown, fallback: ProfessionalDraft): ProfessionalDraft['schedule'] {
	if (!isRecord(value)) return cloneProfessionalDraft(fallback).schedule;
	if (Array.isArray(value.blocks)) {
		const items: unknown[] = value.blocks;
		const blocks: ScheduleBlockDraft[] = items.map((item, index) => {
			const block = isRecord(item) ? item : {};
			return {
				serviceScope: block.serviceScope === 'restricted' ? 'restricted' : 'all',
				allowedServiceIds: strings(block.allowedServiceIds),
				id: text(block.id, `restored-block-${index + 1}`),
				weekdays: weekdays(block.weekdays),
				timeRanges: text(block.timeRanges),
				slotInterval: text(block.slotInterval, '15'),
				gridInterval: text(block.gridInterval, '15')
			};
		});
		return { blocks: blocks.length ? blocks : cloneProfessionalDraft(fallback).schedule.blocks };
	}
	// Preserve the historical one-block representation without an `any` cast.
	if (Array.isArray(value.weekdays))
		return {
			blocks: [
				{
					id: 'restored-block-1',
					weekdays: weekdays(value.weekdays),
					timeRanges: text(value.timeRanges),
					slotInterval: text(value.breakMinutes, '15'),
					gridInterval: text(value.slotInterval, '15')
				}
			]
		};
	return cloneProfessionalDraft(fallback).schedule;
}

/** Local Storage is JSON of unknown shape, including older draft versions. */
export function sanitizeProfessionalDraft(
	value: unknown,
	fallback: ProfessionalDraft
): ProfessionalDraft {
	const row = isRecord(value) ? value : {};
	const exception = isRecord(row.exception) ? row.exception : {};
	return {
		name: text(row.name, fallback.name),
		specialty: text(row.specialty, fallback.specialty),
		phone: text(row.phone, fallback.phone),
		email: text(row.email, fallback.email),
		isAvailable: typeof row.isAvailable === 'boolean' ? row.isAvailable : fallback.isAvailable,
		serviceIds: Array.isArray(row.serviceIds) ? strings(row.serviceIds) : [...fallback.serviceIds],
		schedule: schedule(row.schedule, fallback),
		exception: {
			appliesTo: exception.appliesTo === 'business' ? 'business' : 'professional',
			type:
				exception.type === 'extra_available'
					? 'extra_available'
					: exception.type === 'restricted'
						? 'restricted'
						: 'blocked',
			periodMode:
				exception.periodMode === 'range'
					? 'range'
					: exception.periodMode === 'multiple'
						? 'multiple'
						: 'single',
			dates: strings(exception.dates),
			allowedServiceIds: strings(exception.allowedServiceIds),
			requestId: isUuid(exception.requestId) ? exception.requestId : crypto.randomUUID(),
			date: text(exception.date, fallback.exception.date),
			dateFrom: text(exception.dateFrom, fallback.exception.dateFrom),
			dateTo: text(exception.dateTo, fallback.exception.dateTo),
			timeRange: text(exception.timeRange, fallback.exception.timeRange),
			reason: text(exception.reason, fallback.exception.reason)
		}
	};
}

export type ProfessionalEditorService = {
	id: string;
	name: string;
	description: string | null;
	duration_minutes: number;
	buffer_before_minutes: number;
	buffer_after_minutes: number;
	price_label: string | null;
	updated_at: string;
	patient_instructions: string | null;
	public_reminder_description: string | null;
	is_active: boolean;
	is_public: boolean;
	sort_order: number;
};

export type ProfessionalEditorSaving =
	| 'profile'
	| 'services'
	| 'schedule'
	| 'exception'
	| 'all'
	| 'service-create'
	| 'service-update'
	| null;

export function emptyProfessionalException(): ProfessionalDraft['exception'] {
	return {
		appliesTo: 'professional',
		type: 'blocked',
		periodMode: 'single',
		dates: [],
		allowedServiceIds: [],
		requestId: crypto.randomUUID(),
		date: '',
		dateFrom: '',
		dateTo: '',
		timeRange: '',
		reason: ''
	};
}

/** A successful response acknowledges submitted fields, never edits made while waiting. */
export function acceptProfessionalDraftSave(
	current: ProfessionalDraft,
	baseline: ProfessionalDraft,
	submitted: ProfessionalDraft,
	section: 'profile' | 'services' | 'schedule' | 'exception' | 'all'
) {
	const saved =
		section === 'all' ? cloneProfessionalDraft(submitted) : cloneProfessionalDraft(baseline);
	const next = cloneProfessionalDraft(current);
	if (section === 'profile') {
		saved.name = submitted.name;
		saved.specialty = submitted.specialty;
		saved.phone = submitted.phone;
		saved.email = submitted.email;
		saved.isAvailable = submitted.isAvailable;
	}
	if (section === 'services') saved.serviceIds = [...submitted.serviceIds];
	if (section === 'schedule') saved.schedule = cloneProfessionalDraft(submitted).schedule;
	if (section === 'all' || section === 'exception') {
		if (JSON.stringify(current.exception) === JSON.stringify(submitted.exception))
			next.exception = emptyProfessionalException();
		saved.exception = emptyProfessionalException();
	}
	return { baseline: saved, draft: next };
}

export type ProfessionalEditorRule = {
	service_scope?: 'all' | 'restricted';
	rule_services?: Array<{ service_id: string }>;
	id: string;
	weekday: number;
	start_time: string;
	end_time: string;
	slot_interval_minutes: number;
	break_minutes: number;
	is_active: boolean;
	created_at: string | null;
};
export type ProfessionalEditorException = {
	exception_services?: Array<{ service_id: string }>;
	id: string;
	professional_id: string | null;
	starts_at: string;
	ends_at: string;
	type: 'blocked' | 'extra_available' | 'restricted';
	reason: string | null;
};
export type ProfessionalDirtyFields = {
	name: boolean;
	specialty: boolean;
	phone: boolean;
	email: boolean;
	profilePublic: boolean;
	services: boolean;
	schedule: boolean;
	exception: boolean;
};
export type ProfessionalEditorData = {
	context: {
		business: { id: string; timezone: string };
		canOperate: boolean;
		canManage: boolean;
	};
	professional: {
		id: string;
		name: string;
		specialty: string | null;
		phone: string | null;
		email: string | null;
		is_active: boolean;
		is_public: boolean;
	} | null;
	services: ProfessionalEditorService[];
	currentPriceLabels?: Record<string, string>;
	availabilityRevision?: number;
	exceptionRequestId?: string;
	assignedServiceIds: string[];
	defaultServiceIds: string[];
	rules: ProfessionalEditorRule[];
	exceptions: ProfessionalEditorException[];
	appointmentCount?: number | null;
	clinicalEntryCount?: number | null;
	followUpCount?: number | null;
	dependencyCountsDeferred?: boolean;
	tab: string;
	userId: string | null;
	pendingAccountEmail: string | null;
	demo: boolean;
};

export type ProfessionalDependencyCounts = {
	appointment_count: number;
	clinical_entry_count: number;
	follow_up_count: number;
};
/** Malformed or missing counts never authorize the destructive confirmation. */
export function parseProfessionalDependencyCounts(
	value: unknown
): ProfessionalDependencyCounts | null {
	if (!isRecord(value)) return null;
	const { appointment_count, clinical_entry_count, follow_up_count } = value;
	const count = (item: unknown): item is number =>
		typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
	return count(appointment_count) && count(clinical_entry_count) && count(follow_up_count)
		? { appointment_count, clinical_entry_count, follow_up_count }
		: null;
}

export const hasProfessionalExceptionDraft = (exception: ProfessionalDraft['exception']) =>
	exception.periodMode === 'multiple'
		? Boolean(exception.dates?.length || exception.date.trim() || exception.reason.trim())
		: exception.periodMode === 'range'
			? Boolean(exception.dateFrom.trim() || exception.dateTo.trim() || exception.reason.trim())
			: Boolean(exception.date.trim() || exception.timeRange.trim() || exception.reason.trim());

export function professionalRuleScope(value: unknown): 'all' | 'restricted' {
	if (value === 'all' || value === 'restricted') return value;
	throw new Error('Invalid professional rule scope');
}
export function professionalExceptionType(
	value: unknown
): 'blocked' | 'extra_available' | 'restricted' {
	if (value === 'blocked' || value === 'extra_available' || value === 'restricted') return value;
	throw new Error('Invalid professional exception type');
}

/** A refreshed revision can anchor a dirty draft only when its persisted base
 * still matches. New exception inputs append commands, never replace that base. */
export function professionalBaselineMatches(
	server: ProfessionalDraft,
	baseline: ProfessionalDraft
): boolean {
	for (const field of ['name', 'specialty', 'phone', 'email'] as const)
		if (server[field].trim() !== baseline[field].trim()) return false;
	if (
		server.isAvailable !== baseline.isAvailable ||
		JSON.stringify([...server.serviceIds].sort()) !==
			JSON.stringify([...baseline.serviceIds].sort())
	)
		return false;
	const a = validateScheduleBlocks(server.schedule.blocks),
		b = validateScheduleBlocks(baseline.schedule.blocks);
	return a.ok && b.ok
		? canonicalScheduleBlocks(server.schedule.blocks) === canonicalScheduleBlocks(baseline.schedule.blocks)
		: serializeScheduleBlocks(server.schedule.blocks) ===
				serializeScheduleBlocks(baseline.schedule.blocks);
}
