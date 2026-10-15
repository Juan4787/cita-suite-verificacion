import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	isValidPatientFullName,
	normalizePatientFullName,
	normalizePatientNameForComparison,
	PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE,
	PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE
} from '$lib/utils/patient-name';
import type { Business } from './business';
import {
	addMinutes,
	calculateAvailabilitySlots,
	getAvailabilitySlots,
	zonedDateTimeToUtc,
	type AvailabilityAppointmentBlockRow,
	type AvailabilityExceptionRow,
	type AvailabilityProfessionalRow,
	type AvailabilityRuleRow,
	type AvailabilityServiceRow,
	type AvailabilitySlot
} from './availability';
import {
	createJointAppointment,
	createManualAppointment,
	findAppointmentCreationReplay
} from './appointments';
import {
	getBusinessAccessState,
	type BusinessSubscriptionRow
} from './commercial-access';
import { isLikelyPhoneE164, normalizePhoneE164 } from './phone';
import { sanitizePublicImageUrl } from './public-image';
import type { IntegratedBookingInput } from './booking-integrations';
import type { BookingModality, BookingModalityWindow } from '@turnos-saas/shared/booking-integration';
import { loadIntegratedAvailabilityRows } from './integrated-availability';

export type PublicService = {
	id: string;
	name: string;
	description: string | null;
	duration_minutes: number;
	price_label: string | null;
};

export type PublicProfessional = {
	id: string;
	name: string;
	specialty: string | null;
	avatar_url: string | null;
	next_available_at?: string | null;
};

export type PublicBookingMode = 'individual' | 'joint';

export type PublicBookingBusiness = Pick<
	Business,
	| 'id'
	| 'name'
	| 'slug'
	| 'phone'
	| 'address'
	| 'address_instructions'
	| 'maps_url'
	| 'logo_url'
	| 'timezone'
	| 'public_booking_enabled'
	| 'is_active'
	| 'created_at'
	| 'min_booking_notice_minutes'
	| 'max_booking_days_ahead'
	| 'cancellation_policy'
>;

export type PublicBookingIssue =
	| 'integration_unavailable'
	| 'business_not_found'
	| 'booking_disabled'
	| 'commercial_unavailable'
	| 'missing_service_role'
	| 'no_services'
	| 'no_professionals'
	| 'no_availability';

export type PublicBookingState = {
	business: PublicBookingBusiness | null;
	services: PublicService[];
	professionals: PublicProfessional[];
	slots: AvailabilitySlot[];
	days: Array<{ date: string; label: string; count: number }>;
	issue: PublicBookingIssue | null;
};

type PublicAvailabilityService = AvailabilityServiceRow & {
	description: string | null;
	price_label: string | null;
	sort_order: number;
};

type PublicAvailabilityProfessional = AvailabilityProfessionalRow & {
	specialty: string | null;
	avatar_url: string | null;
	sort_order: number;
};

type PublicAvailabilityRows = {
	services: PublicAvailabilityService[];
	professionals: PublicAvailabilityProfessional[];
	assignments: Array<{ service_id: string; professional_id: string }>;
	rules: AvailabilityRuleRow[];
	exceptions: AvailabilityExceptionRow[];
	blocks: AvailabilityAppointmentBlockRow[];
};

type PublicAvailabilitySnapshot = PublicAvailabilityRows & {
	fromDate: string;
	toDate: string;
};

type BookingAttemptInput = {
	businessId?: string | null;
	phoneE164?: string | null;
	ipHash?: string | null;
	action: 'booking_create' | 'token_confirm' | 'token_cancel' | 'token_reschedule';
	success: boolean;
	errorCode?: string | null;
	userAgent?: string | null;
	metadata?: Record<string, unknown> | null;
};

export const PUBLIC_BUSINESS_SELECT =
	'id, name, slug, phone, address, address_instructions, maps_url, logo_url, timezone, public_booking_enabled, is_active, created_at, min_booking_notice_minutes, max_booking_days_ahead, cancellation_policy, booking_availability_revision';

export const PUBLIC_ACTIVE_FUTURE_APPOINTMENT_LIMIT = 4;

const pad = (value: number) => String(value).padStart(2, '0');

export const localDateParts = (date: Date, timeZone: string) => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

export const addDaysToDateString = (date: string, days: number) => {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
};

export const todayForBusiness = (business: Pick<Business, 'timezone'>) =>
	localDateParts(new Date(), business.timezone);

export const publicHash = (value?: string | null) => {
	const normalized = String(value ?? '').trim();
	if (!normalized) return null;
	return crypto.createHash('sha256').update(normalized).digest('hex');
};

const hasVisibleProfessionalName = (professional: { name?: unknown } | null | undefined) =>
	String(professional?.name ?? '').trim().length > 0;

export const recordPublicBookingAttempt = async (
	supabase: SupabaseClient,
	input: BookingAttemptInput
) => {
	const { error } = await supabase.from('public_booking_attempts').insert({
		business_id: input.businessId ?? null,
		phone_e164: input.phoneE164 ?? null,
		ip_hash: input.ipHash ?? null,
		action: input.action,
		success: input.success,
		error_code: input.errorCode ?? null,
		user_agent: input.userAgent?.slice(0, 500) ?? null,
		metadata: input.metadata ?? null
	});

	if (error) {
		console.error('Error registrando intento publico', error);
	}
};

const countPublicAttempts = async (
	supabase: SupabaseClient,
	input: {
		businessId?: string | null;
		phoneE164?: string | null;
		ipHash?: string | null;
		action: BookingAttemptInput['action'];
		since: Date;
	}
) => {
	let query = supabase
		.from('public_booking_attempts')
		.select('id', { count: 'exact', head: true })
		.eq('action', input.action)
		.gte('created_at', input.since.toISOString());

	if (input.businessId) query = query.eq('business_id', input.businessId);
	if (input.phoneE164) query = query.eq('phone_e164', input.phoneE164);
	if (input.ipHash) query = query.eq('ip_hash', input.ipHash);

	const { count, error } = await query;
	if (error) throw error;
	return count ?? 0;
};

export const getPublicBusinessBySlug = async (
	supabase: SupabaseClient,
	slug: string
): Promise<PublicBookingBusiness | null> => {
	const isBusinessId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug);
	const { data, error } = await supabase
		.from('businesses')
		.select(PUBLIC_BUSINESS_SELECT)
		.eq(isBusinessId ? 'id' : 'slug', slug)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return {
		...(data as PublicBookingBusiness),
		logo_url: sanitizePublicImageUrl((data as PublicBookingBusiness).logo_url)
	};
};

export const canUsePublicBusiness = async (
	supabase: SupabaseClient,
	businessId: string,
	businessCreatedAt?: string | null
) => {
	const { data, error } = await supabase
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at, expiration_notice_enabled'
		)
		.eq('business_id', businessId)
		.maybeSingle();

	if (error) {
		// No se puede habilitar una mutación pública cuando el estado comercial es
		// desconocido. Un fallback afirmativo convertiría un timeout de Supabase en
		// una reserva o una acción sobre un turno que debería estar bloqueado.
		console.error('Error cargando acceso comercial público', error);
		return false;
	}

	return getBusinessAccessState((data as BusinessSubscriptionRow | null) ?? null, {
		businessCreatedAt
	}).allowedCapabilities.canUsePublicBooking;
};

const getPublicBusinessSubscription = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<{ subscription: BusinessSubscriptionRow | null; lookupFailed: boolean }> => {
	const { data, error } = await supabase
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, paid_until, grace_until, restricted_until, archived_at, expiration_notice_enabled'
		)
		.eq('business_id', businessId)
		.maybeSingle();
	if (error) {
		// El estado comercial desconocido debe bloquear la reserva pública. La
		// ausencia de una fila, en cambio, sigue usando el fallback histórico por
		// fecha de creación en getBusinessAccessState.
		console.error('Error cargando acceso comercial público', error);
		return { subscription: null, lookupFailed: true };
	}
	return {
		subscription: (data as BusinessSubscriptionRow | null) ?? null,
		lookupFailed: false
	};
};

export const getReservableServices = async (
	supabase: SupabaseClient,
	businessId: string,
	scope?: { serviceIds: string[]; professionalIds: string[] }
): Promise<PublicService[]> => {
	const [
		{ data: services, error: servicesError },
		{ data: professionals, error: professionalsError },
		{ data: assignments, error: assignmentsError },
		{ data: rules, error: rulesError }
	] =
		await Promise.all([
			supabase
				.from('services')
				.select('id, name, description, duration_minutes, price_label, is_active, is_public, sort_order')
				.eq('business_id', businessId)
				.eq('is_active', true)
				.eq('is_public', true)
				.order('sort_order')
				.order('name'),
			supabase
				.from('professionals')
				.select('id, name, is_active, is_public')
				.eq('business_id', businessId)
				.eq('is_active', true)
				.eq('is_public', true),
			supabase
				.from('professional_services')
				.select('service_id, professional_id')
				.eq('business_id', businessId),
			supabase
				.from('availability_rules')
				.select('professional_id')
				.eq('business_id', businessId)
				.eq('is_active', true)
		]);
	if (servicesError) throw servicesError;
	if (professionalsError) throw professionalsError;
	if (assignmentsError) throw assignmentsError;
	if (rulesError) throw rulesError;

	const scheduledProfessionalIds = new Set(
		(rules ?? []).map((rule: any) => String(rule.professional_id))
	);
	const publicScheduledProfessionalIds = new Set(
		(professionals ?? [])
			.filter(
				(professional: any) =>
					hasVisibleProfessionalName(professional) &&
					(!scope?.professionalIds.length || scope.professionalIds.includes(String(professional.id))) &&
					scheduledProfessionalIds.has(String(professional.id))
			)
			.map((professional: any) => String(professional.id))
	);
	const reservableServiceIds = new Set(
		(assignments ?? [])
			.filter((assignment: any) =>
				publicScheduledProfessionalIds.has(String(assignment.professional_id))
			)
			.map((assignment: any) => String(assignment.service_id))
	);

	return (services ?? [])
		.filter((service: any) => reservableServiceIds.has(String(service.id)) &&
			(!scope?.serviceIds.length || scope.serviceIds.includes(String(service.id))))
		.map((service: any) => ({
			id: String(service.id),
			name: String(service.name),
			description: service.description ?? null,
			duration_minutes: Number(service.duration_minutes),
			price_label: service.price_label ?? null
		}));
};

export const getReservableProfessionals = async (
	supabase: SupabaseClient,
	input: { businessId: string; serviceId: string }
): Promise<PublicProfessional[]> => {
	const [
		{ data, error },
		{ data: rules, error: rulesError }
	] = await Promise.all([
		supabase
			.from('professional_services')
			.select(
				'professional_id, professionals!inner(id, name, specialty, avatar_url, is_active, is_public, sort_order)'
			)
			.eq('business_id', input.businessId)
			.eq('service_id', input.serviceId),
		supabase
			.from('availability_rules')
			.select('professional_id')
			.eq('business_id', input.businessId)
			.eq('is_active', true)
	]);
	if (error) throw error;
	if (rulesError) throw rulesError;
	const scheduledProfessionalIds = new Set(
		(rules ?? []).map((rule: any) => String(rule.professional_id))
	);

	return (data ?? [])
		.map((row: any) => row.professionals)
		.filter(
			(professional: any) =>
				professional?.is_active &&
				professional?.is_public &&
				hasVisibleProfessionalName(professional) &&
				scheduledProfessionalIds.has(String(professional.id))
		)
		.sort(
			(a: any, b: any) =>
				Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
				String(a.name).localeCompare(String(b.name))
		)
		.map((professional: any) => ({
			id: String(professional.id),
			name: String(professional.name).trim(),
			specialty: professional.specialty ?? null,
			avatar_url: sanitizePublicImageUrl(professional.avatar_url)
		}));
};

export const summarizeSlotsByDate = (
	slots: AvailabilitySlot[],
	timeZone: string
): Array<{ date: string; label: string; count: number }> => {
	const counts = new Map<string, number>();
	for (const slot of slots) counts.set(slot.date, (counts.get(slot.date) ?? 0) + 1);
	const formatter = new Intl.DateTimeFormat('es-AR', {
		timeZone,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, count]) => ({
			date,
			count,
			label: formatter
				.format(new Date(`${date}T12:00:00.000Z`))
				.replace(',', '')
				.replace(/^./, (letter) => letter.toUpperCase())
		}));
};

// El rango público ya está acotado a 90 días. Consultarlo completo en una sola
// tanda evita hasta seis rondas consecutivas a Supabase cuando un profesional
// tiene pocos horarios, sin aumentar la cantidad de turnos finalmente enviados
// al navegador.
const uniqueSlots = (slots: AvailabilitySlot[]) => {
	const seen = new Set<string>();
	const result: AvailabilitySlot[] = [];
	for (const slot of slots) {
		const key = `${slot.professional_id}:${slot.starts_at}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(slot);
	}
	return result;
};

// ---------------------------------------------------------------------------
// Caché en memoria de los escaneos de disponibilidad pública.
//
// El flujo de reserva navega 4-5 veces la misma URL (servicio → profesional →
// día → horario) y cada navegación recomputaba TODOS los escaneos (varios
// round-trips a Supabase). `cachedScan` conserva la deduplicación de requests
// simultáneos, pero no persiste resultados de disponibilidad entre requests:
// un reload puede caer en otro isolate de Cloudflare y nunca debe volver a
// mostrar un horario que acaba de ocuparse.
//
// El catálogo y el estado comercial tampoco se cachean: un cambio de servicio,
// profesional o suscripción debe ser visible inmediatamente en un entorno con
// varias instancias de Cloudflare Workers.
// ---------------------------------------------------------------------------

const SLOT_SCAN_CACHE_TTL_MS = 0;
const STRUCTURE_SCAN_CACHE_TTL_MS = 0;
const SCAN_CACHE_MAX_ENTRIES = 500;

type ScanCacheEntry = {
	value?: unknown;
	promise?: Promise<unknown>;
	expiresAt: number;
};
const scanCache = new Map<string, ScanCacheEntry>();

export const clearPublicBookingScanCache = () => scanCache.clear();

// Tras crear una reserva, los escaneos cacheados del negocio quedan viejos
// (el slot tomado seguiría visible hasta vencer el TTL en esta instancia).
export const invalidatePublicBookingScans = (businessId: string) => {
	for (const key of scanCache.keys()) {
		if (key.includes(`:${businessId}:`) || key.endsWith(`:${businessId}`)) {
			scanCache.delete(key);
		}
	}
};

const cachedScan = async <T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> => {
	const now = Date.now();
	const hit = scanCache.get(key);
	if (hit?.promise) return (await hit.promise) as T;
	if (hit && hit.expiresAt > now && 'value' in hit) return hit.value as T;
	if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) {
		for (const [entryKey, entry] of scanCache) {
			if (entry.expiresAt <= now) scanCache.delete(entryKey);
		}
		if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) scanCache.clear();
	}
	const promise = compute();
	scanCache.set(key, { promise, expiresAt: Number.POSITIVE_INFINITY });
	try {
		const value = await promise;
		if (scanCache.get(key)?.promise === promise) {
			scanCache.set(key, { value, expiresAt: Date.now() + ttlMs });
		}
		return value;
	} catch (error) {
		if (scanCache.get(key)?.promise === promise) scanCache.delete(key);
		throw error;
	}
};

const loadPublicAvailabilitySnapshot = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		modality?: BookingModality;
		serviceId: string;
		professionalIds: string[];
		rangeStart: Date;
		rangeEnd: Date;
	}
): Promise<PublicAvailabilityRows> => {
	const professionalIds = [...new Set(input.professionalIds.map((id) => id.trim()).filter(Boolean))];
	if (professionalIds.length === 0) {
		return { services: [], professionals: [], assignments: [], rules: [], exceptions: [], blocks: [] };
	}
	if (input.modality) return loadIntegratedAvailabilityRows(supabase, { ...input, professionalIds });

	// Estas lecturas son independientes y se ejecutan en una sola ola, pero ya
	// no descargan la agenda completa del consultorio: sólo el procedimiento y
	// los profesionales elegidos por el paciente.
	// Los turnos se parten en ventanas mensuales para no truncarse en el límite de
	// 1.000 filas de PostgREST en consultorios de alto volumen.
	const appointmentWindows: Array<{ start: Date; end: Date }> = [];
	for (
		let start = new Date(input.rangeStart);
		start < input.rangeEnd;
		start = addMinutes(start, 31 * 24 * 60)
	) {
		appointmentWindows.push({
			start,
			end: new Date(
				Math.min(addMinutes(start, 31 * 24 * 60).getTime(), input.rangeEnd.getTime())
			)
		});
	}
	const servicesQuery = supabase
		.from('services')
		.select(
			'id, business_id, name, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_label, is_public, is_active, sort_order'
		)
		.eq('business_id', input.businessId)
		.eq('id', input.serviceId)
		.eq('is_active', true)
		.eq('is_public', true);
	const professionalsQuery = supabase
		.from('professionals')
		.select('id, name, specialty, avatar_url, is_public, is_active, sort_order')
		.eq('business_id', input.businessId)
		.in('id', professionalIds)
		.eq('is_active', true)
		.eq('is_public', true);
	const assignmentsQuery = supabase
		.from('professional_services')
		.select('service_id, professional_id')
		.eq('business_id', input.businessId)
		.eq('service_id', input.serviceId)
		.in('professional_id', professionalIds);
	const rulesQuery = supabase
		.from('availability_rules')
		.select(
			'id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, service_scope, rule_services:availability_rule_services(service_id)'
		)
		.eq('business_id', input.businessId)
		.in('professional_id', professionalIds)
		.eq('is_active', true);

	const [
		servicesResult,
		professionalsResult,
		assignmentsResult,
		rulesResult,
		exceptionsResult,
		blocksResults
	] = await Promise.all([
		servicesQuery,
		professionalsQuery,
		assignmentsQuery,
		rulesQuery,
		supabase
			.from('availability_exceptions')
			.select('id, professional_id, starts_at, ends_at, type, exception_services:availability_exception_services(service_id)')
			.eq('business_id', input.businessId)
			.lt('starts_at', input.rangeEnd.toISOString())
			.gt('ends_at', input.rangeStart.toISOString()),
		Promise.all(
			appointmentWindows.map(({ start, end }) =>
				supabase
					.from('appointment_professionals')
					.select(
						'id, appointment_id, professional_id, starts_at, ends_at, base_blocking_starts_at, base_blocking_ends_at, blocking_starts_at, blocking_ends_at'
						)
						.eq('business_id', input.businessId)
						.in('professional_id', professionalIds)
						.in('status', ['reserved', 'confirmed', 'reschedule_requested'])
					.lt('blocking_starts_at', end.toISOString())
					.gt('blocking_ends_at', start.toISOString())
			)
		)
	]);
	if (servicesResult.error) throw servicesResult.error;
	if (professionalsResult.error) throw professionalsResult.error;
	if (assignmentsResult.error) throw assignmentsResult.error;
	if (rulesResult.error) throw rulesResult.error;
	if (exceptionsResult.error) throw exceptionsResult.error;
	for (const blocksResult of blocksResults) {
		if (blocksResult.error) throw blocksResult.error;
	}

	const services = (servicesResult.data ?? []) as PublicAvailabilityService[];
	const professionals = ((professionalsResult.data ?? []) as PublicAvailabilityProfessional[]).filter(
		hasVisibleProfessionalName
	);
	const serviceIds = new Set(services.map((service) => service.id));
	const availableProfessionalIds = new Set(professionals.map((professional) => professional.id));
	const assignments = ((assignmentsResult.data ?? []) as Array<{
		service_id: string;
		professional_id: string;
	}>).filter(
		(assignment) =>
			serviceIds.has(assignment.service_id) &&
			availableProfessionalIds.has(assignment.professional_id)
	);

	const assignedProfessionalIds = new Set(
		assignments.map((assignment) => assignment.professional_id)
	);

	return {
		services,
		professionals,
		assignments,
		rules: ((rulesResult.data ?? []) as AvailabilityRuleRow[]).filter((rule) =>
			assignedProfessionalIds.has(rule.professional_id)
		),
		exceptions: ((exceptionsResult.data ?? []) as AvailabilityExceptionRow[]).filter(
			(exception) =>
				exception.professional_id === null ||
				assignedProfessionalIds.has(exception.professional_id)
		),
		blocks: [
			...new Map(
				blocksResults
					.flatMap((result) => (result.data ?? []) as AvailabilityAppointmentBlockRow[])
					.filter((block) => assignedProfessionalIds.has(block.professional_id))
					.map((block) => [block.id, block] as const)
			).values()
		]
	};
};

const slotsFromPublicSnapshot = (
	business: PublicBookingBusiness,
	snapshot: PublicAvailabilitySnapshot,
	input: {
		serviceId: string;
		modality?: BookingModality;
		modalityWindows?: BookingModalityWindow[];
		professionalId?: string | null;
		professionalIds?: string[];
		maxSlots?: number;
		maxSlotsPerDate?: number;
	}
) => {
	const service = snapshot.services.find((candidate) => candidate.id === input.serviceId);
	if (!service) return [];
	const requiredProfessionalIds = [
		...new Set((input.professionalIds ?? []).map((id) => id.trim()).filter(Boolean))
	];
	const assignedProfessionalIds = new Set(
		snapshot.assignments
			.filter((assignment) => assignment.service_id === input.serviceId)
			.map((assignment) => assignment.professional_id)
	);
	const professionals = snapshot.professionals.filter(
		(professional) =>
			assignedProfessionalIds.has(professional.id) &&
			(requiredProfessionalIds.length > 0
				? requiredProfessionalIds.includes(professional.id)
				: !input.professionalId || professional.id === input.professionalId)
	);
	const professionalIds = new Set(professionals.map((professional) => professional.id));
	return calculateAvailabilitySlots({
		modality: input.modality,
		modalityWindows: input.modalityWindows,
		business: business as Business,
		service,
		professionals,
		rules: snapshot.rules.filter((rule) => professionalIds.has(rule.professional_id)),
		exceptions: snapshot.exceptions.filter(
			(exception) =>
				exception.professional_id === null || professionalIds.has(exception.professional_id)
		),
		blocks: snapshot.blocks.filter((block) => professionalIds.has(block.professional_id)),
		fromDate: snapshot.fromDate,
		toDate: snapshot.toDate,
		publicOnly: true,
		requiredProfessionalIds,
		maxSlots: input.maxSlots,
		maxSlotsPerDate: input.maxSlotsPerDate
	});
};

export const loadPublicBookingState = async (
	supabase: SupabaseClient,
	input: {
		slug: string;
		modality?: BookingModality;
		modalityWindows?: BookingModalityWindow[];
		serviceId?: string | null;
		professionalId?: string | null;
		professionalIds?: string[] | null;
		bookingMode?: PublicBookingMode | null;
		date?: string | null;
		scope?: { serviceIds: string[]; professionalIds: string[] };
	}
): Promise<PublicBookingState> => {
	const normalizedSlug = input.slug.trim().toLowerCase();
	const businessIdFromSlug = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		normalizedSlug
	)
		? normalizedSlug
		: null;
	const loadBusiness = () =>
		cachedScan(`business-lookup:${normalizedSlug}`, STRUCTURE_SCAN_CACHE_TTL_MS, () =>
			getPublicBusinessBySlug(supabase, input.slug)
		);
	const loadAccess = (businessId: string) =>
		cachedScan(`commercial-access-row:${businessId}`, STRUCTURE_SCAN_CACHE_TTL_MS, () =>
			getPublicBusinessSubscription(supabase, businessId)
		);
	const loadServices = (businessId: string) =>
		cachedScan(`public-services:${businessId}:${input.scope ? JSON.stringify(input.scope) : ''}`, STRUCTURE_SCAN_CACHE_TTL_MS, () =>
			getReservableServices(supabase, businessId, input.scope)
		);
	const loadProfessionals = (businessId: string, serviceId: string) =>
		cachedScan(
			`public-professionals:${businessId}:${serviceId}`,
			STRUCTURE_SCAN_CACHE_TTL_MS,
			() => getReservableProfessionals(supabase, { businessId, serviceId })
		);

	let business: PublicBookingBusiness | null;
	let accessLookup: Awaited<ReturnType<typeof getPublicBusinessSubscription>> | null = null;
	let services: PublicService[] = [];
	let professionals: PublicProfessional[] = [];
	if (businessIdFromSlug) {
		// Los links generados usan UUID: catálogo, acceso y negocio arrancan en
		// paralelo. La agenda pesada no se consulta hasta que el paciente elige
		// un profesional o un equipo completo.
		[business, accessLookup, services, professionals] = await Promise.all([
			loadBusiness(),
			loadAccess(businessIdFromSlug),
			loadServices(businessIdFromSlug),
			input.serviceId
				? loadProfessionals(businessIdFromSlug, input.serviceId)
				: Promise.resolve([])
		]);
	} else {
		business = await loadBusiness();
		if (business) {
			[accessLookup, services, professionals] = await Promise.all([
				loadAccess(business.id),
				loadServices(business.id),
				input.serviceId
					? loadProfessionals(business.id, input.serviceId)
					: Promise.resolve([])
			]);
		}
	}
	if (!business) {
		return { business: null, services: [], professionals: [], slots: [], days: [], issue: 'business_not_found' };
	}
	if (!business.is_active || !business.public_booking_enabled) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'booking_disabled' };
	}

	const today = todayForBusiness(business);
	const maxDate = addDaysToDateString(
		today,
		Math.min(Math.max(business.max_booking_days_ahead, 1), 90)
	);
	const commerciallyUsable = Boolean(
		!accessLookup?.lookupFailed &&
			getBusinessAccessState(accessLookup?.subscription ?? null, {
				businessCreatedAt: business.created_at
			}).allowedCapabilities.canUsePublicBooking
	);
	if (!commerciallyUsable) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'commercial_unavailable' };
	}
	if (input.scope) {
		if (input.scope.serviceIds.length) services = services.filter((service) => input.scope!.serviceIds.includes(service.id));
		if (input.scope.professionalIds.length) professionals = professionals.filter((professional) => input.scope!.professionalIds.includes(professional.id));
	}
	if (services.length === 0) {
		return { business, services: [], professionals: [], slots: [], days: [], issue: 'no_services' };
	}

	const selectedService = services.find((service) => service.id === input.serviceId) ?? null;
	if (!selectedService) {
		return { business, services, professionals: [], slots: [], days: [], issue: null };
	}
	if (selectedService && professionals.length === 0) {
		return { business, services, professionals, slots: [], days: [], issue: 'no_professionals' };
	}

	const requestedProfessionalIds = [
		...new Set((input.professionalIds ?? []).map((id) => String(id).trim()).filter(Boolean))
	];
	const bookingMode: PublicBookingMode =
		input.bookingMode === 'joint' || requestedProfessionalIds.length > 1 ? 'joint' : 'individual';
	const selectedProfessionalIds =
		bookingMode === 'joint'
			? requestedProfessionalIds
			: input.professionalId
				? [String(input.professionalId).trim()]
				: [];
	const professionalsById = new Map(professionals.map((professional) => [professional.id, professional]));
	const selectedProfessionals = selectedProfessionalIds
		.map((professionalId) => professionalsById.get(professionalId))
		.filter((professional): professional is PublicProfessional => Boolean(professional));
	const completeSelection =
		bookingMode === 'joint'
			? selectedProfessionalIds.length >= 2 &&
				selectedProfessionals.length === selectedProfessionalIds.length
			: selectedProfessionalIds.length === 1 && selectedProfessionals.length === 1;
	if (!completeSelection) {
		return { business, services, professionals, slots: [], days: [], issue: null };
	}

	const selectedDate = String(input.date ?? '').trim();
	const selectedDateIsValid =
		!selectedDate ||
		(/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) &&
			selectedDate >= today &&
			selectedDate <= maxDate);
	if (!selectedDateIsValid) {
		return { business, services, professionals, slots: [], days: [], issue: 'no_availability' };
	}
	const scanFromDate = selectedDate || today;
	const scanToDate = selectedDate || maxDate;
	const rangeStart = zonedDateTimeToUtc(scanFromDate, '00:00', business.timezone);
	const rangeEnd = zonedDateTimeToUtc(
		addDaysToDateString(scanToDate, 1),
		'00:00',
		business.timezone
	);
	const selectionCacheKey = selectedProfessionalIds.join(',');
	const availabilityRows = await cachedScan(
		`availability-rows:${business.id}:${(business as any).booking_availability_revision??0}:${selectedService.id}:${selectionCacheKey}:${scanFromDate}:${scanToDate}:${input.modality ?? ''}`,
		SLOT_SCAN_CACHE_TTL_MS,
		() =>
			loadPublicAvailabilitySnapshot(supabase, {
				businessId: business.id,
				modality: input.modality,
				serviceId: selectedService.id,
				professionalIds: selectedProfessionalIds,
				rangeStart,
				rangeEnd
			})
	);
	const availabilitySnapshot: PublicAvailabilitySnapshot = {
		...availabilityRows,
		fromDate: scanFromDate,
		toDate: scanToDate
	};
	const calculatedSlots = uniqueSlots(
		slotsFromPublicSnapshot(business, availabilitySnapshot, {
			modality: input.modality,
			modalityWindows: input.modalityWindows,
			serviceId: selectedService.id,
			professionalId: bookingMode === 'individual' ? selectedProfessionalIds[0] : null,
			professionalIds: bookingMode === 'joint' ? selectedProfessionalIds : [],
			// Para listar días sólo hace falta saber si existe al menos una
			// opción. El día elegido se recalcula completo en la siguiente carga.
			maxSlotsPerDate: selectedDate ? undefined : 1
		})
	);
	const slots = selectedDate ? calculatedSlots : [];
	const days = summarizeSlotsByDate(calculatedSlots, business.timezone);

	return {
		business,
		services,
		professionals,
		slots,
		days,
		issue: days.length === 0 ? 'no_availability' : null
	};
};

export const verifyTurnstileIfConfigured = async (input: {
	secret?: string | null;
	token?: string | null;
	remoteIp?: string | null;
	fetchImpl?: typeof fetch;
}) => {
	const secret = input.secret?.trim();
	if (!secret) return;
	const token = input.token?.trim();
	if (!token) throw new Error('PUBLIC_CAPTCHA_REQUIRED');

	const body = new URLSearchParams();
	body.set('secret', secret);
	body.set('response', token);
	if (input.remoteIp) body.set('remoteip', input.remoteIp);

	const response = await (input.fetchImpl ?? fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		body
	});
	const payload = (await response.json().catch(() => null)) as { success?: boolean } | null;
	if (!response.ok || !payload?.success) throw new Error('PUBLIC_CAPTCHA_FAILED');
};

const assertPublicBookingRateLimits = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		phoneE164: string;
		ipHash: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const ipAttempts = input.ipHash
		? await countPublicAttempts(supabase, {
				action: 'booking_create',
				ipHash: input.ipHash,
				since: addMinutes(now, -10)
			})
		: 0;
	if (ipAttempts >= 3) throw new Error('PUBLIC_RATE_LIMIT_IP');

	const phoneAttempts = await countPublicAttempts(supabase, {
		action: 'booking_create',
		businessId: input.businessId,
		phoneE164: input.phoneE164,
		since: addMinutes(now, -30)
	});
	if (phoneAttempts >= 5) throw new Error('PUBLIC_RATE_LIMIT_PHONE');
};

export const assertPublicBookingPatientPolicy = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		patientName: string;
		phoneE164: string;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const { data: phoneMatches, error: patientError } = await supabase
		.from('patients')
		.select('id, full_name, blocked')
		.eq('business_id', input.businessId)
		.eq('phone_e164', input.phoneE164)
		.is('archived_at', null);
	if (patientError) throw patientError;
	const normalizedName = normalizePatientNameForComparison(input.patientName);
	const exactMatches = (phoneMatches ?? []).filter(
		(patient: { full_name?: string | null }) =>
			normalizePatientNameForComparison(String(patient.full_name ?? '')) === normalizedName
	);
	// Zero or several matches are intentionally ambiguous. The atomic creation
	// RPC will create a new row; it must never select an arbitrary first result.
	// The contact bucket below is anti-abuse only and does not resolve identity.
	const patient =
		exactMatches.length === 1 ? (exactMatches[0] as { id: string; blocked?: boolean }) : null;
	if (patient?.blocked) throw new Error('PUBLIC_BOOKING_BLOCKED_PATIENT');

	const { data: count, error } = await supabase.rpc(
		'get_public_booking_active_future_count_for_request',
		{
			p_business_id: input.businessId,
			p_patient_id: patient?.id ?? null,
			p_patient_name: input.patientName,
			p_phone_e164: input.phoneE164,
			p_now: now.toISOString()
		}
	);
	if (error) throw error;
	if (Number(count ?? 0) >= PUBLIC_ACTIVE_FUTURE_APPOINTMENT_LIMIT) {
		throw new Error('PUBLIC_BOOKING_ACTIVE_LIMIT');
	}
};

export const createPublicBooking = async (
	supabase: SupabaseClient,
	input: {
		slug: string;
		serviceId: string;
		professionalId?: string | null;
		professionalIds?: string[] | null;
		bookingMode?: PublicBookingMode | null;
		slotStartsAt: string;
		patientName: string;
		patientPhone: string;
		patientEmail?: string | null;
		note?: string | null;
		ipHash?: string | null;
		userAgent?: string | null;
		idempotencyKey: string;
		now?: Date;
		bookingIntegration?: IntegratedBookingInput;
        bookingInformation?: import('./appointments').BookingPatientInformationInput;
	}
) => {
	const now = input.now ?? new Date();
	let business = await getPublicBusinessBySlug(supabase, input.slug);
	let availabilityRevision: number | undefined;
	if (input.bookingIntegration && business) {
		// Read the business rules and revision together BEFORE reading schedule rows.
		// The final RPC holds this row and refuses edits committed during calculation.
		const { data, error } = await supabase.from('businesses')
			.select(PUBLIC_BUSINESS_SELECT).eq('id', business.id)
			.single<PublicBookingBusiness & { booking_availability_revision: number }>();
		if (error) throw error;
		business = data as PublicBookingBusiness;
		availabilityRevision = Number(data.booking_availability_revision);
		if (!Number.isSafeInteger(availabilityRevision) || availabilityRevision < 1) throw new Error('BOOKING_AVAILABILITY_CHANGED');
	}
	const requestedProfessionalIds = [
		...new Set(
			[
				...(input.professionalIds ?? []),
				...(input.professionalId ? [input.professionalId] : [])
			]
				.map((professionalId) => String(professionalId).trim())
				.filter(Boolean)
		)
	];
	const bookingMode: PublicBookingMode =
		input.bookingMode === 'joint' || requestedProfessionalIds.length > 1 ? 'joint' : 'individual';
	const professionalIds =
		bookingMode === 'joint' ? requestedProfessionalIds : requestedProfessionalIds.slice(0, 1);
	const professionalId = professionalIds[0] ?? '';
	let phoneE164: string | null = null;

	try {
		if (!business || !business.is_active || !business.public_booking_enabled) {
			throw new Error('PUBLIC_BOOKING_UNAVAILABLE');
		}
		if (!(await canUsePublicBusiness(supabase, business.id, business.created_at))) {
			throw new Error('PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE');
		}

		const patientName = normalizePatientFullName(input.patientName);
		phoneE164 = normalizePhoneE164(input.patientPhone);
		const email = String(input.patientEmail ?? '').trim();
		if (!patientName) throw new Error('PUBLIC_PATIENT_NAME_REQUIRED');
		if (!isValidPatientFullName(patientName)) throw new Error('PUBLIC_PATIENT_NAME_INVALID');
		if (!phoneE164 || !isLikelyPhoneE164(phoneE164)) throw new Error('PUBLIC_PATIENT_PHONE_INVALID');
		if (bookingMode === 'joint' && professionalIds.length < 2) {
			throw new Error('PUBLIC_JOINT_REQUIRES_TWO_PROFESSIONALS');
		}
			if (bookingMode === 'individual' && !professionalId) {
				throw new Error('PUBLIC_PROFESSIONAL_REQUIRED');
			}
			const commonInput = {
				businessId: business.id,
				ownerId: null,
				createdByUserId: null,
				patient: {
					mode: 'public' as const,
					name: patientName,
					phone: input.patientPhone,
					email: email || null
				},
				serviceId: input.serviceId,
				professionalIds,
				startsAt: new Date(input.slotStartsAt),
				internalNote: input.note?.trim() || null,
				source: 'public_booking' as const,
				idempotencyKey: input.idempotencyKey,
                bookingInformation: input.bookingInformation,
				bookingIntegration: input.bookingIntegration ? {
					...input.bookingIntegration, expectedAvailabilityRevision: availabilityRevision
				} : undefined
			};
			const replay = await findAppointmentCreationReplay(supabase, commonInput);
			if (replay) return { business, appointment: replay };

			// La capacidad del paciente se evalúa antes que los límites temporales de
		// intentos para no ocultar un 4/4 real detrás de un mensaje de rate limit.
		await assertPublicBookingPatientPolicy(supabase, {
			businessId: business.id,
			patientName,
			phoneE164,
			now
		});
		await assertPublicBookingRateLimits(supabase, {
			businessId: business.id,
			phoneE164,
			ipHash: input.ipHash ?? null,
			now
		});

		const slotDate = localDateParts(new Date(input.slotStartsAt), business.timezone);
		const slots = await getAvailabilitySlots(supabase, {
			modality: input.bookingIntegration?.modality,
			modalityWindows: input.bookingIntegration?.modalityWindows,
			business: business as Business,
			serviceId: input.serviceId,
			professionalId: bookingMode === 'individual' ? professionalId : null,
			professionalIds: bookingMode === 'joint' ? professionalIds : [],
			fromDate: slotDate,
			toDate: slotDate,
			publicOnly: true
		});
		const selectedSlot = slots.find(
			(slot) => {
				if (slot.starts_at !== input.slotStartsAt) return false;
				if (bookingMode === 'individual') return slot.professional_id === professionalId;
				const slotProfessionalIds = slot.professional_ids ?? [];
				return (
					slotProfessionalIds.length === professionalIds.length &&
					professionalIds.every((id) => slotProfessionalIds.includes(id))
				);
			}
		);
		if (!selectedSlot) throw new Error('PUBLIC_SLOT_UNAVAILABLE');

			const created =
				bookingMode === 'joint'
					? await createJointAppointment(supabase, {
							...commonInput,
							professionalIds: commonInput.professionalIds
						})
					: await createManualAppointment(supabase, {
							...commonInput,
							professionalId
						});
		invalidatePublicBookingScans(business.id);

		await recordPublicBookingAttempt(supabase, {
			businessId: business.id,
			phoneE164,
			ipHash: input.ipHash ?? null,
			action: 'booking_create',
			success: true,
			userAgent: input.userAgent,
			metadata: {
				appointment_id: created?.id ?? null,
				service_id: input.serviceId,
				booking_mode: bookingMode,
				professional_id: professionalId,
				professional_ids: professionalIds,
				starts_at: selectedSlot.starts_at
			}
		});

		return { business, appointment: created };
	} catch (error) {
		await recordPublicBookingAttempt(supabase, {
			businessId: business?.id ?? null,
			phoneE164,
			ipHash: input.ipHash ?? null,
			action: 'booking_create',
			success: false,
			errorCode: getPublicBookingErrorCode(error),
			userAgent: input.userAgent,
			metadata: {
				slug: input.slug,
				service_id: input.serviceId,
				booking_mode: bookingMode,
				professional_id: professionalId,
				professional_ids: professionalIds,
				slot_starts_at: input.slotStartsAt
			}
		});
		throw error;
	}
};

export const PUBLIC_BOOKING_ERROR_MESSAGES = {
	PUBLIC_BOOKING_UNAVAILABLE:
		'El consultorio desactivó las reservas online. Podés contactarlo para pedir el turno por otro medio.',
	PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE:
		'El sistema de reservas online del consultorio está temporalmente suspendido. Mientras lo reactivan, pedí el turno por contacto directo.',
	PUBLIC_PATIENT_NAME_REQUIRED: PATIENT_FULL_NAME_REQUIRED_ERROR_MESSAGE,
	PUBLIC_PATIENT_NAME_INVALID: PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE,
	PUBLIC_PATIENT_PHONE_INVALID:
		'El teléfono no tiene un formato válido. Revisalo e incluí el código de área.',
	PUBLIC_PROFESSIONAL_REQUIRED:
		'Elegí un profesional antes de buscar el día y el horario del turno.',
	PUBLIC_JOINT_REQUIRES_TWO_PROFESSIONALS:
		'Para reservar con un equipo, seleccioná por lo menos dos profesionales diferentes y volvé a buscar los días disponibles.',
	PUBLIC_SLOT_UNAVAILABLE:
		'Ese horario acaba de ser ocupado. Elegí otro de los horarios disponibles.',
	PUBLIC_RATE_LIMIT_IP:
		'Se alcanzó el máximo de 3 intentos desde esta conexión en 10 minutos. Esperá unos minutos antes de volver a probar.',
	PUBLIC_RATE_LIMIT_PHONE:
		'Se alcanzó el máximo de 5 intentos para este teléfono en 30 minutos. Esperá unos minutos antes de volver a probar.',
	PUBLIC_BOOKING_ACTIVE_LIMIT:
		'Esta persona ya alcanzó el máximo permitido: 4 turnos activos a futuro. Podés reservar otro cuando uno pase o sea cancelado.',
	PUBLIC_BOOKING_BLOCKED_PATIENT:
		'Las reservas online están deshabilitadas para esta ficha de paciente. Comunicate con el consultorio para que puedan ayudarte.',
	PUBLIC_CAPTCHA_REQUIRED: 'Completá la verificación anti-spam para reservar el turno.',
	PUBLIC_CAPTCHA_FAILED:
		'La verificación anti-spam no pudo validarse. Volvé a completarla e intentá nuevamente.',
	PATIENT_NAME_ALREADY_EXISTS:
		'Encontramos otra ficha con exactamente el mismo nombre. El nombre no debería bloquear una reserva; avisale al consultorio para que pueda corregir esta validación.',
	PATIENT_DNI_ALREADY_EXISTS:
		'La ficha coincide con un DNI ya registrado. Para evitar mezclar personas, el consultorio debe revisar esa ficha antes de continuar.',
	PATIENT_OWNER_REQUIRED:
		'El consultorio todavía no configuró quién administra los pacientes. Avisales para que puedan corregirlo y darte el turno.',
	SERVICE_NOT_FOUND:
		'El servicio que elegiste dejó de estar disponible. Volvé al primer paso y elegí otro.',
	PROFESSIONAL_NOT_FOUND:
		'El profesional que elegiste dejó de estar disponible. Volvé al paso de profesionales y elegí otro.',
	PROFESSIONAL_SERVICE_NOT_ASSIGNED:
		'Ese profesional ya no atiende el servicio elegido. Elegí otro profesional o servicio.',
	TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED:
		'Uno de los integrantes elegidos ya no atiende ese servicio. Volvé al paso del equipo, revisá la selección y elegí nuevamente el horario.',
	PUBLIC_BOOKING_UNEXPECTED:
		'No pudimos confirmar si el turno quedó guardado por un problema interno. Antes de reintentar, comunicate con el consultorio para evitar una reserva duplicada.'
} as const;

export type PublicBookingErrorCode = keyof typeof PUBLIC_BOOKING_ERROR_MESSAGES;

const publicBookingErrorTokenMap: ReadonlyArray<readonly [string, PublicBookingErrorCode]> = [
	['PUBLIC_BOOKING_UNAVAILABLE', 'PUBLIC_BOOKING_UNAVAILABLE'],
	['PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE', 'PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE'],
	['BUSINESS_ACCESS_RESTRICTED', 'PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE'],
	['PUBLIC_PATIENT_NAME_REQUIRED', 'PUBLIC_PATIENT_NAME_REQUIRED'],
	['PATIENT_NAME_REQUIRED', 'PUBLIC_PATIENT_NAME_REQUIRED'],
	['PUBLIC_PATIENT_NAME_INVALID', 'PUBLIC_PATIENT_NAME_INVALID'],
	['PUBLIC_PATIENT_PHONE_INVALID', 'PUBLIC_PATIENT_PHONE_INVALID'],
	['PUBLIC_PROFESSIONAL_REQUIRED', 'PUBLIC_PROFESSIONAL_REQUIRED'],
	['PUBLIC_JOINT_REQUIRES_TWO_PROFESSIONALS', 'PUBLIC_JOINT_REQUIRES_TWO_PROFESSIONALS'],
	['JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS', 'PUBLIC_JOINT_REQUIRES_TWO_PROFESSIONALS'],
	['PUBLIC_SLOT_UNAVAILABLE', 'PUBLIC_SLOT_UNAVAILABLE'],
	['PUBLIC_RATE_LIMIT_IP', 'PUBLIC_RATE_LIMIT_IP'],
	['PUBLIC_RATE_LIMIT_PHONE', 'PUBLIC_RATE_LIMIT_PHONE'],
	['PUBLIC_BOOKING_ACTIVE_LIMIT', 'PUBLIC_BOOKING_ACTIVE_LIMIT'],
	['PUBLIC_BOOKING_BLOCKED_PATIENT', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
	['PATIENT_BLOCKED', 'PUBLIC_BOOKING_BLOCKED_PATIENT'],
	['PUBLIC_CAPTCHA_REQUIRED', 'PUBLIC_CAPTCHA_REQUIRED'],
	['PUBLIC_CAPTCHA_FAILED', 'PUBLIC_CAPTCHA_FAILED'],
	['PATIENT_NAME_ALREADY_EXISTS', 'PATIENT_NAME_ALREADY_EXISTS'],
	['PATIENT_DNI_ALREADY_EXISTS', 'PATIENT_DNI_ALREADY_EXISTS'],
	['PATIENT_OWNER_REQUIRED', 'PATIENT_OWNER_REQUIRED'],
	['SERVICE_NOT_FOUND', 'SERVICE_NOT_FOUND'],
	['PROFESSIONAL_NOT_FOUND', 'PROFESSIONAL_NOT_FOUND'],
	['TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED', 'TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED'],
	['PROFESSIONAL_SERVICE_NOT_ASSIGNED', 'PROFESSIONAL_SERVICE_NOT_ASSIGNED']
];

const hasTechnicalErrorToken = (raw: string, token: string) =>
	new RegExp(`(^|[^A-Z0-9_])${token}([^A-Z0-9_]|$)`).test(raw);

export function getPublicBookingErrorCode(error: unknown): PublicBookingErrorCode {
 if(/SCHEDULE_SERVICE_UNAVAILABLE|SCHEDULE_BLOCKED/.test(String((error as {message?:string})?.message??'')))return 'PUBLIC_SLOT_UNAVAILABLE';
	const value = error as { message?: string; code?: string; details?: string; hint?: string };
	const raw = [value?.message, value?.code, value?.details, value?.hint].filter(Boolean).join(' ');
	if (value?.code === '23P01' || raw.includes('appointments_no_overlapping_active')) {
		return 'PUBLIC_SLOT_UNAVAILABLE';
	}
	for (const [token, code] of publicBookingErrorTokenMap) {
		if (hasTechnicalErrorToken(raw, token)) return code;
	}
	return 'PUBLIC_BOOKING_UNEXPECTED';
}

export const getPublicBookingErrorMessage = (error: unknown) =>
	PUBLIC_BOOKING_ERROR_MESSAGES[getPublicBookingErrorCode(error)];
