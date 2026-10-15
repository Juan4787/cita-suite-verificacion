import { describe, expect, it } from 'vitest';
import { PATIENT_EXPORT_WORKBOOK_VERSION, type PatientExportDatasetRows } from './contract';
import { PatientExportTextError } from './ooxml';
import {
	PATIENT_EXPORT_SHEET_DEFINITIONS,
	PATIENT_EXPORT_SHEET_NAMES,
	PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS,
	PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS,
	PATIENT_EXPORT_XLSX_MIME,
	PatientExportWorkbookError,
	buildPatientExportWorkbook,
	exactExcelAmount,
	splitPatientExportText,
	type PatientExportWorkbookCell
} from './workbook';
import {
	ALLOCATION_ID,
	APPOINTMENT_ID,
	ENTRY_ID,
	FOLLOW_UP_ID,
	PATIENT_ID,
	PROFESSIONAL_ID,
	makePatientExportWorkbookInput,
	sessionForDatasets
} from './test-fixtures';

const valueOf = (cell: PatientExportWorkbookCell): string | number | null => cell?.value ?? null;

const emptyDatasets = (): PatientExportDatasetRows => ({
	patients: [],
	custom_fields: [],
	clinical_entries: [],
	appointments: [],
	appointment_professionals: [],
	follow_ups: []
});

describe('patient export workbook v2', () => {
	it('keeps the exact human-readable eight-sheet contract, including empty sheets', () => {
		const datasets = emptyDatasets();
		const workbook = buildPatientExportWorkbook({
			session: sessionForDatasets(datasets),
			datasets,
			generatedAtUtc: '2026-08-28T14:35:00.000Z'
		});

		expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
			'Resumen',
			'Pacientes',
			'Datos adicionales',
			'Historia clínica',
			'Turnos',
			'Profesionales de turnos',
			'Seguimientos',
			'Textos extensos'
		]);
		expect(workbook.version).toBe(PATIENT_EXPORT_WORKBOOK_VERSION);
		expect(PATIENT_EXPORT_SHEET_NAMES).toHaveLength(8);
		expect(PATIENT_EXPORT_SHEET_DEFINITIONS.map(({ headers }) => headers)).toEqual([
			['Dato', 'Detalle'],
			[
				'Nombre completo', 'DNI', 'Teléfono', 'Correo electrónico', 'Fecha de nacimiento',
				'Dirección', 'Obra social', 'Plan', 'Alergias', 'Medicación', 'Antecedentes',
				'Alerta clínica', 'Notas clínicas', 'Estado', 'Fecha de archivo', 'Fecha de alta',
				'Última actualización'
			],
			['Paciente', 'DNI', 'Campo', 'Valor'],
			[
				'Paciente', 'DNI', 'Fecha y hora', 'Tipo', 'Descripción', 'Piezas', 'Nota interna',
				'Importe', 'Profesional', 'Estado', 'Fecha de archivo', 'Fecha de carga',
				'Última actualización'
			],
			[
				'Paciente', 'DNI', 'Inicio', 'Fin', 'Estado', 'Origen', 'Servicio', 'Nota interna',
				'Profesional principal', 'Fecha de confirmación', 'Fecha de cancelación',
				'Pedido de reprogramación', 'Motivo de cancelación', 'Fecha de creación',
				'Última actualización'
			],
			[
				'Paciente', 'DNI', 'Inicio del turno', 'Servicio', 'Profesional',
				'Responsable principal'
			],
			[
				'Paciente', 'DNI', 'Fecha de recordatorio', 'Mensaje', 'Estado',
				'Profesional asignado', 'Fecha de finalización', 'Fecha de creación',
				'Última actualización'
			],
			[
				'Referencia', 'Paciente', 'DNI', 'Sección', 'Registro', 'Campo', 'Parte', 'Texto'
			]
		]);
		expect(workbook.sheets.slice(1).every((sheet) => sheet.rows.length === 0)).toBe(true);
		expect(workbook.filename).toBe('datos-pacientes-20260828-1435.xlsx');
		expect(workbook.mimeType).toBe(PATIENT_EXPORT_XLSX_MIME);
	});

	it('replaces every internal relationship with patient and professional names', () => {
		const workbook = buildPatientExportWorkbook(makePatientExportWorkbookInput());
		const byName = new Map(workbook.sheets.map((sheet) => [sheet.name, sheet]));
		const patient = byName.get('Pacientes')?.rows[0];
		const clinical = byName.get('Historia clínica')?.rows[0];
		const appointment = byName.get('Turnos')?.rows[0];
		const professional = byName.get('Profesionales de turnos')?.rows[0];
		const followUp = byName.get('Seguimientos')?.rows[0];

		expect(patient?.map(valueOf).slice(0, 5)).toEqual([
			'Zoë Núñez 😀',
			'00123456',
			'+54 11 4000-0000',
			'zoe@example.test',
			'02/01/1990'
		]);
		expect(valueOf(patient?.[13] ?? null)).toBe('Activo');
		expect(clinical?.map(valueOf).slice(0, 4)).toEqual([
			'Zoë Núñez 😀',
			'00123456',
			'27/08/2026 17:15:00',
			'Consulta'
		]);
		expect(valueOf(clinical?.[7] ?? null)).toBe(12345.67);
		expect(clinical?.[7]?.kind).toBe('number');
		expect(valueOf(clinical?.[9] ?? null)).toBe('Archivado');
		expect(valueOf(appointment?.[4] ?? null)).toBe('Reprogramación solicitada');
		expect(valueOf(appointment?.[5] ?? null)).toBe('Reserva en línea');
		expect(professional?.map(valueOf).slice(0, 5)).toEqual([
			'Zoë Núñez 😀',
			'00123456',
			'29/08/2026 09:00:00',
			'Consulta inicial',
			'Dra. Álvarez'
		]);
		expect(valueOf(professional?.[5] ?? null)).toBe('Sí');
		expect(valueOf(followUp?.[4] ?? null)).toBe('Completado');

		const visibleValues = workbook.sheets.flatMap((sheet) => [
			...sheet.headers,
			...sheet.rows.flatMap((row) => row.map(valueOf))
		]);
		const visibleText = visibleValues.filter((value): value is string => typeof value === 'string');
		for (const internalId of [
			PATIENT_ID,
			ENTRY_ID,
			APPOINTMENT_ID,
			PROFESSIONAL_ID,
			ALLOCATION_ID,
			FOLLOW_UP_ID
		]) {
			expect(visibleText.some((value) => value.includes(internalId))).toBe(false);
		}
		expect(visibleText.some((value) => /cita-suite-patient-export|valor json|id paciente/i.test(value))).toBe(
			false
		);
	});

	it('renders every custom-field type as a single human-readable value', () => {
		const customRows = buildPatientExportWorkbook(makePatientExportWorkbookInput()).sheets.find(
			(sheet) => sheet.name === 'Datos adicionales'
		)?.rows;
		expect(customRows?.map((row) => row.map(valueOf))).toEqual([
			['Zoë Núñez 😀', '00123456', 'Texto', '=1+1'],
			['Zoë Núñez 😀', '00123456', 'Número', '9007199254740993'],
			['Zoë Núñez 😀', '00123456', 'Booleano', 'Sí'],
			['Zoë Núñez 😀', '00123456', 'Nulo', null],
			['Zoë Núñez 😀', '00123456', 'Objeto', 'a: 9007199254740993\nb: 001'],
			['Zoë Núñez 😀', '00123456', 'Lista', '1. 1\n2. 001\n3. No']
		]);
	});

	it('moves oversized text to reversible chunks without cutting surrogate pairs', () => {
		const input = makePatientExportWorkbookInput();
		const original = `${'a'.repeat(29_999)}😀${'b'.repeat(4_000)}${'\n'.repeat(301)}fin`;
		input.datasets.clinical_entries[0]!.description = original;

		const workbook = buildPatientExportWorkbook(input);
		const clinicalRow = workbook.sheets.find((sheet) => sheet.name === 'Historia clínica')!
			.rows[0]!;
		const reference = valueOf(clinicalRow[4] ?? null);
		const parts = workbook.sheets
			.find((sheet) => sheet.name === 'Textos extensos')!
			.rows.filter((row) => valueOf(row[0] ?? null) === reference);
		const chunks = parts.map((row) => String(valueOf(row[7] ?? null)));

		expect(reference).toBe('Texto extenso 1');
		expect(chunks.join('')).toBe(original);
		expect(chunks.every((chunk) => chunk.length <= PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS)).toBe(true);
		expect(
			chunks.every(
				(chunk) => (chunk.match(/\n/g) ?? []).length <= PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS
			)
		).toBe(true);
		expect(chunks.some((chunk) => chunk.startsWith('😀'))).toBe(true);
		expect(parts.every((row) => valueOf(row[1] ?? null) === 'Zoë Núñez 😀')).toBe(true);
		expect(parts.every((row) => valueOf(row[2] ?? null) === '00123456')).toBe(true);
		expect(parts.map((row) => valueOf(row[6] ?? null))).toEqual(
			parts.map((_, index) => `${index + 1} de ${parts.length}`)
		);
	});

	it('uses numbers only when decimal text round-trips safely', () => {
		expect(exactExcelAmount('00123.4500')).toBe(123.45);
		expect(exactExcelAmount('9007199254740991')).toBe(9007199254740991);
		expect(exactExcelAmount('9007199254740993')).toBe('9007199254740993');
		expect(exactExcelAmount('1.0000000000000001')).toBe('1.0000000000000001');
		expect(exactExcelAmount('0.0000001')).toBe('0.0000001');
		expect(exactExcelAmount('-0.00')).toBe(0);
	});

	it('fails closed on count mismatch, malformed custom JSON and malformed Unicode', () => {
		const mismatched = makePatientExportWorkbookInput();
		mismatched.session.expected_counts.patients += 1;
		expect(() => buildPatientExportWorkbook(mismatched)).toThrow(
			expect.objectContaining({ code: 'WORKBOOK_INCOMPLETE' })
		);

		const malformedJson = makePatientExportWorkbookInput();
		malformedJson.datasets.custom_fields[4]!.value_json = '[]';
		expect(() => buildPatientExportWorkbook(malformedJson)).toThrow(PatientExportWorkbookError);

		const malformedUnicode = makePatientExportWorkbookInput();
		malformedUnicode.datasets.patients[0]!.full_name = '\ud800';
		expect(() => buildPatientExportWorkbook(malformedUnicode)).toThrow(PatientExportTextError);
	});

	it('fails closed instead of showing an orphan internal identifier', () => {
		const missingPatient = makePatientExportWorkbookInput();
		missingPatient.datasets.patients = [];
		missingPatient.session.expected_counts.patients = 0;
		expect(() => buildPatientExportWorkbook(missingPatient)).toThrow(
			expect.objectContaining({ code: 'WORKBOOK_INCOMPLETE' })
		);

		const missingAppointment = makePatientExportWorkbookInput();
		missingAppointment.datasets.appointments = [];
		missingAppointment.session.expected_counts.appointments = 0;
		expect(() => buildPatientExportWorkbook(missingAppointment)).toThrow(
			expect.objectContaining({ code: 'WORKBOOK_INCOMPLETE' })
		);
	});

	it('splits solely on line-feed limits when character length is small', () => {
		const original = 'x\n'.repeat(PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS + 2);
		const chunks = splitPatientExportText(original);
		expect(chunks.length).toBe(2);
		expect(chunks.join('')).toBe(original);
	});
});
