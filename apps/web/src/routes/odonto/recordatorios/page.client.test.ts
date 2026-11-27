/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentProps } from 'svelte';
import Page from './+page.svelte';

type Data = ComponentProps<typeof Page>['data'];

afterEach(() => cleanup());

describe('pantalla Recordatorios (D3)', () => {
	it('explica que los recordatorios por correo cuentan como aviso automático junto a calendario y notificaciones', () => {
		const { container } = render(Page, {
			data: {
				demo: false,
				day: 'manana',
				restricted: false,
				remindersUnavailable: false,
				deliveryNotice: null,
				candidates: [
					{
						appointment_id: 'a1',
						management_revision: 'a'.repeat(64),
						patient_id: 'p1',
						starts_at: '2026-11-28T18:00:00.000Z',
						time_label: '15:00',
						status: 'reserved',
						service_name: 'Consulta',
						professional_name: 'Dra. Prueba',
						patient_name: 'Ana Cubierta',
						coverage: 'aviso_automatico',
						phone_e164: '+5493510000001',
						whatsapp_opened_at: null,
						whatsapp_marked_sent_at: null
					}
				]
			} as unknown as Data
		});
		expect(container.textContent).toMatch(/recordatorio por correo/i);
		expect(container.textContent).toContain('Sin aviso por correo');
		expect(container.textContent).toContain('Ya tienen aviso automático (1)');
	});
});
