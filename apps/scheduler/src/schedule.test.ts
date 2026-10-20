import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SCHEDULED_JOB_KINDS } from '@cita-suite/shared/scheduled-jobs';
import { CRON_SCHEDULE, jobForEvent } from './schedule.ts';

const at = (iso: string) => Date.parse(iso);

describe('programación versionada', () => {
	it('asigna una sola categoría a cada disparador del plan', () => {
		assert.equal(jobForEvent('*/5 * * * *', at('2026-10-19T12:05:00Z')), 'push');
		assert.equal(jobForEvent('1-59/5 * * * *', at('2026-10-19T12:06:00Z')), 'calendar');
		assert.equal(jobForEvent('2-59/10 * * * *', at('2026-10-19T12:12:00Z')), 'reviews');
		assert.equal(jobForEvent('3-59/15 * * * *', at('2026-10-19T12:18:00Z')), 'uploads');
	});

	it('alterna conciliación comercial y de almacenamiento, cada una cada seis horas UTC', () => {
		const maintenance = (hour: string) => jobForEvent('17 */3 * * *', at(`2026-10-19T${hour}:17:00Z`));
		assert.deepEqual(['00', '06', '12', '18'].map(maintenance), Array(4).fill('commercial'));
		assert.deepEqual(['03', '09', '15', '21'].map(maintenance), Array(4).fill('storage'));
	});

	it('cubre todas las categorías y rechaza una expresión no versionada', () => {
		const scheduled = new Set<string>(Object.values(CRON_SCHEDULE));
		scheduled.delete('maintenance');
		scheduled.add('commercial').add('storage');
		assert.deepEqual([...scheduled].sort(), [...SCHEDULED_JOB_KINDS].sort());
		assert.throws(() => jobForEvent('*/1 * * * *', at('2026-10-19T12:00:00Z')), /Unscheduled/);
	});

	it('coincide exactamente con los cinco triggers desplegados', () => {
		const config: { triggers: { crons: string[] } } = JSON.parse(
			readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')
		);
		assert.deepEqual(config.triggers.crons, Object.keys(CRON_SCHEDULE));
		assert.equal(config.triggers.crons.length, 5);
	});

	it('staging usa la misma programación y llama sólo a la app de staging', () => {
		type Environment = { name: string; triggers: { crons: string[] }; services: { binding: string; service: string }[] };
		const config: Environment & { env: { staging: Environment } } = JSON.parse(
			readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')
		);
		assert.deepEqual(config.env.staging.triggers.crons, Object.keys(CRON_SCHEDULE));
		assert.deepEqual(config.services, [{ binding: 'APP', service: 'app' }]);
		assert.deepEqual(config.env.staging.services, [{ binding: 'APP', service: 'cita-suite-staging' }]);
		assert.notEqual(config.env.staging.name, config.name);
	});
});
