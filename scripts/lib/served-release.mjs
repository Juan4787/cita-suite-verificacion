import { createHash } from 'node:crypto';

// What a deployed environment serves, compared with the downloaded release: the same checks for
// staging (verify-campaign-staging.mjs) and production (verify-production-release.mjs). GET
// requests only; a redirect fails like a wrong file, because it would serve another one.
const CLIENT = 'apps/web/.svelte-kit/cloudflare';
const MAX_FILE_BYTES = 5_000_000;
const digest = (contents) => createHash('sha256').update(contents).digest('hex');

/** One served file, which must answer 200 without a redirect and within the bounded size. */
export async function servedFile(url, fetchFn = fetch) {
	const response = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
	if (response.status !== 200) throw new Error(`${new URL(url).origin} answered ${response.status} for ${new URL(url).pathname}.`);
	const contents = Buffer.from(await response.arrayBuffer());
	if (contents.length > MAX_FILE_BYTES) throw new Error('A served file exceeded its bounded verification size.');
	return contents;
}

/** Every [path, contents] entry served identically by `origin`, four requests at a time; the count. */
export async function compareServed(origin, entries, fetchFn = fetch) {
	const different = [];
	for (let start = 0; start < entries.length; start += 4)
		await Promise.all(entries.slice(start, start + 4).map(async ([path, expected]) => {
			if (digest(await servedFile(origin + path, fetchFn)) !== digest(expected)) different.push(path);
		}));
	if (different.length) throw new Error(`${origin} serves files different from the release: ${different.slice(0, 5).join(', ')}`);
	return entries.length;
}

/** The app's client files of the release, as the Worker serves them. */
export const clientEntries = (files) => [...files].filter(([path]) => path.startsWith(`${CLIENT}/_app/immutable/`))
	.map(([path, contents]) => [path.slice(CLIENT.length), contents]);

/** A static site's files as Cloudflare and Vercel serve them: `page/index.html` at `/page/`, `page.html` at `/page`. */
export const siteEntries = (site) => [...site].map(([path, contents]) =>
	['/' + (path.endsWith('index.html') ? path.slice(0, -'index.html'.length) : path.replace(/\.html$/, '')), contents]);

/** The served revision, the login page and the redirect of a private route, as the release answers them. */
export async function assertAppEntry(origin, revision, fetchFn = fetch) {
	const served = JSON.parse(await servedFile(origin + '/_app/version.json', fetchFn));
	if (served.version !== revision) throw new Error(`${origin} serves ${served.version} instead of ${revision}.`);
	const login = await fetchFn(origin + '/login', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
	const privateRoute = await fetchFn(origin + '/odonto', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
	if (login.status !== 200 || ![302, 303, 307].includes(privateRoute.status) ||
		new URL(privateRoute.headers.get('location') ?? '/', origin).pathname !== '/login')
		throw new Error(`${origin} does not answer the login and the private redirect as the release does.`);
	return login.headers.get('content-security-policy');
}

/**
 * The page's policy admits its own Supabase project, and only it: the API and its WebSocket for
 * uploads and Realtime, and its images. A wildcard over every Supabase project is refused.
 */
export function assertSupabaseOrigin(policy, apiOrigin) {
	const directives = new Map(String(policy ?? '').split(';').map((part) => part.trim().split(/\s+/)).filter(([name]) => name)
		.map(([name, ...sources]) => [name.toLowerCase(), sources]));
	const socket = apiOrigin.replace(/^https:/, 'wss:');
	const connect = directives.get('connect-src') ?? [];
	const images = directives.get('img-src') ?? [];
	if (!connect.includes(apiOrigin) || !connect.includes(socket) || !images.includes(apiOrigin) ||
		[...connect, ...images].some((source) => /\*\.supabase\.co/i.test(source)))
		throw new Error('The content security policy does not admit exactly the configured Supabase project.');
	return { connect: [apiOrigin, socket], images: [apiOrigin] };
}
