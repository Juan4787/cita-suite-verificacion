import { expect, type BrowserContext, type Page } from '@playwright/test';
import { observeBrowserDiagnostics } from './browser-diagnostics';

type StoredSession = Awaited<ReturnType<BrowserContext['storageState']>>;

type SharedLoginOptions = {
	email: string;
	password: string;
	readyLinkNames?: string[];
	loginPath?: string;
};

// Playwright reutiliza el mismo worker en esta suite secuencial. Conservar el estado
// sólo en memoria evita castigar el rate limit real sin escribir tokens en el repo o /tmp.
const sessionsByEmail = new Map<string, StoredSession>();

const readyNavigation = (page: Page, names: string[]) => {
	let locator = page.getByRole('link', { name: names[0], exact: true });
	for (const name of names.slice(1)) {
		locator = locator.or(page.getByRole('link', { name, exact: true }));
	}
	return locator.first();
};

const restoreSession = async (page: Page, session: StoredSession, readyLinkNames: string[]) => {
	await page.context().addCookies(session.cookies);
	for (const originState of session.origins) {
		await page.addInitScript(
			({ origin, entries }) => {
				if (window.location.origin !== origin) return;
				for (const { name, value } of entries) window.localStorage.setItem(name, value);
			},
			{ origin: originState.origin, entries: originState.localStorage }
		);
	}
	await page.goto('/odonto');
	return readyNavigation(page, readyLinkNames)
		.isVisible({ timeout: 7_500 })
		.catch(() => false);
};

export async function signInWithPassword(page: Page, email: string, password: string, loginPath = '/login') {
	observeBrowserDiagnostics(page);
	await page.goto(loginPath);
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await Promise.all([
		page.waitForURL(url => !url.pathname.startsWith('/login')),
		// The URL wait owns navigation. The action deadline only governs finding
		// and clicking the button, including on a cold development server.
		page.locator('form').first().getByRole('button', { name: 'Ingresar', exact: true }).click({ noWaitAfter: true })
	]);
}

export const loginWithSharedSession = async (
	page: Page,
	{
		email,
		password,
		readyLinkNames = ['Agenda', 'Mis turnos', 'Pacientes'],
		loginPath = '/login'
	}: SharedLoginOptions
) => {
	observeBrowserDiagnostics(page);
	const cacheKey = email.trim().toLocaleLowerCase('es-AR');
	const cached = sessionsByEmail.get(cacheKey);
	if (cached && (await restoreSession(page, cached, readyLinkNames))) return;
	if (cached) sessionsByEmail.delete(cacheKey);

	await signInWithPassword(page, email, password, loginPath);
	await expect(readyNavigation(page, readyLinkNames)).toBeVisible({ timeout: 15_000 });
	sessionsByEmail.set(cacheKey, await page.context().storageState());
};
