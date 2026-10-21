import { todayInTimeZone } from '$lib/availability/calculate';
import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { zonedDateTimeToUtc } from '$lib/server/scheduling/public/availability';
import { ACTIVE_APPOINTMENT_STATUSES } from '$lib/utils/appointment-visibility';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professionalLinks: [],
			selectedProfessionalId: '',
			todayAppointments: [],
			upcomingAppointments: [],
			demo: true
		};
	}

	const { supabase, business, userId } = await getOdontoContext({
		locals,
		fetch,
		cookies
	});
	// An unreadable day is an error, never a day without appointments.
	const unavailable = (cause: unknown): never => {
		logServerFailure('agenda.own_unavailable', cause);
		error(503, 'No pudimos cargar tus turnos. Volvé a intentar.');
	};
	const { data: links, error: linksError } = await supabase
		.from('professional_users')
		.select('professional_id, professionals!inner(id, name, specialty, is_active)')
		.eq('business_id', business.business.id)
		.eq('user_id', userId);
	if (linksError) unavailable(linksError);

	const professionalIds = (links ?? []).map((link) => String(link.professional_id));
	const selectedProfessionalId = url.searchParams.get('professional_id') ?? '';
	const visibleProfessionalIds =
		selectedProfessionalId && professionalIds.includes(selectedProfessionalId)
			? [selectedProfessionalId]
			: professionalIds;

	const today = todayInTimeZone(business.business.timezone);
	const dayStart = zonedDateTimeToUtc(today, '00:00', business.business.timezone);
	const dayEnd = zonedDateTimeToUtc(today, '23:59', business.business.timezone);

	const appointmentColumns =
		'id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, patients(id, full_name, phone_e164), appointment_professionals!inner(professional_id)';
	const [todayResult, upcomingResult] =
		visibleProfessionalIds.length > 0
			? await Promise.all([
					supabase
						.from('appointments')
						.select(appointmentColumns)
						.eq('business_id', business.business.id)
						.in('appointment_professionals.professional_id', visibleProfessionalIds)
						.gte('starts_at', dayStart.toISOString())
						.lte('starts_at', dayEnd.toISOString())
						.order('starts_at'),
					supabase
						.from('appointments')
						.select(appointmentColumns)
						.eq('business_id', business.business.id)
						.in('appointment_professionals.professional_id', visibleProfessionalIds)
						.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
						.gt('starts_at', dayEnd.toISOString())
						.order('starts_at')
						.limit(30)
				])
			: [{ data: [], error: null }, { data: [], error: null }];
	if (todayResult.error || upcomingResult.error) unavailable(todayResult.error ?? upcomingResult.error);

	return {
		context: business,
		professionalLinks: links ?? [],
		selectedProfessionalId,
		todayAppointments: todayResult.data ?? [],
		upcomingAppointments: upcomingResult.data ?? [],
		demo: false
	};
};
