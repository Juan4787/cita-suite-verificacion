import { describe, expect, it } from 'vitest';
import { buildWaMeUrl, buildWhatsAppWebUrl } from './whatsapp';

describe('enlaces de WhatsApp sin código de servidor', () => {
	it('usa el número sin signos y codifica todo el mensaje', () => {
		const message = 'Hola, soy Ana & Co.\nTurno: 10:00?';
		expect(buildWaMeUrl('+5493421234567', message)).toBe(
			'https://wa.me/5493421234567?text=Hola%2C%20soy%20Ana%20%26%20Co.%0ATurno%3A%2010%3A00%3F'
		);
		expect(buildWhatsAppWebUrl('+5493421234567', message)).toBe(
			'https://web.whatsapp.com/send?phone=5493421234567&text=Hola%2C%20soy%20Ana%20%26%20Co.%0ATurno%3A%2010%3A00%3F'
		);
	});

	it('un mensaje vacío abre el chat sin texto armado', () => {
		expect(buildWaMeUrl('+5493421234567', '')).toBe('https://wa.me/5493421234567');
		expect(buildWhatsAppWebUrl('+5493421234567', '')).toBe('https://web.whatsapp.com/send?phone=5493421234567');
	});
});
