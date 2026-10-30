import { describe, expect, it } from 'vitest';
import { withAgendaDeposits } from './agenda-deposits';

const businessId = '00000000-0000-4000-8000-000000000001';
const appointmentId = '00000000-0000-4000-8000-000000000002';
const row = { id: appointmentId, starts_at: '2099-11-02T12:00:00.000Z', status: 'reserved', patients: { full_name: 'Paciente' } };
const clientFor = (data: unknown, error: unknown = null) => {
	const calls: unknown[][] = [];
	const builder = {
		select: (columns: string) => { calls.push(['select', columns]); return builder; },
		eq: (name: string, value: string) => { calls.push(['eq', name, value]); return builder; },
		in: async (name: string, values: string[]) => { calls.push(['in', name, values]); return { data, error }; }
	};
	return { client: { from: (table: string) => { calls.push(['from', table]); return builder; } } as never, calls };
};

describe('seña en la búsqueda y precarga de la agenda', () => {
	it('enriquece por lote sólo los turnos que devolvió la búsqueda autorizada', async () => {
		const { client, calls } = clientFor([{ appointment_id: appointmentId, status: 'pending', revision: 3, waived_reason: null }]);
		expect(await withAgendaDeposits(client, businessId, [row])).toEqual([{ ...row, appointment_deposits: { status: 'pending', revision: 3, waived_reason: null } }]);
		expect(calls).toContainEqual(['eq', 'business_id', businessId]);
		expect(calls).toContainEqual(['in', 'appointment_id', [appointmentId]]);
	});
	it('sin seña conserva el turno; sin resultados no agrega una consulta', async () => {
		const { client, calls } = clientFor([]);
		expect(await withAgendaDeposits(client, businessId, [])).toEqual([]);
		expect(calls).toEqual([]);
		expect(await withAgendaDeposits(client, businessId, [row])).toEqual([{ ...row, appointment_deposits: null }]);
	});
	it('una falla o una respuesta ajena, duplicada o inválida no borra la seña en silencio', async () => {
		await expect(withAgendaDeposits(clientFor(null, new Error('read')).client, businessId, [row])).rejects.toBeDefined();
		const valid = { appointment_id: appointmentId, status: 'pending', revision: 3, waived_reason: null };
		for (const rows of [[{ ...valid, appointment_id: businessId }], [valid, valid], [{ ...valid, revision: null }], [{ ...valid, status: 'inventado' }]]) {
			await expect(withAgendaDeposits(clientFor(rows).client, businessId, [row])).rejects.toBeDefined();
		}
	});
});
