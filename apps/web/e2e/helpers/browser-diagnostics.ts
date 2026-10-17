import type { Page } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeBrowserText as safeText, safeBrowserUrl as safeUrl } from '../../../../scripts/lib/browser-evidence.mjs';

const observed = new WeakSet<Page>();
/** Diagnostic evidence only; never retries, reloads or changes the tested flow. */
export function observeBrowserDiagnostics(page: Page) {
	if (observed.has(page)) return;
	const directory = process.env.PLAYWRIGHT_OUTPUT_DIR ?? join(process.cwd(), 'test-results');
	observed.add(page);
	const output = join(directory, 'diagnostics');
	mkdirSync(output, { recursive: true });
	const file = join(output, 'page-' + randomUUID() + '.log');
	let events = 0;
	const record = (kind: string, details: Record<string, unknown>) => {
		if (++events > 250) throw new Error('Browser diagnostic evidence exceeded its explicit event limit.');
		appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), kind, page: safeUrl(page.url()), ...details }) + '\n', { mode: 0o600 });
	};
	page.on('pageerror', error => record('pageerror', { name: error.name, message: safeText(error.message), stack: safeText(error.stack ?? '') }));
	page.on('console', message => {
		if (message.type() === 'error') record('console-error', { message: safeText(message.text()) });
	});
	page.on('requestfailed', request => record('request-failed', { url: safeUrl(request.url()), type: request.resourceType(), error: safeText(request.failure()?.errorText ?? '') }));
	page.on('response', response => {
		if (response.status() >= 500) record('http-server-error', { url: safeUrl(response.url()), status: response.status() });
	});
}
