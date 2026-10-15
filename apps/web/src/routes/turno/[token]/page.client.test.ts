/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationBrowserProfile } from '$lib/device';
import Page from './+page.svelte';

const USER_AGENT = {
	samsung:
		'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
	chrome:
		'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
	firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:153.0) Gecko/153.0 Firefox/153.0'
};

const appointment = {
	token: 'public-token',
	starts_at: '2026-08-10T15:00:00.000Z',
	ends_at: '2026-08-10T15:30:00.000Z',
	status: 'reserved',
	is_past: false,
	is_joint: false,
	calendar_action_status: 'not_offered',
	calendar_update_required_at: null,
	professional_name_snapshot: 'Profesional',
	service_name_snapshot: 'Consulta',
	public_status_label: 'Reservado',
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	business: {
		name: 'Consultorio',
		timezone: 'America/Argentina/Buenos_Aires',
		address: null,
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		cancellation_policy: null
	}
};

const pageData = {
	appointment,
	message: '',
	created: false,
	suggestedAction: '',
	demo: false,
	device: 'android' as const,
	isSoon: false,
	vapidPublicKey: 'AQIDBA',
	publicSiteUrl: 'https://turnos.test',
	notificationBrowser: notificationBrowserProfile(USER_AGENT.samsung),
	googleCalendar: {
		available: false,
		state: 'none' as const,
		current: false,
		reminderLabel: '24 horas y 2 horas antes'
	},
	calendarMessage: null
};

type DeliveryState = 'accepted' | 'displayed' | 'clicked' | 'missing' | 'confirmed' | 'failed';
const delivery = (state: DeliveryState, id: string) => ({
	deliveryId: id,
	state,
	kind: 'test' as const,
	createdAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 60_000).toISOString()
});

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const clickWhenEnabled = async (button: HTMLElement) => {
	await waitFor(() => expect(button).toBeEnabled());
	await fireEvent.click(button);
};

const preventLinkNavigation = (link: HTMLElement) => {
	link.addEventListener('click', (event) => event.preventDefault());
};

const installNotificationEnvironment = (options: {
	states?: DeliveryState[];
	initialPermission?: NotificationPermission;
	requestedPermission?: NotificationPermission;
	persistRequestedPermission?: boolean;
	verified?: boolean;
	postResponses?: Array<{ status: number; body: Record<string, unknown> }>;
} = {}) => {
	let visibilityState: DocumentVisibilityState = 'visible';
	let postCount = 0;
	let permission = options.initialPermission ?? 'default';
	const states = options.states ?? ['displayed'];
	const requestedPermission = options.requestedPermission ?? 'granted';
	const persistRequestedPermission = options.persistRequestedPermission ?? true;
	const actionOrder: string[] = [];
	const postBodies: Array<Record<string, unknown>> = [];
	let lastDelivery = delivery('displayed', 'delivery-0');
	const subscription = {
		options: { applicationServerKey: null },
		toJSON: () => ({
			endpoint: 'https://push.test/subscription',
			expirationTime: null,
			keys: { p256dh: 'key', auth: 'auth' }
		}),
		unsubscribe: vi.fn().mockResolvedValue(true)
	};
	const registration = {
		installing: null,
		waiting: null,
		update: vi.fn().mockResolvedValue(undefined),
		pushManager: {
			getSubscription: vi.fn().mockResolvedValue(null),
			subscribe: vi.fn().mockResolvedValue(subscription)
		}
	};
	const serviceWorker = {
		register: vi.fn().mockResolvedValue(registration),
		getRegistration: vi.fn().mockResolvedValue(undefined),
		ready: Promise.resolve(registration),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	};
	const notification = {
		get permission() {
			return permission;
		},
		requestPermission: vi.fn(async () => {
			actionOrder.push('permission-requested');
			if (persistRequestedPermission) permission = requestedPermission;
			actionOrder.push(`permission-result:${requestedPermission}`);
			return requestedPermission;
		})
	};

	Object.defineProperty(window, 'Notification', { configurable: true, value: notification });
	Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} });
	Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
	Object.defineProperty(navigator, 'permissions', {
		configurable: true,
		value: { query: vi.fn().mockRejectedValue(new Error('not implemented')) }
	});
	Object.defineProperty(navigator, 'userAgent', { configurable: true, value: USER_AGENT.samsung });
	Object.defineProperty(navigator, 'userAgentData', {
		configurable: true,
		value: {
			getHighEntropyValues: vi.fn().mockResolvedValue({ platformVersion: '14.0.0' })
		}
	});
	Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux armv8l' });
	Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibilityState
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'POST') {
				actionOrder.push(`test-post:${permission}`);
				postBodies.push(JSON.parse(String(init.body ?? '{}')));
				postCount += 1;
				const explicit = options.postResponses?.[postCount - 1];
				if (explicit) return jsonResponse(explicit.body, explicit.status);
				if (options.verified) return jsonResponse({ ok: true, verified: true, delivery: null });
				const state = states[Math.min(postCount - 1, states.length - 1)] ?? 'missing';
				lastDelivery = delivery(state, `delivery-${postCount}`);
				return jsonResponse({ ok: true, verified: false, delivery: lastDelivery });
			}
			if (init?.method === 'PATCH') {
				const visible = JSON.parse(String(init.body ?? '{}')).visible === true;
				lastDelivery = delivery(visible ? 'confirmed' : 'missing', lastDelivery.deliveryId);
				return jsonResponse({ ok: true, delivery: lastDelivery });
			}
			return jsonResponse({ ok: true, delivery: lastDelivery });
		})
	);

	return {
		setVisibility(next: DocumentVisibilityState) {
			visibilityState = next;
			document.dispatchEvent(new Event('visibilitychange'));
		},
		setPermission(next: NotificationPermission) {
			permission = next;
		},
		postRequests: () => postCount,
		postBodies: () => [...postBodies],
		actionOrder: () => [...actionOrder],
		requestPermission: notification.requestPermission
	};
};

describe('activación de notificaciones en el teléfono', () => {
	beforeEach(() => {
		window.history.replaceState({}, '', '/turno/public-token');
		sessionStorage.clear();
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('pide permiso antes de suscribir y enviar la única prueba inicial', async () => {
		const environment = installNotificationEnvironment();
		render(Page, { data: { ...pageData, created: true } });

		expect(screen.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: activá el recordatorio' })
		).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		expect(environment.actionOrder()).toEqual([
			'permission-requested',
			'permission-result:granted',
			'test-post:granted'
		]);
		expect(environment.postRequests()).toBe(1);
		expect(environment.postBodies()[0]?.test).toBe(true);
		expect(environment.postBodies()[0]?.testRequestKey).toMatch(
			/^push:[A-Za-z0-9_-]{16,120}:initial$/
		);
	});

	it('mantiene la pregunta si la prueba fue aceptada pero falta su primera lectura', async () => {
		const environment = installNotificationEnvironment({
			postResponses: [
				{
					status: 200,
					body: {
						ok: true,
						verified: false,
						deliveryId: 'delivery-accepted',
						delivery: null,
						verificationAvailable: true
					}
				}
			]
		});
		render(Page, { data: { ...pageData, created: true } });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(await screen.findByText('Notificación de prueba enviada')).toBeInTheDocument();
		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		expect(environment.postRequests()).toBe(1);
	});

	it('si el permiso ya estaba concedido se activa solo, sin pedirlo otra vez', async () => {
		const environment = installNotificationEnvironment({ initialPermission: 'granted' });
		render(Page, { data: pageData });

		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		expect(environment.requestPermission).not.toHaveBeenCalled();
		expect(environment.postRequests()).toBe(1);
	});

	it('comparte la misma clave lógica entre recargas y pestañas del mismo turno', async () => {
		const firstEnvironment = installNotificationEnvironment({ initialPermission: 'granted' });
		const first = render(Page, { data: pageData });
		await screen.findByText('¿Recibiste la notificación de prueba?');
		const firstKey = firstEnvironment.postBodies()[0]?.testRequestKey;
		first.unmount();

		const secondEnvironment = installNotificationEnvironment({ initialPermission: 'granted' });
		render(Page, { data: pageData });
		await screen.findByText('¿Recibiste la notificación de prueba?');

		expect(secondEnvironment.postBodies()[0]?.testRequestKey).toBe(firstKey);
	});

	it('reutiliza una suscripción ya verificada sin mostrar ni repetir la prueba', async () => {
		const environment = installNotificationEnvironment({
			initialPermission: 'granted',
			verified: true
		});
		render(Page, { data: pageData });

		expect(
			await screen.findByRole('heading', { name: 'Recordatorio activado' })
		).toBeInTheDocument();
		expect(screen.queryByText('¿Recibiste la notificación de prueba?')).not.toBeInTheDocument();
		expect(environment.requestPermission).not.toHaveBeenCalled();
		expect(environment.postRequests()).toBe(1);
	});

	it('trata el clic comprobado en la notificación como activación completa', async () => {
		const environment = installNotificationEnvironment({
			initialPermission: 'granted',
			states: ['clicked']
		});
		render(Page, { data: pageData });

		expect(
			await screen.findByRole('heading', { name: 'Recordatorio activado' })
		).toBeInTheDocument();
		expect(screen.queryByText('¿Recibiste la notificación de prueba?')).not.toBeInTheDocument();
		expect(environment.requestPermission).not.toHaveBeenCalled();
		expect(environment.postRequests()).toBe(1);
	});

	it('un reintento manual tras rechazo técnico usa otra clave lógica', async () => {
		const environment = installNotificationEnvironment({
			postResponses: [
				{
					status: 502,
					body: {
						ok: false,
						code: 'test_not_accepted',
						message: 'No pudimos completar la notificación de prueba en este momento.'
					}
				},
				{
					status: 200,
					body: {
						ok: true,
						verified: false,
						delivery: delivery('displayed', 'delivery-retry')
					}
				}
			]
		});
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'Volver a intentar' }));

		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		expect(environment.postBodies()[0]?.testRequestKey).toMatch(/:initial$/);
		expect(environment.postBodies()[1]?.testRequestKey).toMatch(/:initial:retry1$/);
		expect(environment.postRequests()).toBe(2);
	});

	it('si Samsung no concede el permiso efectivo, no prueba y muestra la recuperación del teléfono', async () => {
		const environment = installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(environment.requestPermission).toHaveBeenCalledOnce();
		expect(environment.postRequests()).toBe(0);
		expect(await screen.findByText('¿Tu teléfono es Samsung?')).toBeInTheDocument();
		expect(screen.getByText('Permití que Samsung Browser muestre los avisos')).toBeInTheDocument();
		expect(screen.getByText('Activá “Permitir notificaciones”.')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: '🔔 Activar recordatorio' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Enviar otra notificación de prueba' })
		).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Google Calendar/i })).not.toBeInTheDocument();
	});

	it('mantiene visible una guía propia si la persona rechazó el permiso', async () => {
		const environment = installNotificationEnvironment({
			requestedPermission: 'denied'
		});
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(
			await screen.findByText('Permití los avisos de este turno en Samsung Browser')
		).toBeInTheDocument();
		expect(screen.getByText('Tocá “Sitios web y descargas”.')).toBeInTheDocument();
		expect(screen.getByText('Tocá “Notificaciones del sitio”.')).toBeInTheDocument();
		expect(screen.getByText('Tocá “Permitir o bloquear sitios web”.')).toBeInTheDocument();
		expect(screen.getByText(`Activá “${window.location.origin}”.`)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Ya lo permití' })).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();
		expect(environment.postRequests()).toBe(0);
	});

	it('en Chrome separa en dos pasos el permiso general y el permiso del turno', async () => {
		const environment = installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(await screen.findByText('Permití que Chrome muestre los avisos')).toBeInTheDocument();
		expect(screen.getByText('Abrí “Ajustes” en tu teléfono.')).toBeInTheDocument();
		expect(screen.getByText('Tocá “Aplicaciones”.')).toBeInTheDocument();
		expect(screen.getByText('Escribí “Chrome”.')).toBeInTheDocument();
		expect(screen.getByText('Activá “Permitir notificaciones”.')).toBeInTheDocument();
		expect(screen.queryByText('Permití los avisos de este turno en Chrome')).not.toBeInTheDocument();
		expect(environment.postRequests()).toBe(0);

		await fireEvent.click(screen.getByRole('button', { name: 'Ya estaba activado' }));
		expect(await screen.findByText('Permití los avisos de este turno en Chrome')).toBeInTheDocument();
		expect(screen.getByText('Tocá el ícono situado a la izquierda de la dirección.')).toBeInTheDocument();
		expect(screen.queryByText('Permití que Chrome muestre los avisos')).not.toBeInTheDocument();
	});

	it('usa en Firefox los nombres y la opción observados en el teléfono', async () => {
		const environment = installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.firefox)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(environment.postRequests()).toBe(0);
		expect(
			await screen.findByText('Cuando aparezca la pregunta, elegí “Siempre”.')
		).toBeInTheDocument();
	});

	it('muestra la recuperación directa y exacta de Firefox tras bloquear', async () => {
		const environment = installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.firefox)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));

		expect(
			await screen.findByText('Permití los avisos de este turno en Firefox')
		).toBeInTheDocument();
		expect(
			screen.getByText('En “Permisos”, tocá “Bloqueado” junto a “Notificación”.')
		).toBeInTheDocument();
		expect(screen.getByText('Comprobá que ahora diga “Permitido”.')).toBeInTheDocument();
		expect(screen.getByText('Cerrá el panel para volver al turno.')).toBeInTheDocument();
		expect(screen.queryByText(/Permisos del sitio|Excepciones|Eliminar permiso/)).not.toBeInTheDocument();
		expect(environment.postRequests()).toBe(0);
	});

	it('en Samsung Browser muestra sólo la recuperación Samsung si la prueba no llegó', async () => {
		installNotificationEnvironment();
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));

		expect(await screen.findByText('¿Tu teléfono es Samsung?')).toBeInTheDocument();
		expect(screen.getByText('Permití que Samsung Browser muestre los avisos')).toBeInTheDocument();
		expect(screen.getByText('Activá “Permitir notificaciones”.')).toBeInTheDocument();
		const retryButton = screen.getByRole('button', {
			name: 'Enviar otra notificación de prueba'
		});
		const guideTitle = screen.getByText('Permití que Samsung Browser muestre los avisos');
		expect(retryButton.className).toContain('ux-btn-primary');
		expect(retryButton.className).toContain('ux-btn-cta');
		expect(
			retryButton.compareDocumentPosition(guideTitle) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			screen.queryByText('Podés volver a consultar esta guía las veces que necesites.')
		).not.toBeInTheDocument();
		expect(screen.queryByText('Cuando termines los pasos')).not.toBeInTheDocument();
		expect(screen.queryByText('Volver sólo para releer no envía otra prueba.')).not.toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es de otra marca?')).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Google Calendar/i })).not.toBeInTheDocument();
	});

	it('con Chrome da igual jerarquía a Samsung y a otra marca, sin OAuth administrado', async () => {
		installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));

		const samsung = await screen.findByText('¿Tu teléfono es Samsung?');
		const other = screen.getByText('¿Tu teléfono es de otra marca?');
		const google = screen.getByRole('link', { name: /¿Tu teléfono es de otra marca\?.*Agregar a Google Calendar/i });
		expect(google).toHaveAttribute('href', '/turno/public-token/ir/google');
		expect(samsung.closest('details')?.className).toContain('border-violet-300/30');
		expect(other.closest('a')?.className).toContain('border-violet-300/30');
		expect(screen.queryByText(/otro Android/i)).not.toBeInTheDocument();
	});

	it('muestra la pregunta al volver de Google Calendar sin recargar la página', async () => {
		const environment = installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		const googleLink = await screen.findByRole('link', {
			name: /¿Tu teléfono es de otra marca\?.*Agregar a Google Calendar/i
		});
		preventLinkNavigation(googleLink);
		await fireEvent.click(googleLink);
		expect(
			screen.queryByText('¿Pudiste guardar el turno en tu calendario?')
		).not.toBeInTheDocument();

		environment.setVisibility('hidden');
		environment.setVisibility('visible');

		expect(
			await screen.findByText('¿Pudiste guardar el turno en tu calendario?')
		).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: confirmá el calendario' })
		).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Agregar a Google Calendar/i })).not.toBeInTheDocument();
		const requestsBeforeAnswer = vi.mocked(fetch).mock.calls.length;
		await fireEvent.click(screen.getByRole('button', { name: 'Sí, quedó guardado' }));

		expect(
			await screen.findByRole('heading', { name: 'Turno guardado en tu calendario' })
		).toBeInTheDocument();
		expect(screen.getByText('Listo, quedó guardado')).toBeInTheDocument();
		expect(screen.getByText('Tu calendario podrá avisarte antes de la cita.')).toBeInTheDocument();
		expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBeforeAnswer);
		expect(environment.postRequests()).toBe(1);
	});

	it('reabre Google Calendar sólo al tocar No y vuelve a preguntar al regresar', async () => {
		const environment = installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		const googleLink = await screen.findByRole('link', { name: /Agregar a Google Calendar/i });
		preventLinkNavigation(googleLink);
		await fireEvent.click(googleLink);
		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		await screen.findByText('¿Pudiste guardar el turno en tu calendario?');

		const retryLink = screen.getByRole('link', { name: 'No, volver a intentarlo' });
		expect(retryLink).toHaveAttribute('href', '/turno/public-token/ir/google');
		preventLinkNavigation(retryLink);
		const requestsBeforeRetry = vi.mocked(fetch).mock.calls.length;
		await fireEvent.click(retryLink);
		expect(
			screen.queryByText('¿Pudiste guardar el turno en tu calendario?')
		).not.toBeInTheDocument();
		expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBeforeRetry);

		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		expect(
			await screen.findByText('¿Pudiste guardar el turno en tu calendario?')
		).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: confirmá el calendario' })
		).toBeInTheDocument();
		expect(environment.postRequests()).toBe(1);
	});

	it('volver sólo para consultar los pasos no envía nada hasta tocar la acción principal', async () => {
		const environment = installNotificationEnvironment({ states: ['displayed', 'displayed'] });
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre los avisos');
		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		window.dispatchEvent(new Event('focus'));
		window.dispatchEvent(new Event('focus'));

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(environment.postRequests()).toBe(1);
		const retryButton = screen.getByRole('button', {
			name: 'Enviar otra notificación de prueba'
		});
		await clickWhenEnabled(retryButton);

		await waitFor(() => expect(environment.postRequests()).toBe(2));
		expect(environment.postBodies()[0]?.testRequestKey).toMatch(/:initial$/);
		expect(environment.postBodies()[1]?.testRequestKey).toMatch(/:recovery$/);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(environment.postRequests()).toBe(2);
		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
	});

	it('cada nueva prueba posterior exige otro toque explícito y usa otra clave lógica', async () => {
		const environment = installNotificationEnvironment({
			states: ['displayed', 'displayed', 'displayed']
		});
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre los avisos');

		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(environment.postRequests()).toBe(1);
		await clickWhenEnabled(
			screen.getByRole('button', { name: 'Enviar otra notificación de prueba' })
		);
		await waitFor(() => expect(environment.postRequests()).toBe(2));
		expect(environment.postBodies()[1]?.testRequestKey).toMatch(/:recovery$/);
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre los avisos');

		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(environment.postRequests()).toBe(2);
		await clickWhenEnabled(
			screen.getByRole('button', { name: 'Enviar otra notificación de prueba' })
		);
		await waitFor(() => expect(environment.postRequests()).toBe(3));
		expect(environment.postBodies()[2]?.testRequestKey).toMatch(/:recovery:retry1$/);
		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
	});

	it('una recuperación rechazada no se repite por foco y requiere otro toque explícito', async () => {
		const environment = installNotificationEnvironment({
			postResponses: [
				{
					status: 200,
					body: { ok: true, verified: false, delivery: delivery('displayed', 'delivery-initial') }
				},
				{
					status: 502,
					body: {
						ok: false,
						code: 'test_not_accepted',
						message: 'No pudimos completar la notificación de prueba en este momento.'
					}
				},
				{
					status: 200,
					body: { ok: true, verified: false, delivery: delivery('displayed', 'delivery-retry') }
				}
			]
		});
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre los avisos');

		await clickWhenEnabled(
			screen.getByRole('button', { name: 'Enviar otra notificación de prueba' })
		);
		await waitFor(() => expect(environment.postRequests()).toBe(2));
		expect(environment.postBodies()[1]?.testRequestKey).toMatch(/:recovery$/);

		// Los eventos tardíos del mismo regreso no vuelven a enviar.
		window.dispatchEvent(new Event('focus'));
		window.dispatchEvent(new Event('focus'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(environment.postRequests()).toBe(2);

		// Volver a consultar la guía tampoco debe convertir el foco en un envío.
		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(environment.postRequests()).toBe(2);

		// Sólo un nuevo toque consciente permite otro intento, con otra clave lógica.
		await clickWhenEnabled(
			screen.getByRole('button', { name: 'Enviar otra notificación de prueba' })
		);
		await waitFor(() => expect(environment.postRequests()).toBe(3));
		expect(environment.postBodies()[2]?.testRequestKey).toMatch(/:recovery:retry1$/);
		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
	});

	it('si el permiso efectivo cambia a concedido conserva la activación automática', async () => {
		const environment = installNotificationEnvironment({
			persistRequestedPermission: false,
			states: ['displayed']
		});
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await screen.findByText('Permití que Samsung Browser muestre los avisos');
		expect(environment.postRequests()).toBe(0);

		environment.setPermission('granted');
		environment.setVisibility('hidden');
		environment.setVisibility('visible');

		await waitFor(() => expect(environment.postRequests()).toBe(1));
		expect(environment.postBodies()[0]?.testRequestKey).toMatch(/:initial$/);
		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
	});

	it('si el permiso cambia después de una prueba perdida, la recuperación automática usa una clave nueva', async () => {
		const environment = installNotificationEnvironment({ states: ['displayed', 'displayed'] });
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: '🔔 Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		expect(environment.postRequests()).toBe(1);

		environment.setPermission('denied');
		window.dispatchEvent(new Event('focus'));
		await screen.findByText('Permití los avisos de este turno en Samsung Browser');

		environment.setPermission('granted');
		environment.setVisibility('hidden');
		environment.setVisibility('visible');

		await waitFor(() => expect(environment.postRequests()).toBe(2));
		expect(environment.postBodies()[1]?.testRequestKey).toMatch(/:recovery$/);
		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
	});

	it('si no hay soporte conserva la regla Samsung exclusiva y no inventa una recuperación falsa', async () => {
		Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
		Object.defineProperty(window, 'PushManager', { configurable: true, value: undefined });
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });

		render(Page, { data: pageData });

		expect(
			await screen.findByText(/conservá este enlace: desde acá siempre podés consultar/i)
		).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es de otra marca?')).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Google Calendar/i })).not.toBeInTheDocument();
	});
});

describe('calendario en iPhone', () => {
	beforeEach(() => {
		window.history.replaceState({}, '', '/turno/public-token');
		sessionStorage.clear();
		localStorage.clear();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('mantiene la acción directa y no muestra el flujo del teléfono Samsung', () => {
		render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});

		expect(screen.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: activá el recordatorio' })
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: '📅 Agregar al calendario' })).toHaveAttribute(
			'href',
			'/turno/public-token/calendario.ics?p=phone'
		);
		expect(screen.queryByRole('button', { name: /activar recordatorio/i })).not.toBeInTheDocument();
		expect(screen.queryByText(/Samsung/i)).not.toBeInTheDocument();
	});

	it('pregunta al recuperar el foco desde el calendario y confirma sin escribir al servidor', async () => {
		render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});

		const calendarLink = screen.getByRole('link', { name: '📅 Agregar al calendario' });
		preventLinkNavigation(calendarLink);
		await fireEvent.click(calendarLink);
		expect(
			screen.queryByText('¿Pudiste guardar el turno en tu calendario?')
		).not.toBeInTheDocument();

		window.dispatchEvent(new Event('blur'));
		window.dispatchEvent(new Event('focus'));

		expect(
			await screen.findByText('¿Pudiste guardar el turno en tu calendario?')
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Sí, quedó guardado' }));
		expect(
			await screen.findByRole('heading', { name: 'Turno guardado en tu calendario' })
		).toBeInTheDocument();
		expect(screen.getByText('Listo, quedó guardado')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: '📅 Agregar al calendario' })).not.toBeInTheDocument();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('usa pageshow al volver del calendario y reentrega el evento sólo por decisión del usuario', async () => {
		render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});

		const calendarLink = screen.getByRole('link', { name: '📅 Agregar al calendario' });
		preventLinkNavigation(calendarLink);
		await fireEvent.click(calendarLink);
		window.dispatchEvent(new PageTransitionEvent('pagehide'));
		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

		expect(
			await screen.findByText('¿Pudiste guardar el turno en tu calendario?')
		).toBeInTheDocument();
		const retryLink = screen.getByRole('link', { name: 'No, volver a intentarlo' });
		expect(retryLink).toHaveAttribute(
			'href',
			'/turno/public-token/calendario.ics?p=phone'
		);
		preventLinkNavigation(retryLink);
		await fireEvent.click(retryLink);
		expect(
			screen.queryByText('¿Pudiste guardar el turno en tu calendario?')
		).not.toBeInTheDocument();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('recupera la pregunta al volver aunque el navegador reconstruya la página', async () => {
		const firstVisit = render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});
		const calendarLink = screen.getByRole('link', { name: '📅 Agregar al calendario' });
		preventLinkNavigation(calendarLink);
		await fireEvent.click(calendarLink);
		window.dispatchEvent(new PageTransitionEvent('pagehide'));
		firstVisit.unmount();

		render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});

		expect(
			await screen.findByText('¿Pudiste guardar el turno en tu calendario?')
		).toBeInTheDocument();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('no conserva una confirmación local después de una reprogramación', async () => {
		const firstVisit = render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});
		const calendarLink = screen.getByRole('link', { name: '📅 Agregar al calendario' });
		preventLinkNavigation(calendarLink);
		await fireEvent.click(calendarLink);
		window.dispatchEvent(new Event('blur'));
		window.dispatchEvent(new Event('focus'));
		await fireEvent.click(await screen.findByRole('button', { name: 'Sí, quedó guardado' }));
		await screen.findByRole('heading', { name: 'Turno guardado en tu calendario' });
		firstVisit.unmount();

		render(Page, {
			data: {
				...pageData,
				created: false,
				device: 'ios' as const,
				appointment: {
					...appointment,
					starts_at: '2026-08-12T18:00:00.000Z',
					ends_at: '2026-08-12T18:30:00.000Z'
				}
			}
		});

		expect(
			screen.queryByRole('heading', { name: 'Turno guardado en tu calendario' })
		).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: '📅 Agregar al calendario' })).toBeInTheDocument();
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('turno cancelado', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('informa la cancelación sin volver a ofrecer acciones', () => {
		render(Page, {
			data: {
				...pageData,
				appointment: {
					...appointment,
					status: 'cancelled',
					public_status_label: 'Cancelado',
					can_confirm: false,
					can_cancel: false,
					can_request_reschedule: false
				}
			}
		});

		expect(screen.getByRole('heading', { name: 'Turno cancelado' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Acciones' })).not.toBeInTheDocument();
		expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument();
	});
});

describe('visibilidad de cancelación por estado y fecha', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it.each(['reserved', 'confirmed', 'reschedule_requested'] as const)(
		'muestra cancelar para un turno %s activo y futuro',
		(status) => {
			render(Page, {
				data: {
					...pageData,
					appointment: {
						...appointment,
						status,
						is_past: false,
						can_cancel: true
					}
				}
			});

			expect(screen.getByText('Cancelar turno', { selector: 'summary' })).toBeInTheDocument();
		}
	);

	it('oculta cancelar cuando el turno ya expiró aunque el estado recibido sea activo', () => {
		render(Page, {
			data: {
				...pageData,
				appointment: {
					...appointment,
					is_past: true,
					can_cancel: true
				}
			}
		});

		expect(screen.queryByText('Cancelar turno', { selector: 'summary' })).not.toBeInTheDocument();
	});
});
