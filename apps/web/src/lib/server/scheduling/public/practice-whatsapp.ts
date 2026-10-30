// Aviso de la persona al consultorio por WhatsApp, desde la página de su turno.
// Al terminar la reserva le prepara un mensaje con su nombre, el día y la hora, para
// que el consultorio quede avisado y con el chat abierto; si vuelve más tarde, el
// mismo botón le sirve para escribir por ese turno. No nombra la prestación: la
// vista previa del teléfono no debe mostrar datos de salud.
import type { DepositWhatsAppNotices, PracticeWhatsAppNotice } from '$lib/scheduling/contracts';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import { formatInTimeZone } from '$lib/utils/format';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';
import type { PublicAppointmentView } from '$lib/server/scheduling/public/public-appointments';
import type { AppointmentDepositView } from '$lib/scheduling/deposits';

type NoticeAppointment = Pick<PublicAppointmentView, 'status' | 'is_past' | 'starts_at' | 'patient_name'> & {
	business: Pick<PublicAppointmentView['business'], 'timezone' | 'whatsapp_contact_phone'>;
};

const greetingOf = (appointment: NoticeAppointment) => {
	const name = String(appointment.patient_name ?? '').trim().replace(/\s+/g, ' ');
	return name ? `Hola, soy ${name}.` : 'Hola.';
};

// La vista pública sólo trae el número si el consultorio habilitó su WhatsApp y el número se
// puede abrir; un turno cerrado no necesita aviso. Devuelve el número y el comienzo del mensaje.
const opening = (appointment: NoticeAppointment, created: boolean) => {
	const phone = appointment.business.whatsapp_contact_phone;
	if (!phone || appointment.is_past || !isActiveAppointmentStatus(appointment.status)) return null;
	const { dateLabel, timeLabel } = formatInTimeZone(appointment.starts_at, appointment.business.timezone);
	const body = created
		? `Reservé un turno para el ${dateLabel} a las ${timeLabel}.`
		: `Te escribo por mi turno del ${dateLabel} a las ${timeLabel}.`;
	return { phone, text: `${greetingOf(appointment)} ${body}` };
};

const notice = (phone: string, message: string): PracticeWhatsAppNotice => ({
	message,
	whatsappUrl: buildWaMeUrl(phone, message),
	whatsappWebUrl: buildWhatsAppWebUrl(phone, message)
});

export const buildPracticeWhatsAppNotice = (
	appointment: NoticeAppointment,
	options: { created: boolean }
): PracticeWhatsAppNotice | null => {
	const start = opening(appointment, options.created);
	return start ? notice(start.phone, start.text) : null;
};

/**
 * With the deposit pending, the two paths the practice approved (plan, section 4.7): send the
 * receipt now, or say it will be paid before the due date. Null otherwise: the generic notice
 * stays for every other turn.
 */
export const buildDepositWhatsAppNotices = (
	appointment: NoticeAppointment & { deposit: Pick<AppointmentDepositView, 'status' | 'due_at'> | null },
	options: { created: boolean }
): DepositWhatsAppNotices | null => {
	if (appointment.deposit?.status !== 'pending') return null;
	const start = opening(appointment, options.created);
	if (!start) return null;
	const due = formatInTimeZone(appointment.deposit.due_at, appointment.business.timezone);
	return {
		paidNow: notice(start.phone, `${start.text} Te envío el comprobante de la seña.`),
		payLater: notice(start.phone, `${start.text} Voy a transferir la seña antes del ${due.dateLabel} a las ${due.timeLabel}.`)
	};
};

/**
 * A turn the automatic cancellation closed (plan, section 4.9: «Si ya transferiste, escribile al
 * consultorio»): the person may have paid without the practice recording it, so the message
 * offers the receipt. Null once the turn's time passed or without the practice's WhatsApp.
 */
export const buildExpiredDepositWhatsAppNotice = (
	appointment: NoticeAppointment & { deposit: Pick<AppointmentDepositView, 'status'> | null }
): PracticeWhatsAppNotice | null => {
	const phone = appointment.business.whatsapp_contact_phone;
	if (!phone || appointment.is_past || appointment.status !== 'cancelled' || appointment.deposit?.status !== 'expired') return null;
	const { dateLabel, timeLabel } = formatInTimeZone(appointment.starts_at, appointment.business.timezone);
	return notice(
		phone,
		`${greetingOf(appointment)} Mi turno del ${dateLabel} a las ${timeLabel} se canceló por la seña, pero ya la había transferido. Te envío el comprobante.`
	);
};

/**
 * Every WhatsApp notice the person's page offers, decided in one place: with the deposit pending,
 * its two paths replace the generic notice, so the page never shows two WhatsApp blocks; with the
 * turn cancelled by the deposit, the receipt notice; otherwise the generic notice of an active
 * turn. The generic one exists only for active turns, so the two practice variants never meet.
 */
export const buildTurnWhatsAppNotices = (
	appointment: NoticeAppointment & { deposit: Pick<AppointmentDepositView, 'status' | 'due_at'> | null },
	options: { created: boolean }
): { depositWhatsApp: DepositWhatsAppNotices | null; practiceWhatsApp: PracticeWhatsAppNotice | null } => {
	const depositWhatsApp = buildDepositWhatsAppNotices(appointment, options);
	return {
		depositWhatsApp,
		practiceWhatsApp: depositWhatsApp
			? null
			: (buildExpiredDepositWhatsAppNotice(appointment) ?? buildPracticeWhatsAppNotice(appointment, options))
	};
};
