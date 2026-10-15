export const ACTIVE_APPOINTMENT_STATUSES = [
	'reserved',
	'confirmed',
	'reschedule_requested'
] as const;

export const AGENDA_EXPIRED_MONTHS = 3;

export type ActiveAppointmentStatus = (typeof ACTIVE_APPOINTMENT_STATUSES)[number];

export const isActiveAppointmentStatus = (status: unknown): status is ActiveAppointmentStatus =>
	(ACTIVE_APPOINTMENT_STATUSES as readonly unknown[]).includes(status);

export const isUpcomingActiveAppointment = (
	appointment: { starts_at?: string | null; status?: unknown },
	now: Date = new Date()
) => {
	if (!isActiveAppointmentStatus(appointment.status)) return false;
	const startsAt = Date.parse(String(appointment.starts_at ?? ''));
	return Number.isFinite(startsAt) && startsAt >= now.getTime();
};

// PostgreSQL usa meses calendario para `interval '3 months'`. Reproducimos
// esa regla en el navegador y fijamos el día al último válido del mes destino
// para que, por ejemplo, el 31 de mayo reste tres meses hasta el 28 de febrero.
export const getAgendaExpiredCutoff = (now: Date = new Date()) => {
	const cutoff = new Date(now.getTime());
	const originalDay = cutoff.getUTCDate();
	cutoff.setUTCDate(1);
	cutoff.setUTCMonth(cutoff.getUTCMonth() - AGENDA_EXPIRED_MONTHS);
	const lastDayOfTargetMonth = new Date(
		Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)
	).getUTCDate();
	cutoff.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
	return cutoff;
};

export const isExpiredActiveAppointment = (
	appointment: { starts_at?: string | null; status?: unknown },
	now: Date = new Date()
) => {
	if (!isActiveAppointmentStatus(appointment.status)) return false;
	const startsAt = Date.parse(String(appointment.starts_at ?? ''));
	const nowTime = now.getTime();
	const cutoffTime = getAgendaExpiredCutoff(now).getTime();
	return (
		Number.isFinite(startsAt) &&
		Number.isFinite(nowTime) &&
		startsAt < nowTime &&
		startsAt >= cutoffTime
	);
};

export const splitActiveAppointmentGroups = <T>(
	appointments: readonly T[],
	now: Date = new Date()
) => {
	const upcoming: T[] = [];
	const past: T[] = [];

	for (const appointment of appointments) {
		if (!appointment || typeof appointment !== 'object') continue;
		const candidate = appointment as { starts_at?: string | null; status?: unknown };
		if (isUpcomingActiveAppointment(candidate, now)) {
			upcoming.push(appointment);
		} else if (isExpiredActiveAppointment(candidate, now)) {
			past.push(appointment);
		}
	}

	const startsAtTime = (appointment: T) =>
		Date.parse(String((appointment as { starts_at?: string | null }).starts_at ?? ''));
	upcoming.sort((left, right) => startsAtTime(left) - startsAtTime(right));
	past.sort((left, right) => startsAtTime(right) - startsAtTime(left));

	return { upcoming, past };
};
