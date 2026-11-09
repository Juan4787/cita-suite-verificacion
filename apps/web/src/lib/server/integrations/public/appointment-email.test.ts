import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobBudget, type ScheduledJobRun } from '$lib/server/integrations/internal/job-budget';

const envState = vi.hoisted(() => ({ values: { ZOHO_CPAAS_API_KEY: 'key' } as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: envState.values }));
vi.mock('$lib/server/integrations/public/messaging', () => ({ getPublicSiteUrl: () => 'https://app.cita-suite.com.ar' }));
vi.mock('$lib/server/platform/logging', () => ({ logServerFailure: vi.fn(), logServerWarning: vi.fn() }));

const { sendAppointmentEmailBatch } = await import('./appointment-email');

const claimItem = (index: number) => ({
	delivery_id: `delivery-${index}`, lease_token: `lease-${index}`, purpose: 'booking_receipt', recipient: 'paciente@example.test', token: 'a'.repeat(64), unsubscribe_token: 'b'.repeat(64),
	sender: { from_address: 'turnos@rojas.cita-suite.com.ar', reply_to: 'contacto@example.test' }, preferences: { show_cancel: true, show_reschedule: true },
	snapshot: { id: 'a', status: 'reserved', starts_at: '2030-01-01T15:00:00.000Z', modality: 'in_person', patient_name: 'Ana', deposit: null, can_cancel: true, can_reschedule: true, new_booking_allowed: false,
		business: { name: 'Consultorio', slug: 'c', timezone: 'UTC', address: 'Calle', address_instructions: null, maps_url: null, logo_url: null, phone: null, whatsapp_contact_phone: null } }
});
const accepted = () => new Response(JSON.stringify({ data: [{ code: 'EM_104' }], request_id: 'r' }), { status: 201 });

const runWith = (items: unknown[], providerFetch: typeof fetch, claim: Record<string, unknown> = {}) => {
	const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) =>
		name === 'claim_appointment_email_batch' ? { data: { enabled: true, paused: false, items, discarded: 0, ...claim }, error: null } : { data: { applied: 1 }, error: null });
	const run = { supabase: { rpc }, budget: createJobBudget('free'), providerFetch, now: new Date('2026-11-10T12:00:00.000Z') } as unknown as ScheduledJobRun;
	return { rpc, run };
};
const recorded = (rpc: ReturnType<typeof vi.fn>) =>
	rpc.mock.calls.filter(([name]) => name === 'record_appointment_email_results').flatMap(([, args]) => (args as { p_results: { outcome: string; delivery_id: string }[] }).p_results);

describe('sendAppointmentEmailBatch', () => {
	beforeEach(() => { envState.values.ZOHO_CPAAS_API_KEY = 'key'; });

	it('does nothing without a key, so an unconfigured release cannot claim work', async () => {
		envState.values.ZOHO_CPAAS_API_KEY = '';
		const { rpc, run } = runWith([claimItem(1)], vi.fn());
		expect((await sendAppointmentEmailBatch(run)).configured).toBe(false);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('records every result, in chunks, before finishing', async () => {
		const provider = vi.fn(async () => accepted());
		const { rpc, run } = runWith([1, 2, 3, 4, 5].map(claimItem), provider as unknown as typeof fetch);
		const summary = await sendAppointmentEmailBatch(run);
		expect(summary).toMatchObject({ claimed: 5, accepted: 5 });
		expect(provider).toHaveBeenCalledTimes(5);
		expect(rpc.mock.calls.filter(([name]) => name === 'record_appointment_email_results')).toHaveLength(2);
		expect(recorded(rpc).map((result) => result.delivery_id)).toEqual(['delivery-1', 'delivery-2', 'delivery-3', 'delivery-4', 'delivery-5']);
	});

	it('sends no Reply-To, although the claim still names an address for an earlier app (plan 12.35)', async () => {
		const provider = vi.fn(async (_url: string, _init: RequestInit) => accepted());
		const { run } = runWith([claimItem(1)], provider as unknown as typeof fetch);
		await sendAppointmentEmailBatch(run);
		const body = JSON.parse(String(provider.mock.calls[0][1].body));
		expect(body).not.toHaveProperty('reply_to');
		expect(body.from).toEqual({ address: 'turnos@rojas.cita-suite.com.ar', name: 'Consultorio' });
	});

	it('stays within the budget of its chain', async () => {
		const provider = vi.fn(async () => accepted());
		const { run } = runWith([1, 2, 3, 4, 5, 6, 7, 8].map(claimItem), run_fetch(provider));
		await sendAppointmentEmailBatch(run);
		expect(run.budget.used).toBeLessThanOrEqual(40);
	});

	it('records a lost answer as uncertain and goes on with the rest', async () => {
		const provider = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(accepted());
		const { rpc, run } = runWith([1, 2].map(claimItem), provider as unknown as typeof fetch);
		const summary = await sendAppointmentEmailBatch(run);
		expect(summary).toMatchObject({ accepted: 1, uncertain: 1 });
		expect(recorded(rpc).map((result) => result.outcome).sort()).toEqual(['accepted', 'uncertain']);
	});

	it('gives back what it claimed but did not attempt, instead of leaving it as uncertain', async () => {
		const provider = vi.fn(async () => accepted());
		const { rpc, run } = runWith([1, 2, 3, 4, 5, 6].map(claimItem), provider as unknown as typeof fetch);
		vi.spyOn(run.budget, 'admits').mockReturnValue(false);
		await sendAppointmentEmailBatch(run);
		expect(provider).toHaveBeenCalledTimes(4);
		expect(recorded(rpc).filter((result) => result.outcome === 'released').map((result) => result.delivery_id)).toEqual(['delivery-5', 'delivery-6']);
	});

	it('leaves an unreadable claim unsent: it expires into review instead of going out blindly', async () => {
		const provider = vi.fn(async () => accepted());
		const { run } = runWith([{ delivery_id: 'x' }], provider as unknown as typeof fetch);
		expect((await sendAppointmentEmailBatch(run)).claimed).toBe(0);
		expect(provider).not.toHaveBeenCalled();
	});

	it('reports a pause without sending', async () => {
		const provider = vi.fn();
		const { run } = runWith([], provider as unknown as typeof fetch, { paused: true });
		expect((await sendAppointmentEmailBatch(run)).paused).toBe(true);
		expect(provider).not.toHaveBeenCalled();
	});
});

function run_fetch(provider: ReturnType<typeof vi.fn>) {
	return provider as unknown as typeof fetch;
}
