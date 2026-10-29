// Aviso de la persona al consultorio por WhatsApp, desde la página de su turno.
// Al terminar la reserva le prepara un mensaje con su nombre, el día y la hora, para
// que el consultorio quede avisado y con el chat abierto; si vuelve más tarde, el
// mismo botón le sirve para escribir por ese turno. No nombra la prestación: la
// vista previa del teléfono no debe mostrar datos de salud.
import type { PracticeWhatsAppNotice } from '$lib/scheduling/contracts';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import { formatInTimeZone } from '$lib/utils/format';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';
import type { PublicAppointmentView } from '$lib/server/scheduling/public/public-appointments';

type NoticeAppointment = Pick<PublicAppointmentView, 'status' | 'is_past' | 'starts_at' | 'patient_name'> & {
	business: Pick<PublicAppointmentView['business'], 'timezone' | 'whatsapp_contact_phone'>;
};

export const buildPracticeWhatsAppNotice = (
	appointment: NoticeAppointment,
	options: { created: boolean }
): PracticeWhatsAppNotice | null => {
	// La vista pública sólo trae el número si el consultorio habilitó su WhatsApp y
	// el número se puede abrir; un turno cerrado no necesita aviso.
	const phone = appointment.business.whatsapp_contact_phone;
	if (!phone || appointment.is_past || !isActiveAppointmentStatus(appointment.status)) return null;
	const { dateLabel, timeLabel } = formatInTimeZone(appointment.starts_at, appointment.business.timezone);
	const name = String(appointment.patient_name ?? '').trim().replace(/\s+/g, ' ');
	const greeting = name ? `Hola, soy ${name}.` : 'Hola.';
	const body = options.created
		? `Reservé un turno para el ${dateLabel} a las ${timeLabel}.`
		: `Te escribo por mi turno del ${dateLabel} a las ${timeLabel}.`;
	const message = `${greeting} ${body}`;
	return { message, whatsappUrl: buildWaMeUrl(phone, message), whatsappWebUrl: buildWhatsAppWebUrl(phone, message) };
};
