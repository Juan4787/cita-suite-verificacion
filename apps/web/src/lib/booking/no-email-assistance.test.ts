import { describe, expect, it } from 'vitest';
import { buildNoEmailWhatsAppLinks, buildNoEmailWhatsAppMessage } from './no-email-assistance';

describe('P10: buildNoEmailWhatsAppMessage y buildNoEmailWhatsAppLinks', () => {
	it('arma el mensaje con nombre, prestación, modalidad, fecha y hora cuando el paciente ya eligió todo', () => {
		const message = buildNoEmailWhatsAppMessage({
			patientName: '  Marta Gómez ',
			serviceName: 'Primera consulta',
			modalityLabel: 'Consulta virtual',
			dateLabel: 'lunes 30 de noviembre',
			timeLabel: '09:00'
		});
		expect(message).toBe(
			'Hola, soy Marta Gómez. No tengo correo electrónico y quiero pedir un turno para Primera consulta (Consulta virtual) el lunes 30 de noviembre a las 09:00.'
		);
	});

	it('omite datos no escritos ni elegidos (sin nombre, sin modalidad, sin horario todavía)', () => {
		expect(
			buildNoEmailWhatsAppMessage({
				patientName: '',
				serviceName: 'Primera consulta'
			})
		).toBe('Hola. No tengo correo electrónico y quiero pedir un turno para Primera consulta.');

		expect(buildNoEmailWhatsAppMessage({})).toBe(
			'Hola. No tengo correo electrónico y quiero pedir un turno.'
		);
	});

	it('devuelve enlaces de WhatsApp sólo cuando hay número configurado', () => {
		expect(buildNoEmailWhatsAppLinks(null, { serviceName: 'Consulta' })).toBeNull();
		expect(buildNoEmailWhatsAppLinks('   ', { serviceName: 'Consulta' })).toBeNull();

		const links = buildNoEmailWhatsAppLinks('+5493415550101', {
			patientName: 'Ana Pérez',
			serviceName: 'Consulta',
			dateLabel: 'martes 1 de diciembre',
			timeLabel: '10:30'
		});
		expect(links).not.toBeNull();
		expect(links!.whatsappUrl).toContain('https://wa.me/5493415550101?text=');
		expect(links!.whatsappWebUrl).toContain('https://web.whatsapp.com/send?phone=5493415550101&text=');
		expect(decodeURIComponent(links!.whatsappUrl)).toContain('Ana Pérez');
		expect(decodeURIComponent(links!.whatsappUrl)).toContain('Consulta');
		expect(decodeURIComponent(links!.whatsappUrl)).toContain('martes 1 de diciembre');
		expect(decodeURIComponent(links!.whatsappUrl)).toContain('10:30');
	});
});
