import type { SupabaseClient } from '@supabase/supabase-js';
import { addMinutes, zonedDateTimeToUtc } from '$lib/availability/calculate';
import type {
	AvailabilitySnapshot,
	AvailabilitySnapshotAssignment,
	AvailabilitySnapshotProfessional,
	AvailabilitySnapshotService
} from '$lib/availability/snapshot';
import type { Business } from './business';

const SNAPSHOT_TTL_MS = 20_000;
const SNAPSHOT_MAX_DAYS = 31;
const BLOCKING_STATUSES = ['reserved', 'confirmed', 'reschedule_requested'] as const;

type SnapshotRpcPayload = {
	generated_at?: string;
	services?: unknown[];
	professionals?: unknown[];
	assignments?: unknown[];
	rules?: unknown[];
	exceptions?: unknown[];
	blocks?: unknown[];
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (value: string) => {
	if (!isoDatePattern.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const nextDate = (date: string) => {
	const value = new Date(`${date}T00:00:00.000Z`);
	return addMinutes(value, 24 * 60).toISOString().slice(0, 10);
};

const isMissingSnapshotRpcError = (error: unknown) => {
	if (!error || typeof error !== 'object') return false;
	const code = 'code' in error ? String(error.code ?? '') : '';
	const message = 'message' in error ? String(error.message ?? '').toLowerCase() : '';
	return (
		code === '42883' ||
		code === 'PGRST202' ||
		(message.includes('get_availability_snapshot') &&
			(message.includes('does not exist') || message.includes('schema cache'))
		)
	);
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const snapshotBusiness = (business: Business) => ({
	timezone: business.timezone,
	max_booking_days_ahead: business.max_booking_days_ahead,
	min_booking_notice_minutes: business.min_booking_notice_minutes,
	is_active: business.is_active,
	public_booking_enabled: business.public_booking_enabled
});

const dateForTimezone = (date: Date, timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

export const defaultInternalAvailabilitySnapshotRange = (
	business: Business,
	preferredFromDate?: string,
	now = new Date()
) => {
	const today = dateForTimezone(now, business.timezone);
	const fromDate =
		preferredFromDate && isValidIsoDate(preferredFromDate) && preferredFromDate >= today
			? preferredFromDate
			: today;
	const toDate = addMinutes(new Date(`${fromDate}T00:00:00.000Z`), 27 * 24 * 60)
		.toISOString()
		.slice(0, 10);
	return { fromDate, toDate };
};

const validateRange = (business: Business, fromDate: string, toDate: string) => {
	if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate) || fromDate > toDate) {
		throw new Error('Rango inválido para el snapshot de disponibilidad.');
	}
	const rangeStart = zonedDateTimeToUtc(fromDate, '00:00', business.timezone);
	const rangeEnd = zonedDateTimeToUtc(nextDate(toDate), '00:00', business.timezone);
	const days = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000));
	if (days < 1 || days > SNAPSHOT_MAX_DAYS) {
		throw new Error('El snapshot de disponibilidad supera el rango permitido.');
	}
	return { rangeStart, rangeEnd };
};

const loadSnapshotFallback = async (
	supabase: SupabaseClient,
	businessId: string,
	rangeStart: Date,
	rangeEnd: Date
): Promise<SnapshotRpcPayload> => {
	const [services, professionals, assignments, rules, exceptions, blocks] = await Promise.all([
		supabase
			.from('services')
			.select(
				'id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_public, is_active, sort_order'
			)
			.eq('business_id', businessId)
			.eq('is_active', true)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professionals')
			.select('id, name, specialty, is_public, is_active, sort_order')
			.eq('business_id', businessId)
			.eq('is_active', true)
			.order('sort_order')
			.order('name'),
		supabase
			.from('professional_services')
			.select('service_id, professional_id')
			.eq('business_id', businessId),
		supabase
			.from('availability_rules')
			.select(
				'id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, service_scope, rule_services:availability_rule_services(service_id)'
			)
			.eq('business_id', businessId)
			.eq('is_active', true),
		supabase
			.from('availability_exceptions')
			.select('id, professional_id, starts_at, ends_at, type, exception_services:availability_exception_services(service_id)')
			.eq('business_id', businessId)
			.lt('starts_at', rangeEnd.toISOString())
			.gt('ends_at', rangeStart.toISOString()),
		supabase
			.from('appointment_professionals')
			.select(
				'id, professional_id, base_blocking_starts_at, base_blocking_ends_at, blocking_starts_at, blocking_ends_at'
			)
			.eq('business_id', businessId)
			.in('status', [...BLOCKING_STATUSES])
			.lt('blocking_starts_at', rangeEnd.toISOString())
			.gt('blocking_ends_at', rangeStart.toISOString())
	]);

	const error =
		services.error ??
		professionals.error ??
		assignments.error ??
		rules.error ??
		exceptions.error ??
		blocks.error;
	if (error) throw error;

	return {
		generated_at: new Date().toISOString(),
		services: services.data ?? [],
		professionals: professionals.data ?? [],
		assignments: assignments.data ?? [],
		rules: rules.data ?? [],
		exceptions: exceptions.data ?? [],
		blocks: blocks.data ?? []
	};
};

export const loadInternalAvailabilitySnapshot = async (
	supabase: SupabaseClient,
	input: {
		business: Business;
		fromDate: string;
		toDate: string;
	}
): Promise<AvailabilitySnapshot> => {
	const { business, fromDate, toDate } = input;
	const { rangeStart, rangeEnd } = validateRange(business, fromDate, toDate);
	const rpcResult = await supabase.rpc('get_availability_snapshot', {
		p_business_id: business.id,
		p_from: rangeStart.toISOString(),
		p_to: rangeEnd.toISOString()
	});

	let payload: SnapshotRpcPayload;
	if (rpcResult.error) {
		if (!isMissingSnapshotRpcError(rpcResult.error)) throw rpcResult.error;
		payload = await loadSnapshotFallback(supabase, business.id, rangeStart, rangeEnd);
	} else if (rpcResult.data && typeof rpcResult.data === 'object') {
		payload = rpcResult.data as SnapshotRpcPayload;
	} else {
		throw new Error('El snapshot de disponibilidad no devolvió datos.');
	}

	const generatedAt = payload.generated_at
		? new Date(payload.generated_at).toISOString()
		: new Date().toISOString();
	return {
		schema_version: 1,
		generated_at: generatedAt,
		valid_until: new Date(new Date(generatedAt).getTime() + SNAPSHOT_TTL_MS).toISOString(),
		from_date: fromDate,
		to_date: toDate,
		business: snapshotBusiness(business),
		services: asArray<AvailabilitySnapshotService>(payload.services),
		professionals: asArray<AvailabilitySnapshotProfessional>(payload.professionals),
		assignments: asArray<AvailabilitySnapshotAssignment>(payload.assignments),
		rules: asArray(payload.rules),
		exceptions: asArray(payload.exceptions),
		blocks: asArray(payload.blocks)
	};
};
