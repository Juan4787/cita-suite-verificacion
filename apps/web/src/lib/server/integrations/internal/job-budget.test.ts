import { describe, expect, it } from 'vitest';
import {
	CHAIN_ENTRY_CALLS,
	EXTERNAL_CALL_TIMEOUT_MS,
	JOB_DEADLINE_MS,
	JobBudgetExhaustedError,
	MAX_CONCURRENT_EXTERNAL_CALLS,
	MIN_WORK_START_MS,
	WORK_DEADLINE_MS,
	createJobBudget,
	parseJobBudgetProfile
} from './job-budget';

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
};

describe('presupuesto de la cadena programada', () => {
	it('descuenta el Service Binding y separa viajes a la base de llamadas a proveedores', async () => {
		const budget = createJobBudget('free');
		expect(budget.used).toBe(CHAIN_ENTRY_CALLS);
		expect(budget.remaining()).toBe(39);
		const ok = async () => new Response('{}');
		await budget.fetchFor('database', ok)('https://db.example.test/rest/v1/x');
		await budget.fetchFor('provider', ok)('https://push.example.test/send');
		await budget.fetchFor('provider', ok)('https://push.example.test/send');
		expect(budget.summary()).toMatchObject({
			profile: 'free',
			maxCalls: 40,
			usedCalls: 4,
			databaseRequests: 1,
			providerRequests: 2
		});
		expect(createJobBudget('paid').remaining()).toBe(299);
	});

	it('nunca ejecuta más de cuatro operaciones externas a la vez', async () => {
		const budget = createJobBudget('free');
		const gates = Array.from({ length: 10 }, deferred);
		let active = 0;
		let peak = 0;
		const calls = gates.map((gate) =>
			budget.call('provider', async () => {
				active++;
				peak = Math.max(peak, active);
				await gate.promise;
				active--;
			})
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(active).toBe(MAX_CONCURRENT_EXTERNAL_CALLS);
		for (const gate of gates) {
			gate.resolve();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await Promise.all(calls);
		expect(peak).toBe(MAX_CONCURRENT_EXTERNAL_CALLS);
	});

	it('rechaza sin ejecutar la llamada que excede el presupuesto, también entre llamadas concurrentes', async () => {
		const budget = createJobBudget('free');
		let executed = 0;
		const results = await Promise.allSettled(
			Array.from({ length: 50 }, () =>
				budget.call('database', async () => {
					executed++;
				})
			)
		);
		expect(executed).toBe(39);
		const rejected = results.filter((result) => result.status === 'rejected');
		expect(rejected).toHaveLength(11);
		for (const result of rejected)
			expect(result.status === 'rejected' && result.reason).toEqual(new JobBudgetExhaustedError('calls'));
		expect(budget.used).toBe(40);
	});

	it('admite trabajo sólo con su peor caso y el registro de resultados reservado', () => {
		const budget = createJobBudget('free');
		expect(budget.admits({ calls: 37 }, 2)).toBe(true);
		expect(budget.admits({ calls: 38 }, 2)).toBe(false);
		budget.enterFinalization();
		expect(budget.admits({ calls: 1 }, 0)).toBe(false);
	});

	it('corta el trabajo antes de la reserva final y deja registrar resultados hasta la fecha límite', async () => {
		let clock = 1_000;
		const budget = createJobBudget('free', () => clock);
		let timeout = 0;
		const measure = (signal: AbortSignal) =>
			new Promise<void>((resolve) => {
				const started = Date.now();
				signal.addEventListener('abort', () => {
					timeout = Date.now() - started;
					resolve();
				});
			});
		clock += WORK_DEADLINE_MS - MIN_WORK_START_MS;
		expect(budget.admits({ calls: 1 }, 1)).toBe(true);
		clock += 1_950;
		expect(budget.admits({ calls: 1 }, 1)).toBe(false);
		// The work call is bounded by the 50 ms left before the finalization reserve.
		await budget.call('provider', measure);
		expect(timeout).toBeLessThan(EXTERNAL_CALL_TIMEOUT_MS);
		clock += 50;
		let executed = false;
		await expect(
			budget.call('provider', async () => {
				executed = true;
			})
		).rejects.toEqual(new JobBudgetExhaustedError('time'));
		expect(executed).toBe(false);
		budget.enterFinalization();
		await expect(budget.call('database', async () => 'recorded')).resolves.toBe('recorded');
		clock = 1_000 + JOB_DEADLINE_MS;
		await expect(budget.call('database', async () => 'late')).rejects.toEqual(new JobBudgetExhaustedError('time'));
		expect(budget.summary()).toMatchObject({ usedCalls: CHAIN_ENTRY_CALLS + 2, databaseRequests: 1, providerRequests: 1 });
	});

	it('cancela la llamada cuando la cancela quien la pidió', async () => {
		const budget = createJobBudget('free');
		const caller = new AbortController();
		let received: AbortSignal | undefined;
		const pending = budget.fetchFor('provider', async (_input, init) => {
			received = init?.signal ?? undefined;
			return new Response('{}');
		})('https://push.example.test/send', { signal: caller.signal });
		await pending;
		expect(received?.aborted).toBe(false);
		caller.abort();
		expect(received?.aborted).toBe(true);
	});

	it('usa el perfil Free salvo indicación explícita de Paid', () => {
		expect(parseJobBudgetProfile(undefined)).toBe('free');
		expect(parseJobBudgetProfile('free')).toBe('free');
		expect(parseJobBudgetProfile(' paid ')).toBe('paid');
		expect(parseJobBudgetProfile('unlimited')).toBe('free');
	});
});
