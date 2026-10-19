import { expect, test } from '@playwright/test';
import { brokenOrdinaryWords, layoutIssues } from './helpers/layout-usability';

// The shared layout contract must not be vacuous. Each squeeze mechanism observed in
// the stage 5 inspection (history button beside costs, header actions and status
// badge beside a long name, heading beside the wizard progress) is reproduced with
// the same global `overflow-wrap: anywhere`, and legitimate wrapping stays accepted.
test('layout usability detector reports squeezed ordinary words and accepts legitimate wrapping', async ({
	page
}) => {
	await page.setViewportSize({ width: 768, height: 900 });
	const longName = 'NombreExtenso'.repeat(8);
	await page.setContent(`<!doctype html><html lang="es"><head>
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<style>
			body { margin: 0; font: 16px/1.25 monospace; overflow-wrap: anywhere; }
			section > div { width: 320px; display: flex; gap: 16px; margin-bottom: 24px; }
			h1, h2, p { margin: 0; }
			.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
		</style></head><body><main>
		<section>
			<div id="history" style="flex-wrap: wrap; gap: 12px">
				<button style="flex: 1 1 0%; min-width: 0; text-align: left">Consulta octubre</button>
				<div style="flex: 0 0 270px">$ 125,50 Editar</div>
			</div>
			<div id="header-actions">
				<h1 style="flex: 1 1 auto; min-width: 0">Paciente ${longName}</h1>
				<div style="flex: 0 1 60px; display: grid; gap: 8px"><button>Archivar paciente</button><button>Nuevo turno</button></div>
			</div>
			<div id="status-badge">
				<h1 style="flex: 0 0 280px">Profesional ${longName}</h1>
				<span style="min-width: 0">Visible en reservas</span>
			</div>
			<div id="wizard-heading">
				<h2 style="min-width: 0">Agregar integrante</h2>
				<div style="flex: 0 0 260px; display: flex; gap: 8px">${'<span>1</span>'.repeat(6)}</div>
			</div>
		</section>
		<section id="legitimate">
			<p style="width: 120px">Paciente ${longName}</p>
			<p style="width: 90px; word-break: break-all">patient-ux-owner-0f0e7a@example.test</p>
			<p style="width: 90px">auto-guardado</p>
			<p style="width: 200px">Descripción clínica sintética con varias palabras normales</p>
			<span class="sr-only">Texto para lectores de pantalla</span>
			<div style="display: none"><button style="width: 10px">Oculto</button></div>
			<div style="opacity: 0"><button style="width: 10px">Transparente</button></div>
			<select><option>Opción extensamente larga</option></select>
			<button style="white-space: nowrap">Guardar cambios</button>
		</section>
	</main></body></html>`);
	const words = async (scope: string) => (await brokenOrdinaryWords(page, scope)).map(({ word }) => word);
	expect(await words('#history')).toContain('Consulta');
	expect(await words('#header-actions')).toEqual(expect.arrayContaining(['Archivar', 'paciente']));
	expect(await words('#status-badge')).toContain('Visible');
	expect(await words('#wizard-heading')).toContain('Agregar');
	for (const issue of await brokenOrdinaryWords(page, '#history, #header-actions, #status-badge, #wizard-heading'))
		expect(issue.lines).toBeGreaterThan(1);
	expect(await brokenOrdinaryWords(page, '#legitimate')).toEqual([]);
	expect(await layoutIssues(page, '#legitimate p', '#legitimate')).toEqual([]);

	// The remaining checks of the shared contract must also report real failures.
	await page.setContent(`<!doctype html><html lang="es"><head>
		<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
		</head><body><main><div style="width: 1200px">Contenido ancho</div><input name="outside" style="margin-left: 900px"></main></body></html>`);
	expect((await layoutIssues(page, 'main input')).map(({ check }) => check)).toEqual([
		'zoom-blocked',
		'document-overflow',
		'control'
	]);
});
