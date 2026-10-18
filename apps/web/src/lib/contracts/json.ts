/** Runtime checks for JSON boundaries. Errors name a contract, never its data. */
export class InvalidDataContractError extends Error {
	readonly contract: string;
	constructor(contract: string) {
		super('No pudimos validar la respuesta del servicio. Volvé a intentar en unos momentos.');
		this.contract = contract;
		this.name = 'InvalidDataContractError';
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRecord(value: unknown, contract: string): Record<string, unknown> {
	if (!isRecord(value)) throw new InvalidDataContractError(contract);
	return value;
}

export function readArray(value: unknown, contract: string): unknown[] {
	if (!Array.isArray(value)) throw new InvalidDataContractError(contract);
	return value;
}

export function readText(value: unknown, contract: string): string {
	if (typeof value !== 'string') throw new InvalidDataContractError(contract);
	return value;
}

export function readNullableText(value: unknown, contract: string): string | null {
	return value === null || value === undefined ? null : readText(value, contract);
}

export function readBoolean(value: unknown, contract: string): boolean {
	if (typeof value !== 'boolean') throw new InvalidDataContractError(contract);
	return value;
}

export function readFiniteNumber(value: unknown, contract: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidDataContractError(contract);
	return value;
}

export function readChoice<const Choices extends readonly string[]>(value: unknown, choices: Choices, contract: string): Choices[number] {
	const choice = choices.find(choice => choice === value);
	if (choice === undefined) throw new InvalidDataContractError(contract);
	return choice;
}

/** Validate actual JSON instead of asserting that arbitrary objects are JSON. */
export function readJson(value: unknown, contract: string, depth = 0): Json {
	if (depth > 64) throw new InvalidDataContractError(contract);
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return readFiniteNumber(value, contract);
	if (Array.isArray(value)) return value.map(item => readJson(item, contract, depth + 1));
	const record = readRecord(value, contract);
	const prototype = Object.getPrototypeOf(record);
	if (prototype !== Object.prototype && prototype !== null) throw new InvalidDataContractError(contract);
	const entries = new Map<string, Json>();
	for (const [key, item] of Object.entries(record)) {
		// JSON object serialization omits undefined; arrays and root values do not
		// accept it. This preserves optional object fields without losing data.
		if (item !== undefined) entries.set(key, readJson(item, contract, depth + 1));
	}
	return Object.fromEntries(entries);
}
import type { Json } from '@cita-suite/shared';
