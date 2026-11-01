// robots.txt always, and the sitemap once the site has its own domain (plan de señas y avisos, 12.16).
// Reads the same PUBLIC_NATALIA_SITE_URL as src/lib/site-config.ts, which decides each page's
// canonical address or noindex; check-public.mjs then proves that both agree. The /turnos/ page only
// redirects to the booking flow, so it is not listed.
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const configured = String(process.env.PUBLIC_NATALIA_SITE_URL || '').trim();
let origin = null;
if (configured) {
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Configure a valid public site origin.');
  }
  origin = url.origin;
}
const pages = [];
const walk = (directory, prefix) => {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
    else if (name === 'index.html') pages.push(prefix);
  }
};
walk(dist, '/');
const listed = pages.filter((page) => page !== '/turnos/');
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n${origin ? `\nSitemap: ${origin}/sitemap.xml\n` : ''}`);
const sitemap = join(dist, 'sitemap.xml');
if (origin) {
  const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  writeFileSync(sitemap, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    listed.map((page) => `  <url><loc>${escape(new URL(page, origin).href)}</loc></url>`).join('\n')}\n</urlset>\n`);
} else if (existsSync(sitemap)) rmSync(sitemap);
console.log(JSON.stringify({ indexable: origin !== null, pages: pages.length, sitemapEntries: origin ? listed.length : 0 }));
