import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createFixtureClient } from './helpers/fixture-db';
import { loginWithSharedSession } from './helpers/shared-auth';

// The viewer's browser is in Tokyo; the practice is not. The agenda and the
// appointment page must show the practice's wall clock, never the browser's.
test.use({ timezoneId: 'Asia/Tokyo' });

async function credentials() {
	const email = process.env.E2E_EMAIL,
		password = process.env.E2E_PASSWORD;
	if (!email || !password) throw new Error('Explicit synthetic credentials required.');
	return { email, password };
}

async function fixture() {
	const api = process.env.ODONTO_SUPABASE_URL,
		key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	if (
		process.env.CITA_E2E_ENVIRONMENT !== 'disposable' ||
		!api ||
		!key ||
		!businessId ||
		new URL(api).hostname !== '127.0.0.1'
	)
		throw new Error('Agenda timezone audit requires the owned disposable environment.');
	const admin = createFixtureClient(api, key);
	const { data: business, error: businessError } = await admin
		.from('businesses')
		.select('timezone')
		.eq('id', businessId)
		.single();
	if (businessError || !business?.timezone) throw new Error('Synthetic business timezone unavailable.');
	const { data: owner, error: ownerError } = await admin
		.from('business_users')
		.select('user_id')
		.eq('business_id', businessId)
		.eq('role', 'owner')
		.eq('status', 'active')
		.single();
	if (ownerError || !owner) throw new Error('Synthetic owner unavailable.');
	const { data: link, error: linkError } = await admin
		.from('professional_services')
		.select('professional_id, service_id, services!inner(name, duration_minutes), professionals!inner(name)')
		.eq('business_id', businessId)
		.limit(1)
		.single();
	if (linkError || !link) throw new Error('Synthetic professional and service unavailable.');
	const fullName = `Cita timezone audit ${randomUUID()}`;
	const { data: patient, error: patientError } = await admin
		.from('patients')
		.insert({ business_id: businessId, owner_id: owner.user_id, full_name: fullName })
		.select('id')
		.single();
	if (patientError || !patient) throw new Error('Could not prepare the owned patient.');

	// 23:30 on a practice day ten days ahead: in Tokyo it is already the next
	// calendar day, so both the hour and the day differ from the practice's.
	const day = new Date(Date.now() + 10 * 86_400_000);
	const practiceDate = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(day);
	const offsetMinutes = (() => {
		const probe = new Date(`${practiceDate}T12:00:00Z`);
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en-US', { timeZone: business.timezone, hour12: false, hour: '2-digit', minute: '2-digit' })
				.formatToParts(probe)
				.map((p) => [p.type, p.value])
		);
		return (Number(parts.hour) % 24) * 60 + Number(parts.minute) - 12 * 60;
	})();
	const startsAt = new Date(Date.parse(`${practiceDate}T23:30:00Z`) - offsetMinutes * 60_000);
	const service = link.services as unknown as { name: string; duration_minutes: number };
	const professional = link.professionals as unknown as { name: string };
	const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000);
	const tokyoHour = new Intl.DateTimeFormat('es-AR', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(startsAt);
	if (tokyoHour === '23:30') throw new Error('The practice timezone must differ from the browser timezone.');

	const { data: appointment, error } = await admin
		.from('appointments')
		.insert({
			business_id: businessId,
			patient_id: patient.id,
			service_id: link.service_id,
			professional_id: link.professional_id,
			starts_at: startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			blocking_starts_at: startsAt.toISOString(),
			blocking_ends_at: endsAt.toISOString(),
			service_name_snapshot: service.name,
			professional_name_snapshot: professional.name,
			duration_minutes_snapshot: service.duration_minutes,
			patient_name_at_booking: fullName,
			created_by_user_id: owner.user_id
		})
		.select('id')
		.single();
	if (error || !appointment) {
		await admin.from('patients').delete().eq('id', patient.id).eq('full_name', fullName);
		throw new Error('Could not prepare the owned appointment.');
	}
	return {
		practiceDate,
		fullName,
		appointmentId: appointment.id,
		async cleanup() {
			const { data: removedAppointment } = await admin
				.from('appointments')
				.delete()
				.eq('business_id', businessId)
				.eq('id', appointment.id)
				.select('id');
			const { data: removedPatient } = await admin
				.from('patients')
				.delete()
				.eq('business_id', businessId)
				.eq('id', patient.id)
				.eq('full_name', fullName)
				.select('id');
			if (removedAppointment?.length !== 1 || removedPatient?.length !== 1)
				throw new Error('Owned timezone fixture cleanup was not confirmed.');
		}
	};
}

test('agenda and appointment page show the practice wall clock when the browser is in another timezone', async ({
	page
}) => {
	const f = await fixture();
	try {
		await loginWithSharedSession(page, await credentials());
		await page.goto(`/odonto/agenda?date=${f.practiceDate}`);
		const card = page.locator(`a[href^="/odonto/turnos/${f.appointmentId}"]`);
		await expect(card).toBeVisible();
		await expect(card.getByText('23:30', { exact: true })).toBeVisible();
		await expect(card).toHaveAttribute('href', new RegExp(`from_date=${f.practiceDate}$`));

		await card.click();
		await expect(page).toHaveURL(new RegExp(`/odonto/turnos/${f.appointmentId}`));
		await expect(page.getByText(/^23:30 - /)).toBeVisible();
		const [year, month, dayOfMonth] = f.practiceDate.split('-').map(Number);
		const longDate = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(Date.UTC(year, month - 1, dayOfMonth, 12))
		);
		await expect(page.getByText(longDate, { exact: true })).toBeVisible();
	} finally {
		await f.cleanup();
	}
});
