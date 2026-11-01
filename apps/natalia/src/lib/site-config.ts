// The public address search engines index. Natalia will index the site when she has her own domain
// (plan de señas y avisos, 12.16): until then every page asks not to be indexed and there is no sitemap.
// With PUBLIC_NATALIA_SITE_URL set to that domain, each page names its canonical address and the build
// writes the sitemap (scripts/write-discovery.mjs reads the same variable).
const configured = String(import.meta.env.PUBLIC_NATALIA_SITE_URL || '').trim();
let origin: string | null = null;
if (configured) {
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Configure a valid public site origin.');
  }
  origin = url.origin;
}
export const siteConfig = { origin, indexable: origin !== null };
