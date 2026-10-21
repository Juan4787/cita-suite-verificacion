import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '$lib/server/scheduling/public/appointments';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import { zonedDateTimeToUtc } from '$lib/server/scheduling/public/availability';
import { todayForBusiness } from '$lib/server/scheduling/public/public-booking';
import { isAvailabilityDate } from '$lib/availability/windows';
import { InvalidDataContractError, readChoice, readFiniteNumber, readRecord, readText } from '$lib/contracts/json';
import { error, redirect } from '@sveltejs/kit';
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
		cookies
	});
	if (business.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	// Today is the practice's day, and an impossible date in the address shows this week.
	const requestedDate = url.searchParams.get('date') ?? '';
	const selectedDate = isAvailabilityDate(requestedDate) ? requestedDate : todayForBusiness(business.business);
	const selectedProfessionalId = url.searchParams.get('professional_id') ?? '';
	if (selectedProfessionalId && !isUuid(selectedProfessionalId))
		error(400, 'El profesional elegido no es válido. Volvé a la agenda de la semana.');
	const weekStart = weekStartFor(selectedDate);
	const dates = Array.from({ length: 7 }, (_, index) => toDateString(addDays(weekStart, index)));
	const rangeStart = zonedDateTimeToUtc(dates[0], '00:00', business.business.timezone);
	const rangeEnd = zonedDateTimeToUtc(dates[6], '23:59', business.business.timezone);

	// The database counts the week by local day and state under the reader's own rules:
	// at most seven days by four states, instead of every appointment of the week, which
	// cost CPU per appointment here and could be cut by the API row limit.
	const [counts, professionals] = await Promise.all([
		supabase.rpc('agenda_week_counts', {
			p_business_id: business.business.id,
			p_from: rangeStart.toISOString(),
			p_to: rangeEnd.toISOString(),
			p_time_zone: business.business.timezone,
			...(selectedProfessionalId ? { p_professional_id: selectedProfessionalId } : {})
		}),
		supabase
			.from('professionals')
			.select('id, name, is_active')
			.eq('business_id', business.business.id)
			.eq('is_active', true)
			.order('sort_order')
			.order('name')
	]);
	// An unreadable week is an error, never an empty week or a missing professional filter.
	if (counts.error || professionals.error) {
		logServerFailure('agenda.week_unavailable', counts.error ?? professionals.error);
		error(503, 'No pudimos cargar la agenda de la semana. Volvé a intentar.');
	}

	const countsByDate = new Map(dates.map((date) => [date, new Map<AppointmentStatus, number>()]));
	for (const value of counts.data ?? []) {
		const row = readRecord(value, 'agendaWeek.count');
		const day = countsByDate.get(readText(row.local_date, 'agendaWeek.date'));
		const status = readChoice(row.status, APPOINTMENT_STATUSES, 'agendaWeek.status');
		const appointments = readFiniteNumber(row.appointments, 'agendaWeek.appointments');
		if (!day || day.has(status) || !Number.isSafeInteger(appointments) || appointments < 1)
			throw new InvalidDataContractError('agendaWeek.count');
		day.set(status, appointments);
	}

	return {
		context: business,
		selectedDate,
		selectedProfessionalId,
		days: dates.map((date) => {
			const stats = APPOINTMENT_STATUSES.map((status) => ({ status, count: countsByDate.get(date)?.get(status) ?? 0 }));
			return { date, total: stats.reduce((sum, item) => sum + item.count, 0), stats };
		}),
		professionals: professionals.data ?? [],
		demo: false
	};
};
