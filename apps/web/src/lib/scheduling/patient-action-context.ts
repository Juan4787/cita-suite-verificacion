import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';

/** Effective permissions come from the authenticated server/SQL view. Presentation cannot
 * grant them. In particular, hiding a button in email does not revoke the patient's link. */
export type PatientActionContext = {
	status: string;
	startsAt: string;
	now: Date;
	managementAccessValid: boolean;
	cancelAllowed: boolean;
	rescheduleAllowed: boolean;
	newBookingAllowed: boolean;
};

export type PatientActions = { cancel: boolean; reschedule: boolean; bookNew: boolean };
const noActions = (): PatientActions => ({ cancel: false, reschedule: false, bookNew: false });

const validTime = (context: PatientActionContext) =>
	Number.isFinite(Date.parse(context.startsAt)) && Number.isFinite(context.now.getTime());

export const resolvePatientActions = (context: PatientActionContext): PatientActions => {
	if (context.managementAccessValid !== true || !validTime(context) ||
		Date.parse(context.startsAt) <= context.now.getTime()) return noActions();
	if (context.status === 'cancelled') {
		return { cancel: false, reschedule: false, bookNew: context.newBookingAllowed === true };
	}
	if (!isActiveAppointmentStatus(context.status)) return noActions();
	return {
		cancel: context.cancelAllowed === true,
		reschedule: context.rescheduleAllowed === true,
		bookNew: false
	};
};

export const APPOINTMENT_EMAIL_PURPOSES = [
	'booking_receipt', 'reschedule_receipt', 'cancellation_receipt',
	'deposit_request', 'deposit_expiring_reminder', 'reminder_72h', 'reminder_24h'
] as const;
export type AppointmentEmailPurpose = (typeof APPOINTMENT_EMAIL_PURPOSES)[number];

type AppointmentState = 'reserved' | 'confirmed' | 'reschedule_requested' | 'cancelled' | 'unavailable';
type DepositState = 'pending' | 'paid' | 'waived' | 'expired' | 'unavailable' | null;
export type AppointmentEmailContext = PatientActionContext & {
	/** Validate persisted/remote values too; TypeScript alone is not a runtime boundary. */
	purpose: string;
	depositStatus: string | null;
	showCancel: boolean;
	showReschedule: boolean;
};
export type AppointmentEmailContextResult = {
	send: boolean;
	skipReason: 'invalid_context' | 'stale_event' | 'appointment_started' | 'deposit_not_pending' | 'inconsistent_state' | null;
	actions: PatientActions;
	appointmentState: AppointmentState;
	depositState: DepositState;
};

/** One contextual policy for message builders and their previews. The dispatcher still
 * validates revision, recipient, consent, sender readiness and quota immediately before send.
 * Nothing here mutates an appointment or treats a payment receipt as attendance confirmation. */
export const resolveAppointmentEmailContext = (context: AppointmentEmailContext): AppointmentEmailContextResult => {
	const appointmentState: AppointmentState = isActiveAppointmentStatus(context.status) || context.status === 'cancelled'
		? context.status : 'unavailable';
	const depositState: DepositState = context.depositStatus === null || context.depositStatus === 'pending' ||
		context.depositStatus === 'paid' || context.depositStatus === 'waived' || context.depositStatus === 'expired'
		? context.depositStatus : 'unavailable';
	const skip = (skipReason: NonNullable<AppointmentEmailContextResult['skipReason']>): AppointmentEmailContextResult => ({
		send: false, skipReason, actions: noActions(), appointmentState, depositState
	});
	if (context.managementAccessValid !== true || !validTime(context) ||
		appointmentState === 'unavailable' || depositState === 'unavailable' ||
		!(APPOINTMENT_EMAIL_PURPOSES as readonly string[]).includes(context.purpose)) return skip('invalid_context');
	if ((context.status === 'confirmed' && context.depositStatus === 'pending') ||
		(isActiveAppointmentStatus(context.status) && context.depositStatus === 'expired')) return skip('inconsistent_state');
	if (context.purpose === 'cancellation_receipt') {
		if (context.status !== 'cancelled') return skip('stale_event');
	} else if (!isActiveAppointmentStatus(context.status)) return skip('stale_event');
	if (['reminder_72h', 'reminder_24h', 'deposit_request', 'deposit_expiring_reminder'].includes(context.purpose) &&
		Date.parse(context.startsAt) <= context.now.getTime()) return skip('appointment_started');
	if ((context.purpose === 'deposit_request' || context.purpose === 'deposit_expiring_reminder') &&
		context.depositStatus !== 'pending') return skip('deposit_not_pending');
	const available = resolvePatientActions(context);
	return {
		send: true, skipReason: null, appointmentState, depositState,
		actions: {
			cancel: available.cancel && context.showCancel === true,
			reschedule: available.reschedule && context.showReschedule === true,
			bookNew: available.bookNew
		}
	};
};
