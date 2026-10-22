import { isUuid } from '@cita-suite/shared/uuid';
import { logServerFailure } from '$lib/server/platform/logging';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { isRecord } from '$lib/contracts/json';
import { bookingInformationEnabled, loadProfessionalBookingSchema, informationErrorMessage } from '$lib/server/patients/public/booking-information';
import {type PriceQuote} from '$lib/booking/pricing';
import { parsePriceQuote, parseServicePriceLabels } from '$lib/scheduling/price-contracts';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { resolveMapsUrl } from '$lib/sites/location';
import {
	normalizePatientFullName,
	patientFullNameErrorMessage
} from '$lib/utils/patient-name';
import {
	createPublicBooking,
	getPublicBookingErrorMessage,
	getPublicBookingErrorCode,
	loadPublicBookingState,
	publicHash,
	verifyTurnstileIfConfigured
} from '$lib/server/scheduling/public/public-booking';
import { fail, redirect, isRedirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { BookingIntegration } from '$lib/server/sites/public/booking-integrations';
import { assertIntegrationSelection, bookingPresentation, intakeAnswersFromForm, integratedBookingErrorMessage } from '$lib/server/sites/public/booking-integrations';
import { BOOKING_REQUEST_ID_PATTERN } from '@cita-suite/shared/booking-integration';
import type { CitaSupabaseClient } from '$lib/types/database';

const valuesFromForm = (form: FormData) => Object.fromEntries(form.entries());

// The same recovery operation serves native and embedded entry points. A failed
// lookup never certifies that a booking did not happen; retries retain its key.
async function recoverIntegratedBooking(supabase: CitaSupabaseClient, url: URL, integration: BookingIntegration, entryPoint: 'embedded' | 'public_page') {
	const requestId = url.searchParams.get('request_id') ?? '';
	if (url.searchParams.get('recover') !== '1' || !BOOKING_REQUEST_ID_PATTERN.test(requestId)) return undefined;
	const { data, error } = await supabase.from('appointments')
		.select('confirmation_token, appointment_booking_contexts!inner(integration_id, entry_point)')
		.eq('business_id', integration.businessId).eq('creation_request_key', requestId.toLowerCase())
		.eq('appointment_booking_contexts.integration_id', integration.id)
		.eq('appointment_booking_contexts.entry_point', entryPoint).maybeSingle();
	if (error) throw error;
	if (data) {
		const query = new URLSearchParams({ recuperado: '1' });
		const framed = entryPoint === 'embedded' && url.searchParams.has('parent_origin') && url.searchParams.has('instance_id');
		if (framed) {
			for (const key of ['parent_origin', 'instance_id']) {
				const value = url.searchParams.get(key);
				if (value) query.set(key, value);
			}
		}
		redirect(303, (framed ? '/embed/v1/' + integration.publicKey : '') + '/turno/' + data.confirmation_token + '?' + query);
	}
	return randomUUID();
}

// OJO performance: este load NUNCA debe leer el parámetro `slot`. SvelteKit
// trackea los search params accedidos: al no leerlo, elegir horario no re-ejecuta
// el load (la página lo resuelve client-side desde page.url) y es instantáneo.
export const loadPublicBookingPage = async ({ params, fetch, url, setHeaders }: RequestEvent, integration?: BookingIntegration, entryPoint: 'embedded' | 'public_page' = 'embedded') => {
	const framed = entryPoint === 'embedded' && url.searchParams.has('parent_origin') && url.searchParams.has('instance_id');
	const suppliedRequestId = url.searchParams.get('request_id') ?? '';
	const bookingRequestId = integration && BOOKING_REQUEST_ID_PATTERN.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
	const requestedProfessionalIds = [
		...new Set(
			url.searchParams
				.getAll('professional_ids')
				.flatMap((value) => value.split(','))
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
	const bookingMode: 'individual' | 'joint' =
		url.searchParams.get('booking_mode') === 'joint' || requestedProfessionalIds.length > 1
			? 'joint'
			: 'individual';
	const selected = {
		serviceId: url.searchParams.get('service_id') ?? '',
		bookingMode,
		professionalId:
			bookingMode === 'individual' ? (url.searchParams.get('professional_id') ?? '') : '',
		professionalIds: bookingMode === 'joint' ? requestedProfessionalIds : [],
		date: url.searchParams.get('date') ?? '',
		datesFrom: url.searchParams.get('dates_from') ?? ''
	};
	// Las reservas no pueden servirse desde cachés compartidas: el catálogo y,
	// especialmente, los horarios deben reflejar disponibilidad viva.
	setHeaders({ 'cache-control': 'no-store' });

	if (env.DEMO_MODE === 'true') {
		return {
			state: {
				business: {
					id: 'demo-business',
					name: 'Consultorio demo',
					slug: 'consultorio-demo',
					phone: '351 555 0101',
					address: 'Av. Demo 123',
					logo_url: null,
					timezone: 'America/Argentina/Cordoba',
					public_booking_enabled: true,
					is_active: true,
					min_booking_notice_minutes: 0,
					max_booking_days_ahead: 30,
					cancellation_policy: null
				},
				services: [
					{ id: 'demo-consulta', name: 'Consulta', description: 'Evaluación inicial.', duration_minutes: 30, price_label: null },
					{ id: 'demo-limpieza', name: 'Limpieza', description: 'Control y limpieza dental.', duration_minutes: 45, price_label: null }
				],
				professionals: [
					{ id: 'demo-dra-perez', name: 'Dra. Pérez', specialty: 'Odontología general', avatar_url: null }
				],
				slots: [],
				days: [],
				issue: null
			},
			selected,
			mapsLink: resolveMapsUrl({ address: 'Av. Demo 123' }),
			turnstileSiteKey: null,
			bookingRequestId,
			demo: true
		};
	}

	try {
		const supabase = await createSupabaseAdminClient('odonto', fetch);
		const recoveryCheckId = integration ? await recoverIntegratedBooking(supabase, url, integration, entryPoint) : undefined;
		if (integration && !integration.isActive) return {
			state: { business: null, services: [], professionals: [], days: [], slots: [], issue: 'integration_unavailable' },
			selected, mapsLink: null, turnstileSiteKey: null, bookingRequestId, recoveryCheckId,
			integration: { publicKey: integration.publicKey, revision: integration.revision },
			presentation: { ...bookingPresentation(integration), theme: entryPoint === 'public_page' ? 'cita-suite' as const : integration.theme }, demo: false
		};
		const state = await loadPublicBookingState(supabase, {
			modality: integration ? (integration.modalities.find(modality => modality === url.searchParams.get('modality')) ?? integration.modalities[0]) : undefined,
			modalityWindows: integration?.modalityWindows,
			slug: integration?.businessId ?? params.businessSlug ?? '',
			serviceId: selected.serviceId,
			professionalId: selected.professionalId,
			professionalIds: selected.professionalIds,
			bookingMode: selected.bookingMode,
			date: selected.date,
			datesFrom: selected.datesFrom,
			scope: integration ? { serviceIds: integration.serviceIds, professionalIds: integration.professionalIds } : undefined
		});

		if (integration && framed && integration.theme === 'natalia' && integration.professionalIds.length === 1 && selected.serviceId && selected.bookingMode === 'individual' && !selected.professionalId && state.professionals.length === 1) {
            const next = new URL(url);
            next.searchParams.set('professional_id', state.professionals[0].id);
            next.searchParams.set('request_id', bookingRequestId);
            throw redirect(303, next.pathname + next.search);
        }

		if ((!integration || entryPoint === 'public_page') && state.business && params.businessSlug !== state.business.id) {
			throw redirect(302, `/reservar/${state.business.id}${url.search}`);
		}

        if (state.business && state.services.length) {
            const { data: labels, error: labelError } = await supabase.rpc('get_public_service_price_labels', {
                p_business_id: state.business.id, p_service_ids: integration?.serviceIds ?? [], p_professional_ids: integration?.professionalIds ?? []
            });
            if (labelError) throw labelError;
            const byId = parseServicePriceLabels(labels);
            for (const service of state.services) {
                const label = byId.get(service.id);
                if (label !== undefined) service.price_label = label;
            }
        }
        const patientFields = bookingInformationEnabled() && state.business && (selected.professionalId || selected.professionalIds.length)
            ? await loadProfessionalBookingSchema(supabase, state.business.id, selected.professionalId ? [selected.professionalId] : selected.professionalIds, integration?.id, bookingRequestId) : null;
		let priceQuote: PriceQuote | null = null;
        if (state.business && state.days.some(day=>day.date===selected.date) && selected.serviceId && selected.date && (selected.professionalId || selected.professionalIds.length)) {
            const { data: quote, error: quoteError } = await supabase.rpc('get_public_service_price_quote', { p_business_id: state.business.id, p_service_id: selected.serviceId, p_professional_ids: selected.professionalId ? [selected.professionalId] : selected.professionalIds, p_date: selected.date });
            if (quoteError) throw quoteError;
            priceQuote = parsePriceQuote(quote);
        }
        return {
            priceQuote,
            patientFields,
			state,
			selected,
			mapsLink: state.business
				? resolveMapsUrl({ address: state.business.address, maps_url: state.business.maps_url })
				: null,
			turnstileSiteKey: publicEnv.PUBLIC_TURNSTILE_SITE_KEY ?? null,
			bookingRequestId,
			recoveryCheckId,
			integration: integration ? { publicKey: integration.publicKey, revision: integration.revision } : null,
			presentation: integration ? { ...bookingPresentation(integration), compact: framed && integration.theme === 'natalia' && integration.professionalIds.length === 1 } : null,
			demo: false
		};
	} catch (error) {
		if (isRedirect(error)) throw error;
		logServerFailure('Error cargando reserva publica', error);
		return {
			state: {
				business: null,
				services: [],
				professionals: [],
				slots: [],
				days: [],
				issue: 'missing_service_role'
			},
			selected: {
				serviceId: '',
				bookingMode: 'individual' as const,
				professionalId: '',
				professionalIds: [],
				date: ''
			},
			mapsLink: null,
			turnstileSiteKey: null,
			bookingRequestId,
			integration: integration ? { publicKey: integration.publicKey, revision: integration.revision } : null,
			presentation: integration ? { ...bookingPresentation(integration), compact: framed && integration.theme === 'natalia' && integration.professionalIds.length === 1 } : null,
			demo: false
		};
	}
};

export const submitPublicBookingPage = async ({ request, params, fetch, url, getClientAddress }: RequestEvent, integration?: BookingIntegration, entryPoint: 'embedded' | 'public_page' = 'embedded') => {
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'La demo no crea turnos reales.' });

		let form: FormData;
		try { form = integration || bookingInformationEnabled() ? await readBoundedBookingForm(request) : await request.formData(); }
		catch { return fail(400, { message: 'No pudimos leer los datos de la reserva. Revisá el formulario y volvé a intentar.' }); }
		const serviceId = String(form.get('service_id') ?? '').trim();
		const requestedProfessionalIds = [
			...new Set(
				[
					...form.getAll('professional_ids').flatMap((value) => String(value).split(',')),
					String(form.get('professional_id') ?? '')
				]
					.map((value) => value.trim())
					.filter(Boolean)
			)
		];
		const bookingMode =
			String(form.get('booking_mode') ?? '').trim() === 'joint' ||
			requestedProfessionalIds.length > 1
				? 'joint'
				: 'individual';
		const professionalIds =
			bookingMode === 'joint' ? requestedProfessionalIds : requestedProfessionalIds.slice(0, 1);
		const professionalId = professionalIds[0] ?? '';
		const slotStartsAt = String(form.get('slot_starts_at') ?? '').trim();
		const rawPatientName = String(form.get('patient_name') ?? '');
		const patientName = normalizePatientFullName(rawPatientName);
		const patientPhone = String(form.get('patient_phone') ?? '').trim();
		const patientEmail = String(form.get('patient_email') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();
		const turnstileToken = String(form.get('cf-turnstile-response') ?? '').trim();
		const idempotencyKey = String(form.get('idempotency_key') ?? '').trim();
		const userAgent = request.headers.get('user-agent') ?? null;
		const ip = getClientAddress();

		if (!serviceId || !slotStartsAt) {
			return fail(400, {
				message:
					'Falta el procedimiento o el horario. Volvé al inicio de la reserva, completá todos los pasos y elegí una de las opciones mostradas.',
				values: valuesFromForm(form)
			});
		}
		if (bookingMode === 'joint' && professionalIds.length < 2) {
			return fail(400, {
				message:
					'Para reservar con un equipo, seleccioná por lo menos dos profesionales diferentes y buscá nuevamente los días disponibles.',
				values: valuesFromForm(form)
			});
		}
		if (bookingMode === 'individual' && !professionalId) {
			return fail(400, {
				message:
					'Falta elegir el profesional. Volvé al segundo paso, seleccioná quién realizará el procedimiento y elegí nuevamente el horario.',
				values: valuesFromForm(form)
			});
		}
		const patientNameError = patientFullNameErrorMessage(rawPatientName);
		if (patientNameError) {
			return fail(400, {
				message: patientNameError,
				values: { ...valuesFromForm(form), patient_name: patientName }
			});
		}
		if (
			!isUuid(idempotencyKey)
		) {
			return fail(400, {
				message:
					'La sesión de reserva venció. Recargá la página, elegí nuevamente el horario y confirmá tus datos.',
				values: valuesFromForm(form)
			});
		}

		try {
			if ((integration || bookingInformationEnabled()) && (!isUuid(serviceId) || professionalIds.some((id) => !isUuid(id)) || slotStartsAt.length > 35 || !Number.isFinite(new Date(slotStartsAt).getTime()))) throw new Error('BOOKING_FORM_INVALID');
			if ((integration || bookingInformationEnabled()) && (rawPatientName.length > 200 || patientPhone.length > 50 || patientEmail.length > 254 || note.length > 2000 || professionalIds.length > 16)) throw new Error('BOOKING_FORM_INVALID');
			const modality = String(form.get('modality') ?? '');
			const selectedModality = integration ? assertIntegrationSelection(integration, { serviceId, professionalIds, modality }) : null;
			const supabase = await createSupabaseAdminClient('odonto', fetch);
            let patientSchema;
            if (bookingInformationEnabled()) {
                let businessId = integration?.businessId;
                if (!businessId) {
                    const lookup = await supabase.from('businesses').select('id').eq(isUuid(params.businessSlug) ? 'id' : 'slug', params.businessSlug ?? '').maybeSingle();
                    if (lookup.error || !lookup.data) throw new Error('PUBLIC_BOOKING_UNAVAILABLE');
                    businessId = lookup.data.id;
                }
                patientSchema = await loadProfessionalBookingSchema(supabase, businessId!, professionalIds, integration?.id, idempotencyKey);
            }
            const intakeAnswers = patientSchema ? intakeAnswersFromForm({ intakeFields: patientSchema.fields }, form) : integration ? intakeAnswersFromForm(integration, form) : undefined;
			const integrationRevision = Number(form.get('integration_revision'));
			if (integration && (!Number.isSafeInteger(integrationRevision) || integrationRevision < 1)) throw new Error('BOOKING_INTEGRATION_CHANGED');
			await verifyTurnstileIfConfigured({
				secret: env.TURNSTILE_SECRET_KEY,
				token: turnstileToken,
				remoteIp: ip,
				fetchImpl: fetch
			});

			const result = await createPublicBooking(supabase, {
				slug: integration?.businessId ?? params.businessSlug ?? '',
				serviceId,
				professionalId,
				professionalIds,
				bookingMode,
				slotStartsAt,
				patientName,
				patientPhone,
				patientEmail,
				note,
				idempotencyKey,
				ipHash: publicHash(ip),
				userAgent,
                bookingInformation: patientSchema ? { schemaHash: String(form.get('patient_schema_hash') ?? ''), answers: intakeAnswers!, priceQuoteHash: String(form.get('price_quote_hash') ?? '') } : undefined,
				bookingIntegration: integration && selectedModality ? {
					integrationId: integration.id, integrationRevision, entryPoint,
					modalityWindows: integration.modalityWindows,
					modality: selectedModality,
					intakeAnswers: intakeAnswers!
				} : undefined
			});
			if (integration && entryPoint === 'embedded' && url.searchParams.has('parent_origin') && url.searchParams.has('instance_id')) {
				const context = new URLSearchParams();
				for (const key of ['parent_origin', 'instance_id']) {
					const value = url.searchParams.get(key);
					if (value) context.set(key, value);
				}
				context.set('creado', '1');
				throw redirect(303, '/embed/v1/' + integration.publicKey + '/turno/' + result.appointment.confirmation_token + '?' + context);
			}
			throw redirect(303, `/turno/${result.appointment.confirmation_token}?creado=1`);
		} catch (error) {
			if (isRedirect(error)) throw error;
			const integrationMessage = integratedBookingErrorMessage(error);
			if (integration) logServerFailure('Error creando reserva integrada', { code: getPublicBookingErrorCode(error) });
			else logServerFailure('Error creando reserva publica', error);
			return fail(400, {
				message: publicErrorMessage(error).includes('PRICE_') ? 'El arancel cambió mientras reservabas. Actualizá la página, revisá el precio para tu fecha y confirmá nuevamente.' : /BOOKING_(INFORMATION|PROFILE|INTAKE)/.test(publicErrorMessage(error)) ? informationErrorMessage(error) : integrationMessage ?? getPublicBookingErrorMessage(error),
				uncertain: Boolean(!/PRICE_|SCHEDULE_SERVICE|SCHEDULE_BLOCKED/.test(publicErrorMessage(error)) && integration && ((!integrationMessage && getPublicBookingErrorCode(error) === 'PUBLIC_BOOKING_UNEXPECTED') || publicErrorMessage(error).includes('APPOINTMENT_IDEMPOTENCY_CONFLICT'))),
				values: valuesFromForm(form)
			});
		}
};


const publicErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : isRecord(cause) && typeof cause.message === 'string' ? cause.message : '';
