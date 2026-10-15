import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';
import { demoBusinessContext } from '$lib/server/business';
import { getAvailabilitySlots, zonedDateTimeToUtc } from '$lib/server/availability';
import {
	defaultInternalAvailabilitySnapshotRange,
	loadInternalAvailabilitySnapshot
} from '$lib/server/availability-snapshot';
import {
	APPOINTMENT_STATUSES,
	createJointAppointment,
	createManualAppointment,
	findAppointmentCreationReplay,
	getHumanAppointmentErrorMessage,
	isAppointmentStatus,
	updateAppointmentStatus
} from '$lib/server/appointments';
import { getOdontoContext } from '$lib/server/odonto-context';
import { countTomorrowUncovered } from '$lib/server/reminders';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { processAppointmentGoogleCalendarSync } from '$lib/server/google-calendar';
import { createdAppointmentDetailUrl } from '$lib/server/agenda-navigation';
import {
	ACTIVE_APPOINTMENT_STATUSES,
	isActiveAppointmentStatus
} from '$lib/utils/appointment-visibility';
import { resolveCommunicationPhoneDecision } from '$lib/utils/communication-phone';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const today = () => new Date().toISOString().slice(0, 10);

const todayForTimezone = (timeZone: string) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		})
			.formatToParts(new Date())
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
};

const APPOINTMENT_COLUMNS =
	'id, patient_id, service_id, professional_id, starts_at, ends_at, status, source, service_name_snapshot, professional_name_snapshot, internal_note, cancelled_reason, patients(full_name, phone_e164, dni, email)';

// Tope de próximos turnos al buscar con "Cualquier día".
const ANY_DAY_LIMIT = 100;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const appointmentRequestId = randomUUID();
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			date: today(),
			anyDay: false,
			anyDayLimited: false,
			selectedProfessionalId: '',
			selectedStatus: '',
			selectedServiceId: '',
			selectedPatientId: '',
			searchApplied: false,
			appointments: [],
			stats: APPOINTMENT_STATUSES.map((status) => ({ status, count: 0 })),
			totalAppointments: 0,
			professionals: [],
			services: [],
			serviceProfessionalIds: {},
			availabilitySnapshot: null,
			patients: [],
			patientsLoaded: true,
			referencesLoaded: true,
			reminderCount: 0,
			appointmentRequestId,
			demo: true
		};
	}

	const { supabase, business } = await getOdontoContext({
		locals,
		fetch,
		cookies
	});
	if (business.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	const dateParam = String(url.searchParams.get('date') ?? '').trim();
	const anyDay = dateParam === 'any';
	// Las fechas malformadas caen en "hoy" (antes rompían zonedDateTimeToUtc).
	const date = !anyDay && isIsoDate(dateParam) ? dateParam : todayForTimezone(business.business.timezone);
	const professionalId = url.searchParams.get('professional_id') ?? '';
	const requestedStatus = url.searchParams.get('status') ?? '';
	const status = anyDay && !isActiveAppointmentStatus(requestedStatus) ? '' : requestedStatus;
	const serviceId = url.searchParams.get('service_id') ?? '';
	const patientId = url.searchParams.get('patient_id') ?? '';
	const searchApplied =
		url.searchParams.has('date') || Boolean(professionalId || status || serviceId || patientId);
	const reminderCountPromise = (async () => {
		try {
			const pushSubscriptionsSupabase = await createSupabaseAdminClient('odonto', fetch);
			return await countTomorrowUncovered(supabase, business.business, {
				pushSubscriptionsSupabase
			});
		} catch (reminderError) {
			console.error('Error contando recordatorios pendientes', reminderError);
			return 0;
		}
	})();

	let dayAppointments: any[] | null = null;
	let appointmentsError: unknown = null;
	let anyDayLimited = false;
	if (anyDay) {
		// "Cualquier día" es una vista operativa: sólo devuelve próximos turnos activos.
		// Los registros históricos siguen disponibles al elegir explícitamente una fecha pasada.
		const baseQuery = () => {
			let builder = supabase
				.from('appointments')
				.select(
					professionalId
						? `${APPOINTMENT_COLUMNS}, appointment_professionals!inner(professional_id)`
						: APPOINTMENT_COLUMNS
				)
				.eq('business_id', business.business.id);
			if (professionalId) {
				builder = builder.eq(
					'appointment_professionals.professional_id',
					professionalId
				);
			}
			if (serviceId) builder = builder.eq('service_id', serviceId);
			if (patientId) builder = builder.eq('patient_id', patientId);
			if (status) builder = builder.eq('status', status);
			return builder;
		};
		const nowIso = new Date().toISOString();
		const upcomingResult = await baseQuery()
			.in('status', [...ACTIVE_APPOINTMENT_STATUSES])
			.gte('starts_at', nowIso)
			.order('starts_at')
			.limit(ANY_DAY_LIMIT);
		appointmentsError = upcomingResult.error;
		const upcoming = upcomingResult.data ?? [];
		anyDayLimited = upcoming.length === ANY_DAY_LIMIT;
		dayAppointments = upcoming;
	} else {
		const dayStart = zonedDateTimeToUtc(date, '00:00', business.business.timezone);
		const dayEnd = zonedDateTimeToUtc(date, '23:59', business.business.timezone);
		({ data: dayAppointments, error: appointmentsError } = await supabase
			.from('appointments')
			.select(
				professionalId
					? `${APPOINTMENT_COLUMNS}, appointment_professionals!inner(professional_id)`
					: APPOINTMENT_COLUMNS
			)
			.eq('business_id', business.business.id)
			.match(
				professionalId
					? { 'appointment_professionals.professional_id': professionalId }
					: {}
			)
			.gte('starts_at', dayStart.toISOString())
			.lte('starts_at', dayEnd.toISOString())
			.order('starts_at'));
	}
	if (appointmentsError) {
		console.error('Error cargando agenda diaria', appointmentsError);
	}

	const filteredAppointments = (dayAppointments ?? []).filter((appointment: any) => {
		if (serviceId && appointment.service_id !== serviceId) return false;
		if (patientId && appointment.patient_id !== patientId) return false;
		if (status && appointment.status !== status) return false;
		return true;
	});

	const stats = APPOINTMENT_STATUSES.map((appointmentStatus) => ({
		status: appointmentStatus,
		count: filteredAppointments.filter((appointment: any) => appointment.status === appointmentStatus).length
	}));

	const shouldLoadReferences = Boolean(professionalId || serviceId || patientId);
	let professionals: any[] = [];
	let services: any[] = [];
	let patients: any[] = [];
	let assignments: any[] = [];
	let availabilitySnapshot = null;
	if (shouldLoadReferences) {
		try {
			const range = defaultInternalAvailabilitySnapshotRange(business.business, date);
			availabilitySnapshot = await loadInternalAvailabilitySnapshot(supabase, {
				business: business.business,
				...range
			});
			professionals = availabilitySnapshot.professionals;
			services = availabilitySnapshot.services;
			assignments = availabilitySnapshot.assignments;
		} catch (error) {
			console.error('Error cargando referencias y disponibilidad de agenda', error);
		}
	}
	const appointments = filteredAppointments;

	const serviceProfessionalIds = (assignments ?? []).reduce<Record<string, string[]>>((acc, assignment: any) => {
		const service = String(assignment.service_id);
		acc[service] = acc[service] ?? [];
		acc[service].push(String(assignment.professional_id));
		return acc;
	}, {});

	// El aviso usa el criterio exacto de Recordatorios: sólo cuenta los turnos sin
	// calendario, avisos activados ni cobertura automática.
	const reminderCount = await reminderCountPromise;

	if (patientId) {
		const { data: selectedPatient } = await supabase
			.from('patients')
			.select('id, full_name, phone, phone_raw, phone_e164, dni, birth_date, activity_at, blocked')
			.eq('business_id', business.business.id)
			.eq('id', patientId)
			.maybeSingle();
		if (selectedPatient) patients = [selectedPatient];
	}

	return {
		context: business,
		date,
		anyDay,
		anyDayLimited,
		selectedProfessionalId: professionalId,
		selectedStatus: status,
		selectedServiceId: serviceId,
		selectedPatientId: patientId,
		searchApplied,
		appointments: appointments ?? [],
		stats,
		totalAppointments: (dayAppointments ?? []).length,
		professionals: professionals ?? [],
		services: services ?? [],
		serviceProfessionalIds,
		availabilitySnapshot,
		patients,
		patientsLoaded: false,
		referencesLoaded: shouldLoadReferences,
		reminderCount,
		appointmentRequestId,
		demo: false
	};
};

export const actions: Actions = {
	create_appointment: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para crear turnos.' });

		const form = await request.formData();
		const serviceId = String(form.get('service_id') ?? '').trim();
		const requestedProfessionalIds = [
			...new Set(
				[
					...form.getAll('professional_ids').map((value) => String(value).trim()),
					String(form.get('professional_id') ?? '').trim()
				].filter(Boolean)
			)
		];
		const bookingMode =
			String(form.get('booking_mode') ?? '').trim() === 'joint' ||
			requestedProfessionalIds.length > 1
				? 'joint'
				: 'individual';
		const professionalIds =
			bookingMode === 'joint'
				? requestedProfessionalIds
				: requestedProfessionalIds.slice(0, 1);
		const professionalId = professionalIds[0] ?? '';
		const date = String(form.get('date') ?? '').trim();
		const time = String(form.get('time') ?? '').trim();
		const patientId = String(form.get('patient_id') ?? '').trim();
		const patientMode = String(form.get('patient_mode') ?? '').trim();
		const patientName = String(form.get('patient_name') ?? '').trim();
		const patientPhone = String(form.get('patient_phone') ?? '').trim();
		const patientEmail = String(form.get('patient_email') ?? '').trim();
		const patientPhoneChanged = form.get('patient_phone_changed') === 'true';
		const phoneWarningOverride = String(form.get('phone_warning_override') ?? '').trim();
		const idempotencyKey = String(form.get('idempotency_key') ?? '').trim();
		const ignoreBreak = form.get('ignore_break') === 'true';
		const values = {
			...Object.fromEntries(form),
			booking_mode: bookingMode,
			patient_mode: patientMode,
			professional_id: professionalId,
			professional_ids: professionalIds.join(',')
		};

		if (!serviceId || !professionalId || !date || !time) {
			return fail(400, {
				message:
					'Falta información para crear el turno. Volvé al asistente y completá el procedimiento, los profesionales, la fecha y el horario antes de confirmar.',
				values
			});
		}
		if (bookingMode === 'joint' && professionalIds.length < 2) {
			return fail(400, {
				message:
					'Un turno conjunto necesita por lo menos dos profesionales diferentes. Volvé al paso del equipo, seleccioná dos o más integrantes y buscá nuevamente un horario.',
				values
			});
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
			return fail(400, {
				message:
					'La fecha o la hora no tienen un formato válido. Volvé al paso de horarios y elegí una opción mostrada por la agenda.',
				values
			});
		}
		if (patientMode !== 'existing' && patientMode !== 'new') {
			return fail(400, {
				message:
					'La selección del paciente quedó incompleta. Volvé al último paso y elegí “Buscar paciente” o “Nuevo paciente”.',
				values
			});
		}
		if (patientMode === 'existing' && (!patientId || patientName)) {
			return fail(400, {
				message:
					'Para usar una ficha existente, buscá y seleccioná al paciente otra vez antes de confirmar.',
				values
			});
		}
		if (patientMode === 'new' && (patientId || !patientName)) {
			return fail(400, {
				message:
					'Para crear una ficha nueva, elegí “Nuevo paciente” y completá el nombre antes de confirmar.',
				values
			});
		}
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				idempotencyKey
			)
		) {
			return fail(400, {
				message:
					'La sesión para crear el turno venció. Cerrá el asistente, abrilo nuevamente y volvé a confirmar.',
				values
			});
		}

		let admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>;
		try {
			admin = await createSupabaseAdminClient('odonto', fetch);
		} catch (adminError) {
			console.error('Error preparando la creación del turno', adminError);
			return fail(500, { message: 'No pudimos preparar el turno. Intentá de nuevo.', values });
		}

			let effectivePatientPhone = patientPhone;
			let selectedPatientBlocked = false;
			let selectedPatientArchived = false;
			if (patientMode === 'existing') {
			const { data: selectedPatient, error: selectedPatientError } = await admin
				.from('patients')
				.select('id, blocked, archived_at, phone, phone_raw, phone_e164')
				.eq('business_id', business.business.id)
				.eq('id', patientId)
				.maybeSingle();
			if (selectedPatientError) {
				console.error('Error validando el teléfono del paciente', selectedPatientError);
				return fail(500, { message: 'No pudimos comprobar el teléfono. Intentá de nuevo.', values });
			}
			if (!selectedPatient) {
				return fail(404, { message: 'No encontramos al paciente seleccionado.', values });
			}
				selectedPatientBlocked = Boolean(selectedPatient.blocked);
				selectedPatientArchived = Boolean(selectedPatient.archived_at);
			if (!patientPhoneChanged) {
				effectivePatientPhone = String(
					selectedPatient.phone_raw ?? selectedPatient.phone ?? selectedPatient.phone_e164 ?? ''
				).trim();
			}
		}

		const phoneDecision = resolveCommunicationPhoneDecision(
			effectivePatientPhone,
			phoneWarningOverride
		);
		if (phoneDecision.warning) {
			return fail(422, {
				phoneWarning: { kind: phoneDecision.warning },
				values: {
					...values,
					patient_phone: effectivePatientPhone,
					patient_phone_changed: patientPhoneChanged ? 'true' : 'false',
					phone_warning_override: ''
				}
			});
			}
			const startsAt = zonedDateTimeToUtc(date, time, business.business.timezone);
			const patient =
				patientMode === 'existing'
					? {
							mode: 'existing' as const,
							patientId,
							phone: effectivePatientPhone,
							updatePhone: patientPhoneChanged
						}
					: {
							mode: 'new' as const,
							name: patientName,
							phone: effectivePatientPhone,
							email: patientEmail
						};
			const commonInput = {
				businessId: business.business.id,
				ownerId: userId,
				createdByUserId: userId,
				patient,
				serviceId,
				professionalIds,
				startsAt,
				internalNote: String(form.get('internal_note') ?? '').trim() || null,
				ignoreBreak,
				phoneCommunicationStatus: phoneDecision.status,
				phoneWarningAcknowledged: phoneDecision.acknowledged,
				idempotencyKey
			};

			try {
				const replay = await findAppointmentCreationReplay(admin, commonInput);
				if (replay) throw redirect(303, createdAppointmentDetailUrl(replay.id, date));
			} catch (error: any) {
				if (error?.status && error?.location) throw error;
				console.error('Error recuperando un turno ya creado', error);
				return fail(500, { message: getHumanAppointmentErrorMessage(error), values });
			}
			if (selectedPatientBlocked) {
				return fail(400, { message: 'Ese paciente está bloqueado.', values });
			}
			if (selectedPatientArchived) {
				return fail(400, {
					message:
						'La ficha seleccionada está archivada. Restaurala desde Pacientes o elegí otra ficha activa.',
					values
				});
			}

			let slots;
		try {
			slots = await getAvailabilitySlots(supabase, {
				business: business.business,
				serviceId,
				professionalId: bookingMode === 'individual' ? professionalId : null,
				professionalIds: bookingMode === 'joint' ? professionalIds : [],
				fromDate: date,
				toDate: date,
				publicOnly: false,
				ignoreBreak
			});
		} catch (availabilityError) {
			console.error('Error revalidando disponibilidad antes de crear turno', availabilityError);
			return fail(500, {
				message:
					'No pudimos volver a comprobar la disponibilidad y, por seguridad, no reservamos a ningún profesional. Recargá la agenda y elegí el horario otra vez.',
				values
			});
		}
		if (
			!slots.some(
				(slot) =>
					slot.starts_at === startsAt.toISOString() &&
					(bookingMode === 'joint'
						? professionalIds.every((id) => slot.professional_ids?.includes(id))
						: slot.professional_id === professionalId)
			)
		) {
			return fail(409, {
				message:
					bookingMode === 'joint'
						? 'Ese horario ya no está libre para todo el equipo. No se reservó a ningún profesional. Volvé al paso de horarios, actualizá la disponibilidad conjunta y elegí una de las opciones que siguen visibles.'
						: 'Ese horario ya no está libre para el profesional seleccionado. No se creó el turno. Volvé al paso de horarios, actualizá la disponibilidad y elegí otra opción.',
				values
			});
		}

			try {
				const created =
					bookingMode === 'joint'
						? await createJointAppointment(admin, {
								...commonInput,
								professionalIds: commonInput.professionalIds
							})
						: await createManualAppointment(admin, {
								...commonInput,
								professionalId
							});
			throw redirect(303, createdAppointmentDetailUrl(created.id, date));
		} catch (error: any) {
			if (error?.status && error?.location) throw error;
			console.error('Error creando turno', error);
			const message = getHumanAppointmentErrorMessage(error);
			return fail(error?.code === '23P01' ? 409 : 500, { message, values });
		}
	},
	update_status: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canOperate) return fail(403, { message: 'No tenés permisos para modificar turnos.' });

		const form = await request.formData();
		const appointmentId = String(form.get('appointment_id') ?? '').trim();
		const status = String(form.get('status') ?? '').trim();
		const date = String(form.get('date') ?? today()).trim();
		const professionalId = String(form.get('professional_id') ?? '').trim();
		const selectedStatus = String(form.get('selected_status') ?? '').trim();
		const serviceId = String(form.get('service_id') ?? '').trim();
		if (!appointmentId || !isAppointmentStatus(status)) {
			return fail(400, {
				message:
					'No pudimos identificar el turno o el estado solicitado. Recargá la agenda y usá una de las acciones visibles en la tarjeta del turno.'
			});
		}
		if (status === 'confirmed') {
			return fail(400, { message: 'La confirmación queda reservada al paciente desde su enlace.' });
		}

		try {
			await updateAppointmentStatus(supabase, {
				businessId: business.business.id,
				appointmentId,
				status,
				userId,
				reason: String(form.get('reason') ?? '').trim() || null
			});
		} catch (error: any) {
			console.error('Error actualizando turno', error);
			return fail(400, { message: getHumanAppointmentErrorMessage(error) });
		}

		if (status === 'cancelled') {
			try {
				const admin = await createSupabaseAdminClient('odonto', fetch);
				await processAppointmentGoogleCalendarSync(admin, appointmentId, fetch);
			} catch (calendarError) {
				// El borrado remoto ya quedó encolado por el trigger transaccional.
				console.error('Error sincronizando Google Calendar tras cancelar desde agenda', {
					appointmentId,
					code:
						calendarError instanceof Error
							? calendarError.message.slice(0, 120)
							: 'unknown'
				});
			}
		}

		const params = new URLSearchParams({ date });
		if (professionalId) params.set('professional_id', professionalId);
		if (selectedStatus) params.set('status', selectedStatus);
		if (serviceId) params.set('service_id', serviceId);
		throw redirect(303, `/odonto/agenda?${params.toString()}`);
	}
};
