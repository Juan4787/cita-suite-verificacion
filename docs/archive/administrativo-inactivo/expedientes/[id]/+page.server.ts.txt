import { env } from '$env/dynamic/private';
import { CASE_EVENT_TYPES, CASE_STATUS } from '$lib/constants';
import { newId, readDemoDb, updateDemoDb } from '$lib/server/demo-store';
import { createSupabaseServerClient, getUserIdFromAccessToken } from '$lib/server/supabase';
import { fail, redirect, error as kitError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, fetch }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const isDemo = env.DEMO_MODE === 'true';

	if (isDemo) {
		const db = readDemoDb();
		const caseFile = db.cases.find((c) => c.id === params.id);
		if (!caseFile) throw kitError(404, 'Expediente no encontrado');
		const person = db.people.find((p) => p.id === caseFile.person_id);
		const events = db.caseEvents
			.filter((e) => e.case_id === params.id)
			.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		return { caseFile, person, events, statuses: CASE_STATUS, eventTypes: CASE_EVENT_TYPES, demo: true };
	}

	const supabase = await createSupabaseServerClient('administrativo', locals.auth, fetch);

	const { data: caseFile, error: caseError } = await supabase
		.from('cases')
		.select(
			'id, title, status, notes, next_action, next_action_date, person_id, person_name, person_dni, archived_at, created_at, updated_at'
		)
		.eq('id', params.id)
		.maybeSingle();

	if (caseError || !caseFile) {
		throw kitError(404, 'Expediente no encontrado');
	}

	const { data: person } = await supabase
		.from('people')
		.select('id, full_name, dni, phone, email')
		.eq('id', caseFile.person_id)
		.maybeSingle();

	const { data: events, error: eventsError } = await supabase
		.from('case_events')
		.select('id, created_at, event_type, detail')
		.eq('case_id', params.id)
		.is('archived_at', null)
		.order('created_at', { ascending: false });

	if (eventsError) {
		console.error('Error cargando movimientos', eventsError);
	}

	return {
		caseFile,
		person,
		events: events ?? [],
		statuses: CASE_STATUS,
		eventTypes: CASE_EVENT_TYPES
	};
};

export const actions: Actions = {
	add_event: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');

		const form = await request.formData();
		const event_type = String(form.get('event_type') ?? '').trim() as (typeof CASE_EVENT_TYPES)[number];
		const detail = String(form.get('detail') ?? '').trim();
		const createdAtRaw = String(form.get('created_at') ?? '').trim();
		if (!createdAtRaw) {
			return fail(400, { message: 'Completá la fecha y hora.' });
		}

		const createdAtMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(createdAtRaw);
		if (!createdAtMatch) {
			return fail(400, { message: 'Revisá la fecha y hora. Formato esperado: Año/Mes/Día y Hora.' });
		}

		const y = Number(createdAtMatch[1]);
		const m = Number(createdAtMatch[2]);
		const d = Number(createdAtMatch[3]);
		const hh = Number(createdAtMatch[4]);
		const mm = Number(createdAtMatch[5]);

		if (!Number.isInteger(y) || y < 2000 || y > 2045) {
			return fail(400, { message: 'Revisá el año: debe estar entre 2000 y 2045.' });
		}
		if (!Number.isInteger(m) || m < 1 || m > 12) {
			return fail(400, { message: 'Revisá el mes: debe ir del 1 al 12.' });
		}
		const maxDay = new Date(y, m, 0).getDate();
		if (!Number.isInteger(d) || d < 1 || d > maxDay) {
			return fail(400, { message: `Revisá el día: para ese mes debe ir del 1 al ${maxDay}.` });
		}
		if (!Number.isInteger(hh) || hh < 0 || hh > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59) {
			return fail(400, { message: 'Revisá la hora: debe estar entre 00:00 y 23:59.' });
		}

		const created_at = new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();

		if (!event_type || !detail) {
			return fail(400, { message: 'Tipo y detalle son obligatorios' });
		}

		if (env.DEMO_MODE === 'true') {
			let saved = false;
			updateDemoDb((db) => {
				const caseFile = db.cases.find((c) => c.id === params.id);
				if (!caseFile) return;

				db.caseEvents.unshift({
					id: newId('ce'),
					case_id: params.id,
					event_type,
					detail,
					created_at
				});
				caseFile.updated_at = new Date().toISOString();
				saved = true;
			});

			if (!saved) {
				return fail(404, { message: 'Expediente no encontrado' });
			}

			throw redirect(303, `/administrativo/expedientes/${params.id}`);
		}

		const supabase = await createSupabaseServerClient('administrativo', locals.auth, fetch);
		const ownerId = getUserIdFromAccessToken(locals.auth.access_token);
		if (!ownerId) {
			return fail(401, { message: 'Sesión inválida. Volvé a iniciar sesión.' });
		}

		const { error } = await supabase.from('case_events').insert({
			owner_id: ownerId,
			case_id: params.id,
			event_type,
			detail,
			created_at
		});

		if (error) {
			console.error('Error guardando movimiento', error);
			return fail(500, { message: 'No se pudo guardar el movimiento' });
		}

		throw redirect(303, `/administrativo/expedientes/${params.id}`);
	},
	update_case: async ({ request, params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');

		const form = await request.formData();
		const status = String(form.get('status') ?? '') as (typeof CASE_STATUS)[number];
		const notes = String(form.get('notes') ?? '').trim();
		const next_action = String(form.get('next_action') ?? '').trim();
		const next_action_date = String(form.get('next_action_date') ?? '').trim();

		if (env.DEMO_MODE === 'true') {
			let updated = false;
			updateDemoDb((db) => {
				const caseFile = db.cases.find((c) => c.id === params.id);
				if (!caseFile) return;
				caseFile.status = status || 'Nuevo';
				caseFile.notes = notes || null;
				caseFile.next_action = next_action || null;
				caseFile.next_action_date = next_action_date || null;
				caseFile.updated_at = new Date().toISOString();
				updated = true;
			});

			if (!updated) {
				return fail(404, { message: 'Expediente no encontrado' });
			}

			throw redirect(303, `/administrativo/expedientes/${params.id}`);
		}

		const supabase = await createSupabaseServerClient('administrativo', locals.auth, fetch);

		const { error } = await supabase
			.from('cases')
			.update({
				status: status || 'Nuevo',
				notes: notes || null,
				next_action: next_action || null,
				next_action_date: next_action_date || null,
				updated_at: new Date().toISOString()
			})
			.eq('id', params.id);

		if (error) {
			console.error('Error actualizando expediente', error);
			return fail(500, { message: 'No se pudo actualizar el expediente' });
		}

		throw redirect(303, `/administrativo/expedientes/${params.id}`);
	},
	archive_case: async ({ params, locals, fetch }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') {
			let archived = false;
			updateDemoDb((db) => {
				const caseFile = db.cases.find((c) => c.id === params.id);
				if (!caseFile) return;
				const now = new Date().toISOString();
				caseFile.status = 'Cerrado';
				caseFile.archived_at = now;
				caseFile.updated_at = now;
				archived = true;
			});

			if (!archived) {
				return fail(404, { message: 'Expediente no encontrado' });
			}

			throw redirect(303, '/administrativo/expedientes?estado=Cerrado');
		}
		const supabase = await createSupabaseServerClient('administrativo', locals.auth, fetch);

		const { error } = await supabase
			.from('cases')
			.update({ status: 'Cerrado', archived_at: new Date().toISOString() })
			.eq('id', params.id);

		if (error) {
			console.error('Error archivando expediente', error);
			return fail(500, { message: 'No se pudo archivar' });
		}

		throw redirect(303, '/administrativo/expedientes?estado=Cerrado');
	}
};
