import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('daily navigation performance contracts', () => {
	it('revalidates the daily shell on route changes while preserving the master boundary', () => {
		const layout = readSource('../../routes/odonto/+layout.server.ts');
		const pathnameReads = layout.match(/url\.pathname/g) ?? [];

		expect(layout).toContain("depends('app:odonto-shell')");
		expect(layout).toContain("depends('app:follow-ups')");
		expect(layout).toContain('const pathname = url.pathname');
		expect(pathnameReads).toHaveLength(1);
	});

	it('reuses a recently verified membership for high-frequency read routes', () => {
		const readRoutes = [
			'../../routes/odonto/agenda/+page.server.ts',
			'../../routes/odonto/agenda/semana/+page.server.ts',
			'../../routes/odonto/mis-turnos/+page.server.ts',
			'../../routes/odonto/turnos/[appointmentId]/+page.server.ts',
			'../../routes/odonto/pacientes/[id]/historial/+server.ts',
			'../../routes/odonto/pacientes/[id]/datos/+server.ts'
		];

		for (const route of readRoutes) {
			expect(readSource(route)).not.toContain("membershipCache: 'short'");
		}
	});

	it('does not change the appointment mutation context used by the existing wizard', () => {
		const agenda = readSource('../../routes/odonto/agenda/+page.server.ts');
		const actions = agenda.split('export const actions: Actions = {')[1] ?? '';

		expect(actions).not.toContain("membershipCache: 'short'");
	});
});
