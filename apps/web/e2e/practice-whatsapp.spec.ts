import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createFixtureClient } from './helpers/fixture-db';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { loginWithSharedSession } from './helpers/shared-auth';
import { alignTaskForCapture } from './helpers/task-capture';

// WhatsApp contact from the appointment page and the patient record (señas y avisos
// campaign, stage A). The practice number is enabled only for this test and restored.
const PRACTICE_PHONE = '+543421234567';
const PRACTICE_WHATSAPP = '5493421234567';
const PATIENT_WHATSAPP = '5493421112222';

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
		throw new Error('Practice WhatsApp audit requires the owned disposable environment.');
	const admin = createFixtureClient(api, key);
	const { data: business, error: businessError } = await admin
		.from('businesses')
		.select('timezone, whatsapp_contact_enabled, whatsapp_phone')
		.eq('id', businessId)
		.single();
	if (businessError || !business?.timezone) throw new Error('Synthetic business unavailable.');
	const previous = { whatsapp_contact_enabled: business.whatsapp_contact_enabled, whatsapp_phone: business.whatsapp_phone };
	const setContact = async (enabled: boolean, phone: string | null) => {
		const { data, error } = await admin
			.from('businesses')
			.update({ whatsapp_contact_enabled: enabled, whatsapp_phone: phone })
			.eq('id', businessId)
			.select('id');
		if (error || data?.length !== 1) throw new Error('Could not set the synthetic practice WhatsApp.');
	};
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

	const fullName = `Cita WhatsApp audit ${randomUUID().slice(0, 8)}`;
	const { data: patient, error: patientError } = await admin
		.from('patients')
		.insert({
			business_id: businessId,
			owner_id: owner.user_id,
			full_name: fullName,
			phone: '0342 15 111-2222',
			phone_e164: `+${PATIENT_WHATSAPP}`
		})
		.select('id')
		.single();
	if (patientError || !patient) throw new Error('Could not prepare the owned patient.');

	// 23:30 practice time, ten days ahead: outside the synthetic opening hours, so it
	// does not compete with the booking audits for a slot.
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
		.select('id, confirmation_token')
		.single();
	if (error || !appointment) {
		await admin.from('patients').delete().eq('id', patient.id).eq('full_name', fullName);
		throw new Error('Could not prepare the owned appointment.');
	}
	await setContact(true, PRACTICE_PHONE);
	return {
		fullName,
		serviceName: service.name,
		patientId: patient.id,
		token: appointment.confirmation_token,
		setContact,
		async cleanup() {
			await setContact(previous.whatsapp_contact_enabled, previous.whatsapp_phone);
			const { data: restored } = await admin
				.from('businesses')
				.select('whatsapp_contact_enabled, whatsapp_phone')
				.eq('id', businessId)
				.single();
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
			if (
				restored?.whatsapp_contact_enabled !== previous.whatsapp_contact_enabled ||
				restored?.whatsapp_phone !== previous.whatsapp_phone ||
				removedAppointment?.length !== 1 ||
				removedPatient?.length !== 1
			)
				throw new Error('Owned WhatsApp fixture cleanup was not confirmed.');
		}
	};
}

// Desktop browsers open WhatsApp Web; the message travels in the `text` parameter.
const whatsappTarget = async (page: Page, name: string) => {
	const href = await page.getByRole('link', { name }).getAttribute('href');
	const url = new URL(String(href));
	expect(url.origin + url.pathname).toBe('https://web.whatsapp.com/send');
	return { phone: url.searchParams.get('phone'), text: url.searchParams.get('text') ?? '' };
};

test('the patient can notify the practice by WhatsApp from the appointment page, and staff can open WhatsApp from the record', {
	tag: '@candidate-behavior'
}, async ({ page }, info) => {
	const f = await fixture();
	const issues: Array<LayoutIssue & { width: number; screen: string }> = [];
	const matrix = async (screen: string, anchor: string) => {
		for (const width of [320, 390, 768, 1280, 1600]) {
			await page.setViewportSize({ width, height: 900 });
			// Operable controls only: hidden menus and collapsed content have no box and are not on screen.
			issues.push(...(await layoutIssues(page, 'main a:visible, main button:visible', 'main')).map((issue) => ({ ...issue, width, screen })));
			await alignTaskForCapture(page.getByRole('link', { name: anchor }));
			await page.screenshot({ path: info.outputPath(`${screen}-${width}.jpg`), type: 'jpeg', quality: 65 });
		}
		await page.setViewportSize({ width: 1280, height: 900 });
	};
	try {
		await page.goto(`/turno/${f.token}?creado=1`);
		const created = await whatsappTarget(page, 'Avisar al consultorio por WhatsApp');
		expect(created.phone).toBe(PRACTICE_WHATSAPP);
		expect(created.text).toMatch(new RegExp(`^Hola, soy ${f.fullName}\\. Reservé un turno para el .+ a las 23:30\\.$`));
		expect(created.text).not.toContain(f.serviceName);
		await matrix('turno-creado', 'Avisar al consultorio por WhatsApp');

		await page.goto(`/turno/${f.token}`);
		const later = await whatsappTarget(page, 'Escribir al consultorio por WhatsApp');
		expect(later.text).toMatch(new RegExp(`^Hola, soy ${f.fullName}\\. Te escribo por mi turno del .+ a las 23:30\\.$`));
		await expect(page.getByRole('link', { name: 'Avisar al consultorio por WhatsApp' })).toHaveCount(0);

		await f.setContact(false, PRACTICE_PHONE);
		await page.goto(`/turno/${f.token}?creado=1`);
		await expect(page.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeVisible();
		await expect(page.getByRole('link', { name: /al consultorio por WhatsApp/ })).toHaveCount(0);

		await loginWithSharedSession(page, await credentials());
		await page.goto(`/odonto/pacientes/${f.patientId}?tab=datos`);
		await expect(page.getByRole('heading', { name: 'Datos del paciente', exact: true })).toBeVisible();
		const record = await whatsappTarget(page, 'Abrir WhatsApp');
		expect(record).toEqual({ phone: PATIENT_WHATSAPP, text: '' });
		await matrix('ficha', 'Abrir WhatsApp');
		expect(issues).toEqual([]);
	} finally {
		await f.cleanup();
	}
});
