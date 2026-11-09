// Zoho CPaaS email: the send call, how its answers are read, and its webhook. Answers are classified
// from what the real API returned (docs/plans/plan-integral-avisos-20261105.md, 4.3), which differs
// from its documentation: success is 201, and refusals are 401 with a detail code.
import { isRecord } from '$lib/contracts/json';
import { JobBudgetExhaustedError } from '$lib/server/integrations/internal/job-budget';

export const ZOHO_EMAIL_ENDPOINT = 'https://cpaas.zoho.com/v1.1/email';

export type EmailMessage = {
	reference: string;
	from: { address: string; name: string };
	to: string;
	subject: string;
	html: string;
	text: string;
	headers: Record<string, string>;
};

/**
 * What one attempt proved. `uncertain` means the message may exist at the provider, so it must not
 * be sent again automatically. `sender_rejected` and `pause` mean it certainly did not leave.
 */
export type EmailSendOutcome =
	| { outcome: 'accepted'; requestId: string }
	| { outcome: 'retry' | 'failed' | 'uncertain' | 'sender_rejected' | 'pause'; code: string };

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const safeCode = (value: unknown, fallback: string) =>
	typeof value === 'string' && SAFE_CODE.test(value) ? value : fallback;

const detailCode = (body: unknown): string | null => {
	if (!isRecord(body) || !isRecord(body.error)) return null;
	const details = body.error.details;
	const first = Array.isArray(details) ? details[0] : null;
	return isRecord(first) && typeof first.code === 'string' ? first.code : null;
};

const topCode = (body: unknown): string | null => {
	if (!isRecord(body)) return null;
	if (isRecord(body.error) && typeof body.error.code === 'string') return body.error.code;
	return isRecord(body.data) && typeof body.data.error_code === 'string' ? body.data.error_code : null;
};

/** Reads an answer that did arrive. Anything unclear stays `uncertain` rather than being retried. */
export const classifyZohoResponse = (status: number, body: unknown): EmailSendOutcome => {
	if (status >= 200 && status < 300) {
		const results = isRecord(body) ? body.data : null;
		const first = Array.isArray(results) ? results[0] : null;
		const requestId = isRecord(body) ? body.request_id : null;
		if (isRecord(first) && first.code === 'EM_104' && typeof requestId === 'string' && requestId.length > 0)
			return { outcome: 'accepted', requestId };
		return { outcome: 'uncertain', code: 'unexpected_success' };
	}
	const detail = detailCode(body);
	const code = safeCode(detail ?? topCode(body), `http_${status}`);
	// Not followed, so nothing says where the message ended up.
	if (status >= 300 && status < 400) return { outcome: 'uncertain', code };
	if (detail === 'SM_111') return { outcome: 'sender_rejected', code };
	if (detail === 'SERR_157') return { outcome: 'pause', code };
	if (detail === 'SM_113') return { outcome: 'failed', code };
	// The provider decided before sending, but says nothing usable about this message.
	if (status === 401 || status === 402 || status === 403) return { outcome: 'pause', code };
	if (status === 429) return { outcome: 'retry', code };
	if (status >= 500 || status === 408) return { outcome: 'uncertain', code };
	return { outcome: 'failed', code };
};

export const zohoEmailBody = (message: EmailMessage) => ({
	from: message.from,
	to: [{ email_address: { address: message.to } }],
	subject: message.subject,
	htmlbody: message.html,
	textbody: message.text,
	client_reference: message.reference,
	track_opens: false,
	track_clicks: false,
	mime_headers: message.headers
});

export const sendZohoEmail = async (
	fetchFn: typeof fetch,
	apiKey: string,
	message: EmailMessage
): Promise<EmailSendOutcome> => {
	let response: Response;
	try {
		response = await fetchFn(ZOHO_EMAIL_ENDPOINT, {
			method: 'POST',
			headers: {
				authorization: `Zoho-enczapikey ${apiKey}`,
				'content-type': 'application/json',
				accept: 'application/json'
			},
			body: JSON.stringify(zohoEmailBody(message)),
			// Workers accepts only `follow` and `manual`. Following could repeat the send elsewhere.
			redirect: 'manual'
		});
	} catch (cause) {
		// The budget refuses before the request starts: that attempt certainly did not leave.
		if (cause instanceof JobBudgetExhaustedError) throw cause;
		// Otherwise the request may have reached the provider even if its answer never arrived.
		return { outcome: 'uncertain', code: 'network' };
	}
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		// A success without a readable body may still be a sent message.
		if (response.ok) return { outcome: 'uncertain', code: 'unreadable_success' };
	}
	return classifyZohoResponse(response.status, body);
};

const SIGNATURE_MAX_AGE_MS = 15 * 60 * 1000;

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	return difference === 0;
};

const decodeBase64 = (value: string): Uint8Array | null => {
	try {
		return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
};

/** The signed text: the raw form body's single value, or the raw body itself when it is plain JSON. */
export const zohoSignedPayload = (rawBody: string): string | null => {
	if (rawBody.trimStart().startsWith('{')) return rawBody;
	const separator = rawBody.indexOf('=');
	if (separator < 0) return null;
	try {
		// Decoding the whole body first would turn every `+` into a space and change the signed text.
		return decodeURIComponent(rawBody.slice(separator + 1).replace(/\+/g, ' '));
	} catch {
		return null;
	}
};

/** Checks `producer-signature`: ts=<ms>;s=<url-encoded base64>;s-algorithm=HmacSHA256. */
export const verifyZohoSignature = async (
	header: string | null,
	payload: string,
	key: string,
	now: number = Date.now()
): Promise<boolean> => {
	if (!header || !key) return false;
	const parts = new Map<string, string>();
	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator > 0) parts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
	}
	const timestamp = Number(parts.get('ts'));
	const encoded = parts.get('s');
	if (parts.get('s-algorithm') !== 'HmacSHA256' || !encoded || !Number.isFinite(timestamp)) return false;
	if (Math.abs(now - timestamp) > SIGNATURE_MAX_AGE_MS) return false;
	let signature: Uint8Array | null;
	try {
		signature = decodeBase64(decodeURIComponent(encoded));
	} catch {
		return false;
	}
	if (!signature) return false;
	const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const expected = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload)));
	return constantTimeEqual(signature, expected);
};

export type ZohoEmailEvent = {
	webhookRequestId: string;
	clientReference: string | null;
	event: 'delivered' | 'soft_bounce' | 'hard_bounce' | 'complaint' | 'open' | 'click' | 'unknown';
	occurredAt: string | null;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const eventKind = (value: unknown): ZohoEmailEvent['event'] => {
	const name = typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]/g, '') : '';
	if (name === 'delivered' || name === 'emaildelivered' || name === 'emaildelivery') return 'delivered';
	if (name === 'softbounce') return 'soft_bounce';
	if (name === 'hardbounce') return 'hard_bounce';
	// `fbl_compliant` is how the provider spells it.
	if (name === 'fblcompliant' || name === 'fblcomplaint' || name === 'feedbackloop' || name === 'complaint') return 'complaint';
	if (name === 'emailopen' || name === 'open') return 'open';
	if (name === 'emaillinkclick' || name === 'click' || name === 'linkclick') return 'click';
	return 'unknown';
};

const validInstant = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/**
 * One notification can carry several messages. The panel's samples use lists, and the published
 * field table reads as single objects, so both shapes are accepted. The detail object can name the
 * event differently from `event_name`, and only bounces carry their own time.
 * Only identifiers leave this function: addresses and diagnostics are never stored.
 */
export const parseZohoEmailEvents = (payload: unknown): ZohoEmailEvent[] => {
	if (!isRecord(payload) || typeof payload.webhook_request_id !== 'string' || !payload.webhook_request_id) return [];
	const baseId = payload.webhook_request_id.slice(0, 180);
	const topName = list(payload.event_name)[0];
	return list(payload.event_message).flatMap((entry, index) => {
		if (!isRecord(entry)) return [];
		const info = isRecord(entry.email_info) ? entry.email_info : {};
		const data = list(entry.event_data)[0];
		const details = isRecord(data) ? list(data.details)[0] : null;
		const named = eventKind(isRecord(data) ? data.object : undefined);
		const event = named === 'unknown' ? eventKind(topName) : named;
		return [{
			webhookRequestId: `${baseId}:${index}`,
			clientReference: typeof info.client_reference === 'string' ? info.client_reference : null,
			event,
			occurredAt: (isRecord(details) ? validInstant(details.time) : null) ?? validInstant(info.processed_time)
		}];
	});
};
