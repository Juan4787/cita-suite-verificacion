// Service worker para avisos push de turnos y solicitudes de reseña.
// Se registra manualmente cuando el paciente toca "Recibir recordatorio" (nunca al
// cargar la página) y no cachea nada: no es una PWA, no intercepta fetch.

// La versión con acuses debe reemplazar al worker anterior sin esperar a que la
// persona cierre todas las pestañas; de lo contrario vería la prueba pero la UI no
// podría verificarla hasta una visita futura.
self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(clients.claim());
});

const normalizeDelivery = (value) => {
	if (
		!value ||
		typeof value !== 'object' ||
		typeof value.id !== 'string' ||
		typeof value.token !== 'string' ||
		typeof value.receiptUrl !== 'string'
	) {
		return null;
	}
	return { id: value.id, token: value.token, receiptUrl: value.receiptUrl };
};

const reportDeliveryStage = async (delivery, stage) => {
	if (!delivery) return false;
	try {
		const receiptUrl = new URL(delivery.receiptUrl, self.location.origin);
		if (receiptUrl.origin !== self.location.origin) return false;
		const response = await fetch(receiptUrl.href, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				deliveryId: delivery.id,
				receiptToken: delivery.token,
				stage
			}),
			credentials: 'omit',
			cache: 'no-store'
		});
		return response.ok;
	} catch {
		return false;
	}
};

self.addEventListener('push', (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = {};
	}
	const title = payload.title || 'Recordatorio de turno';
	const delivery = normalizeDelivery(payload.delivery);
	const actions = Array.isArray(payload.actions)
		? payload.actions
				.filter(
					(action) =>
						action &&
						typeof action.action === 'string' &&
						/^[A-Za-z0-9_-]{1,40}$/.test(action.action) &&
						typeof action.title === 'string' &&
						action.title.trim().length > 0
				)
				.slice(0, 2)
				.map((action) => ({
					action: action.action,
					title: action.title.trim().slice(0, 60)
				}))
		: [];
	const options = {
		body: payload.body || 'Tenés un turno próximo.',
		// El secreto queda dentro de los datos privados de la notificación, nunca en
		// la URL. Permite autenticar una interacción posterior con ese aviso concreto.
		data: { url: payload.url || '/', ...(delivery ? { delivery } : {}) },
		// El contenido es neutral (sin datos clínicos): puede aparecer en pantalla bloqueada.
		tag: payload.tag || 'turno-recordatorio',
		renotify: true,
		...(actions.length > 0 ? { actions } : {})
	};
	// `group` agrupa las notificaciones del mismo turno: antes de mostrar la nueva se
	// cierran las viejas del grupo (p.ej. el aviso de 24h con el horario anterior a una
	// reprogramación). El tag igual pisa la del mismo kind; esto cubre los kinds cruzados.
	const group = typeof payload.group === 'string' && payload.group ? payload.group : null;
	const show = async () => {
		if (group && typeof self.registration.getNotifications === 'function') {
			try {
				const shown = await self.registration.getNotifications();
				for (const notification of shown) {
					const tag = notification.tag || '';
					if (tag.indexOf(group + '-') === 0 && tag !== options.tag) notification.close();
				}
			} catch {
				// Best-effort: si no se pueden listar, se muestra igual la nueva.
			}
		}
		return self.registration.showNotification(title, options);
	};
	const handlePush = async () => {
		// Primero se intenta mostrar; la telemetría corre después y nunca retrasa el
		// aviso. Un único acuse alcanza: `displayed` también completa `received` en el
		// servidor; si showNotification falla, se registra solamente `received`.
		const [shown] = await Promise.allSettled([show()]);
		await reportDeliveryStage(delivery, shown.status === 'fulfilled' ? 'displayed' : 'received');
	};
	event.waitUntil(handlePush());
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const notificationData = event.notification.data || {};
	const delivery = normalizeDelivery(notificationData.delivery);
	const clickReceipt = reportDeliveryStage(delivery, 'clicked');
	const url = notificationData.url;
	if (!url) {
		event.waitUntil(clickReceipt);
		return;
	}
	// La URL viaja dentro del payload firmado por el servidor, pero se vuelve a
	// validar antes de entregarla al navegador. Un dato alterado nunca debe
	// convertir el clic de una notificación en una navegación externa.
	let targetUrl;
	try {
		targetUrl = new URL(url, self.location.origin);
	} catch {
		event.waitUntil(clickReceipt);
		return;
	}
	if (targetUrl.origin !== self.location.origin) {
		event.waitUntil(clickReceipt);
		return;
	}
	const navigation = clients
		.matchAll({ type: 'window', includeUncontrolled: true })
		.then((windowClients) => {
			// Algunos navegadores Android (Samsung Browser incluido) consideran
			// `navigate()` a la misma URL una navegación vacía y conservan el HTML
			// anterior. Un parámetro efímero fuerza una nueva lectura del turno al
			// servidor; la ruta pública lo ignora y siempre devuelve los datos vigentes.
			const refreshUrl = new URL(targetUrl.href);
			refreshUrl.searchParams.set('_aviso', String(Date.now()));
			for (const client of windowClients) {
				let clientUrl;
				try {
					clientUrl = new URL(client.url);
				} catch {
					continue;
				}
				if (
					clientUrl.origin === targetUrl.origin &&
					clientUrl.pathname === targetUrl.pathname &&
					'focus' in client
				) {
					// El turno puede haberse reprogramado mientras esta pestaña quedó abierta.
					// Enfocarla sin navegar deja a la vista la fecha anterior; WindowClient.navigate
					// vuelve a pedir la ruta al servidor y conserva una sola pestaña.
					if ('navigate' in client) {
						return client
							.navigate(refreshUrl.href)
							.then((navigatedClient) =>
								navigatedClient && 'focus' in navigatedClient
									? navigatedClient.focus()
									: client.focus()
							)
							.catch(() => client.focus());
					}
					return client.focus();
				}
			}
			return clients.openWindow(refreshUrl.href);
		});
	// El acuse y la navegación empiezan juntos. Una falla de red jamás impide abrir
	// el turno, y waitUntil conserva al worker vivo para completar ambos trabajos.
	event.waitUntil(Promise.allSettled([clickReceipt, navigation]).then(() => undefined));
});
