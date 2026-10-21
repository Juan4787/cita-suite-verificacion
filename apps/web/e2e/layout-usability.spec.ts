import { expect, test } from '@playwright/test';
import { brokenOrdinaryWords, layoutIssues, textIssues } from './helpers/layout-usability';

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
			button { font: inherit; }
			section > div { width: 320px; display: flex; gap: 16px; margin-bottom: 24px; }
			h1, h2, p { margin: 0; }
			.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
		</style></head><body>
		<header id="chrome"><p style="width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Consultorio sintético de auditoría</p></header>
		<main>
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
			<div id="schedule-block">
				<p style="flex: 0 0 200px">Días que comparten la misma franja habitual.</p>
				<button style="min-width: 0">Quitar bloque</button>
			</div>
			<p id="split-duration" style="width: 70px">30 minutos</p>
			<p id="split-amount" style="width: 70px">$ 20.000</p>
			<p id="split-counter" style="width: 95px">Paso 3 de 5 · Día</p>
			<p id="dangling-separator" style="width: 220px">Consulta de prueba · 30&nbsp;minutos</p>
			<div class="ux-choice" id="truncated-choice" style="width: 120px">
				<span style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">E2E Consulta sintética larga</span>
			</div>
			<div id="clipped-placeholder"><input type="search" style="font: inherit; box-sizing: border-box; border: 0; width: 240px; padding: 0 80px 0 40px" placeholder="Buscar por nombre, DNI o teléfono"></div>
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
			<button style="width: 150px">Confirmar la reserva del turno de control anual</button>
			<p style="width: 70px">30&nbsp;min</p>
			<p style="width: 220px">Consulta de prueba ·&nbsp;30&nbsp;minutos</p>
			<p style="width: 120px">Paso&nbsp;3&nbsp;de&nbsp;5 ·&nbsp;Día</p>
			<div class="ux-choice" style="width: 120px"><span style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Corto</span></div>
			<p data-truncation="allowed" style="width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Excepción revisada y documentada</p>
			<button class="ux-control-trigger" style="width: 150px"><span>Sólo las seleccionadas</span></button>
			<input style="font: inherit; width: 300px; padding: 0 8px" placeholder="Nombre, DNI o teléfono">
			<input style="font: inherit; width: 120px; padding: 0 8px" placeholder="Buscar por nombre, DNI o teléfono" value="Julia">
		</section>
	</main></body></html>`);
	const words = async (scope: string) => (await brokenOrdinaryWords(page, scope)).map(({ word }) => word);
	expect(await words('#history')).toContain('Consulta');
	expect(await words('#header-actions')).toEqual(expect.arrayContaining(['Archivar', 'paciente']));
	expect(await words('#status-badge')).toContain('Visible');
	expect(await words('#wizard-heading')).toContain('Agregar');
	for (const issue of await brokenOrdinaryWords(page, '#history, #header-actions, #status-badge, #wizard-heading'))
		expect(issue.lines).toBeGreaterThan(1);
	// A squeezed short label wraps between words: no word is broken, yet the control is unreadable.
	expect(await textIssues(page, '#schedule-block')).toEqual([
		{ check: 'wrapped-control', label: 'Quitar bloque', lines: 2, width: expect.any(Number) }
	]);
	expect((await textIssues(page, '#split-duration')).map(({ check }) => check)).toEqual(['split-quantity']);
	expect((await textIssues(page, '#split-amount')).map(({ check }) => check)).toEqual(['split-quantity']);
	expect((await textIssues(page, '#split-counter')).map(({ check }) => check)).toEqual(['split-quantity']);
	expect((await textIssues(page, '#dangling-separator')).map(({ check }) => check)).toEqual(['dangling-separator']);
	expect((await textIssues(page, '#truncated-choice')).map(({ check }) => check)).toEqual(['truncated-value']);
	// A hint wider than the room its field leaves is shown cut; a filled field hides its hint.
	expect(await textIssues(page, '#clipped-placeholder')).toEqual([
		{ check: 'clipped-placeholder', placeholder: 'Buscar por nombre, DNI o teléfono', width: expect.any(Number), available: 120 }
	]);
	expect(await textIssues(page, '#legitimate')).toEqual([]);
	expect(await textIssues(page, '#chrome')).toEqual([]);
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
