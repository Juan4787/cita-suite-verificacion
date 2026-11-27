/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentProps } from 'svelte';
import Page from './+page.svelte';

type Data = ComponentProps<typeof Page>['data'];

afterEach(() => cleanup());

describe('página de baja de correos (D2)', () => {
	it('enlace vencido con datos públicos muestra WhatsApp y teléfono del consultorio sin pedir responder un correo', () => {
		const { container } = render(Page, {
			data: {
				available: false,
				unavailableReason: 'expired',
				businessName: 'Dra. Natalia Frutos',
				contact: {
					phone: '+54 342 429-3471',
					whatsappPhone: '+5493424293471',
					whatsappUrl: 'https://wa.me/5493424293471?text=Hola',
					whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493424293471&text=Hola'
				}
			} as unknown as Data
		});
		expect(screen.getByRole('heading', { name: 'Este enlace venció' })).toBeInTheDocument();
		expect(container.textContent).toContain('Dra. Natalia Frutos');
		expect(container.textContent).toMatch(/WhatsApp/i);
		expect(container.textContent).toMatch(/teléfono/i);
		expect(container.textContent).not.toMatch(/respond[eé]|contest[eé]/i);
		const waLink = screen.getByRole('link', { name: /Pedir la baja por WhatsApp/i });
		expect(waLink.getAttribute('href')).toMatch(/wa\.me\/5493424293471|web\.whatsapp\.com\/send\?phone=5493424293471/);
		const telLink = screen.getByRole('link', { name: /\+54 342 429-3471/ });
		expect(telLink).toHaveAttribute('href', 'tel:+543424293471');
	});

	it('enlace vencido con sólo WhatsApp público muestra WhatsApp y no inventa teléfono', () => {
		const { container } = render(Page, {
			data: {
				available: false,
				unavailableReason: 'expired',
				businessName: 'Dra. Natalia Frutos',
				contact: {
					phone: null,
					whatsappPhone: '+5493424293471',
					whatsappUrl: 'https://wa.me/5493424293471?text=Hola',
					whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493424293471&text=Hola'
				}
			} as unknown as Data
		});
		expect(screen.getByRole('link', { name: /Pedir la baja por WhatsApp/i })).toBeInTheDocument();
		expect(container.querySelector('a[href^="tel:"]')).toBeNull();
		expect(container.textContent).not.toMatch(/respond[eé]/i);
	});

	it('enlace inválido muestra texto general por WhatsApp o teléfono sin revelar ningún consultorio', () => {
		const { container } = render(Page, {
			data: {
				available: false,
				unavailableReason: 'invalid',
				businessName: null,
				contact: null
			} as unknown as Data
		});
		expect(screen.getByRole('heading', { name: 'Este enlace no está disponible' })).toBeInTheDocument();
		expect(container.textContent).toMatch(/WhatsApp o por teléfono/i);
		expect(container.textContent).not.toMatch(/respond[eé]|contest[eé]/i);
		expect(container.querySelector('a')).toBeNull();
	});

	it('falla temporal pide reintentar sin pedir responder un correo', () => {
		const { container } = render(Page, {
			data: {
				available: false,
				unavailableReason: 'error',
				businessName: null,
				contact: null
			} as unknown as Data
		});
		expect(container.textContent).toContain('No pudimos abrirlo en este momento. Volvé a intentar en unos minutos.');
		expect(container.textContent).not.toMatch(/respond[eé]|contest[eé]/i);
	});
});
