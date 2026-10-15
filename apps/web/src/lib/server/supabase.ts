import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

export type Module = 'odonto' | 'administrativo';

export type AuthTokens = {
	access_token: string;
	refresh_token: string;
};

export const MASTER_EMAIL =
	(env.MASTER_EMAIL ?? 'juanpabloaltamira@protonmail.com').trim().toLowerCase();

const normalizeEnv = (value?: string | null) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const WebSocketTransport = WebSocket as unknown as typeof globalThis.WebSocket;

const moduleEmails: Record<Module, string | undefined> = {
	odonto: normalizeEnv(env.SABRINA_EMAIL),
	// administrativo: env.ADMIN_EMAIL
	administrativo: undefined
};

const moduleConfig: Record<
	Module,
	{
		url?: string;
		key?: string;
		serviceRoleKey?: string;
	}
> = {
	odonto: {
		url: normalizeEnv(env.ODONTO_SUPABASE_URL),
		key: normalizeEnv(env.ODONTO_SUPABASE_ANON_KEY),
		serviceRoleKey: normalizeEnv(env.ODONTO_SUPABASE_SERVICE_ROLE_KEY)
	},
	administrativo: {
		url: normalizeEnv(env.ADMIN_SUPABASE_URL),
		key: normalizeEnv(env.ADMIN_SUPABASE_ANON_KEY),
		serviceRoleKey: normalizeEnv(env.ADMIN_SUPABASE_SERVICE_ROLE_KEY)
	}
};

export const resolveModuleByEmail = (email: string): Module | null => {
	const normalized = email.trim().toLowerCase();
	return (Object.entries(moduleEmails).find(([, value]) => value?.toLowerCase() === normalized)?.[0] ??
		null) as Module | null;
};

export const getModuleEntryRoute = (module: Module) =>
	// Administrativo deshabilitado por ahora.
	// module === 'odonto' ? '/odonto/agenda' : '/administrativo/expedientes';
	'/odonto/agenda';

export const isMasterEmail = (email?: string | null) =>
	Boolean(email && email.trim().toLowerCase() === MASTER_EMAIL);

export const createSupabaseServerClient = async (
	module: Module,
	tokens?: AuthTokens | null,
	// fetchImpl es opcional, pero en server preferimos usar fetch global
	// para evitar interferencias con headers/cookies en requests externas.
	fetchImpl?: typeof fetch
): Promise<SupabaseClient> => {
	if (env.DEMO_MODE === 'true') {
		throw new Error('Demo mode: Supabase deshabilitado');
	}
	const config = moduleConfig[module];
	if (!config.url || !config.key) {
		throw new Error(`Faltan variables de entorno de Supabase para el módulo ${module}`);
	}
	try {
		new URL(config.url);
	} catch {
		const label = module === 'odonto' ? 'ODONTO_SUPABASE_URL' : 'ADMIN_SUPABASE_URL';
		throw new Error(`URL inválida en ${label}`);
	}

	const headers: Record<string, string> = { 'X-App-Module': module };
	if (tokens?.access_token) {
		headers.Authorization = `Bearer ${tokens.access_token}`;
	}

	const supabase = createClient(config.url, config.key, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false
		},
		realtime: {
			transport: WebSocketTransport
		},
		global: {
			headers,
			fetch: fetchImpl ?? fetch
		}
	});

	return supabase;
};

const OAUTH_CODE_VERIFIER_COOKIE = 'sb-oauth-code-verifier';

export const clearSupabaseOAuthCookies = (cookies: Cookies) => {
	cookies.delete(OAUTH_CODE_VERIFIER_COOKIE, { path: '/' });
};

export const createSupabaseOAuthClient = async (
	module: Module,
	cookies: Cookies,
	fetchImpl?: typeof fetch
): Promise<SupabaseClient> => {
	if (env.DEMO_MODE === 'true') {
		throw new Error('Demo mode: OAuth deshabilitado');
	}
	const config = moduleConfig[module];
	if (!config.url || !config.key) {
		throw new Error(`Faltan variables de entorno de Supabase para el módulo ${module}`);
	}
	try {
		new URL(config.url);
	} catch {
		const label = module === 'odonto' ? 'ODONTO_SUPABASE_URL' : 'ADMIN_SUPABASE_URL';
		throw new Error(`URL inválida en ${label}`);
	}

	const cookieOptions = {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax' as const,
		maxAge: 10 * 60
	};

	return createClient(config.url, config.key, {
		auth: {
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
			flowType: 'pkce',
			storage: {
				getItem: (key: string) =>
					key.includes('code-verifier') ? (cookies.get(OAUTH_CODE_VERIFIER_COOKIE) ?? null) : null,
				setItem: (key: string, value: string) => {
					if (key.includes('code-verifier')) {
						cookies.set(OAUTH_CODE_VERIFIER_COOKIE, value, cookieOptions);
					}
				},
				removeItem: (key: string) => {
					if (key.includes('code-verifier')) {
						cookies.delete(OAUTH_CODE_VERIFIER_COOKIE, { path: '/' });
					}
				}
			}
		},
		realtime: {
			transport: WebSocketTransport
		},
		global: {
			headers: { 'X-App-Module': module, 'X-Auth-Flow': 'oauth' },
			fetch: fetchImpl ?? fetch
		}
	});
};

export const createSupabaseAdminClient = async (
	module: Module,
	fetchImpl?: typeof fetch
): Promise<SupabaseClient> => {
	if (env.DEMO_MODE === 'true') {
		throw new Error('Demo mode: Supabase admin deshabilitado');
	}
	const config = moduleConfig[module];
	if (!config.url || !config.serviceRoleKey) {
		const label =
			module === 'odonto' ? 'ODONTO_SUPABASE_SERVICE_ROLE_KEY' : 'ADMIN_SUPABASE_SERVICE_ROLE_KEY';
		throw new Error(`Falta ${label} para operaciones server-side privilegiadas`);
	}
	try {
		new URL(config.url);
	} catch {
		const label = module === 'odonto' ? 'ODONTO_SUPABASE_URL' : 'ADMIN_SUPABASE_URL';
		throw new Error(`URL inválida en ${label}`);
	}

	return createClient(config.url, config.serviceRoleKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false
		},
		realtime: {
			transport: WebSocketTransport
		},
		global: {
			headers: { 'X-App-Module': module, 'X-Server-Context': 'admin' },
			fetch: fetchImpl ?? fetch
		}
	});
};

export const decodeJwtPayload = (accessToken?: string | null): Record<string, unknown> | null => {
	if (!accessToken) return null;
	const parts = accessToken.split('.');
	if (parts.length < 2) return null;
	const payload = parts[1];
	const normalized = payload
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(payload.length / 4) * 4, '=');
	try {
		return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
};

export const getJwtExpiry = (accessToken?: string | null): number | null => {
	const payload = decodeJwtPayload(accessToken);
	const exp = payload?.exp;
	return typeof exp === 'number' ? exp : null;
};

export const isJwtExpired = (accessToken?: string | null, skewSeconds = 60): boolean => {
	const exp = getJwtExpiry(accessToken);
	if (!exp) return true;
	return exp * 1000 < Date.now() + skewSeconds * 1000;
};

export const getUserIdFromAccessToken = (accessToken?: string | null): string | null => {
	const decoded = decodeJwtPayload(accessToken);
	const sub = decoded?.sub;
	return typeof sub === 'string' ? sub : null;
};

export const getAuthUserId = async (
	supabase: SupabaseClient,
	accessToken?: string | null
): Promise<string | null> => {
	const ownerId = getUserIdFromAccessToken(accessToken);
	if (ownerId) {
		return ownerId;
	}
	try {
		const { data, error } = await supabase.auth.getUser();
		if (error) {
			console.warn('No se pudo obtener usuario desde Supabase auth', error);
			return null;
		}
		return data?.user?.id ?? null;
	} catch (err) {
		console.warn('Error obteniendo usuario desde Supabase auth', err);
		return null;
	}
};

export const getEmailFromAccessToken = (accessToken?: string | null): string | null => {
	const decoded = decodeJwtPayload(accessToken);
	const email = decoded?.email;
	return typeof email === 'string' ? email : null;
};
