// Comprobante de turno en PDF, generado del lado servidor (endpoint comprobante.pdf).
// Documento de una página, texto plano: los mismos datos del resumen de la reserva más
// la ubicación como dato (no como mapa interactivo, porque es un PDF). Usa las fuentes
// estándar Helvetica de pdf-lib (sin embeber archivos) con encoding WinAnsi.

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export type ReceiptField = { label: string; value: string };

export type ReceiptInput = {
	title: string;
	businessName: string;
	statusLabel: string;
	fields: ReceiptField[];
	footer?: string;
};

// WinAnsi (fuentes estándar) cubre Latin-1: el español entra. Mapeamos la puntuación
// tipográfica común a ASCII y descartamos lo no representable (emojis, etc.) para que
// pdf-lib nunca falle con texto cargado por el usuario (dirección, indicaciones).
const PUNCTUATION: Record<string, string> = {
	'–': '-',
	'—': '-',
	'‘': "'",
	'’': "'",
	'“': '"',
	'”': '"',
	'…': '...',
	' ': ' '
};

export const sanitizeForWinAnsi = (text: string): string => {
	let out = '';
	for (const ch of text) {
		const mapped = PUNCTUATION[ch] ?? ch;
		for (const c of mapped) {
			const cp = c.codePointAt(0) ?? 0;
			if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff)) out += c;
			else if (cp === 0xa0) out += ' ';
			// resto: se descarta
		}
	}
	return out;
};

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const tentative = line ? `${line} ${word}` : word;
		if (!line || font.widthOfTextAtSize(tentative, size) <= maxWidth) {
			line = tentative;
		} else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines.length ? lines : [''];
};

export const buildAppointmentReceiptPdf = async (input: ReceiptInput): Promise<Uint8Array> => {
	const doc = await PDFDocument.create();
	doc.setTitle(input.title);
	doc.setProducer('Cita Suite');

	const page = doc.addPage([595.28, 841.89]); // A4
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);

	const margin = 56;
	const maxWidth = page.getWidth() - margin * 2;
	const ink = rgb(0.04, 0.07, 0.12);
	const muted = rgb(0.42, 0.46, 0.52);
	const rule = rgb(0.85, 0.87, 0.9);
	let y = page.getHeight() - margin;

	const draw = (text: string, f: PDFFont, size: number, color = ink, gapBefore = 0) => {
		y -= gapBefore;
		for (const lineText of wrapText(sanitizeForWinAnsi(text), f, size, maxWidth)) {
			y -= size;
			page.drawText(lineText, { x: margin, y, size, font: f, color });
			y -= size * 0.35;
		}
	};

	draw(input.title, bold, 20);
	draw(input.businessName, bold, 13, ink, 6);
	draw(input.statusLabel, font, 11, muted, 2);

	y -= 14;
	page.drawLine({
		start: { x: margin, y },
		end: { x: page.getWidth() - margin, y },
		thickness: 1,
		color: rule
	});

	for (const field of input.fields) {
		draw(field.label.toUpperCase(), bold, 9, muted, 16);
		draw(field.value, font, 13, ink, 2);
	}

	if (input.footer) {
		draw(input.footer, font, 9, muted, 30);
	}

	return doc.save();
};
