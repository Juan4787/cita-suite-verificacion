// Central platform support WhatsApp configuration (P2).
// Never hardcoded in source code or repository; configured exclusively via Cloudflare Worker
// secret SUPPORT_WHATSAPP_PHONE (or local .env). When unset or invalid, callers hide the button.
import { env } from '$env/dynamic/private';
import { normalizeArgentineWhatsAppPhone } from '$lib/utils/phone';
import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';

export type SupportWhatsAppLinks = {
	whatsappUrl: string;
	whatsappWebUrl: string;
	message: string;
};

export const buildSupportWhatsAppLinks = (input: {
	businessName: string;
	topic: string;
}): SupportWhatsAppLinks | null => {
	const phone = normalizeArgentineWhatsAppPhone(env.SUPPORT_WHATSAPP_PHONE);
	if (!phone) return null;
	const business = input.businessName.trim() || 'mi consultorio';
	const topic = input.topic.trim() || 'esta configuración';
	const message = `Hola, te escribo desde ${business} en Cita Suite. Tengo una consulta sobre ${topic}.`;
	return {
		whatsappUrl: buildWaMeUrl(phone, message),
		whatsappWebUrl: buildWhatsAppWebUrl(phone, message),
		message
	};
};
