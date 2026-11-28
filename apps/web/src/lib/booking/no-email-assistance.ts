import { buildWaMeUrl, buildWhatsAppWebUrl } from '$lib/utils/whatsapp';

export type NoEmailWhatsAppInput = {
	patientName?: string | null;
	serviceName?: string | null;
	modalityLabel?: string | null;
	dateLabel?: string | null;
	timeLabel?: string | null;
};

export type NoEmailWhatsAppLinks = {
	message: string;
	whatsappUrl: string;
	whatsappWebUrl: string;
};

const clean = (value: string | null | undefined) =>
	String(value ?? '')
		.trim()
		.replace(/\s+/g, ' ');

/**
 * Construye el mensaje prearmado para pedir un turno por WhatsApp cuando el paciente
 * no tiene correo electrónico. Incluye únicamente lo que el paciente escribió o eligió.
 */
export const buildNoEmailWhatsAppMessage = (input: NoEmailWhatsAppInput): string => {
	const name = clean(input.patientName);
	const service = clean(input.serviceName);
	const modality = clean(input.modalityLabel);
	const date = clean(input.dateLabel);
	const time = clean(input.timeLabel);

	const greeting = name ? `Hola, soy ${name}.` : 'Hola.';
	const parts: string[] = ['No tengo correo electrónico y quiero pedir un turno'];
	if (service) {
		parts.push(modality ? `para ${service} (${modality})` : `para ${service}`);
	} else if (modality) {
		parts.push(`(${modality})`);
	}
	if (date && time) parts.push(`el ${date} a las ${time}`);
	else if (date) parts.push(`para el ${date}`);
	return `${greeting} ${parts.join(' ')}.`;
};

export const buildNoEmailWhatsAppLinks = (
	whatsappPhoneE164: string | null | undefined,
	input: NoEmailWhatsAppInput
): NoEmailWhatsAppLinks | null => {
	const phone = clean(whatsappPhoneE164);
	if (!phone || !phone.replace(/\D/g, '')) return null;
	const message = buildNoEmailWhatsAppMessage(input);
	return {
		message,
		whatsappUrl: buildWaMeUrl(phone, message),
		whatsappWebUrl: buildWhatsAppWebUrl(phone, message)
	};
};
