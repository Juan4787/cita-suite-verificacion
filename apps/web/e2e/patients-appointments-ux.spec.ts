import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { loginWithSharedSession } from './helpers/shared-auth';
import { createFixtureClient, must, write, type FixtureClient } from './helpers/fixture-db';

const supabaseUrl = process.env.ODONTO_SUPABASE_URL;
const serviceRoleKey = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
const allowDestructive = process.env.E2E_ALLOW_DESTRUCTIVE === 'true';
const password = 'E2ePatientsUx!2026';
const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const samePhonePatientName = `Paciente teléfono válido ${suffix}`;
const partialFixture: { ownerUserId: string; ownerEmail: string; businessId: string } = {
	ownerUserId: '',
	ownerEmail: `e2e-patients-ux-${suffix}@example.com`,
	businessId: ''
};

type Fixture = {
	ownerUserId: string;
	ownerEmail: string;
	businessId: string;
	serviceId: string;
	serviceName: string;
	professionalId: string;
	professionalName: string;
	patientId: string;
	patientName: string;
	pastAppointmentId: string;
	futureAppointmentId: string;
	cancelledAppointmentId: string;
	bookingDate: string;
};

const adminClient = () => {
	if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan credenciales de Supabase.');
	return createFixtureClient(supabaseUrl, serviceRoleKey);
};

const localDate = (date: Date) =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Cordoba',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);

const addDays = (date: string, days: number) => {
	const value = new Date(`${date}T12:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
};

const appointmentInstant = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

const createAppointmentRow = async (
	admin: FixtureClient,
	fixture: Pick<Fixture, 'businessId' | 'serviceId' | 'professionalId' | 'patientId' | 'patientName'>,
	input: { date: string; time: string; status: 'reserved' | 'cancelled' }
) => {
	const startsAt = appointmentInstant(input.date, input.time);
	const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
	return must(
		admin
			.from('appointments')
			.insert({
				business_id: fixture.businessId,
				patient_id: fixture.patientId,
				service_id: fixture.serviceId,
				professional_id: fixture.professionalId,
				starts_at: startsAt.toISOString(),
				ends_at: endsAt.toISOString(),
				blocking_starts_at: startsAt.toISOString(),
				blocking_ends_at: endsAt.toISOString(),
				status: input.status,
				source: 'manual',
				// The insert trigger replaces identity snapshots with the patient's current data.
				patient_name_at_booking: fixture.patientName,
				service_name_snapshot: 'Pendiente',
				professional_name_snapshot: 'Pendiente',
				duration_minutes_snapshot: 30,
				cancelled_at: input.status === 'cancelled' ? new Date().toISOString() : null
			})
			.select('id')
			.single()
	);
};

const createFixture = async (admin: FixtureClient): Promise<Fixture> => {
	const ownerEmail = partialFixture.ownerEmail;
	const authResult = await admin.auth.admin.createUser({
		email: ownerEmail,
		password,
		email_confirm: true
	});
	if (authResult.error || !authResult.data.user?.id) {
		throw authResult.error ?? new Error('No se creó el usuario E2E.');
	}
	const ownerUserId = authResult.data.user.id;
	partialFixture.ownerUserId = ownerUserId;
	const business = await must(
		admin
			.from('businesses')
			.insert({
				name: `E2E Pacientes UX ${suffix}`,
				slug: `e2e-patients-ux-${suffix}`,
				industry: 'odontology',
				timezone: 'America/Argentina/Cordoba',
				public_booking_enabled: false,
				allow_same_day_booking: true,
				min_booking_notice_minutes: 0,
				max_booking_days_ahead: 90,
				is_active: true
			})
			.select('id')
			.single()
	);
	partialFixture.businessId = business.id;

	await write(
		admin.from('business_subscriptions').upsert(
			{
				business_id: business.id,
				commercial_access_enabled: true,
				is_permanent: true,
				subscription_status: 'active',
				access_starts_at: new Date().toISOString(),
				paid_until: null,
				grace_until: null,
				restricted_until: null,
				archived_at: null
			},
			{ onConflict: 'business_id' }
		)
	);
	await write(admin.from('allowed_emails').upsert({ email: ownerEmail, enabled: true }));
	await write(
		admin.from('business_users').insert({
			business_id: business.id,
			user_id: ownerUserId,
			role: 'owner',
			status: 'active',
			accepted_at: new Date().toISOString()
		})
	);

	const serviceName = `Consulta UX ${suffix}`;
	const professionalName = `Profesional UX ${suffix}`;
	const service = await must(
		admin
			.from('services')
			.insert({
				business_id: business.id,
				name: serviceName,
				duration_minutes: 30,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_active: true,
				is_public: false
			})
			.select('id')
			.single()
	);
	const professional = await must(
		admin
			.from('professionals')
			.insert({
				business_id: business.id,
				name: professionalName,
				is_active: true,
				is_public: false
			})
			.select('id')
			.single()
	);
	await write(
		admin.from('professional_services').insert({
			business_id: business.id,
			professional_id: professional.id,
			service_id: service.id
		})
	);
	for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
		await write(
			admin.from('availability_rules').insert({
				business_id: business.id,
				professional_id: professional.id,
				weekday,
				start_time: '09:00:00',
				end_time: '12:00:00',
				slot_interval_minutes: 30,
				break_minutes: 0,
				is_active: true
			})
		);
	}

	const patientName = `Zeta UX ${suffix}`;
	const patient = await must(
		admin
			.from('patients')
			.insert({
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: patientName,
				dni: `9${String(Date.now()).slice(-7)}`,
				phone: '5493511234567',
				phone_raw: '351 123 4567',
				phone_e164: '+5493511234567'
			})
			.select('id')
			.single()
	);

	const fixtureBase = {
		ownerUserId,
		ownerEmail,
		businessId: business.id,
		serviceId: service.id,
		serviceName,
		professionalId: professional.id,
		professionalName,
		patientId: patient.id,
		patientName
	};
	const today = localDate(new Date());
	const past = await createAppointmentRow(admin, fixtureBase, {
		date: addDays(today, -10),
		time: '15:00',
		status: 'reserved'
	});
	const future = await createAppointmentRow(admin, fixtureBase, {
		date: addDays(today, 30),
		time: '15:00',
		status: 'reserved'
	});
	const cancelled = await createAppointmentRow(admin, fixtureBase, {
		date: addDays(today, 31),
		time: '15:00',
		status: 'cancelled'
	});

	return {
		...fixtureBase,
		pastAppointmentId: past.id,
		futureAppointmentId: future.id,
		cancelledAppointmentId: cancelled.id,
		bookingDate: addDays(today, 7)
	};
};

const cleanupFixture = async (admin: FixtureClient, fixture: Fixture | null) => {
	if (!fixture) return;
	const { error: businessError } = await admin
		.from('businesses')
		.delete()
		.eq('id', fixture.businessId);
	if (businessError) throw businessError;
	await write(admin.from('allowed_emails').delete().eq('email', fixture.ownerEmail));
	const { error: userError } = await admin.auth.admin.deleteUser(fixture.ownerUserId);
	if (userError && !userError.message.includes('User not found')) throw userError;
	partialFixture.ownerUserId = '';
	partialFixture.businessId = '';
};

const cleanupPartialFixture = async (admin: FixtureClient) => {
	if (partialFixture.businessId) {
		const { error } = await admin.from('businesses').delete().eq('id', partialFixture.businessId);
		if (error) throw error;
	}
	await write(admin.from('allowed_emails').delete().eq('email', partialFixture.ownerEmail));
	if (partialFixture.ownerUserId) {
		const { error } = await admin.auth.admin.deleteUser(partialFixture.ownerUserId);
		if (error && !error.message.includes('User not found')) throw error;
	}
	partialFixture.ownerUserId = '';
	partialFixture.businessId = '';
};

// Reuse one real session across the cases: each password sign-in counts toward the
// per-email login limit, which stays enabled.
const login = async (page: Page, fixture: Fixture) => {
	await loginWithSharedSession(page, {
		email: fixture.ownerEmail,
		password,
		readyLinkNames: ['Agenda']
	});
};

const boxesDoNotOverlap = async (left: Locator, right: Locator) => {
	const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()]);
	expect(leftBox).not.toBeNull();
	expect(rightBox).not.toBeNull();
	expect((leftBox?.x ?? 0) + (leftBox?.width ?? 0)).toBeLessThanOrEqual(rightBox?.x ?? 0);
};

const openWizardAt = async (page: Page, fixture: Fixture, time: string) => {
	await page.goto(`/odonto/agenda?date=${fixture.bookingDate}`);
	const wizard = page.locator('form').filter({ has: page.locator('input[name="booking_mode"]') });
	// The control is enabled only once hydrated, so its first click must open the wizard.
	// Retrying a toggle would close what it just opened while references load.
	await page.getByRole('button', { name: '+ Nuevo turno', exact: true }).click();
	await expect(wizard).toBeVisible({ timeout: 15_000 });
	await wizard.getByRole('button').filter({ hasText: fixture.serviceName }).click();
	await wizard.getByRole('button').filter({ hasText: fixture.professionalName }).click();
	await expect(wizard.getByRole('heading', { name: 'Elegí un día' })).toBeVisible();
	const [, month, day] = fixture.bookingDate.split('-');
	const dateButton = wizard.locator('button.ux-choice').filter({
		hasText: `${Number(day)}/${Number(month)}`
	});
	await expect(dateButton).toBeVisible({ timeout: 15_000 });
	await dateButton.click();
	await expect(wizard.getByRole('heading', { name: 'Elegí un horario' })).toBeVisible();
	await expect(wizard.getByRole('button', { name: time, exact: true })).toBeVisible({
		timeout: 15_000
	});
	await wizard.getByRole('button', { name: time, exact: true }).click();
	await expect(wizard.getByRole('heading', { name: '¿Para quién es el turno?' })).toBeVisible();
	return wizard;
};

test.describe.configure({ mode: 'serial' });

test.describe('Pacientes, próximos turnos y teléfono — UX integrada', () => {
	test.skip(
		!allowDestructive || !supabaseUrl || !serviceRoleKey,
		'Requiere E2E_ALLOW_DESTRUCTIVE=true y credenciales de Supabase.'
	);

	let admin: FixtureClient;
	let fixture: Fixture | null = null;

	test.beforeAll(async () => {
		admin = adminClient();
		try {
			fixture = await createFixture(admin);
		} catch (error) {
			await cleanupPartialFixture(admin);
			throw error;
		}
	});

	test.afterAll(async () => {
		if (fixture) await cleanupFixture(admin, fixture);
		else await cleanupPartialFixture(admin);
	});

	test('la lista responde al primer carácter, mantiene simetría y abre toda la fila', async ({ page }) => {
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);
		await page.goto('/odonto/pacientes');
		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();

		for (const tabName of [/^Activos/, /^Archivados/]) {
			const tab = page.getByRole('link', { name: tabName });
			const labelBox = await tab.locator('span').nth(0).boundingBox();
			const countBox = await tab.locator('span').nth(1).boundingBox();
			expect(labelBox).not.toBeNull();
			expect(countBox).not.toBeNull();
			expect(countBox?.y ?? 0).toBeGreaterThan(labelBox?.y ?? 0);
		}

		let delayedRequests = 0;
		await page.route('**/odonto/pacientes/lista?**', async (route) => {
			delayedRequests += 1;
			await new Promise((resolve) => setTimeout(resolve, 750));
			// Limpiar o seguir escribiendo aborta correctamente la consulta anterior.
			// Playwright informa ese aborto como una ruta ya resuelta.
			await route.continue().catch(() => undefined);
		});
		const search = page.getByRole('searchbox', { name: 'Buscar pacientes' });
		await search.fill('Z');
		const desktopPatientName = page.getByRole('button', {
			name: fixture.patientName,
			exact: true
		});
		await expect(desktopPatientName).toBeVisible({ timeout: 350 });
		await expect(page.locator('.animate-spin')).toBeVisible();
		await expect.poll(() => delayedRequests).toBeGreaterThanOrEqual(1);
		const clear = page.getByRole('button', { name: 'Limpiar búsqueda' });
		await expect(clear).toBeVisible();
		await boxesDoNotOverlap(page.locator('.animate-spin'), clear);
		expect(await page.getByText(/Hay cambios nuevos|Conservamos tu posición/).count()).toBe(0);

		await clear.click();
		await expect(search).toHaveValue('');
		await expect(desktopPatientName).toBeVisible({ timeout: 350 });
		await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 3_000 });
		await page.unroute('**/odonto/pacientes/lista?**');

		// A 200 with a partial body must not erase the list or masquerade as
		// an empty search. Exercise the component's own fetch, beyond PageLoad.
		await page.route('**/odonto/pacientes/lista?**', route => route.fulfill({
			status: 200, contentType: 'application/json', body: JSON.stringify({ patients: [] })
		}), { times: 1 });
		await search.fill('Z');
		await expect(page.getByRole('alert')).toContainText('No pudimos validar la respuesta');
		await expect(desktopPatientName).toBeVisible();
		await clear.click();
		await expect(search).toHaveValue('');
		await expect(desktopPatientName).toBeVisible();

		const row = page.locator('tr').filter({ hasText: fixture.patientName });
		await expect(row).toBeVisible();
		await row.locator('td').nth(1).click();
		await expect(page).toHaveURL(new RegExp(`/odonto/pacientes/${fixture.patientId}$`));

		const upcoming = page.getByRole('heading', { name: 'Próximos turnos' }).locator('xpath=../..');
		const appointmentLinks = upcoming.locator('a[href^="/odonto/turnos/"]');
		await expect(appointmentLinks).toHaveCount(1);
		await expect(appointmentLinks.first()).toHaveAttribute(
			'href',
			new RegExp(`/odonto/turnos/${fixture.futureAppointmentId}$`)
		);
		await expect(upcoming.locator(`a[href*="${fixture.pastAppointmentId}"]`)).toHaveCount(0);
		await expect(upcoming.locator(`a[href*="${fixture.cancelledAppointmentId}"]`)).toHaveCount(0);
	});

	test('abre un turno nuevo con un solo clic aunque profesionales y servicios tarden en cargar', async ({
		page
	}) => {
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);
		// Deterministic slow response: references are held until the loading state is verified.
		let releaseReferences!: () => void;
		const referencesHeld = new Promise<void>((resolve) => {
			releaseReferences = resolve;
		});
		// Only the target day: the login landing agenda (today) may still be loading its own
		// references, and navigating away legitimately aborts that earlier request.
		const { bookingDate } = fixture;
		const isReferences = (url: URL) =>
			url.pathname === '/odonto/agenda/referencias' && url.searchParams.get('from') === bookingDate;
		const holdReferences = async (route: Route) => {
			await referencesHeld;
			await route.continue();
		};
		await page.route(isReferences, holdReferences);
		try {
			await page.goto(`/odonto/agenda?date=${fixture.bookingDate}`);
			await page.getByRole('button', { name: '+ Nuevo turno', exact: true }).click();
			await expect(page.getByText('Cargando profesionales y servicios…', { exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
		} finally {
			// Released, the gate lets any later reference request through. It is not unrouted:
			// unrouting while the held request is in flight lets Playwright settle it first.
			releaseReferences();
		}
		const wizard = page.locator('form').filter({ has: page.locator('input[name="booking_mode"]') });
		await expect(wizard).toBeVisible({ timeout: 15_000 });
		await wizard.getByRole('button').filter({ hasText: fixture.serviceName }).click();
		await wizard.getByRole('button').filter({ hasText: fixture.professionalName }).click();
		await expect(wizard.getByRole('heading', { name: 'Elegí un día' })).toBeVisible();
	});

	test('corrige un número inválido sin salir del formulario y conserva el turno', async ({ page }) => {
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);
		const wizard = await openWizardAt(page, fixture, '09:00');
		const patientName = samePhonePatientName;
		await wizard.getByLabel('Nombre del paciente').fill(patientName);
		await wizard.getByLabel('Teléfono').fill('123');

		let creationRequests = 0;
		page.on('request', (request) => {
			if (request.method() === 'POST' && request.url().includes('create_appointment')) {
				creationRequests += 1;
			}
		});
		await wizard.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
		await expect(wizard.getByText('El número de teléfono no es válido')).toBeVisible();
		expect(creationRequests).toBe(0);
		const { count: beforeCorrection } = await admin
			.from('patients')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', fixture.businessId)
			.eq('full_name', patientName);
		expect(beforeCorrection).toBe(0);

		await wizard.getByRole('button', { name: 'Corregir número' }).click();
		const phone = wizard.getByLabel('Teléfono');
		await expect(phone).toBeFocused();
		await expect(wizard.getByLabel('Nombre del paciente')).toHaveValue(patientName);
		await phone.fill('351 123 4567');
		await wizard.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
		await expect(page).toHaveURL(
			(url) =>
				/\/odonto\/turnos\/[0-9a-f-]+$/.test(url.pathname) &&
				url.searchParams.get('created') === '1'
		);
		await expect(page.getByRole('link', { name: 'Enviar enlace de activación' })).toBeVisible();

		const createdAppointmentId = new URL(page.url()).pathname.split('/').at(-1);
		if (!createdAppointmentId) throw new Error('La confirmación no abrió el turno creado.');
		const appointment = await must(
			admin
				.from('appointments')
				.select(
					'patient_id, phone_communication_status_at_booking, phone_warning_acknowledged_at'
				)
				.eq('business_id', fixture.businessId)
				.eq('id', createdAppointmentId)
				.single()
		);
		const patient = await must(
			admin
				.from('patients')
				.select('id, full_name, phone_raw, phone_e164')
				.eq('business_id', fixture.businessId)
				.eq('id', appointment.patient_id)
				.single()
		);
		expect(patient.id).not.toBe(fixture.patientId);
		expect(patient.full_name).toBe(patientName);
		expect(patient.phone_raw).toBe('351 123 4567');
		expect(patient.phone_e164).toBe('+5493511234567');
		expect(appointment.phone_communication_status_at_booking).toBe('valid');
		expect(appointment.phone_warning_acknowledged_at).toBeNull();

		const { data: samePhonePatients, error: samePhoneError } = await admin
			.from('patients')
			.select('id, full_name')
			.eq('business_id', fixture.businessId)
			.eq('phone_e164', '+5493511234567');
		if (samePhoneError) throw samePhoneError;
		expect(samePhonePatients).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: fixture.patientId, full_name: fixture.patientName }),
				expect.objectContaining({ id: patient.id, full_name: patientName })
			])
		);
		expect(samePhonePatients).toHaveLength(2);
	});

	test('muestra las fichas que comparten teléfono y conserva el ID elegido', async ({ page }) => {
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);
		const wizard = await openWizardAt(page, fixture, '10:30');
		await wizard.getByRole('button', { name: /Buscar paciente/ }).click();
		await wizard.getByPlaceholder('Buscar paciente').fill('3511234567');

		const originalPatient = wizard
			.locator('button.ux-choice')
			.filter({ hasText: fixture.patientName });
		const duplicatePhonePatient = wizard
			.locator('button.ux-choice')
			.filter({ hasText: samePhonePatientName });
		await expect(originalPatient).toBeVisible();
		await expect(duplicatePhonePatient).toBeVisible();

		await originalPatient.click();
		await wizard.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
		await expect(page).toHaveURL(
			(url) =>
				/\/odonto\/turnos\/[0-9a-f-]+$/.test(url.pathname) &&
				url.searchParams.get('created') === '1'
		);

		const createdAppointmentId = new URL(page.url()).pathname.split('/').at(-1);
		if (!createdAppointmentId) throw new Error('La confirmación no abrió el turno creado.');
		const appointment = await must(
			admin
				.from('appointments')
				.select(
					'patient_id, patient_name_at_booking, patient_phone_raw_at_booking, patient_resolution_strategy'
				)
				.eq('business_id', fixture.businessId)
				.eq('id', createdAppointmentId)
				.single()
		);
		expect(appointment).toMatchObject({
			patient_id: fixture.patientId,
			patient_name_at_booking: fixture.patientName,
			patient_phone_raw_at_booking: '351 123 4567',
			patient_resolution_strategy: 'existing_id'
		});
	});

	test('confirmar sin teléfono registra la decisión y no vuelve a molestar', async ({ page }) => {
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);
		const wizard = await openWizardAt(page, fixture, '09:30');
		const patientName = `Paciente sin teléfono ${suffix}`;
		await wizard.getByLabel('Nombre del paciente').fill(patientName);
		await wizard.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
		await expect(wizard.getByText('Falta el número de teléfono')).toBeVisible();
		await wizard.getByRole('button', { name: 'Confirmar de todos modos' }).click();
		await expect(page).toHaveURL(
			(url) =>
				/\/odonto\/turnos\/[0-9a-f-]+$/.test(url.pathname) &&
				url.searchParams.get('created') === '1'
		);

		await expect(page.getByRole('heading', { name: 'Último paso' })).toHaveCount(0);
		await expect(page.getByText('Falta completar el teléfono del paciente')).toHaveCount(0);
		await expect(page.getByRole('link', { name: /WhatsApp|Enviar enlace/ })).toHaveCount(0);

		const createdAppointmentId = new URL(page.url()).pathname.split('/').at(-1);
		if (!createdAppointmentId) throw new Error('La confirmación no abrió el turno creado.');
		const appointment = await must(
			admin
				.from('appointments')
				.select(
					'patient_id, phone_communication_status_at_booking, phone_warning_acknowledged_at'
				)
				.eq('business_id', fixture.businessId)
				.eq('id', createdAppointmentId)
				.single()
		);
		const patient = await must(
			admin
				.from('patients')
				.select('id, phone_raw, phone_e164')
				.eq('business_id', fixture.businessId)
				.eq('id', appointment.patient_id)
				.single()
		);
		expect(patient.phone_raw).toBeNull();
		expect(patient.phone_e164).toBeNull();
		expect(appointment.phone_communication_status_at_booking).toBe('missing');
		expect(appointment.phone_warning_acknowledged_at).not.toBeNull();
	});

	test('confirmar con un teléfono inválido lo conserva como no utilizable y cierra el aviso', async ({
		page
	}) => {
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);
		const wizard = await openWizardAt(page, fixture, '10:00');
		const patientName = `Paciente teléfono inválido ${suffix}`;
		await wizard.getByLabel('Nombre del paciente').fill(patientName);
		await wizard.getByLabel('Teléfono').fill('123');
		await wizard.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
		await expect(wizard.getByText('El número de teléfono no es válido')).toBeVisible();
		await wizard.getByRole('button', { name: 'Confirmar de todos modos' }).click();
		await expect(page).toHaveURL(
			(url) =>
				/\/odonto\/turnos\/[0-9a-f-]+$/.test(url.pathname) &&
				url.searchParams.get('created') === '1'
		);

		await expect(page.getByRole('heading', { name: 'Último paso' })).toHaveCount(0);
		await expect(page.getByText('El número de teléfono no es válido', { exact: true })).toHaveCount(0);
		await expect(
			page.getByText('Falta completar el teléfono del paciente', { exact: true })
		).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Corregir teléfono del paciente' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: /WhatsApp|Enviar enlace/ })).toHaveCount(0);

		const createdAppointmentId = new URL(page.url()).pathname.split('/').at(-1);
		if (!createdAppointmentId) throw new Error('La confirmación no abrió el turno creado.');
		const appointment = await must(
			admin
				.from('appointments')
				.select(
					'patient_id, phone_communication_status_at_booking, phone_warning_acknowledged_at'
				)
				.eq('business_id', fixture.businessId)
				.eq('id', createdAppointmentId)
				.single()
		);
		const patient = await must(
			admin
				.from('patients')
				.select('id, phone_raw, phone_e164')
				.eq('business_id', fixture.businessId)
				.eq('id', appointment.patient_id)
				.single()
		);
		expect(patient.phone_raw).toBe('123');
		expect(patient.phone_e164).toBeNull();
		expect(appointment.phone_communication_status_at_booking).toBe('invalid');
		expect(appointment.phone_warning_acknowledged_at).not.toBeNull();
	});
});
