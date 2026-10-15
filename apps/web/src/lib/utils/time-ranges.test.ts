import { describe, expect, it } from 'vitest';
import {
	formatTimeRanges,
	normalizeTimeRangesForCommit,
	normalizeTimeRangesInput,
	normalizeTimeValue,
	parseTimeRanges
} from './time-ranges';

describe('time range input helpers', () => {
	it('normalizes single hours and compact hour/minute values', () => {
		expect(normalizeTimeValue('9')).toBe('09:00');
		expect(normalizeTimeValue('930')).toBe('09:30');
		expect(normalizeTimeValue('9,15')).toBe('09:15');
		expect(normalizeTimeValue('9:15')).toBe('09:15');
		expect(normalizeTimeValue('09.45 hs')).toBe('09:45');
	});

	it('accepts human writing and formats ranges', () => {
		expect(normalizeTimeRangesInput('9 a 13')).toBe('09:00-13:00');
		expect(normalizeTimeRangesInput('9,15 a 13')).toBe('09:15-13:00');
		expect(normalizeTimeRangesInput('9,15-13,45')).toBe('09:15-13:45');
		expect(normalizeTimeRangesInput('9:15 a 13:45')).toBe('09:15-13:45');
		expect(normalizeTimeRangesInput('9.15 a 13.45')).toBe('09:15-13:45');
		expect(normalizeTimeRangesInput('9-13, 15-19')).toBe('09:00-13:00, 15:00-19:00');
		expect(normalizeTimeRangesInput('09:00 hasta 13:00')).toBe('09:00-13:00');
	});

	it('accepts compact digit entry for fast typing', () => {
		expect(normalizeTimeRangesInput('09001300')).toBe('09:00-13:00');
		expect(normalizeTimeRangesInput('9001300')).toBe('09:00-13:00');
		expect(normalizeTimeRangesInput('0900130015001900')).toBe('09:00-13:00, 15:00-19:00');
	});

	it('rejects invalid or inverted ranges', () => {
		expect(parseTimeRanges('13-9')).toBeNull();
		expect(parseTimeRanges('25-30')).toBeNull();
		expect(formatTimeRanges([{ start: '09:00', end: '13:00' }])).toBe('09:00-13:00');
	});

	it('commits only interpretable ranges', () => {
		expect(normalizeTimeRangesForCommit('9-15')).toEqual({
			ok: true,
			value: '09:00-15:00',
			ranges: [{ start: '09:00', end: '15:00' }]
		});
		expect(normalizeTimeRangesForCommit('09:00-')).toEqual({ ok: false });
		expect(normalizeTimeRangesForCommit('')).toEqual({ ok: false });
	});
});
