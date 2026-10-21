// Imports carry their extension: the integration CLI runs this module natively in Node.
import { isUuid } from './uuid.ts';

/** Public host contract. New booking steps and database shapes are deliberately private. */
export const BOOKING_EMBED_PROTOCOL = 'cita-suite.booking' as const;
export const BOOKING_EMBED_VERSION = 1 as const;
export const BOOKING_INTEGRATION_KEY_PATTERN = /^[a-f0-9]{32}$/;
export const BOOKING_REQUEST_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const BOOKING_THEMES = ['cita-suite', 'natalia'] as const;
export type BookingTheme = (typeof BOOKING_THEMES)[number];
export const BOOKING_MODALITIES = ['in_person', 'video'] as const;
export type BookingModality = (typeof BOOKING_MODALITIES)[number];
export const BOOKING_MODALITY_LABELS: Record<BookingModality, string> = {
	in_person: 'Presencial',
	video: 'Virtual'
};

export type BookingIntakeField = {
	id: string;
	label: string;
	kind: 'text' | 'textarea' | 'boolean' | 'choice';
	required: boolean;
	help?: string;
	maxLength?: number;
	options?: string[];
	patientField?: 'insurance' | 'insurance_plan' | 'birth_date' | 'age' | 'medication' | 'background' | 'allergies' | 'dni' | 'address' | 'custom';
};
export type BookingIntakeAnswers = Record<string, string | boolean>;
export type BookingModalityWindow = {
	modality: BookingModality;
	professionalId?: string;
	weekday: number;
	startTime: string;
	endTime: string;
};

/** Match JSONB's separator whitespace for these bounded declarative values. */
export function bookingJsonByteLength(value: unknown): number {
	const json = JSON.stringify(value);
	let quoted = false, escaped = false, spaces = 0;
	for (const character of json) {
		if (quoted) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') quoted = false;
		} else if (character === '"') quoted = true;
		else if (character === ',' || character === ':') spaces++;
	}
	return new TextEncoder().encode(json).byteLength + spaces;
}

export function parseBookingModalityWindows(value: unknown): BookingModalityWindow[] {
	if (!Array.isArray(value) || value.length > 224 || bookingJsonByteLength(value) > 65536) throw new BookingIntegrationValidationError('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
	return value.map((window) => {
		if (!plainObject(window) || Object.keys(window).some((key) => !['modality', 'professionalId', 'weekday', 'startTime', 'endTime'].includes(key)) ||
			!BOOKING_MODALITIES.includes(window.modality as BookingModality) || !Number.isInteger(window.weekday) || Number(window.weekday) < 0 || Number(window.weekday) > 6 ||
			typeof window.startTime !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(window.startTime) ||
			typeof window.endTime !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(window.endTime) || window.startTime >= window.endTime ||
			(window.professionalId !== undefined && !isUuid(window.professionalId))) throw new BookingIntegrationValidationError('BOOKING_INTEGRATION_CONFIGURATION_INVALID');
		return { ...window } as BookingModalityWindow;
	});
}
export type BookingPresentation = {
	theme: BookingTheme;
	modalities: BookingModality[];
	intakeFields: BookingIntakeField[];
	videoInstructions: string | null;
};

export class BookingIntegrationValidationError extends Error {
	readonly reason: string;
	constructor(reason: string) {
		super(reason);
		this.reason = reason;
	}
}

export function normalizeBookingOrigin(value: string, allowLocal = false): string | null {
	try {
		const url = new URL(value);
		const local = allowLocal && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
		if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
		if (url.hostname.includes('*') || url.origin === 'null') return null;
		return url.origin;
	} catch {
		return null;
	}
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value) &&
	(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function parseBookingIntakeFields(value: unknown): BookingIntakeField[] {
	if (!Array.isArray(value) || value.length > 24 || bookingJsonByteLength(value) > 16384) {
		throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
	}
	const ids = new Set<string>();
	return value.map((field) => {
		if (!plainObject(field) || Object.keys(field).some((key) =>
			!['id', 'label', 'kind', 'required', 'help', 'maxLength', 'options', 'patientField'].includes(key))) {
			throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
		}
		if (typeof field.id !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/.test(field.id) ||
			['__proto__', 'constructor', 'prototype'].includes(field.id) || ids.has(field.id) ||
			typeof field.label !== 'string' || !field.label.trim() || field.label.length > 120 ||
			!['text', 'textarea', 'boolean', 'choice'].includes(String(field.kind)) ||
			typeof field.required !== 'boolean' ||
			(field.help !== undefined && (typeof field.help !== 'string' || field.help.length > 300))) {
			throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
		}
		ids.add(field.id);
		if (field.patientField !== undefined && (!['insurance', 'insurance_plan', 'birth_date', 'age', 'medication', 'background', 'allergies', 'dni', 'address', 'custom'].includes(String(field.patientField)) || (field.patientField !== 'custom' && field.kind === 'boolean') || (['age', 'birth_date'].includes(String(field.patientField)) && field.kind !== 'text'))) {
			throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
		}
		const text = field.kind === 'text' || field.kind === 'textarea';
		if (text && (!Number.isInteger(field.maxLength) || Number(field.maxLength) < 1 || Number(field.maxLength) > 2000)) {
			throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
		}
		if (!text && field.maxLength !== undefined) throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
		if (field.kind === 'choice') {
			if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 20 ||
				field.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 120) ||
				new Set(field.options).size !== field.options.length) {
				throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
			}
		} else if (field.options !== undefined) throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
		return { ...field } as BookingIntakeField;
	});
}

/** A professional config has at most 24 questions; joint appointments can combine up to 64. */
export function parsePublicPatientFields(value: unknown): BookingIntakeField[] {
	if (!Array.isArray(value) || value.length > 64 || bookingJsonByteLength(value) > 16384) throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
	const fields: BookingIntakeField[] = [];
	for (let offset = 0; offset < value.length; offset += 24) fields.push(...parseBookingIntakeFields(value.slice(offset, offset + 24)));
	if (new Set(fields.map(field => field.id)).size !== fields.length) throw new BookingIntegrationValidationError('BOOKING_INTAKE_SCHEMA_INVALID');
	return fields;
}

/** Missing answers stay missing; false is a valid explicit boolean answer. */
export function validateBookingIntakeAnswers(fields: BookingIntakeField[], value: unknown): BookingIntakeAnswers {
	if (!plainObject(value) || Object.keys(value).some((key) => !fields.some((field) => field.id === key))) {
		throw new BookingIntegrationValidationError('BOOKING_INTAKE_ANSWERS_INVALID');
	}
	const result: BookingIntakeAnswers = Object.create(null);
	for (const field of fields) {
		const answer = Object.hasOwn(value, field.id) ? value[field.id] : undefined;
		if (answer === undefined || answer === '') {
			if (field.required) throw new BookingIntegrationValidationError('BOOKING_INTAKE_REQUIRED');
			continue;
		}
		if (field.kind === 'boolean') {
			if (typeof answer !== 'boolean') throw new BookingIntegrationValidationError('BOOKING_INTAKE_ANSWERS_INVALID');
			result[field.id] = answer;
		} else {
			if (typeof answer !== 'string') throw new BookingIntegrationValidationError('BOOKING_INTAKE_ANSWERS_INVALID');
			const normalized = answer.trim();
			if (!normalized) {
				if (field.required) throw new BookingIntegrationValidationError('BOOKING_INTAKE_REQUIRED');
				continue;
			}
			if (field.kind === 'choice' ? !field.options?.includes(normalized) : normalized.length > Number(field.maxLength)) {
				throw new BookingIntegrationValidationError('BOOKING_INTAKE_ANSWERS_INVALID');
			}
			result[field.id] = normalized;
		}
	}
	if (bookingJsonByteLength(result) > 16384) {
		throw new BookingIntegrationValidationError('BOOKING_INTAKE_TOO_LONG');
	}
	return result;
}

export type BookingHostMessage = {
	protocol: typeof BOOKING_EMBED_PROTOCOL;
	version: typeof BOOKING_EMBED_VERSION;
	instanceId: string;
	type: 'ready' | 'resize' | 'close' | 'theme' | 'request' | 'completed';
	height?: number;
	theme?: 'light' | 'dark';
	requestId?: string;
};

export function isBookingHostMessage(value: unknown, instanceId: string): value is BookingHostMessage {
	if (!plainObject(value) || value.protocol !== BOOKING_EMBED_PROTOCOL ||
		value.version !== BOOKING_EMBED_VERSION || value.instanceId !== instanceId ||
		!['ready', 'resize', 'close', 'theme', 'request', 'completed'].includes(String(value.type))) return false;
	if (value.type === 'resize') return typeof value.height === 'number' && Number.isFinite(value.height) && value.height >= 200 && value.height <= 10000;
	if (value.type === 'theme') return value.theme === 'light' || value.theme === 'dark';
	if (value.type === 'request') return typeof value.requestId === 'string' && BOOKING_REQUEST_ID_PATTERN.test(value.requestId);
	return true;
}
