export const COMMERCIAL_STATUSES = ['active', 'grace', 'restricted', 'archived'] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export type CommercialVisualStatus =
	| 'permanent'
	| 'active'
	| 'expiring'
	| 'grace'
	| 'restricted'
	| 'archived';

export type BusinessAccessCapabilities = {
	canViewExistingPatients: boolean;
	canViewExistingClinicalNotes: boolean;
	canViewExistingCosts: boolean;
	canCreatePatient: boolean;
	canEditPatient: boolean;
	canCreateAppointment: boolean;
	canEditAppointment: boolean;
	canCancelAppointment: boolean;
	canRescheduleAppointment: boolean;
	canUsePublicBooking: boolean;
	canManageServices: boolean;
	canManageProfessionals: boolean;
	canManageAvailability: boolean;
	canCreateClinicalEntry: boolean;
	canEditClinicalEntry: boolean;
	canManagePatientFiles: boolean;
	canManageUsers: boolean;
	canViewSubscription: boolean;
};

export type BusinessSubscriptionRow = {
	id?: string | null;
	business_id: string;
	commercial_access_enabled?: boolean | null;
	is_permanent?: boolean | null;
	subscription_status?: CommercialStatus | string | null;
	access_starts_at?: string | null;
	paid_until?: string | null;
	grace_until?: string | null;
	restricted_until?: string | null;
	archived_at?: string | null;
	last_payment_at?: string | null;
	last_payment_amount?: number | string | null;
	last_grant_duration_seconds?: number | null;
	expiration_notice_enabled?: boolean | null;
	access_source?: string | null;
	access_note?: string | null;
	updated_by?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

export function parseBusinessSubscription(value: unknown, businessId: string): BusinessSubscriptionRow | null {
	if (value === null || value === undefined) return null;
	const row = readRecord(value, 'businessSubscription');
	const id = readText(row.business_id, 'businessSubscription.business_id');
	if (id !== businessId) throw new InvalidDataContractError('businessSubscription.business_id');
	const status = readNullableText(row.subscription_status, 'businessSubscription.subscription_status');
	if (status !== null && !COMMERCIAL_STATUSES.some(candidate => candidate === status))
		throw new InvalidDataContractError('businessSubscription.subscription_status');
	const paymentAmount = row.last_payment_amount;
	if (paymentAmount !== null && paymentAmount !== undefined &&
		!(typeof paymentAmount === 'number' && Number.isFinite(paymentAmount)) &&
		!(typeof paymentAmount === 'string' && /^\d+(?:\.\d+)?$/.test(paymentAmount)))
		throw new InvalidDataContractError('businessSubscription.last_payment_amount');
	return {
		id: readNullableText(row.id, 'businessSubscription.id'), business_id: id,
		commercial_access_enabled: readBoolean(row.commercial_access_enabled, 'businessSubscription.commercial_access_enabled'),
		is_permanent: readBoolean(row.is_permanent, 'businessSubscription.is_permanent'), subscription_status: status,
		access_starts_at: readNullableText(row.access_starts_at, 'businessSubscription.access_starts_at'),
		paid_until: readNullableText(row.paid_until, 'businessSubscription.paid_until'),
		grace_until: readNullableText(row.grace_until, 'businessSubscription.grace_until'),
		restricted_until: readNullableText(row.restricted_until, 'businessSubscription.restricted_until'),
		archived_at: readNullableText(row.archived_at, 'businessSubscription.archived_at'),
		last_payment_at: readNullableText(row.last_payment_at, 'businessSubscription.last_payment_at'),
		last_payment_amount: paymentAmount ?? null,
		last_grant_duration_seconds: row.last_grant_duration_seconds == null ? null : readFiniteNumber(row.last_grant_duration_seconds, 'businessSubscription.last_grant_duration_seconds'),
		expiration_notice_enabled: row.expiration_notice_enabled == null ? null : readBoolean(row.expiration_notice_enabled, 'businessSubscription.expiration_notice_enabled'),
		access_source: readNullableText(row.access_source, 'businessSubscription.access_source'),
		access_note: readNullableText(row.access_note, 'businessSubscription.access_note'),
		updated_by: readNullableText(row.updated_by, 'businessSubscription.updated_by'),
		created_at: readNullableText(row.created_at, 'businessSubscription.created_at'),
		updated_at: readNullableText(row.updated_at, 'businessSubscription.updated_at')
	};
}

export type BusinessAccessState = {
	canEnterApp: boolean;
	canUseBusiness: boolean;
	commercialStatus: CommercialStatus;
	visualStatus: CommercialVisualStatus;
	isPermanent: boolean;
	commercialAccessEnabled: boolean;
	paidUntil: string | null;
	graceUntil: string | null;
	restrictedUntil: string | null;
	archivedAt: string | null;
	daysUntilExpiration: number | null;
	hoursUntilExpiration: number | null;
	shouldShowExpiringWarning: boolean;
	allowedCapabilities: BusinessAccessCapabilities;
	subscription: BusinessSubscriptionRow | null;
};

export const BUSINESS_SUBSCRIPTIONS_LEGACY_CUTOFF_ISO = '2026-05-28T05:21:36.000Z';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const BUSINESS_SUBSCRIPTIONS_LEGACY_CUTOFF_MS = Date.parse(BUSINESS_SUBSCRIPTIONS_LEGACY_CUTOFF_ISO);

const fullCapabilities = (): BusinessAccessCapabilities => ({
	canViewExistingPatients: true,
	canViewExistingClinicalNotes: true,
	canViewExistingCosts: true,
	canCreatePatient: true,
	canEditPatient: true,
	canCreateAppointment: true,
	canEditAppointment: true,
	canCancelAppointment: true,
	canRescheduleAppointment: true,
	canUsePublicBooking: true,
	canManageServices: true,
	canManageProfessionals: true,
	canManageAvailability: true,
	canCreateClinicalEntry: true,
	canEditClinicalEntry: true,
	canManagePatientFiles: true,
	canManageUsers: true,
	canViewSubscription: true
});

const restrictedCapabilities = (): BusinessAccessCapabilities => ({
	canViewExistingPatients: true,
	canViewExistingClinicalNotes: true,
	canViewExistingCosts: true,
	canCreatePatient: false,
	canEditPatient: false,
	canCreateAppointment: false,
	canEditAppointment: false,
	canCancelAppointment: false,
	canRescheduleAppointment: false,
	canUsePublicBooking: false,
	canManageServices: false,
	canManageProfessionals: false,
	canManageAvailability: false,
	canCreateClinicalEntry: false,
	canEditClinicalEntry: false,
	canManagePatientFiles: false,
	canManageUsers: false,
	canViewSubscription: true
});

const archivedCapabilities = (): BusinessAccessCapabilities => ({
	canViewExistingPatients: false,
	canViewExistingClinicalNotes: false,
	canViewExistingCosts: false,
	canCreatePatient: false,
	canEditPatient: false,
	canCreateAppointment: false,
	canEditAppointment: false,
	canCancelAppointment: false,
	canRescheduleAppointment: false,
	canUsePublicBooking: false,
	canManageServices: false,
	canManageProfessionals: false,
	canManageAvailability: false,
	canCreateClinicalEntry: false,
	canEditClinicalEntry: false,
	canManagePatientFiles: false,
	canManageUsers: false,
	canViewSubscription: true
});

const parseTs = (value?: string | null) => {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const isoOrNull = (value?: string | null) => value ?? null;

const computeCommercialStatus = (
	subscription: BusinessSubscriptionRow | null,
	nowMs: number,
	legacyFallbackActive: boolean
): CommercialStatus => {
	if (!subscription) return legacyFallbackActive ? 'active' : 'restricted';
	if (subscription.archived_at) return 'archived';
	if (subscription.commercial_access_enabled === false) return 'restricted';
	if (subscription.is_permanent === true) return 'active';

	const paidUntil = parseTs(subscription.paid_until);
	if (paidUntil !== null && nowMs <= paidUntil) return 'active';

	const graceUntil = parseTs(subscription.grace_until);
	if (graceUntil !== null && nowMs <= graceUntil) return 'grace';

	const restrictedUntil = parseTs(subscription.restricted_until);
	if (restrictedUntil !== null && nowMs <= restrictedUntil) return 'restricted';

	return 'archived';
};

type BusinessAccessOptions = {
	now?: Date;
	businessCreatedAt?: string | null;
};

const isLegacyBusinessWithoutSubscription = (createdAt?: string | null) => {
	const createdAtMs = parseTs(createdAt);
	return createdAtMs !== null && createdAtMs < BUSINESS_SUBSCRIPTIONS_LEGACY_CUTOFF_MS;
};

export const getBusinessAccessState = (
	subscription: BusinessSubscriptionRow | null | undefined,
	options: BusinessAccessOptions = {}
): BusinessAccessState => {
	const safeSubscription = subscription ?? null;
	const nowMs = (options.now ?? new Date()).getTime();
	// As in SQL (business_commercial_status): only a practice older than subscriptions
	// is active without a row; nothing else can stand in for a missing subscription.
	const legacyFallbackActive = isLegacyBusinessWithoutSubscription(options.businessCreatedAt);
	const status = computeCommercialStatus(safeSubscription, nowMs, legacyFallbackActive);
	const isPermanent = safeSubscription?.is_permanent === true || (!safeSubscription && legacyFallbackActive);
	const commercialAccessEnabled = safeSubscription
		? safeSubscription.commercial_access_enabled !== false
		: legacyFallbackActive;
	const paidUntilMs = parseTs(safeSubscription?.paid_until);
	const diffMs = paidUntilMs === null ? null : paidUntilMs - nowMs;
	const hoursUntilExpiration = diffMs === null ? null : Math.max(0, Math.ceil(diffMs / ONE_HOUR_MS));
	const daysUntilExpiration = diffMs === null ? null : Math.max(0, Math.ceil(diffMs / ONE_DAY_MS));
	const shouldShowExpiringWarning =
		status === 'active' &&
		!isPermanent &&
		safeSubscription?.expiration_notice_enabled === true &&
		diffMs !== null &&
		diffMs > 0 &&
		diffMs <= ONE_DAY_MS;

	const visualStatus: CommercialVisualStatus =
		status === 'active' && isPermanent
			? 'permanent'
			: shouldShowExpiringWarning
				? 'expiring'
				: status;

	const allowedCapabilities =
		status === 'archived'
			? archivedCapabilities()
			: status === 'restricted'
				? restrictedCapabilities()
				: fullCapabilities();

	return {
		canEnterApp: commercialAccessEnabled && status !== 'archived',
		canUseBusiness: commercialAccessEnabled && (status === 'active' || status === 'grace'),
		commercialStatus: status,
		visualStatus,
		isPermanent,
		commercialAccessEnabled,
		paidUntil: isoOrNull(safeSubscription?.paid_until),
		graceUntil: isoOrNull(safeSubscription?.grace_until),
		restrictedUntil: isoOrNull(safeSubscription?.restricted_until),
		archivedAt: isoOrNull(safeSubscription?.archived_at),
		daysUntilExpiration,
		hoursUntilExpiration,
		shouldShowExpiringWarning,
		allowedCapabilities,
		subscription: safeSubscription
	};
};

export const commercialAccessMessage = (state: BusinessAccessState) => {
	if (state.commercialStatus === 'archived') {
		return state.archivedAt
			? 'La cuenta está archivada. Contactá soporte para solicitar la reactivación.'
			: 'Tu acceso a Cita Suite venció. Tu agenda, pacientes y configuración siguen guardados.';
	}
	if (state.commercialStatus === 'restricted') {
		return 'Tu acceso a Cita Suite venció. Activá tu suscripción para volver a usar la plataforma.';
	}
	return null;
};

export const publicBusinessUnavailableMessage =
	'La reserva online no está disponible en este momento. Contactá al consultorio.';
import { InvalidDataContractError, readBoolean, readFiniteNumber, readNullableText, readRecord, readText } from '../contracts/json.ts';
