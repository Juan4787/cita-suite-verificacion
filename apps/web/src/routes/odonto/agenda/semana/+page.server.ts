import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { APPOINTMENT_STATUSES } from '$lib/server/scheduling/public/appointments';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { zonedDateTimeToUtc } from '$lib/server/scheduling/public/availability';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const pad = (value: number) => String(value).padStart(2, '0');

const toDateString = (date: Date) =>
	`${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const addDays = (date: Date, days: number) => {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
};

const weekStartFor = (dateValue: string) => {
	const date = new Date(`${dateValue}T00:00:00.000Z`);
	const day = date.getUTCDay();
	const mondayOffset = day === 0 ? -6 : 1 - day;
	return addDays(date, mondayOffset);
};

const localDateFor = (isoDate: string, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = Object.fromEntries(formatter.formatToParts(new Date(isoDate)).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			selectedDate: new Date().toISOString().slice(0, 10),
			selectedProfessionalId: '',
			days: [],
			professionals: [],
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies,
		membershipCache: 'fresh'
	});
	if (business.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	const selectedDate = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
	const selectedProfessionalId = url.searchParams.get('professional_id') ?? '';
	const weekStart = weekStartFor(selectedDate);
	const dates = Array.from({ length: 7 }, (_, index) => toDateString(addDays(weekStart, index)));
	const rangeStart = zonedDateTimeToUtc(dates[0], '00:00', business.business.timezone);
	const rangeEnd = zonedDateTimeToUtc(dates[6], '23:59', business.business.timezone);

	// Separate literal selects keep the SDK's relationship inference exact.
	const appointmentsQuery = selectedProfessionalId
		? supabase.from('appointments')
			.select('id, professional_id, starts_at, status, appointment_professionals!inner(professional_id)')
			.eq('appointment_professionals.professional_id', selectedProfessionalId)
		: supabase.from('appointments').select('id, professional_id, starts_at, status');
	const rangedAppointments = appointmentsQuery
		.eq('business_id', business.business.id)
		.gte('starts_at', rangeStart.toISOString())
		.lte('starts_at', rangeEnd.toISOString()).order('starts_at');

	const [{ data: appointments, error: appointmentsError }, { data: professionals }] = await Promise.all([
		rangedAppointments,
		supabase
			.from('professionals')
			.select('id, name, is_active')
			.eq('business_id', business.business.id)
			.eq('is_active', true)
			.order('sort_order')
			.order('name')
	]);

	if (appointmentsError) {
		logServerFailure('Error cargando agenda semanal', appointmentsError);
	}

	const days = dates.map((date) => {
		const dayAppointments = (appointments ?? []).filter(
			(appointment) => localDateFor(appointment.starts_at, business.business.timezone) === date
		);
		return {
			date,
			total: dayAppointments.length,
			stats: APPOINTMENT_STATUSES.map((status) => ({
				status,
				count: dayAppointments.filter((appointment) => appointment.status === status).length
			}))
		};
	});

	return {
		context: business,
		selectedDate,
		selectedProfessionalId,
		days,
		professionals: professionals ?? [],
		demo: false
	};
};
