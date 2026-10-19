import { isRecord } from '$lib/contracts/json';

function failureMetadata(cause: unknown) {
	const metadata: { sqlState?: string; httpStatus?: number } = {};
	try {
		if (isRecord(cause)) {
			if (typeof cause.code === 'string' && /^[0-9A-Z]{5}$/.test(cause.code))
				metadata.sqlState = cause.code;
			const status = cause.status ?? cause.statusCode;
			if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599)
				metadata.httpStatus = status;
		}
	} catch {
		/* A malformed diagnostic must not change an operation's result. */
	}
	return metadata;
}

/** Call with a static operation label. Never serialize provider/request data. */
export function logServerFailure(operation: string, cause?: unknown): void {
	console.error(operation, failureMetadata(cause));
}
export function logServerWarning(operation: string, cause?: unknown): void {
	console.warn(operation, failureMetadata(cause));
}
/** Measurements of one scheduled job run: names, counts and durations, never data. */
export function logScheduledJob(measurements: Record<string, string | number | boolean | null>): void {
	console.info('Tarea programada', measurements);
}
