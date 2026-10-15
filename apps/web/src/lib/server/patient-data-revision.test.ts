import { describe, expect, it } from 'vitest';
import { patientDataCacheScope } from './patient-data-revision';

describe('patient cache identity scope', () => {
	it('is deterministic but changes with the user, business or role', () => {
		const base = {
			userId: 'user-1',
			businessId: 'business-1',
			role: 'reception' as const,
			canCreatePatient: true
		};
		const first = patientDataCacheScope(base);

		expect(first).toBe(patientDataCacheScope(base));
		expect(first).not.toContain(base.userId);
		expect(first).not.toContain(base.businessId);
		expect(first).not.toBe(patientDataCacheScope({ ...base, userId: 'user-2' }));
		expect(first).not.toBe(patientDataCacheScope({ ...base, businessId: 'business-2' }));
		expect(first).not.toBe(patientDataCacheScope({ ...base, role: 'professional' }));
		expect(first).not.toBe(patientDataCacheScope({ ...base, canCreatePatient: false }));
	});
});
