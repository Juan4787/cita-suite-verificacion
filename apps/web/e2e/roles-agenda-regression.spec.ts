import { expect, test, type Locator, type Page } from '@playwright/test';
import { signInWithPassword } from './helpers/shared-auth';
import { observeRenderHealth } from './helpers/render-health';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { randomUUID } from 'node:crypto';
import { createFixtureClient, must, write, type FixtureClient } from './helpers/fixture-db';

const allowDestructive = process.env.E2E_ALLOW_DESTRUCTIVE === 'true';
const supabaseUrl = process.env.ODONTO_SUPABASE_URL;
const serviceRoleKey = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const password = 'E2eLocal!2026';

type Fixture = {
	suffix: string;
	ownerEmail: string;
	ownerUserId: string;
	authUserIds: string[];
	businessId: string;
	serviceId: string;
	professionalId: string;
	otherProfessionalId: string;
	patientId: string;
	secondPatientId: string;
	date: string;
};

const e2eDate = () => {
	const value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	return value.toISOString().slice(0, 10);
};

const addIsoDays = (date: string, days: number) => {
	const value = new Date(`${date}T12:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
};

const rest = () => {
	if (!supabaseUrl || !serviceRoleKey) {
		throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	}
	return createFixtureClient(supabaseUrl, serviceRoleKey);
};


const createFixture = async (admin: FixtureClient): Promise<Fixture> => {
	const suffix = unique();
	const ownerEmail = `e2e-owner-${suffix}@example.com`;
	const businessSlug = `e2e-roles-agenda-${suffix}`;

	const authResult = await admin.auth.admin.createUser({
		email: ownerEmail,
		password,
		email_confirm: true
	});
	if (authResult.error || !authResult.data.user?.id)
		throw authResult.error ?? new Error('No se creó usuario owner.');
	const ownerUserId = authResult.data.user.id;

	const business = await must(
		admin
			.from('businesses')
			.insert({
				name: `E2E Roles Agenda ${suffix}`,
				slug: businessSlug,
				industry: 'odontology',
				timezone: 'America/Argentina/Cordoba',
				public_booking_enabled: true,
				allow_same_day_booking: true,
				min_booking_notice_minutes: 0,
				max_booking_days_ahead: 90,
				is_active: true
			})
			.select('id')
			.single()
	);

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
			{
				onConflict: 'business_id'
			}
		)
	);
	await write(
		admin.from('allowed_emails').upsert({
			email: ownerEmail,
			enabled: true
		})
	);
	await write(
		admin.from('business_users').insert({
			business_id: business.id,
			user_id: ownerUserId,
			role: 'owner',
			status: 'active',
			accepted_at: new Date().toISOString()
		})
	);

	const service = await must(
		admin
			.from('services')
			.insert({
				business_id: business.id,
				name: `E2E Consulta ${suffix}`,
				duration_minutes: 45,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_active: true,
				is_public: true
			})
			.select('id')
			.single()
	);

	const [professional, otherProfessional] = await Promise.all([
		must(
			admin
				.from('professionals')
				.insert({
					business_id: business.id,
					name: `E2E Profesional Base ${suffix}`,
					email: null,
					is_active: true,
					is_public: true
				})
				.select('id')
				.single()
		),
		must(
			admin
				.from('professionals')
				.insert({
					business_id: business.id,
					name: `E2E Profesional Otro ${suffix}`,
					email: null,
					is_active: true,
					is_public: true
				})
				.select('id')
				.single()
		)
	]);

	for (const professionalId of [professional.id, otherProfessional.id]) {
		await write(
			admin.from('professional_services').insert({
				business_id: business.id,
				professional_id: professionalId,
				service_id: service.id
			})
		);
		for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
			await write(
				admin.from('availability_rules').insert({
					business_id: business.id,
					professional_id: professionalId,
					weekday,
					start_time: '09:00:00',
					end_time: '12:00:00',
					slot_interval_minutes: 15,
					break_minutes: 0,
					is_active: true
				})
			);
		}
	}

	const firstPatientPhone = `+54911${Math.floor(10000000 + Math.random() * 90000000)}`;
	const secondPatientPhone = `+54911${Math.floor(10000000 + Math.random() * 90000000)}`;
	const [patient, secondPatient] = await Promise.all([
		must(
			admin
				.from('patients')
				.insert({
					business_id: business.id,
					owner_id: ownerUserId,
					full_name: `E2E Paciente ${suffix}`,
					phone: firstPatientPhone.replace(/\D/g, ''),
					phone_raw: firstPatientPhone,
					phone_e164: firstPatientPhone
				})
				.select('id')
				.single()
		),
		must(
			admin
				.from('patients')
				.insert({
					business_id: business.id,
					owner_id: ownerUserId,
					full_name: `E2E Paciente Dos ${suffix}`,
					phone: secondPatientPhone.replace(/\D/g, ''),
					phone_raw: secondPatientPhone,
					phone_e164: secondPatientPhone
				})
				.select('id')
				.single()
		)
	]);

	return {
		suffix,
		ownerEmail,
		ownerUserId,
		authUserIds: [ownerUserId],
		businessId: business.id,
		serviceId: service.id,
		professionalId: professional.id,
		otherProfessionalId: otherProfessional.id,
		patientId: patient.id,
		secondPatientId: secondPatient.id,
		date: e2eDate()
	};
};

const cleanupFixture = async (admin: FixtureClient, fixture: Partial<Fixture> | null) => {
	if (!fixture) return;
	const operations: Array<PromiseLike<{ error: unknown }>> = [];
	if (fixture.businessId)
		operations.push(admin.from('businesses').delete().eq('id', fixture.businessId));
	if (fixture.ownerEmail)
		operations.push(admin.from('allowed_emails').delete().eq('email', fixture.ownerEmail));
	if (fixture.suffix) {
		operations.push(
			admin.from('allowed_emails').delete().in('email', [
				`e2e-prof-${fixture.suffix}@example.com`,
				`e2e-admin-prof-${fixture.suffix}@example.com`
			])
		);
	}

	for (const operation of operations) {
		const { error } = await operation;
		if (error) throw error;
	}
	const authUserIds = new Set<string>([
		...(fixture.authUserIds ?? []),
		...(fixture.ownerUserId ? [fixture.ownerUserId] : [])
	]);
	for (const userId of authUserIds) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error && !error.message.includes('User not found')) {
			throw error;
		}
	}
};

const login = async (page: Page, fixture: Fixture) => {
	await signInWithPassword(page, fixture.ownerEmail, password);
	await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
};

const assertOwnerIdentity = async (page: Page, admin: FixtureClient, fixture: Fixture) => {
	const token = (await page.context().cookies()).find(
		(cookie) => cookie.name === 'sb-access-token'
	);
	if (!token) throw new Error('La sesión dueña no conservó su cookie de acceso.');
	const { data, error } = await admin.auth.getUser(token.value);
	expect(error).toBeNull();
	expect(data.user?.id, 'Auth debe conservar la identidad dueña al registrar otro integrante').toBe(
		fixture.ownerUserId
	);
	const { data: membership, error: membershipError } = await admin
		.from('business_users')
		.select('role,status')
		.eq('business_id', fixture.businessId)
		.eq('user_id', fixture.ownerUserId)
		.single();
	expect(membershipError).toBeNull();
	expect(membership, 'el alta de un integrante no debe modificar el rol del dueño').toMatchObject({
		role: 'owner',
		status: 'active'
	});
};

const postAction = async (
	page: Page,
	url: string,
	fields: Record<string, string | string[]>
): Promise<{ status: number; text: string; url: string }> =>
	page.evaluate(
		async ({ url, fields }) => {
			const form = new FormData();
			for (const [key, value] of Object.entries(fields)) {
				if (Array.isArray(value)) {
					for (const item of value) form.append(key, item);
				} else {
					form.set(key, value);
				}
			}
			const response = await fetch(url, {
				method: 'POST',
				body: form,
				credentials: 'include'
			});
			return { status: response.status, text: await response.text(), url: response.url };
		},
		{ url, fields }
	);

const expectAppointmentCreated = (result: { status: number; text: string; url: string }) => {
	let actionResult: { type?: string; status?: number; location?: string } | null = null;
	try {
		actionResult = JSON.parse(result.text) as {
			type?: string;
			status?: number;
			location?: string;
		};
	} catch {
		// La aserción inferior conserva un diagnóstico breve si el contrato cambia.
	}
	expect(
		actionResult,
		`La acción no creó el turno (HTTP ${result.status}): ${result.text.slice(0, 800)}`
	).toMatchObject({ type: 'redirect', status: 303 });
	expect(actionResult?.location).toMatch(/\/odonto\/turnos\/[0-9a-f-]+\?.*created=1/);
};

const openDayAppointmentsPanel = async (page: Page) => {
	const heading = page.getByRole('heading', { name: /Turnos del día|Resultado de búsqueda/ });
	if (
		await heading
			.first()
			.isVisible({ timeout: 1000 })
			.catch(() => false)
	)
		return;
	const button = page.getByRole('button', { name: 'Ver turnos del día' });
	await expect(button).toBeVisible();
	await button.click();
	await expect(heading.first()).toBeVisible();
};

const openReprogramPanel = async (page: Page) => {
	const panel = page.locator('details#reprogramar');
	const isOpen = await panel
		.evaluate((node) => (node as HTMLDetailsElement).open)
		.catch(() => false);
	if (!isOpen) await panel.locator('summary').click();
	await expect(panel.getByRole('heading', { name: 'Reprogramar' })).toBeVisible();
	return panel;
};

const ensureCategoryOpen = async (page: Page, name: RegExp) => {
	const button = page.getByRole('button', { name });
	await expect(button).toBeVisible();
	if ((await button.getAttribute('aria-expanded')) === 'true') return;
	// Enabled once hydrated: one click must expand it; a retried toggle could collapse it again.
	await button.click();
	await expect(button).toHaveAttribute('aria-expanded', 'true');
};

const openAddMemberModal = async (page: Page) => {
	const addMemberButton = page.getByRole('button', { name: 'Agregar integrante' });
	await addMemberButton.click();
	await expect(page.getByRole('heading', { name: 'Agregar integrante' })).toBeVisible();
};

const replaceNumberLikeAUser = async (input: Locator, value: string) => {
	await input.click();
	await input.press('Control+A');
	await input.pressSequentially(value);
};

test.describe('roles, profesionales y agenda - regresiones críticas', () => {
	test.skip(
		!allowDestructive || !supabaseUrl || !serviceRoleKey,
		'Requiere E2E_ALLOW_DESTRUCTIVE=true y ODONTO_SUPABASE_* local/staging.'
	);

	let admin: FixtureClient;
	let fixture: Fixture | null = null;

	test.beforeAll(async () => {
		admin = rest();
		fixture = await createFixture(admin);
	});

	test.afterAll(async () => {
		await cleanupFixture(admin, fixture);
	});

	test('crea rol profesional pendiente sin duplicar perfiles y mantiene agenda coherente', async ({
		page,
		browser
	}) => {
		test.setTimeout(240_000);
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);

		const pendingProfessionalEmail = `e2e-prof-${fixture.suffix}@example.com`;
		const pendingProfessionalName = `E2E Profesional Nuevo ${fixture.suffix}`;
		const wizardHealth = await observeRenderHealth(page);

		await page.goto('/odonto/configuracion/usuarios');
		await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible();

		await openAddMemberModal(page);
		await page.getByLabel('Email').fill(pendingProfessionalEmail);
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page
			.getByRole('button', { name: 'Profesional Atiende turnos y accede a sus pacientes.' })
			.click();
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page.getByPlaceholder('Nombre y apellido').fill(pendingProfessionalName);
		await page.getByRole('button', { name: 'Siguiente' }).click();
		// Paso Servicios: Consulta y Otro servicio vienen incluidos.
		await expect(page.getByText('Servicios que ofrece')).toBeVisible();
		// Render the same in-progress task through the complete planned width/theme matrix.
		// Theme fixture changes only presentation; the eventual saved profile is read back below.
		const wizardCoverage: { width: number; theme: string }[] = [];
		const wizardLayout: (LayoutIssue & { viewport: number; theme: string })[] = [];
		for (const width of [320, 390, 768, 1280, 1600])
			for (const theme of ['light', 'dark']) {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
				expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
					true
				);
				for (const issue of await layoutIssues(
					page,
					'form[action="?/add_user"] input:visible,form[action="?/add_user"] button:visible'
				))
					wizardLayout.push({ viewport: width, theme, ...issue });
				// The team categories share the page; their headers must also stay legible at 320.
				if (width === 320 && theme === 'dark') {
					await alignTaskForCapture(page.getByRole('button', { name: /^Administradores/ }));
					await page.screenshot({
						path: test.info().outputPath(`team-categories-${width}-${theme}.jpg`),
						type: 'jpeg',
						quality: 60,
						animations: 'disabled'
					});
				}
				await alignTaskForCapture(page.getByRole('heading', { name: 'Agregar integrante', exact: true }));
				await page.screenshot({
					path: test.info().outputPath(`team-wizard-${width}-${theme}.jpg`),
					type: 'jpeg',
					quality: 60,
					animations: 'disabled'
				});
				wizardCoverage.push({ width, theme });
			}
		expect(wizardCoverage).toHaveLength(10);
		expect(wizardLayout).toEqual([]);
		await test
			.info()
			.attach('team-wizard-responsive-coverage', {
				body: JSON.stringify(wizardCoverage),
				contentType: 'application/json'
			});
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.emulateMedia({ colorScheme: 'light' });

		await expect(page.getByText('Consulta', { exact: true })).toBeVisible();
		await expect(page.getByText('Otro servicio', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Siguiente' }).click();
		// Paso Horarios: obligatorio.
		await page.getByRole('button', { name: 'Lunes a viernes' }).click();
		await page.getByPlaceholder('9 a 13, 15 a 19').fill('9 a 12');
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await expect(page.getByText('Servicios incluidos')).toBeVisible();
		await page.getByRole('button', { name: 'Guardar rol' }).click();
		await expect(
			page.getByText('Perfil profesional configurado con rol Profesional.')
		).toBeVisible();

		await ensureCategoryOpen(page, /^Profesionales/);
		await expect(
			page.getByRole('heading', { name: pendingProfessionalEmail, exact: true })
		).toBeVisible();
		await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ver profesional' })).toBeVisible();
		await wizardHealth.assertAndAttach(test.info(), 'team-wizard-render-health');

		const pendingInvite = await must(
			admin
				.from('business_user_invites')
				.select('id, professional_id, role, status')
				.eq('business_id', fixture.businessId)
				.eq('email', pendingProfessionalEmail)
				.single()
		);
		expect(pendingInvite.role).toBe('professional');
		expect(pendingInvite.status).toBe('pending');
		const pendingProfessionalId = pendingInvite.professional_id;
		if (!pendingProfessionalId) throw new Error('La invitación profesional no conservó su perfil.');
		const hiddenPendingProfessional = await must(
			admin
				.from('professionals')
				.select('is_active, is_public')
				.eq('business_id', fixture.businessId)
				.eq('id', pendingProfessionalId)
				.single()
		);
		expect(hiddenPendingProfessional.is_active).toBe(true);
		expect(hiddenPendingProfessional.is_public).toBe(false);

		const pendingContext = await browser.newContext();
		const pendingPage = await pendingContext.newPage();
		await pendingPage.goto('/login');
		await pendingPage.waitForLoadState('networkidle');
		await pendingPage.locator('.mb-6').getByRole('button', { name: 'Crear cuenta' }).click();
		await expect(
			pendingPage.locator('form').getByRole('button', { name: 'Crear cuenta', exact: true })
		).toBeVisible();
		await pendingPage.getByLabel('Correo electrónico').fill(pendingProfessionalEmail);
		await pendingPage.locator('input[name="password"]').fill(password);
		await pendingPage.locator('input[name="confirm_password"]').fill(password);
		await pendingPage.getByLabel(/Leí y acepto/).check();
		await pendingPage
			.locator('form')
			.getByRole('button', { name: 'Crear cuenta', exact: true })
			.click();
		await expect(pendingPage).toHaveURL(/\/odonto\/mis-turnos/);
		await expect(pendingPage.getByRole('link', { name: 'Mis turnos' })).toBeVisible();
		await expect(pendingPage.getByRole('link', { name: 'Pacientes' })).toBeVisible();
		await pendingPage.goto(`/odonto/profesionales/${pendingProfessionalId}`);
		await expect(pendingPage).toHaveURL(/\/odonto\/mis-turnos/);
		await pendingContext.close();
		await assertOwnerIdentity(page, admin, fixture);
		// Keep the original session: logging in again here could conceal a
		// cross-context identity regression caused by accepting the invitation.

		const acceptedInvite = await must(
			admin
				.from('business_user_invites')
				.select('status, accepted_user_id, professional_id')
				.eq('business_id', fixture.businessId)
				.eq('email', pendingProfessionalEmail)
				.single()
		);
		expect(acceptedInvite.status).toBe('accepted');
		const acceptedUserId = acceptedInvite.accepted_user_id;
		if (!acceptedUserId) throw new Error('La invitación aceptada no registró su cuenta.');
		expect(acceptedUserId).not.toBe(fixture.ownerUserId);
		fixture.authUserIds.push(acceptedUserId);
		expect(acceptedInvite.professional_id).toBe(pendingProfessionalId);

		const acceptedMembership = await must(
			admin
				.from('business_users')
				.select('role, status, accepted_at')
				.eq('business_id', fixture.businessId)
				.eq('user_id', acceptedUserId)
				.single()
		);
		expect(acceptedMembership.role).toBe('professional');
		expect(acceptedMembership.status).toBe('active');
		expect(acceptedMembership.accepted_at).toBeTruthy();

		const acceptedProfessionalLink = await must(
			admin
				.from('professional_users')
				.select('id')
				.eq('business_id', fixture.businessId)
				.eq('professional_id', pendingProfessionalId)
				.eq('user_id', acceptedUserId)
				.single()
		);
		expect(acceptedProfessionalLink.id).toBeTruthy();
		const publishedProfessional = await must(
			admin
				.from('professionals')
				.select('is_active, is_public')
				.eq('business_id', fixture.businessId)
				.eq('id', pendingProfessionalId)
				.single()
		);
		expect(publishedProfessional.is_active).toBe(true);
		expect(publishedProfessional.is_public).toBe(true);

		// La vista vieja de Profesionales redirige a Equipo.
		await page.goto('/odonto/profesionales');
		await assertOwnerIdentity(page, admin, fixture);
		await page.waitForURL(/\/odonto\/configuracion\/usuarios/);

		// No se puede duplicar un profesional con el mismo email.
		const duplicateAttempt = await postAction(page, '/odonto/configuracion/usuarios?/add_user', {
			email: pendingProfessionalEmail.toUpperCase(),
			role: 'professional',
			professional_name: `E2E Duplicado ${fixture.suffix}`,
			weekdays: '1',
			time_ranges: '9 a 12',
			slot_interval_minutes: '15'
		});
		expect(duplicateAttempt.text).toContain('ya está asignado al rol Profesional');

		const createOtherProfessionalAppointment = await postAction(
			page,
			'/odonto/agenda?/create_appointment',
			{
				service_id: fixture.serviceId,
				professional_id: fixture.otherProfessionalId,
				date: fixture.date,
				time: '10:30',
				patient_mode: 'existing',
				idempotency_key: randomUUID(),
				patient_id: fixture.secondPatientId
			}
		);
		expectAppointmentCreated(createOtherProfessionalAppointment);

		const createAppointment = await postAction(page, '/odonto/agenda?/create_appointment', {
			service_id: fixture.serviceId,
			professional_id: fixture.professionalId,
			date: fixture.date,
			time: '09:00',
			patient_mode: 'existing',
			idempotency_key: randomUUID(),
			patient_id: fixture.patientId
		});
		expectAppointmentCreated(createAppointment);

		const { data: appointment } = await admin
			.from('appointments')
			.select('id, status, source, confirmed_at')
			.eq('business_id', fixture.businessId)
			.eq('patient_id', fixture.patientId)
			.eq('professional_id', fixture.professionalId)
			.single();
		expect(appointment?.status).toBe('reserved');
		expect(appointment?.source).toBe('manual');
		expect(appointment?.confirmed_at).toBeNull();

		await page.goto(`/odonto/agenda?date=${fixture.date}`);
		await openDayAppointmentsPanel(page);
		await expect(page.getByText('Reservado').first()).toBeVisible();
		await expect(page.getByText('Confirmado')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Ver semana', exact: true })).toBeVisible();

		await page.goto(`/odonto/agenda/semana?date=${fixture.date}`);
		await expect(page.getByRole('button', { name: 'Buscar' })).toBeVisible();
		await expect(page.getByText('Reservados:')).toBeVisible();

		await page.goto(`/odonto/turnos/${appointment?.id}?from_date=${fixture.date}`);
		await expect(page.getByRole('link', { name: 'Volver' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Marcar asistió' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Marcar no asistió' })).toHaveCount(0);

		const confirmAttempt = await postAction(
			page,
			`/odonto/turnos/${appointment?.id}?/update_status`,
			{
				status: 'confirmed'
			}
		);
		expect(confirmAttempt.text).toContain('La confirmación queda reservada al paciente');

		await admin.from('audit_logs').insert([
			{
				business_id: fixture.businessId,
				user_id: null,
				action: 'appointment.public_created',
				entity_type: 'appointment',
				entity_id: appointment?.id,
				metadata: {}
			},
			{
				business_id: fixture.businessId,
				user_id: null,
				action: 'appointment.public_confirmed',
				entity_type: 'appointment',
				entity_id: appointment?.id,
				metadata: { from_status: 'reserved', to_status: 'confirmed' }
			}
		]);
		await page.reload();
		await page.getByText('Historial').click();
		await expect(page.getByText('El paciente confirmó el turno desde el enlace')).toBeVisible();
		await expect(page.getByText('appointment.public_confirmed')).toHaveCount(0);

		const reprogramPanel = await openReprogramPanel(page);
		await expect(reprogramPanel.locator('input[type="hidden"][name="reprogram_date"]')).toHaveValue(
			fixture.date
		);
		await expect(reprogramPanel.getByRole('button', { name: '10:30' })).toHaveCount(1);

		const createSameProfessionalBlock = await postAction(
			page,
			'/odonto/agenda?/create_appointment',
			{
				service_id: fixture.serviceId,
				professional_id: fixture.professionalId,
				date: fixture.date,
				time: '10:30',
				patient_mode: 'new',
				idempotency_key: randomUUID(),
				patient_name: `E2E Bloqueo ${fixture.suffix}`,
				patient_phone: `+54911${Math.floor(10000000 + Math.random() * 90000000)}`
			}
		);
		expectAppointmentCreated(createSameProfessionalBlock);

		await page.goto(
			`/odonto/turnos/${appointment?.id}?from_date=${fixture.date}&reprogram_date=${fixture.date}`
		);
		const reprogramPanelAfterBlock = await openReprogramPanel(page);
		await expect(reprogramPanelAfterBlock.getByRole('button', { name: '10:30' })).toHaveCount(0);

		// Turno conjunto desde la interfaz: el primer horario común es 09:45,
		// justo cuando queda libre el último profesional requerido.
		await page.goto(`/odonto/agenda?date=${fixture.date}`);
		await expect(page).toHaveURL(/\/odonto\/agenda\?date=/);
		await page.waitForLoadState('networkidle');
		const openCreateButton = page.getByRole('button', { name: '+ Nuevo turno', exact: true });
		await openCreateButton.click();
		await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
		const wizardHeading = page.getByRole('heading', {
			name: '¿Qué necesita el paciente?',
			exact: true
		});
		const wizard = page.locator('form').filter({
			has: page.locator('input[name="booking_mode"]')
		});
		await expect(wizard).toBeVisible();
		await expect(wizardHeading).toBeVisible();
		await wizard
			.getByRole('button')
			.filter({ hasText: `E2E Consulta ${fixture.suffix}` })
			.click();
		await wizard.getByRole('button', { name: 'Equipo de profesionales', exact: true }).click();
		await wizard
			.getByRole('button')
			.filter({ hasText: `E2E Profesional Base ${fixture.suffix}` })
			.click();
		await wizard
			.getByRole('button')
			.filter({ hasText: `E2E Profesional Otro ${fixture.suffix}` })
			.click();
		const commonDaysButton = wizard.getByRole('button', {
			name: 'Ver días disponibles',
			exact: true
		});
		await expect(commonDaysButton).toBeEnabled({ timeout: 15_000 });
		await commonDaysButton.click();
		await expect(wizard.getByText('Equipo seleccionado', { exact: true })).toBeVisible();
		await expect(wizard.getByRole('heading', { name: 'Elegí un día', exact: true })).toBeVisible();
		const [, month, day] = fixture.date.split('-');
		const targetDayButton = wizard
			.locator('button.ux-choice')
			.filter({ hasText: `${Number(day)}/${Number(month)}` });
		await expect(targetDayButton).toBeVisible({ timeout: 15_000 });
		const liveDaySlots = page.waitForResponse((response) => {
			const requestUrl = new URL(response.url());
			return (
				requestUrl.pathname === '/odonto/disponibilidad/slots' &&
				requestUrl.searchParams.get('from') === fixture?.date &&
				requestUrl.searchParams.get('to') === fixture?.date
			);
		});
		await targetDayButton.click();
		await liveDaySlots;
		await expect(
			wizard.getByRole('heading', { name: 'Elegí un horario', exact: true })
		).toBeVisible();
		await wizard.getByRole('button', { name: '09:45', exact: true }).first().click();
		const searchPatientButton = wizard.getByRole('button', {
			name: /^Buscar paciente/
		});
		await expect(searchPatientButton).toBeVisible({ timeout: 15_000 });
		await searchPatientButton.click();
		await wizard.getByText(`E2E Paciente ${fixture.suffix}`, { exact: true }).click();
		await Promise.all([
			page.waitForURL(/\/odonto\/turnos\/[0-9a-f-]+/),
			wizard.getByRole('button', { name: 'Confirmar turno conjunto', exact: true }).click()
		]);

		const jointId = page.url().match(/\/odonto\/turnos\/([0-9a-f-]+)/)?.[1];
		if (!jointId) throw new Error('La interfaz no abrió el detalle del turno conjunto creado.');
		await expect(page.getByText('Turno conjunto · 2 profesionales', { exact: true })).toBeVisible();
		await expect(
			page.getByText(`E2E Profesional Base ${fixture.suffix}`, { exact: true })
		).toBeVisible();
		await expect(
			page.getByText(`E2E Profesional Otro ${fixture.suffix}`, { exact: true })
		).toBeVisible();

		const { data: jointAppointment, error: jointAppointmentError } = await admin
			.from('appointments')
			.select('id, professional_name_snapshot, starts_at, ends_at')
			.eq('business_id', fixture.businessId)
			.eq('id', jointId)
			.single();
		if (jointAppointmentError) throw jointAppointmentError;
		expect(jointAppointment.professional_name_snapshot).toContain(
			`E2E Profesional Base ${fixture.suffix}`
		);
		expect(jointAppointment.professional_name_snapshot).toContain(
			`E2E Profesional Otro ${fixture.suffix}`
		);

		const { data: jointAllocations, error: jointAllocationsError } = await admin
			.from('appointment_professionals')
			.select('professional_id, starts_at, ends_at')
			.eq('business_id', fixture.businessId)
			.eq('appointment_id', jointId)
			.order('position');
		if (jointAllocationsError) throw jointAllocationsError;
		const jointTeam = jointAllocations ?? [];
		expect(jointTeam).toHaveLength(2);
		expect(jointTeam.map((allocation) => allocation.professional_id)).toEqual([
			fixture.professionalId,
			fixture.otherProfessionalId
		]);

		const overlapAttempt = await postAction(page, '/odonto/agenda?/create_appointment', {
			service_id: fixture.serviceId,
			professional_id: fixture.otherProfessionalId,
			date: fixture.date,
			time: '09:45',
			patient_mode: 'existing',
			idempotency_key: randomUUID(),
			patient_id: fixture.secondPatientId
		});
		expect(overlapAttempt.text).toContain(
			'Ese horario ya no está libre para el profesional seleccionado'
		);

		// La reprogramación vuelve a calcular el equipo completo y mueve las dos
		// asignaciones en una sola operación.
		const jointNextDate = addIsoDays(fixture.date, 1);
		const jointNextStart = `${jointNextDate}T12:00:00.000Z`; // 09:00 en Córdoba.
		const jointReschedule = await postAction(page, `/odonto/turnos/${jointId}?/reschedule`, {
			slot_starts_at: jointNextStart,
			reprogram_date: jointNextDate,
			ignore_break: 'false'
		});
		expect(jointReschedule.status).toBeLessThan(500);

		const { data: movedAllocations, error: movedAllocationsError } = await admin
			.from('appointment_professionals')
			.select('professional_id, starts_at')
			.eq('business_id', fixture.businessId)
			.eq('appointment_id', jointId)
			.order('position');
		if (movedAllocationsError) throw movedAllocationsError;
		const movedTeam = movedAllocations ?? [];
		expect(movedTeam).toHaveLength(2);
		expect(
			movedTeam.every(
				(allocation) => new Date(allocation.starts_at).toISOString() === jointNextStart
			)
		).toBe(true);

		// El campo de descanso acepta un entero arbitrario y conserva la grilla
		// interna. Se prueba por UI y luego directamente en las reglas guardadas.
		await page.goto(`/odonto/profesionales/${fixture.professionalId}?tab=horarios`);
		await page.waitForLoadState('networkidle');
		const scheduleForm = page.locator('form[action="?/save_weekly_rules"]');
		const breakInput = scheduleForm.locator('input[type="number"]').first();
		await expect(breakInput).toHaveValue('0');
		await replaceNumberLikeAUser(breakInput, '23');
		const saveScheduleButton = scheduleForm.getByRole('button', {
			name: 'Guardar sólo horarios',
			exact: true
		});
		await expect(saveScheduleButton).toBeEnabled({ timeout: 5_000 });
		await saveScheduleButton.click();
		await expect(page.getByText('Horarios guardados.', { exact: true })).toBeVisible();

		const { data: savedRules, error: savedRulesError } = await admin
			.from('availability_rules')
			.select('slot_interval_minutes, break_minutes')
			.eq('business_id', fixture.businessId)
			.eq('professional_id', fixture.professionalId);
		if (savedRulesError) throw savedRulesError;
		const storedRules = savedRules ?? [];
		expect(storedRules.length).toBeGreaterThan(0);
		expect(storedRules.every((rule) => rule.break_minutes === 23)).toBe(true);
		expect(storedRules.every((rule) => rule.slot_interval_minutes === 15)).toBe(true);
	});

	test('vincula un administrador pendiente a su perfil y conserva libertad para configurarlo', async ({
		page,
		browser
	}) => {
		test.setTimeout(180_000);
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);

		const adminEmail = `e2e-admin-prof-${fixture.suffix}@example.com`;
		const adminProfessionalName = `E2E Administrador Profesional ${fixture.suffix}`;

		await page.goto('/odonto/configuracion/usuarios');
		await openAddMemberModal(page);
		await page.getByLabel('Email').fill(adminEmail);
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page
			.getByRole('button', { name: 'Administrador Configura equipo, agenda y pacientes.' })
			.click();
		await page.getByRole('checkbox', { name: /También atiende pacientes/ }).check();
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page.getByPlaceholder('Nombre y apellido').fill(adminProfessionalName);
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page.getByRole('button', { name: 'Lunes a viernes' }).click();
		await page.getByPlaceholder('9 a 13, 15 a 19').fill('13 a 17');
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await expect(page.getByText('También atiende pacientes', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Guardar rol' }).click();
		await expect(
			page.getByText('Perfil profesional configurado con rol Administrador.')
		).toBeVisible();

		await ensureCategoryOpen(page, /^Administradores/);
		await expect(page.getByRole('heading', { name: adminEmail, exact: true })).toBeVisible();
		await expect(page.getByText('Cuenta profesional pendiente', { exact: true })).toBeVisible();

		const pendingInvite = await must(
			admin
				.from('business_user_invites')
				.select('id, professional_id, role, status')
				.eq('business_id', fixture.businessId)
				.eq('email', adminEmail)
				.single()
		);
		expect(pendingInvite.role).toBe('admin');
		expect(pendingInvite.status).toBe('pending');
		const adminProfessionalId = pendingInvite.professional_id;
		if (!adminProfessionalId) throw new Error('La invitación de administrador no conservó su perfil.');

		const hiddenProfile = await must(
			admin
				.from('professionals')
				.select('is_active, is_public')
				.eq('business_id', fixture.businessId)
				.eq('id', adminProfessionalId)
				.single()
		);
		expect(hiddenProfile).toMatchObject({ is_active: true, is_public: false });

		const adminContext = await browser.newContext();
		const adminPage = await adminContext.newPage();
		await adminPage.goto('/login');
		await adminPage.waitForLoadState('networkidle');
		await adminPage.locator('.mb-6').getByRole('button', { name: 'Crear cuenta' }).click();
		await adminPage.getByLabel('Correo electrónico').fill(adminEmail);
		await adminPage.locator('input[name="password"]').fill(password);
		await adminPage.locator('input[name="confirm_password"]').fill(password);
		await adminPage.getByLabel(/Leí y acepto/).check();
		await adminPage
			.locator('form')
			.getByRole('button', { name: 'Crear cuenta', exact: true })
			.click();
		await expect(adminPage).toHaveURL(/\/odonto\/agenda/);

		const acceptedInvite = await must(
			admin
				.from('business_user_invites')
				.select('accepted_user_id, professional_id, status')
				.eq('id', pendingInvite.id)
				.single()
		);
		expect(acceptedInvite.status).toBe('accepted');
		const adminUserId = acceptedInvite.accepted_user_id;
		if (!adminUserId) throw new Error('La invitación de administrador aceptada no registró su cuenta.');
		fixture.authUserIds.push(adminUserId);
		expect(acceptedInvite.professional_id).toBe(adminProfessionalId);

		const adminMembership = await must(
			admin
				.from('business_users')
				.select('role, status')
				.eq('business_id', fixture.businessId)
				.eq('user_id', adminUserId)
				.single()
		);
		expect(adminMembership).toMatchObject({ role: 'admin', status: 'active' });

		const linkedProfile = await must(
			admin
				.from('professional_users')
				.select('id')
				.eq('business_id', fixture.businessId)
				.eq('professional_id', adminProfessionalId)
				.eq('user_id', adminUserId)
				.single()
		);
		expect(linkedProfile.id).toBeTruthy();

		const publishedProfile = await must(
			admin
				.from('professionals')
				.select('is_active, is_public')
				.eq('business_id', fixture.businessId)
				.eq('id', adminProfessionalId)
				.single()
		);
		expect(publishedProfile).toMatchObject({ is_active: true, is_public: true });

		await adminPage.goto(`/odonto/profesionales/${adminProfessionalId}?tab=horarios`);
		await expect(adminPage.getByRole('heading', { name: adminProfessionalName })).toBeVisible();
		await adminPage.waitForLoadState('networkidle');
		const scheduleForm = adminPage.locator('form[action="?/save_weekly_rules"]');
		const breakInput = scheduleForm.locator('input[type="number"]').first();
		await replaceNumberLikeAUser(breakInput, '19');
		await expect(breakInput).toHaveValue('19');
		const saveScheduleButton = scheduleForm.getByRole('button', {
			name: 'Guardar sólo horarios',
			exact: true
		});
		await expect(saveScheduleButton).toBeEnabled({ timeout: 5_000 });
		await saveScheduleButton.click();
		await expect(adminPage.getByText('Horarios guardados.', { exact: true })).toBeVisible();
		await adminContext.close();
	});
});
