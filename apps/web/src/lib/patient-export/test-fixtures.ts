import {
	PATIENT_EXPORT_DATASETS,
	PATIENT_EXPORT_SCHEMA_VERSION,
	type PatientExportDatasetRows,
	type PatientExportSession
} from './contract';
import type { PatientExportWorkbookInput } from './workbook';

export const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
export const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
export const APPOINTMENT_ID = '33333333-3333-4333-8333-333333333333';
export const PROFESSIONAL_ID = '44444444-4444-4444-8444-444444444444';
export const ALLOCATION_ID = '55555555-5555-4555-8555-555555555555';
export const FOLLOW_UP_ID = '66666666-6666-4666-8666-666666666666';

export const makePatientExportDatasets = (): PatientExportDatasetRows => ({
	patients: [
		{
			patient_id: PATIENT_ID,
			full_name: 'Zoë Núñez 😀',
			dni: '00123456',
			phone: '+54 11 4000-0000',
			email: 'zoe@example.test',
			birth_date: '1990-01-02',
			address: 'Calle 123',
			insurance: 'Cobertura',
			insurance_plan: 'Plan 001',
			allergies: 'Ninguna',
			medication: null,
			background: 'Antecedente',
			clinical_alert_note: '@alerta',
			clinical_notes: 'Línea uno\r\nLínea dos',
			status: 'active',
			archived_at: null,
			created_at: '2026-08-27T20:00:00.000Z',
			updated_at: '2026-08-27T21:00:00.000Z'
		}
	],
	custom_fields: [
		{
			patient_id: PATIENT_ID,
			field_key: 'texto',
			field_label: 'Texto',
			value_type: 'string',
			value_text: '=1+1',
			value_json: null
		},
		{
			patient_id: PATIENT_ID,
			field_key: 'numero',
			field_label: 'Número',
			value_type: 'number',
			value_text: '9007199254740993',
			value_json: null
		},
		{
			patient_id: PATIENT_ID,
			field_key: 'booleano',
			field_label: 'Booleano',
			value_type: 'boolean',
			value_text: 'true',
			value_json: null
		},
		{
			patient_id: PATIENT_ID,
			field_key: 'nulo',
			field_label: 'Nulo',
			value_type: 'null',
			value_text: null,
			value_json: null
		},
		{
			patient_id: PATIENT_ID,
			field_key: 'objeto',
			field_label: 'Objeto',
			value_type: 'object',
			value_text: null,
			value_json: '{"a":9007199254740993,"b":"001"}'
		},
		{
			patient_id: PATIENT_ID,
			field_key: 'lista',
			field_label: 'Lista',
			value_type: 'array',
			value_text: null,
			value_json: '[1,"001",false]'
		}
	],
	clinical_entries: [
		{
			clinical_entry_id: ENTRY_ID,
			patient_id: PATIENT_ID,
			occurred_at: '2026-08-27T20:15:00.000Z',
			entry_type: 'Consulta',
			description: '=SUM(1,1)',
			teeth: '11, 12',
			internal_note: '+no es fórmula',
			amount: '12345.67',
			professional_id: PROFESSIONAL_ID,
			professional_name: 'Dra. Álvarez',
			status: 'archived',
			archived_at: '2026-08-27T22:00:00.000Z',
			created_at: '2026-08-27T20:15:00.000Z',
			updated_at: '2026-08-27T22:00:00.000Z'
		}
	],
	appointments: [
		{
			appointment_id: APPOINTMENT_ID,
			patient_id: PATIENT_ID,
			starts_at: '2026-08-29T12:00:00.000Z',
			ends_at: '2026-08-29T12:30:00.000Z',
			status: 'reschedule_requested',
			source: 'public_booking',
			service_name_snapshot: 'Consulta inicial',
			internal_note: '-texto',
			professional_name_snapshot: 'Dra. Álvarez',
			confirmed_at: null,
			cancelled_at: null,
			reschedule_requested_at: '2026-08-28T10:00:00.000Z',
			cancelled_reason: null,
			created_at: '2026-08-20T12:00:00.000Z',
			updated_at: '2026-08-28T10:00:00.000Z'
		}
	],
	appointment_professionals: [
		{
			allocation_id: ALLOCATION_ID,
			appointment_id: APPOINTMENT_ID,
			patient_id: PATIENT_ID,
			professional_id: PROFESSIONAL_ID,
			professional_name: 'Dra. Álvarez',
			is_primary: true,
			position: 0
		}
	],
	follow_ups: [
		{
			follow_up_id: FOLLOW_UP_ID,
			patient_id: PATIENT_ID,
			remind_on: '2026-09-01',
			message: '@recordatorio',
			status: 'done',
			assigned_professional_id: PROFESSIONAL_ID,
			assigned_professional_name: 'Dra. Álvarez',
			done_at: '2026-09-01T15:00:00.000Z',
			created_at: '2026-08-27T18:00:00.000Z',
			updated_at: '2026-09-01T15:00:00.000Z'
		}
	]
});

export const sessionForDatasets = (
	datasets: PatientExportDatasetRows,
	scope: PatientExportSession['scope'] = 'all_patients'
): PatientExportSession => ({
	reused: false,
	export_id: '77777777-7777-4777-8777-777777777777',
	scope,
	patient_id: scope === 'patient' ? PATIENT_ID : null,
	schema_version: PATIENT_EXPORT_SCHEMA_VERSION,
	expected_counts: {
		patients: datasets.patients.length,
		custom_fields: datasets.custom_fields.length,
		clinical_entries: datasets.clinical_entries.length,
		appointments: datasets.appointments.length,
		appointment_professionals: datasets.appointment_professionals.length,
		follow_ups: datasets.follow_ups.length
	},
	datasets: [...PATIENT_EXPORT_DATASETS],
	business: {
		name: 'Consultorio Ñandú',
		timezone: 'America/Argentina/Buenos_Aires'
	},
	expires_at: '2026-08-28T23:00:00.000Z'
});

export const makePatientExportWorkbookInput = (): PatientExportWorkbookInput => {
	const datasets = makePatientExportDatasets();
	return {
		session: sessionForDatasets(datasets),
		datasets,
		generatedAtUtc: '2026-08-28T14:35:00.000Z'
	};
};
