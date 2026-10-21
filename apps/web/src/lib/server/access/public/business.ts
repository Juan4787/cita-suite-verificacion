import { logServerFailure } from '$lib/server/platform/logging';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import type { CitaSupabaseClient } from '$lib/types/database';
import { createSupabaseAdminClient, getAuthUserId, getEmailFromAccessToken } from '$lib/server/platform/supabase';
import {
	getBusinessAccessState,
	parseBusinessSubscription,
	type BusinessAccessState,
	type BusinessSubscriptionRow
} from '$lib/access/commercial-access';
import {
	enforceRateLimits,
	pendingBusinessCreationRateLimitRules,
	RateLimitExceededError
} from '$lib/server/platform/rate-limits';
import { isEmailAlreadyAssociatedWithOtherBusinessError } from '$lib/server/access/public/business-email-association';
import { InvalidDataContractError, readArray, readBoolean, readFiniteNumber, readNullableText, readRecord, readText } from '$lib/contracts/json';

import { BUSINESS_ROLES, BUSINESS_INDUSTRIES, type BusinessRole, type BusinessIndustry, type Business, type BusinessContext } from '$lib/access/contracts';
export { BUSINESS_ROLES, BUSINESS_INDUSTRIES, type BusinessRole, type BusinessIndustry, type Business, type BusinessContext, type BusinessAssistanceContext } from '$lib/access/contracts';

export const ACTIVE_BUSINESS_COOKIE = 'active-business-id';

export const isBusinessRole = (value: string): value is BusinessRole =>
	(BUSINESS_ROLES as readonly string[]).includes(value);

export const isBusinessIndustry = (value: string): value is BusinessIndustry =>
	(BUSINESS_INDUSTRIES as readonly string[]).includes(value);

export const normalizeSlug = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);

const canManageRole = (role: BusinessRole) => role === 'owner' || role === 'admin';
const canOperateRole = (role: BusinessRole) =>
	role === 'owner' || role === 'admin' || role === 'reception';

export const demoBusinessContext = (): BusinessContext => ({
	business: {
		id: 'demo-business',
		name: 'Consultorio demo',
		slug: 'consultorio-demo',
		industry: 'odontology',
		phone: null,
		email: null,
		address: null,
		address_instructions: null,
		maps_url: null,
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		public_booking_enabled: true,
		whatsapp_enabled: false,
		allow_same_day_booking: false,
		min_booking_notice_minutes: 0,
		max_booking_days_ahead: 60,
		cancellation_policy: null,
		is_active: true
	},
	role: 'owner',
	canManage: true,
	canOperate: true,
	access: getBusinessAccessState({
		business_id: 'demo-business',
		commercial_access_enabled: true,
		is_permanent: true,
		subscription_status: 'active'
	})
});

type ResolveBusinessOptions = {
	supabase: CitaSupabaseClient;
	verifiedUserId?: string;
	accessToken?: string | null;
	cookies?: Cookies;
	ensureDefault?: boolean;
	defaultBusinessCreationIp?: string | null;
	fetch?: typeof fetch;
	membershipCache?: 'fresh' | 'request';
};

export function parseBusiness(value: unknown): Business {
	const row = readRecord(value, 'business');
	const industry = readText(row.industry, 'business.industry');
	if (!isBusinessIndustry(industry)) throw new InvalidDataContractError('business.industry');
	return {
		id: readText(row.id, 'business.id'), name: readText(row.name, 'business.name'),
		slug: readText(row.slug, 'business.slug'), industry,
		phone: readNullableText(row.phone, 'business.phone'), email: readNullableText(row.email, 'business.email'),
		address: readNullableText(row.address, 'business.address'),
		address_instructions: readNullableText(row.address_instructions, 'business.address_instructions'),
		maps_url: readNullableText(row.maps_url, 'business.maps_url'), logo_url: readNullableText(row.logo_url, 'business.logo_url'),
		timezone: readText(row.timezone, 'business.timezone'),
		public_booking_enabled: readBoolean(row.public_booking_enabled, 'business.public_booking_enabled'),
		whatsapp_enabled: readBoolean(row.whatsapp_enabled, 'business.whatsapp_enabled'),
		allow_same_day_booking: readBoolean(row.allow_same_day_booking, 'business.allow_same_day_booking'),
		min_booking_notice_minutes: readFiniteNumber(row.min_booking_notice_minutes, 'business.min_booking_notice_minutes'),
		max_booking_days_ahead: readFiniteNumber(row.max_booking_days_ahead, 'business.max_booking_days_ahead'),
		cancellation_policy: readNullableText(row.cancellation_policy, 'business.cancellation_policy'),
		is_active: readBoolean(row.is_active, 'business.is_active'),
		created_at: readNullableText(row.created_at, 'business.created_at'), updated_at: readNullableText(row.updated_at, 'business.updated_at')
	};
}

const mapMembership = (value: unknown): BusinessContext => {
	const row = readRecord(value, 'membership');
	const role = readText(row.role, 'membership.role');
	const business = parseBusiness(row.business);
	if (!isBusinessRole(role)) throw new InvalidDataContractError('membership.role');
	const access = getBusinessAccessState(null, { businessCreatedAt: business.created_at });
	return {
		business,
		role,
		canManage: canManageRole(role) && access.canUseBusiness,
		canOperate: canOperateRole(role) && access.canUseBusiness,
		access,
		assistance: null
	};
};

const mapAssistanceMembership = (value: unknown): BusinessContext => {
	const row = readRecord(value, 'assistanceMembership');
	const business = parseBusiness(row.business);
	const access = getBusinessAccessState(null, { businessCreatedAt: business.created_at });
	return {
		business,
		role: 'admin',
		canManage: access.canUseBusiness,
		canOperate: access.canUseBusiness,
		access,
		assistance: {
			grantId: readText(row.id, 'assistanceMembership.id'),
			requestedByUserId: readText(row.requested_by_user_id, 'assistanceMembership.requested_by_user_id'),
			supportUserId: readText(row.support_user_id, 'assistanceMembership.support_user_id'),
			startsAt: readText(row.starts_at, 'assistanceMembership.starts_at'),
			expiresAt: readText(row.expires_at, 'assistanceMembership.expires_at')
		}
	};
};

const applySubscription = (
	membership: BusinessContext,
	subscription: BusinessSubscriptionRow | null | undefined
): BusinessContext => {
	const access = getBusinessAccessState(subscription ?? null, {
		businessCreatedAt: membership.business.created_at
	});
	return {
		...membership,
		canManage: canManageRole(membership.role) && access.canUseBusiness,
		canOperate: canOperateRole(membership.role) && access.canUseBusiness,
		access
	};
};

const mapRpcMembership = (value: unknown): BusinessContext => {
	const row = readRecord(value, 'businessContext');
	const business = parseBusiness(row.business);
	const role = readText(row.role, 'businessContext.role');
	if (!isBusinessRole(role)) throw new InvalidDataContractError('businessContext.role');
	const assistance = row.assistance == null ? null : readRecord(row.assistance, 'businessContext.assistance');
	const base = assistance
		? mapAssistanceMembership({
				id: assistance.grantId,
				requested_by_user_id: assistance.requestedByUserId,
				support_user_id: assistance.supportUserId,
				starts_at: assistance.startsAt,
				expires_at: assistance.expiresAt,
				business
			})
		: mapMembership({ role, business });
	return applySubscription(base, parseBusinessSubscription(row.subscription, business.id));
};

// The contexts come only from their SQL contract: a missing or failing function is an
// error, never a reason to rebuild memberships, assistance and access another way.
const loadMemberships = async (supabase: CitaSupabaseClient): Promise<BusinessContext[]> => {
	const { data, error } = await supabase.rpc('list_user_business_contexts');
	if (error) throw error;
	return readArray(data, 'businessContexts').map(mapRpcMembership);
};

type MembershipsByRequestEntry = {
	userId: string;
	accessToken: string | null;
	pending: Promise<BusinessContext[]>;
};
const membershipsByRequest = new WeakMap<Cookies, MembershipsByRequestEntry>();

const defaultBusinessBootstrapByUser = new Map<
	string,
	Promise<{ error: unknown | null }>
>();

const loadMembershipsForRequest = (
	supabase: CitaSupabaseClient,
	userId: string,
	accessToken: string | null,
	requestKey: Cookies | undefined,
	mode: 'fresh' | 'request'
) => {
	const cached = requestKey ? membershipsByRequest.get(requestKey) : null;
	if (mode === 'request' && cached?.userId === userId && cached.accessToken === accessToken)
		return cached.pending;

	const loaded = loadMemberships(supabase);
	const guarded = loaded.catch((error) => {
		if (requestKey && membershipsByRequest.get(requestKey)?.pending === guarded) {
			membershipsByRequest.delete(requestKey);
		}
		throw error;
	});
	if (requestKey) membershipsByRequest.set(requestKey, { userId, accessToken, pending: guarded });
	return guarded;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown) =>
	typeof error === 'object' && error !== null && 'message' in error
		? String((error as { message?: unknown }).message ?? '')
		: String(error ?? '');

export const isDefaultBusinessCreationDisabledError = (error: unknown) =>
	errorMessage(error).includes('DEFAULT_BUSINESS_CREATION_DISABLED');

export const isDefaultBusinessPendingManualSetupError = (error: unknown) =>
	[
		'DEFAULT_BUSINESS_PENDING_MANUAL_SETUP',
		'DEFAULT_BUSINESS_CREATION_DISABLED',
		'DEFAULT_BUSINESS_PENDING_LIMIT_REACHED'
	].some((code) => errorMessage(error).includes(code));

export class DefaultBusinessSetupUnavailableError extends Error {
	mayHaveCompleted: boolean;

	constructor(cause?: unknown, mayHaveCompleted = false) {
		super('DEFAULT_BUSINESS_SETUP_UNAVAILABLE', { cause });
		this.name = 'DefaultBusinessSetupUnavailableError';
		this.mayHaveCompleted = mayHaveCompleted;
	}
}

export const isDefaultBusinessSetupUnavailableError = (error: unknown) =>
	error instanceof DefaultBusinessSetupUnavailableError;

const isRecoverableDefaultBusinessBootstrapRace = (error: unknown) =>
	isDefaultBusinessCreationDisabledError(error) ||
	isDefaultBusinessPendingManualSetupError(error) ||
	isEmailAlreadyAssociatedWithOtherBusinessError(error);

/**
 * Invitaciones pendientes no crean un consultorio nuevo y no deben consumir el
 * límite anti-abuso de altas por IP. La consulta se hace con el cliente de
 * servicio y sólo devuelve un booleano; si no se puede comprobar, se conserva
 * el límite (fail closed).
 */
const hasPendingBusinessInvite = async ({
	userId,
	accessToken,
	fetch
}: {
	userId: string;
	accessToken?: string | null;
	fetch?: typeof globalThis.fetch;
}): Promise<boolean> => {
	const email = getEmailFromAccessToken(accessToken)?.trim().toLowerCase();
	if (!email) return false;
	try {
		const admin = await createSupabaseAdminClient('odonto', fetch);
		const { data, error } = await admin
			.from('business_user_invites')
			.select('id')
			.eq('email', email)
			.eq('status', 'pending')
			.limit(1)
			.maybeSingle();
		if (error) {
			logServerFailure('No se pudo comprobar la invitación pendiente antes del alta', error);
			return false;
		}
		return Boolean(data?.id);
	} catch (error) {
		logServerFailure('No se pudo comprobar la invitación pendiente antes del alta', error);
		return false;
	}
};

const reloadMembershipsAfterBootstrap = async (
	supabase: CitaSupabaseClient,
	userId: string,
	requestKey?: Cookies
): Promise<BusinessContext[]> => {
	if (requestKey) membershipsByRequest.delete(requestKey);
	for (const delay of [0, 150, 350]) {
		if (delay > 0) await wait(delay);
		const memberships = await loadMemberships(supabase);
		if (memberships.length > 0) return memberships;
	}
	return [];
};

const ensureDefaultBusinessOnce = ({
	supabase,
	userId,
	accessToken,
	ip,
	fetch
}: {
	supabase: CitaSupabaseClient;
	userId: string;
	accessToken?: string | null;
	ip?: string | null;
	fetch?: typeof globalThis.fetch;
}) => {
	const existing = defaultBusinessBootstrapByUser.get(userId);
	if (existing) return existing;

	const pending = (async () => {
		const invited = await hasPendingBusinessInvite({ userId, accessToken, fetch });
		if (!invited) {
			try {
				// Crear un consultorio sí consume recursos: si este control no se puede
				// comprobar, la operación se detiene con un estado específico.
				await enforceRateLimits(pendingBusinessCreationRateLimitRules(userId, ip), fetch);
			} catch (error) {
				if (error instanceof RateLimitExceededError) throw error;
				throw new DefaultBusinessSetupUnavailableError(error);
			}
		}

		try {
			const { error } = await supabase.rpc('ensure_user_default_business', {
				p_name: 'Consultorio',
				p_industry: 'odontology'
			});
			return { error };
		} catch (error) {
			// La llamada pudo haberse confirmado en la base antes de perder la
			// respuesta; el caller hará una relectura antes de informar el fallo.
			throw new DefaultBusinessSetupUnavailableError(error, true);
		}
	})().finally(() => {
		if (defaultBusinessBootstrapByUser.get(userId) === pending) {
			defaultBusinessBootstrapByUser.delete(userId);
		}
	});

	defaultBusinessBootstrapByUser.set(userId, pending);
	return pending;
};

export const resolveActiveBusiness = async ({
	supabase,
	verifiedUserId,
	accessToken,
	cookies,
	ensureDefault = true,
	defaultBusinessCreationIp,
	fetch,
	membershipCache = 'request'
}: ResolveBusinessOptions): Promise<BusinessContext | null> => {
	if (env.DEMO_MODE === 'true') return demoBusinessContext();

	const userId = verifiedUserId ?? await getAuthUserId(supabase, accessToken);
	if (!userId) return null;

	const requestKey = cookies;
	let memberships = await loadMembershipsForRequest(supabase, userId, accessToken ?? null, requestKey, membershipCache);
	const now = Date.now();
	memberships = memberships.filter((membership) => {
		if (!membership.assistance) return true;
		const startsAt = Date.parse(membership.assistance.startsAt);
		const expiresAt = Date.parse(membership.assistance.expiresAt);
		return Number.isFinite(startsAt) && Number.isFinite(expiresAt) && startsAt <= now && expiresAt > now;
	});

	if (memberships.length === 0 && ensureDefault) {
		let error: unknown | null = null;
		try {
			({ error } = await ensureDefaultBusinessOnce({
				supabase,
				userId,
				accessToken,
				ip: defaultBusinessCreationIp,
				fetch
			}));
		} catch (bootstrapError) {
			if (bootstrapError instanceof RateLimitExceededError) throw bootstrapError;
			if (
				bootstrapError instanceof DefaultBusinessSetupUnavailableError &&
				!bootstrapError.mayHaveCompleted
			) {
				throw bootstrapError;
			}
			// Una desconexión puede ocurrir después de que la transacción terminó.
			// Releer evita informar un fallo (o reintentar) si el alta sí quedó completa.
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId, requestKey);
			if (memberships.length === 0) throw bootstrapError;
		}
		if (error) {
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId, requestKey);
			if (memberships.length === 0 || !isRecoverableDefaultBusinessBootstrapRace(error)) {
				if (isDefaultBusinessPendingManualSetupError(error)) throw error;
				throw new DefaultBusinessSetupUnavailableError(error);
			}
		} else if (memberships.length === 0) {
			memberships = await reloadMembershipsAfterBootstrap(supabase, userId, requestKey);
			if (memberships.length === 0) {
				throw new DefaultBusinessSetupUnavailableError(
					new Error('DEFAULT_BUSINESS_NOT_VISIBLE_AFTER_BOOTSTRAP')
				);
			}
		}
	}

	const activeBusinessId = cookies?.get(ACTIVE_BUSINESS_COOKIE);
	const selected =
		(activeBusinessId
			? memberships.find((membership) => membership.business.id === activeBusinessId)
			: null) ??
		memberships[0] ??
		null;

	if (selected && cookies) {
		cookies.set(ACTIVE_BUSINESS_COOKIE, selected.business.id, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	return selected;
};
