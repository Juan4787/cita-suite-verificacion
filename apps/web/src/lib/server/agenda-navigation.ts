export const createdAppointmentDetailUrl = (appointmentId: string, fromDate: string): string => {
	const params = new URLSearchParams({
		from_date: fromDate,
		created: '1'
	});
	return `/odonto/turnos/${encodeURIComponent(appointmentId)}?${params.toString()}`;
};

export const shouldOfferCreatedAppointmentActivation = (input: {
	requested: boolean;
	source: string;
	status: string;
	startsAt: string;
	token: string | null;
	now?: Date;
}): boolean =>
	input.requested &&
	['manual', 'admin'].includes(input.source) &&
	['reserved', 'confirmed', 'reschedule_requested'].includes(input.status) &&
	Boolean(input.token) &&
	new Date(input.startsAt).getTime() > (input.now ?? new Date()).getTime();
