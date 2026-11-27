import { fail } from '@sveltejs/kit';
import { isRecord, readBoolean, readChoice, readNullableText, readRecord, readText } from '$lib/contracts/json';
import { logServerFailure } from '$lib/server/platform/logging';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';
import type { Actions, PageServerLoad } from './$types';

export type UnsubscribePublicContact = {
	phone: string | null;
	whatsappPhone: string | null;
	whatsappUrl: string | null;
	whatsappWebUrl: string | null;
};

const UNSUBSCRIBE_WHATSAPP_MESSAGE = 'Hola, quiero dejar de recibir correos automáticos del consultorio.';

const readPublicContact = (value: unknown): UnsubscribePublicContact => {
	const raw = isRecord(value) ? value : {};
	const phone = readNullableText(raw.phone ?? null, 'email.unsubscribe.contact.phone');
	const rawWhatsApp = readNullableText(raw.whatsapp_phone ?? null, 'email.unsubscribe.contact.whatsapp');
	const whatsappPhone = normalizeArgentineWhatsAppPhone(rawWhatsApp);
	return {
		phone,
		whatsappPhone,
		whatsappUrl: whatsappPhone ? buildWaMeUrl(whatsappPhone, UNSUBSCRIBE_WHATSAPP_MESSAGE) : null,
		whatsappWebUrl: whatsappPhone ? buildWhatsAppWebUrl(whatsappPhone, UNSUBSCRIBE_WHATSAPP_MESSAGE) : null
	};
};

const readAppliedUnsubscribe = (value: unknown) => {
	const row = readRecord(value, 'email.unsubscribe');
	return {
		businessName: readText(row.business_name, 'email.unsubscribe.business'),
		unsubscribed: readBoolean(row.unsubscribed, 'email.unsubscribe.state')
	};
};

const readUnsubscribeState = (value: unknown) => {
	const row = readRecord(value, 'email.unsubscribe.state');
	const status = readChoice(row.status, ['active', 'expired', 'invalid'] as const, 'email.unsubscribe.status');
	if (status === 'invalid') {
		return { available: false as const, unavailableReason: 'invalid' as const, businessName: null, contact: null };
	}
	if (status === 'expired') {
		return {
			available: false as const,
			unavailableReason: 'expired' as const,
			businessName: readNullableText(row.business_name ?? null, 'email.unsubscribe.business'),
			contact: readPublicContact(row.contact)
		};
	}
	return {
		available: true as const,
		businessName: readText(row.business_name, 'email.unsubscribe.business'),
		unsubscribed: readBoolean(row.unsubscribed, 'email.unsubscribe.state'),
		contact: readPublicContact(row.contact)
	};
};

// Opening this page changes nothing: mail scanners follow links. Only the POST below unsubscribes.
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow, noarchive' });
	const supabase = await createSupabaseAdminClient('odonto');
	const { data, error } = await supabase.rpc('get_email_unsubscribe_state', { p_token: params.token });
	if (error) {
		logServerFailure('email.unsubscribe_read_failed', error);
		return { available: false as const, unavailableReason: 'error' as const, businessName: null, contact: null };
	}
	if (data === null) {
		return { available: false as const, unavailableReason: 'invalid' as const, businessName: null, contact: null };
	}
	return readUnsubscribeState(data);
};

// Also the target of one-click unsubscribe, which mail clients post from their servers.
export const actions: Actions = {
	default: async ({ params }) => {
		const supabase = await createSupabaseAdminClient('odonto');
		const { data, error } = await supabase.rpc('apply_email_unsubscribe', { p_token: params.token });
		if (error) {
			logServerFailure('email.unsubscribe_failed', error);
			return fail(400, {
				message: 'No pudimos registrar tu pedido. Volvé a intentar o pedile la baja al consultorio por WhatsApp o por teléfono.'
			});
		}
		return { done: true, ...readAppliedUnsubscribe(data) };
	}
};
