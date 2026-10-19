import { test, expect } from '@playwright/test';
import { loginWithSharedSession } from './helpers/shared-auth';

const email = process.env.E2E_EMAIL ?? process.env.CITA_SUITE_TEST_EMAIL;
const password = process.env.E2E_PASSWORD ?? process.env.CITA_SUITE_TEST_PASSWORD;

test.describe('Odontologia - flujo base', () => {
	test.skip(
		!email || !password,
		'Definí E2E_EMAIL/E2E_PASSWORD o CITA_SUITE_TEST_EMAIL/CITA_SUITE_TEST_PASSWORD para correr el test.'
	);

	test('login y navegación principal', async ({ page }) => {
		await loginWithSharedSession(page, {
			email: email ?? '',
			password: password ?? '',
			readyLinkNames: ['Agenda'],
			loginPath: '/'
		});

		await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Pacientes' })).toBeVisible();
		const configMenu = page.getByRole('button', { name: 'Configuración' });
		await expect(configMenu).toBeVisible();
		await configMenu.click();
		await expect(configMenu).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('menuitem', { name: 'Equipo' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Reseña de Google' })).toBeVisible();

		await page.goto('/odonto/configuracion/comunicacion');
		await expect(page.getByRole('heading', { name: 'Reserva online', level: 1 })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Copiar enlace', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ver como paciente' })).toHaveAttribute(
			'href',
			/\/reservar\//
		);
		await expect(page.getByText(/WhatsApp|notificaciones push/i)).toHaveCount(0);

		await page.goto('/odonto/configuracion/negocio');
		await expect(page.getByRole('heading', { name: 'Datos del consultorio', level: 1 })).toBeVisible();
		await expect(page.locator('a[href*="/reservar/"]')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Abrir link' })).toHaveCount(0);

		await page.goto('/odonto/configuracion/resena-google');
		await expect(page.getByRole('heading', { name: 'Reseña de Google', level: 1 })).toBeVisible();
		await expect(page.getByLabel('Solicitar reseñas automáticamente')).toBeVisible();
		await expect(page.getByLabel('Enlace directo para dejar una reseña')).toBeVisible();

		const title = page.getByLabel('Título', { exact: true });
		const body = page.getByLabel('Texto', { exact: true });
		const action = page.getByLabel('Texto del botón', { exact: true });
		await title.fill('Cambio sin guardar');
		await body.fill('Cambio sin guardar');
		await action.fill('Cambio sin guardar');
		await page.getByRole('button', { name: 'Restablecer frase original' }).click();
		await expect(title).toHaveValue('✨ Esperamos que hayas tenido una buena experiencia con nosotros.');
		await expect(body).toHaveValue(
			'Si querés, compartí tu opinión en Google. Puede ayudar a otros que estén buscando dónde atenderse.'
		);
		await expect(action).toHaveValue('Compartir mi opinión');
	});
});

test.describe('Reserva pública - modo demo', () => {
	test.skip(process.env.DEMO_MODE !== 'true', 'La reserva pública demo requiere DEMO_MODE=true.');

	test('muestra reserva pública, turno por token y aliases de respuesta', async ({ page }) => {
		await page.goto('/reservar/consultorio-demo');
		await expect(page.getByRole('heading', { name: 'Consultorio demo' })).toBeVisible();
		await expect(page.getByText('Paso 1 de 5')).toBeVisible();
		await expect(page.getByRole('heading', { name: '¿Qué necesitás?' })).toBeVisible();
		await expect(page.getByRole('link', { name: /Consulta/i }).first()).toBeVisible();

		// El flujo colapsa los pasos resueltos y muestra el siguiente.
		await page.getByRole('link', { name: /Evaluación inicial/i }).click();
		await expect(page.getByRole('heading', { name: '¿Con quién?' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Cambiar' })).toBeVisible();
		await page.getByRole('link', { name: /Dra\. Pérez/i }).click();
		await expect(page.getByRole('heading', { name: 'Elegí un día' })).toBeVisible();

		await page.goto('/turno/demo-token');
		await expect(page.getByRole('heading', { name: 'Tu turno' })).toBeVisible();
		await expect(page.getByText(/Te esperamos el/)).toBeVisible();
		// Dirección + CTAs de calendario (plan Calendario/dirección/recordatorios).
		const locationCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Dónde es' }) });
		await expect(locationCard.getByText('Av. Demo 123')).toBeVisible();
		await expect(locationCard.getByRole('link', { name: 'Cómo llegar' })).toBeVisible();
		await expect(page.locator('summary').filter({ hasText: 'Agregar al calendario' })).toBeVisible();
		await expect(page.locator('summary').filter({ hasText: 'Copiar detalles del turno' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Confirmo que voy' })).toBeEnabled();
		await expect(page.getByText('Necesito reprogramar')).toBeVisible();
		await expect(page.locator('summary').filter({ hasText: 'Cancelar turno' })).toBeVisible();

		await page.goto('/confirmar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=confirmar$/);
		await page.goto('/cancelar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=cancelar$/);
		await page.goto('/reprogramar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=reprogramar$/);
	});

	test('endpoints de calendario: ICS válido y redirects de tracking', async ({ request }) => {
		const ics = await request.get('/turno/demo-token/calendario.ics');
		expect(ics.status()).toBe(200);
		expect(ics.headers()['content-type']).toContain('text/calendar');
		expect(ics.headers()['content-disposition']).toContain('inline');
		expect(ics.headers()['cache-control']).toContain('no-store');
		const body = await ics.text();
		expect(body).toContain('BEGIN:VCALENDAR');
		expect(body).toContain('METHOD:PUBLISH');
		// Título neutral: nunca el servicio (privacidad en pantalla bloqueada).
		// Se desdobla el folding para poder buscar texto sin cortes de línea.
		const unfolded = body.replace(/\r\n[ \t]/g, '');
		expect(unfolded).toContain('SUMMARY:Turno en Consultorio demo');
		expect(unfolded).not.toMatch(/Consulta(?!orio)/);

		const download = await request.get('/turno/demo-token/calendario-descargar.ics');
		expect(download.status()).toBe(200);
		expect(download.headers()['content-disposition']).toContain('attachment');

		const google = await request.get('/turno/demo-token/ir/google', { maxRedirects: 0 });
		expect(google.status()).toBe(302);
		expect(google.headers()['location']).toContain('calendar.google.com');

		const maps = await request.get('/turno/demo-token/ir/maps', { maxRedirects: 0 });
		expect(maps.status()).toBe(302);
		expect(maps.headers()['location']).toContain('google.com/maps');
	});
});
