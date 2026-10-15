import type { CaseEvent, CaseFile, ClinicalEntry, Patient, PatientRadiograph, Person } from '$lib/types';

export const demoPatients: Patient[] = [
	{
		id: 'p1',
		full_name: 'Juan Pérez',
		dni: '30123456',
		phone: '1122334455',
		email: 'juan@example.com',
		birth_date: '1985-03-12',
		address: 'Av. Siempre Viva 123',
		allergies: 'Penicilina',
		medication: 'Ibuprofeno ocasional',
		background: 'Hipertensión controlada',
		insurance: 'OSDE 310',
		custom_fields: null,
		archived_at: null,
		last_entry_at: '2025-02-10T10:00:00Z',
		created_at: '2024-12-01T12:00:00Z',
		updated_at: '2025-02-10T10:00:00Z'
	},
	{
		id: 'p2',
		full_name: 'María Gómez',
		dni: '28999111',
		phone: '1133445566',
		email: 'maria@example.com',
		birth_date: null,
		address: 'Calle Falsa 456',
		allergies: null,
		medication: null,
		background: null,
		insurance: 'Galeno',
		custom_fields: null,
		archived_at: null,
		last_entry_at: '2025-01-20T14:00:00Z',
		created_at: '2024-11-15T10:00:00Z',
		updated_at: '2025-01-20T14:00:00Z'
	}
];

export const demoClinicalEntries: ClinicalEntry[] = [
	{
		id: 'e1',
		patient_id: 'p1',
		entry_type: 'Consulta',
		description: 'Dolor en molar inferior derecho. Se indica Rx.',
		teeth: '46',
		amount: 0,
		internal_note: 'Paciente ansioso, explicar pasos',
		created_at: '2025-02-10T10:00:00Z'
	},
	{
		id: 'e2',
		patient_id: 'p1',
		entry_type: 'Tratamiento',
		description: 'Endodoncia en 46. Evoluciona bien.',
		teeth: '46',
		amount: 15000,
		internal_note: null,
		created_at: '2025-02-12T09:00:00Z'
	},
	{
		id: 'e3',
		patient_id: 'p2',
		entry_type: 'Diagnóstico',
		description: 'Caries superficial en 14. Se programa resina.',
		teeth: '14',
		amount: 0,
		internal_note: null,
		created_at: '2025-01-20T14:00:00Z'
	}
];

export const demoRadiographs: PatientRadiograph[] = [
	{
		id: 'r1',
		patient_id: 'p1',
		status: 'ready',
		storage_provider: 'supabase_storage',
		integrity_status: 'ok',
		original_filename: 'rx-panorama-2025-02-01.jpg',
		mime_type: 'image/jpeg',
		bytes: 2450000,
		taken_at: '2025-02-01',
		note: 'Panoramica inicial.',
		created_at: '2025-02-01T10:30:00Z'
	},
	{
		id: 'r2',
		patient_id: 'p1',
		status: 'ready',
		storage_provider: 'supabase_storage',
		integrity_status: 'ok',
		original_filename: 'rx-periapical-46-2025-02-12.png',
		mime_type: 'image/png',
		bytes: 980000,
		taken_at: '2025-02-12',
		note: 'Control post endodoncia.',
		created_at: '2025-02-12T09:15:00Z'
	}
];

export const demoPeople: Person[] = [
	{
		id: 'per1',
		full_name: 'Carlos López',
		dni: '27111222',
		phone: '1144556677',
		email: 'carlos@example.com',
		archived_at: null,
		created_at: '2024-12-10T12:00:00Z',
		updated_at: '2025-02-15T11:00:00Z'
	},
	{
		id: 'per2',
		full_name: 'Ana Ruiz',
		dni: '30555111',
		phone: '1144778899',
		email: 'ana@example.com',
		archived_at: null,
		created_at: '2025-01-05T10:00:00Z',
		updated_at: '2025-02-01T09:00:00Z'
	}
];

export const demoCases: CaseFile[] = [
	{
		id: 'c1',
		person_id: 'per1',
		person_name: 'Carlos López',
		person_dni: '27111222',
		title: 'Jubilación Ordinaria',
		status: 'En curso',
		notes: 'Falta partida de nacimiento',
		next_action: 'Pedir partida online',
		next_action_date: '2025-03-01',
		archived_at: null,
		created_at: '2024-12-10T12:00:00Z',
		updated_at: '2025-02-15T11:00:00Z'
	},
	{
		id: 'c2',
		person_id: 'per2',
		person_name: 'Ana Ruiz',
		person_dni: '30555111',
		title: 'Asignación Universal',
		status: 'Pendiente docs',
		notes: null,
		next_action: 'Adjuntar DNI hijo',
		next_action_date: '2025-02-28',
		archived_at: null,
		created_at: '2025-01-05T10:00:00Z',
		updated_at: '2025-02-01T09:00:00Z'
	}
];

export const demoCaseEvents: CaseEvent[] = [
	{
		id: 'ce1',
		case_id: 'c1',
		event_type: 'Llamada',
		detail: 'Se llamó al cliente para pedir documentación.',
		created_at: '2025-02-10T15:00:00Z'
	},
	{
		id: 'ce2',
		case_id: 'c1',
		event_type: 'Presentación',
		detail: 'Se presentó formulario en ANSES.',
		created_at: '2025-02-15T10:00:00Z'
	},
	{
		id: 'ce3',
		case_id: 'c2',
		event_type: 'Requerimiento',
		detail: 'ANSES solicita DNI actualizado del hijo.',
		created_at: '2025-02-01T09:00:00Z'
	}
];
