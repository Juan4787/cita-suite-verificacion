// Navegador de la prueba de punta a punta de Mercado Pago, manejado paso a paso
// (docs/plans/cobros-mercadopago-20261118.md). Desde apps/web:
//
//   node scripts/mercadopago-e2e-navegador.mjs abrir --perfil <carpeta vacía> [--visible]   (queda corriendo)
//   node scripts/mercadopago-e2e-navegador.mjs ir <url> | url | texto [máximo] | campos | marcos
//   node scripts/mercadopago-e2e-navegador.mjs captura <archivo.png>
//   node scripts/mercadopago-e2e-navegador.mjs clic-texto <texto> | clic-rol <rol> <nombre> | clic <selector>
//   node scripts/mercadopago-e2e-navegador.mjs escribir <selector> <valor> | escribir-etiqueta <etiqueta> <valor>
//   node scripts/mercadopago-e2e-navegador.mjs escribir-secreto <selector> ENV:<NOMBRE>|ESTADO:<campo>
//   node scripts/mercadopago-e2e-navegador.mjs escribir-marco <parte de la url del marco> <selector> <valor>
//   node scripts/mercadopago-e2e-navegador.mjs tecla <tecla> | esperar <ms> | cerrar
//
// «abrir» usa un perfil vacío, como una ventana privada. Los secretos se leen del .env de la raíz o del
// estado privado de la prueba (~/.local/share/cita-suite/mercadopago-e2e/estado.json) y nunca se imprimen.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9333';
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const [command, ...args] = process.argv.slice(2);
const fail = (message) => { console.error(message); process.exit(1); };

const secret = (reference) => {
	const [source, name] = String(reference ?? '').split(':');
	if (source === 'ENV') {
		const line = readFileSync(join(root, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
		const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
		if (!value) fail(`El .env no tiene ${name}.`);
		return value;
	}
	if (source === 'ESTADO') {
		const state = JSON.parse(readFileSync(join(homedir(), '.local/share/cita-suite/mercadopago-e2e/estado.json'), 'utf8'));
		if (!state[name]) fail(`El estado de la prueba no tiene «${name}».`);
		return state[name];
	}
	return fail('El secreto se indica como ENV:<NOMBRE> o ESTADO:<campo>.');
};

if (command === 'abrir') {
	const profileIndex = args.indexOf('--perfil');
	if (profileIndex === -1 || !args[profileIndex + 1]) fail('Indicá --perfil <carpeta vacía>.');
	const context = await chromium.launchPersistentContext(args[profileIndex + 1], {
		headless: !args.includes('--visible'), locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
		viewport: { width: 1280, height: 900 }, args: ['--remote-debugging-port=9333']
	});
	if (!context.pages().length) await context.newPage();
	console.log('navegador listo en el puerto 9333');
	await new Promise(() => {});
}

const browser = await chromium.connectOverCDP(CDP).catch(() => fail('No hay navegador abierto: corré «abrir» primero.'));
const context = browser.contexts()[0];
const page = context.pages().at(-1) ?? await context.newPage();
page.setDefaultTimeout(20_000);
const show = async () => console.log(`url: ${page.url()}\ntítulo: ${await page.title().catch(() => '-')}`);

const actions = {
	async ir() { await page.goto(args[0], { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}); await show(); },
	async url() { await show(); },
	async texto() { await show(); const text = await page.locator('body').innerText().catch(() => ''); console.log(text.replace(/\n{3,}/g, '\n\n').slice(0, Number(args[0] ?? 4000))); },
	async campos() {
		await show();
		const fields = await page.$$eval('input, select, textarea, button, [role=button], a[href]', (nodes) => nodes
			.filter((n) => n.offsetParent !== null || n.getClientRects().length)
			.map((n) => [n.tagName.toLowerCase(), n.getAttribute('type') ?? '', n.id ? `#${n.id}` : '', n.getAttribute('name') ?? '',
				n.getAttribute('placeholder') ?? '', n.getAttribute('aria-label') ?? '', (n.innerText ?? '').trim().slice(0, 60)].join(' | ')));
		console.log(fields.slice(0, 120).join('\n'));
	},
	async marcos() { await show(); for (const frame of page.frames()) console.log(`marco: ${frame.url().slice(0, 160)}`); },
	async captura() { await page.screenshot({ path: args[0] }); console.log(`captura: ${args[0]}`); },
	async 'clic-texto'() { await page.getByText(args[0], { exact: false }).first().click(); await page.waitForLoadState('domcontentloaded').catch(() => {}); await show(); },
	async 'clic-rol'() { await page.getByRole(args[0], { name: args[1] }).first().click(); await page.waitForLoadState('domcontentloaded').catch(() => {}); await show(); },
	async clic() { await page.locator(args[0]).first().click(); await page.waitForLoadState('domcontentloaded').catch(() => {}); await show(); },
	async escribir() { await page.locator(args[0]).first().fill(args[1]); console.log(`escrito en ${args[0]}`); },
	async 'escribir-etiqueta'() { await page.getByLabel(args[0]).first().fill(args[1]); console.log(`escrito en «${args[0]}»`); },
	async 'escribir-secreto'() { await page.locator(args[0]).first().fill(secret(args[1])); console.log(`escrito en ${args[0]} (valor secreto, sin mostrar)`); },
	async 'escribir-marco'() {
		const frame = page.frames().find((f) => f.url().includes(args[0]));
		if (!frame) fail(`No hay un marco cuya dirección contenga «${args[0]}».`);
		await frame.locator(args[1]).first().fill(args[2]);
		console.log(`escrito en ${args[1]} dentro del marco`);
	},
	async tecla() { await page.keyboard.press(args[0]); await page.waitForLoadState('domcontentloaded').catch(() => {}); await show(); },
	// Para campos dentro de marcos seguros sin dirección propia: tocar en una posición y teclear, como una persona.
	async 'clic-xy'() { await page.mouse.click(Number(args[0]), Number(args[1])); console.log(`toque en ${args[0]},${args[1]}`); },
	async teclear() { await page.keyboard.type(args[0], { delay: 60 }); console.log(`tecleado: ${args[0].length} caracteres`); },
	async esperar() { await page.waitForTimeout(Number(args[0] ?? 1000)); await show(); },
	async cerrar() { await browser.close(); console.log('navegador cerrado'); }
};

if (!actions[command]) fail(`Subcomando desconocido. Opciones: abrir, ${Object.keys(actions).join(', ')}`);
await actions[command]();
process.exit(0);
