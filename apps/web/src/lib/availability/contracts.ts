import { InvalidDataContractError, readArray, readBoolean, readFiniteNumber, readRecord, readText } from '$lib/contracts/json';
import { parseIntegratedAvailabilityRows, type IntegratedAvailabilityRows } from './rows';
import { isAvailabilityDate, AVAILABILITY_GROUP_SIZE, AVAILABILITY_WINDOW_DAYS } from './windows';
import type { AvailabilityBusiness } from './calculate';

export type AvailabilityScope = 'public' | 'internal';
export type AvailabilityCatalog = Pick<IntegratedAvailabilityRows, 'services' | 'professionals' | 'assignments' | 'rules'> & {
	schema_version: 2;
	business_id: string;
	scope: AvailabilityScope;
	configuration_revision: number;
	generated_at: string;
	business: AvailabilityBusiness & { min_booking_notice_minutes: number };
};
export type AvailabilityWindow = Pick<IntegratedAvailabilityRows, 'exceptions' | 'blocks'> & {
	schema_version: 2;
	complete: true;
	business_id: string;
	scope: AvailabilityScope;
	configuration_revision: number;
	generated_at: string;
	from_date: string;
	to_date: string;
	professional_ids: string[];
};

function invalid(field: string): never { throw new InvalidDataContractError('availability.' + field); }
const uuid = (value: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const integer = (value: unknown, minimum: number, field: string) => {
	const number = readFiniteNumber(value, 'availability.' + field);
	if (!Number.isSafeInteger(number) || number < minimum) invalid(field);
	return number;
};
const timestamp = (value: unknown, field: string) => {
	const text = readText(value, 'availability.' + field);
	if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !isAvailabilityDate(text.slice(0, 10)) || !Number.isFinite(Date.parse(text))) invalid(field);
	return text;
};
const identifiers = (values: string[], field: string) => {
	if (values.some(value => !uuid(value)) || new Set(values.map(value => value.toLowerCase())).size !== values.length) invalid(field);
	return values;
};
function envelope(value: unknown, expected: { businessId: string; scope: AvailabilityScope }) {
	const root = readRecord(value, 'availability');
	if (root.schema_version !== 2 || root.business_id !== expected.businessId || root.scope !== expected.scope) invalid('scope');
	return { root, business_id: expected.businessId, scope: expected.scope,
		configuration_revision: integer(root.configuration_revision, 1, 'revision'),
		generated_at: timestamp(root.generated_at, 'generatedAt') };
}

export function parseAvailabilityBusiness(value: unknown) {
	const rawBusiness = readRecord(value, 'availability.business');
	const timezone = readText(rawBusiness.timezone, 'availability.timezone');
	try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { invalid('timezone'); }
	return {
		timezone,
		max_booking_days_ahead: integer(rawBusiness.max_booking_days_ahead, 1, 'horizon'),
		min_booking_notice_minutes: integer(rawBusiness.min_booking_notice_minutes, 0, 'notice'),
		is_active: readBoolean(rawBusiness.is_active, 'availability.isActive'),
		public_booking_enabled: readBoolean(rawBusiness.public_booking_enabled, 'availability.publicEnabled')
	};
}

export function parseAvailabilityCatalog(value: unknown, expected: { businessId: string; scope: AvailabilityScope }): AvailabilityCatalog {
	const { root, ...metadata } = envelope(value, expected);
	const business = parseAvailabilityBusiness(root.business);
	const rows = parseIntegratedAvailabilityRows({ ...root, exceptions: [], blocks: [] });
	validateAvailabilityConfiguration(rows, expected);
	return { schema_version: 2, ...metadata, business, services: rows.services,
		professionals: rows.professionals, assignments: rows.assignments, rules: rows.rules };
}

export function validateAvailabilityConfiguration(rows: Pick<IntegratedAvailabilityRows, 'services' | 'professionals' | 'assignments' | 'rules'>, expected: { businessId: string; scope: AvailabilityScope }): void {
	identifiers(rows.services.map(row => row.id), 'services');
	identifiers(rows.professionals.map(row => row.id), 'professionals');
	identifiers(rows.rules.map(row => row.id), 'rules');
	const services = new Set(rows.services.map(row => row.id));
	const professionals = new Set(rows.professionals.map(row => row.id));
	for (const service of rows.services) {
		if (service.business_id !== expected.businessId || !service.is_active ||
			(expected.scope === 'public' && !service.is_public)) invalid('service.scope');
		integer(service.duration_minutes, 1, 'service.duration');
		integer(service.buffer_before_minutes, 0, 'service.bufferBefore');
		integer(service.buffer_after_minutes, 0, 'service.bufferAfter');
	}
	for (const professional of rows.professionals) {
		if (!professional.is_active || (expected.scope === 'public' && (!professional.is_public || !professional.name.trim()))) invalid('professional.scope');
	}
	const assignments = new Set<string>();
	for (const row of rows.assignments) {
		const key = row.service_id + ':' + row.professional_id;
		if (!services.has(row.service_id) || !professionals.has(row.professional_id) || assignments.has(key)) invalid('assignment.scope');
		assignments.add(key);
	}
	for (const rule of rows.rules) {
		if (!professionals.has(rule.professional_id) || !rule.is_active || rule.weekday > 6 ||
			(rule.service_scope !== 'all' && rule.service_scope !== 'restricted') || !rule.allowed_service_ids) invalid('rule.scope');
		integer(rule.weekday, 0, 'rule.weekday');
		integer(rule.slot_interval_minutes, 1, 'rule.interval');
		integer(rule.break_minutes, 0, 'rule.break');
		identifiers(rule.allowed_service_ids, 'rule.services');
		const time = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$|^24:00(?::00(?:\.0{1,6})?)?$/;
		if (!time.test(rule.start_time) || !time.test(rule.end_time) || rule.start_time >= rule.end_time) invalid('rule.time');
	}
}

export function parseAvailabilityWindow(value: unknown, expected: {
	businessId: string; scope: AvailabilityScope; configurationRevision: number;
	fromDate: string; toDate: string; professionalIds: readonly string[];
}): AvailabilityWindow {
	const { root, ...metadata } = envelope(value, expected);
	if (root.complete !== true || metadata.configuration_revision !== expected.configurationRevision ||
		root.from_date !== expected.fromDate || root.to_date !== expected.toDate ||
		!isAvailabilityDate(expected.fromDate) || !isAvailabilityDate(expected.toDate) ||
		expected.fromDate > expected.toDate ||
		(Date.parse(expected.toDate) - Date.parse(expected.fromDate)) / 86_400_000 >= AVAILABILITY_WINDOW_DAYS) invalid('window.range');
	const professionalIds = identifiers(readArray(root.professional_ids, 'availability.professionalIds')
		.map(id => readText(id, 'availability.professionalId')), 'professionalIds');
	if (!professionalIds.length || professionalIds.length > AVAILABILITY_GROUP_SIZE ||
		[...professionalIds].sort().join(',') !== [...expected.professionalIds].sort().join(',')) invalid('window.professionals');
	const rows = parseIntegratedAvailabilityRows({ services: [], professionals: [], assignments: [], rules: [],
		exceptions: root.exceptions, blocks: root.blocks });
	const counts = readRecord(root.counts, 'availability.counts');
	if (integer(counts.blocks, 0, 'counts.blocks') !== rows.blocks.length ||
		integer(counts.exceptions, 0, 'counts.exceptions') !== rows.exceptions.length) invalid('window.incomplete');
	validateAvailabilityOccupancy(rows, professionalIds);
	return { schema_version: 2, complete: true, ...metadata, from_date: expected.fromDate, to_date: expected.toDate,
		professional_ids: professionalIds, exceptions: rows.exceptions, blocks: rows.blocks };
}

export function validateAvailabilityOccupancy(rows: Pick<IntegratedAvailabilityRows, 'blocks' | 'exceptions'>, professionalIds: readonly string[]): void {
	identifiers(rows.blocks.map(row => row.id), 'blocks');
	identifiers(rows.exceptions.map(row => row.id), 'exceptions');
	const professionals = new Set(professionalIds);
	for (const row of rows.exceptions) {
		if (row.professional_id !== null && !professionals.has(row.professional_id)) invalid('exception.scope');
		timestamp(row.starts_at, 'exception.start'); timestamp(row.ends_at, 'exception.end');
		if (Date.parse(row.starts_at) >= Date.parse(row.ends_at) || !row.allowed_service_ids) invalid('exception.interval');
		identifiers(row.allowed_service_ids, 'exception.services');
	}
	for (const row of rows.blocks) {
		if (!professionals.has(row.professional_id) || !row.appointment_id || !uuid(row.appointment_id)) invalid('block.scope');
		const start = Date.parse(timestamp(row.starts_at, 'block.start'));
		const end = Date.parse(timestamp(row.ends_at, 'block.end'));
		const baseStart = Date.parse(timestamp(row.base_blocking_starts_at, 'block.baseStart'));
		const baseEnd = Date.parse(timestamp(row.base_blocking_ends_at, 'block.baseEnd'));
		const blockingStart = Date.parse(timestamp(row.blocking_starts_at, 'block.blockingStart'));
		const blockingEnd = Date.parse(timestamp(row.blocking_ends_at, 'block.blockingEnd'));
		if (!(blockingStart <= baseStart && baseStart <= start && start < end && end <= baseEnd && baseEnd <= blockingEnd)) invalid('block.interval');
	}
}
