/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentProps } from 'svelte';
import Page from './+page.svelte';

// The page reads only the policy, the status and the demo flag; the business context is not used.
type Data = ComponentProps<typeof Page>['data'];
const policy = { email_enabled: true, require_email: true, show_cancel: true, show_reschedule: true, require_deposit_on_reschedule: true,
	previous_deposit_disposition: 'forfeit' as const, revision: 1, sender_verified: true };
type Status = NonNullable<Data['status']>;
const ready: Status = { domainState: 'verified', fromAddress: 'turnos@consultorio.cita-suite.com.ar',
	ready: true, producerEnabled: true, paused: false, used24h: 3, dailyLimit: 100, needsReview: 0, failed7d: 0 };
const page = (status: Partial<Status> | null, policyChanges: Partial<typeof policy> = {}) =>
	render(Page, { data: { demo: false, context: {}, policy: { ...policy, ...policyChanges }, status: status && { ...ready, ...status } } as unknown as Data });
const readiness = (container: HTMLElement) => container.querySelector('[data-email-readiness]');

afterEach(() => cleanup());

describe('estado del envío de correos', () => {
	it.each([
		[{ domainState: 'unprovisioned' as const, ready: false }, {}, 'Todavía no se preparó el dominio de envío de este consultorio. No salen correos.'],
		[{ domainState: 'dns_pending' as const, ready: false }, {}, 'Estamos preparando el dominio de envío del consultorio. Todavía no salen correos.'],
		[{ domainState: 'failed' as const, ready: false }, {}, 'El proveedor rechazó el dominio de envío. Los correos están detenidos hasta revisarlo.'],
		[{ paused: true }, {}, 'Los envíos están en pausa por un problema con el proveedor. Se retoman solos cuando se resuelve.'],
		[{ producerEnabled: false }, {}, 'El remitente está listo. El envío automático todavía no está activado.'],
		[{}, { email_enabled: false }, 'El remitente turnos@consultorio.cita-suite.com.ar está listo, pero los envíos están apagados en las preferencias de abajo.']
	])('no dice «Listo» mientras algo impide enviar (%o, %o)', (status, policyChanges, message) => {
		const { container } = page(status, policyChanges);
		expect(readiness(container)).toHaveTextContent(message);
		expect(readiness(container)).not.toHaveClass('ux-alert-success');
		expect(container.textContent).not.toContain('Listo. Los correos salen');
	});

	it('sólo con dominio, envío activado y preferencia encendida dice que salen, y que no reciben respuestas', () => {
		const { container } = page({});
		expect(readiness(container)).toHaveTextContent('Listo. Los correos salen desde turnos@consultorio.cita-suite.com.ar y no reciben respuestas.');
		expect(readiness(container)).toHaveClass('ux-alert-success');
		expect(screen.getByText('Enviados en las últimas 24 horas: 3 de 100.')).toBeInTheDocument();
	});

	it('no pide un correo para recibir respuestas: los correos no se responden (plan 12.35)', () => {
		const { container } = page({});
		expect(screen.queryByLabelText(/respuestas/i)).toBeNull();
		expect(container.querySelector('form[action="?/contact"]')).toBeNull();
	});

	it('sin el estado legible, la preferencia sola no se presenta como envío posible', () => {
		const { container } = page(null, { sender_verified: false });
		expect(readiness(container)).toBeNull();
		expect(screen.getByRole('status')).toHaveTextContent('Falta completar el remitente del consultorio. Mientras tanto, no se enviarán correos.');
	});

	it('avisa los correos que esperan una decisión del consultorio', () => {
		page({ needsReview: 2 });
		expect(screen.getByText('Hay 2 correos en comprobación. Se revisa en el detalle de cada turno.')).toBeInTheDocument();
	});
});
