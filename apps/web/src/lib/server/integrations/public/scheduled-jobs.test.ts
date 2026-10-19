import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({ privateEnv: {} as Record<string, string | undefined> }));
const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	sendPushReminderBatch: vi.fn(),
	processGoogleCalendarSyncBatch: vi.fn(),
	sendGoogleReviewRequestBatch: vi.fn(),
	reconcileMercadoPago: vi.fn(),
	cleanupAbandonedClinicalUploads: vi.fn(),
	reconcileClinicalStorage: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/platform/supabase', () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock('$lib/server/integrations/public/push', () => ({ sendPushReminderBatch: mocks.sendPushReminderBatch }));
vi.mock('$lib/server/integrations/public/google-calendar', () => ({
	processGoogleCalendarSyncBatch: mocks.processGoogleCalendarSyncBatch
}));
vi.mock('$lib/server/integrations/public/google-reviews', () => ({
	sendGoogleReviewRequestBatch: mocks.sendGoogleReviewRequestBatch
}));
vi.mock('$lib/server/integrations/public/mercadopago', () => ({ reconcileMercadoPago: mocks.reconcileMercadoPago }));
vi.mock('$lib/server/patients/public/clinical-files', () => ({
	cleanupAbandonedClinicalUploads: mocks.cleanupAbandonedClinicalUploads,
	reconcileClinicalStorage: mocks.reconcileClinicalStorage
}));

import { legacyJobEntrypointsEnabled, runScheduledJob } from '$lib/server/integrations/public/scheduled-jobs';

const admin = { admin: true };
const okFetch: typeof fetch = async () => new Response('{}');

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.createSupabaseAdminClient.mockResolvedValue(admin);
	vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('ejecución de una tarea programada', () => {
	it('cuenta aparte los viajes a la base y las llamadas a proveedores de toda la cadena', async () => {
		mocks.sendPushReminderBatch.mockImplementation(async (run) => {
			const databaseFetch = mocks.createSupabaseAdminClient.mock.calls[0][1];
			await databaseFetch('https://db.example.test/rest/v1/rpc/claim_push_reminder_batch');
			await run.providerFetch('https://push.example.test/send');
			await run.providerFetch('https://push.example.test/send');
			expect(run.supabase).toBe(admin);
			return { configured: true, claimed: 2, sent: 2 };
		});

		const receipt = await runScheduledJob('push', okFetch, { now: new Date('2026-10-19T12:05:00Z') });

		expect(receipt).toMatchObject({
			ok: true,
			kind: 'push',
			result: { claimed: 2, sent: 2 },
			budget: { profile: 'free', maxCalls: 40, usedCalls: 4, databaseRequests: 1, providerRequests: 2 }
		});
		expect(mocks.createSupabaseAdminClient).toHaveBeenCalledWith('odonto', expect.any(Function));
		expect(mocks.sendPushReminderBatch.mock.calls[0][0].now).toEqual(new Date('2026-10-19T12:05:00Z'));
	});

	it.each([
		['calendar', 'processGoogleCalendarSyncBatch'],
		['reviews', 'sendGoogleReviewRequestBatch']
	] as const)('la categoría %s ejecuta sólo su propia tarea', async (kind, job) => {
		mocks[job].mockResolvedValue({ configured: true, claimed: 0 });
		const receipt = await runScheduledJob(kind, okFetch);
		expect(receipt).toMatchObject({ ok: true, kind });
		for (const other of ['sendPushReminderBatch', 'processGoogleCalendarSyncBatch', 'sendGoogleReviewRequestBatch'] as const)
			expect(mocks[other]).toHaveBeenCalledTimes(other === job ? 1 : 0);
	});

	it('limpia cargas abandonadas de todos los consultorios con el máximo que admite la base', async () => {
		mocks.cleanupAbandonedClinicalUploads.mockResolvedValue({ files: 3, objects: 4 });
		const receipt = await runScheduledJob('uploads', okFetch);
		expect(receipt).toMatchObject({ ok: true, result: { files: 3, objects: 4 } });
		expect(mocks.cleanupAbandonedClinicalUploads).toHaveBeenCalledWith(admin, 200);
	});

	it('la conciliación comercial empieza cada suscripción sólo si su peor caso entra en el presupuesto', async () => {
		mocks.reconcileMercadoPago.mockImplementation(async (_admin, _fetch, options) => {
			expect(options.limit).toBe(20);
			expect(options.admits(9)).toBe(true);
			// 40 calls, one already spent by the Service Binding, one kept for the run summary.
			expect(options.admits(38)).toBe(true);
			expect(options.admits(39)).toBe(false);
			return { scanned: 1, credited: 0, attention: 0, errors: 0, details: ['Pago 123 acreditado'] };
		});
		const receipt = await runScheduledJob('commercial', okFetch);
		// The receipt keeps counts only, never the payment or preapproval details.
		expect(receipt.result).toEqual({ scanned: 1, credited: 0, attention: 0, errors: 0 });
	});

	it('informa un almacenamiento por encima de su límite sin datos del consultorio', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.reconcileClinicalStorage.mockResolvedValue({ unattributedBytes: 0, unknownSizeObjects: 0, overGlobalLimit: false, overBusinessLimit: 1 });
		const receipt = await runScheduledJob('storage', okFetch);
		expect(receipt).toMatchObject({ ok: true, result: { overBusinessLimit: 1 } });
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it('usa el perfil Paid sólo cuando está configurado explícitamente', async () => {
		envState.privateEnv.JOB_BUDGET_PROFILE = 'paid';
		mocks.sendPushReminderBatch.mockResolvedValue({ configured: true });
		await expect(runScheduledJob('push', okFetch)).resolves.toMatchObject({ budget: { profile: 'paid', maxCalls: 300 } });
	});

	it('una tarea que falla devuelve un recibo negativo sin exponer el error', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		mocks.processGoogleCalendarSyncBatch.mockRejectedValue(new Error('PRIVATE_SENTINEL token=abc'));
		const receipt = await runScheduledJob('calendar', okFetch, { scheduledTime: 'no es una fecha' });
		expect(receipt).toMatchObject({ ok: false, kind: 'calendar', result: null, scheduledFor: null });
		expect(JSON.stringify(receipt)).not.toContain('PRIVATE_SENTINEL');
		expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SENTINEL');
		log.mockRestore();
	});

	it('normaliza la hora programada que informa el programador', async () => {
		mocks.sendPushReminderBatch.mockResolvedValue({ configured: true });
		const receipt = await runScheduledJob('push', okFetch, { scheduledTime: '2026-10-19T12:05:00Z' });
		expect(receipt.scheduledFor).toBe('2026-10-19T12:05:00.000Z');
	});
});

describe('interruptor de las entradas antiguas', () => {
	it('lee el estado vigente en la base', async () => {
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc: async () => ({ data: false, error: null }) });
		await expect(legacyJobEntrypointsEnabled(okFetch)).resolves.toBe(false);
	});

	it('propaga un error de lectura en lugar de suponer un estado', async () => {
		mocks.createSupabaseAdminClient.mockResolvedValue({ rpc: async () => ({ data: null, error: { message: 'unavailable' } }) });
		await expect(legacyJobEntrypointsEnabled(okFetch)).rejects.toMatchObject({ message: 'unavailable' });
	});
});
