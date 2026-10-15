import { MASTER_EMAIL } from './supabase';
import type { BusinessRole } from './business';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ACCOUNT_ASSISTANCE_DURATION_MINUTES = 60;
export const ACCOUNT_ASSISTANCE_FINAL_NOTICE_HOURS = 24;

export type AccountAssistanceRow = {
	id: string;
	business_id: string;
	requested_by_user_id: string;
	support_user_id: string;
	status: 'active' | 'expired' | 'revoked' | string;
	starts_at: string;
	expires_at: string;
	revoked_at: string | null;
	dismissed_at: string | null;
	created_at: string;
	updated_at: string;
};

export type AccountAssistanceViewStatus = 'available' | 'active' | 'expired' | 'revoked';

export type AccountAssistanceView = {
	status: AccountAssistanceViewStatus;
	grantId: string | null;
	showBanner: boolean;
	canActivate: boolean;
	canRevoke: boolean;
	canDismiss: boolean;
	expiresAt: string | null;
	endsAtLabel: string | null;
	endedAt: string | null;
};

export type MasterAccountAssistanceRequest = {
	id: string;
	businessId: string;
	businessName: string;
	businessSlug: string;
	expiresAt: string;
};

const ASSISTANCE_SELECT =
	'id, business_id, requested_by_user_id, support_user_id, status, starts_at, expires_at, revoked_at, dismissed_at, created_at, updated_at';

const normalizeRow = (row: any): AccountAssistanceRow | null => {
	if (!row?.id || !row?.business_id || !row?.requested_by_user_id || !row?.support_user_id) return null;
	return {
		id: String(row.id),
		business_id: String(row.business_id),
		requested_by_user_id: String(row.requested_by_user_id),
		support_user_id: String(row.support_user_id),
		status: String(row.status ?? 'active'),
		starts_at: String(row.starts_at ?? ''),
		expires_at: String(row.expires_at ?? ''),
		revoked_at: row.revoked_at ? String(row.revoked_at) : null,
		dismissed_at: row.dismissed_at ? String(row.dismissed_at) : null,
		created_at: String(row.created_at ?? ''),
		updated_at: String(row.updated_at ?? '')
	};
};

const errorMessage = (error: unknown) =>
	typeof error === 'object' && error !== null && 'message' in error
		? String((error as { message?: unknown }).message ?? '')
		: String(error ?? '');

const isMissingSchemaError = (error: unknown) => {
	const message = errorMessage(error).toLowerCase();
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code?: unknown }).code ?? '')
			: '';
	return (
		code === '42P01' ||
		code === 'PGRST205' ||
		message.includes('account_assistance') ||
		message.includes('could not find the table')
	);
};

export const formatAccountAssistanceLocalTime = (value: string, timeZone: string) =>
	new Intl.DateTimeFormat('es-AR', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(value));

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
	isAssisting = false
}: {
	grant: AccountAssistanceRow | null;
	role: BusinessRole | null | undefined;
	timeZone: string;
	now?: Date;
	canUseBusiness?: boolean;
	isAssisting?: boolean;
}): AccountAssistanceView => {
	const isOwner = role === 'owner' && !isAssisting;
	const available: AccountAssistanceView = {
		status: 'available',
		grantId: null,
		showBanner: isOwner && canUseBusiness,
		canActivate: isOwner && canUseBusiness,
		canRevoke: false,
		canDismiss: false,
		expiresAt: null,
		endsAtLabel: null,
		endedAt: null
	};
	if (!grant) return available;

	const expiresAt = parseDate(grant.expires_at);
	const revokedAt = parseDate(grant.revoked_at);
	const dismissedAt = parseDate(grant.dismissed_at);
	const isActive = grant.status === 'active' && !revokedAt && expiresAt !== null && expiresAt > now;
	if (isActive) {
		return {
			status: 'active',
			grantId: grant.id,
			showBanner: isOwner && canUseBusiness,
			canActivate: false,
			canRevoke: isOwner,
			canDismiss: false,
			expiresAt: grant.expires_at,
			endsAtLabel: formatAccountAssistanceLocalTime(grant.expires_at, timeZone),
			endedAt: null
		};
	}

	const status: AccountAssistanceViewStatus = revokedAt || grant.status === 'revoked' ? 'revoked' : 'expired';
	const endedAt = (status === 'revoked' ? grant.revoked_at : grant.expires_at) ?? grant.updated_at;
	const endedDate = parseDate(endedAt);
	const withinNoticeWindow = Boolean(
		endedDate && endedDate <= now && endedDate > addHours(now, -ACCOUNT_ASSISTANCE_FINAL_NOTICE_HOURS)
	);
	const canDismissFinalState = isOwner && canUseBusiness && withinNoticeWindow && !dismissedAt;

	return {
		status,
		grantId: grant.id,
		// El estado final sigue disponible en la página de detalle, pero no queda
		// fijado globalmente después de que el permiso ya terminó.
		showBanner: false,
		canActivate: isOwner && canUseBusiness,
		canRevoke: false,
		canDismiss: canDismissFinalState,
		expiresAt: grant.expires_at,
		endsAtLabel: grant.expires_at ? formatAccountAssistanceLocalTime(grant.expires_at, timeZone) : null,
		endedAt
	};
};

export const loadLatestAccountAssistanceGrant = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<AccountAssistanceRow | null> => {
	try {
		const { data, error } = await supabase
			.from('account_assistance_grants')
			.select(ASSISTANCE_SELECT)
			.eq('business_id', businessId)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) {
			if (!isMissingSchemaError(error)) console.error('Error cargando ayuda para configurar', error);
			return null;
		}
		return normalizeRow(data);
	} catch (error) {
		if (!isMissingSchemaError(error)) console.error('Error cargando ayuda para configurar', error);
		return null;
	}
};

export const loadAccountAssistanceView = async ({
	supabase,
	businessId,
	role,
	timeZone,
	canUseBusiness,
	isAssisting
}: {
	supabase: SupabaseClient;
	businessId: string;
	role: BusinessRole | null | undefined;
	timeZone: string;
	canUseBusiness: boolean;
	isAssisting?: boolean;
}): Promise<AccountAssistanceView> => {
	const grant = await loadLatestAccountAssistanceGrant(supabase, businessId);
	return buildAccountAssistanceView({
		grant,
		role,
		timeZone,
		canUseBusiness,
		isAssisting: Boolean(isAssisting)
	});
};

export const loadActiveMasterAccountAssistanceRequests = async ({
	admin,
	supportUserId,
	now = new Date()
}: {
	admin: SupabaseClient;
	supportUserId: string;
	now?: Date;
}): Promise<MasterAccountAssistanceRequest[]> => {
	const { data, error } = await admin
		.from('account_assistance_grants')
		.select('id, business_id, expires_at, business:businesses(id, name, slug)')
		.eq('support_user_id', supportUserId)
		.eq('status', 'active')
		.is('revoked_at', null)
		.gt('expires_at', now.toISOString())
		.order('expires_at', { ascending: true });
	if (error) {
		if (!isMissingSchemaError(error)) console.error('Error cargando solicitudes de ayuda activas', error);
		return [];
	}

	return ((data ?? []) as any[])
		.map((row) => {
			const business = Array.isArray(row.business) ? row.business[0] : row.business;
			if (!row?.id || !row?.business_id || !row?.expires_at) return null;
			return {
				id: String(row.id),
				businessId: String(row.business_id),
				businessName: String(business?.name ?? 'Consultorio'),
				businessSlug: String(business?.slug ?? ''),
				expiresAt: String(row.expires_at)
			};
		})
		.filter((row): row is MasterAccountAssistanceRequest => Boolean(row));
};

const findAuthUserIdByEmail = async (admin: SupabaseClient, email: string) => {
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

export const ensureMasterSupportUser = async (admin: SupabaseClient) => {
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
	businessId
}: {
	supabase: SupabaseClient;
	admin: SupabaseClient;
	businessId: string;
}) => {
	const supportUserId = await ensureMasterSupportUser(admin);
	const { data, error } = await supabase.rpc('activate_account_assistance', {
		target_business_id: businessId,
		target_support_user_id: supportUserId
	});
	if (error) throw error;
	return firstRpcRow(data);
};

export const revokeAccountAssistance = async ({
	supabase,
	businessId
}: {
	supabase: SupabaseClient;
	businessId: string;
}) => {
	const { data, error } = await supabase.rpc('revoke_account_assistance', {
		target_business_id: businessId
	});
	if (error) throw error;
	return firstRpcRow(data);
};

export const dismissAccountAssistanceNotice = async ({
	supabase,
	businessId,
	grantId
}: {
	supabase: SupabaseClient;
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
		return 'Solo el dueño del consultorio puede activar o detener esta ayuda.';
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
	if (message.includes('ACCOUNT_ASSISTANCE_NOT_ACTIVE')) {
		return 'La ayuda ya no está activa.';
	}
	if (message.includes('ACCOUNT_ASSISTANCE_STILL_ACTIVE')) {
		return 'La ayuda sigue activa. Podés detenerla cuando quieras.';
	}
	return 'No pudimos actualizar la ayuda para configurar. Recargá la página y volvé a intentar; si continúa, contactá a Cita Suite.';
};

export const safeAssistanceReturnTo = (value: FormDataEntryValue | null) => {
	const raw = String(value ?? '').trim();
	return raw.startsWith('/odonto') && !raw.startsWith('/odonto/maestro') ? raw : '/odonto/configuracion/ayuda';
};
