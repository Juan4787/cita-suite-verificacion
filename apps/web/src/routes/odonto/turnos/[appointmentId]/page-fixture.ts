// Datos de prueba compartidos por las pruebas de la página del turno: la de componente
// (page.client.test.ts) y la del HTML del servidor (page.ssr.test.ts).
import type { ComponentProps } from 'svelte';
import type Page from './+page.svelte';

// The appointment as the load returns it, every selected column included, so the page
// is checked against the shape it really receives.
export const appointment = {
	id: 'appointment-1',
	business_id: 'business-1',
	patient_id: 'patient-1',
	service_id: 'service-1',
	professional_id: 'professional-1',
	starts_at: '2026-08-20T15:00:00.000Z',
	ends_at: '2026-08-20T15:30:00.000Z',
	blocking_starts_at: '2026-08-20T15:00:00.000Z',
	blocking_ends_at: '2026-08-20T15:30:00.000Z',
	status: 'reserved',
	source: 'manual',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Ramírez',
	duration_minutes_snapshot: 30,
	buffer_before_minutes_snapshot: 0,
	buffer_after_minutes_snapshot: 0,
	break_minutes_snapshot: 0,
	ignore_break: false,
	confirmed_at: null,
	cancelled_at: null,
	cancelled_reason: null,
	reschedule_requested_at: null,
	internal_note: null,
	patient_instructions_snapshot: null,
	public_reminder_description_snapshot: null,
	price_quote_snapshot: null,
	phone_communication_status_at_booking: 'valid',
	phone_warning_acknowledged_at: null,
	created_by_user_id: 'user-1',
	updated_by_user_id: null,
	cancelled_by_user_id: null,
	created_at: '2026-08-05T12:00:00.000Z',
	updated_at: '2026-08-05T12:00:00.000Z',
 appointment_management_revision: 'a'.repeat(64),
	patients: {
		id: 'patient-1',
		full_name: 'Paciente de prueba',
		phone_e164: '+5493511234567',
		email: null,
		blocked: false, archived_at: null
	},
	booking_context: null,
	booking_intake: null,
	professionals: [
		{
			professional_id: 'professional-1',
			position: 0,
			is_primary: true,
			professional_name_snapshot: 'Dra. Ramírez',
			break_minutes_snapshot: 0
		}
	]
};

export type PageData = ComponentProps<typeof Page>['data'];
export const data: PageData = {
	context: { canOperate: true, role: 'owner' },
 management: { revision: 'a'.repeat(64),statusOperationId: '00000000-0000-4000-8000-000000000001',rescheduleOperationId: '00000000-0000-4000-8000-000000000002',lateDepositOperationId: '00000000-0000-4000-8000-000000000003' },
	depositFinancials: { appliedAmount: '0',forfeitedAmount: '0',unresolvedAmount: '0',latePayments: [],latePaymentsTruncated: false },
	appointment,
	deposit: null,
	canRecordDeposit: true,
	auditLogs: [],
	emailDeliveries: null,
	userLabels: {},
	reprogramDate: '2026-08-20',
	minReprogramDate: '2026-08-05',
	reprogramSlots: [],
	reprogramSlotsLoaded: false,
	fromDate: '2026-08-20',
	justRescheduled: false,
	justCreated: true,
 delivery: { available: true, hasPhone: true },
 activationDevice: 'desktop',
 phoneWarningAcknowledged: false,
	demo: false
};
