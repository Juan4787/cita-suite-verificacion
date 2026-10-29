export type ReminderDay = 'hoy' | 'manana';

export type ReminderCoverage = 'sin_calendario' | 'pendiente_actualizar';

// La lista del día también muestra los turnos que ya tienen un aviso automático
// (calendario iniciado o notificación confirmada): recepción decide si igual les
// manda el recordatorio. El aviso de la agenda sigue contando sólo los otros.
export type ReminderListCoverage = ReminderCoverage | 'aviso_automatico';

/** Mensaje que la persona le manda al consultorio desde la página de su turno. */
export type PracticeWhatsAppNotice = { message: string; whatsappUrl: string; whatsappWebUrl: string };

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

export type ReminderListItem = Omit<ReminderCandidate, 'coverage'> & { coverage: ReminderListCoverage };

