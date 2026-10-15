import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { PUBLIC_SITE_URL_FALLBACK } from '$lib/constants';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import { getBusinessAccessState, type BusinessSubscriptionRow } from './commercial-access';
import { hmacSha256HexMatches } from './hmac';
import { normalizeArgentineWhatsAppPhone, normalizePhoneE164 } from './phone';

export const MESSAGE_DISPATCH_STATUSES = [
	'scheduled',
	'queued',
	'sending',
	'sent',
	'delivered',
	'read',
	'failed',
	'cancelled',
	'skipped'
] as const;

export const MESSAGE_DISPATCH_TYPES = ['appointment_reminder_24h', 'bot_reply', 'manual_test'] as const;

export type MessageDispatchStatus = (typeof MESSAGE_DISPATCH_STATUSES)[number];
export type MessageDispatchType = (typeof MESSAGE_DISPATCH_TYPES)[number];
export type MessagingProviderName = 'mock' | 'meta_cloud' | 'bsp';

export const REMINDER_TEMPLATE_NAME = 'appointment_reminder_24h';
export const BOT_REPLY_TEMPLATE_NAME = 'bot_reply';
export const DEFAULT_REMINDER_TEMPLATE_BODY =
	'Hola {{1}}, te recordamos tu turno en {{2}} el {{3}} a las {{4}}.\n\nPodés confirmar, cancelar o pedir reprogramación acá:\n{{5}}';
export const DEFAULT_BOT_REPLY_TEMPLATE_BODY =
	'Hola. Somos {{business_name}}.\n\nPara sacar turno, entrá acá:\n{{booking_url}}\n\nAhí elegís servicio, profesional, día y horario disponible.\n\nPara hablar con una persona, escribí "asesor".';
export const AUTOMATIC_REMINDERS_ENABLED = env.WHATSAPP_AUTOMATIC_REMINDERS_ENABLED === 'true';

export const dispatchStatusLabels: Record<MessageDispatchStatus, string> = {
	scheduled: 'Programado',
	queued: 'En cola',
	sending: 'Enviando',
	sent: 'Enviado',
	delivered: 'Entregado',
	read: 'Leído',
	failed: 'Falló',
	cancelled: 'Cancelado',
	skipped: 'Omitido'
};

export const dispatchTypeLabels: Record<MessageDispatchType, string> = {
	appointment_reminder_24h: 'Recordatorio de turno',
	bot_reply: 'Respuesta automática',
	manual_test: 'Prueba manual'
};

export type MessagingAccount = {
	id: string;
	business_id: string;
	provider: MessagingProviderName;
	status: 'pending' | 'active' | 'paused' | 'error';
	phone_number: string | null;
	phone_number_id: string | null;
	waba_id: string | null;
	display_name: string | null;
	access_token_secret_name: string | null;
	bot_enabled: boolean;
	reminders_enabled: boolean;
	last_error: string | null;
};

export type MessageTemplate = {
	id: string;
	business_id: string;
	provider: MessagingProviderName;
	provider_template_id: string | null;
	name: string;
	category: 'utility' | 'marketing' | 'authentication' | 'service';
	language: string;
	status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused';
	body: string;
};

export type MessageDispatch = {
	id: string;
	business_id: string;
	appointment_id: string | null;
	patient_id: string | null;
	messaging_account_id: string | null;
	template_id: string | null;
	provider: MessagingProviderName;
	provider_message_id: string | null;
	type: MessageDispatchType;
	to_phone_e164: string;
	status: MessageDispatchStatus;
	template_variables: unknown;
	message_body: string | null;
	attempts: number;
	max_attempts: number;
};

export type SendTemplateInput = {
	account: MessagingAccount;
	to: string;
	templateName: string;
	language: string;
	variables: string[];
};

export type SendFreeFormInput = {
	account: MessagingAccount;
	to: string;
	text: string;
};

export type SendMessageResult = {
	providerMessageId: string;
	raw: unknown;
};

export interface MessagingProvider {
	sendTemplate(input: SendTemplateInput): Promise<SendMessageResult>;
	sendFreeForm(input: SendFreeFormInput): Promise<SendMessageResult>;
}

const toWhatsAppRecipient = (phoneE164: string) => phoneE164.replace(/\D/g, '');

export const getPublicSiteUrl = () => {
	const publicSiteUrl = (publicEnv as Record<string, string | undefined>).PUBLIC_SITE_URL;
	const privateSiteUrl = (env as Record<string, string | undefined>).PUBLIC_SITE_URL;
	const raw = publicSiteUrl?.trim() || privateSiteUrl?.trim() || PUBLIC_SITE_URL_FALLBACK;
	try {
		const parsed = new URL(raw);
		const hostname = parsed.hostname.toLowerCase();
		const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
		if (parsed.protocol !== 'https:' && !isLocalHost) return PUBLIC_SITE_URL_FALLBACK;
		// Un despliegue Cloudflare no debe seguir generando enlaces hacia los
		// hosts históricos: además de confundir al profesional, esos enlaces
		// pueden abrir el turno en otro origen y bloquear sus formularios POST.
		if (
			hostname === 'netlify.app' ||
			hostname.endsWith('.netlify.app') ||
			hostname === 'vercel.app' ||
			hostname.endsWith('.vercel.app')
		) {
			return PUBLIC_SITE_URL_FALLBACK;
		}
	} catch {
		return PUBLIC_SITE_URL_FALLBACK;
	}
	return raw.replace(/\/$/, '');
};

export const getExternalCallbackSiteUrl = () => {
	const raw = getPublicSiteUrl();
	try {
		const url = new URL(raw);
		const hostname = url.hostname.toLowerCase();
		if (url.protocol !== 'https:' || hostname === 'localhost' || hostname === '127.0.0.1') {
			return PUBLIC_SITE_URL_FALLBACK;
		}
		return raw;
	} catch {
		return PUBLIC_SITE_URL_FALLBACK;
	}
};

export const publicAppointmentUrl = (token: string) => `${getPublicSiteUrl()}/turno/${token}`;

// Enlace privado que muestra SOLO el aviso de reprogramación (no la página completa
// de gestión del turno). Lleva el mismo token; el contenido se renderiza minimal.
export const publicRescheduleUrl = (token: string) =>
	`${getPublicSiteUrl()}/turno/${token}/reprogramado`;

export const bookingUrl = (businessId: string) => `${getPublicSiteUrl()}/reservar/${businessId}`;

export const resolveMessagingSecret = (secretName?: string | null) => {
	const key = secretName?.trim() || 'WHATSAPP_ACCESS_TOKEN';
	return env[key]?.trim() || '';
};

export class MockMessagingProvider implements MessagingProvider {
	async sendTemplate(input: SendTemplateInput): Promise<SendMessageResult> {
		return {
			providerMessageId: `mock_${crypto.randomUUID()}`,
			raw: {
				mock: true,
				kind: 'template',
				to: input.to,
				templateName: input.templateName,
				language: input.language,
				variables: input.variables
			}
		};
	}

	async sendFreeForm(input: SendFreeFormInput): Promise<SendMessageResult> {
		return {
			providerMessageId: `mock_${crypto.randomUUID()}`,
			raw: {
				mock: true,
				kind: 'text',
				to: input.to,
				text: input.text
			}
		};
	}
}

export class MetaCloudMessagingProvider implements MessagingProvider {
	private async post(account: MessagingAccount, body: Record<string, unknown>) {
		const accessToken = resolveMessagingSecret(account.access_token_secret_name);
		if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN_MISSING');
		if (!account.phone_number_id) throw new Error('WHATSAPP_PHONE_NUMBER_ID_MISSING');

		const version = env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v21.0';
		const response = await fetch(`https://graph.facebook.com/${version}/${account.phone_number_id}/messages`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			const errorMessage =
				(payload as any)?.error?.message || `WhatsApp respondió con estado ${response.status}`;
			throw new Error(errorMessage);
		}
		const messageId = (payload as any)?.messages?.[0]?.id;
		if (!messageId) throw new Error('WHATSAPP_PROVIDER_MESSAGE_ID_MISSING');
		return { providerMessageId: String(messageId), raw: payload };
	}

	async sendTemplate(input: SendTemplateInput): Promise<SendMessageResult> {
		const parameters = input.variables.map((value) => ({
			type: 'text',
			text: value
		}));
		return this.post(input.account, {
			messaging_product: 'whatsapp',
			to: toWhatsAppRecipient(input.to),
			type: 'template',
			template: {
				name: input.templateName,
				language: { code: input.language },
				components: [{ type: 'body', parameters }]
			}
		});
	}

	async sendFreeForm(input: SendFreeFormInput): Promise<SendMessageResult> {
		return this.post(input.account, {
			messaging_product: 'whatsapp',
			to: toWhatsAppRecipient(input.to),
			type: 'text',
			text: {
				preview_url: true,
				body: input.text
			}
		});
	}
}

export const providerForAccount = (account: MessagingAccount): MessagingProvider => {
	if (account.provider === 'mock') return new MockMessagingProvider();
	if (account.provider === 'meta_cloud') return new MetaCloudMessagingProvider();
	throw new Error('MESSAGING_PROVIDER_NOT_IMPLEMENTED');
};

export const humanMessagingError = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error ?? '');
	if (message.includes('WHATSAPP_ACCESS_TOKEN_MISSING')) return 'Falta configurar el token de WhatsApp.';
	if (message.includes('WHATSAPP_PHONE_NUMBER_ID_MISSING')) return 'Falta configurar el número de WhatsApp.';
	if (message.includes('TEMPLATE_NOT_APPROVED')) return 'El template de recordatorio todavía no está aprobado.';
	if (message.includes('MESSAGING_ACCOUNT_NOT_ACTIVE')) return 'WhatsApp no está conectado o está pausado.';
	if (message.includes('PATIENT_PHONE_MISSING')) return 'El paciente no tiene un teléfono válido.';
	if (message.includes('APPOINTMENT_NOT_REMINDABLE')) return 'El turno ya no corresponde para recordatorio.';
	if (message.includes('MESSAGING_PROVIDER_NOT_IMPLEMENTED')) return 'Ese proveedor de mensajes todavía no está implementado.';
	return 'No pudimos enviar el mensaje. Revisá la configuración de mensajería y volvé a intentar.';
};

export const formatReminderDateTime = (startsAt: string, timeZone: string) => {
	const date = new Date(startsAt);
	const dateLabel = new Intl.DateTimeFormat('es-AR', {
		timeZone,
		weekday: 'long',
		day: '2-digit',
		month: 'long'
	}).format(date);
	const timeLabel = new Intl.DateTimeFormat('es-AR', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit'
	}).format(date);
	return { dateLabel, timeLabel };
};

export const renderTemplateBody = (body: string, variables: string[]) =>
	variables.reduce((text, value, index) => text.replaceAll(`{{${index + 1}}}`, value), body);

export const loadActiveMessagingAccount = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<MessagingAccount | null> => {
	const { data, error } = await supabase
		.from('messaging_accounts')
		.select(
			'id, business_id, provider, status, phone_number, phone_number_id, waba_id, display_name, access_token_secret_name, bot_enabled, reminders_enabled, last_error'
		)
		.eq('business_id', businessId)
		.eq('status', 'active')
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return (data as MessagingAccount | null) ?? null;
};

export const loadReminderTemplate = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<MessageTemplate | null> => {
	const { data, error } = await supabase
		.from('message_templates')
		.select('id, business_id, provider, provider_template_id, name, category, language, status, body')
		.eq('business_id', businessId)
		.eq('name', REMINDER_TEMPLATE_NAME)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return (data as MessageTemplate | null) ?? null;
};

export const loadBotReplyTemplate = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<MessageTemplate | null> => {
	const { data, error } = await supabase
		.from('message_templates')
		.select('id, business_id, provider, provider_template_id, name, category, language, status, body')
		.eq('business_id', businessId)
		.eq('name', BOT_REPLY_TEMPLATE_NAME)
		.eq('status', 'approved')
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return (data as MessageTemplate | null) ?? null;
};

export const ensureMockMessagingSetup = async (supabase: SupabaseClient, businessId: string) => {
	const now = new Date().toISOString();
	const { data: existingAccount, error: existingAccountError } = await supabase
		.from('messaging_accounts')
		.select('id')
		.eq('business_id', businessId)
		.eq('provider', 'mock')
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (existingAccountError) throw existingAccountError;

	const accountPayload = {
		business_id: businessId,
		provider: 'mock',
		status: 'active',
		phone_number: '+5490000000000',
		phone_number_id: `mock-${businessId}`,
		display_name: 'WhatsApp demo',
		bot_enabled: true,
		reminders_enabled: true,
		last_error: null,
		updated_at: now
	};

	const { data: account, error: accountError } = existingAccount?.id
		? await supabase
				.from('messaging_accounts')
				.update(accountPayload)
				.eq('id', existingAccount.id)
				.eq('business_id', businessId)
				.select('id')
				.single()
		: await supabase
				.from('messaging_accounts')
				.insert({
					...accountPayload,
					created_at: now
				})
				.select('id')
				.single();
	if (accountError) throw accountError;

	const { data: existingTemplate, error: existingTemplateError } = await supabase
		.from('message_templates')
		.select('id')
		.eq('business_id', businessId)
		.eq('name', REMINDER_TEMPLATE_NAME)
		.eq('language', 'es_AR')
		.maybeSingle();
	if (existingTemplateError) throw existingTemplateError;

	const templatePayload = {
		business_id: businessId,
		provider: 'mock',
		name: REMINDER_TEMPLATE_NAME,
		category: 'utility',
		language: 'es_AR',
		status: 'approved',
		body: DEFAULT_REMINDER_TEMPLATE_BODY,
		updated_at: now
	};

	const { error: templateError } = existingTemplate?.id
		? await supabase
				.from('message_templates')
				.update(templatePayload)
				.eq('id', existingTemplate.id)
				.eq('business_id', businessId)
		: await supabase
				.from('message_templates')
				.insert({
					...templatePayload,
					created_at: now
				});
	if (templateError) throw templateError;

	const { data: existingBotTemplate, error: existingBotTemplateError } = await supabase
		.from('message_templates')
		.select('id')
		.eq('business_id', businessId)
		.eq('name', BOT_REPLY_TEMPLATE_NAME)
		.eq('language', 'es_AR')
		.maybeSingle();
	if (existingBotTemplateError) throw existingBotTemplateError;

	const botTemplatePayload = {
		business_id: businessId,
		provider: 'mock',
		name: BOT_REPLY_TEMPLATE_NAME,
		category: 'service',
		language: 'es_AR',
		status: 'approved',
		body: DEFAULT_BOT_REPLY_TEMPLATE_BODY,
		updated_at: now
	};

	const { error: botTemplateError } = existingBotTemplate?.id
		? await supabase
				.from('message_templates')
				.update(botTemplatePayload)
				.eq('id', existingBotTemplate.id)
				.eq('business_id', businessId)
		: await supabase
				.from('message_templates')
				.insert({
					...botTemplatePayload,
					created_at: now
				});
	if (botTemplateError) throw botTemplateError;
	return account;
};

const activeDispatchStatuses = new Set<MessageDispatchStatus>([
	'scheduled',
	'queued',
	'sending',
	'sent',
	'delivered',
	'read'
]);

const hasActiveReminderDispatch = async (
	supabase: SupabaseClient,
	businessId: string,
	appointmentId: string
) => {
	const { data, error } = await supabase
		.from('message_dispatches')
		.select('id, status')
		.eq('business_id', businessId)
		.eq('appointment_id', appointmentId)
		.eq('type', REMINDER_TEMPLATE_NAME)
		.is('superseded_at', null);
	if (error) throw error;
	return (data ?? []).some((dispatch: any) => activeDispatchStatuses.has(dispatch.status));
};

const canBusinessUseOperationalMessaging = async (supabase: SupabaseClient, businessId: string) => {
	const { data, error } = await supabase
		.from('business_subscriptions')
		.select(
			'id, business_id, commercial_access_enabled, is_permanent, subscription_status, access_starts_at, paid_until, grace_until, restricted_until, archived_at, last_payment_at, last_payment_amount, last_grant_duration_seconds, expiration_notice_enabled, access_source, access_note, updated_by, created_at, updated_at'
		)
		.eq('business_id', businessId)
		.maybeSingle();

	if (error) {
		// Compatibility-first fallback: if the migration is not available yet,
		// do not break legacy messaging paths.
		console.error('Error cargando suscripción comercial para mensajería', error);
		return true;
	}

	return getBusinessAccessState((data as BusinessSubscriptionRow | null) ?? null, {
		legacyFallback: false
	}).canUseBusiness;
};

export const generateReminderDispatches = async (
	supabase: SupabaseClient,
	input: { businessId?: string | null; now?: Date; limit?: number } = {}
) => {
	if (!AUTOMATIC_REMINDERS_ENABLED) {
		return { created: 0, skipped: 0, failed: 0 };
	}

	const now = input.now ?? new Date();
	const nowIso = now.toISOString();
	let query = supabase
		.from('appointments')
		.select(
			`
			id,
			business_id,
			patient_id,
			starts_at,
			reminder_due_at,
			status,
			confirmation_token,
			patients!inner(id, full_name, phone_e164, blocked),
			businesses!inner(id, name, slug, timezone, is_active, whatsapp_enabled)
		`
		)
		.in('status', ['reserved', 'confirmed'])
		.not('reminder_due_at', 'is', null)
		.lte('reminder_due_at', nowIso)
		.gt('starts_at', nowIso)
		.order('reminder_due_at', { ascending: true })
		.limit(input.limit ?? 50);

	if (input.businessId) query = query.eq('business_id', input.businessId);

	const { data: appointments, error } = await query;
	if (error) throw error;

	let created = 0;
	let skipped = 0;
	let failed = 0;

	for (const appointment of appointments ?? []) {
		try {
			const row = appointment as any;
			const business = row.businesses;
			const patient = row.patients;
			if (!business?.is_active || !business?.whatsapp_enabled) {
				skipped += 1;
				continue;
			}
			if (!(await canBusinessUseOperationalMessaging(supabase, row.business_id))) {
				skipped += 1;
				continue;
			}
			const communicationPhone = normalizeArgentineWhatsAppPhone(patient?.phone_e164);
			if (!communicationPhone || patient.blocked) {
				skipped += 1;
				continue;
			}
			if (await hasActiveReminderDispatch(supabase, row.business_id, row.id)) {
				skipped += 1;
				continue;
			}

			const account = await loadActiveMessagingAccount(supabase, row.business_id);
			const template = await loadReminderTemplate(supabase, row.business_id);
			if (!account?.reminders_enabled || !template || template.status !== 'approved') {
				failed += 1;
				continue;
			}

			const { dateLabel, timeLabel } = formatReminderDateTime(row.starts_at, business.timezone);
			const variables = [
				String(patient.full_name ?? 'Paciente'),
				String(business.name),
				dateLabel,
				timeLabel,
				publicAppointmentUrl(String(row.confirmation_token))
			];
			const body = renderTemplateBody(template.body, variables);
			const { error: insertError } = await supabase.from('message_dispatches').insert({
				business_id: row.business_id,
				appointment_id: row.id,
				patient_id: row.patient_id,
				messaging_account_id: account.id,
				template_id: template.id,
				provider: account.provider,
				channel: 'whatsapp',
				type: REMINDER_TEMPLATE_NAME,
				to_phone_e164: communicationPhone,
				status: 'queued',
				scheduled_for: row.reminder_due_at,
				queued_at: nowIso,
				template_variables: variables,
				message_body: body,
				metadata: {
					source: 'reminder_due_at',
					appointment_starts_at: row.starts_at
				}
			});
			if (insertError) {
				if (insertError.code === '23505') {
					skipped += 1;
					continue;
				}
				throw insertError;
			}
			created += 1;
		} catch (err) {
			console.error('Error generando dispatch de recordatorio', err);
			failed += 1;
		}
	}

	return { checked: appointments?.length ?? 0, created, skipped, failed };
};

const failDispatch = async (
	supabase: SupabaseClient,
	dispatch: Pick<MessageDispatch, 'id' | 'business_id' | 'attempts' | 'max_attempts'>,
	error: unknown,
	now: Date
) => {
	const status: MessageDispatchStatus = dispatch.attempts >= dispatch.max_attempts ? 'failed' : 'queued';
	const message = error instanceof Error ? error.message : String(error ?? 'UNKNOWN');
	await supabase
		.from('message_dispatches')
		.update({
			status,
			failed_at: status === 'failed' ? now.toISOString() : null,
			last_error_code: message.slice(0, 120),
			last_error_message: message.slice(0, 1000),
			human_error_message: humanMessagingError(error),
			updated_at: now.toISOString()
		})
		.eq('id', dispatch.id)
		.eq('business_id', dispatch.business_id);
};

const skipDispatch = async (
	supabase: SupabaseClient,
	dispatch: Pick<MessageDispatch, 'id' | 'business_id'>,
	reason: string,
	now: Date
) => {
	await supabase
		.from('message_dispatches')
		.update({
			status: 'skipped',
			skipped_at: now.toISOString(),
			last_error_code: reason,
			human_error_message: humanMessagingError(new Error(reason)),
			updated_at: now.toISOString()
		})
		.eq('id', dispatch.id)
		.eq('business_id', dispatch.business_id);
};

export const processQueuedMessageDispatches = async (
	supabase: SupabaseClient,
	input: { now?: Date; limit?: number } = {}
) => {
	const now = input.now ?? new Date();
	const { data: claimed, error } = await supabase.rpc('claim_queued_message_dispatches', {
		claim_limit: input.limit ?? 20,
		claim_now: now.toISOString()
	});
	if (error) throw error;

	let sent = 0;
	let failed = 0;
	let skipped = 0;

	for (const dispatch of (claimed ?? []) as MessageDispatch[]) {
		try {
			if (!(await canBusinessUseOperationalMessaging(supabase, dispatch.business_id))) {
				await skipDispatch(supabase, dispatch, 'BUSINESS_ACCESS_RESTRICTED', now);
				skipped += 1;
				continue;
			}

			const { data: account, error: accountError } = await supabase
				.from('messaging_accounts')
				.select(
					'id, business_id, provider, status, phone_number, phone_number_id, waba_id, display_name, access_token_secret_name, bot_enabled, reminders_enabled, last_error'
				)
				.eq('business_id', dispatch.business_id)
				.eq('id', dispatch.messaging_account_id)
				.maybeSingle();
			if (accountError) throw accountError;
			if (!account || account.status !== 'active') throw new Error('MESSAGING_ACCOUNT_NOT_ACTIVE');

			let template: MessageTemplate | null = null;
			if (dispatch.template_id) {
				const { data: templateData, error: templateError } = await supabase
					.from('message_templates')
					.select('id, business_id, provider, provider_template_id, name, category, language, status, body')
					.eq('business_id', dispatch.business_id)
					.eq('id', dispatch.template_id)
					.maybeSingle();
				if (templateError) throw templateError;
				template = (templateData as MessageTemplate | null) ?? null;
			}

			if (dispatch.appointment_id) {
				const { data: appointment, error: appointmentError } = await supabase
					.from('appointments')
					.select('id, status')
					.eq('business_id', dispatch.business_id)
					.eq('id', dispatch.appointment_id)
					.maybeSingle();
				if (appointmentError) throw appointmentError;
				if (!appointment || !['reserved', 'confirmed'].includes(String(appointment.status))) {
					await skipDispatch(supabase, dispatch, 'APPOINTMENT_NOT_REMINDABLE', now);
					skipped += 1;
					continue;
				}
			}

			if (dispatch.type === 'appointment_reminder_24h' && (!template || template.status !== 'approved')) {
				throw new Error('TEMPLATE_NOT_APPROVED');
			}

			const communicationPhone = normalizeArgentineWhatsAppPhone(dispatch.to_phone_e164);
			if (!communicationPhone) {
				await skipDispatch(supabase, dispatch, 'PHONE_NOT_USABLE', now);
				skipped += 1;
				continue;
			}

			const provider = providerForAccount(account as MessagingAccount);
			const variables = Array.isArray(dispatch.template_variables)
				? (dispatch.template_variables as string[])
				: [];
			const result =
				dispatch.type === 'appointment_reminder_24h' && template
					? await provider.sendTemplate({
							account: account as MessagingAccount,
							to: communicationPhone,
							templateName: template.name,
							language: template.language,
							variables
						})
					: await provider.sendFreeForm({
							account: account as MessagingAccount,
							to: communicationPhone,
							text: dispatch.message_body ?? ''
						});

			await supabase
				.from('message_dispatches')
				.update({
					status: 'sent',
					provider_message_id: result.providerMessageId,
					sent_at: now.toISOString(),
					raw_response: result.raw,
					last_error_code: null,
					last_error_message: null,
					human_error_message: null,
					updated_at: now.toISOString()
				})
				.eq('id', dispatch.id)
				.eq('business_id', dispatch.business_id);

			await writeAuditLog(supabase, {
				businessId: dispatch.business_id,
				userId: null,
				action: dispatch.type === 'appointment_reminder_24h' ? 'appointment.reminder_sent' : 'message.sent',
				entityType: 'message_dispatch',
				entityId: dispatch.id,
				metadata: {
					appointment_id: dispatch.appointment_id,
					provider_message_id: result.providerMessageId,
					type: dispatch.type
				}
			});

			sent += 1;
		} catch (err) {
			console.error('Error procesando dispatch', err);
			await failDispatch(supabase, dispatch, err, now);
			failed += 1;
		}
	}

	return { claimed: claimed?.length ?? 0, sent, failed, skipped };
};

const providerStatusRank: Record<MessageDispatchStatus, number> = {
	scheduled: 0,
	queued: 1,
	sending: 2,
	sent: 3,
	delivered: 4,
	read: 5,
	failed: 6,
	cancelled: 7,
	skipped: 8
};

export const applyProviderMessageStatus = async (
	supabase: SupabaseClient,
	input: {
		providerMessageId: string;
		status: 'sent' | 'delivered' | 'read' | 'failed';
		raw?: unknown;
		errorMessage?: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const { data: dispatch, error } = await supabase
		.from('message_dispatches')
		.select('id, business_id, status, appointment_id')
		.eq('provider_message_id', input.providerMessageId)
		.maybeSingle();
	if (error) throw error;
	if (!dispatch) return { updated: false };

	const currentStatus = String(dispatch.status) as MessageDispatchStatus;
	if (input.status !== 'failed' && providerStatusRank[currentStatus] > providerStatusRank[input.status]) {
		return { updated: false };
	}

	const updates: Record<string, unknown> = {
		status: input.status,
		raw_response: input.raw ?? null,
		updated_at: now.toISOString()
	};
	if (input.status === 'sent') updates.sent_at = now.toISOString();
	if (input.status === 'delivered') updates.delivered_at = now.toISOString();
	if (input.status === 'read') updates.read_at = now.toISOString();
	if (input.status === 'failed') {
		updates.failed_at = now.toISOString();
		updates.last_error_message = input.errorMessage ?? 'El proveedor informó un fallo.';
		updates.human_error_message = humanMessagingError(new Error(input.errorMessage ?? 'PROVIDER_FAILED'));
	}

	const { error: updateError } = await supabase
		.from('message_dispatches')
		.update(updates)
		.eq('id', dispatch.id)
		.eq('business_id', dispatch.business_id);
	if (updateError) throw updateError;

	await writeAuditLog(supabase, {
		businessId: dispatch.business_id,
		userId: null,
		action: `message.${input.status}`,
		entityType: 'message_dispatch',
		entityId: dispatch.id,
		metadata: {
			appointment_id: dispatch.appointment_id,
			provider_message_id: input.providerMessageId
		}
	});

	return { updated: true };
};

export const isHumanRequest = (text?: string | null) =>
	/\b(asesor|humano|persona|recepci[oó]n|secretar[ií]a|hablar|ayuda)\b/i.test(text ?? '');

export const renderBotReplyBody = (body: string, business: { id: string; name: string }) =>
	body
		.replaceAll('{{business_name}}', business.name)
		.replaceAll('{{booking_url}}', bookingUrl(business.id));

export const buildBotReplyText = (
	business: { id: string; name: string },
	body = DEFAULT_BOT_REPLY_TEMPLATE_BODY
) => renderBotReplyBody(body, business);

export const sendBotBookingLinkReply = async (
	supabase: SupabaseClient,
	input: {
		account: MessagingAccount;
		business: { id: string; name: string; slug: string };
		toPhoneE164: string;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	const template = await loadBotReplyTemplate(supabase, input.business.id);
	const text = buildBotReplyText(input.business, template?.body ?? DEFAULT_BOT_REPLY_TEMPLATE_BODY);
	const { data: dispatch, error: insertError } = await supabase
		.from('message_dispatches')
		.insert({
			business_id: input.business.id,
			messaging_account_id: input.account.id,
			provider: input.account.provider,
			channel: 'whatsapp',
			type: 'bot_reply',
			to_phone_e164: input.toPhoneE164,
			status: 'sending',
			sending_at: now.toISOString(),
			message_body: text,
			metadata: { source: 'inbound_bot' }
		})
		.select('id')
		.single();
	if (insertError) throw insertError;

	try {
		const result = await providerForAccount(input.account).sendFreeForm({
			account: input.account,
			to: input.toPhoneE164,
			text
		});
		await supabase
			.from('message_dispatches')
			.update({
				status: 'sent',
				provider_message_id: result.providerMessageId,
				sent_at: now.toISOString(),
				raw_response: result.raw,
				updated_at: now.toISOString()
			})
			.eq('id', dispatch.id)
			.eq('business_id', input.business.id);
		await writeAuditLog(supabase, {
			businessId: input.business.id,
			userId: null,
			action: 'bot.booking_link_sent',
			entityType: 'message_dispatch',
			entityId: dispatch.id,
			metadata: { to_phone_e164: input.toPhoneE164 }
		});
		return { sent: true };
	} catch (err) {
		await failDispatch(
			supabase,
			{ id: dispatch.id, business_id: input.business.id, attempts: 1, max_attempts: 1 },
			err,
			now
		);
		throw err;
	}
};

const eventTimestamp = (timestamp?: string | number | null) => {
	if (!timestamp) return new Date();
	const numeric = Number(timestamp);
	if (!Number.isFinite(numeric)) return new Date();
	return new Date(numeric * 1000);
};

export const processWhatsAppWebhookPayload = async (
	supabase: SupabaseClient,
	payload: any,
	now = new Date()
) => {
	let events = 0;
	let inbound = 0;
	let statuses = 0;
	let botReplies = 0;

	for (const entry of payload?.entry ?? []) {
		for (const change of entry?.changes ?? []) {
			const value = change?.value ?? {};
			const phoneNumberId = value?.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : null;
			const { data: account } = phoneNumberId
				? await supabase
						.from('messaging_accounts')
						.select(
							'id, business_id, provider, status, phone_number, phone_number_id, waba_id, display_name, access_token_secret_name, bot_enabled, reminders_enabled, last_error, businesses!inner(id, name, slug, is_active)'
						)
						.eq('phone_number_id', phoneNumberId)
						.maybeSingle()
				: { data: null };

			for (const message of value?.messages ?? []) {
				const providerEventId = String(message.id ?? crypto.randomUUID());
				const eventPayload = { entry, change, message };
				const { data: event } = await supabase
					.from('whatsapp_webhook_events')
					.upsert(
						{
							provider: 'meta_cloud',
							business_id: account?.business_id ?? null,
							messaging_account_id: account?.id ?? null,
							provider_event_id: providerEventId,
							event_type: 'message',
							payload: eventPayload,
							received_at: now.toISOString()
						},
						{ onConflict: 'provider,provider_event_id' }
					)
					.select('id')
					.maybeSingle();
				events += 1;

				try {
					const accountRow = account as
						| (MessagingAccount & { businesses?: { id: string; name: string; slug: string; is_active: boolean } })
						| null;
					if (!accountRow?.business_id) throw new Error('MESSAGING_ACCOUNT_NOT_FOUND');
					const text = message?.text?.body ? String(message.text.body) : '';
					const fromPhone = normalizePhoneE164(String(message.from ?? ''));
					if (!fromPhone) throw new Error('INBOUND_PHONE_INVALID');
					const requiresHuman = isHumanRequest(text);
					await supabase.from('inbound_messages').upsert(
						{
							business_id: accountRow.business_id,
							messaging_account_id: accountRow.id,
							provider: accountRow.provider,
							provider_message_id: providerEventId,
							from_phone_e164: fromPhone,
							text: text || null,
							requires_human: requiresHuman,
							raw_payload: message,
							received_at: eventTimestamp(message.timestamp).toISOString()
						},
						{ onConflict: 'provider,provider_message_id' }
					);
					inbound += 1;

					await writeAuditLog(supabase, {
						businessId: accountRow.business_id,
						userId: null,
						action: 'inbound.message_received',
						entityType: 'inbound_message',
						entityId: null,
						metadata: { provider_message_id: providerEventId, requires_human: requiresHuman }
					});

					if (
						!requiresHuman &&
						accountRow.status === 'active' &&
						accountRow.bot_enabled &&
						accountRow.businesses?.is_active &&
						(await canBusinessUseOperationalMessaging(supabase, accountRow.business_id))
					) {
						await sendBotBookingLinkReply(supabase, {
							account: accountRow,
							business: accountRow.businesses,
							toPhoneE164: fromPhone,
							now
						});
						botReplies += 1;
					}

					if (event?.id) {
						await supabase
							.from('whatsapp_webhook_events')
							.update({ processed: true, processed_at: now.toISOString(), processing_error: null })
							.eq('id', event.id);
					}
				} catch (err) {
					if (event?.id) {
						await supabase
							.from('whatsapp_webhook_events')
							.update({
								processed: false,
								processing_error: err instanceof Error ? err.message : String(err),
								processed_at: now.toISOString()
							})
							.eq('id', event.id);
					}
				}
			}

			for (const statusEvent of value?.statuses ?? []) {
				const statusId = String(statusEvent.id ?? crypto.randomUUID());
				const providerEventId = `${statusId}:${String(statusEvent.status ?? 'status')}:${String(statusEvent.timestamp ?? '')}`;
				const eventPayload = { entry, change, status: statusEvent };
				const { data: event } = await supabase
					.from('whatsapp_webhook_events')
					.upsert(
						{
							provider: 'meta_cloud',
							business_id: account?.business_id ?? null,
							messaging_account_id: account?.id ?? null,
							provider_event_id: providerEventId,
							event_type: 'status',
							payload: eventPayload,
							received_at: now.toISOString()
						},
						{ onConflict: 'provider,provider_event_id' }
					)
					.select('id')
					.maybeSingle();
				events += 1;

				try {
					const providerStatus = String(statusEvent.status ?? '');
					if (['sent', 'delivered', 'read', 'failed'].includes(providerStatus)) {
						await applyProviderMessageStatus(supabase, {
							providerMessageId: statusId,
							status: providerStatus as 'sent' | 'delivered' | 'read' | 'failed',
							raw: statusEvent,
							errorMessage: statusEvent?.errors?.[0]?.title ?? statusEvent?.errors?.[0]?.message ?? null,
							now: eventTimestamp(statusEvent.timestamp)
						});
						statuses += 1;
					}
					if (event?.id) {
						await supabase
							.from('whatsapp_webhook_events')
							.update({ processed: true, processed_at: now.toISOString(), processing_error: null })
							.eq('id', event.id);
					}
				} catch (err) {
					if (event?.id) {
						await supabase
							.from('whatsapp_webhook_events')
							.update({
								processed: false,
								processing_error: err instanceof Error ? err.message : String(err),
								processed_at: now.toISOString()
							})
							.eq('id', event.id);
					}
				}
			}
		}
	}

	return { events, inbound, statuses, botReplies };
};

export const verifyWebhookSignature = (body: string, signatureHeader?: string | null) => {
	const secret = env.WHATSAPP_APP_SECRET?.trim();
	// Falla-cerrado: sin el app secret no podemos verificar la firma, así que se
	// rechaza. El webhook es un endpoint público y se procesa con cliente admin;
	// aceptar sin verificar permitiría payloads forjados.
	if (!secret) return false;
	if (!signatureHeader?.startsWith('sha256=')) return false;
	return hmacSha256HexMatches(secret, body, signatureHeader.slice(7));
};
