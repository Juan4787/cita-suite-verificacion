/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn() }));

import UsuariosPage from './+page.svelte';

afterEach(cleanup);

describe('AF1-019: Equipo page only enables permitted actions for admin role', () => {
	it('hides role edit and Quitar controls on other admin members when actor is an admin', async () => {
		render(UsuariosPage, {
			data: {
				context: {
					business: { id: 'biz-1', name: 'Consultorio', timezone: 'America/Argentina/Cordoba' },
					role: 'admin',
					canManage: true,
					canOperate: true,
					assistance: null
				},
				members: [
					{
						id: 'm-owner',
						business_id: 'biz-1',
						user_id: 'u-owner',
						email: 'duena@example.test',
						role: 'owner',
						status: 'active',
						professional_id: null,
						created_at: '2026-11-01T10:00:00Z'
					},
					{
						id: 'm-admin-other',
						business_id: 'biz-1',
						user_id: 'u-admin-other',
						email: 'otro-admin@example.test',
						role: 'admin',
						status: 'active',
						professional_id: null,
						created_at: '2026-11-02T10:00:00Z'
					},
					{
						id: 'm-recep',
						business_id: 'biz-1',
						user_id: 'u-recep',
						email: 'recepcion@example.test',
						role: 'reception',
						status: 'active',
						professional_id: null,
						created_at: '2026-11-03T10:00:00Z'
					}
				],
				services: [],
				roles: ['reception', 'professional'],
				defaultServiceNames: ['Consulta', 'Otro servicio'],
				currentUserId: 'u-admin-me',
				demo: false
			} as never
		});

		const adminToggle = screen.getByRole('button', { name: /Administradores/ });
		await waitFor(() => expect(adminToggle).toBeEnabled());
		await fireEvent.click(adminToggle);

		expect(screen.getByText('otro-admin@example.test')).toBeVisible();
		expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();

		const recepToggle = screen.getByRole('button', { name: /Recepción/ });
		await fireEvent.click(recepToggle);
		expect(screen.getByText('recepcion@example.test')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Quitar' })).toBeEnabled();
	});
});
