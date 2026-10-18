import { isRecord } from '$lib/contracts/json';

/** Call with a static operation label. Never serialize provider/request data. */
export function logServerFailure(operation: string, cause?: unknown): void {
 const metadata: { sqlState?: string; httpStatus?: number } = {};
 try {
  if (isRecord(cause)) {
   if (typeof cause.code === 'string' && /^[0-9A-Z]{5}$/.test(cause.code)) metadata.sqlState = cause.code;
   const status = cause.status ?? cause.statusCode;
   if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) metadata.httpStatus = status;
  }
 } catch { /* A malformed diagnostic must not change an operation's result. */ }
 console.error(operation, metadata);
}
