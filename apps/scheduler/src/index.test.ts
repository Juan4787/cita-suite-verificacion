import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { handleScheduled, runScheduledJob, type Env } from './index.ts';

const scheduledTime = Date.parse('2026-10-19T12:05:00Z');

function app(response: () => Response) {
	const requests: Request[] = [];
	const env: Env = {
		INTERNAL_JOB_SECRET: 'job-secret',
		APP: {
			fetch: async (input, init) => {
				requests.push(new Request(input, init));
				return response();
			}
		}
	};
	return { env, requests };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('disparo de una categoría', () => {
	it('pide al app exactamente la categoría del evento y devuelve su recibo', async () => {
		const { env, requests } = app(() => json({ ok: true, kind: 'push', processed: 3 }));
		const receipt = await runScheduledJob('*/5 * * * *', scheduledTime, env);
		assert.equal(receipt.ok, true);
		assert.equal(receipt.kind, 'push');
		assert.equal(requests.length, 1);
		assert.equal(requests[0].method, 'POST');
		assert.equal(new URL(requests[0].url).pathname, '/internal/jobs/push');
		assert.equal(requests[0].headers.get('authorization'), 'Bearer job-secret');
		assert.equal(requests[0].headers.get('x-cita-scheduled-time'), '2026-10-19T12:05:00.000Z');
	});

	const failures: [string, () => Response][] = [
		['un error HTTP', () => json({ ok: false, kind: 'push' }, 503)],
		['un recibo de otra categoría', () => json({ ok: true, kind: 'calendar' })],
		['un cuerpo que no es JSON', () => new Response('upstream timeout', { status: 200 })]
	];
	for (const [name, response] of failures)
		it(`falla visiblemente ante ${name}`, async () => {
			const { env } = app(response);
			await assert.rejects(runScheduledJob('*/5 * * * *', scheduledTime, env), /Scheduled push job did not complete/);
		});
});

describe('evento programado', () => {
	it('no pide reintento inmediato a la plataforma cuando la tarea falla', async () => {
		const { env } = app(() => json({ ok: false, kind: 'calendar' }, 500));
		const noRetry = mock.fn();
		await assert.rejects(
			handleScheduled({ cron: '1-59/5 * * * *', scheduledTime, noRetry }, env),
			/Scheduled calendar job did not complete \(HTTP 500\)\./
		);
		assert.equal(noRetry.mock.callCount(), 1);
	});

	it('completa sin tocar los reintentos cuando el recibo es válido', async () => {
		const { env } = app(() => json({ ok: true, kind: 'calendar' }));
		const noRetry = mock.fn();
		await handleScheduled({ cron: '1-59/5 * * * *', scheduledTime, noRetry }, env);
		assert.equal(noRetry.mock.callCount(), 0);
	});
});
