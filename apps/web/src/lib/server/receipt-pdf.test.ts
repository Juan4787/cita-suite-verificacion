import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildAppointmentReceiptPdf, sanitizeForWinAnsi } from './receipt-pdf';

describe('sanitizeForWinAnsi', () => {
	it('conserva el español (acentos, ñ, ¿¡)', () => {
		expect(sanitizeForWinAnsi('Atención: ñandú ¿día? ¡Sí!')).toBe('Atención: ñandú ¿día? ¡Sí!');
	});

	it('normaliza puntuación tipográfica a ASCII', () => {
		expect(sanitizeForWinAnsi('“Hola” —dijo— ‘ya’…')).toBe('"Hola" -dijo- \'ya\'...');
	});

	it('descarta lo no representable (emojis) sin romper el resto', () => {
		expect(sanitizeForWinAnsi('Consultorio 🦷 Centro')).toBe('Consultorio  Centro');
	});
});

describe('buildAppointmentReceiptPdf', () => {
	const baseInput = {
		title: 'Comprobante de turno',
		businessName: 'Clínica Sabrina',
		statusLabel: 'Reservado',
		fields: [
			{ label: 'Servicio', value: 'Consulta' },
			{ label: 'Profesional', value: 'Dra. Pérez' },
			{ label: 'Fecha y hora', value: '15 de junio de 2026, 14:30' },
			{ label: 'Ubicación', value: 'Av. Santa Fe 1234, Córdoba' }
		],
		footer: 'Comprobante generado el 12 de junio de 2026, 10:00.'
	};

	it('genera un PDF válido de una sola página', async () => {
		const bytes = await buildAppointmentReceiptPdf(baseInput);
		expect(bytes).toBeInstanceOf(Uint8Array);
		// Firma del formato.
		expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');
		// Reabrible por un parser real → estructura coherente.
		const reopened = await PDFDocument.load(bytes);
		expect(reopened.getPageCount()).toBe(1);
		expect(reopened.getTitle()).toBe('Comprobante de turno');
	});

	it('no falla con valores que traen emojis o puntuación rara (input de usuario)', async () => {
		const bytes = await buildAppointmentReceiptPdf({
			...baseInput,
			businessName: 'Centro 🦷 “Sonrisas”',
			fields: [{ label: 'Indicaciones', value: 'Timbre 2B — piso 3°… 🚪' }]
		});
		const reopened = await PDFDocument.load(bytes);
		expect(reopened.getPageCount()).toBe(1);
	});

	it('soporta valores largos (envuelven en varias líneas sin tirar)', async () => {
		const longValue = 'Av. '.repeat(60) + 'final';
		const bytes = await buildAppointmentReceiptPdf({
			...baseInput,
			fields: [{ label: 'Ubicación', value: longValue }]
		});
		const reopened = await PDFDocument.load(bytes);
		expect(reopened.getPageCount()).toBe(1);
	});
});
