// Enlaces para abrir un chat de WhatsApp con un mensaje ya escrito. Son puros: los
// usan el servidor y el navegador, así que no hay una segunda copia en ningún lado.
// El número llega normalizado (E.164). Un mensaje vacío abre el chat sin texto.

const digitsOf = (phoneE164: string) => phoneE164.replace(/\D/g, '');

export const buildWaMeUrl = (phoneE164: string, message: string): string =>
	`https://wa.me/${digitsOf(phoneE164)}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

export const buildWhatsAppWebUrl = (phoneE164: string, message: string): string =>
	`https://web.whatsapp.com/send?phone=${digitsOf(phoneE164)}${message ? `&text=${encodeURIComponent(message)}` : ''}`;
