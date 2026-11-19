import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { data } from './page-fixture';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

// Abrir «Reprogramar» pide los horarios desde el navegador. Antes de hidratar, un toque abría la
// sección de forma nativa y la hidratación la volvía a cerrar sin pedir nada (`bind:open` impone su
// estado inicial): la corrida 44438357100 falló así en roles-agenda-regression.spec.ts. Hasta
// hidratar la sección llega inerte, como los botones que esperan su código (createClientReadiness).
const reprogramTag = (html: string) => html.match(/<details\b[^>]*\bid="reprogramar"[^>]*>/)?.[0] ?? null;

describe('la página del turno dibujada en el servidor', () => {
	it('manda la sección «Reprogramar» inerte hasta que la página está lista', () => {
		const tag = reprogramTag(render(Page, { props: { data } }).body);
		expect(tag).not.toBeNull();
		expect(tag).toMatch(/\sinert(?:=""|\s|>)/);
	});
});
