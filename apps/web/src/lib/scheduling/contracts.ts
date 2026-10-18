export type ReminderDay = 'hoy' | 'manana';

export type ReminderCoverage = 'sin_calendario' | 'pendiente_actualizar';

export type ReminderCandidate = {
	appointment_id: string;
	patient_id: string;
	starts_at: string;
	time_label: string;
	status: string;
	service_name: string;
	professional_name: string;
	patient_name: string;
	coverage: ReminderCoverage;
	phone_e164: string | null;
	whatsapp_url: string | null;
	whatsapp_opened_at: string | null;
	whatsapp_marked_sent_at: string | null;
};

