import type {
	AvailabilityAppointmentBlockRow,
	AvailabilityBusiness,
	AvailabilityExceptionRow,
	AvailabilityProfessionalRow,
	AvailabilityRuleRow,
	AvailabilityServiceRow
} from './calculate';

export type AvailabilitySnapshotService = AvailabilityServiceRow & {
	sort_order: number;
};

export type AvailabilitySnapshotProfessional = AvailabilityProfessionalRow & {
	specialty: string | null;
	sort_order: number;
};

export type AvailabilitySnapshotAssignment = {
	service_id: string;
	professional_id: string;
};

export type AvailabilitySnapshot = {
	schema_version: 1;
	generated_at: string;
	valid_until: string;
	from_date: string;
	to_date: string;
	business: AvailabilityBusiness;
	services: AvailabilitySnapshotService[];
	professionals: AvailabilitySnapshotProfessional[];
	assignments: AvailabilitySnapshotAssignment[];
	rules: AvailabilityRuleRow[];
	exceptions: AvailabilityExceptionRow[];
	blocks: AvailabilityAppointmentBlockRow[];
};

export const snapshotContainsRange = (
	snapshot: AvailabilitySnapshot,
	fromDate: string,
	toDate: string
) => snapshot.from_date <= fromDate && snapshot.to_date >= toDate;
