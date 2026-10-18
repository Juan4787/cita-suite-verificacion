import { describe, expect, it } from 'vitest';
import {
	acceptProfessionalDraftSave,
	cloneProfessionalDraft,
	sanitizeProfessionalDraft,
	type ProfessionalDraft
} from './professional-editor';

const draft = (): ProfessionalDraft => ({
	name: 'Synthetic professional',
	specialty: '',
	phone: '',
	email: '',
	isAvailable: true,
	serviceIds: ['service-one'],
	schedule: {
		blocks: [
			{
				id: 'block-one',
				weekdays: [1],
				timeRanges: '09:00-12:00',
				slotInterval: '15',
				gridInterval: '20',
				serviceScope: 'restricted',
				allowedServiceIds: ['service-one']
			}
		]
	},
	exception: {
		appliesTo: 'professional',
		type: 'blocked',
		periodMode: 'multiple',
		dates: ['2026-11-01'],
		allowedServiceIds: [],
		requestId: 'a6700000-0000-4000-8000-000000000001',
		date: '',
		dateFrom: '',
		dateTo: '',
		timeRange: '',
		reason: ''
	}
});
describe('professional editing draft isolation and historical recovery', () => {
	it('acknowledges only the submitted profile while retaining later edits', () => {
		const submitted = draft(),
			current = cloneProfessionalDraft(submitted);
		current.name = 'Edited while saving';
		const accepted = acceptProfessionalDraftSave(current, draft(), submitted, 'profile');
		expect(accepted.baseline.name).toBe(submitted.name);
		expect(accepted.draft.name).toBe('Edited while saving');
	});
	it('keeps a newly edited exception after an earlier save-all response', () => {
		const submitted = draft(),
			current = cloneProfessionalDraft(submitted);
		current.exception.dates.push('2026-11-02');
		const accepted = acceptProfessionalDraftSave(current, draft(), submitted, 'all');
		expect(accepted.draft.exception.dates).toEqual(['2026-11-01', '2026-11-02']);
		expect(accepted.baseline.exception.dates).toEqual([]);
	});
	it('copies all editable collections without mutating the saved baseline', () => {
		const baseline = draft(),
			copy = cloneProfessionalDraft(baseline);
		copy.serviceIds.push('service-two');
		copy.schedule.blocks[0].weekdays.push(2);
		copy.schedule.blocks[0].allowedServiceIds?.push('service-two');
		copy.exception.dates.push('2026-11-02');
		copy.exception.allowedServiceIds.push('service-two');
		expect(baseline).toEqual(draft());
	});
	it('preserves a closed restricted block and multiple dates on recovery', () => {
		const value = draft();
		value.schedule.blocks[0].allowedServiceIds = [];
		const restored = sanitizeProfessionalDraft(value, draft());
		expect(restored.schedule.blocks[0]).toMatchObject({
			serviceScope: 'restricted',
			allowedServiceIds: []
		});
		expect(restored.exception).toEqual(value.exception);
	});
	it('recovers historical schedule spacing without swapping break and grid', () => {
		const restored = sanitizeProfessionalDraft(
			{
				schedule: {
					weekdays: [1, '3', 9],
					timeRanges: '10-12',
					breakMinutes: '25',
					slotInterval: '10'
				}
			},
			draft()
		);
		expect(restored.schedule.blocks).toEqual([
			{
				id: 'restored-block-1',
				weekdays: [1, 3],
				timeRanges: '10-12',
				slotInterval: '25',
				gridInterval: '10'
			}
		]);
	});
	it('checks unknown stored JSON without accepting arbitrary objects as identifiers or sharing fallback collections', () => {
		const fallback = draft();
		const restored = sanitizeProfessionalDraft(
			{
				name: false,
				serviceIds: ['service-one', { arbitrary: true }],
				schedule: null,
				exception: 'invalid'
			},
			fallback
		);
		expect(restored.name).toBe(fallback.name);
		expect(restored.serviceIds).toEqual(['service-one']);
		restored.schedule.blocks[0].weekdays.push(6);
		expect(fallback.schedule.blocks[0].weekdays).toEqual([1]);
		expect(() => sanitizeProfessionalDraft(null, fallback)).not.toThrow();
	});
});

describe('professional dependency confirmation contract', () => {
	it('accepts explicit zero counts, never missing, fractional or negative counts', async () => {
		const { parseProfessionalDependencyCounts } = await import('./professional-editor');
		expect(
			parseProfessionalDependencyCounts({
				appointment_count: 0,
				clinical_entry_count: 0,
				follow_up_count: 0
			})
		).toEqual({ appointment_count: 0, clinical_entry_count: 0, follow_up_count: 0 });
		for (const item of [
			{},
			{ appointment_count: '0', clinical_entry_count: 0, follow_up_count: 0 },
			{ appointment_count: 0, clinical_entry_count: -1, follow_up_count: 0 },
			{ appointment_count: 0, clinical_entry_count: 0, follow_up_count: 0.5 },
			null
		])
			expect(parseProfessionalDependencyCounts(item)).toBeNull();
	});
	it('rejects unknown restriction enums instead of enabling every service', async () => {
		const { professionalRuleScope, professionalExceptionType } =
			await import('./professional-editor');
		expect(professionalRuleScope('restricted')).toBe('restricted');
		expect(professionalExceptionType('restricted')).toBe('restricted');
		expect(() => professionalRuleScope('unknown')).toThrow();
		expect(() => professionalExceptionType('unknown')).toThrow();
	});
});
