/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicInformationPageData } from '$lib/patients/public-booking-information';
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
import PublicInformationPage from './PublicInformationPage.svelte';

afterEach(() => cleanup());

const data = (businessName: string | null): PublicInformationPageData => ({
	info: { theme: 'cita-suite', schema: [], schema_hash: 'b'.repeat(64), answers: {}, comment: '', version: 'initial', documents_enabled: false },
	token: 'a'.repeat(64), requestKey: '50000000-0000-4000-8000-000000000001', managementUrl: '/gestion/' + 'a'.repeat(64),
	documentsUrl: '/gestion/' + 'a'.repeat(64) + '/documentos', businessName
});

describe('título de la pestaña de la información para la consulta', () => {
	it('nombra al consultorio (plan 12.35)', () => {
		render(PublicInformationPage, { data: data('Consultorio Ramirez'), form: null });
		expect(document.title).toBe('Información para tu consulta · Consultorio Ramirez');
	});
	it('sin el nombre no nombra a nadie', () => {
		render(PublicInformationPage, { data: data(null), form: null });
		expect(document.title).toBe('Información para tu consulta');
	});
});
