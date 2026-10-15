import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { getOdontoContext } from '$lib/server/odonto-context';
import { zonedDateTimeToUtc } from '$lib/server/availability';
import { ACTIVE_APPOINTMENT_STATUSES } from '$lib/utils/appointment-visibility';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const todayForTimezone = (timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

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
		cookies,
		membershipCache: 'fresh'
	});
	const { data: links } = await supabase
		.from('professional_users')
		.select('professional_id, professionals!inner(id, name, specialty, is_active)')
		.eq('business_id', business.business.id)
		.eq('user_id', userId);

	const professionalIds = (links ?? []).map((link: any) => String(link.professional_id));
	const selectedProfessionalId = url.searchParams.get('professional_id') ?? '';
	const visibleProfessionalIds =
		selectedProfessionalId && professionalIds.includes(selectedProfessionalId)
			? [selectedProfessionalId]
			: professionalIds;

	const today = todayForTimezone(business.business.timezone);
	const dayStart = zonedDateTimeToUtc(today, '00:00', business.business.timezone);
	const dayEnd = zonedDateTimeToUtc(today, '23:59', business.business.timezone);

	const { data: todayAppointments } =
		visibleProfessionalIds.length > 0
			? await supabase
					.from('appointments')
					.select(
						'id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, patients(id, full_name, phone_e164), appointment_professionals!inner(professional_id)'
					)
					.eq('business_id', business.business.id)
					.in('appointment_professionals.professional_id', visibleProfessionalIds)
					.gte('starts_at', dayStart.toISOString())
					.lte('starts_at', dayEnd.toISOString())
					.order('starts_at')
			: { data: [] };

	const { data: upcomingAppointments } =
		visibleProfessionalIds.length > 0
			? await supabase
					.from('appointments')
					.select(
						'id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, patients(id, full_name, phone_e164), appointment_professionals!inner(professional_id)'
					)
						.eq('business_id', business.business.id)
						.in('appointment_professionals.professional_id', visibleProfessionalIds)
						.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
						.gt('starts_at', dayEnd.toISOString())
					.order('starts_at')
					.limit(30)
			: { data: [] };

	return {
		context: business,
		professionalLinks: links ?? [],
		selectedProfessionalId,
		todayAppointments: todayAppointments ?? [],
		upcomingAppointments: upcomingAppointments ?? [],
		demo: false
	};
};
