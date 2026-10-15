// Clasificación conservadora de dispositivo para decidir qué opciones de calendario
// mostrar primero. Regla del plan: ante incertidumbre, calendario (nunca push).
// El server clasifica por User-Agent; el cliente refina el único caso invisible para
// el UA: iPad moderno que se reporta como "Macintosh" (se detecta por maxTouchPoints).

export type DeviceClass = 'ios' | 'android' | 'desktop' | 'unknown';

export type NotificationBrowserId =
	| 'samsung_browser'
	| 'chrome'
	| 'firefox'
	| 'edge'
	| 'opera'
	| 'embedded'
	| 'unknown';

export type NotificationGuide = {
	title: string;
	steps: string[];
};

export type NotificationBrowserProfile = {
	id: NotificationBrowserId;
	label: string | null;
	samsungExclusive: boolean;
	sitePermissionGuide: NotificationGuide | null;
	phoneNotificationGuide: NotificationGuide | null;
};

const chromeSitePermissionGuide = (): NotificationGuide => ({
	title: 'Permití los avisos de este turno en Chrome',
	steps: [
		'Si no ves la dirección, deslizá la página apenas hacia abajo para mostrarla.',
		'Tocá el ícono situado a la izquierda de la dirección.',
		'Tocá “Permisos”.',
		'Tocá “Notificaciones”.',
		'{{app_notification_toggle}}',
		'Volvé a este turno.'
	]
});

const phoneNotificationGuide = (label: string): NotificationGuide => ({
	title: `Permití que ${label} muestre los avisos`,
	steps: [
		'Abrí “Ajustes” en tu teléfono.',
		'Tocá “Aplicaciones”.',
		'Tocá la lupa.',
		`Escribí “${label}”.`,
		`Tocá “${label}”.`,
		'Tocá “Notificaciones”.',
		'{{app_notification_toggle}}',
		'Volvé a este turno.'
	]
});

// En Galaxy, One UI cambió el nombre del interruptor principal. Los navegadores
// Chromium reducen el User-Agent a "Android 10" incluso en otras versiones, por
// eso el cliente usa platformVersion de User-Agent Client Hints cuando existe.
// Si el navegador no lo informa, evitamos inventar una etiqueta de pantalla.
export const samsungAppNotificationToggleStep = (
	platformVersion: string | null | undefined
): string => {
	const major = Number.parseInt(platformVersion ?? '', 10);
	if (Number.isInteger(major) && major > 0 && major <= 12) {
		return 'Activá “Mostrar notificaciones”.';
	}
	if (Number.isInteger(major) && major >= 13) {
		return 'Activá “Permitir notificaciones”.';
	}
	return 'Activá el interruptor principal de notificaciones, en la parte superior.';
};

// Se conservan sólo rutas con etiquetas contrastadas en documentación vigente.
// Ante un WebView o un navegador que no podemos identificar, no se muestra una
// secuencia genérica: una indicación aproximada sería contraproducente.
export const notificationBrowserProfile = (
	userAgent: string | null | undefined
): NotificationBrowserProfile => {
	const ua = userAgent ?? '';
	if (/;\s*wv\)|FBAN|FBAV|Instagram|Line\//i.test(ua)) {
		return {
			id: 'embedded',
			label: null,
			samsungExclusive: false,
			sitePermissionGuide: null,
			phoneNotificationGuide: null
		};
	}
	if (/SamsungBrowser\//i.test(ua)) {
		return {
			id: 'samsung_browser',
			label: 'Samsung Browser',
			samsungExclusive: true,
			sitePermissionGuide: {
				title: 'Permití los avisos de este turno en Samsung Browser',
				steps: [
					'Tocá “Herramientas” en la esquina inferior derecha.',
					'Tocá “Ajustes”.',
					'Tocá “Sitios web y descargas”.',
					'Tocá “Notificaciones del sitio”.',
					'Tocá “Más opciones”.',
					'Tocá “Permitir o bloquear sitios web”.',
					'Activá {{site}}.',
					'Volvé a este turno.'
				]
			},
			phoneNotificationGuide: phoneNotificationGuide('Samsung Browser')
		};
	}
	if (/EdgA\//i.test(ua)) {
		return {
			id: 'edge',
			label: 'Microsoft Edge',
			samsungExclusive: false,
			sitePermissionGuide: null,
			phoneNotificationGuide: phoneNotificationGuide('Microsoft Edge')
		};
	}
	if (/OPR\//i.test(ua)) {
		return {
			id: 'opera',
			label: 'Opera',
			samsungExclusive: false,
			sitePermissionGuide: {
				title: 'Permití los avisos de este turno en Opera',
				steps: [
					'Tocá el botón de Opera.',
					'Tocá “Configuración”.',
					'Bajá hasta “Privacidad”.',
					'Tocá “Configuración del sitio”.',
					'Tocá “Notificaciones”.',
					'Eliminá {{site}} de la lista.',
					'Volvé a este turno y tocá “Activar recordatorio”.',
					'Elegí “Permitir” cuando aparezca la pregunta.'
				]
			},
			phoneNotificationGuide: phoneNotificationGuide('Opera')
		};
	}
	if (/Android/i.test(ua) && /Firefox\//i.test(ua)) {
		return {
			id: 'firefox',
			label: 'Firefox',
			samsungExclusive: false,
			sitePermissionGuide: {
				title: 'Permití los avisos de este turno en Firefox',
				steps: [
					'Tocá el ícono situado a la izquierda de la dirección.',
					'En “Permisos”, tocá “Bloqueado” junto a “Notificación”.',
					'Comprobá que ahora diga “Permitido”.',
					'Cerrá el panel para volver al turno.'
				]
			},
			phoneNotificationGuide: phoneNotificationGuide('Firefox')
		};
	}
	if (/Chrome\//i.test(ua)) {
		return {
			id: 'chrome',
			label: 'Chrome',
			samsungExclusive: false,
			sitePermissionGuide: chromeSitePermissionGuide(),
			phoneNotificationGuide: phoneNotificationGuide('Chrome')
		};
	}
	if (/Edg\//i.test(ua)) {
		return {
			id: 'edge',
			label: 'Microsoft Edge',
			samsungExclusive: false,
			sitePermissionGuide: null,
			phoneNotificationGuide: null
		};
	}
	if (/Firefox\//i.test(ua)) {
		return {
			id: 'firefox',
			label: 'Firefox',
			samsungExclusive: false,
			sitePermissionGuide: null,
			phoneNotificationGuide: null
		};
	}
	if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
		return {
			id: 'unknown',
			label: 'Safari',
			samsungExclusive: false,
			sitePermissionGuide: null,
			phoneNotificationGuide: null
		};
	}
	return {
		id: 'unknown',
		label: null,
		samsungExclusive: false,
		sitePermissionGuide: null,
		phoneNotificationGuide: null
	};
};

export const classifyUserAgent = (userAgent: string | null | undefined): DeviceClass => {
	if (!userAgent) return 'unknown';
	if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
	if (/Android/i.test(userAgent)) return 'android';
	if (/Macintosh|Windows NT|X11; Linux|CrOS/i.test(userAgent)) return 'desktop';
	return 'unknown';
};

// En teléfonos y tablets usamos wa.me para que el sistema abra WhatsApp. En PC
// usamos WhatsApp Web directo y evitamos su pantalla intermedia de elección.
export const whatsappHrefFor = (
	device: DeviceClass,
	whatsAppUrl: string | null,
	whatsAppWebUrl: string | null
): string | null =>
	device === 'android' || device === 'ios'
		? whatsAppUrl
		: (whatsAppWebUrl ?? whatsAppUrl);

// Previews de mensajería y crawlers fetchean el link del turno para mostrar la
// tarjeta del chat: no deben marcar el turno como "ofrecido".
export const isLikelyBotUserAgent = (userAgent: string | null | undefined): boolean => {
	if (!userAgent) return true;
	return /WhatsApp|facebookexternalhit|TelegramBot|Twitterbot|LinkedInBot|Slackbot|Discordbot|Googlebot|bingbot|bot\b|crawler|spider|preview/i.test(
		userAgent
	);
};

// FASE 12: el href "intent://" de calendario solo se emite para navegadores Android
// capaces de manejarlo CON fallback: Chromium con UI de navegador real (Chrome,
// Samsung Internet, Edge, Opera; Custom Tabs usa el Chrome del usuario, así que
// WhatsApp pasa). Quedan afuera: el WebView embebido (token "; wv)" o
// "Version/X.Y … Chrome/", típico de Instagram/Facebook y apps con WebView crudo),
// que muestra ERR_UNKNOWN_URL_SCHEME sin respetar el fallback, y los no-Chromium
// (Firefox) que ignoran el esquema. Fuera del gate, Android sigue con Google.
export const supportsAndroidCalendarIntent = (
	userAgent: string | null | undefined
): boolean => {
	if (!userAgent) return false;
	if (!/Android/i.test(userAgent)) return false;
	if (/;\s*wv\)/.test(userAgent)) return false;
	if (/\bVersion\/\d[\d.]*\s/.test(userAgent) && /Chrome\//.test(userAgent)) return false;
	if (/FBAN|FBAV|Instagram|Line\//i.test(userAgent)) return false;
	return /Chrome\/|SamsungBrowser\//.test(userAgent);
};

// Refinamiento client-side: iPadOS en modo desktop se presenta como Mac, pero una
// Mac real no tiene pantalla táctil multi-touch.
export const refineDeviceClass = (
	serverClass: DeviceClass,
	nav: Pick<Navigator, 'maxTouchPoints' | 'platform' | 'userAgent'>
): DeviceClass => {
	if (serverClass === 'desktop' && nav.maxTouchPoints > 1 && /Mac/.test(nav.platform ?? '')) {
		return 'ios';
	}
	return serverClass;
};
