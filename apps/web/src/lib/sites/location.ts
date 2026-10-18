// Resolución del link "Cómo llegar" del consultorio.
// Prioridad: link manual de Maps válido > link generado desde la dirección > null.
// Whitelist estricta: el link lo abre el paciente; solo destinos de Google Maps.
// goo.gl/g.co quedan fuera (shortener deprecado / no exclusivo de Maps).

export const buildMapsSearchUrl = (address: string) =>
	`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;

const MAPS_ANY_PATH_HOSTS = new Set(['maps.app.goo.gl', 'maps.google.com']);
const MAPS_PREFIX_PATH_HOSTS = new Set(['google.com', 'www.google.com']);

export const isValidMapsUrl = (raw: string): boolean => {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	const host = url.hostname.toLowerCase();
	if (MAPS_ANY_PATH_HOSTS.has(host)) return true;
	if (MAPS_PREFIX_PATH_HOSTS.has(host)) return url.pathname.startsWith('/maps');
	return false;
};

export type BusinessLocation = {
	address: string | null;
	maps_url?: string | null;
};

export const resolveMapsUrl = (business: BusinessLocation): string | null => {
	const manual = business.maps_url?.trim();
	if (manual && isValidMapsUrl(manual)) return manual;
	const address = business.address?.trim();
	if (address) return buildMapsSearchUrl(address);
	return null;
};
