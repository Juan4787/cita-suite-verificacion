import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAppEntry, assertSupabaseOrigin, clientEntries, compareServed, servedFile, siteEntries } from './served-release.mjs';

const origin = 'https://app.example.test';
const answer = (status, body = '', headers = {}) => ({ status, headers: new Headers(headers),
	arrayBuffer: async () => new TextEncoder().encode(body).buffer });
const serving = (routes) => async (url) => routes[new URL(url).pathname]?.() ?? answer(404);

test('a served file must answer 200 without a redirect and within its bounded size', async () => {
	assert.equal(String(await servedFile(origin + '/a.js', serving({ '/a.js': () => answer(200, 'A') }))), 'A');
	await assert.rejects(servedFile(origin + '/a.js', serving({ '/a.js': () => answer(302, '', { location: '/b.js' }) })), /answered 302 for \/a\.js/);
	await assert.rejects(servedFile(origin + '/a.js', serving({ '/a.js': () => answer(200, 'x'.repeat(5_000_001)) })), /bounded verification size/);
});

test('every release file must be served identically, and a different one is named', async () => {
	const entries = [['/a.js', Buffer.from('A')], ['/b.js', Buffer.from('B')], ['/c.js', Buffer.from('C')], ['/d.js', Buffer.from('D')], ['/e.js', Buffer.from('E')]];
	const routes = Object.fromEntries(entries.map(([path, contents]) => [path, () => answer(200, String(contents))]));
	assert.equal(await compareServed(origin, entries, serving(routes)), 5);
	await assert.rejects(compareServed(origin, entries, serving({ ...routes, '/e.js': () => answer(200, 'old') })), /different from the release: \/e\.js/);
});

test('client and site files map to the paths their host serves', () => {
	const files = new Map([['apps/web/.svelte-kit/cloudflare/_app/immutable/x.js', 'X'], ['apps/web/.svelte-kit/cloudflare/_app/version.json', 'V']]);
	assert.deepEqual(clientEntries(files), [['/_app/immutable/x.js', 'X']]);
	assert.deepEqual(siteEntries(new Map([['index.html', 'I'], ['turnos/index.html', 'T'], ['gracias.html', 'G'], ['logo.svg', 'L']])),
		[['/', 'I'], ['/turnos/', 'T'], ['/gracias', 'G'], ['/logo.svg', 'L']]);
});

test('the app must serve the revision, its login page and the private redirect', async () => {
	const healthy = {
		'/_app/version.json': () => answer(200, JSON.stringify({ version: 'abc' })),
		'/login': () => answer(200, '', { 'content-security-policy': "default-src 'self'" }),
		'/odonto': () => answer(303, '', { location: '/login' })
	};
	assert.equal(await assertAppEntry(origin, 'abc', serving(healthy)), "default-src 'self'");
	await assert.rejects(assertAppEntry(origin, 'def', serving(healthy)), /serves abc instead of def/);
	await assert.rejects(assertAppEntry(origin, 'abc', serving({ ...healthy, '/odonto': () => answer(200) })), /private redirect/);
	await assert.rejects(assertAppEntry(origin, 'abc', serving({ ...healthy, '/odonto': () => answer(303, '', { location: '/elsewhere' }) })), /private redirect/);
});

test('the policy admits exactly the configured Supabase project', () => {
	const api = 'https://project.supabase.co';
	const policy = `default-src 'self'; connect-src 'self' ${api} wss://project.supabase.co; img-src 'self' data: ${api}`;
	assert.deepEqual(assertSupabaseOrigin(policy, api), { connect: [api, 'wss://project.supabase.co'], images: [api] });
	for (const wrong of [
		`connect-src 'self' ${api}; img-src ${api}`,
		`connect-src 'self' https://other.supabase.co wss://other.supabase.co; img-src https://other.supabase.co`,
		`connect-src 'self' ${api} wss://project.supabase.co https://*.supabase.co; img-src ${api}`,
		`connect-src 'self' ${api} wss://project.supabase.co`,
		null
	]) assert.throws(() => assertSupabaseOrigin(wrong, api), /exactly the configured Supabase project/);
});
