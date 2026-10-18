import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import PatientPage from '../../../../routes/odonto/pacientes/[id]/+page.svelte';
import type { PatientDetailViewData } from '$lib/patients/contracts';
import { resolvePatientPermissions } from './patient-permissions';
import { patientContext, patientId, userId } from '../__fixtures__/patient-context';

vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			url: new URL('https://app.example.test/odonto/pacientes/synthetic'),
			state: {}
		})
	};
});
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), replaceState: vi.fn() }));

describe('patient history initial server render', () => {
	it('shows the actual authorized history before hydration instead of a false empty-state message', () => {
		const data: PatientDetailViewData = {
			patient: { id: patientId, full_name: 'Synthetic SSR patient' },
			entries: [
				{
					id: userId,
					created_at: '2026-01-01T12:00:00Z',
					entry_type: 'Consulta',
					description: 'Synthetic persisted consultation'
				}
			],
			appointments: [],
			radiographs: [],
			permissions: resolvePatientPermissions(patientContext()),
			clinicalTodayISO: '2026-10-18',
			businessTimeZone: 'UTC',
			documentUploads: 'not_permitted',
			followUpParticipates: false,
			followUpCanAssign: false,
			followUpTodayISO: '2026-10-18',
			role: 'owner'
		};
		// Component SSR has no SvelteKit data serialization and runs no effects.
		// Matching the entry here proves visible markup, not an embedded JSON value.
		const { body } = render(PatientPage, { props: { data } });
		expect(body).toContain('Synthetic SSR patient');
		expect(body).toContain('Synthetic persisted consultation');
		expect(body).not.toContain('Sin consultas registradas');
		expect(body).toMatch(/<button[^>]*\bdisabled\b[^>]*>\+ Registrar consulta<\/button>/);
	});
});
