/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationBrowserProfile } from '$lib/device';
import { formatDepositAmount, type AppointmentDepositView } from '$lib/scheduling/deposits';
import { formatInTimeZone } from '$lib/utils/format';
import Page from './+page.svelte';
import type { PatientManagementPanelData } from '$lib/scheduling/patient-management-page';

const USER_AGENT = {
	samsung:
		'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
	chrome:
		'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
	firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:153.0) Gecko/153.0 Firefox/153.0'
};

// The whole public view the load returns, so the page is checked against its real type.
const appointment = {
	id: 'appointment-1',
	token: 'public-token',
	starts_at: '2026-08-10T15:00:00.000Z',
	ends_at: '2026-08-10T15:30:00.000Z',
	status: 'reserved' as const,
	is_past: false,
	is_joint: false,
	professional_count: 1,
	calendar_action_status: 'not_offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 0,
	calendar_update_required_at: null,
	professional_name_snapshot: 'Profesional',
	service_name_snapshot: 'Consulta',
	patient_name: 'Paciente',
	deposit: null,
	deposit_transfer_details: null,
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	business: {
		id: 'business-1',
		name: 'Consultorio',
		slug: 'consultorio',
		phone: null,
		timezone: 'America/Argentina/Buenos_Aires',
		address: null,
		address_instructions: null,
		maps_link: null,
		logo_url: null,
		is_active: true,
		cancellation_policy: null,
		whatsapp_contact_phone: null
	}
};

const pageData = {
 appointment,
 management: {
  url: '/turno/public-token', revision: 'a'.repeat(64), operationId: 'a1000000-0000-4000-8000-000000000001', mode: 'overview',
  startsAt: appointment.starts_at, timezone: appointment.business.timezone, now: '2026-08-01T12:00:00Z', canCancel: true, canConfirm: true, canReschedule: true,
  date: '2026-08-02', slots: [], selectedStart: null, availabilityRevision: null, integrationRevision: null, durationMinutes: 30,
  financialTerms: null, financialSummary: {appliedAmount:'0',forfeitedAmount:'0',unresolvedAmount:'0'}, unavailableMessage: null
 } satisfies PatientManagementPanelData,
 remindersEnabled: true,
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
	calendarMessage: null,
	practiceWhatsApp: null as null | { message: string; whatsappUrl: string; whatsappWebUrl: string },
	depositWhatsApp: null as null | {
		paidNow: { message: string; whatsappUrl: string; whatsappWebUrl: string };
		payLater: { message: string; whatsappUrl: string; whatsappWebUrl: string };
	},
	rebookUrl: null as string | null
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
describe('contextual auxiliary availability', () => {
 it('says the information was saved when the patient comes back to the summary, and only then', async () => {
  const environment=installNotificationEnvironment({initialPermission:'default'});
  const { container,unmount }=render(Page,{data:{...pageData,informationSaved:true}});
  const notice=container.querySelector('[data-information-saved]');
  expect(notice).toHaveTextContent('La información quedó guardada para la profesional.');
  expect(notice).toHaveAttribute('role','status');
  await waitFor(()=>expect(notice).toHaveFocus());
  unmount();
  const plain=render(Page,{data:pageData});
  expect(plain.container.querySelector('[data-information-saved]')).not.toBeInTheDocument();
  expect(environment.requestPermission).not.toHaveBeenCalled();
 });
 it('does not configure notifications or show a dead clinical link in minimum cancellation scope', async () => {
  const environment=installNotificationEnvironment({initialPermission:'granted'});
  render(Page,{data:{...pageData,remindersEnabled:false,bookingInformationEnabled:false}});
  expect(screen.queryByRole('button',{name:/Activar.*notificacion/i})).not.toBeInTheDocument();
  expect(screen.queryByRole('link',{name:/Completar.*informaci/i})).not.toBeInTheDocument();
  await Promise.resolve(); expect(environment.postRequests()).toBe(0); expect(environment.requestPermission).not.toHaveBeenCalled();
 });
});

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

 it.each(['cancel', 'reschedule'] as const)('prioritizes the requested %s decision before auxiliary tasks', mode => {
  installNotificationEnvironment({ initialPermission: 'default' });
  render(Page, { data: { ...pageData, bookingInformationEnabled: true, management: { ...pageData.management, mode } } });
  const question = screen.getByRole('heading', { name: mode === 'cancel' ? '¿Querés cancelar este turno?' : '¿Querés reprogramar este turno?' });
  expect(question).toBeVisible();
  expect(question.compareDocumentPosition(screen.getByRole('heading', { name: /^Consultorio$/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Información para tu consulta' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Último paso/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/^Te esperamos el /)).not.toBeInTheDocument();
 });

	it.each([
		{ label: 'vencido reservado', status: 'reserved' as const, past: true },
		{ label: 'vencido confirmado', status: 'confirmed' as const, past: true },
		{ label: 'cancelado futuro', status: 'cancelled' as const, past: false }
	])('no activa avisos de un turno $label aunque el permiso ya exista', async ({ status, past }) => {
		const environment = installNotificationEnvironment({ initialPermission: 'granted', verified: true });
		render(Page, { data: { ...pageData, appointment: { ...appointment, status, is_past: past } } });
		await new Promise((resolve) => setTimeout(resolve, 50));
		window.dispatchEvent(new Event('focus'));
		environment.setVisibility('visible');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
		expect(environment.postRequests()).toBe(0);
		expect(environment.requestPermission).not.toHaveBeenCalled();
	});

	it('no vuelve a sincronizar avisos después de recibir una cancelación', async () => {
		const environment = installNotificationEnvironment({ initialPermission: 'granted', verified: true });
		const view = render(Page, { data: pageData });
		await waitFor(() => expect(environment.postRequests()).toBe(1));
		await view.rerender({ data: { ...pageData, appointment: { ...appointment, status: 'cancelled' } } });
		const registrations = vi.mocked(navigator.serviceWorker.register).mock.calls.length;
		window.dispatchEvent(new Event('focus'));
		environment.setVisibility('visible');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(environment.postRequests()).toBe(1);
		expect(navigator.serviceWorker.register).toHaveBeenCalledTimes(registrations);
	});

	it('pide permiso antes de suscribir y enviar la única prueba inicial', async () => {
		const environment = installNotificationEnvironment();
		render(Page, { data: { ...pageData, created: true } });

		expect(screen.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Último paso: activá el recordatorio' })
		).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'Volver a intentar' }));

		expect(await screen.findByText('¿Recibiste la notificación de prueba?')).toBeInTheDocument();
		expect(environment.postBodies()[0]?.testRequestKey).toMatch(/:initial$/);
		expect(environment.postBodies()[1]?.testRequestKey).toMatch(/:initial:retry1$/);
		expect(environment.postRequests()).toBe(2);
	});

	// El defecto original: Chrome resuelve `default` sin decisión (venció, la contrajo o Android lo tiene
	// apagado) y la página volvía al mismo botón, sin explicación ni alternativa.
	it('si el permiso queda sin decidir no prueba, explica y ofrece salidas, sin dejar sólo el mismo botón', async () => {
		const environment = installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		expect(environment.requestPermission).toHaveBeenCalledOnce();
		expect(environment.postRequests()).toBe(0);
		expect(await screen.findByRole('link', { name: 'Guardar en mi calendario' })).toHaveAttribute('href', '/turno/public-token/calendario.ics?p=phone');
		expect(screen.getByText(/A veces el navegador no muestra la pregunta/)).toBeInTheDocument();
		expect(screen.getByText('Prefiero recibir el aviso en este teléfono')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Preguntar de nuevo' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Activar recordatorio' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Enviar otra notificación de prueba' })).not.toBeInTheDocument();
	});

	it('mientras el navegador decide dice qué hacer, y no anuncia una prueba que todavía no existe', async () => {
		const environment = installNotificationEnvironment({ persistRequestedPermission: false });
		let answer = (_value: NotificationPermission) => {};
		environment.requestPermission.mockImplementation(() => new Promise<NotificationPermission>((resolve) => { answer = resolve; }));
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		expect(await screen.findByText('Mirá arriba de todo')).toBeInTheDocument();
		expect(screen.queryByText(/vas a recibir la notificación de prueba/)).not.toBeInTheDocument();
		answer('default');
		expect(await screen.findByRole('button', { name: 'Preguntar de nuevo' })).toBeInTheDocument();
	});

	it('mantiene visible la guía del navegador si quedó bloqueado, con salida de calendario', async () => {
		const environment = installNotificationEnvironment({
			requestedPermission: 'denied'
		});
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		expect(
			await screen.findByText('Permití los avisos de este turno en Samsung Browser')
		).toBeInTheDocument();
		expect(screen.getByText('Tocá “Sitios web y descargas”.')).toBeInTheDocument();
		expect(screen.getByText('Tocá “Notificaciones del sitio”.')).toBeInTheDocument();
		expect(screen.getByText('Tocá “Permitir o bloquear sitios web”.')).toBeInTheDocument();
		expect(screen.getByText(`Activá “${window.location.origin}”.`)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Guardar en mi calendario' })).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();
		expect(environment.postRequests()).toBe(0);
	});

	it('en Chrome muestra juntos los dos ajustes, porque arreglar uno solo no alcanza', async () => {
		const environment = installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		expect(await screen.findByText('Permití los avisos de este sitio en Chrome')).toBeInTheDocument();
		expect(screen.getByText('Tocá “Controles de sitios”.')).toBeInTheDocument();
		expect(screen.getByText(/Restablecer permisos/)).toBeInTheDocument();
		expect(screen.getByText('Permití que Chrome muestre avisos en el teléfono')).toBeInTheDocument();
		expect(screen.getByText('Activá el interruptor principal, arriba de todo.')).toBeInTheDocument();
		expect(screen.queryByText(/a la izquierda de la dirección/)).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Ya estaba activado' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Ya lo permití' })).not.toBeInTheDocument();
		expect(environment.postRequests()).toBe(0);
	});

	it('pide primero el ajuste de Android: con Chrome apagado, «Suscribirse» no hace nada', async () => {
		installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		const site = await screen.findByText('Permití los avisos de este sitio en Chrome');
		const phone = screen.getByText('Permití que Chrome muestre avisos en el teléfono');
		expect(phone.compareDocumentPosition(site) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('si restablecen un permiso concedido deja de decir que está dado y ofrece activarlo', async () => {
		const environment = installNotificationEnvironment();
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByRole('button', { name: 'Enviar otra notificación de prueba' });
		expect(screen.getByText(/El permiso está dado/)).toBeInTheDocument();

		environment.setPermission('default');
		window.dispatchEvent(new Event('focus'));

		expect(await screen.findByRole('button', { name: 'Activar recordatorio' })).toBeInTheDocument();
		expect(screen.queryByText(/El permiso está dado/)).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Enviar otra notificación de prueba' })).not.toBeInTheDocument();
	});

	it('ningún botón queda mudo: si sigue bloqueado lo dice', async () => {
		installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'Ya lo cambié' }));

		expect(await screen.findByText(/sigue bloqueando los avisos/)).toBeInTheDocument();
	});

	it('al restablecer el permiso desde Chrome la página lo nota y pide el paso siguiente', async () => {
		const environment = installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await screen.findByRole('button', { name: 'Ya lo cambié' });

		environment.setPermission('default');
		window.dispatchEvent(new Event('focus'));

		expect(await screen.findByRole('button', { name: 'Preguntar de nuevo' })).toBeInTheDocument();
		expect(screen.getByText(/ya no está bloqueado/)).toBeInTheDocument();
		expect(environment.postRequests()).toBe(0);
	});

	it('usa en Firefox los nombres y la opción observados en el teléfono', () => {
		installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.firefox)
			}
		});

		expect(screen.getByText(/tocá “Siempre” enseguida/)).toBeInTheDocument();
	});

	it('muestra la recuperación directa y exacta de Firefox tras bloquear', async () => {
		const environment = installNotificationEnvironment({ requestedPermission: 'denied' });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.firefox)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

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

	it('si la prueba no llegó no pregunta la marca: ofrece otra prueba, el ajuste y el calendario', async () => {
		installNotificationEnvironment();
		render(Page, { data: pageData });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));

		const retryButton = await screen.findByRole('button', { name: 'Enviar otra notificación de prueba' });
		expect(retryButton.className).toContain('ux-btn-primary');
		expect(screen.getByText('Permití que Samsung Browser muestre avisos en el teléfono')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Guardar en mi calendario' })).toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es de otra marca?')).not.toBeInTheDocument();
	});

	it('ofrece Google gestionado sólo si está disponible, y explica que se actualiza solo', async () => {
		installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome),
				googleCalendar: { ...pageData.googleCalendar, available: true }
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		expect(await screen.findByRole('link', { name: 'Conectar mi cuenta Google' })).toHaveAttribute('href', '/turno/public-token/google-calendar/connect');
		expect(screen.getAllByText(/si cambia lo actualizamos solos/).length).toBeGreaterThan(0);
	});

	it('sin Google gestionado no ofrece conectar la cuenta', async () => {
		installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		await screen.findByRole('link', { name: 'Guardar en mi calendario' });
		expect(screen.queryByRole('link', { name: 'Conectar mi cuenta Google' })).not.toBeInTheDocument();
	});

	it('no promete avisos exactos para un archivo de calendario', async () => {
		installNotificationEnvironment({ persistRequestedPermission: false });
		render(Page, { data: { ...pageData, notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome) } });

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));

		expect(await screen.findByText(/Cada calendario usa sus propios avisos/)).toBeInTheDocument();
		expect(screen.getByText(/hay que volver a guardarlo/)).toBeInTheDocument();
	});

	it('si ya recibe recordatorios por correo no presenta el aviso del teléfono como obligatorio', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, emailRemindersActive: true } });

		expect(screen.getByRole('heading', { name: 'Te vamos a recordar el turno por correo' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Último paso: activá el recordatorio' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Activar recordatorio' })).toBeInTheDocument();
	});

	it('muestra la pregunta al volver del calendario sin recargar la página', async () => {
		const environment = installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		const calendarLink = await screen.findByRole('link', { name: 'Guardar en mi calendario' });
		preventLinkNavigation(calendarLink);
		await fireEvent.click(calendarLink);
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
		expect(screen.queryByRole('link', { name: 'Guardar en mi calendario' })).not.toBeInTheDocument();
		const requestsBeforeAnswer = vi.mocked(fetch).mock.calls.length;
		await fireEvent.click(screen.getByRole('button', { name: 'Sí, quedó guardado' }));

		expect(
			await screen.findByRole('heading', { name: 'Turno guardado en tu calendario' })
		).toBeInTheDocument();
		expect(screen.getByText('Listo, quedó guardado')).toBeInTheDocument();
		expect(screen.getByText(/Tu calendario va a usar sus propios avisos/)).toBeInTheDocument();
		expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBeforeAnswer);
		expect(environment.postRequests()).toBe(1);
	});

	it('reabre el calendario sólo al tocar No y vuelve a preguntar al regresar', async () => {
		const environment = installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				notificationBrowser: notificationBrowserProfile(USER_AGENT.chrome)
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		const calendarLink = await screen.findByRole('link', { name: 'Guardar en mi calendario' });
		preventLinkNavigation(calendarLink);
		await fireEvent.click(calendarLink);
		environment.setVisibility('hidden');
		environment.setVisibility('visible');
		await screen.findByText('¿Pudiste guardar el turno en tu calendario?');

		const retryLink = screen.getByRole('link', { name: 'No, volver a intentarlo' });
		expect(retryLink).toHaveAttribute('href', '/turno/public-token/calendario.ics?p=phone');
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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre avisos en el teléfono');
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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre avisos en el teléfono');

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
		await screen.findByText('Permití que Samsung Browser muestre avisos en el teléfono');

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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await clickWhenEnabled(await screen.findByRole('button', { name: 'No la recibí' }));
		await screen.findByText('Permití que Samsung Browser muestre avisos en el teléfono');

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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
		await screen.findByRole('button', { name: 'Preguntar de nuevo' });
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

		await fireEvent.click(screen.getByRole('button', { name: 'Activar recordatorio' }));
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

	it('si no hay soporte ofrece el calendario y no inventa una recuperación', async () => {
		Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
		Object.defineProperty(window, 'PushManager', { configurable: true, value: undefined });
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });

		render(Page, { data: pageData });

		expect(await screen.findByText(/no puede avisarte en el teléfono/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Guardar en mi calendario' })).toBeInTheDocument();
		expect(screen.queryByText('Prefiero recibir el aviso en este teléfono')).not.toBeInTheDocument();
		expect(screen.queryByText('¿Tu teléfono es Samsung?')).not.toBeInTheDocument();
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
		expect(screen.getByRole('link', { name: 'Agregar al calendario' })).toHaveAttribute(
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

		const calendarLink = screen.getByRole('link', { name: 'Agregar al calendario' });
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
		expect(screen.queryByRole('link', { name: 'Agregar al calendario' })).not.toBeInTheDocument();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('usa pageshow al volver del calendario y reentrega el evento sólo por decisión del usuario', async () => {
		render(Page, {
			data: { ...pageData, created: true, device: 'ios' as const }
		});

		const calendarLink = screen.getByRole('link', { name: 'Agregar al calendario' });
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
		const calendarLink = screen.getByRole('link', { name: 'Agregar al calendario' });
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
		const calendarLink = screen.getByRole('link', { name: 'Agregar al calendario' });
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
		expect(screen.getByRole('link', { name: 'Agregar al calendario' })).toBeInTheDocument();
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
		// Quien conectó su cuenta Google ya no tiene el evento: el texto habla sólo del archivo.
		expect(screen.getByText(/Si guardaste el archivo en tu calendario/)).toBeInTheDocument();
		expect(screen.queryByText(/este cambio no lo quita solo/)).not.toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Acciones' })).not.toBeInTheDocument();
		expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument();
	});

	it('ofrece una reserva nueva disponible también después de una cancelación voluntaria sin seña', () => {
		render(Page, { data: { ...pageData, rebookUrl: '/reservar/consultorio', appointment: {
			...appointment, status: 'cancelled', can_confirm: false, can_cancel: false, can_request_reschedule: false
		} } });
		expect(screen.getByRole('link', { name: 'Reservar otro turno' })).toHaveAttribute('href', '/reservar/consultorio');
		expect(screen.queryByRole('link', { name: 'Cancelar turno' })).not.toBeInTheDocument();
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

			expect(screen.getByRole('link', { name: 'Cancelar turno' })).toBeInTheDocument();
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

		expect(screen.queryByRole('link', { name: 'Cancelar turno' })).not.toBeInTheDocument();
	});
});

describe('enlace sin turno', () => {
	afterEach(() => cleanup());

	it('explica que no encuentra el turno en vez de fallar al mostrar la página', () => {
		render(Page, { data: { ...pageData, appointment: null, message: 'El enlace no es válido o no está disponible.' } });
		expect(screen.getByText('No encontramos un turno asociado a este enlace.')).toBeInTheDocument();
		expect(screen.getByText('El enlace no es válido o no está disponible.')).toBeInTheDocument();
	});
});

describe('aviso al consultorio por WhatsApp', () => {
	const practiceWhatsApp = {
		message: 'Hola, soy Paciente. Reservé un turno para el lunes, 10 de agosto a las 12:00.',
		whatsappUrl: 'https://wa.me/5493421234567?text=Hola',
		whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493421234567&text=Hola'
	};
	const follows = (first: Element, second: Element) =>
		Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
	afterEach(() => cleanup());

	it('al reservar ofrece avisar al consultorio, antes del resumen de la reserva', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, created: true, practiceWhatsApp } });
		const link = screen.getByRole('link', { name: 'Avisar al consultorio por WhatsApp' });
		expect(link).toHaveAttribute('href', practiceWhatsApp.whatsappUrl);
		expect(link).toHaveAttribute('target', '_blank');
		expect(follows(link, screen.getByRole('heading', { name: 'Resumen de la reserva' }))).toBe(true);
	});

	it('en una computadora abre WhatsApp Web', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, device: 'desktop' as never, created: true, practiceWhatsApp } });
		expect(screen.getByRole('link', { name: 'Avisar al consultorio por WhatsApp' })).toHaveAttribute(
			'href',
			practiceWhatsApp.whatsappWebUrl
		);
	});

	it('al volver más tarde queda como contacto, después de los datos del turno', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, created: false, practiceWhatsApp } });
		expect(screen.queryByRole('link', { name: 'Avisar al consultorio por WhatsApp' })).toBeNull();
		const link = screen.getByRole('link', { name: 'Escribir al consultorio por WhatsApp' });
		expect(link).toHaveAttribute('href', practiceWhatsApp.whatsappUrl);
		expect(follows(screen.getByRole('heading', { name: appointment.business.name, level: 2 }), link)).toBe(true);
	});

	it('si el consultorio no habilitó su WhatsApp no muestra ningún botón', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, created: true, practiceWhatsApp: null } });
		expect(screen.queryByRole('link', { name: /al consultorio por WhatsApp/ })).toBeNull();
	});
});

describe('seña del turno', () => {
	// Vence 48 horas antes del turno: el sábado 8 de agosto a las 12:00 en la zona del consultorio.
	const pendingDeposit = {
		appointment_id: appointment.id,
		status: 'pending' as const,
		amount: 40000,
		currency: 'ARS' as const,
		request_from: '2026-08-03T03:00:00.000Z',
		due_at: '2026-08-08T15:00:00.000Z',
		auto_cancel: true,
		waived_reason: null,
		recorded_at: null,
		reminder_opened_at: null,
		expired_at: null,
		revision: 1
	};
	const link = (text: string) => ({
		message: text,
		whatsappUrl: `https://wa.me/5493421234567?text=${text}`,
		whatsappWebUrl: `https://web.whatsapp.com/send?phone=5493421234567&text=${text}`
	});
	const depositWhatsApp = { paidNow: link('comprobante'), payLater: link('despues') };
	const withDeposit = (deposit: AppointmentDepositView, overrides: Record<string, unknown> = {}) => ({
		...appointment,
		can_confirm: false,
		deposit,
		deposit_transfer_details: 'Alias natalia.frutos\nTitular: Natalia Frutos',
		...overrides
	});
	// The page and the expected text may separate words with different spaces (the amount uses a
	// non-breaking one): both are compared with single spaces.
	const plain = (text: string | null | undefined) => String(text ?? '').replace(/\s+/g, ' ').trim();
	const cardOf = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

 it('keeps the saved result first and shows the new pending deposit after rescheduling', () => {
  installNotificationEnvironment();
  render(Page, { data: { ...pageData, appointment: withDeposit(pendingDeposit), depositWhatsApp },
   form: { success: true, message: 'La reprogramación quedó registrada.' } });
  const result = screen.getByText('La reprogramación quedó registrada.', { exact: true });
  const deposit = screen.getByRole('heading', { name: 'Seña del turno' });
  expect(result.compareDocumentPosition(deposit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('Tu turno se confirma cuando el consultorio registra la seña.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ya transferí: enviar el comprobante' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Confirmo que voy' })).not.toBeInTheDocument();
 });

	it('con la seña pendiente muestra monto, vencimiento, datos y los dos caminos por WhatsApp, sin «Confirmo que voy»', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, created: true, appointment: withDeposit(pendingDeposit), depositWhatsApp } });
		const card = plain(cardOf('Seña del turno').textContent);
		const due = formatInTimeZone(pendingDeposit.due_at, appointment.business.timezone).full;
		expect(card).toContain(plain(`Para confirmar tu turno, transferí la seña de ${formatDepositAmount(40000)} antes del ${due}.`));
		expect(due).toContain('12:00');
		expect(card).toContain('el turno se cancela automáticamente y el horario se libera');
		expect(card).toContain('Alias natalia.frutos');
		expect(screen.getByRole('button', { name: 'Ya transferí: enviar el comprobante' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Voy a pagar la seña más adelante' })).toHaveAttribute(
			'href',
			depositWhatsApp.payLater.whatsappUrl
		);
		expect(screen.queryByRole('link', { name: /al consultorio por WhatsApp/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Confirmo que voy' })).toBeNull();
		expect(screen.getByText('Tu turno se confirma cuando el consultorio registra la seña.')).toBeInTheDocument();
	});

	it('en una computadora los dos caminos abren WhatsApp Web', () => {
		installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				device: 'desktop' as never,
				appointment: withDeposit({ ...pendingDeposit, patient_payment_notice_at: '2026-08-05T15:00:00.000Z' }),
				depositWhatsApp
			}
		});
		expect(screen.getByRole('link', { name: 'Enviar comprobante por WhatsApp' })).toHaveAttribute(
			'href',
			depositWhatsApp.paidNow.whatsappWebUrl
		);
		cleanup();
		render(Page, {
			data: { ...pageData, device: 'desktop' as never, appointment: withDeposit(pendingDeposit), depositWhatsApp }
		});
		expect(screen.getByRole('link', { name: 'Voy a pagar la seña más adelante' })).toHaveAttribute(
			'href',
			depositWhatsApp.payLater.whatsappWebUrl
		);
	});

	it('sin cancelación automática para este turno no la promete', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, appointment: withDeposit({ ...pendingDeposit, auto_cancel: false }), depositWhatsApp } });
		expect(plain(cardOf('Seña del turno').textContent)).not.toContain('se cancela automáticamente');
	});

	it('sin datos para transferir ni WhatsApp del consultorio igual dice cuánto y hasta cuándo', () => {
		installNotificationEnvironment();
		render(Page, {
			data: { ...pageData, appointment: withDeposit(pendingDeposit, { deposit_transfer_details: null }), depositWhatsApp: null }
		});
		const card = plain(cardOf('Seña del turno').textContent);
		expect(card).toContain(plain(formatDepositAmount(40000)));
		expect(card).not.toContain('Datos para transferir');
		expect(screen.queryByRole('link', { name: 'Ya transferí: enviar el comprobante' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Voy a pagar la seña más adelante' })).toBeNull();
		expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
	});

	it('copia los datos para transferir y lo confirma en el botón', async () => {
		installNotificationEnvironment();
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
		render(Page, { data: { ...pageData, appointment: withDeposit(pendingDeposit), depositWhatsApp } });
		await fireEvent.click(screen.getByRole('button', { name: 'Copiar datos' }));
		expect(writeText).toHaveBeenCalledWith('Alias natalia.frutos\nTitular: Natalia Frutos');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument());
	});

	it('con la seña recibida dice que el turno está confirmado y ya no muestra cómo pagar', () => {
		installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				appointment: withDeposit(
					{ ...pendingDeposit, status: 'paid', recorded_at: '2026-08-05T15:00:00.000Z' },
					{ status: 'confirmed', public_status_label: 'Confirmado' }
				)
			}
		});
		expect(screen.getByText('Recibimos tu seña. Tu turno está confirmado.')).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Seña del turno' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Confirmo que voy' })).toBeNull();
	});

	it('una seña exceptuada por el equipo tampoco pide confirmar; apagar la política conserva la confirmación habitual', () => {
		installNotificationEnvironment();
		render(Page, { data: { ...pageData, appointment: withDeposit({ ...pendingDeposit, status: 'waived', waived_reason: 'staff' }, { status: 'confirmed' }) } });
		expect(screen.queryByRole('button', { name: 'Confirmo que voy' })).toBeNull();
		cleanup();
		render(Page, { data: { ...pageData, appointment: withDeposit({ ...pendingDeposit, status: 'waived', waived_reason: 'policy_disabled' }, { can_confirm: true }) } });
		expect(screen.getByRole('button', { name: 'Confirmo que voy' })).toBeEnabled();
	});

	it('cancelado por la seña vencida explica por qué, ofrece escribir al consultorio y reservar otro turno', () => {
		installNotificationEnvironment();
		const practiceWhatsApp = link('ya-transferi');
		render(Page, {
			data: {
				...pageData,
				appointment: withDeposit(
					{ ...pendingDeposit, status: 'expired', expired_at: '2026-08-08T15:05:00.000Z' },
					{ status: 'cancelled', public_status_label: 'Cancelado', can_cancel: false, can_request_reschedule: false }
				),
				practiceWhatsApp,
				rebookUrl: '/embed/v1/0123456789abcdef0123456789abcdef'
			}
		});
		const due = formatInTimeZone(pendingDeposit.due_at, appointment.business.timezone).full;
		expect(plain(cardOf('Turno cancelado').textContent)).toContain(
			plain(`Este turno se canceló porque no se registró la seña antes del ${due}. Si ya transferiste, escribile al consultorio.`)
		);
		expect(screen.getByRole('link', { name: 'Escribir al consultorio por WhatsApp' })).toHaveAttribute(
			'href',
			practiceWhatsApp.whatsappUrl
		);
		expect(screen.getAllByRole('link', { name: /al consultorio por WhatsApp/ })).toHaveLength(1);
		expect(screen.getByRole('link', { name: 'Reservar otro turno' })).toHaveAttribute(
			'href',
			'/embed/v1/0123456789abcdef0123456789abcdef'
		);
		expect(screen.queryByRole('heading', { name: 'Seña del turno' })).toBeNull();
	});

	it('sin un lugar donde volver a reservar no muestra un enlace que no lleva a ningún lado', () => {
		installNotificationEnvironment();
		render(Page, {
			data: {
				...pageData,
				appointment: withDeposit(
					{ ...pendingDeposit, status: 'expired', expired_at: '2026-08-08T15:05:00.000Z' },
					{ status: 'cancelled', public_status_label: 'Cancelado', can_cancel: false, can_request_reschedule: false }
				),
				practiceWhatsApp: null,
				rebookUrl: null
			}
		});
		expect(screen.queryByRole('link', { name: 'Reservar otro turno' })).toBeNull();
		expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
	});
});
