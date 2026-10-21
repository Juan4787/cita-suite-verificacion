import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { WHATSAPP_AUTOMATIC_REMINDERS_ENABLED: 'true' } }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: vi.fn() }));

const { generateReminderDispatches } = await import('./messaging');

// A query builder: every chained call returns it, and awaiting it gives `result`.
const query = (result: unknown) => {
	const builder: object = new Proxy({}, {
		get: (_target, key) =>
			key === 'then'
				? (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
				: () => builder
	});
	return builder;
};

const appointment = {
	id: 'appointment-1',
	business_id: 'business-1',
	patient_id: 'patient-1',
	starts_at: '2026-10-22T13:00:00.000Z',
	reminder_due_at: '2026-10-21T13:00:00.000Z',
	status: 'confirmed',
	confirmation_token: 'token-1',
	patients: { id: 'patient-1', full_name: 'Paciente ficticio', phone_e164: '+5491122334455', blocked: false },
	businesses: {
		id: 'business-1',
		name: 'Consultorio',
		slug: 'consultorio',
		timezone: 'America/Argentina/Buenos_Aires',
		is_active: true,
		whatsapp_enabled: true
	}
};

describe('operational messaging access', () => {
	it('sends nothing when the practice access cannot be read', async () => {
		const from = vi.fn((table: string) => {
			if (table === 'appointments') return query({ data: [appointment], error: null });
			if (table === 'business_subscriptions')
				return query({ data: null, error: { code: 'XX000', message: 'synthetic read failure' } });
			return query({ data: [], error: null });
		});

		const result = await generateReminderDispatches({ from } as never, {
			now: new Date('2026-10-21T14:00:00.000Z')
		});

		expect(result).toMatchObject({ created: 0, failed: 1 });
		expect(from.mock.calls.map(([table]) => table)).toEqual(['appointments', 'business_subscriptions']);
	});
});
