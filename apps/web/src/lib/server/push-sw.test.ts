import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type ServiceWorkerListeners = {
	install?: (event: any) => void;
	activate?: (event: any) => void;
	push?: (event: any) => void;
	notificationclick?: (event: any) => void;
};

let source = '';

beforeAll(async () => {
	source = await readFile(new URL('../../../static/push-sw.js', import.meta.url), 'utf8');
});

const loadWorker = (input?: {
	fetchImpl?: ReturnType<typeof vi.fn>;
	showNotification?: ReturnType<typeof vi.fn>;
	shownNotifications?: Array<{ tag?: string; close: ReturnType<typeof vi.fn> }>;
}) => {
	const listeners: ServiceWorkerListeners = {};
	const fetchMock = input?.fetchImpl ?? vi.fn().mockResolvedValue({ ok: true });
	const showNotification = input?.showNotification ?? vi.fn().mockResolvedValue(undefined);
	const shownNotifications = input?.shownNotifications ?? [];
	const clients = {
		matchAll: vi.fn().mockResolvedValue([]),
		openWindow: vi.fn().mockResolvedValue(undefined),
		claim: vi.fn().mockResolvedValue(undefined)
	};
	const skipWaiting = vi.fn().mockResolvedValue(undefined);
	const self = {
		location: { origin: 'https://turnos.example' },
		skipWaiting,
		registration: {
			getNotifications: vi.fn().mockResolvedValue(shownNotifications),
			showNotification
		},
		addEventListener: (name: keyof ServiceWorkerListeners, listener: (event: any) => void) => {
			listeners[name] = listener;
		}
	};

	vm.runInNewContext(source, {
		self,
		clients,
		fetch: fetchMock,
		URL,
		JSON,
		Promise
	});

	return { listeners, fetchMock, showNotification, clients, skipWaiting };
};

describe('push service worker', () => {
	it('activa la versión nueva sin esperar al cierre de pestañas', async () => {
		const { listeners, clients, skipWaiting } = loadWorker();
		const work: Promise<unknown>[] = [];
		listeners.install?.({ waitUntil: (promise: Promise<unknown>) => work.push(promise) });
		listeners.activate?.({ waitUntil: (promise: Promise<unknown>) => work.push(promise) });
		await Promise.all(work);

		expect(skipWaiting).toHaveBeenCalledTimes(1);
		expect(clients.claim).toHaveBeenCalledTimes(1);
	});

	it('muestra el aviso, cierra el horario viejo y confirma recibido/mostrado', async () => {
		const oldNotification = { tag: 'turno-apt-1-2h', close: vi.fn() };
		const { listeners, fetchMock, showNotification } = loadWorker({
			shownNotifications: [oldNotification]
		});
		let work: Promise<unknown> | null = null;
		listeners.push?.({
			data: {
				json: () => ({
					title: 'Turno reprogramado',
					body: 'Nuevo horario',
					url: '/turno/token',
					tag: 'turno-apt-1-24h',
					group: 'turno-apt-1',
					delivery: {
						id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
						token: 'a'.repeat(43),
						receiptUrl: '/turno/token/push/receipt'
					}
				})
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(oldNotification.close).toHaveBeenCalledTimes(1);
		expect(showNotification).toHaveBeenCalledWith('Turno reprogramado', {
			body: 'Nuevo horario',
			data: {
				url: '/turno/token',
				delivery: {
					id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
					token: 'a'.repeat(43),
					receiptUrl: '/turno/token/push/receipt'
				}
			},
			tag: 'turno-apt-1-24h',
			renotify: true
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).stage).toBe('displayed');
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://turnos.example/turno/token/push/receipt'
		);
	});

	it('una falla del acuse nunca impide mostrar la notificación', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('sin red'));
		const { listeners, showNotification } = loadWorker({ fetchImpl: fetchMock });
		let work: Promise<unknown> | null = null;
		listeners.push?.({
			data: {
				json: () => ({
					title: 'Aviso',
					delivery: {
						id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
						token: 'a'.repeat(43),
						receiptUrl: '/turno/token/push/receipt'
					}
				})
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(showNotification).toHaveBeenCalledTimes(1);
	});

	it('no informa displayed cuando el navegador rechaza showNotification', async () => {
		const showNotification = vi.fn().mockRejectedValue(new Error('permiso revocado'));
		const { listeners, fetchMock } = loadWorker({ showNotification });
		let work: Promise<unknown> | null = null;
		listeners.push?.({
			data: {
				json: () => ({
					delivery: {
						id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
						token: 'a'.repeat(43),
						receiptUrl: '/turno/token/push/receipt'
					}
				})
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).stage).toBe('received');
	});

	it('recarga y enfoca un turno ya abierto para no mostrar el horario anterior', async () => {
		const { listeners, clients, fetchMock } = loadWorker();
		const focus = vi.fn().mockResolvedValue(undefined);
		const refreshedFocus = vi.fn().mockResolvedValue(undefined);
		const navigate = vi.fn().mockResolvedValue({ focus: refreshedFocus });
		clients.matchAll.mockResolvedValue([
			{ url: 'https://turnos.example/turno/token?creado=1', focus, navigate }
		] as never);
		let work: Promise<unknown> | null = null;
		listeners.notificationclick?.({
			notification: {
				data: {
					url: '/turno/token',
					delivery: {
						id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
						token: 'a'.repeat(43),
						receiptUrl: '/turno/token/push/receipt'
					}
				},
				close: vi.fn()
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(navigate).toHaveBeenCalledTimes(1);
		const refreshUrl = new URL(navigate.mock.calls[0][0]);
		expect(refreshUrl.origin + refreshUrl.pathname).toBe(
			'https://turnos.example/turno/token'
		);
		expect(refreshUrl.searchParams.get('_aviso')).toMatch(/^\d+$/);
		expect(refreshedFocus).toHaveBeenCalledTimes(1);
		expect(focus).not.toHaveBeenCalled();
		expect(clients.openWindow).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			deliveryId: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
			receiptToken: 'a'.repeat(43),
			stage: 'clicked'
		});
	});

	it('abre el turno aunque falle el acuse del clic', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('sin red'));
		const { listeners, clients } = loadWorker({ fetchImpl: fetchMock });
		let work: Promise<unknown> | null = null;
		listeners.notificationclick?.({
			notification: {
				data: {
					url: '/turno/token',
					delivery: {
						id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
						token: 'a'.repeat(43),
						receiptUrl: '/turno/token/push/receipt'
					}
				},
				close: vi.fn()
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(clients.openWindow).toHaveBeenCalledTimes(1);
		const openedUrl = new URL(clients.openWindow.mock.calls[0][0]);
		expect(openedUrl.origin + openedUrl.pathname).toBe(
			'https://turnos.example/turno/token'
		);
		expect(openedUrl.searchParams.get('_aviso')).toMatch(/^\d+$/);
	});

	it('enfoca la pestaña existente si el navegador no puede recargarla', async () => {
		const { listeners, clients } = loadWorker();
		const focus = vi.fn().mockResolvedValue(undefined);
		const navigate = vi.fn().mockRejectedValue(new Error('navegación no disponible'));
		clients.matchAll.mockResolvedValue([
			{ url: 'https://turnos.example/turno/token', focus, navigate }
		] as never);
		let work: Promise<unknown> | null = null;
		listeners.notificationclick?.({
			notification: {
				data: { url: '/turno/token' },
				close: vi.fn()
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(navigate).toHaveBeenCalledTimes(1);
		expect(focus).toHaveBeenCalledTimes(1);
		expect(clients.openWindow).not.toHaveBeenCalled();
	});

	it('rechaza destinos externos de una notificación sin abrirlos', async () => {
		const { listeners, clients, fetchMock } = loadWorker();
		let work: Promise<unknown> | null = null;
		listeners.notificationclick?.({
			notification: {
				data: {
					url: 'https://evil.example/phishing',
					delivery: {
						id: '8ccf23d7-5ae3-4b87-9268-d40a05d9a475',
						token: 'a'.repeat(43),
						receiptUrl: '/turno/token/push/receipt'
					}
				},
				close: vi.fn()
			},
			waitUntil: (promise: Promise<unknown>) => {
				work = promise;
			}
		});
		await work;

		expect(clients.matchAll).not.toHaveBeenCalled();
		expect(clients.openWindow).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			stage: 'clicked'
		});
	});
});
