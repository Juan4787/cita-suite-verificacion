import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { assertNataliaComparison } from './lib/natalia-performance.mjs';

// Built artifacts, fresh browser contexts and actual loopback HTTP transfer.
// Public contact/catalogue are synthetic; this is not booking/backend proof.
assertHostedIntegrationResources();
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = 'c0129e492051a38d5b8025158fb996a81da0e871';
// Deliberate changes to Natalia's JS since the baseline, each with its reason and exact
// artifacts; anything else still fails the comparison.
const declaredChanges = JSON.parse(readFileSync(join(root, 'scripts/lib/natalia-declared-changes.json'), 'utf8'));
const runId = process.env.CITA_VERIFICATION_RUN_ID;
assert.match(runId ?? '', /^[a-f0-9-]{36}$/);
const output = join(root, '.verification/runs', runId, 'natalia-performance');
mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'cita-natalia-performance-'));
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium, expect } = require('@playwright/test');
const result = {
	scope:
		'Two pinned Astro builds using the same installed toolchain; real local HTTP and Chromium. Synthetic public contact/catalogue only. No hosted application or database.',
	baselineRevision: baseline,
	baselineDescription: 'Last verified UI baseline before stage 5 (full39090572628).',
	declaredChanges,
	measurements: [],
	passed: false
};
let browser;
function command(cmd, args, options = {}) {
	const child = spawnSync(cmd, args, {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 ** 2,
		...options
	});
	if (child.status !== 0 || child.error)
		throw new Error(`Natalia comparison command failed: ${cmd} ${args[0]}`);
	return child.stdout;
}
function artifacts(dist) {
	const html = readFileSync(join(dist, 'index.html'), 'utf8');
	const inlineSourceBytes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].reduce(
		(sum, match) => sum + Buffer.byteLength(match[1]),
		0
	);
	const scripts = readdirSync(join(dist, '_astro'))
		.filter((name) => name.endsWith('.js'))
		.sort()
		.map((name) => {
			const body = readFileSync(join(dist, '_astro', name));
			return { name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
		});
	return { inlineSourceBytes, scripts, htmlBytes: Buffer.byteLength(html) };
}
const mime = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.woff2': 'font/woff2',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg'
};
async function measure(label, dist) {
	const built = artifacts(dist);
	const server = createServer((req, res) => {
		let path;
		try {
			path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
		} catch {
			res.writeHead(400).end();
			return;
		}
		let file = resolve(dist, '.' + path);
		if (file !== dist && !file.startsWith(dist + sep)) {
			res.writeHead(404).end();
			return;
		}
		if (!extname(file)) file = join(file, 'index.html');
		if (!existsSync(file) || !statSync(file).isFile()) {
			res.writeHead(404).end();
			return;
		}
		const body = readFileSync(file),
			compressed = /\.(?:html|js|css|svg)$/.test(file);
		const sent = compressed ? gzipSync(body) : body;
		res
			.writeHead(200, {
				'content-type': mime[extname(file)] ?? 'application/octet-stream',
				'content-length': sent.length,
				'cache-control': 'no-store',
				...(compressed ? { 'content-encoding': 'gzip' } : {})
			})
			.end(sent);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	try {
		for (const width of [390, 1280])
			for (let repetition = 1; repetition <= 3; repetition++) {
				const context = await browser.newContext({
					viewport: { width, height: 900 },
					locale: 'es-AR',
					reducedMotion: 'reduce',
					serviceWorkers: 'block'
				});
				const errors = [],
					unexpected = [];
				try {
					await context.addInitScript(() => {
						window.__citaAstroHydrationEvents = 0;
						document.addEventListener(
							'astro:hydrate',
							() => {
								window.__citaAstroHydrationEvents++;
							},
							true
						);
					});
					await context.route('**/*', async (route) => {
						const url = new URL(route.request().url());
						if (url.origin === origin) return route.continue();
						if (
							url.origin === 'http://127.0.0.1:5177' &&
							url.pathname.startsWith('/api/public/') &&
							route.request().method() === 'GET'
						)
							return route.fulfill({
								contentType: 'application/json',
								headers: { 'access-control-allow-origin': origin },
								body: JSON.stringify({ contact: {}, services: [] })
							});
						unexpected.push(url.origin + url.pathname);
						await route.abort();
					});
					const page = await context.newPage();
					page.on('pageerror', (error) => errors.push(error.message));
					const response = await page.goto(origin + '/', { waitUntil: 'load' });
					assert.equal(response.status(), 200);
					await expect(page.locator('h1')).toBeVisible();
					await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
					await expect(page.locator('html')).toHaveClass(/dark/);
					const timing = await page.evaluate(() => {
						const navigation = performance.getEntriesByType('navigation')[0];
						const scripts = performance
							.getEntriesByType('resource')
							.filter((entry) => entry.initiatorType === 'script')
							.map((entry) => ({
								path: new URL(entry.name).pathname,
								encodedBodyBytes: entry.encodedBodySize,
								decodedBodyBytes: entry.decodedBodySize,
								browserTransferBytes: entry.transferSize
							}));
						return {
							scripts,
							domContentLoadedMs: navigation.domContentLoadedEventEnd,
							frameworkHydration: {
								islands: document.querySelectorAll('astro-island').length,
								events: window.__citaAstroHydrationEvents,
								durationMs: null,
								durationExplanation:
									'No framework hydration phase when no Astro islands/events exist; not a claim of zero JavaScript execution time.'
							}
						};
					});
					assert.equal(timing.scripts.length, built.scripts.length);
					for (const item of timing.scripts) {
						assert(
							item.encodedBodyBytes > 0 &&
								item.decodedBodyBytes > 0 &&
								item.browserTransferBytes > 0,
							'Resource timing did not demonstrate a cold script transfer.'
						);
						assert(
							built.scripts.some(
								(script) =>
									item.path.endsWith('/' + script.name) && item.decodedBodyBytes === script.bytes
							)
						);
					}
					assert.deepEqual(errors, []);
					assert.deepEqual(unexpected, []);
					result.measurements.push({ label, width, repetition, artifacts: built, ...timing });
				} finally {
					await context.close();
				}
			}
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}
try {
	command('git', ['fetch', '--no-tags', '--depth=1', 'origin', baseline]);
	assert.equal(command('git', ['rev-parse', baseline]).trim(), baseline);
	const archive = join(work, 'source.tar');
	command('git', ['archive', '--format=tar', '--output=' + archive, baseline, 'apps/natalia']);
	command('tar', ['-xf', archive, '-C', work]);
	const app = join(work, 'apps/natalia');
	const referencePackage = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
	const currentPackage = JSON.parse(readFileSync(join(root, 'apps/natalia/package.json'), 'utf8'));
	assert.deepEqual(
		referencePackage.dependencies,
		currentPackage.dependencies,
		'Baseline and candidate must use the same pinned runtime dependencies.'
	);
	assert.deepEqual(
		referencePackage.devDependencies,
		currentPackage.devDependencies,
		'Baseline and candidate must use the same pinned build dependencies.'
	);
	symlinkSync(join(root, 'apps/natalia/node_modules'), join(app, 'node_modules'), 'dir');
	writeFileSync(
		join(output, 'baseline-build.log'),
		command('pnpm', ['--dir', app, 'build'], {
			env: {
				...process.env,
				ASTRO_TELEMETRY_DISABLED: '1',
				NATALIA_LOCAL_FIXTURE: 'true',
				PUBLIC_CITA_BASE_URL: 'http://127.0.0.1:5177',
				PUBLIC_NATALIA_INTEGRATION_KEY: 'ab'.repeat(16)
			}
		})
	);
	browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
	await measure('baseline', resolve(app, 'dist'));
	await measure('candidate', resolve(root, 'apps/natalia/dist'));
	assertNataliaComparison(result.measurements, declaredChanges);
	result.passed = true;
} finally {
	await browser?.close();
	rmSync(work, { recursive: true });
	writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
	console.log(
		JSON.stringify({
			profile: 'natalia-performance',
			baseline,
			samples: result.measurements.length,
			passed: result.passed
		})
	);
}
