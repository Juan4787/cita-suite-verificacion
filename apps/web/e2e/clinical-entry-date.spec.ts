import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import { createFixtureClient } from './helpers/fixture-db';
import { loginWithSharedSession } from './helpers/shared-auth';

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

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
		throw new Error('Clinical date audit requires the owned disposable environment.');
	const admin = createFixtureClient(api, key);
	const { data: owner, error: ownerError } = await admin
		.from('business_users')
		.select('user_id')
		.eq('business_id', businessId)
		.eq('role', 'owner')
		.eq('status', 'active')
		.single();
	if (ownerError || !owner) throw new Error('Synthetic clinical owner unavailable.');
	const fullName = `Cita date audit ${randomUUID()}`;
	const { data: patient, error } = await admin
		.from('patients')
		.insert({ business_id: businessId, owner_id: owner.user_id, full_name: fullName })
		.select('id')
		.single();
	if (error || !patient) throw new Error('Could not prepare the owned clinical patient.');
	return {
		admin,
		businessId,
		ownerId: owner.user_id,
		patientId: patient.id,
		fullName,
		async cleanup() {
			const { data: removed, error } = await admin
				.from('patients')
				.delete()
				.eq('business_id', businessId)
				.eq('id', patient.id)
				.eq('full_name', fullName)
				.select('id');
			if (error || removed?.length !== 1)
				throw new Error('Owned clinical patient cleanup was not confirmed.');
		}
	};
}
async function setLocalDate(dialog: Locator, time: string) {
	await dialog.getByLabel('Año', { exact: true }).fill('2026');
	await dialog.getByLabel('Mes', { exact: true }).fill('01');
	await dialog.getByLabel('Día', { exact: true }).fill('15');
	await dialog.getByLabel('Hora', { exact: true }).fill(time);
}
async function credentials() {
	const email = process.env.E2E_EMAIL,
		password = process.env.E2E_PASSWORD;
	if (!email || !password) throw new Error('Explicit synthetic credentials required.');
	return { email, password };
}

test('clinical creation persists the Argentina wall clock and displays the same hour after reload', async ({
	page
}) => {
	const f = await fixture();
	try {
		await loginWithSharedSession(page, await credentials());
		// A visible SSR button is not proof that its JS handler is attached. Hold
		// scripts on a fresh document and require the UI's actual disabled state.
		await page.goto('about:blank');
		let releaseScripts!: () => void;
		const scripts = new Promise<void>((resolve) => {
			releaseScripts = resolve;
		});
		const holdScripts = async (route: import('@playwright/test').Route) => {
			if (route.request().resourceType() === 'script') await scripts;
			await route.continue();
		};
		await page.route('**/*', holdScripts);
		const patient = page.getByRole('main');
		const open = patient.getByRole('button', { name: '+ Registrar consulta', exact: true });
		try {
			await page.goto(`/odonto/pacientes/${f.patientId}`, { waitUntil: 'commit' });
			await expect(patient.getByRole('heading', { name: f.fullName, exact: true })).toBeVisible();
			await expect(open).toBeDisabled();
		} finally {
			releaseScripts();
			await page.unrouteAll({ behavior: 'wait' });
		}
		await expect(open).toBeEnabled();
		await open.click();
		const dialog = page.getByRole('dialog', { name: `Registrar consulta - ${f.fullName}` });
		await dialog.getByLabel('Tipo de consulta').selectOption('Consulta');
		await setLocalDate(dialog, '09:30');
		await dialog
			.getByLabel('Descripción', { exact: true })
			.fill('Synthetic Argentina clinical time');
		await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const { data: entry, error } = await f.admin
			.from('clinical_entries')
			.select('created_at')
			.eq('business_id', f.businessId)
			.eq('patient_id', f.patientId)
			.single();
		expect(error).toBeNull();
		expect(entry?.created_at && new Date(entry.created_at).toISOString()).toBe(
			'2026-01-15T12:30:00.000Z'
		);
		await page.reload();
		await expect(
			page.getByText('Synthetic Argentina clinical time', { exact: true })
		).toBeVisible();
		await expect(page.getByText('09:30', { exact: true })).toBeVisible();
	} finally {
		await f.cleanup();
	}
});

test('clinical editing persists the selected local date and keeps provenance and the professional deadline', async ({
	page
}) => {
	const f = await fixture();
	try {
		const originalDate = '2026-01-14T13:00:00Z',
			deadline = '2026-01-15T13:00:00Z';
		const { data: inserted, error } = await f.admin
			.from('clinical_entries')
			.insert({
				business_id: f.businessId,
				patient_id: f.patientId,
				owner_id: f.ownerId,
				created_by_user_id: f.ownerId,
				created_at: originalDate,
				locked_after: deadline,
				entry_type: 'Consulta',
				description: 'Synthetic date correction'
			})
			.select('id')
			.single();
		if (error || !inserted) throw new Error('Could not prepare synthetic clinical entry.');
		const { error: costError } = await f.admin.from('clinical_entry_costs').insert({
			business_id: f.businessId,
			clinical_entry_id: inserted.id,
			amount: 125.5
		});
		if (costError) throw new Error('Could not prepare synthetic historical cost.');
		await loginWithSharedSession(page, await credentials());
		await page.goto(`/odonto/pacientes/${f.patientId}`);
		await page.getByRole('button', { name: 'Editar', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Editar entrada', exact: true });
		await expect(dialog.getByLabel('Hora', { exact: true })).toHaveValue('10:00');
		await setLocalDate(dialog, '09:45');
		await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		const { data: edited, error: readError } = await f.admin
			.from('clinical_entries')
			.select('created_at, created_by_user_id, locked_after')
			.eq('business_id', f.businessId)
			.eq('id', inserted.id)
			.single();
		expect(readError).toBeNull();
		expect(edited?.created_at && new Date(edited.created_at).toISOString()).toBe(
			'2026-01-15T12:45:00.000Z'
		);
		expect(edited?.created_by_user_id).toBe(f.ownerId);
		const { data: cost, error: costReadError } = await f.admin
			.from('clinical_entry_costs')
			.select('amount')
			.eq('business_id', f.businessId)
			.eq('clinical_entry_id', inserted.id)
			.single();
		expect(costReadError).toBeNull();
		expect(cost?.amount).toBe(125.5);
		expect(edited?.locked_after && new Date(edited.locked_after).toISOString()).toBe(
			new Date(deadline).toISOString()
		);
		await expect(page.getByText('09:45', { exact: true })).toBeVisible();
	} finally {
		await f.cleanup();
	}
});
