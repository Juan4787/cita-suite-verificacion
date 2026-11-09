import { describe, expect, it, vi } from 'vitest';
import { JobBudgetExhaustedError } from '$lib/server/integrations/internal/job-budget';
import { classifyZohoResponse, parseZohoEmailEvents, sendZohoEmail, verifyZohoSignature, zohoEmailBody, zohoSignedPayload, type EmailMessage } from './zoho-email';

const message: EmailMessage = {
	reference: 'delivery-1', from: { address: 'turnos@prueba.cita-suite.com.ar', name: 'Consultorio' }, to: 'paciente@example.test',
	subject: 'Asunto', html: '<p>x</p>', text: 'x', headers: { 'List-Unsubscribe': '<https://x>' }
};
const refusal = (code: string) => ({ error: { code: 'TM_4001', details: [{ code, message: 'x' }], message: 'Access Denied' } });

describe('classifyZohoResponse, from answers the real API gave', () => {
	it('accepts 201 with EM_104 and keeps the request id', () => {
		expect(classifyZohoResponse(201, { data: [{ code: 'EM_104', additional_info: [], message: 'Email request received' }], message: 'OK', request_id: 'r1', object: 'email' }))
			.toEqual({ outcome: 'accepted', requestId: 'r1' });
	});
	it('never treats a success it cannot read as accepted or as failed', () => {
		for (const body of [null, {}, { data: [] }, { data: [{ code: 'OTHER' }], request_id: 'r' }, { data: [{ code: 'EM_104' }] }])
			expect(classifyZohoResponse(200, body)).toEqual({ outcome: 'uncertain', code: 'unexpected_success' });
	});
	it('tells apart a sender, a key and a recipient problem, which all arrive as 401', () => {
		expect(classifyZohoResponse(401, refusal('SM_111'))).toEqual({ outcome: 'sender_rejected', code: 'SM_111' });
		expect(classifyZohoResponse(401, refusal('SERR_157'))).toEqual({ outcome: 'pause', code: 'SERR_157' });
		expect(classifyZohoResponse(401, refusal('SM_113'))).toEqual({ outcome: 'failed', code: 'SM_113' });
	});
	it('keeps an unknown refusal from silently ending a message', () => {
		expect(classifyZohoResponse(401, refusal('NEW_CODE'))).toEqual({ outcome: 'pause', code: 'NEW_CODE' });
		expect(classifyZohoResponse(403, {})).toEqual({ outcome: 'pause', code: 'http_403' });
	});
	it('retries a limit, and treats a server error as possibly sent', () => {
		expect(classifyZohoResponse(429, {}).outcome).toBe('retry');
		expect(classifyZohoResponse(500, {}).outcome).toBe('uncertain');
		expect(classifyZohoResponse(503, null).outcome).toBe('uncertain');
		expect(classifyZohoResponse(408, null).outcome).toBe('uncertain');
	});
	it('does not let a provider string become a stored code', () => {
		expect(classifyZohoResponse(400, { error: { code: 'x y\n<script>' } })).toEqual({ outcome: 'failed', code: 'http_400' });
	});
});

describe('sendZohoEmail', () => {
	// The stand-in copies the rule of the real engine, which refuses `redirect: 'error'` before the
	// request leaves (measured on workerd, plan 4.3): a plain fake accepts it and hides the defect.
	const workerdFetch = (response: () => Response) => vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (init?.redirect !== undefined && !['follow', 'manual'].includes(init.redirect))
			throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
		return response();
	}) as unknown as typeof fetch;
	it('reaches the provider with a redirect mode the Workers engine accepts', async () => {
		const fetchFn = workerdFetch(() => new Response(JSON.stringify({ data: [{ code: 'EM_104' }], request_id: 'r1' }), { status: 201 }));
		await expect(sendZohoEmail(fetchFn, 'key', message)).resolves.toEqual({ outcome: 'accepted', requestId: 'r1' });
	});
	it('does not follow a redirect, and treats it as possibly sent', async () => {
		const fetchFn = workerdFetch(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }));
		await expect(sendZohoEmail(fetchFn, 'key', message)).resolves.toEqual({ outcome: 'uncertain', code: 'http_302' });
	});
	it('asks for no open or click tracking and sends the reference', () => {
		expect(zohoEmailBody(message)).toMatchObject({ track_opens: false, track_clicks: false, client_reference: 'delivery-1' });
		// Nobody reads replies (plan 12.35): without Reply-To an answer goes to the sending address, which receives nothing.
		expect(zohoEmailBody(message)).not.toHaveProperty('reply_to');
	});
	it('marks a lost answer as uncertain, never as failed', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new DOMException('aborted', 'TimeoutError'));
		await expect(sendZohoEmail(fetchFn, 'key', message)).resolves.toEqual({ outcome: 'uncertain', code: 'network' });
	});
	it('lets a budget refusal through: that request never started', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new JobBudgetExhaustedError('calls'));
		await expect(sendZohoEmail(fetchFn, 'key', message)).rejects.toBeInstanceOf(JobBudgetExhaustedError);
	});
	it('treats an unreadable success as uncertain', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('not json', { status: 201 }));
		await expect(sendZohoEmail(fetchFn, 'key', message)).resolves.toEqual({ outcome: 'uncertain', code: 'unreadable_success' });
	});
});

const sign = async (payload: string, key: string, ts: number) => {
	const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload)));
	return `ts=${ts};s=${encodeURIComponent(btoa(String.fromCharCode(...mac)))};s-algorithm=HmacSHA256`;
};

describe('webhook signature', () => {
	const now = 1_800_000_000_000;
	it('accepts the provider signature over the decoded single form value', async () => {
		const payload = '{"a":"b c+d"}';
		const raw = `body=${encodeURIComponent(payload)}`;
		expect(zohoSignedPayload(raw)).toBe(payload);
		await expect(verifyZohoSignature(await sign(payload, 'k', now), payload, 'k', now)).resolves.toBe(true);
	});
	it('rejects another key, altered text, an old timestamp, another algorithm and missing parts', async () => {
		const header = await sign('x', 'k', now);
		await expect(verifyZohoSignature(header, 'x', 'other', now)).resolves.toBe(false);
		await expect(verifyZohoSignature(header, 'y', 'k', now)).resolves.toBe(false);
		await expect(verifyZohoSignature(header, 'x', 'k', now + 16 * 60 * 1000)).resolves.toBe(false);
		await expect(verifyZohoSignature(header.replace('HmacSHA256', 'HmacSHA1'), 'x', 'k', now)).resolves.toBe(false);
		await expect(verifyZohoSignature(null, 'x', 'k', now)).resolves.toBe(false);
		await expect(verifyZohoSignature('ts=1', 'x', 'k', now)).resolves.toBe(false);
		await expect(verifyZohoSignature(header, 'x', '', now)).resolves.toBe(false);
	});
});

describe('parseZohoEmailEvents', () => {
	const info = { client_reference: 'delivery-1', to: [{ email_address: { address: 'private@example.test' } }] };
	it('reads the object form and the list form, and keeps only identifiers', () => {
		const single = parseZohoEmailEvents({ webhook_request_id: 'w', event_name: 'hard bounce', event_message: { email_info: info, event_data: { object: 'hardbounce', details: { time: '2026-11-05T21:08:22-03:00' } } } });
		expect(single).toEqual([{ webhookRequestId: 'w:0', clientReference: 'delivery-1', event: 'hard_bounce', occurredAt: '2026-11-06T00:08:22.000Z' }]);
		const many = parseZohoEmailEvents({ webhook_request_id: 'w', event_name: ['softbounce'], event_message: [{ email_info: info, event_data: [{ object: 'softbounce', details: [{}] }] }] });
		expect(many[0]?.event).toBe('soft_bounce');
		expect(JSON.stringify(many)).not.toContain('private@example.test');
	});
	it('names complaints, deliveries and what it does not know', () => {
		const kind = (object: string) => parseZohoEmailEvents({ webhook_request_id: 'w', event_message: { event_data: { object } } })[0]?.event;
		expect(kind('fbl_complaint')).toBe('complaint');
		expect(kind('delivered')).toBe('delivered');
		expect(kind('something new')).toBe('unknown');
	});
	it('reads the four shapes the provider panel shows', () => {
		const processed = '2026-11-06T20:29:35Z';
		const read = (name: string, object: string, details: Record<string, unknown>) =>
			parseZohoEmailEvents({
				webhook_request_id: 'w',
				event_name: [name],
				event_message: [{ email_info: { client_reference: 'delivery-1', processed_time: processed, object: 'email' }, event_data: [{ details: [details], object }] }]
			})[0];
		const bounced = '2026-11-06T20:30:13Z';
		expect(read('delivered', 'email_delivery', { status: 'DELIVERED' })).toMatchObject({ event: 'delivered', occurredAt: '2026-11-06T20:29:35.000Z' });
		expect(read('softbounce', 'softbounce', { time: bounced })).toMatchObject({ event: 'soft_bounce', occurredAt: '2026-11-06T20:30:13.000Z' });
		expect(read('hardbounce', 'hardbounce', { time: bounced })).toMatchObject({ event: 'hard_bounce', occurredAt: '2026-11-06T20:30:13.000Z' });
		expect(read('fbl_compliant', 'fbl_compliant', { ip: '192.0.2.1' })).toMatchObject({ event: 'complaint', occurredAt: '2026-11-06T20:29:35.000Z' });
	});
	it('falls back to the event name when the detail object is new', () => {
		const event = parseZohoEmailEvents({ webhook_request_id: 'w', event_name: ['delivered'], event_message: [{ event_data: [{ object: 'something new' }] }] })[0];
		expect(event?.event).toBe('delivered');
	});
	it('ignores a payload without its transaction id', () => {
		expect(parseZohoEmailEvents({ event_message: {} })).toEqual([]);
		expect(parseZohoEmailEvents(null)).toEqual([]);
	});
});
