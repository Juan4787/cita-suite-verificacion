import { readRecord } from '$lib/contracts/json';
import {
	assistanceActivationKinds,
	assistanceExtensionKinds,
	formatAssistanceMoment,
	isAccountAssistanceKind,
	type AccountAssistanceEnd,
	type AccountAssistanceKind,
	type AssistanceMoment
} from '$lib/access/assistance-durations';
import { MASTER_EMAIL } from '$lib/server/platform/supabase';
import type { BusinessRole } from '$lib/server/access/public/business';
import type { CitaSupabaseClient } from '$lib/types/database';

export const ACCOUNT_ASSISTANCE_FINAL_NOTICE_HOURS = 24;

export type AccountAssistanceRow = {
	id: string;
	business_id: string;
	requested_by_user_id: string;
	support_user_id: string;
	status: 'active' | 'expired' | 'revoked' | string;
	kind: AccountAssistanceKind | string;
	starts_at: string;
	expires_at: string;
	extended_at: string | null;
	revoked_at: string | null;
	revoked_by_role: 'owner' | 'support' | string | null;
	dismissed_at: string | null;
	created_at: string;
	updated_at: string;
};

export type AccountAssistanceViewStatus = 'available' | 'active' | 'expired' | 'revoked';

export type AccountAssistanceView = {
	status: AccountAssistanceViewStatus;
	grantId: string | null;
	/** Null when there is no grant, or when it has a duration this version does not know. */
	kind: AccountAssistanceKind | null;
	/** The global notice: the offer, the active grant, or for 24 hours how it ended. */
	showBanner: boolean;
	canActivate: boolean;
	/** The owner, or the support user inside the account, while it is active. */
	canEnd: boolean;
	/** Only the owner, and only when there is a longer duration to move to. */
	canExtend: boolean;
	canDismiss: boolean;
	/** Empty when the patients were not read: options are never listed unchecked. */
	activationKinds: AccountAssistanceKind[];
	extensionKinds: AccountAssistanceKind[];
	expiresAt: string | null;
	endsAt: AssistanceMoment | null;
	endedBy: AccountAssistanceEnd | null;
	endedAt: string | null;
	endedAtMoment: AssistanceMoment | null;
};

export type MasterAccountAssistanceRequest = {
	id: string;
	businessId: string;
	businessName: string;
	businessSlug: string;
	/** The practice's own time zone, in which its end is written. */
	timeZone: string;
	kind: AccountAssistanceKind | null;
	expiresAt: string;
};

const ASSISTANCE_SELECT =
	'id, business_id, requested_by_user_id, support_user_id, status, kind, starts_at, expires_at, extended_at, revoked_at, revoked_by_role, dismissed_at, created_at, updated_at';

const normalizeRow = (value: unknown): AccountAssistanceRow | null => {
	if (value === null || value === undefined) return null;
	const row = readRecord(value, 'accountAssistance');
	if (!row?.id || !row?.business_id || !row?.requested_by_user_id || !row?.support_user_id) return null;
	return {
		id: String(row.id),
		business_id: String(row.business_id),
		requested_by_user_id: String(row.requested_by_user_id),
		support_user_id: String(row.support_user_id),
		status: String(row.status ?? 'active'),
		kind: String(row.kind ?? 'hour'),
		starts_at: String(row.starts_at ?? ''),
		expires_at: String(row.expires_at ?? ''),
		extended_at: row.extended_at ? String(row.extended_at) : null,
		revoked_at: row.revoked_at ? String(row.revoked_at) : null,
		revoked_by_role: row.revoked_by_role ? String(row.revoked_by_role) : null,
		dismissed_at: row.dismissed_at ? String(row.dismissed_at) : null,
		created_at: String(row.created_at ?? ''),
		updated_at: String(row.updated_at ?? '')
	};
};

const errorMessage = (error: unknown) =>
	typeof error === 'object' && error !== null && 'message' in error
		? String((error as { message?: unknown }).message ?? '')
		: String(error ?? '');

const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

const parseDate = (value?: string | null) => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

export const buildAccountAssistanceView = ({
	grant,
	role,
	timeZone,
	now = new Date(),
	canUseBusiness = true,
	isAssisting = false,
	hasPatients
}: {
	grant: AccountAssistanceRow | null;
	role: BusinessRole | null | undefined;
	timeZone: string;
	now?: Date;
	canUseBusiness?: boolean;
	isAssisting?: boolean;
	/** Read only where the owner chooses a duration; undefined elsewhere. */
	hasPatients?: boolean;
}): AccountAssistanceView => {
	const isOwner = role === 'owner' && !isAssisting;
	const canOffer = isOwner && canUseBusiness;
	const activationKinds = canOffer && hasPatients !== undefined ? assistanceActivationKinds(hasPatients) : [];
	const available: AccountAssistanceView = {
		status: 'available',
		grantId: null,
		kind: null,
		showBanner: canOffer,
		canActivate: canOffer,
		canEnd: false,
		canExtend: false,
		canDismiss: false,
		activationKinds,
		extensionKinds: [],
		expiresAt: null,
		endsAt: null,
		endedBy: null,
		endedAt: null,
		endedAtMoment: null
	};
	if (!grant) return available;

	const kind = isAccountAssistanceKind(grant.kind) ? grant.kind : null;
	const expiresAt = parseDate(grant.expires_at);
	const revokedAt = parseDate(grant.revoked_at);
	const dismissedAt = parseDate(grant.dismissed_at);
	const isActive = grant.status === 'active' && !revokedAt && expiresAt !== null && expiresAt > now;
	if (isActive) {
		const extensionKinds = canOffer && kind && hasPatients !== undefined ? assistanceExtensionKinds(kind, hasPatients) : [];
		return {
			...available,
			status: 'active',
			grantId: grant.id,
			kind,
			showBanner: canOffer,
			canActivate: false,
			canEnd: isOwner || isAssisting,
			canExtend: extensionKinds.length > 0,
			activationKinds: [],
			extensionKinds,
			expiresAt: grant.expires_at,
			endsAt: formatAssistanceMoment(grant.expires_at, timeZone, now)
		};
	}

	const status: AccountAssistanceViewStatus = revokedAt || grant.status === 'revoked' ? 'revoked' : 'expired';
	// Before V11 only the owner could end it, and nobody was recorded.
	const endedBy: AccountAssistanceEnd = status === 'expired' ? 'expired' : grant.revoked_by_role === 'support' ? 'support' : 'owner';
	const endedAt = (status === 'revoked' ? grant.revoked_at : grant.expires_at) ?? grant.updated_at;
	const endedDate = parseDate(endedAt);
	const withinNoticeWindow = Boolean(
		endedDate && endedDate <= now && endedDate > addHours(now, -ACCOUNT_ASSISTANCE_FINAL_NOTICE_HOURS)
	);
	const showEnd = canOffer && withinNoticeWindow && !dismissedAt;

	return {
		...available,
		status,
		grantId: grant.id,
		kind,
		// For 24 hours the owner is told how it ended, until she closes the notice.
		showBanner: showEnd,
		canDismiss: showEnd,
		expiresAt: grant.expires_at,
		endsAt: formatAssistanceMoment(grant.expires_at, timeZone, now),
		endedBy,
		endedAt,
		endedAtMoment: formatAssistanceMoment(endedAt, timeZone, now)
	};
};

export const loadLatestAccountAssistanceGrant = async (
	supabase: CitaSupabaseClient,
	businessId: string
): Promise<AccountAssistanceRow | null> => {
	// An unread grant is not an absent one: the caller says it could not check.
	const { data, error } = await supabase
		.from('account_assistance_grants')
		.select(ASSISTANCE_SELECT)
		.eq('business_id', businessId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return normalizeRow(data);
};

export const loadAccountAssistanceView = async ({
	supabase,
	businessId,
	role,
	timeZone,
	canUseBusiness,
	isAssisting,
	hasPatients
}: {
	supabase: CitaSupabaseClient;
	businessId: string;
	role: BusinessRole | null | undefined;
	timeZone: string;
	canUseBusiness: boolean;
	isAssisting?: boolean;
	hasPatients?: boolean;
}): Promise<AccountAssistanceView> => {
	const grant = await loadLatestAccountAssistanceGrant(supabase, businessId);
	return buildAccountAssistanceView({
		grant,
		role,
		timeZone,
		canUseBusiness,
		isAssisting: Boolean(isAssisting),
		hasPatients
	});
};

/** Whether the practice has patients, which decides if the initial setup is offered. Owner only. */
export const loadAccountAssistanceHasPatients = async ({
	supabase,
	businessId
}: {
	supabase: CitaSupabaseClient;
	businessId: string;
}): Promise<boolean> => {
	const { data, error } = await supabase.rpc('account_assistance_has_patients', { target_business_id: businessId });
	if (error) throw error;
	// An answer that is not a boolean is not "no patients".
	if (typeof data !== 'boolean') throw new Error('ACCOUNT_ASSISTANCE_PATIENTS_UNREADABLE');
	return data;
};

export const loadActiveMasterAccountAssistanceRequests = async ({
	admin,
	supportUserId,
	now = new Date()
}: {
	admin: CitaSupabaseClient;
	supportUserId: string;
	now?: Date;
}): Promise<MasterAccountAssistanceRequest[]> => {
	const { data, error } = await admin
		.from('account_assistance_grants')
		.select('id, business_id, kind, expires_at, business:businesses(id, name, slug, timezone)')
		.eq('support_user_id', supportUserId)
		.eq('status', 'active')
		.is('revoked_at', null)
		.gt('expires_at', now.toISOString())
		.order('expires_at', { ascending: true });
	if (error) throw error;

	return (data ?? [])
		.map((row) => {
			const business = Array.isArray(row.business) ? row.business[0] : row.business;
			if (!row?.id || !row?.business_id || !row?.expires_at) return null;
			return {
				id: String(row.id),
				businessId: String(row.business_id),
				businessName: String(business?.name ?? 'Consultorio'),
				businessSlug: String(business?.slug ?? ''),
				timeZone: String(business?.timezone || 'America/Argentina/Buenos_Aires'),
				kind: isAccountAssistanceKind(row.kind) ? row.kind : null,
				expiresAt: String(row.expires_at)
			};
		})
		.filter((row): row is MasterAccountAssistanceRequest => Boolean(row));
};

const findAuthUserIdByEmail = async (admin: CitaSupabaseClient, email: string) => {
	const normalized = email.trim().toLowerCase();
	for (let page = 1; page <= 20; page += 1) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const user = data.users.find((item) => item.email?.trim().toLowerCase() === normalized);
		if (user?.id) return user.id;
		if (data.users.length < 1000) return null;
	}
	return null;
};

export const ensureMasterSupportUser = async (admin: CitaSupabaseClient) => {
	const supportUserId = await findAuthUserIdByEmail(admin, MASTER_EMAIL);
	if (!supportUserId) {
		throw new Error('ACCOUNT_ASSISTANCE_MASTER_USER_NOT_FOUND');
	}
	const { error } = await admin.from('account_assistance_support_users').upsert(
		{
			user_id: supportUserId,
			email: MASTER_EMAIL,
			enabled: true,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'user_id' }
	);
	if (error) throw error;
	return supportUserId;
};

const firstRpcRow = (data: unknown): AccountAssistanceRow | null =>
	Array.isArray(data) ? normalizeRow(data[0]) : normalizeRow(data);

export const activateAccountAssistance = async ({
	supabase,
	admin,
	businessId,
	kind
}: {
	supabase: CitaSupabaseClient;
	admin: CitaSupabaseClient;
	businessId: string;
	kind: AccountAssistanceKind;
}) => {
	const supportUserId = await ensureMasterSupportUser(admin);
	const { data, error } = await supabase.rpc('start_account_assistance', {
		target_business_id: businessId,
		target_support_user_id: supportUserId,
		target_kind: kind
	});
	if (error) throw error;
	return firstRpcRow(data);
};

export const extendAccountAssistance = async ({
	supabase,
	businessId,
	grantId,
	kind
}: {
	supabase: CitaSupabaseClient;
	businessId: string;
	grantId: string;
	kind: AccountAssistanceKind;
}) => {
	const { data, error } = await supabase.rpc('extend_account_assistance', {
		target_business_id: businessId,
		target_grant_id: grantId,
		target_kind: kind
	});
	if (error) throw error;
	return firstRpcRow(data);
};

/** The owner, or the support user of the grant with its own session; the database checks which. */
export const endAccountAssistance = async ({
	supabase,
	businessId,
	grantId
}: {
	supabase: CitaSupabaseClient;
	businessId: string;
	grantId: string;
}) => {
	const { data, error } = await supabase.rpc('end_account_assistance', {
		target_business_id: businessId,
		target_grant_id: grantId
	});
	if (error) throw error;
	return firstRpcRow(data);
};

export const dismissAccountAssistanceNotice = async ({
	supabase,
	businessId,
	grantId
}: {
	supabase: CitaSupabaseClient;
	businessId: string;
	grantId: string;
}) => {
	const { error } = await supabase.rpc('dismiss_account_assistance_notice', {
		target_business_id: businessId,
		target_grant_id: grantId
	});
	if (error) throw error;
};

export const accountAssistanceErrorMessage = (error: unknown) => {
	const message = errorMessage(error);
	if (message.includes('ACCOUNT_ASSISTANCE_OWNER_REQUIRED')) {
		return 'Solo el dueño del consultorio puede dar o extender esta ayuda.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_BUSINESS_NOT_AVAILABLE')) {
		return 'La cuenta debe estar activa para pedir ayuda de configuración.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_MASTER_USER_NOT_FOUND')) {
		return 'Todavía no podemos activar la ayuda. Contactá a Cita Suite.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_SUPPORT_USER_NOT_ENABLED')) {
		return 'Todavía no podemos activar la ayuda. Contactá a Cita Suite.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_INITIAL_SETUP_UNAVAILABLE')) {
		return 'La configuración inicial se puede dar sólo mientras el consultorio no tiene pacientes. Podés dar ayuda por 1 hora o por 24 horas.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_ALREADY_ACTIVE')) {
		return 'Ya hay una ayuda activa. Podés ver hasta cuándo dura y extenderla desde Ayuda.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_EXTENSION_NOT_ALLOWED')) {
		return 'Esa opción no extiende la ayuda activa. Recargá la página para ver las opciones vigentes.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_NOT_ACTIVE')) {
		return 'La ayuda ya no está activa.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_STILL_ACTIVE')) {
		return 'La ayuda sigue activa. Podés terminarla cuando quieras.';
	}
	return 'No pudimos actualizar la ayuda. Recargá la página y volvé a intentar; si continúa, contactá a Cita Suite.';
};

/** A refusal about the state of the grant is a conflict; one about who acts, a prohibition. */
export const accountAssistanceErrorStatus = (error: unknown) => {
	const message = errorMessage(error);
	if (message.includes('ACCOUNT_ASSISTANCE_OWNER_REQUIRED')) return 403;
	if (
		['NOT_ACTIVE', 'ALREADY_ACTIVE', 'EXTENSION_NOT_ALLOWED', 'INITIAL_SETUP_UNAVAILABLE', 'BUSINESS_NOT_AVAILABLE', 'STILL_ACTIVE'].some((code) =>
			message.includes(`ACCOUNT_ASSISTANCE_${code}`)
		)
	)
		return 409;
	return 500;
};

export const safeAssistanceReturnTo = (value: FormDataEntryValue | null) => {
	const raw = String(value ?? '').trim();
	return raw.startsWith('/odonto') && !raw.startsWith('/odonto/maestro') ? raw : '/odonto/configuracion/ayuda';
};
