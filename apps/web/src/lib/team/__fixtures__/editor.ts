import type { ProfessionalEditorData } from '../professional-editor';
export function professionalEditorData(): ProfessionalEditorData {
	return {
		context: {
			business: { id: 'business-one', timezone: 'UTC' },
			canOperate: true,
			canManage: true
		},
		professional: {
			id: 'professional-one',
			name: 'Profesional sintético',
			specialty: '',
			phone: '',
			email: '',
			is_active: true,
			is_public: true
		},
		services: [
			{
				id: 'service-one',
				name: 'Consulta sintética',
				description: null,
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				price_label: '20000',
				updated_at: '2026-10-18T10:00:00Z',
				patient_instructions: null,
				public_reminder_description: null,
				is_active: true,
				is_public: true,
				sort_order: 0
			}
		],
		assignedServiceIds: ['service-one'],
		defaultServiceIds: [],
		availabilityRevision: 42,
		rules: [
			{
				id: 'rule-one',
				weekday: 1,
				start_time: '09:00',
				end_time: '12:00',
				slot_interval_minutes: 15,
				break_minutes: 15,
				is_active: true,
				created_at: '2026-10-18T10:00:00Z',
				service_scope: 'restricted',
				rule_services: [{ service_id: 'service-one' }]
			}
		],
		exceptions: [],
		appointmentCount: null,
		clinicalEntryCount: null,
		followUpCount: null,
		dependencyCountsDeferred: true,
		tab: 'perfil',
		userId: 'owner-one',
		pendingAccountEmail: null,
		demo: false
	};
}
