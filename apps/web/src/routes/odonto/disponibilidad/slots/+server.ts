import { env } from '$env/dynamic/private';
import { getAvailabilitySlots, groupSlotsByDate } from '$lib/server/availability';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const localDateFor = (date: Date, timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

const positiveInteger = (value: string | null, maximum: number) => {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : undefined;
};

export const GET: RequestHandler = async ({ url, locals, fetch, cookies }) => {
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') return json({ days: {}, slots: [] });

	const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
	const serviceId = url.searchParams.get('service_id') ?? '';
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const professionalIds = [
		...new Set(
			(url.searchParams.get('professional_ids') ?? '')
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
	const fromDate = url.searchParams.get('from') ?? localDateFor(new Date(), business.business.timezone);
	const toDate = url.searchParams.get('to') ?? fromDate;
	const publicOnly = url.searchParams.get('public') === 'true';
	const ignoreBreak = url.searchParams.get('ignore_break') === 'true' && business.canOperate;
	const maxSlotsPerDate = positiveInteger(url.searchParams.get('max_slots_per_date'), 48);

	if (!serviceId) {
		return json(
			{
				message:
					'Primero elegí el procedimiento. Lo necesitamos para calcular cuánto dura el turno y qué profesionales pueden atenderlo.'
			},
			{ status: 400 }
		);
	}
	if (professionalIds.length === 1) {
		return json(
			{
				message:
					'Para buscar un horario conjunto seleccioná por lo menos dos profesionales. Si el turno será individual, elegí la opción “Un profesional”.'
			},
			{ status: 400 }
		);
	}

	try {
		const slots = await getAvailabilitySlots(supabase, {
			business: business.business,
			serviceId,
			professionalId,
			professionalIds,
			fromDate,
			toDate,
			publicOnly,
			ignoreBreak,
			maxSlotsPerDate
		});
		return json({ slots, days: groupSlotsByDate(slots) });
	} catch (error) {
		console.error('Error calculando slots', error);
		return json(
			{
				message:
					'No pudimos calcular los horarios en este momento. No se reservó nada. Recargá la agenda y volvé a intentarlo; si el problema continúa, pedile a un administrador que revise el registro interno.'
			},
			{ status: 500 }
		);
	}
};
