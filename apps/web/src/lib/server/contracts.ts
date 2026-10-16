/** Runtime checks for JSON boundaries. Errors name a contract, never its data. */
export class InvalidDataContractError extends Error {
	constructor(readonly contract: string) {
		super('No pudimos validar la respuesta del servicio. Volvé a intentar en unos momentos.');
		this.name = 'InvalidDataContractError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
