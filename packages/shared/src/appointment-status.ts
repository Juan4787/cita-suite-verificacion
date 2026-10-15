export const APPOINTMENT_STATUSES = [
	'reserved',
	'confirmed',
	'cancelled',
	'reschedule_requested'
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const MESSAGE_DISPATCH_STATUSES = [
	'scheduled',
	'queued',
	'sent',
	'delivered',
	'read',
	'failed',
	'cancelled'
] as const;

export type MessageDispatchStatus = (typeof MESSAGE_DISPATCH_STATUSES)[number];
