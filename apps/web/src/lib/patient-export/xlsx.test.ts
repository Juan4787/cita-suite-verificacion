import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
import writeXlsxFile from 'write-excel-file/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodePatientExportOoxmlText } from './ooxml';
import { buildPatientExportWorkbook } from './workbook';
import {
	ALLOCATION_ID,
	APPOINTMENT_ID,
	ENTRY_ID,
	FOLLOW_UP_ID,
	PATIENT_ID,
	PROFESSIONAL_ID,
	makePatientExportWorkbookInput
} from './test-fixtures';
import { toPatientExportWritableSheets } from './xlsx-adapter';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (xml: string, options: { contentType: string }) => { window: { document: Document } };
};

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const parseXml = (xml: string): Document => {
	const document = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
	expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
	return document;
};

const cellAt = (worksheet: Document, reference: string): Element | undefined =>
	Array.from(worksheet.getElementsByTagName('c')).find(
		(cell) => cell.getAttribute('r') === reference
	);

describe('generated patient export XLSX', () => {
	let xlsxBuffer: Buffer;
	let archive: Record<string, Uint8Array>;

	beforeAll(async () => {
		const input = makePatientExportWorkbookInput();
		input.datasets.patients[0]!.allergies = 'literal _x000D_ y control \u0001';
		const workbook = buildPatientExportWorkbook(input);
		xlsxBuffer = await writeXlsxFile(toPatientExportWritableSheets(workbook)).toBuffer();
		archive = unzipSync(new Uint8Array(xlsxBuffer));
	});

	it('contains the exact sheet order and valid XML without active content', () => {
		const workbookXml = decode(archive['xl/workbook.xml']!);
		const workbookDocument = parseXml(workbookXml);
		expect(
			Array.from(workbookDocument.getElementsByTagName('sheet')).map((sheet) =>
				sheet.getAttribute('name')
			)
		).toEqual([
			'Resumen',
			'Pacientes',
			'Datos adicionales',
			'Historia clínica',
			'Turnos',
			'Profesionales de turnos',
			'Seguimientos',
			'Textos extensos'
		]);

		for (const [path, bytes] of Object.entries(archive)) {
			if (path.endsWith('.xml') || path.endsWith('.rels')) parseXml(decode(bytes));
		}
		expect(Object.keys(archive).some((path) => /vba|macro|externalLink|connections/i.test(path))).toBe(false);
		expect(
			Object.entries(archive)
				.filter(([path]) => path.endsWith('.rels'))
				.some(([, bytes]) => /TargetMode=["']External["']/i.test(decode(bytes)))
		).toBe(false);
	});

	it('writes controlled values as shared strings, safe amounts as numbers and zero formulas', () => {
		const worksheets = Object.entries(archive)
			.filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
			.sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
		expect(worksheets).toHaveLength(8);
		expect(worksheets.every(([, bytes]) => !/<f(?:\s|>)/i.test(decode(bytes)))).toBe(true);

		const patients = parseXml(decode(archive['xl/worksheets/sheet2.xml']!));
		for (const reference of ['A2', 'B2', 'C2', 'D2', 'E2']) {
			expect(cellAt(patients, reference)?.getAttribute('t')).toBe('s');
		}

		const customFields = parseXml(decode(archive['xl/worksheets/sheet3.xml']!));
		expect(cellAt(customFields, 'D2')?.getAttribute('t')).toBe('s');

		const clinical = parseXml(decode(archive['xl/worksheets/sheet4.xml']!));
		expect(cellAt(clinical, 'E2')?.getAttribute('t')).toBe('s');
		expect(cellAt(clinical, 'H2')?.getAttribute('t')).toBeNull();
		expect(cellAt(clinical, 'H2')?.getElementsByTagName('v')[0]?.textContent).toBe('12345.67');
	});

	it('preserves formula prefixes, literal OOXML escapes, controls and Unicode in shared strings', () => {
		const sharedDocument = parseXml(decode(archive['xl/sharedStrings.xml']!));
		const encodedStrings = Array.from(sharedDocument.getElementsByTagName('t')).map(
			(node) => node.textContent ?? ''
		);
		const decodedStrings = encodedStrings.map(decodePatientExportOoxmlText);

		expect(decodedStrings).toContain('=SUM(1,1)');
		expect(decodedStrings).toContain('+no es fórmula');
		expect(decodedStrings).toContain('@recordatorio');
		expect(decodedStrings).toContain('Zoë Núñez 😀');
		expect(decodedStrings).toContain('literal _x000D_ y control \u0001');
		expect(encodedStrings.some((value) => value.includes('_x005F_x000D_'))).toBe(true);
		expect(encodedStrings.some((value) => value.includes('_x0001_'))).toBe(true);
		for (const internalId of [
			PATIENT_ID,
			ENTRY_ID,
			APPOINTMENT_ID,
			PROFESSIONAL_ID,
			ALLOCATION_ID,
			FOLLOW_UP_ID
		]) {
			expect(decodedStrings.some((value) => value.includes(internalId))).toBe(false);
		}
		expect(decodedStrings.some((value) => /\bID (?:paciente|turno|profesional)\b/i.test(value))).toBe(
			false
		);
	});

	it('keeps the third-party browser runtime import isolated to the lazy worker', async () => {
		const [worker, adapter, client, workbook] = await Promise.all([
			readFile(new URL('./patient-export.worker.ts', import.meta.url), 'utf8'),
			readFile(new URL('./xlsx-adapter.ts', import.meta.url), 'utf8'),
			readFile(new URL('./client.ts', import.meta.url), 'utf8'),
			readFile(new URL('./workbook.ts', import.meta.url), 'utf8')
		]);
		expect(worker).toContain("import writeXlsxFile from 'write-excel-file/browser'");
		expect(adapter).toContain("import type { CellObject, SheetData } from 'write-excel-file/browser'");
		expect(client).not.toContain("from 'write-excel-file/");
		expect(workbook).not.toContain("from 'write-excel-file/");
	});


});
