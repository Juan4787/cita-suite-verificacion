import type { AvailabilityServiceRow, AvailabilityProfessionalRow, AvailabilityRuleRow, AvailabilityExceptionRow, AvailabilityAppointmentBlockRow } from './calculate';
import { InvalidDataContractError, readArray, readBoolean, readFiniteNumber, readNullableText, readRecord, readText } from '$lib/contracts/json';

export type IntegratedAvailabilityRows = {
	services: Array<AvailabilityServiceRow & { description: string | null; price_label: string | null; sort_order: number }>;
	professionals: Array<AvailabilityProfessionalRow & { specialty: string | null; avatar_url: string | null; sort_order: number }>;
	assignments: Array<{ service_id: string; professional_id: string }>;
	rules: AvailabilityRuleRow[];
	exceptions: AvailabilityExceptionRow[];
	blocks: AvailabilityAppointmentBlockRow[];
};

export function parseIntegratedAvailabilityRows(value: unknown): IntegratedAvailabilityRows {
	const root = readRecord(value, 'availability');
	const optionalText = (value: unknown, field: string) => value == null ? undefined : readText(value, field);
	const ids = (value: unknown, field: string) => value === undefined ? undefined : readArray(value, field).map(item => readText(item, field));
	const links = (value: unknown, field: string) => value === undefined ? undefined : readArray(value, field).map(item => ({ service_id: readText(readRecord(item, field).service_id, field) }));
	return {
		services: readArray(root.services, 'availability.services').map(value => {
			const row = readRecord(value, 'availability.service');
			return { id: readText(row.id, 'service.id'), business_id: readText(row.business_id, 'service.business_id'),
				name: readText(row.name, 'service.name'), duration_minutes: readFiniteNumber(row.duration_minutes, 'service.duration'),
				buffer_before_minutes: readFiniteNumber(row.buffer_before_minutes, 'service.buffer_before'), buffer_after_minutes: readFiniteNumber(row.buffer_after_minutes, 'service.buffer_after'),
				is_public: readBoolean(row.is_public, 'service.is_public'), is_active: readBoolean(row.is_active, 'service.is_active'),
				description: readNullableText(row.description, 'service.description'), price_label: readNullableText(row.price_label, 'service.price_label'), sort_order: readFiniteNumber(row.sort_order, 'service.sort_order') };
		}),
		professionals: readArray(root.professionals, 'availability.professionals').map(value => {
			const row = readRecord(value, 'availability.professional');
			return { id: readText(row.id, 'professional.id'), name: readText(row.name, 'professional.name'),
				is_public: readBoolean(row.is_public, 'professional.is_public'), is_active: readBoolean(row.is_active, 'professional.is_active'),
				specialty: readNullableText(row.specialty, 'professional.specialty'), avatar_url: readNullableText(row.avatar_url, 'professional.avatar_url'), sort_order: readFiniteNumber(row.sort_order, 'professional.sort_order') };
		}),
		assignments: readArray(root.assignments, 'availability.assignments').map(value => {
			const row = readRecord(value, 'availability.assignment');
			return { service_id: readText(row.service_id, 'assignment.service_id'), professional_id: readText(row.professional_id, 'assignment.professional_id') };
		}),
		rules: readArray(root.rules, 'availability.rules').map(value => {
			const row = readRecord(value, 'availability.rule');
			const scope = row.service_scope;
			if (scope !== undefined && scope !== 'all' && scope !== 'restricted') throw new InvalidDataContractError('rule.service_scope');
			return { id: readText(row.id, 'rule.id'), professional_id: readText(row.professional_id, 'rule.professional_id'),
				weekday: readFiniteNumber(row.weekday, 'rule.weekday'), start_time: readText(row.start_time, 'rule.start_time'), end_time: readText(row.end_time, 'rule.end_time'),
				slot_interval_minutes: readFiniteNumber(row.slot_interval_minutes, 'rule.slot_interval_minutes'), is_active: readBoolean(row.is_active, 'rule.is_active'),
				break_minutes: row.break_minutes == null ? undefined : readFiniteNumber(row.break_minutes, 'rule.break_minutes'),
				service_scope: scope, allowed_service_ids: ids(row.allowed_service_ids, 'rule.allowed_services'), rule_services: links(row.rule_services, 'rule.services') };
		}),
		exceptions: readArray(root.exceptions, 'availability.exceptions').map(value => {
			const row = readRecord(value, 'availability.exception');
			const type = row.type;
			if (type !== 'blocked' && type !== 'extra_available' && type !== 'restricted') throw new InvalidDataContractError('exception.type');
			return { id: readText(row.id, 'exception.id'), professional_id: readNullableText(row.professional_id, 'exception.professional_id'),
				starts_at: readText(row.starts_at, 'exception.starts_at'), ends_at: readText(row.ends_at, 'exception.ends_at'), type,
				allowed_service_ids: ids(row.allowed_service_ids, 'exception.allowed_services'), exception_services: links(row.exception_services, 'exception.services') };
		}),
		blocks: readArray(root.blocks, 'availability.blocks').map(value => {
			const row = readRecord(value, 'availability.block');
			return { id: readText(row.id, 'block.id'), professional_id: readText(row.professional_id, 'block.professional_id'),
				blocking_starts_at: readText(row.blocking_starts_at, 'block.blocking_starts_at'), blocking_ends_at: readText(row.blocking_ends_at, 'block.blocking_ends_at'),
				appointment_id: optionalText(row.appointment_id, 'block.appointment_id'), starts_at: optionalText(row.starts_at, 'block.starts_at'), ends_at: optionalText(row.ends_at, 'block.ends_at'),
				base_blocking_starts_at: optionalText(row.base_blocking_starts_at, 'block.base_blocking_starts_at'), base_blocking_ends_at: optionalText(row.base_blocking_ends_at, 'block.base_blocking_ends_at') };
		})
	};
}

