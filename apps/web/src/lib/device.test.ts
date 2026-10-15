import { describe, expect, it } from 'vitest';
import {
	classifyUserAgent,
	isLikelyBotUserAgent,
	notificationBrowserProfile,
	refineDeviceClass,
	samsungAppNotificationToggleStep,
	supportsAndroidCalendarIntent,
	whatsappHrefFor
} from './device';

const UA = {
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	ipadOld:
		'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
	android:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
	androidEdge:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.0.0',
	androidOpera:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	windowsChrome:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
	whatsappPreview: 'WhatsApp/2.23.20.0',
	facebookBot: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
	samsungInternet:
		'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
	androidWebView:
		'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.0.0 Mobile Safari/537.36',
	instagramInApp:
		'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android',
	firefoxAndroid:
		'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0'
};

describe('notificationBrowserProfile', () => {
	it('identifica el navegador Android antes de Chrome embebido en su UA', () => {
		expect(notificationBrowserProfile(UA.android)).toMatchObject({
			id: 'chrome',
			label: 'Chrome',
			samsungExclusive: false
		});
		expect(notificationBrowserProfile(UA.samsungInternet)).toMatchObject({
			id: 'samsung_browser',
			label: 'Samsung Browser',
			samsungExclusive: true
		});
		expect(notificationBrowserProfile(UA.androidEdge)).toMatchObject({
			id: 'edge',
			label: 'Microsoft Edge',
			sitePermissionGuide: null
		});
		expect(notificationBrowserProfile(UA.samsungInternet).phoneNotificationGuide?.steps).toContain(
			'{{app_notification_toggle}}'
		);
		expect(notificationBrowserProfile(UA.samsungInternet).phoneNotificationGuide?.steps).toContain(
			'Tocá “Aplicaciones”.'
		);
		expect(notificationBrowserProfile(UA.samsungInternet).sitePermissionGuide?.steps).toEqual([
			'Tocá “Herramientas” en la esquina inferior derecha.',
			'Tocá “Ajustes”.',
			'Tocá “Sitios web y descargas”.',
			'Tocá “Notificaciones del sitio”.',
			'Tocá “Más opciones”.',
			'Tocá “Permitir o bloquear sitios web”.',
			'Activá {{site}}.',
			'Volvé a este turno.'
		]);
		expect(notificationBrowserProfile(UA.android).sitePermissionGuide?.steps[0]).toBe(
			'Si no ves la dirección, deslizá la página apenas hacia abajo para mostrarla.'
		);
		expect(notificationBrowserProfile(UA.android).sitePermissionGuide?.steps[1]).toBe(
			'Tocá el ícono situado a la izquierda de la dirección.'
		);
		expect(notificationBrowserProfile(UA.android).sitePermissionGuide?.steps).toContain(
			'{{app_notification_toggle}}'
		);
	});

	it('entrega una guía propia para Firefox en vez de reutilizar Chrome', () => {
		expect(notificationBrowserProfile(UA.firefoxAndroid)).toMatchObject({
			id: 'firefox',
			label: 'Firefox'
		});
		expect(notificationBrowserProfile(UA.firefoxAndroid).sitePermissionGuide?.steps).toEqual([
			'Tocá el ícono situado a la izquierda de la dirección.',
			'En “Permisos”, tocá “Bloqueado” junto a “Notificación”.',
			'Comprobá que ahora diga “Permitido”.',
			'Cerrá el panel para volver al turno.'
		]);
	});

	it('usa en Opera los nombres publicados para su menú de Android', () => {
		expect(notificationBrowserProfile(UA.androidOpera).sitePermissionGuide?.steps).toEqual([
			'Tocá el botón de Opera.',
			'Tocá “Configuración”.',
			'Bajá hasta “Privacidad”.',
			'Tocá “Configuración del sitio”.',
			'Tocá “Notificaciones”.',
			'Eliminá {{site}} de la lista.',
			'Volvé a este turno y tocá “Activar recordatorio”.',
			'Elegí “Permitir” cuando aparezca la pregunta.'
		]);
	});

	it('no confunde un WebView de una aplicación con Chrome', () => {
		expect(notificationBrowserProfile(UA.androidWebView)).toMatchObject({
			id: 'embedded',
			label: null,
			sitePermissionGuide: null
		});
		expect(notificationBrowserProfile(UA.instagramInApp)).toMatchObject({ id: 'embedded' });
	});
});

describe('samsungAppNotificationToggleStep', () => {
	it('usa la etiqueta observada en One UI sobre Android 12 o anterior', () => {
		expect(samsungAppNotificationToggleStep('11.0.0')).toBe(
			'Activá “Mostrar notificaciones”.'
		);
		expect(samsungAppNotificationToggleStep('12')).toBe('Activá “Mostrar notificaciones”.');
	});

	it('usa la etiqueta vigente desde Android 13 cuando la versión está disponible', () => {
		expect(samsungAppNotificationToggleStep('13.0.0')).toBe(
			'Activá “Permitir notificaciones”.'
		);
		expect(samsungAppNotificationToggleStep('15')).toBe('Activá “Permitir notificaciones”.');
	});

	it('no inventa un nombre de pantalla si el navegador oculta la versión', () => {
		expect(samsungAppNotificationToggleStep(null)).toBe(
			'Activá el interruptor principal de notificaciones, en la parte superior.'
		);
		expect(samsungAppNotificationToggleStep('')).toBe(
			'Activá el interruptor principal de notificaciones, en la parte superior.'
		);
	});
});

describe('classifyUserAgent', () => {
	it('clasifica iPhone y iPad como ios', () => {
		expect(classifyUserAgent(UA.iphone)).toBe('ios');
		expect(classifyUserAgent(UA.ipadOld)).toBe('ios');
	});

	it('clasifica Android', () => {
		expect(classifyUserAgent(UA.android)).toBe('android');
	});

	it('clasifica desktop (Mac, Windows)', () => {
		expect(classifyUserAgent(UA.macSafari)).toBe('desktop');
		expect(classifyUserAgent(UA.windowsChrome)).toBe('desktop');
	});

	it('desconocido ante UA vacío o raro', () => {
		expect(classifyUserAgent(null)).toBe('unknown');
		expect(classifyUserAgent('CurlClient/1.0')).toBe('unknown');
	});
});

describe('whatsappHrefFor', () => {
	const mobileUrl = 'https://wa.me/5493511234567?text=Hola';
	const desktopUrl = 'https://web.whatsapp.com/send?phone=5493511234567&text=Hola';

	it.each(['android', 'ios'] as const)('usa wa.me en %s', (device) => {
		expect(whatsappHrefFor(device, mobileUrl, desktopUrl)).toBe(mobileUrl);
	});

	it.each(['desktop', 'unknown'] as const)('abre WhatsApp Web directo en %s', (device) => {
		expect(whatsappHrefFor(device, mobileUrl, desktopUrl)).toBe(desktopUrl);
	});
});

describe('isLikelyBotUserAgent', () => {
	it('detecta previews de WhatsApp/Facebook', () => {
		expect(isLikelyBotUserAgent(UA.whatsappPreview)).toBe(true);
		expect(isLikelyBotUserAgent(UA.facebookBot)).toBe(true);
	});

	it('no marca navegadores reales', () => {
		expect(isLikelyBotUserAgent(UA.iphone)).toBe(false);
		expect(isLikelyBotUserAgent(UA.android)).toBe(false);
		expect(isLikelyBotUserAgent(UA.windowsChrome)).toBe(false);
	});

	it('UA ausente cuenta como bot (no marcar offered)', () => {
		expect(isLikelyBotUserAgent(null)).toBe(true);
	});
});

describe('supportsAndroidCalendarIntent', () => {
	it('acepta Chrome Android (incluye Custom Tabs: mismo UA) y Samsung Internet', () => {
		expect(supportsAndroidCalendarIntent(UA.android)).toBe(true);
		expect(supportsAndroidCalendarIntent(UA.samsungInternet)).toBe(true);
	});

	it('rechaza WebView embebido (wv / Version+Chrome) e Instagram in-app', () => {
		expect(supportsAndroidCalendarIntent(UA.androidWebView)).toBe(false);
		expect(supportsAndroidCalendarIntent(UA.instagramInApp)).toBe(false);
	});

	it('rechaza Firefox Android (no Chromium, sin fallback)', () => {
		expect(supportsAndroidCalendarIntent(UA.firefoxAndroid)).toBe(false);
	});

	it('rechaza todo lo que no es Android', () => {
		expect(supportsAndroidCalendarIntent(UA.iphone)).toBe(false);
		expect(supportsAndroidCalendarIntent(UA.windowsChrome)).toBe(false);
		expect(supportsAndroidCalendarIntent(null)).toBe(false);
		expect(supportsAndroidCalendarIntent('')).toBe(false);
	});
});

describe('refineDeviceClass', () => {
	it('reclasifica iPad-como-Mac usando maxTouchPoints', () => {
		expect(
			refineDeviceClass('desktop', { maxTouchPoints: 5, platform: 'MacIntel', userAgent: UA.macSafari })
		).toBe('ios');
	});

	it('mantiene desktop en una Mac real sin touch', () => {
		expect(
			refineDeviceClass('desktop', { maxTouchPoints: 0, platform: 'MacIntel', userAgent: UA.macSafari })
		).toBe('desktop');
	});

	it('no toca clasificaciones móviles', () => {
		expect(
			refineDeviceClass('android', { maxTouchPoints: 5, platform: 'Linux armv8l', userAgent: UA.android })
		).toBe('android');
	});
});
