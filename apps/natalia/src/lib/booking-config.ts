const configuredBase = import.meta.env.PUBLIC_CITA_BASE_URL || 'https://app.cita-suite.workers.dev';
const base = new URL(configuredBase);
const local = (import.meta.env.DEV || import.meta.env.NATALIA_LOCAL_FIXTURE === 'true') && ['127.0.0.1', 'localhost'].includes(base.hostname);
if ((base.protocol !== 'https:' && !(local && base.protocol === 'http:')) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Configure a valid Cita Suite origin.');
}
const key = String(import.meta.env.PUBLIC_NATALIA_INTEGRATION_KEY || '').trim();
if (key && !/^[a-f0-9]{32}$/.test(key)) throw new Error('Configure a valid public booking integration identifier.');
if (import.meta.env.PROD && !key) throw new Error('PUBLIC_NATALIA_INTEGRATION_KEY is required to publish the site with a working booking flow.');
export const bookingConfig = {
  baseURL: base.origin,
  integrationKey: key,
  href: key ? `${base.origin}/embed/v1/${key}?color_mode=light` : '/turnos',
  configured: Boolean(key)
};
