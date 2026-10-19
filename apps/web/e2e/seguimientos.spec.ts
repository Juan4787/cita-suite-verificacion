import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginWithSharedSession } from './helpers/shared-auth';

// E2E exhaustivo de Seguimientos (feature nueva sin cobertura previa).
// - Credenciales SOLO por env (E2E_EMAIL / E2E_PASSWORD); nunca hardcodeadas.
// - Corre contra el Supabase real: todo dato creado lleva un marcador único y se
//   limpia vía REST con service_role (mismo patrón que odonto.full.spec.ts).
// - Adaptativo: si la cuenta no tiene pacientes / profesionales asignables, igual
//   valida los caminos visibles (vacío, validación) y SALTA la creación, sin dejar basura.

const email = process.env.E2E_EMAIL ?? process.env.CITA_SUITE_TEST_EMAIL;
const password = process.env.E2E_PASSWORD ?? process.env.CITA_SUITE_TEST_PASSWORD;
const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;

const E2E_TAG = 'E2E-SEG';
const marker = `${E2E_TAG}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// ---------- .env loader (mismo enfoque que el full spec) ----------
const readEnvFile = (): Record<string, string> => {
	let current = process.cwd();
	for (let depth = 0; depth < 5; depth += 1) {
		const candidate = path.join(current, '.env');
		if (fs.existsSync(candidate)) {
			const env: Record<string, string> = {};
			for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
				const idx = trimmed.indexOf('=');
				const key = trimmed.slice(0, idx).trim();
				let value = trimmed.slice(idx + 1).trim();
				if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
					value = value.slice(1, -1);
				env[key] = value;
			}
			return env;
		}
		current = path.dirname(current);
	}
	return {};
};

const restEnv = () => {
	const fileEnv = readEnvFile();
	const url = process.env.ODONTO_SUPABASE_URL ?? fileEnv.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	return { url, key };
};

const restHeaders = (key: string) => ({
	apikey: key,
	authorization: `Bearer ${key}`,
	'content-type': 'application/json'
});

/** Borra los follow_ups de esta corrida (marcador en message). Idempotente. */
const cleanupFollowUps = async () => {
	const { url, key } = restEnv();
	if (!url || !key) return;
	if (!businessId) throw new Error('A dedicated synthetic business is required for follow-up cleanup.');
	const res = await fetch(`${url}/rest/v1/follow_ups?business_id=eq.${businessId}&message=ilike.%25${marker}%25`, {
		method: 'DELETE',
		headers: { ...restHeaders(key), prefer: 'return=minimal' }
	});
	if (!res.ok) throw new Error(`No se pudo limpiar follow_ups de E2E: ${await res.text()}`);
};

/** Un nombre de paciente real de la cuenta (para poder buscarlo en el typeahead). */
const anyPatientName = async (): Promise<string | null> => {
	const { url, key } = restEnv();
	if (!url || !key) return null;
	const res = await fetch(
		`${url}/rest/v1/patients?select=full_name&business_id=eq.${encodeURIComponent(
			businessId ?? ''
		)}&archived_at=is.null&order=updated_at.desc&limit=1`,
		{ headers: restHeaders(key) }
	);
	if (!res.ok) return null;
	const rows = (await res.json()) as Array<{ full_name?: string }>;
	const name = rows[0]?.full_name?.trim();
	return name && name.length >= 2 ? name : null;
};

// ---------- login adaptivo (owner/admin/reception → Agenda; professional → Mis turnos) ----------
const login = async (page: Page) => {
	await loginWithSharedSession(page, {
		email: email ?? '',
		password: password ?? '',
		readyLinkNames: ['Agenda', 'Mis turnos']
	});
};

const openFollowUpDialog = async (page: Page) => {
	const dialogTitle = page.getByRole('heading', { name: 'Agregar seguimiento' });
	if (await dialogTitle.isVisible({ timeout: 1000 }).catch(() => false)) return;
	const button = page.getByRole('button', { name: 'Agregar seguimiento' });
	await expect(button).toBeVisible();
	await button.click();
	await expect(dialogTitle).toBeVisible();
};

test.describe.configure({ mode: 'serial' });

test.describe('Seguimientos — cobertura E2E', () => {
	test.skip(
		!email || !password || !businessId,
		'Definí E2E_EMAIL/E2E_PASSWORD o CITA_SUITE_TEST_EMAIL/CITA_SUITE_TEST_PASSWORD, junto con CITA_SUITE_TEST_BUSINESS_ID, para correr estos tests.'
	);
	test.skip(process.env.DEMO_MODE === 'true', 'Seguimientos no aplica en modo demo.');

	let context: BrowserContext;
	let page: Page;

	test.beforeAll(async ({ browser }) => {
		await cleanupFollowUps();
		context = await browser.newContext();
		page = await context.newPage();
		await login(page);
	});
	test.afterAll(async () => {
		await cleanupFollowUps();
		await context?.close();
	});

	test('la sección Seguimientos está en el menú y renderiza', async () => {
		await expect(page.getByRole('link', { name: 'Seguimientos' })).toBeVisible();
		await page.getByRole('link', { name: 'Seguimientos' }).click();
		await expect(page).toHaveURL(/\/odonto\/seguimientos$/);
		await expect(page.getByRole('heading', { name: 'Seguimientos', level: 1 })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Agregar seguimiento' })).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Recordatorios programados para más adelante' })
		).toBeVisible();
	});

	test('el formulario NO se cierra al clickear afuera y SÍ con la X', async () => {
		await page.goto('/odonto/seguimientos');
		await openFollowUpDialog(page);

		const dialogTitle = page.getByRole('heading', { name: 'Agregar seguimiento' });
		await expect(dialogTitle).toBeVisible();

		// Click afuera (esquina del backdrop, lejos del contenido centrado): debe seguir abierto.
		const bounds = await page.getByRole('dialog', { name: 'Agregar seguimiento', exact: true }).boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.x > 6 || bounds!.y > 6).toBe(true);
		await page.mouse.click(6, 6);
		await expect(dialogTitle).toBeVisible();

		// La X (botón "Cerrar") sí cierra. exact: distingue de "Cerrar modal" (backdrop).
		await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
		await expect(dialogTitle).toBeHidden();
	});

	test('validación: "Continuar" deshabilitado sin fecha; búsqueda de paciente responde', async () => {
		await page.goto('/odonto/seguimientos');
		await openFollowUpDialog(page);

		const patientInput = page.getByRole('textbox', { name: 'Paciente', exact: true });
		await expect(patientInput).toBeVisible();

		// < 2 chars: no busca.
		await patientInput.fill('a');
		await expect(page.getByText('Buscando…')).toBeHidden();

		const name = await anyPatientName();
		if (!name) {
			throw new Error('The synthetic fixture must contain a patient; validation with a patient was not exercised.');
		}

		await patientInput.fill(name.slice(0, Math.max(3, Math.min(name.length, 8))));
		// Aparece un resultado clickeable con ese nombre.
		const result = page.getByRole('button', { name: new RegExp(escapeRegex(name.split(/\s+/)[0]), 'i') });
		await expect(result.first()).toBeVisible({ timeout: 10_000 });
		await result.first().click();

		// Paso datos: sin fecha, "Continuar" está deshabilitado.
		await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
	});

	test('crear seguimiento futuro → aparece en programados → editar → limpiar', async () => {
		const name = await anyPatientName();
		if (!name) throw new Error('The synthetic fixture must contain a patient; follow-up creation was not exercised.');

		await page.goto('/odonto/seguimientos');
		await openFollowUpDialog(page);

		const patientInput = page.getByRole('textbox', { name: 'Paciente', exact: true });
		await patientInput.fill((name as string).slice(0, Math.max(3, Math.min((name as string).length, 8))));
		const result = page.getByRole('button', { name: new RegExp(escapeRegex((name as string).split(/\s+/)[0]), 'i') });
		await expect(result.first()).toBeVisible({ timeout: 10_000 });
		await result.first().click();

		// Fecha futura vía preset "En 1 mes" → cae en "programados", no dispara aviso.
		await page.getByRole('button', { name: 'En 1 mes' }).click();
		await expect(page.getByText('Fecha del recordatorio')).toBeVisible();

		// Asignación (si la cuenta la pide). Si no hay profesional asignable, no se puede crear: se valida y sale.
		const assignLabel = page.getByText('Asignar a', { exact: true });
		if (await assignLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
			const noProf = page.getByText('No hay perfiles profesionales atendibles para asignar este seguimiento.');
			const professionalSelect = page.locator('#fu-prof');
			await expect(noProf.or(professionalSelect)).toBeVisible({ timeout: 10_000 });
			if (await noProf.isVisible()) {
				throw new Error('The controlled fixture must include an assignable professional; creation was not exercised.');
			}
			// Exercise the visible keyboard control, including its styled replacement.
			const assignment = page.getByRole('combobox', { name: 'Asignar a', exact: true });
			await assignment.focus();
			await assignment.press('ArrowDown');
			await assignment.press('Enter');
		}

		await page.getByLabel('Mensaje / nota (opcional)').fill(`Seguimiento ${marker}`);
		await page.getByRole('button', { name: 'Continuar' }).click();

		// Confirmación: fecha grande + mensaje.
		await expect(page.getByText('Confirmar seguimiento')).toBeVisible();
		await expect(page.getByText(`Seguimiento ${marker}`)).toBeVisible();
		await page.getByRole('button', { name: 'Guardar seguimiento' }).click();

		// Vuelve a la lista y el nuevo item (futuro) aparece en "programados".
		await expect(page.getByRole('heading', { name: 'Agregar seguimiento' })).toBeHidden();
		const card = page.locator('.ux-choice', { hasText: marker });
		await expect(card).toBeVisible({ timeout: 10_000 });

		// Editar: cambia el mensaje y guarda.
		await card.getByRole('button', { name: 'Editar' }).click();
		await expect(page.getByRole('heading', { name: 'Editar seguimiento' })).toBeVisible();
		const editedMsg = `Seguimiento ${marker} editado`;
		await page.getByLabel('Mensaje / nota (opcional)').fill(editedMsg);
		await page.getByRole('button', { name: 'Continuar' }).click();
		await expect(page.getByText('Confirmar cambios')).toBeVisible();
		await page.getByRole('button', { name: 'Guardar cambios' }).click();
		await expect(page.getByRole('heading', { name: 'Editar seguimiento' })).toBeHidden();
		await expect(page.locator('.ux-choice', { hasText: editedMsg })).toBeVisible({ timeout: 10_000 });
	});

	test('la página de Recordatorios importantes renderiza', async () => {
		await page.goto('/odonto/seguimientos/importantes');
		await expect(page.getByRole('heading', { name: 'Recordatorios importantes' })).toBeVisible();
	});
});

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
