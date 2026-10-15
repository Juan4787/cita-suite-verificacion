import { env } from '$env/dynamic/private';
import { getAvailabilitySlots } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const todayForTimezone = (timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
			.formatToParts(new Date())
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

// Horarios reales disponibles del profesional del turno para una fecha, excluyendo
// el propio turno del cálculo (si no, el turno se bloquearía a sí mismo).
export const GET: RequestHandler = async ({ params, url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ slots: [] });

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canOperate) {
		return json(
			{
				message:
					'Tu rol no permite reprogramar turnos. Pedile a recepción, al dueño o a un administrador que haga el cambio desde la agenda.',
				slots: []
			},
			{ status: 403 }
		);
	}

	const date = url.searchParams.get('date') ?? '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return json(
			{
				message:
					'La fecha no tiene un formato válido. Cerrá el panel de reprogramación, volvé a abrirlo y elegí un día del calendario.',
				slots: []
			},
			{ status: 400 }
		);
	}
	if (date < todayForTimezone(business.business.timezone)) {
		return json({ slots: [] });
	}

	const [appointmentResult, teamResult] = await Promise.all([
		supabase
			.from('appointments')
			.select('id, service_id, professional_id, status, ignore_break')
			.eq('business_id', business.business.id)
			.eq('id', params.appointmentId)
			.maybeSingle(),
		supabase
			.from('appointment_professionals')
			.select('professional_id, position')
			.eq('business_id', business.business.id)
			.eq('appointment_id', params.appointmentId)
			.order('position')
	]);
	const appointment = appointmentResult.data;

	if (appointmentResult.error || teamResult.error) {
		console.error(
			'Error cargando turno para slots de reprogramación',
			appointmentResult.error ?? teamResult.error
		);
		return json(
			{
				message:
					'No pudimos cargar el turno completo y no se modificó ninguna agenda. Cerrá este panel, recargá la página y volvé a intentar.',
				slots: []
			},
			{ status: 500 }
		);
	}
	if (!appointment) {
		return json(
			{
				message:
					'No encontramos este turno. Volvé a la agenda y abrilo nuevamente antes de reprogramar.',
				slots: []
			},
			{ status: 404 }
		);
	}
	if (appointment.status === 'cancelled') {
		return json({ slots: [] });
	}

	try {
		const professionalIds =
			teamResult.data && teamResult.data.length > 0
				? teamResult.data.map((allocation) => String(allocation.professional_id))
				: [String(appointment.professional_id)];
		// La nueva fecha parte respetando el descanso. Sólo se ignora cuando el
		// usuario lo solicita explícitamente en esta reprogramación.
		const ignoreBreak = url.searchParams.get('ignore_break') === 'true';
		const slots = await getAvailabilitySlots(supabase, {
			business: business.business,
			serviceId: appointment.service_id,
			professionalId: professionalIds.length === 1 ? professionalIds[0] : null,
			professionalIds: professionalIds.length > 1 ? professionalIds : [],
			fromDate: date,
			toDate: date,
			publicOnly: false,
			excludeAppointmentId: appointment.id,
			ignoreBreak
		});
		return json({ slots });
	} catch (err) {
		console.error('Error calculando slots de reprogramación', err);
		return json(
			{
				message:
					'No pudimos comparar la disponibilidad de todos los profesionales. El turno conserva su horario actual. Recargá la página y volvé a intentar.',
				slots: []
			},
			{ status: 500 }
		);
	}
};
