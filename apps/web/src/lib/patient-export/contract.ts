export const PATIENT_EXPORT_SCHEMA_VERSION = 'cita-suite-patient-export/v1' as const;

// El protocolo servidor sigue en v1 porque los datasets no cambian. El formato
// visible del Excel tiene su propia version: v2 elimina identificadores internos
// y resuelve las relaciones a nombres y datos reconocibles por el consultorio.
export const PATIENT_EXPORT_WORKBOOK_VERSION = 'cita-suite-patient-export/v2' as const;

export const PATIENT_EXPORT_DATASETS = [
	'patients',
	'custom_fields',
	'clinical_entries',
	'appointments',
	'appointment_professionals',
	'follow_ups'
] as const;

export type PatientExportDataset = (typeof PATIENT_EXPORT_DATASETS)[number];
export type PatientExportScope = 'patient' | 'all_patients';
export type PatientExportAppointmentSource =
	| 'manual'
	| 'public_booking'
	| 'whatsapp_bot'
	| 'admin';

export type PatientExportCounts = Record<PatientExportDataset, number>;

export type PatientExportSession = {
	reused: boolean;
	export_id: string;
	scope: PatientExportScope;
	patient_id: string | null;
	schema_version: typeof PATIENT_EXPORT_SCHEMA_VERSION;
	expected_counts: PatientExportCounts;
	datasets: PatientExportDataset[];
	business: {
		name: string;
		timezone: string;
	};
	expires_at: string;
};

export type PatientExportPatientRow = {
	patient_id: string;
	full_name: string;
	dni: string | null;
	phone: string | null;
	email: string | null;
	birth_date: string | null;
	address: string | null;
	insurance: string | null;
	insurance_plan: string | null;
	allergies: string | null;
	medication: string | null;
	background: string | null;
	clinical_alert_note: string | null;
	clinical_notes: string | null;
	status: 'active' | 'archived';
	archived_at: string | null;
	created_at: string;
	updated_at: string;
};

export type PatientExportCustomFieldRow = {
	patient_id: string;
	field_key: string;
	field_label: string;
	value_type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
	value_text: string | null;
	value_json: string | null;
};

export type PatientExportClinicalEntryRow = {
	clinical_entry_id: string;
	patient_id: string;
	occurred_at: string;
	entry_type: string;
	description: string;
	teeth: string | null;
	internal_note: string | null;
	amount: number | string | null;
	professional_id: string | null;
	professional_name: string | null;
	status: 'active' | 'archived';
	archived_at: string | null;
	created_at: string;
	updated_at: string;
};

export type PatientExportAppointmentRow = {
	appointment_id: string;
	patient_id: string;
	starts_at: string;
	ends_at: string;
	status: 'reserved' | 'confirmed' | 'cancelled' | 'reschedule_requested';
	source: PatientExportAppointmentSource;
	service_name_snapshot: string;
	internal_note: string | null;
	professional_name_snapshot: string;
	confirmed_at: string | null;
	cancelled_at: string | null;
	reschedule_requested_at: string | null;
	cancelled_reason: string | null;
	created_at: string;
	updated_at: string;
};

export type PatientExportAppointmentProfessionalRow = {
	allocation_id: string;
	appointment_id: string;
	patient_id: string;
	professional_id: string;
	professional_name: string;
	is_primary: boolean;
	position: number;
};

export type PatientExportFollowUpRow = {
	follow_up_id: string;
	patient_id: string;
	remind_on: string;
	message: string | null;
	status: 'pending' | 'done';
	assigned_professional_id: string | null;
	assigned_professional_name: string | null;
	done_at: string | null;
	created_at: string;
	updated_at: string;
};

export type PatientExportRowsByDataset = {
	patients: PatientExportPatientRow;
	custom_fields: PatientExportCustomFieldRow;
	clinical_entries: PatientExportClinicalEntryRow;
	appointments: PatientExportAppointmentRow;
	appointment_professionals: PatientExportAppointmentProfessionalRow;
	follow_ups: PatientExportFollowUpRow;
};

export type PatientExportDatasetRows = {
	[Dataset in PatientExportDataset]: PatientExportRowsByDataset[Dataset][];
};

export type PatientExportPage<Dataset extends PatientExportDataset = PatientExportDataset> = {
	export_id: string;
	dataset: Dataset;
	rows: PatientExportRowsByDataset[Dataset][];
	row_count: number;
	next_cursor: string | null;
	done: boolean;
	expires_at: string;
};

export const emptyPatientExportCounts = (): PatientExportCounts => ({
	patients: 0,
	custom_fields: 0,
	clinical_entries: 0,
	appointments: 0,
	appointment_professionals: 0,
	follow_ups: 0
});

export const isPatientExportDataset = (value: string): value is PatientExportDataset =>
	(PATIENT_EXPORT_DATASETS as readonly string[]).includes(value);
