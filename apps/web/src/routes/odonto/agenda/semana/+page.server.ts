import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/business';
import { APPOINTMENT_STATUSES } from '$lib/server/appointments';
import { getOdontoContext } from '$lib/server/odonto-context';
import { zonedDateTimeToUtc } from '$lib/server/availability';
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

	let appointmentsQuery = supabase
		.from('appointments')
		.select(
			selectedProfessionalId
				? 'id, professional_id, starts_at, status, appointment_professionals!inner(professional_id)'
				: 'id, professional_id, starts_at, status'
		)
		.eq('business_id', business.business.id)
		.gte('starts_at', rangeStart.toISOString())
		.lte('starts_at', rangeEnd.toISOString())
		.order('starts_at');
	if (selectedProfessionalId) {
		appointmentsQuery = appointmentsQuery.eq(
			'appointment_professionals.professional_id',
			selectedProfessionalId
		);
	}

	const [{ data: appointments, error: appointmentsError }, { data: professionals }] = await Promise.all([
		appointmentsQuery,
		supabase
			.from('professionals')
			.select('id, name, is_active')
			.eq('business_id', business.business.id)
			.eq('is_active', true)
			.order('sort_order')
			.order('name')
	]);

	if (appointmentsError) {
		console.error('Error cargando agenda semanal', appointmentsError);
	}

	const days = dates.map((date) => {
		const dayAppointments = (appointments ?? []).filter(
			(appointment: any) => localDateFor(appointment.starts_at, business.business.timezone) === date
		);
		return {
			date,
			total: dayAppointments.length,
			stats: APPOINTMENT_STATUSES.map((status) => ({
				status,
				count: dayAppointments.filter((appointment: any) => appointment.status === status).length
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
