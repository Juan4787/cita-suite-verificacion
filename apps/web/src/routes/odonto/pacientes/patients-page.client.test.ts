/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('https://app.test/odonto/pacientes?estado=archivados') }) };
});
vi.mock('$lib/client/patients-cache', () => ({
	clearPatientsListCache: vi.fn(),
	getPatientsListCache: vi.fn(() => null),
	getPatientsReturnContext: vi.fn(() => null),
	rememberPatientsReturnContext: vi.fn(),
	setPatientsListCache: vi.fn()
}));
vi.mock('$lib/client/patients-realtime', () => ({
	subscribeToPatientRevisionTopic: vi.fn(() => () => {})
}));

import PatientsPage from './+page.svelte';

afterEach(cleanup);

const baseData = (overrides: Record<string, unknown> = {}) => ({
	businessId: 'biz-1',
	patients: [
		{
			id: 'pat-1',
			full_name: 'Paciente Archivado',
			dni: '30111222',
			phone: '3515551234',
			archived_at: '2026-11-10T10:00:00Z',
			created_at: '2026-11-01T10:00:00Z',
			updated_at: '2026-11-10T10:00:00Z',
			last_entry_at: null
		}
	],
	query: '',
	showArchived: true,
	demo: false,
	canCreatePatient: true,
	canArchivePatient: true,
	canAccessRadiographTrash: false,
	totalCount: 1,
	activeCount: 0,
	archivedCount: 1,
	countsIncluded: true,
	countsSource: 'rpc' as const,
	hasMore: false,
	nextCursor: null,
	snapshotAt: '2026-11-20T10:00:00Z',
	pageSize: 30,
	cacheable: false,
	revision: null,
	cacheScope: null,
	loadedAt: '2026-11-20T10:00:00Z',
	...overrides
});

describe('AF1-019: Patients page role-accurate controls', () => {
	it('hides Desarchivar for reception (canArchivePatient=false) while keeping + Nuevo paciente enabled', () => {
		render(PatientsPage, {
			data: baseData({ canCreatePatient: true, canArchivePatient: false }) as never,
			form: {}
		});
		expect(screen.getByRole('button', { name: '+ Nuevo paciente' })).toBeEnabled();
		expect(screen.queryByRole('button', { name: /Desarchivar/i })).not.toBeInTheDocument();
	});

	it('disables + Nuevo paciente and hides Desarchivar for readonly (canCreatePatient=false, canArchivePatient=false)', () => {
		render(PatientsPage, {
			data: baseData({ canCreatePatient: false, canArchivePatient: false }) as never,
			form: {}
		});
		expect(screen.getByRole('button', { name: '+ Nuevo paciente' })).toBeDisabled();
		expect(screen.queryByRole('button', { name: /Desarchivar/i })).not.toBeInTheDocument();
	});
});
