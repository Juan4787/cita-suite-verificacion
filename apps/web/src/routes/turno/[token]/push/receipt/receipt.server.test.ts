import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));
const mocks = vi.hoisted(() => ({
	loadAppointmentForToken: vi.fn(),
	isValidPushDeliveryId: vi.fn(),
	recordPushDeliveryReceipt: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/appointment-token', () => ({
	loadAppointmentForToken: mocks.loadAppointmentForToken
}));
vi.mock('$lib/server/push', () => ({
	isValidPushDeliveryId: mocks.isValidPushDeliveryId,
	recordPushDeliveryReceipt: mocks.recordPushDeliveryReceipt
}));

const { POST } = await import('./+server');
const URL = 'https://app.test/turno/public-token/push/receipt';
const deliveryId = '8ccf23d7-5ae3-4b87-9268-d40a05d9a475';
const receiptToken = 'a'.repeat(43);

const callPost = (stage: string) =>
	POST({
		params: { token: 'public-token' },
		request: new Request(URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ deliveryId, receiptToken, stage })
		}),
		fetch: vi.fn(),
		setHeaders: vi.fn()
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	mocks.isValidPushDeliveryId.mockReturnValue(true);
	mocks.loadAppointmentForToken.mockResolvedValue({
		appointment: { id: 'appointment-id' },
		supabase: { admin: true }
	});
	mocks.recordPushDeliveryReceipt.mockResolvedValue(true);
});

describe('POST /turno/[token]/push/receipt', () => {
	it('acepta y vincula el clic autenticado a la entrega del turno', async () => {
		const response = await callPost('clicked');

		expect(response.status).toBe(204);
		expect(mocks.recordPushDeliveryReceipt).toHaveBeenCalledWith(
			{ admin: true },
			{
				appointmentId: 'appointment-id',
				deliveryId,
				receiptToken,
				stage: 'clicked'
			}
		);
	});

	it('ignora etapas desconocidas sin modificar la entrega', async () => {
		const response = await callPost('opened');

		expect(response.status).toBe(204);
		expect(mocks.recordPushDeliveryReceipt).not.toHaveBeenCalled();
	});
});
