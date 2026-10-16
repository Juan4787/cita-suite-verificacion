import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loginWithSharedSession } from './helpers/shared-auth';

const email = process.env.E2E_EMAIL ?? process.env.CITA_SUITE_TEST_EMAIL;
const password = process.env.E2E_PASSWORD ?? process.env.CITA_SUITE_TEST_PASSWORD;

const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const publicPatientMarker = (value: string) =>
	value.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)]).replaceAll('-', '');
const PUBLIC_PATIENT_E2E_PREFIX = 'Pruebaautomatizada';
// PostgREST recibe el comodín SQL como `%25` en la URL. El `*` no es un
// comodín para estos filtros y podía dejar profesionales sintéticos huérfanos
// después de una corrida completa.
const fixtureSuffix = uniqueSuffix();
const E2E_LIKE = 'E2E%25' + fixtureSuffix;
const publicPatientLike = PUBLIC_PATIENT_E2E_PREFIX + '%25' + publicPatientMarker(fixtureSuffix);

const fixtureBusinessId = () => {
	const id = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('A dedicated CITA_SUITE_TEST_BUSINESS_ID is required before fixture mutations.');
	return id;
};

const scopedFixturePath = (value: string) => `${value}${value.includes('?') ? '&' : '?'}business_id=eq.${fixtureBusinessId()}`;

const readEnvFile = () => {
	let current = process.cwd();
	for (let depth = 0; depth < 5; depth += 1) {
		const candidate = path.join(current, '.env');
		if (fs.existsSync(candidate)) {
			const env: Record<string, string> = {};
			for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
				const index = trimmed.indexOf('=');
				const key = trimmed.slice(0, index).trim();
				let value = trimmed.slice(index + 1).trim();
				if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}
				env[key] = value;
			}
			return env;
		}
		current = path.dirname(current);
	}
	return {};
};

const runtimeEnv = () => {
	const fileEnv = readEnvFile();
	const shellEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === 'string') shellEnv[key] = value;
	}
	return { ...fileEnv, ...shellEnv };
};

const cleanupRecentHeadlessBookingAttempts = async () => {
	const env = runtimeEnv();
	const url = env.ODONTO_SUPABASE_URL;
	const key = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return;
	const since = encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString());
	const response = await fetch(
		`${url}/rest/v1/public_booking_attempts?business_id=eq.${fixtureBusinessId()}&action=eq.booking_create&created_at=gte.${since}&user_agent=ilike.%25HeadlessChrome%25`,
		{
			method: 'DELETE',
			headers: {
				apikey: key,
				authorization: `Bearer ${key}`,
				prefer: 'return=minimal'
			}
		}
	);
	if (!response.ok) {
		throw new Error(`No se pudieron limpiar intentos e2e recientes: ${await response.text()}`);
	}
};

const restEnv = () => {
	const env = runtimeEnv();
	const url = env.ODONTO_SUPABASE_URL;
	const key = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY para E2E.');
	return { url, key };
};

const restHeaders = (key: string) => ({
	apikey: key,
	authorization: `Bearer ${key}`,
	'content-type': 'application/json'
});

const restGetSingle = async <T>(path: string): Promise<T> => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${path}`, {
		headers: restHeaders(key)
	});
	if (!response.ok) throw new Error(`GET ${path} falló: ${await response.text()}`);
	const rows = (await response.json()) as T[];
	if (!rows[0]) throw new Error(`GET ${path} no devolvió registros.`);
	return rows[0];
};

const restGetMany = async <T>(path: string): Promise<T[]> => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${scopedFixturePath(path)}`, { headers: restHeaders(key) });
	if (!response.ok) throw new Error(`GET ${path} falló: ${await response.text()}`);
	return (await response.json()) as T[];
};

const restDelete = async (path: string) => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${scopedFixturePath(path)}`, {
		method: 'DELETE',
		headers: { ...restHeaders(key), prefer: 'return=minimal' }
	});
	if (!response.ok) throw new Error(`DELETE ${path} falló: ${await response.text()}`);
};

// Cleanup is limited to this run's suffix and its explicitly selected synthetic
// business. Other tenants and other runs' E2E records are never cleanup targets.
const cleanupE2EFixtures = async () => {
	const profs = await restGetMany<{ id: string }>(`professionals?name=ilike.${E2E_LIKE}&select=id`);
	const patients = [
		...(await restGetMany<{ id: string }>(`patients?full_name=ilike.${E2E_LIKE}&select=id`)),
		...(await restGetMany<{ id: string }>(
			`patients?full_name=ilike.${publicPatientLike}&select=id`
		))
	];
	const profIds = profs.map((p) => p.id);
	const patientIds = patients.map((p) => p.id);
	const inList = (ids: string[]) => `(${ids.join(',')})`;
	if (profIds.length) await restDelete(`appointments?professional_id=in.${inList(profIds)}`);
	if (patientIds.length) await restDelete(`appointments?patient_id=in.${inList(patientIds)}`);
	if (profIds.length) await restDelete(`availability_rules?professional_id=in.${inList(profIds)}`);
	if (profIds.length) await restDelete(`professional_services?professional_id=in.${inList(profIds)}`);
	if (patientIds.length) await restDelete(`professional_patient_links?patient_id=in.${inList(patientIds)}`);
	if (profIds.length) await restDelete(`professional_patient_links?professional_id=in.${inList(profIds)}`);
	await restDelete(`services?name=ilike.${E2E_LIKE}`);
	await restDelete(`professionals?name=ilike.${E2E_LIKE}`);
	await restDelete(`patients?full_name=ilike.${E2E_LIKE}`);
	await restDelete(`patients?full_name=ilike.${publicPatientLike}`);
};

const restInsertSingle = async <T>(table: string, row: Record<string, unknown>, select = 'id'): Promise<T> => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${table}?select=${select}`, {
		method: 'POST',
		headers: {
			...restHeaders(key),
			prefer: 'return=representation'
		},
		body: JSON.stringify(row)
	});
	if (!response.ok) throw new Error(`INSERT ${table} falló: ${await response.text()}`);
	const rows = (await response.json()) as T[];
	if (!rows[0]) throw new Error(`INSERT ${table} no devolvió registros.`);
	return rows[0];
};

const createPublicBookingFixtures = async (input: {
	slug: string;
	professionalName: string;
	unavailableProfessionalName: string;
	unassignedProfessionalName: string;
	serviceName: string;
	unavailableServiceName: string;
}) => {
	// El identificador público puede ser el slug o, si el negocio no tiene slug, el
	// id (UUID) — igual que getPublicBusinessBySlug en la app. Resolvemos por la
	// columna correcta para no asumir que siempre hay slug.
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.slug);
	const business = await restGetSingle<{ id: string; timezone: string }>(
		`businesses?${isUuid ? 'id' : 'slug'}=eq.${encodeURIComponent(input.slug)}&select=id,timezone`
	);
	expect(business.id).toBe(fixtureBusinessId());

	const professional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: input.professionalName,
		specialty: 'Odontología preventiva',
		phone: '1122334455',
		email: null,
		is_active: true,
		is_public: true
	});
	const unavailableProfessional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: input.unavailableProfessionalName,
		specialty: 'Sin agenda cargada',
		is_active: true,
		is_public: true
	});
	const unassignedProfessional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: input.unassignedProfessionalName,
		specialty: 'No ofrece el servicio elegido',
		is_active: true,
		is_public: true
	});

	const service = await restInsertSingle<{ id: string }>('services', {
		business_id: business.id,
		name: input.serviceName,
		duration_minutes: 45,
		buffer_before_minutes: 0,
		buffer_after_minutes: 0,
		price_label: '$ 350.000',
		description: null,
		is_active: true,
		is_public: true
	});
	const unavailableService = await restInsertSingle<{ id: string }>('services', {
		business_id: business.id,
		name: input.unavailableServiceName,
		duration_minutes: 30,
		buffer_before_minutes: 0,
		buffer_after_minutes: 0,
		price_label: null,
		description: null,
		is_active: true,
		is_public: true
	});

	await restInsertSingle('professional_services', {
		business_id: business.id,
		professional_id: professional.id,
		service_id: service.id
	}, 'business_id');
	await restInsertSingle('professional_services', {
		business_id: business.id,
		professional_id: unavailableProfessional.id,
		service_id: service.id
	}, 'business_id');
	await restInsertSingle('professional_services', {
		business_id: business.id,
		professional_id: unavailableProfessional.id,
		service_id: unavailableService.id
	}, 'business_id');

	for (const professionalId of [professional.id, unassignedProfessional.id]) {
		for (const weekday of [1, 2, 3, 4, 5]) {
			await restInsertSingle('availability_rules', {
				business_id: business.id,
				professional_id: professionalId,
				weekday,
				start_time: '09:00:00',
				end_time: '10:00:00',
				slot_interval_minutes: 15,
				is_active: true
			});
		}
	}

	return { businessId: business.id, timezone: business.timezone, serviceId: service.id, professionalId: professional.id };
};

const login = async (page: import('@playwright/test').Page) => {
	await loginWithSharedSession(page, {
		email: email ?? '',
		password: password ?? '',
		readyLinkNames: ['Agenda']
	});
};

const section = (page: import('@playwright/test').Page, text: string) =>
	page.locator('section, div.ux-card').filter({ has: page.getByRole('heading', { name: text, exact: true }) }).last();

const openDayAppointmentsPanel = async (page: import('@playwright/test').Page) => {
	const heading = page.getByRole('heading', { name: /Turnos del día|Resultado de búsqueda/ });
	if (await heading.first().isVisible({ timeout: 1000 }).catch(() => false)) return;
	const button = page.getByRole('button', { name: 'Ver turnos del día' });
	await expect(button).toBeVisible();
	await button.click();
	await expect(heading.first()).toBeVisible();
};

test.describe.configure({ mode: 'serial' });

test.describe('Dental Suite - flujo operativo completo', () => {
	test.skip(
		!email || !password,
		'Definí E2E_EMAIL/E2E_PASSWORD o CITA_SUITE_TEST_EMAIL/CITA_SUITE_TEST_PASSWORD para correr el flujo completo.'
	);

	// Only this run's explicitly scoped synthetic fixtures are cleaned.
	test.beforeAll(cleanupE2EFixtures);
	test.afterAll(cleanupE2EFixtures);

	test('profesional, servicio, disponibilidad, reserva pública, agenda y protección contra solapamiento', async ({ page }) => {
		test.setTimeout(300_000);

		const suffix = fixtureSuffix;
		const professionalName = `E2E Profesional ${suffix}`;
		const unavailableProfessionalName = `E2E Sin horarios ${suffix}`;
		const unassignedProfessionalName = `E2E No ofrece ${suffix}`;
		const serviceName = `E2E Limpieza ${suffix}`;
		const unavailableServiceName = `E2E Sin disponibilidad ${suffix}`;
		const patientMarker = publicPatientMarker(suffix);
		const patientName = `${PUBLIC_PATIENT_E2E_PREFIX} Paciente ${patientMarker}`;
		const overlapPatient = `${PUBLIC_PATIENT_E2E_PREFIX} Solapado ${patientMarker}`;
		const patientPhone = `+54911${String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8)}`;
		const overlapPhone = `+54911${String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8)}`;

		await login(page);

		await expect(page.getByRole('link', { name: 'Recordatorios' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Mensajes' })).toHaveCount(0);
		await expect(page.getByText('Panel del consultorio')).toHaveCount(0);

		await page.goto('/odonto/configuracion/comunicacion');
		const linkText = await page.getByLabel('Enlace para pacientes').inputValue();
		expect(linkText).toBeTruthy();
		const bookingUrl = new URL(linkText ?? '', page.url());
		const bookingSlug = bookingUrl.pathname.split('/').filter(Boolean).at(-1);
		expect(bookingSlug).toBeTruthy();
		const publicFixture = await createPublicBookingFixtures({
			slug: bookingSlug ?? '',
			professionalName,
			unavailableProfessionalName,
			unassignedProfessionalName,
			serviceName,
			unavailableServiceName
		});
		await cleanupRecentHeadlessBookingAttempts();

		await page.goto(bookingUrl.pathname);
		const runtimeOrigin = new URL(page.url()).origin;
		await expect(page.getByRole('heading', { name: '¿Qué necesitás?' })).toBeVisible();
		await expect(page.getByText('recibir mensajes relacionados')).toHaveCount(0);
		await expect(page.getByRole('link', { name: new RegExp(serviceName) })).toBeVisible();
		await expect(page.getByText(unavailableServiceName)).toHaveCount(0);
		await page.getByRole('link', { name: new RegExp(serviceName) }).click();
		const professionalStep = section(page, '¿Con quién?');
		await expect(professionalStep.getByRole('link', { name: new RegExp(professionalName) })).toBeVisible();
		await expect(professionalStep.getByText(unavailableProfessionalName)).toHaveCount(0);
		await expect(professionalStep.getByText(unassignedProfessionalName)).toHaveCount(0);
		await professionalStep.getByRole('link', { name: new RegExp(professionalName) }).click();
		// This scenario deliberately tests 09:00 and its overlap. Today's 09:00
		// legitimately disappears after the configured notice period; select a
		// future day without weakening that rule or changing the application clock.
		const dateParts = new Intl.DateTimeFormat('en', {
			timeZone: publicFixture.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
		}).formatToParts(new Date());
		const today = ['year', 'month', 'day'].map(type => dateParts.find(part => part.type === type)?.value ?? '').join('-');
		expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const dayLinks = section(page, 'Elegí un día').getByRole('link');
		// The loading skeleton uses the same heading, but has no day links.
		// Locator evaluation does not wait for navigation/data to finish.
		await expect(dayLinks.first()).toBeVisible();
		const futureDayIndex = await dayLinks.evaluateAll((links, today) => links.findIndex(link => {
			const date = new URL(link.getAttribute('href') ?? '', window.location.href).searchParams.get('date');
			return date !== null && date > today;
		}), today);
		expect(futureDayIndex, 'El fixture debe ofrecer un día futuro completo.').toBeGreaterThanOrEqual(0);
		await dayLinks.nth(futureDayIndex).click();
		await section(page, 'Elegí un horario').getByRole('link', { name: '09:00' }).click();

		const selectedBookingUrl = new URL(page.url());
		const selectedDate = selectedBookingUrl.searchParams.get('date') ?? '';
		const serviceId = selectedBookingUrl.searchParams.get('service_id') ?? '';
		const professionalId = selectedBookingUrl.searchParams.get('professional_id') ?? '';
		expect(selectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(serviceId).toBeTruthy();
		expect(professionalId).toBeTruthy();

		await page.getByLabel('Nombre y apellido').fill(patientName);
		await page.getByLabel('Teléfono').fill(patientPhone);
		const optionalEmail = page.getByLabel(/^Correo electrónico/);
		await expect(optionalEmail).not.toHaveAttribute('required');
		await optionalEmail.fill(`paciente-${suffix}@example.com`);
		await page.getByLabel('Obra social y plan', { exact: true }).fill('Particular de prueba');
		await page.getByRole('button', { name: 'Confirmar reserva' }).click();
		await expect(page).toHaveURL(/\/turno\/[^/?]+\?creado=1$/, { timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeVisible();
		const bookingSummary = page.locator('section').filter({
			has: page.getByRole('heading', { name: 'Resumen de la reserva' })
		});
		await expect(bookingSummary).toBeVisible();
		await expect(bookingSummary.getByText(serviceName)).toBeVisible();
		await expect(bookingSummary.getByText(professionalName)).toBeVisible();
		const publicTokenUrl = page.url();
		expect(new URL(publicTokenUrl).origin).toBe(runtimeOrigin);

		await page.goto(selectedBookingUrl.toString());
		await expect(section(page, 'Elegí un horario').getByRole('link', { name: '09:00' })).toHaveCount(0);

		const overlapIdempotencyKey = randomUUID();
		const overlapResult = await page.evaluate(
			async ({ serviceId, professionalId, selectedDate, overlapPatient, overlapPhone, idempotencyKey }) => {
				const form = new FormData();
				form.set('service_id', serviceId);
				form.set('professional_id', professionalId);
				form.set('date', selectedDate);
				form.set('time', '09:00');
				form.set('patient_mode', 'new');
				form.set('idempotency_key', idempotencyKey);
				form.set('patient_name', overlapPatient);
				form.set('patient_phone', overlapPhone);
				const response = await fetch('/odonto/agenda?/create_appointment', {
					method: 'POST',
					body: form,
					credentials: 'include'
				});
				return { status: response.status, text: await response.text() };
			},
			{ serviceId, professionalId, selectedDate, overlapPatient, overlapPhone, idempotencyKey: overlapIdempotencyKey }
		);
		expect(overlapResult.text).toContain(
			'Ese horario ya no está libre para el profesional seleccionado.'
		);
		expect(overlapResult.text).toContain('No se creó el turno.');
		expect(overlapResult.text).toContain(
			'Volvé al paso de horarios, actualizá la disponibilidad y elegí otra opción.'
		);

		await page.goto(`/odonto/agenda?date=${selectedDate}`);
		await page.waitForLoadState('networkidle');
		await openDayAppointmentsPanel(page);
		await expect(page.getByText(patientName)).toBeVisible();
		await expect(page.getByText(overlapPatient)).toHaveCount(0);
		await expect(page.getByText(serviceName)).toBeVisible();
		await expect(page.getByText(professionalName)).toBeVisible();
		await expect(page.getByText('Online', { exact: true }).first()).toBeVisible();

		await page.goto(publicTokenUrl);
		await page.getByRole('button', { name: 'Confirmo que voy' }).click();
		await expect(page.getByText('Turno confirmado.')).toBeVisible();
		await page.goto(`/odonto/agenda?date=${selectedDate}&status=confirmed`);
		await page.waitForLoadState('networkidle');
		await openDayAppointmentsPanel(page);
		const confirmedAppointment = page.locator('a.ux-choice').filter({ hasText: patientName }).first();
		await expect(confirmedAppointment).toBeVisible();
		await expect(confirmedAppointment.getByText('Confirmado')).toBeVisible();

		await page.goto('/odonto/maestro');
		if (page.url().includes('/odonto/maestro')) {
			const manageButtons = page.getByRole('button', { name: 'Gestionar' });
			const count = await manageButtons.count();
			for (let index = 0; index < count; index += 1) {
				const manage = manageButtons.nth(index);
				if (!(await manage.isVisible())) continue;
				await manage.scrollIntoViewIfNeeded();
				await manage.click();
				const amount = page.getByPlaceholder('Monto opcional').first();
				if (!(await amount.isVisible({ timeout: 3000 }).catch(() => false))) continue;
				await amount.fill('1250000');
				await expect(amount).toHaveValue('1.250.000');
				break;
			}
		}
	});
});
