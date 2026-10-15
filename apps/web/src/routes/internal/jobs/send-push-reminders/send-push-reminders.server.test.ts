import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));
const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	sendDuePushReminders: vi.fn(),
	sendDueGoogleReviewRequests: vi.fn(),
	processGoogleCalendarSyncJobs: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock('$lib/server/push', () => ({
	sendDuePushReminders: mocks.sendDuePushReminders
}));
vi.mock('$lib/server/google-reviews', () => ({
	sendDueGoogleReviewRequests: mocks.sendDueGoogleReviewRequests
}));
vi.mock('$lib/server/google-calendar', () => ({
	processGoogleCalendarSyncJobs: mocks.processGoogleCalendarSyncJobs
}));

const { POST } = await import('./+server');
const JOB_URL = 'https://app.test/internal/jobs/send-push-reminders';

const callPost = (url = JOB_URL, secret = 'job-secret') =>
	POST({
		request: new Request(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${secret}` }
		}),
		fetch: vi.fn(),
		url: new URL(url)
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
	envState.privateEnv.INTERNAL_JOB_SECRET = 'job-secret';
	mocks.createSupabaseAdminClient.mockResolvedValue({ admin: true });
	mocks.sendDuePushReminders.mockResolvedValue({ claimed: 1, sent: 1 });
	mocks.sendDueGoogleReviewRequests.mockResolvedValue({ claimed: 1, sent: 1 });
	mocks.processGoogleCalendarSyncJobs.mockResolvedValue({
		configured: true,
		claimed: 1,
		active: 1,
		deleted: 0,
		retrying: 0,
		attention: 0
	});
});

describe('POST /internal/jobs/send-push-reminders', () => {
	it('rechaza un job sin el secreto correcto antes de tocar las colas', async () => {
		const response = await callPost(JOB_URL, 'incorrecto');
		expect(response.status).toBe(401);
		expect(mocks.sendDuePushReminders).not.toHaveBeenCalled();
		expect(mocks.sendDueGoogleReviewRequests).not.toHaveBeenCalled();
		expect(mocks.processGoogleCalendarSyncJobs).not.toHaveBeenCalled();
	});

	it('procesa recordatorios, reseñas y calendario con límites independientes', async () => {
		const response = await callPost(`${JOB_URL}?limit=40&review_limit=9&calendar_limit=12`);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			push: { claimed: 1, sent: 1 },
			googleReviews: { claimed: 1, sent: 1 },
			googleCalendar: { claimed: 1, active: 1 }
		});
		expect(mocks.sendDuePushReminders).toHaveBeenCalledWith(
			{ admin: true },
			{ limit: 40 }
		);
		expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledWith(
			{ admin: true },
			expect.any(Function),
			{ limit: 12 }
		);
		expect(mocks.sendDueGoogleReviewRequests).toHaveBeenCalledWith(
			{ admin: true },
			{ limit: 9 }
		);
	});

	it('continúa con calendario aunque push falle', async () => {
		mocks.sendDuePushReminders.mockRejectedValue(new Error('push temporal'));
		const response = await callPost();
		expect(response.status).toBe(500);
		expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledOnce();
		expect(mocks.sendDueGoogleReviewRequests).toHaveBeenCalledOnce();
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			push: null,
			googleCalendar: { active: 1 }
		});
	});

	it('continúa las otras colas aunque falle la solicitud de reseña', async () => {
		mocks.sendDueGoogleReviewRequests.mockRejectedValue(new Error('review temporal'));
		const response = await callPost();
		expect(response.status).toBe(500);
		expect(mocks.sendDuePushReminders).toHaveBeenCalledOnce();
		expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledOnce();
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			push: { sent: 1 },
			googleReviews: null,
			googleCalendar: { active: 1 }
		});
	});

	it('conserva el resultado push aunque calendario falle', async () => {
		mocks.processGoogleCalendarSyncJobs.mockRejectedValue(new Error('calendar temporal'));
		const response = await callPost();
		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			push: { sent: 1 },
			googleCalendar: null
		});
	});
});
