import { describe, expect, it } from 'vitest';
import {
	canonicalScheduleBlocks,
	scheduleBlocksFromRules,
	validateScheduleBlocks
} from './schedule-blocks';

describe('schedule blocks', () => {
	it('permite bloques estructurales con días y horarios distintos', () => {
		const result = validateScheduleBlocks([
			{ weekdays: [1, 3, 5], timeRanges: '8 a 15', slotInterval: '15' },
			{ weekdays: [6], timeRanges: '9 a 13', slotInterval: '15' }
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.blocks).toEqual([
			{
				weekdays: [1, 3, 5],
				ranges: [{ start: '08:00', end: '15:00' }],
				slotIntervalMinutes: 15,
				breakMinutes: 15
			},
			{
				weekdays: [6],
				ranges: [{ start: '09:00', end: '13:00' }],
				slotIntervalMinutes: 15,
				breakMinutes: 15
			}
		]);
	});

	it.each(['0', '2', '23', '60'])(
		'acepta %s minutos enteros de descanso sin cambiar la grilla interna',
		(value) => {
			const result = validateScheduleBlocks([
				{
					weekdays: [1],
					timeRanges: '9 a 13',
					slotInterval: value,
					gridInterval: '15'
				}
			]);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.blocks[0]).toMatchObject({
				breakMinutes: Number(value),
				slotIntervalMinutes: 15
			});
		}
	);

	it.each(['-1', '2.5', ''])(
		'rechaza el descanso inválido %j con una explicación y ejemplos',
		(value) => {
			const result = validateScheduleBlocks([
				{ weekdays: [1], timeRanges: '9 a 13', slotInterval: value }
			]);

			expect(result).toMatchObject({ ok: false });
			if (result.ok) return;
			expect(result.message).toContain('entera');
			expect(result.message).toContain('0, 2, 23 o 60');
		}
	);

	it('rechaza franjas superpuestas del mismo día', () => {
		const result = validateScheduleBlocks([
			{ weekdays: [1, 2, 3, 4, 5, 6], timeRanges: '8 a 15', slotInterval: '15' },
			{ weekdays: [6], timeRanges: '9 a 13', slotInterval: '15' }
		]);

		expect(result).toMatchObject({
			ok: false,
			message: expect.stringContaining('superponerse')
		});
	});

	it('agrupa reglas existentes por conjunto de días con la misma franja', () => {
		const blocks = scheduleBlocksFromRules([
			{ weekday: 1, start_time: '08:00:00', end_time: '15:00:00', slot_interval_minutes: 15 },
			{ weekday: 5, start_time: '08:00:00', end_time: '15:00:00', slot_interval_minutes: 15 },
			{ weekday: 6, start_time: '09:00:00', end_time: '13:00:00', slot_interval_minutes: 15 }
		]);

		expect(blocks).toEqual([
			{
				id: 'block-1',
				weekdays: [1, 5],
				timeRanges: '08:00-15:00',
				slotInterval: '15',
				gridInterval: '15'
			},
			{
				id: 'block-2',
				weekdays: [6],
				timeRanges: '09:00-13:00',
				slotInterval: '15',
				gridInterval: '15'
			}
		]);
	});

	it('canoniza bloques equivalentes aunque vengan con sintaxis horaria distinta', () => {
		expect(
			canonicalScheduleBlocks([{ weekdays: [5, 1], timeRanges: '8 a 15', slotInterval: '15' }])
		).toBe(
			canonicalScheduleBlocks([{ weekdays: [1, 5], timeRanges: '08:00-15:00', slotInterval: '15' }])
		);
	});
});

describe('service restrictions in schedule drafts', () => {
	it('permits adjacent blocks on the same weekday and preserves a closed restriction', () => {
		const blocks = [
			{ weekdays: [2], timeRanges: '14-17', slotInterval: '0' },
			{
				weekdays: [2],
				timeRanges: '17-19',
				slotInterval: '0',
				serviceScope: 'restricted' as const,
				allowedServiceIds: []
			}
		];
		expect(validateScheduleBlocks(blocks).ok).toBe(true);
		expect(canonicalScheduleBlocks(blocks)).toContain('restricted');
		const reconstructed = scheduleBlocksFromRules([
			{
				weekday: 2,
				start_time: '17:00',
				end_time: '19:00',
				slot_interval_minutes: 30,
				service_scope: 'restricted',
				allowed_service_ids: []
			}
		]);
		expect(reconstructed[0]).toMatchObject({ serviceScope: 'restricted', allowedServiceIds: [] });
	});
});

describe('unknown schedule draft JSON', () => {
	it('rejects unknown restriction scope and object identifiers without broadening a closed window', async () => {
		const { parseScheduleBlocksJson } = await import('./schedule-blocks');
		const block = {
			weekdays: [1],
			timeRanges: '9-12',
			slotInterval: '15',
			serviceScope: 'restricted',
			allowedServiceIds: []
		};
		expect(parseScheduleBlocksJson(JSON.stringify([block]))).toMatchObject([
			{ serviceScope: 'restricted', allowedServiceIds: [] }
		]);
		expect(
			parseScheduleBlocksJson(JSON.stringify([{ ...block, serviceScope: 'unknown' }]))
		).toBeNull();
		expect(
			parseScheduleBlocksJson(
				JSON.stringify([{ ...block, allowedServiceIds: [{ id: 'synthetic' }] }])
			)
		).toBeNull();
		expect(parseScheduleBlocksJson(JSON.stringify([null]))).toBeNull();
	});
	it('retains historical scalar field names and break/grid values', async () => {
		const { parseScheduleBlocksJson } = await import('./schedule-blocks');
		expect(
			parseScheduleBlocksJson(
				JSON.stringify([
					{
						weekdays: [1, '3', true, {}],
						time_ranges: '10-12',
						break_minutes: 25,
						slot_interval_minutes: 10
					}
				])
			)
		).toEqual([
			{
				serviceScope: 'all',
				allowedServiceIds: [],
				weekdays: [1, 3],
				timeRanges: '10-12',
				slotInterval: '25',
				gridInterval: '10'
			}
		]);
	});
});
