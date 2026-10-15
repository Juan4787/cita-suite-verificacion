import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('patient navigation performance contracts', () => {
	it('does not restart active routes when the patient-list revision changes', () => {
		const layoutSource = readSource('../../routes/odonto/+layout.svelte');

		expect(layoutSource).not.toContain("invalidate('app:patients')");
	});

	it('does not race a manual patient preload against the real navigation', () => {
		const patientListSource = readSource('../../routes/odonto/pacientes/+page.svelte');

		expect(patientListSource).not.toContain('preloadData(');
		expect(patientListSource).not.toContain('schedulePatientWarmup');
	});

	it('keeps patient reads and clinical writes on a fresh commercial membership state', () => {
		const patientDetailSource = readSource('../../routes/odonto/pacientes/[id]/+page.server.ts');
		const shortReads = patientDetailSource.match(/membershipCache: 'short'/g) ?? [];
		const addEntryAction = patientDetailSource.split('add_entry: async')[1]?.split('update_entry: async')[0] ?? '';
		const laterActions = patientDetailSource.split('update_entry: async')[1] ?? '';

		expect(shortReads).toHaveLength(0);
		expect(addEntryAction).toContain("membershipCache: 'fresh'");
		expect(laterActions).not.toContain("membershipCache: 'short'");
	});

	it('adds a saved clinical entry without invalidating and reloading the whole patient page', () => {
		const patientDetailSource = readSource('../../routes/odonto/pacientes/[id]/+page.svelte');

		expect(patientDetailSource).toContain('mergeSavedClinicalEntry(savedEntry)');
		expect(patientDetailSource).toContain('await update({ invalidateAll: false })');
	});

	it('warms radiograph metadata and thumbnails on the client without adding originals to profile load', () => {
		const patientDetailSource = readSource('../../routes/odonto/pacientes/[id]/+page.svelte');
		const patientDetailServerSource = readSource(
			'../../routes/odonto/pacientes/[id]/+page.server.ts'
		);
		const radiographCacheSource = readSource('./patient-radiographs-cache.ts');

		expect(patientDetailSource).toContain('schedulePatientRadiographPreload({');
		expect(patientDetailServerSource).toContain('radiographs: []');
		expect(radiographCacheSource).toContain('THUMBNAIL_PRELOAD_CONCURRENCY = 2');
		expect(radiographCacheSource).not.toContain('access-grants');
	});
});
