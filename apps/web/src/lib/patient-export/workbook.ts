import {
	PATIENT_EXPORT_DATASETS,
	PATIENT_EXPORT_SCHEMA_VERSION,
	PATIENT_EXPORT_WORKBOOK_VERSION,
	type PatientExportAppointmentSource,
	type PatientExportDatasetRows,
	type PatientExportSession
} from './contract';
import { assertWellFormedUnicode } from './ooxml';

export const PATIENT_EXPORT_XLSX_MIME =
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Margenes deliberados respecto de los limites documentados por Excel
// (32.767 caracteres y 253 saltos de linea por celda).
export const PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS = 30_000;
export const PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS = 250;

export const PATIENT_EXPORT_SHEET_NAMES = [
	'Resumen',
	'Pacientes',
	'Datos adicionales',
	'Historia clínica',
	'Turnos',
	'Profesionales de turnos',
	'Seguimientos',
	'Textos extensos'
] as const;

export type PatientExportSheetName = (typeof PATIENT_EXPORT_SHEET_NAMES)[number];

type SheetDefinition = {
	name: PatientExportSheetName;
	headers: readonly string[];
	widths: readonly number[];
};

export const PATIENT_EXPORT_SHEET_DEFINITIONS = [
	{
		name: 'Resumen',
		headers: ['Dato', 'Detalle'],
		widths: [34, 64]
	},
	{
		name: 'Pacientes',
		headers: [
			'Nombre completo',
			'DNI',
			'Teléfono',
			'Correo electrónico',
			'Fecha de nacimiento',
			'Dirección',
			'Obra social',
			'Plan',
			'Alergias',
			'Medicación',
			'Antecedentes',
			'Alerta clínica',
			'Notas clínicas',
			'Estado',
			'Fecha de archivo',
			'Fecha de alta',
			'Última actualización'
		],
		widths: [32, 18, 22, 30, 20, 34, 24, 20, 36, 36, 40, 36, 44, 16, 25, 25, 25]
	},
	{
		name: 'Datos adicionales',
		headers: ['Paciente', 'DNI', 'Campo', 'Valor'],
		widths: [32, 18, 30, 64]
	},
	{
		name: 'Historia clínica',
		headers: [
			'Paciente',
			'DNI',
			'Fecha y hora',
			'Tipo',
			'Descripción',
			'Piezas',
			'Nota interna',
			'Importe',
			'Profesional',
			'Estado',
			'Fecha de archivo',
			'Fecha de carga',
			'Última actualización'
		],
		widths: [32, 18, 25, 22, 52, 18, 42, 18, 30, 16, 25, 25, 25]
	},
	{
		name: 'Turnos',
		headers: [
			'Paciente',
			'DNI',
			'Inicio',
			'Fin',
			'Estado',
			'Origen',
			'Servicio',
			'Nota interna',
			'Profesional principal',
			'Fecha de confirmación',
			'Fecha de cancelación',
			'Pedido de reprogramación',
			'Motivo de cancelación',
			'Fecha de creación',
			'Última actualización'
		],
		widths: [32, 18, 25, 25, 28, 24, 32, 42, 32, 25, 25, 30, 40, 25, 25]
	},
	{
		name: 'Profesionales de turnos',
		headers: [
			'Paciente',
			'DNI',
			'Inicio del turno',
			'Servicio',
			'Profesional',
			'Responsable principal'
		],
		widths: [32, 18, 25, 32, 32, 22]
	},
	{
		name: 'Seguimientos',
		headers: [
			'Paciente',
			'DNI',
			'Fecha de recordatorio',
			'Mensaje',
			'Estado',
			'Profesional asignado',
			'Fecha de finalización',
			'Fecha de creación',
			'Última actualización'
		],
		widths: [32, 18, 22, 52, 18, 32, 25, 25, 25]
	},
	{
		name: 'Textos extensos',
		headers: [
			'Referencia',
			'Paciente',
			'DNI',
			'Sección',
			'Registro',
			'Campo',
			'Parte',
			'Texto'
		],
		widths: [22, 32, 18, 28, 36, 28, 16, 70]
	}
] as const satisfies readonly SheetDefinition[];

export type PatientExportWorkbookTextCell = { kind: 'text'; value: string };
export type PatientExportWorkbookNumberCell = { kind: 'number'; value: number };
export type PatientExportWorkbookCell =
	| PatientExportWorkbookTextCell
	| PatientExportWorkbookNumberCell
	| null;

export type PatientExportWorkbookSheet = {
	name: PatientExportSheetName;
	headers: readonly string[];
	widths: readonly number[];
	rows: PatientExportWorkbookCell[][];
};

export type PatientExportWorkbook = {
	version: typeof PATIENT_EXPORT_WORKBOOK_VERSION;
	filename: string;
	mimeType: typeof PATIENT_EXPORT_XLSX_MIME;
	sheets: PatientExportWorkbookSheet[];
};

export type PatientExportWorkbookInput = {
	session: PatientExportSession;
	datasets: PatientExportDatasetRows;
	generatedAtUtc: string;
};

export class PatientExportWorkbookError extends Error {
	code: 'WORKBOOK_INVALID' | 'WORKBOOK_INCOMPLETE';

	constructor(
		message = 'No pudimos construir el archivo Excel. Volvé a preparar la exportación.',
		options?: ErrorOptions & { code?: 'WORKBOOK_INVALID' | 'WORKBOOK_INCOMPLETE' }
	) {
		super(message, options);
		this.name = 'PatientExportWorkbookError';
		this.code = options?.code ?? 'WORKBOOK_INVALID';
	}
}

const text = (value: string): PatientExportWorkbookTextCell => {
	if (typeof value !== 'string') throw new PatientExportWorkbookError();
	assertWellFormedUnicode(value);
	return { kind: 'text', value };
};

const number = (value: number): PatientExportWorkbookNumberCell => {
	if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
		throw new PatientExportWorkbookError();
	}
	return { kind: 'number', value };
};

const nullableText = (value: string | null): PatientExportWorkbookTextCell | null =>
	value === null ? null : text(value);

export const splitPatientExportText = (value: string): string[] => {
	assertWellFormedUnicode(value);
	if (value.length === 0) return [''];

	const chunks: string[] = [];
	let start = 0;
	while (start < value.length) {
		let end = start;
		let lineFeeds = 0;

		while (end < value.length) {
			const codeUnit = value.charCodeAt(end);
			const codeUnitLength = codeUnit >= 0xd800 && codeUnit <= 0xdbff ? 2 : 1;
			const addsLineFeed = codeUnit === 0x0a ? 1 : 0;
			const exceedsLength = end - start + codeUnitLength > PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS;
			const exceedsLines = lineFeeds + addsLineFeed > PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS;
			if (end > start && (exceedsLength || exceedsLines)) break;
			end += codeUnitLength;
			lineFeeds += addsLineFeed;
		}

		chunks.push(value.slice(start, end));
		start = end;
	}

	return chunks;
};

type LongTextContext = {
	patientName: string | null;
	patientDni: string | null;
	section: string;
	record: string;
	field: string;
};

type LongTextRow = LongTextContext & {
	reference: string;
	part: number;
	totalParts: number;
	value: string;
};

const PATIENT_STATUS = { active: 'Activo', archived: 'Archivado' } as const;
const APPOINTMENT_STATUS = {
	reserved: 'Reservado',
	confirmed: 'Confirmado',
	cancelled: 'Cancelado',
	reschedule_requested: 'Reprogramación solicitada'
} as const;
const APPOINTMENT_SOURCE: Record<PatientExportAppointmentSource, string> = {
	manual: 'Carga manual',
	public_booking: 'Reserva en línea',
	whatsapp_bot: 'WhatsApp',
	admin: 'Administración'
};
const FOLLOW_UP_STATUS = { pending: 'Pendiente', done: 'Completado' } as const;

type PatientIdentity = {
	fullName: string;
	dni: string | null;
};

const formatCalendarDate = (value: string | null): string | null => {
	if (value === null) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) throw new PatientExportWorkbookError();
	return `${match[3]}/${match[2]}/${match[1]}`;
};

const timestampFormatter = (timeZone: string) => {
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat('es-AR', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		});
	} catch (error) {
		throw new PatientExportWorkbookError(undefined, { cause: error });
	}

	return (value: string | null): string | null => {
		if (value === null) return null;
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) throw new PatientExportWorkbookError();
		const parts = new Map<string, string>(
			formatter
				.formatToParts(date)
				.filter((part) => part.type !== 'literal')
				.map((part) => [part.type, part.value])
		);
		const required = (part: string) => {
			const result = parts.get(part);
			if (!result) throw new PatientExportWorkbookError();
			return result;
		};
		const milliseconds = date.getUTCMilliseconds();
		return `${required('day')}/${required('month')}/${required('year')} ${required('hour')}:${required('minute')}:${required('second')}${milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : ''}`;
	};
};

type LosslessJsonValue =
	| { kind: 'null' }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'number'; value: string }
	| { kind: 'string'; value: string }
	| { kind: 'array'; value: LosslessJsonValue[] }
	| { kind: 'object'; value: [string, LosslessJsonValue][] };

const parseLosslessJson = (source: string): LosslessJsonValue => {
	let index = 0;
	const skipWhitespace = () => {
		while (/\s/.test(source[index] ?? '')) index += 1;
	};
	const parseString = (): string => {
		if (source[index] !== '"') throw new Error('JSON_STRING_EXPECTED');
		const start = index;
		index += 1;
		while (index < source.length) {
			if (source[index] === '\\') {
				index += 2;
				continue;
			}
			if (source[index] === '"') {
				index += 1;
				return JSON.parse(source.slice(start, index)) as string;
			}
			index += 1;
		}
		throw new Error('JSON_STRING_UNTERMINATED');
	};
	const parseValue = (depth = 0): LosslessJsonValue => {
		if (depth > 50) throw new Error('JSON_TOO_DEEP');
		skipWhitespace();
		const current = source[index];
		if (current === '"') return { kind: 'string', value: parseString() };
		if (current === '[') {
			index += 1;
			const value: LosslessJsonValue[] = [];
			skipWhitespace();
			if (source[index] === ']') {
				index += 1;
				return { kind: 'array', value };
			}
			while (true) {
				value.push(parseValue(depth + 1));
				skipWhitespace();
				if (source[index] === ']') {
					index += 1;
					return { kind: 'array', value };
				}
				if (source[index] !== ',') throw new Error('JSON_ARRAY_SEPARATOR_EXPECTED');
				index += 1;
			}
		}
		if (current === '{') {
			index += 1;
			const value: [string, LosslessJsonValue][] = [];
			skipWhitespace();
			if (source[index] === '}') {
				index += 1;
				return { kind: 'object', value };
			}
			while (true) {
				skipWhitespace();
				const key = parseString();
				skipWhitespace();
				if (source[index] !== ':') throw new Error('JSON_OBJECT_COLON_EXPECTED');
				index += 1;
				value.push([key, parseValue(depth + 1)]);
				skipWhitespace();
				if (source[index] === '}') {
					index += 1;
					return { kind: 'object', value };
				}
				if (source[index] !== ',') throw new Error('JSON_OBJECT_SEPARATOR_EXPECTED');
				index += 1;
			}
		}
		for (const [literal, value] of [
			['true', { kind: 'boolean', value: true }],
			['false', { kind: 'boolean', value: false }],
			['null', { kind: 'null' }]
		] as const) {
			if (source.startsWith(literal, index)) {
				index += literal.length;
				return value;
			}
		}
		const numberMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
			source.slice(index)
		);
		if (!numberMatch) throw new Error('JSON_VALUE_EXPECTED');
		index += numberMatch[0].length;
		return { kind: 'number', value: numberMatch[0] };
	};

	const result = parseValue();
	skipWhitespace();
	if (index !== source.length) throw new Error('JSON_TRAILING_CONTENT');
	return result;
};

const renderStructuredValue = (value: LosslessJsonValue, depth = 0): string => {
	if (depth > 50) throw new PatientExportWorkbookError();
	if (value.kind === 'null') return 'Sin dato';
	if (value.kind === 'string' || value.kind === 'number') return value.value;
	if (value.kind === 'boolean') return value.value ? 'Sí' : 'No';
	if (value.kind === 'array') {
		if (value.value.length === 0) return 'Sin elementos';
		return value.value
			.map((item, index) => {
				const rendered = renderStructuredValue(item, depth + 1);
				return `${index + 1}. ${rendered.replaceAll('\n', '\n   ')}`;
			})
			.join('\n');
	}
	if (value.value.length === 0) return 'Sin contenido';
	return value.value
		.map(([key, item]) => {
			const rendered = renderStructuredValue(item, depth + 1);
			return `${key}: ${rendered.replaceAll('\n', '\n  ')}`;
		})
		.join('\n');
};

const canonicalDecimal = (value: string): string => {
	const negative = value.startsWith('-');
	const unsigned = negative ? value.slice(1) : value;
	const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
	const integer = integerPart.replace(/^0+(?=\d)/, '') || '0';
	const fraction = fractionPart.replace(/0+$/, '');
	const isZero = integer === '0' && fraction.length === 0;
	return `${negative && !isZero ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
};

/** Devuelve Number solo si el decimal conserva su representacion visible exacta. */
export const exactExcelAmount = (value: number | string | null): number | string | null => {
	if (value === null) return null;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new PatientExportWorkbookError();
		return Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : String(value);
	}
	if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
	const parsed = Number(value);
	if (
		!Number.isFinite(parsed) ||
		Math.abs(parsed) > Number.MAX_SAFE_INTEGER ||
		/[eE]/.test(String(parsed)) ||
		canonicalDecimal(String(parsed)) !== canonicalDecimal(value)
	) {
		return value;
	}
	return Object.is(parsed, -0) ? 0 : parsed;
};

const customFieldValue = (
	row: PatientExportDatasetRows['custom_fields'][number]
): string | null => {
	switch (row.value_type) {
		case 'string':
		case 'number':
			if (row.value_text === null || row.value_json !== null) throw new PatientExportWorkbookError();
			return row.value_text;
		case 'boolean':
			if (
				(row.value_text !== 'true' && row.value_text !== 'false') ||
				row.value_json !== null
			) {
				throw new PatientExportWorkbookError();
			}
			return row.value_text === 'true' ? 'Sí' : 'No';
		case 'null':
			if (row.value_text !== null || row.value_json !== null) throw new PatientExportWorkbookError();
			return null;
		case 'object':
		case 'array': {
			if (row.value_text !== null || row.value_json === null) throw new PatientExportWorkbookError();
			try {
				const parsed = parseLosslessJson(row.value_json);
				const matches =
					row.value_type === 'array'
						? parsed.kind === 'array'
						: parsed.kind === 'object';
				if (!matches) throw new Error('CUSTOM_FIELD_TYPE_MISMATCH');
				return renderStructuredValue(parsed);
			} catch (error) {
				if (error instanceof PatientExportWorkbookError) throw error;
				throw new PatientExportWorkbookError(undefined, { cause: error });
			}
		}
	}
};

const assertWorkbookInput = (input: PatientExportWorkbookInput): Date => {
	if (
		input.session.schema_version !== PATIENT_EXPORT_SCHEMA_VERSION ||
		input.session.datasets.length !== PATIENT_EXPORT_DATASETS.length ||
		!input.session.datasets.every((dataset, index) => dataset === PATIENT_EXPORT_DATASETS[index])
	) {
		throw new PatientExportWorkbookError();
	}

	for (const dataset of PATIENT_EXPORT_DATASETS) {
		if (
			!Array.isArray(input.datasets[dataset]) ||
			input.datasets[dataset].length !== input.session.expected_counts[dataset]
		) {
			throw new PatientExportWorkbookError(
				'No pudimos comprobar que el archivo estuviera completo. Volvé a prepararlo.',
				{ code: 'WORKBOOK_INCOMPLETE' }
			);
		}
	}

	const generatedAt = new Date(input.generatedAtUtc);
	if (!Number.isFinite(generatedAt.getTime())) throw new PatientExportWorkbookError();
	return generatedAt;
};

export const patientExportFilename = (
	scope: PatientExportSession['scope'],
	generatedAt: Date
): string => {
	if (!Number.isFinite(generatedAt.getTime())) throw new PatientExportWorkbookError();
	const iso = generatedAt.toISOString();
	const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 16).replace(':', '')}`;
	return `datos-${scope === 'patient' ? 'paciente' : 'pacientes'}-${stamp}.xlsx`;
};

const sheetDefinition = (name: PatientExportSheetName): SheetDefinition => {
	const definition = PATIENT_EXPORT_SHEET_DEFINITIONS.find((item) => item.name === name);
	if (!definition) throw new PatientExportWorkbookError();
	return definition;
};

const makeSheet = (
	name: PatientExportSheetName,
	rows: PatientExportWorkbookCell[][]
): PatientExportWorkbookSheet => {
	const definition = sheetDefinition(name);
	if (rows.some((row) => row.length !== definition.headers.length)) {
		throw new PatientExportWorkbookError();
	}
	return { ...definition, rows };
};

export const buildPatientExportWorkbook = (
	input: PatientExportWorkbookInput
): PatientExportWorkbook => {
	const generatedAt = assertWorkbookInput(input);
	const formatTimestamp = timestampFormatter(input.session.business.timezone);
	const requiredTimestamp = (value: string): string => {
		const formatted = formatTimestamp(value);
		if (formatted === null) throw new PatientExportWorkbookError();
		return formatted;
	};
	const requiredCalendarDate = (value: string): string => {
		const formatted = formatCalendarDate(value);
		if (formatted === null) throw new PatientExportWorkbookError();
		return formatted;
	};
	const compactContext = (value: string | null): string | null => {
		if (value === null) return null;
		const characters = Array.from(value);
		return characters.length <= 200 ? value : `${characters.slice(0, 197).join('')}...`;
	};

	const patientsById = new Map<string, PatientIdentity>();
	for (const patient of input.datasets.patients) {
		if (patientsById.has(patient.patient_id)) throw new PatientExportWorkbookError();
		patientsById.set(patient.patient_id, {
			fullName: patient.full_name,
			dni: patient.dni
		});
	}
	const patientIdentity = (patientId: string): PatientIdentity => {
		const identity = patientsById.get(patientId);
		if (!identity) {
			throw new PatientExportWorkbookError(
				'No pudimos relacionar todos los datos con sus pacientes. Volvé a preparar el archivo.',
				{ code: 'WORKBOOK_INCOMPLETE' }
			);
		}
		return identity;
	};

	const appointmentsById = new Map(
		input.datasets.appointments.map((appointment) => [appointment.appointment_id, appointment])
	);
	if (appointmentsById.size !== input.datasets.appointments.length) {
		throw new PatientExportWorkbookError();
	}

	const longTexts: LongTextRow[] = [];
	let nextTextReference = 1;

	const exportText = (
		value: string | null,
		context: LongTextContext
	): PatientExportWorkbookTextCell | null => {
		if (value === null) return null;
		const chunks = splitPatientExportText(value);
		if (chunks.length === 1) return text(value);

		const reference = `Texto extenso ${nextTextReference}`;
		nextTextReference += 1;
		for (let index = 0; index < chunks.length; index += 1) {
			longTexts.push({
				...context,
				reference,
				part: index + 1,
				totalParts: chunks.length,
				value: chunks[index] ?? ''
			});
		}
		return text(reference);
	};

	const informationRows: PatientExportWorkbookCell[][] = [
		['Consultorio', input.session.business.name],
		['Fecha de exportación', requiredTimestamp(generatedAt.toISOString())],
		[
			'Contenido',
			input.session.scope === 'patient'
				? 'Ficha completa del paciente seleccionado'
				: 'Fichas completas de todos los pacientes'
		],
		['Pacientes', input.datasets.patients.length],
		['Datos adicionales', input.datasets.custom_fields.length],
		['Registros de historia clínica', input.datasets.clinical_entries.length],
		['Turnos', input.datasets.appointments.length],
		['Profesionales asignados a turnos', input.datasets.appointment_professionals.length],
		['Seguimientos', input.datasets.follow_ups.length],
		['Fechas y horas', 'Expresadas en la hora local del consultorio.'],
		[
			'Textos muy largos',
			'Cuando una celda indique “Texto extenso 1”, el contenido completo está en la hoja Textos extensos.'
		]
	].map(([label, value]) => [
		text(String(label)),
		typeof value === 'number'
			? number(value)
			: exportText(String(value), {
					patientName: null,
					patientDni: null,
					section: 'Resumen',
					record: 'Datos de la exportación',
					field: String(label)
				})
	]);

	const patientRows = input.datasets.patients.map((row) => {
		const identity = patientIdentity(row.patient_id);
		const context = (field: string): LongTextContext => ({
			patientName: compactContext(identity.fullName),
			patientDni: compactContext(identity.dni),
			section: 'Pacientes',
			record: 'Ficha del paciente',
			field
		});
		return [
			exportText(row.full_name, context('Nombre completo')),
			exportText(row.dni, context('DNI')),
			exportText(row.phone, context('Teléfono')),
			exportText(row.email, context('Correo electrónico')),
			exportText(formatCalendarDate(row.birth_date), context('Fecha de nacimiento')),
			exportText(row.address, context('Dirección')),
			exportText(row.insurance, context('Obra social')),
			exportText(row.insurance_plan, context('Plan')),
			exportText(row.allergies, context('Alergias')),
			exportText(row.medication, context('Medicación')),
			exportText(row.background, context('Antecedentes')),
			exportText(row.clinical_alert_note, context('Alerta clínica')),
			exportText(row.clinical_notes, context('Notas clínicas')),
			text(PATIENT_STATUS[row.status]),
			nullableText(formatTimestamp(row.archived_at)),
			text(requiredTimestamp(row.created_at)),
			text(requiredTimestamp(row.updated_at))
		];
	});

	const customFieldRows = input.datasets.custom_fields.map((row) => {
		const identity = patientIdentity(row.patient_id);
		const value = customFieldValue(row);
		const context = (field: string): LongTextContext => ({
			patientName: compactContext(identity.fullName),
			patientDni: compactContext(identity.dni),
			section: 'Datos adicionales',
			record: 'Ficha del paciente',
			field
		});
		return [
			exportText(identity.fullName, context('Paciente')),
			exportText(identity.dni, context('DNI')),
			exportText(row.field_label, context('Campo')),
			exportText(value, context('Valor'))
		];
	});

	const clinicalEntryRows = input.datasets.clinical_entries.map((row) => {
		const identity = patientIdentity(row.patient_id);
		const occurredAt = requiredTimestamp(row.occurred_at);
		const context = (field: string): LongTextContext => ({
			patientName: compactContext(identity.fullName),
			patientDni: compactContext(identity.dni),
			section: 'Historia clínica',
			record: `Atención del ${occurredAt}`,
			field
		});
		const amount = exactExcelAmount(row.amount);
		const amountCell =
			amount === null
				? null
				: typeof amount === 'number'
					? number(amount)
					: exportText(amount, context('Importe'));
		return [
			exportText(identity.fullName, context('Paciente')),
			exportText(identity.dni, context('DNI')),
			text(occurredAt),
			exportText(row.entry_type, context('Tipo')),
			exportText(row.description, context('Descripción')),
			exportText(row.teeth, context('Piezas')),
			exportText(row.internal_note, context('Nota interna')),
			amountCell,
			exportText(row.professional_name, context('Profesional')),
			text(PATIENT_STATUS[row.status]),
			nullableText(formatTimestamp(row.archived_at)),
			text(requiredTimestamp(row.created_at)),
			text(requiredTimestamp(row.updated_at))
		];
	});

	const appointmentRows = input.datasets.appointments.map((row) => {
		const identity = patientIdentity(row.patient_id);
		const startsAt = requiredTimestamp(row.starts_at);
		const context = (field: string): LongTextContext => ({
			patientName: compactContext(identity.fullName),
			patientDni: compactContext(identity.dni),
			section: 'Turnos',
			record: `Turno del ${startsAt}`,
			field
		});
		return [
			exportText(identity.fullName, context('Paciente')),
			exportText(identity.dni, context('DNI')),
			text(startsAt),
			text(requiredTimestamp(row.ends_at)),
			text(APPOINTMENT_STATUS[row.status]),
			text(APPOINTMENT_SOURCE[row.source]),
			exportText(row.service_name_snapshot, context('Servicio')),
			exportText(row.internal_note, context('Nota interna')),
			exportText(row.professional_name_snapshot, context('Profesional principal')),
			nullableText(formatTimestamp(row.confirmed_at)),
			nullableText(formatTimestamp(row.cancelled_at)),
			nullableText(formatTimestamp(row.reschedule_requested_at)),
			exportText(row.cancelled_reason, context('Motivo de cancelación')),
			text(requiredTimestamp(row.created_at)),
			text(requiredTimestamp(row.updated_at))
		];
	});

	const appointmentProfessionalRows = input.datasets.appointment_professionals.map((row) => {
		const identity = patientIdentity(row.patient_id);
		const appointment = appointmentsById.get(row.appointment_id);
		if (!appointment || appointment.patient_id !== row.patient_id) {
			throw new PatientExportWorkbookError(
				'No pudimos relacionar todos los profesionales con sus turnos. Volvé a preparar el archivo.',
				{ code: 'WORKBOOK_INCOMPLETE' }
			);
		}
		const startsAt = requiredTimestamp(appointment.starts_at);
		const context = (field: string): LongTextContext => ({
			patientName: compactContext(identity.fullName),
			patientDni: compactContext(identity.dni),
			section: 'Profesionales de turnos',
			record: `Turno del ${startsAt}`,
			field
		});
		return [
			exportText(identity.fullName, context('Paciente')),
			exportText(identity.dni, context('DNI')),
			text(startsAt),
			exportText(appointment.service_name_snapshot, context('Servicio')),
			exportText(row.professional_name, context('Profesional')),
			text(row.is_primary ? 'Sí' : 'No')
		];
	});

	const followUpRows = input.datasets.follow_ups.map((row) => {
		const identity = patientIdentity(row.patient_id);
		const remindOn = requiredCalendarDate(row.remind_on);
		const context = (field: string): LongTextContext => ({
			patientName: compactContext(identity.fullName),
			patientDni: compactContext(identity.dni),
			section: 'Seguimientos',
			record: `Seguimiento del ${remindOn}`,
			field
		});
		return [
			exportText(identity.fullName, context('Paciente')),
			exportText(identity.dni, context('DNI')),
			text(remindOn),
			exportText(row.message, context('Mensaje')),
			text(FOLLOW_UP_STATUS[row.status]),
			exportText(row.assigned_professional_name, context('Profesional asignado')),
			nullableText(formatTimestamp(row.done_at)),
			text(requiredTimestamp(row.created_at)),
			text(requiredTimestamp(row.updated_at))
		];
	});

	const longTextRows = longTexts.map((row) => [
		text(row.reference),
		nullableText(row.patientName),
		nullableText(row.patientDni),
		text(row.section),
		text(row.record),
		text(row.field),
		text(`${row.part} de ${row.totalParts}`),
		text(row.value)
	]);

	return {
		version: PATIENT_EXPORT_WORKBOOK_VERSION,
		filename: patientExportFilename(input.session.scope, generatedAt),
		mimeType: PATIENT_EXPORT_XLSX_MIME,
		sheets: [
			makeSheet('Resumen', informationRows),
			makeSheet('Pacientes', patientRows),
			makeSheet('Datos adicionales', customFieldRows),
			makeSheet('Historia clínica', clinicalEntryRows),
			makeSheet('Turnos', appointmentRows),
			makeSheet('Profesionales de turnos', appointmentProfessionalRows),
			makeSheet('Seguimientos', followUpRows),
			makeSheet('Textos extensos', longTextRows)
		]
	};
};
