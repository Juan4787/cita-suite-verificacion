<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
 import {formatQuotedPrice} from '$lib/booking/pricing';
	import { enhance } from '$app/forms';
	import BookingAppearance from '$lib/booking/BookingAppearance.svelte';
	import { BOOKING_MODALITY_LABELS, type BookingModality } from '@cita-suite/shared/booking-integration';
	import { onMount } from 'svelte';
	import { formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
	import {
		refineDeviceClass,
		samsungAppNotificationToggleStep,
		type DeviceClass,
		type NotificationBrowserProfile,
		type NotificationGuide
	} from '$lib/device';
	import type { PageData } from './$types';

	let { data, form }: {
		data: {
			appointment: PageData['appointment'];
			message: string;
			created: boolean;
			suggestedAction: string;
			demo: boolean;
			device: DeviceClass;
			isSoon: boolean;
			vapidPublicKey: string | null;
			publicSiteUrl: string;
			notificationBrowser: NotificationBrowserProfile;
			googleCalendar: {
				available: boolean;
				state:
					| 'none'
					| 'preparing'
					| 'active'
					| 'updating'
					| 'removing'
					| 'removed'
					| 'needs_reconnect'
					| 'failed';
				current: boolean;
				reminderLabel: string;
			};
			calendarMessage: string | null;
			bookingInformationEnabled?: boolean;
		};
		form?: { success?: boolean; message?: string };
	} = $props();

	const appointment = $derived(data.appointment);
	const isVirtual = $derived(appointment?.booking_context?.modality === 'video');

	// El server clasifica por User-Agent; acá solo se corrige el iPad que se
	// presenta como Mac (invisible para el UA, detectable por touch).
	let refinedDevice = $state<DeviceClass | null>(null);
	const device = $derived(refinedDevice ?? data.device);

	// En iOS el flujo es el calendario. En los demás dispositivos, el permiso sólo se
	// solicita con un toque cuando aún está sin decidir; si ya estaba concedido, el
	// alta se recupera automáticamente sin volver a interrumpir.
	type PushState =
		| 'unavailable'
		| 'unsupported'
		| 'idle'
		| 'working'
		| 'test_waiting'
		| 'test_question'
		| 'subscribed'
		| 'needs_device_check'
		| 'denied'
		| 'awaiting_permission'
		| 'error';
	// El CTA existe desde el primer HTML de Android. Al hidratar, el navegador
	// confirma si Push API está disponible y, si no lo está, pasa al calendario.
	let pushState = $state<PushState>('unavailable');
	const renderedPushState = $derived<PushState>(
		pushState === 'unavailable' && data.device === 'android'
			? data.vapidPublicKey
				? 'idle'
				: 'unsupported'
			: pushState
	);
	type PushDelivery = {
		deliveryId: string;
		state:
			| 'pending'
			| 'accepted'
			| 'received'
			| 'displayed'
			| 'clicked'
			| 'confirmed'
			| 'missing'
			| 'superseded'
			| 'failed'
			| 'expired';
		kind: 'test' | '24h' | '2h' | 'reschedule' | 'review';
		createdAt: string;
		expiresAt: string;
	};
	type PushResponse = {
		ok?: boolean;
		code?: string;
		message?: string;
		verified?: boolean;
		deliveryId?: string | null;
		delivery?: PushDelivery | null;
		verificationAvailable?: boolean;
	};
	type TestPhase = 'initial' | 'recovery';
	let activeTestDeliveryId = $state<string | null>(null);
	let activeTestPhase: TestPhase | null = null;
	let pushMessage = $state('');
	let pollRun = 0;
	let mounted = false;
	let notificationPermissionStatus: PermissionStatus | null = null;
	let lastObservedNotificationPermission: NotificationPermission | null = null;
	let pendingTestPhase = $state<TestPhase | null>(null);
	let returnCheckQueued = false;
	let showSamsungPhoneGuide = $state(false);
	let androidPlatformVersion = $state<string | null>(null);
	let currentSiteOrigin = $state<string | null>(null);
	type PermissionRecoveryTarget = 'phone' | 'site';
	// Chrome devuelve el mismo `denied` cuando Android bloquea los avisos de la
	// aplicación y cuando la persona bloquea sólo este sitio; la Web API no expone
	// cuál de las dos capas lo produjo. Por eso Chrome empieza por el ajuste del
	// teléfono (el recorrido siempre existe) y permite pasar, sin mezclarlos, al
	// ajuste exacto del sitio cuando el primero ya estaba activo.
	let permissionRecoveryTarget = $state<PermissionRecoveryTarget>('site');
	type DeviceCheckReason = 'test_missing' | 'permission_not_granted';
	let deviceCheckReason = $state<DeviceCheckReason>('test_missing');
	let inMemoryPushSessionId = '';
	const testRetrySequence: Record<TestPhase, number> = { initial: 0, recovery: 0 };
	const nextTestPhase = (): TestPhase =>
		deviceCheckReason === 'test_missing' && activeTestDeliveryId ? 'recovery' : 'initial';

	const base = $derived(appointment ? `/turno/${appointment.token}` : '');
	type CalendarHandoffProvider = 'google' | 'iphone';
	type CalendarHandoffStage = 'idle' | 'waiting' | 'asking' | 'saved';
	type StoredCalendarHandoff = {
		version: 1;
		provider: CalendarHandoffProvider;
		stage: Exclude<CalendarHandoffStage, 'idle'>;
		updatedAt: number;
		away: boolean;
	};
	const CALENDAR_HANDOFF_MAX_AGE_MS = 6 * 60 * 60 * 1000;
	let calendarHandoffStage = $state<CalendarHandoffStage>('idle');
	let calendarHandoffProvider = $state<CalendarHandoffProvider | null>(null);
	let calendarHandoffWasAway = false;
	let calendarHandoffRevealTimer: ReturnType<typeof setTimeout> | null = null;
	let calendarHandoffMounted = false;
	let activeCalendarHandoffStorageKey = '';
	const calendarHandoffAllowed = $derived(
		device === 'ios' || (device === 'android' && !data.notificationBrowser.samsungExclusive)
	);
	const calendarHandoffRetryHref = $derived(
		calendarHandoffProvider === 'iphone'
			? `${base}/calendario.ics?p=phone`
			: `${base}/ir/google`
	);
	const calendarHandoffStorageKey = () =>
		appointment
			? `cita-suite:calendar-handoff:${appointment.token}:${appointment.starts_at}`
			: 'cita-suite:calendar-handoff';
	const clearCalendarHandoffRevealTimer = () => {
		if (calendarHandoffRevealTimer === null) return;
		clearTimeout(calendarHandoffRevealTimer);
		calendarHandoffRevealTimer = null;
	};
	const readStoredCalendarHandoff = (): StoredCalendarHandoff | null => {
		try {
			const raw = sessionStorage.getItem(calendarHandoffStorageKey());
			if (!raw) return null;
			const stored = JSON.parse(raw) as Partial<StoredCalendarHandoff>;
			const provider = stored.provider;
			const stage = stored.stage;
			const updatedAt = stored.updatedAt;
			const validProvider = provider === 'google' || provider === 'iphone';
			const validStage = stage === 'waiting' || stage === 'asking' || stage === 'saved';
			const validTime = typeof updatedAt === 'number' && Number.isFinite(updatedAt);
			if (!validProvider || !validStage || !validTime || stored.version !== 1) {
				sessionStorage.removeItem(calendarHandoffStorageKey());
				return null;
			}
			if (
				Date.now() - updatedAt > CALENDAR_HANDOFF_MAX_AGE_MS ||
				updatedAt - Date.now() > 5 * 60 * 1000
			) {
				sessionStorage.removeItem(calendarHandoffStorageKey());
				return null;
			}
			return {
				version: 1,
				provider,
				stage,
				updatedAt,
				away: stored.away === true
			};
		} catch {
			return null;
		}
	};
	const persistCalendarHandoff = (
		stage: Exclude<CalendarHandoffStage, 'idle'>,
		provider: CalendarHandoffProvider,
		away: boolean
	) => {
		calendarHandoffStage = stage;
		calendarHandoffProvider = provider;
		try {
			const stored: StoredCalendarHandoff = {
				version: 1,
				provider,
				stage,
				updatedAt: Date.now(),
				away
			};
			sessionStorage.setItem(calendarHandoffStorageKey(), JSON.stringify(stored));
		} catch {
			// La pregunta sigue funcionando durante esta carga aunque el almacenamiento esté bloqueado.
		}
	};
	const showCalendarHandoffQuestion = () => {
		if (calendarHandoffStage !== 'waiting' || !calendarHandoffProvider) return;
		clearCalendarHandoffRevealTimer();
		calendarHandoffWasAway = false;
		persistCalendarHandoff('asking', calendarHandoffProvider, false);
	};
	const scheduleCalendarHandoffQuestion = () => {
		clearCalendarHandoffRevealTimer();
		calendarHandoffRevealTimer = setTimeout(() => {
			calendarHandoffRevealTimer = null;
			if (document.visibilityState === 'visible') showCalendarHandoffQuestion();
		}, 1500);
	};
	const beginCalendarHandoff = (provider: CalendarHandoffProvider) => {
		calendarHandoffWasAway = false;
		persistCalendarHandoff('waiting', provider, false);
		// Si el sistema abre una hoja nativa sin ocultar formalmente el navegador, la
		// pregunta queda preparada detrás y se ve al cerrar esa hoja. Una navegación
		// normal cancela este temporizador al descargar el documento.
		scheduleCalendarHandoffQuestion();
	};
	const markCalendarHandoffAway = () => {
		if (calendarHandoffStage !== 'waiting' || !calendarHandoffProvider) return;
		calendarHandoffWasAway = true;
		persistCalendarHandoff('waiting', calendarHandoffProvider, true);
	};
	const continueAfterCalendarHandoff = () => {
		if (calendarHandoffStage !== 'waiting') return;
		const stored = readStoredCalendarHandoff();
		if (calendarHandoffWasAway || stored?.away) showCalendarHandoffQuestion();
	};
	const confirmCalendarSaved = () => {
		if (calendarHandoffStage !== 'asking' || !calendarHandoffProvider) return;
		// Estado deliberadamente local: esta respuesta orienta la UI y jamás se usa
		// para incluir o excluir el turno de “Turnos para recordar”.
		persistCalendarHandoff('saved', calendarHandoffProvider, false);
	};
	const restoreCalendarHandoff = () => {
		clearCalendarHandoffRevealTimer();
		const stored = readStoredCalendarHandoff();
		if (!stored) {
			calendarHandoffStage = 'idle';
			calendarHandoffProvider = null;
			calendarHandoffWasAway = false;
			return;
		}
		calendarHandoffStage = stored.stage;
		calendarHandoffProvider = stored.provider;
		calendarHandoffWasAway = stored.away;
		if (stored.stage === 'waiting') {
			if (stored.away) queueMicrotask(showCalendarHandoffQuestion);
			else scheduleCalendarHandoffQuestion();
		}
	};

	$effect(() => {
		const nextStorageKey = calendarHandoffStorageKey();
		if (!calendarHandoffMounted || nextStorageKey === activeCalendarHandoffStorageKey) return;
		activeCalendarHandoffStorageKey = nextStorageKey;
		restoreCalendarHandoff();
	});

	onMount(() => {
		calendarHandoffMounted = true;
		activeCalendarHandoffStorageKey = calendarHandoffStorageKey();
		restoreCalendarHandoff();
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') markCalendarHandoffAway();
			else continueAfterCalendarHandoff();
		};
		const onBlur = () => markCalendarHandoffAway();
		const onFocus = () => continueAfterCalendarHandoff();
		const onPageHide = () => markCalendarHandoffAway();
		const onPageShow = (event: PageTransitionEvent) => {
			if (event.persisted) calendarHandoffWasAway = true;
			continueAfterCalendarHandoff();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('blur', onBlur);
		window.addEventListener('focus', onFocus);
		window.addEventListener('pagehide', onPageHide);
		window.addEventListener('pageshow', onPageShow);
		return () => {
			calendarHandoffMounted = false;
			clearCalendarHandoffRevealTimer();
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('blur', onBlur);
			window.removeEventListener('focus', onFocus);
			window.removeEventListener('pagehide', onPageHide);
			window.removeEventListener('pageshow', onPageShow);
		};
	});
	const siteLabel = $derived.by(() => {
		try {
			// El permiso pertenece al origen que está abierto, no necesariamente al
			// dominio canónico configurado (por ejemplo, una vista previa o un dominio
			// propio). El valor real se completa al hidratar.
			const site = new URL(currentSiteOrigin ?? data.publicSiteUrl);
			// Samsung Browser muestra el origen completo (incluye protocolo y, en
			// desarrollo, puerto) dentro de “Permitir o bloquear sitios web”.
			return data.notificationBrowser.id === 'samsung_browser' ? site.origin : site.hostname;
		} catch {
			return 'este sitio';
		}
	});
	const resolveGuide = (guide: NotificationGuide | null): NotificationGuide | null =>
		guide
			? {
					title: guide.title,
					steps: guide.steps.map((step) =>
						step
							.replaceAll('{{site}}', `“${siteLabel}”`)
							.replaceAll(
								'{{app_notification_toggle}}',
								samsungAppNotificationToggleStep(androidPlatformVersion)
							)
					)
				}
			: null;
	const sitePermissionGuide = $derived(resolveGuide(data.notificationBrowser.sitePermissionGuide));
	const phoneNotificationGuide = $derived(
		resolveGuide(data.notificationBrowser.phoneNotificationGuide)
	);
	const deniedPermissionGuide = $derived(
		permissionRecoveryTarget === 'site'
			? (sitePermissionGuide ?? phoneNotificationGuide)
			: (phoneNotificationGuide ?? sitePermissionGuide)
	);
	const permissionChoiceLabel = $derived(
		data.notificationBrowser.id === 'firefox' ? 'Siempre' : 'Permitir'
	);

	const pushSessionStorageKey = () =>
		appointment ? `cita-suite:push-session:${appointment.token}` : 'cita-suite:push-session';
	const permissionRecoveryStorageKey = () =>
		`${pushSessionStorageKey()}:permission-recovery`;
	const recoveryRetryStorageKey = () => `${pushSessionStorageKey()}:recovery-retry`;
	const rememberPermissionRecoveryTarget = (target: PermissionRecoveryTarget) => {
		permissionRecoveryTarget = target;
		try {
			localStorage.setItem(permissionRecoveryStorageKey(), target);
		} catch {
			// El estado reactivo alcanza mientras esta página permanezca abierta.
		}
	};
	const clearPermissionRecoveryTarget = () => {
		try {
			localStorage.removeItem(permissionRecoveryStorageKey());
		} catch {
			// El permiso efectivo sigue siendo la fuente de verdad.
		}
	};
	const stablePushSessionId = () => {
		if (inMemoryPushSessionId) return inMemoryPushSessionId;
		try {
			// localStorage hace que dos pestañas del mismo turno compartan la misma
			// acción lógica. Sin esto, ambas podían volver de un permiso concedido y
			// solicitar dos pruebas distintas para el mismo teléfono.
			const stored = localStorage.getItem(pushSessionStorageKey());
			if (stored && /^[A-Za-z0-9_-]{16,120}$/.test(stored)) {
				inMemoryPushSessionId = stored;
				return stored;
			}
			// Migra sin cortar una activación que hubiese empezado con una versión
			// anterior, cuando el identificador todavía vivía sólo en sessionStorage.
			const legacy = sessionStorage.getItem(pushSessionStorageKey());
			if (legacy && /^[A-Za-z0-9_-]{16,120}$/.test(legacy)) {
				localStorage.setItem(pushSessionStorageKey(), legacy);
				inMemoryPushSessionId = legacy;
				return legacy;
			}
		} catch {
			// El identificador en memoria mantiene la idempotencia durante esta carga.
		}
		const created =
			typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
		inMemoryPushSessionId = created;
		try {
			localStorage.setItem(pushSessionStorageKey(), created);
		} catch {
			// localStorage puede estar deshabilitado; el valor en memoria sigue vigente.
		}
		return created;
	};
	const retrySequenceFor = (phase: TestPhase) => {
		if (phase === 'initial') return testRetrySequence.initial;
		try {
			const stored = localStorage.getItem(recoveryRetryStorageKey());
			if (stored && /^\d{1,4}$/.test(stored)) {
				testRetrySequence.recovery = Math.max(testRetrySequence.recovery, Number(stored));
			}
		} catch {
			// El contador en memoria conserva el flujo durante esta visita.
		}
		return testRetrySequence.recovery;
	};
	const advanceTestRetrySequence = (phase: TestPhase) => {
		testRetrySequence[phase] = Math.min(9999, retrySequenceFor(phase) + 1);
		if (phase === 'recovery') {
			try {
				// Sólo las recuperaciones se persisten: evita repetir automáticamente una
				// prueba inicial al recargar, pero permite una nueva salida deliberada a Ajustes.
				localStorage.setItem(recoveryRetryStorageKey(), String(testRetrySequence.recovery));
			} catch {
				// Sin almacenamiento, la deduplicación de base de datos sigue vigente.
			}
		}
	};
	const testRequestKeyFor = (phase: TestPhase, refreshed = false) => {
		const retry = retrySequenceFor(phase);
		return `push:${stablePushSessionId()}:${phase}${refreshed ? ':refresh' : ''}${retry > 0 ? `:retry${retry}` : ''}`;
	};

	const savePushSubscriptionForAppointment = async (
		subscription: PushSubscription,
		requestTest: boolean,
		phase: TestPhase,
		refreshed = false
	) => {
		// Una cancelación recibida mientras se preparaba el dispositivo invalida el alta.
		if (!isActive || !base) return null;
		const response = await fetch(`${base}/push`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				subscription: subscription.toJSON(),
				test: requestTest,
				...(requestTest
					? { testRequestKey: testRequestKeyFor(phase, refreshed) }
					: {})
			})
		});
		let body: PushResponse = {};
		try {
			body = await response.json();
		} catch {
			body = {};
		}
		return { response, body };
	};

	const urlBase64ToUint8Array = (base64: string) => {
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
		return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
	};

	const sameApplicationServerKey = (
		actual: ArrayBuffer | null,
		expected: Uint8Array<ArrayBuffer>
	) => {
		if (!actual) return true;
		const current = new Uint8Array(actual);
		return current.length === expected.length && current.every((byte, index) => byte === expected[index]);
	};

	// Soporte real de push (se fija en onMount; nunca en iOS).
	let pushSupported = $state(false);
	const readNotificationPermission = (): NotificationPermission =>
		window.Notification.permission;
	// Candado anti-reentrada: requestPermission y visibilitychange pueden disparar el
	// alta a la vez. El upsert del backend es idempotente, pero evitamos subscribe() dobles.
	let syncing = $state(false);

	const runWithPhonePushLock = async (operation: () => Promise<void>): Promise<void> => {
		const locks = navigator.locks;
		if (!locks?.request || !appointment?.id) return operation();
		// PushManager pertenece al origen, no a una pestaña. Serializar este tramo
		// impide que dos vistas desuscriban/reemplacen el mismo endpoint a la vez.
		return locks.request(`cita-suite:push-sync:${appointment.id}`, operation);
	};

	const waitForPushWorkerActivation = async (registration: ServiceWorkerRegistration) => {
		const worker = registration.installing ?? registration.waiting;
		if (!worker || worker.state === 'activated') return;
		await new Promise<void>((resolve) => {
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				worker.removeEventListener('statechange', onStateChange);
				navigator.serviceWorker.removeEventListener('controllerchange', finish);
				resolve();
			};
			const onStateChange = () => {
				if (worker.state === 'activated' || worker.state === 'redundant') finish();
			};
			const timeout = setTimeout(finish, 5000);
			worker.addEventListener('statechange', onStateChange);
			navigator.serviceWorker.addEventListener('controllerchange', finish);
			onStateChange();
		});
	};

	const applyDelivery = (delivery: PushDelivery) => {
		activeTestDeliveryId = delivery.deliveryId;
		if (delivery.state === 'confirmed' || delivery.state === 'clicked') {
			activeTestPhase = null;
			pushState = 'subscribed';
			pushMessage = '';
			return true;
		}
		if (delivery.state === 'displayed') {
			pushState = 'test_question';
			pushMessage = '';
			return true;
		}
		if (
			delivery.state === 'missing' ||
			delivery.state === 'superseded' ||
			delivery.state === 'failed' ||
			delivery.state === 'expired'
		) {
			deviceCheckReason = 'test_missing';
			pushState = 'needs_device_check';
			pushMessage = '';
			return true;
		}
		pushState = 'test_waiting';
		return false;
	};

	const readDelivery = async (deliveryId: string) => {
		if (!base) return null;
		try {
			const response = await fetch(
				`${base}/push?delivery_id=${encodeURIComponent(deliveryId)}`,
				{ cache: 'no-store' }
			);
			if (!response.ok) return null;
			const body = (await response.json()) as PushResponse;
			return body.delivery ?? null;
		} catch {
			return null;
		}
	};

	const pollTestDelivery = async (deliveryId: string) => {
		const run = ++pollRun;
		for (let attempt = 0; attempt < 5; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (run !== pollRun || !base) return;
			try {
				const delivery = await readDelivery(deliveryId);
				if (delivery && applyDelivery(delivery)) return;
				// El recibo automático mejora la observabilidad, pero no debe retener a la
				// persona: después de unos segundos le preguntamos directamente si vio la
				// prueba, aunque Android no haya informado el evento "displayed".
				if (attempt === 4 && activeTestDeliveryId === deliveryId) {
					pushState = 'test_question';
					pushMessage = '';
					return;
				}
			} catch {
				// El sondeo es best-effort; el próximo intento puede recuperar la conexión.
			}
		}
	};

	const useSaveResult = (
		result: Awaited<ReturnType<typeof savePushSubscriptionForAppointment>>,
		requestTest: boolean,
		phase: TestPhase
	) => {
		if (!result?.response.ok) {
			// Una respuesta explícita del proveedor prueba que esta tentativa terminó.
			// El próximo toque manual usa otra clave; una pérdida de red conserva la
			// misma clave y recupera el resultado sin arriesgar un envío duplicado.
			if (
				result?.body.code === 'test_not_accepted' ||
				result?.body.code === 'subscription_expired'
			) {
				// Sólo una respuesta explícita habilita una clave nueva. Si se perdió la
				// respuesta de red, conservamos la misma y el backend recupera el intento
				// anterior sin duplicarlo. Esto vale también para una recuperación posterior.
				advanceTestRetrySequence(phase);
			}
			pushMessage = result?.body.message || 'No pudimos activar las notificaciones. Volvé a intentar.';
			return false;
		}
		if (result.body.verified) {
			activeTestDeliveryId = null;
			activeTestPhase = null;
			pushState = 'subscribed';
			pushMessage = '';
			return true;
		}
		if (result.body.delivery) {
			activeTestPhase = phase;
			const terminal = applyDelivery(result.body.delivery);
			if (!terminal) void pollTestDelivery(result.body.delivery.deliveryId);
		} else if (requestTest && result.body.deliveryId) {
			// El envío ya fue aceptado, pero la primera lectura del estado puede
			// fallar de forma transitoria. Conservamos su identificador y retomamos
			// el sondeo en vez de mostrar un falso error de activación.
			activeTestDeliveryId = result.body.deliveryId;
			activeTestPhase = phase;
			pushState = 'test_waiting';
			pushMessage = '';
			void pollTestDelivery(result.body.deliveryId);
		} else if (requestTest) {
			pushMessage = 'No pudimos comprobar la notificación de prueba.';
			return false;
		} else {
			activeTestDeliveryId = null;
			pushState = 'idle';
		}
		return true;
	};

	// Requiere el permiso YA concedido: registra el SW, suscribe (o recupera) y guarda el
	// endpoint contra el turno actual.
	const syncPushSubscription = async (
		requestTest: boolean,
		phase: TestPhase = 'initial'
	) => {
		const vapidPublicKey = data.vapidPublicKey;
		if (!isActive || !vapidPublicKey || syncing) return;
		// Defensa en profundidad: ningún caller puede registrar, suscribir ni pedir una
		// prueba hasta que el navegador refleje el permiso como efectivamente concedido.
		// No alcanza con confiar en el valor devuelto por requestPermission(): algunos
		// Android actualizan Notification.permission un instante después.
		if (typeof window.Notification === 'undefined' || readNotificationPermission() !== 'granted') {
			pushState =
				typeof window.Notification !== 'undefined' && readNotificationPermission() === 'denied'
					? 'denied'
					: 'awaiting_permission';
			pushMessage = '';
			return;
		}
		pollRun += 1;
		syncing = true;
		pendingTestPhase = requestTest ? phase : null;
		pushState = 'working';
		pushMessage = '';
		try {
			await runWithPhonePushLock(async () => {
				if (!isActive) return;
				// El permiso pudo cambiar mientras esta pestaña esperaba a otra. Se
				// comprueba de nuevo antes de tocar la suscripción compartida.
				if (readNotificationPermission() !== 'granted') {
					pushState = readNotificationPermission() === 'denied' ? 'denied' : 'awaiting_permission';
					return;
				}
				const registration = await navigator.serviceWorker.register('/push-sw.js', {
					updateViaCache: 'none'
				});
				try {
					await registration.update();
				} catch {
					// La copia activa todavía puede funcionar. El test inmediato decide el resultado.
				}
				await Promise.all([
					navigator.serviceWorker.ready,
					waitForPushWorkerActivation(registration)
				]);
				const expectedKey = urlBase64ToUint8Array(vapidPublicKey);
				let subscription = await registration.pushManager.getSubscription();
				if (
					subscription &&
					!sameApplicationServerKey(subscription.options.applicationServerKey, expectedKey)
				) {
					// Si el servidor rotó sus claves, la suscripción anterior nunca podrá recibir.
					await subscription.unsubscribe();
					subscription = null;
				}
				subscription ??= await registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: expectedKey
					});
				let result = await savePushSubscriptionForAppointment(
					subscription,
					requestTest,
					phase
				);
				if (result?.response.status === 410) {
					await subscription.unsubscribe();
					subscription = await registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
					});
					result = await savePushSubscriptionForAppointment(
						subscription,
						requestTest,
						phase,
						true
					);
				}
				if (!useSaveResult(result, requestTest, phase)) {
					pushState = phase === 'recovery' ? 'needs_device_check' : 'error';
				}
			});
		} catch {
			pushMessage ||= 'El teléfono no pudo completar la activación.';
			pushState = phase === 'recovery' ? 'needs_device_check' : 'error';
		} finally {
			syncing = false;
			pendingTestPhase = null;
			if (returnCheckQueued) {
				returnCheckQueued = false;
				queueMicrotask(continueAfterPermissionChange);
			}
		}
	};

	const enablePush = async () => {
		if (!data.vapidPublicKey || syncing) return;
		const phase = nextTestPhase();
		pushMessage = '';
		const currentPermission = readNotificationPermission();
		lastObservedNotificationPermission = currentPermission;
		if (currentPermission === 'granted') {
			await syncPushSubscription(true, phase);
			return;
		}
		if (currentPermission === 'denied') {
			pushState = 'denied';
			return;
		}
		pushState = 'working';
		try {
			await Notification.requestPermission();
			const effectivePermission = readNotificationPermission();
			lastObservedNotificationPermission = effectivePermission;
			// La propiedad efectiva es la única fuente de verdad para habilitar el envío.
			// Si todavía figura en default, el botón queda disponible para reintentar y el
			// listener de permisos continúa observando el cambio sin enviar nada antes.
			if (effectivePermission === 'granted') {
				clearPermissionRecoveryTarget();
				await syncPushSubscription(true, phase);
			} else if (effectivePermission === 'denied') {
				// Chrome no informa qué capa rechazó. Su recorrido general va primero y
				// ofrece pasar explícitamente al del sitio si ya estaba habilitado.
				rememberPermissionRecoveryTarget(
					data.notificationBrowser.id === 'chrome' && phoneNotificationGuide ? 'phone' : 'site'
				);
				pushState = 'denied';
			} else {
				// Samsung Browser conserva `default` si sus notificaciones están apagadas
				// en el teléfono, incluso después de tocar “Permitir”. No se envía ninguna
				// prueba: mostramos la ruta exacta del sistema y una acción final con gesto.
				if (data.notificationBrowser.samsungExclusive) {
					deviceCheckReason = 'permission_not_granted';
					pushState = 'needs_device_check';
				} else {
					pushState = 'awaiting_permission';
				}
			}
		} catch {
			pushMessage = 'No pudimos pedir el permiso de notificaciones. Volvé a intentar.';
			pushState = 'error';
		}
	};

	const submitTestFeedback = async (visible: boolean) => {
		if (!base || !activeTestDeliveryId || syncing) return;
		syncing = true;
		pushMessage = '';
		try {
			const response = await fetch(`${base}/push`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ deliveryId: activeTestDeliveryId, visible })
			});
			const body = (await response.json().catch(() => ({}))) as PushResponse;
			if (!response.ok || !body.delivery) {
				pushMessage = body.message || 'No pudimos guardar tu respuesta. Volvé a intentar.';
				return;
			}
			const feedbackPhase = activeTestPhase;
			applyDelivery(body.delivery);
			if (!visible) {
				if (feedbackPhase === 'recovery') advanceTestRetrySequence('recovery');
				activeTestPhase = null;
			}
		} catch {
			pushMessage = 'No pudimos guardar tu respuesta. Volvé a intentar.';
		} finally {
			syncing = false;
			if (returnCheckQueued) {
				returnCheckQueued = false;
				queueMicrotask(continueAfterPermissionChange);
			}
		}
	};

	const continueAfterPermissionChange = () => {
		if (!pushSupported) return;
		if (syncing) {
			returnCheckQueued = true;
			return;
		}
		const currentPermission = readNotificationPermission();
		const previousPermission = lastObservedNotificationPermission;
		lastObservedNotificationPermission = currentPermission;
		if (currentPermission === 'denied') {
			pushState = 'denied';
			return;
		}
		if (currentPermission === 'default') {
			clearPermissionRecoveryTarget();
			if (pushState === 'denied') pushState = 'awaiting_permission';
			return;
		}
		clearPermissionRecoveryTarget();
		// Volver a la página sólo para releer una guía no demuestra que el ajuste haya
		// cambiado. La recuperación automática se conserva exclusivamente cuando la
		// Web API pasa de default/denied a granted. Si ya era granted, una nueva prueba
		// requiere el CTA explícito que se muestra junto a los pasos.
		if (
			previousPermission !== null &&
			previousPermission !== 'granted' &&
			['awaiting_permission', 'denied', 'idle', 'needs_device_check'].includes(pushState)
		) {
			void syncPushSubscription(true, nextTestPhase());
		}
	};

	onMount(() => {
		mounted = true;
		currentSiteOrigin = window.location.origin;
		showSamsungPhoneGuide = data.notificationBrowser.samsungExclusive;
		try {
			const storedRecoveryTarget = localStorage.getItem(permissionRecoveryStorageKey());
			if (storedRecoveryTarget === 'phone' || storedRecoveryTarget === 'site') {
				permissionRecoveryTarget = storedRecoveryTarget;
			} else {
				permissionRecoveryTarget = data.notificationBrowser.id === 'chrome' ? 'phone' : 'site';
			}
		} catch {
			permissionRecoveryTarget = data.notificationBrowser.id === 'chrome' ? 'phone' : 'site';
		}
		type NavigatorWithUserAgentData = Navigator & {
			userAgentData?: {
				getHighEntropyValues: (
					hints: string[]
				) => Promise<{ platformVersion?: string }>;
			};
		};
		const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData;
		if (userAgentData) {
			void userAgentData
				.getHighEntropyValues(['platformVersion'])
				.then((values) => {
					if (mounted && typeof values.platformVersion === 'string') {
						androidPlatformVersion = values.platformVersion;
					}
				})
				.catch(() => {
					// La guía conserva una instrucción exacta sin adivinar la etiqueta.
				});
		}
		refinedDevice = refineDeviceClass(data.device, navigator);
		const effective = refinedDevice ?? data.device;
		pushSupported = Boolean(
			data.vapidPublicKey &&
				effective !== 'ios' &&
				typeof navigator.serviceWorker !== 'undefined' &&
				typeof window.PushManager !== 'undefined' &&
				typeof window.Notification !== 'undefined'
		);
		if (!pushSupported) {
			if (effective === 'android') pushState = 'unsupported';
			return;
		}

		const initialPermission = readNotificationPermission();
		lastObservedNotificationPermission = initialPermission;
		if (initialPermission === 'denied') {
			// No se reutiliza una suscripción histórica cuando el permiso actual está
			// bloqueado: eso volvería a presentar como "verificado" un teléfono incapaz
			// de mostrar avisos.
			pushState = 'denied';
		} else if (initialPermission === 'default') {
			clearPermissionRecoveryTarget();
			pushState = 'idle';
		} else {
			clearPermissionRecoveryTarget();
			// Si el permiso ya estaba concedido, no se vuelve a pedir ni se espera un
			// toque: se crea o recupera la suscripción y el servidor evita repetir una
			// prueba que ya tenga confirmación positiva o un clic real.
			void syncPushSubscription(true, 'initial');
		}

		// Núcleo del fix de UX: al volver a la pantalla (tras conceder el permiso en
		// Configuración) reconsultamos el estado REAL y activamos los avisos. También
		// recupera de un 'denied' previo si el usuario lo desbloqueó.
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') return;
			continueAfterPermissionChange();
		};
		const onFocus = () => continueAfterPermissionChange();
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('focus', onFocus);
		void navigator.permissions
			?.query({ name: 'notifications' as PermissionName })
			.then((status) => {
				if (!mounted) return;
				notificationPermissionStatus = status;
				status.addEventListener('change', continueAfterPermissionChange);
			})
			.catch(() => {
				// visibilitychange mantiene el mismo comportamiento en navegadores sin Permissions API.
			});
		return () => {
			mounted = false;
			pollRun += 1;
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('focus', onFocus);
			notificationPermissionStatus?.removeEventListener('change', continueAfterPermissionChange);
		};
	});

	const timezone = $derived(appointment?.business?.timezone ?? 'America/Argentina/Cordoba');
	const whenLabels = $derived(
		appointment ? formatInTimeZone(appointment.starts_at, timezone) : null
	);

	const isActive = $derived(
		appointment !== null && !appointment.is_past && isActiveAppointmentStatus(appointment.status)
	);
	const isCancelled = $derived(appointment?.status === 'cancelled');
	const canShowCancelAction = $derived(
		isActive && appointment?.can_cancel === true
	);
	const hasCalendarAction = $derived(
		appointment !== null &&
			['clicked_google', 'clicked_ics', 'downloaded_ics', 'clicked_outlook', 'clicked_phone_calendar', 'synced_google'].includes(
				appointment.calendar_action_status
			)
	);
	const managedGoogleCalendar = $derived(device === 'android' && data.googleCalendar.available);
	const googleCalendarIsUpdating = $derived(data.googleCalendar.state === 'updating');
	const googleCalendarIsCurrent = $derived(
		data.googleCalendar.state === 'active' && data.googleCalendar.current
	);
	const googleCalendarHasVisibleStatus = $derived(
		managedGoogleCalendar &&
			['active', 'preparing', 'updating', 'removing'].includes(data.googleCalendar.state)
	);
	const pushReminderIsActive = $derived(renderedPushState === 'subscribed');
	const calendarHandoffSaved = $derived(
		calendarHandoffAllowed && calendarHandoffStage === 'saved'
	);
	const showAndroidCalendarFallback = $derived(
		device === 'android' &&
		(
			['unsupported', 'needs_device_check'].includes(renderedPushState) ||
			(renderedPushState === 'denied' && !sitePermissionGuide) ||
			data.googleCalendar.state === 'needs_reconnect' ||
			data.googleCalendar.state === 'failed'
		)
	);
	const needsCalendarUpdate = $derived(
		Boolean(appointment?.calendar_update_required_at) &&
		!googleCalendarIsUpdating &&
		!googleCalendarIsCurrent
	);

	// FASE 12 — copy del push por proximidad, espejo de las ventanas reales del job
	// (24h y 2h): no se promete un aviso cuya ventana ya pasó.
	const pushWindowsLabel = $derived.by(() => {
		if (!appointment) return 'antes del turno';
		const hoursUntil = (new Date(appointment.starts_at).getTime() - Date.now()) / 3_600_000;
		if (hoursUntil > 24) return '24 horas y 2 horas antes del turno';
		if (hoursUntil > 2) return 'durante el día previo y 2 horas antes del turno';
		return 'en los próximos minutos';
	});

	const reminderTitle = $derived.by(() => {
		if (pushReminderIsActive || googleCalendarIsCurrent) return 'Recordatorio activado';
		if (calendarHandoffSaved) return 'Turno guardado en tu calendario';
		if (calendarHandoffAllowed && calendarHandoffStage === 'asking') {
			return 'Último paso: confirmá el calendario';
		}
		if (googleCalendarIsUpdating) return 'Actualizando tu recordatorio';
		if (data.googleCalendar.state === 'preparing') return 'Activando tu recordatorio';
		if (needsCalendarUpdate) return 'Actualizá el calendario';
		return 'Último paso: activá el recordatorio';
	});
	const reminderIntro = $derived.by(() => {
		if (pushReminderIsActive) {
			return `Este teléfono ya está listo para avisarte ${pushWindowsLabel}.`;
		}
		if (googleCalendarIsCurrent) {
			return `El turno está guardado en tu cuenta Google con avisos ${data.googleCalendar.reminderLabel}. Si cambia el horario, lo actualizamos automáticamente.`;
		}
		if (calendarHandoffSaved) return 'Tu calendario podrá avisarte antes de la cita.';
		if (calendarHandoffAllowed && calendarHandoffStage === 'asking') {
			return 'Confirmá abajo si pudiste guardar el turno.';
		}
		if (googleCalendarIsUpdating) {
			return 'Ya estamos pasando la nueva fecha y hora al mismo evento. No tenés que volver a agregarlo.';
		}
		if (data.googleCalendar.state === 'preparing') {
			return 'Estamos creando el evento con su horario y sus avisos. Esta pantalla se actualiza al volver a abrirla.';
		}
		if (data.googleCalendar.state === 'needs_reconnect') {
			return 'Elegí nuevamente tu cuenta Google para mantener el turno y sus avisos actualizados.';
		}
		if (needsCalendarUpdate) {
			return 'El turno cambió de fecha. Actualizá el calendario para conservar el horario correcto.';
		}
		if (renderedPushState === 'denied' && deniedPermissionGuide) {
			return permissionRecoveryTarget === 'phone'
				? `Para enviarte los recordatorios, necesitamos que ${data.notificationBrowser.label ?? 'la aplicación que muestra esta página'} pueda mostrar avisos en el teléfono.`
				: 'Para enviarte los recordatorios, necesitamos que permitas los avisos de este turno.';
		}
		if (renderedPushState === 'awaiting_permission') {
			return 'Para enviarte los recordatorios, necesitamos que permitas los avisos. Tocá el botón y elegí la opción indicada.';
		}
		if (renderedPushState === 'needs_device_check') {
			return deviceCheckReason === 'permission_not_granted'
				? `${data.notificationBrowser.label ?? 'La aplicación que muestra esta página'} todavía no pudo habilitar los avisos. Revisá sus notificaciones en el teléfono y completá la activación al volver.`
				: `Los avisos de este turno ya están permitidos. Ahora falta que ${data.notificationBrowser.label ?? 'la aplicación que muestra esta página'} pueda mostrarlos en el teléfono.`;
		}
		if (showAndroidCalendarFallback) {
			return renderedPushState === 'unsupported' && data.notificationBrowser.samsungExclusive
				? 'Conservá este enlace: desde acá siempre podés consultar la fecha y la hora del turno.'
				: 'Elegí la opción que corresponde a tu teléfono para terminar de guardar el recordatorio.';
		}
		if (device === 'android') {
			return 'Activá el recordatorio y comprobamos ahora mismo que este teléfono pueda avisarte.';
		}
		if (device === 'ios') {
			return 'Agregá el turno al calendario del iPhone para recibir el recordatorio.';
		}
		return isVirtual
			? 'Agregá el turno a tu calendario para recibir avisos antes y tener los datos de acceso a mano.'
			: 'Agregá el turno a tu calendario para recibir avisos antes y tener la dirección a mano.';
	});
	const calendarSummaryClass = $derived.by(() => {
		if (managedGoogleCalendar) return 'ux-btn-secondary';
		// Reprogramación: actualizar el calendario ES la tarea → CTA enfatizado.
		if (needsCalendarUpdate) return 'ux-btn-primary ux-btn-cta';
		// En Android el push es el CTA principal; el calendario queda secundario.
		if (device === 'android') return 'ux-btn-secondary';
		// En iOS no hay push: el calendario es el CTA principal → enfatizado.
		if (device === 'ios') return 'ux-btn-primary ux-btn-cta';
		return 'ux-btn-primary';
	});

	type CalendarOption = { label: string; href: string; hint?: string };
	const calendarOptions = $derived.by((): CalendarOption[] => {
		if (!appointment) return [];
		if (device === 'desktop') {
			return [
				{ label: 'Google Calendar', href: `${base}/ir/google`, hint: 'Recomendado' },
				{ label: 'Outlook', href: `${base}/ir/outlook` },
				{ label: 'Descargar calendario', href: `${base}/calendario-descargar.ics` }
			];
		}
		return [
			{ label: 'Agregar al calendario', href: `${base}/calendario.ics`, hint: 'Recomendado' },
			{ label: 'Google Calendar', href: `${base}/ir/google` }
		];
	});

	const copyDetailsText = $derived.by(() => {
		if (!appointment || !whenLabels) return '';
		const lines = [
			'Tenés un turno reservado.',
			'',
			`Fecha: ${whenLabels.dateLabel}`,
			`Hora local del consultorio: ${whenLabels.timeLabel}`,
			`${appointment.is_joint ? 'Equipo profesional' : 'Profesional'}: ${appointment.professional_name_snapshot}`,
			`Consultorio: ${appointment.business.name}`
		];
		if (appointment.business.address) lines.push(`Dirección: ${appointment.business.address}`);
		if (appointment.business.address_instructions) {
			lines.push(`Indicaciones: ${appointment.business.address_instructions}`);
		}
		if (appointment.business.maps_link) lines.push(`Cómo llegar: ${appointment.business.maps_link}`);
		lines.push(`Ver turno: ${data.publicSiteUrl}${base}`);
		return lines.join('\n');
	});

	let copied = $state(false);
	const copyDetails = async () => {
		try {
			await navigator.clipboard.writeText(copyDetailsText);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	};

</script>

{#snippet instructionList(guide: NotificationGuide)}
	<h3 class="text-lg font-bold leading-snug text-white">{guide.title}</h3>
	<ol class="mt-4 space-y-3 text-sm leading-relaxed text-white/80">
		{#each guide.steps as step, index}
			<li class="flex gap-3">
				<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/15 text-xs font-bold text-violet-200">
					{index + 1}
				</span>
				<span class="pt-0.5">{step}</span>
			</li>
		{/each}
	</ol>
{/snippet}

{#snippet pushBlock(primary: boolean)}
	{#if renderedPushState !== 'unavailable'}
		<div class="mt-5">
			{#if renderedPushState === 'subscribed'}
				<div
					class="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] px-4 py-2 text-sm font-bold text-emerald-100"
					aria-live="polite"
				>
					<svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 shrink-0">
						<path d="m5.5 10 3 3 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span>Listo para este turno</span>
				</div>
			{:else if renderedPushState === 'working'}
				<div class="ux-alert" aria-live="polite">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#a78bfa]">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-white">
								{pendingTestPhase === 'recovery' ? 'Enviando otra prueba' : 'Activando el recordatorio'}
							</p>
							<p class="mt-1">
								{pendingTestPhase === 'recovery'
									? 'En un momento vas a recibir una nueva notificación.'
									: 'En un momento vas a recibir la notificación de prueba.'}
							</p>
						</div>
					</div>
				</div>
			{:else if renderedPushState === 'test_waiting'}
				<div class="ux-alert" aria-live="polite">
					<p class="font-bold text-white">Notificación de prueba enviada</p>
					<p class="mt-1">Estamos comprobando que este teléfono pueda mostrarla…</p>
				</div>
			{:else if renderedPushState === 'test_question'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-bold text-white">¿Recibiste la notificación de prueba?</p>
					<p class="mt-1">Revisá las notificaciones del teléfono y confirmalo acá.</p>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-3">
					<button type="button" class="ux-btn-primary w-full" disabled={syncing} onclick={() => submitTestFeedback(true)}>
						Sí, la recibí
					</button>
					<button type="button" class="ux-btn-secondary w-full" disabled={syncing} onclick={() => submitTestFeedback(false)}>
						No la recibí
					</button>
				</div>
			{:else if renderedPushState === 'denied' && deniedPermissionGuide}
				<div class="rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-5" aria-live="polite">
					{@render instructionList(deniedPermissionGuide)}
					{#if permissionRecoveryTarget === 'phone' && sitePermissionGuide}
						<p class="mt-4 text-sm leading-relaxed text-white/65">
							Si “Permitir notificaciones” ya estaba activado, falta revisar el permiso de este turno.
						</p>
						<button
							type="button"
							class="ux-btn-secondary mt-4 w-full"
							onclick={() => rememberPermissionRecoveryTarget('site')}
						>
							Ya estaba activado
						</button>
					{:else}
						<button type="button" class="ux-btn-secondary mt-5 w-full" onclick={enablePush}>
							Ya lo permití
						</button>
						<p class="mt-3 text-center text-xs leading-relaxed text-white/50">
							Al volver, lo comprobamos automáticamente. El botón queda disponible por si la pantalla no se actualiza sola.
						</p>
					{/if}
				</div>
			{:else if renderedPushState === 'awaiting_permission'}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full px-3 text-cta font-bold' : 'ux-btn-secondary w-full px-3 text-cta font-bold'}
					onclick={enablePush}
				>
					<Icon name="bell" />Activar recordatorio
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/55">
					Cuando aparezca la pregunta, elegí “{permissionChoiceLabel}”.
				</p>
			{:else if renderedPushState === 'error'}
				{#if pushMessage}
					<p class="ux-alert" aria-live="polite">{pushMessage}</p>
				{/if}
				<button type="button" class="ux-btn-secondary mt-3 w-full" disabled={syncing} onclick={enablePush}>
					Volver a intentar
				</button>
			{:else if ['unsupported', 'needs_device_check', 'denied'].includes(renderedPushState)}
				{#if pushMessage}
					<p class="ux-alert" aria-live="polite">{pushMessage}</p>
				{/if}
			{:else}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full px-3 text-cta font-bold' : 'ux-btn-secondary w-full px-3 text-cta font-bold'}
					onclick={enablePush}
				>
					<Icon name="bell" />Activar recordatorio
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/45">
					Primero te pedimos permiso y después enviamos una prueba real.
				</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet googleCalendarBlock()}
	{#if managedGoogleCalendar}
		<div class="mt-5" aria-live="polite">
			{#if data.googleCalendar.state === 'active'}
				<div class="ux-alert ux-alert-success">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 text-emerald-300">
							<rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
							<path d="M7.5 3.5v3M16.5 3.5v3M4 9h16M8 14l2.2 2.2L16 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<div>
							<p class="font-bold text-white">Recordatorio guardado en tu calendario</p>
							<p class="mt-1">Avisos {data.googleCalendar.reminderLabel}. Si cambia el horario, actualizamos el mismo evento automáticamente.</p>
						</div>
					</div>
				</div>
				<details class="mt-2 rounded-2xl border border-white/10 bg-white/[0.02]">
					<summary class="cursor-pointer list-none px-4 py-3 text-center text-xs font-bold text-white/55">
						Administrar calendario
					</summary>
					<form method="POST" action="?/remove_google_calendar" class="border-t border-white/10 p-3">
						<button class="ux-btn-secondary w-full text-sm">Quitar de mi cuenta Google</button>
					</form>
				</details>
			{:else if data.googleCalendar.state === 'preparing' || data.googleCalendar.state === 'updating' || data.googleCalendar.state === 'removing'}
				<div class="ux-alert">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#a78bfa]">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-white">
								{data.googleCalendar.state === 'updating'
									? 'Actualizando fecha y hora'
									: data.googleCalendar.state === 'removing'
										? 'Quitando el evento'
										: 'Guardando el turno'}
							</p>
							<p class="mt-1">El proceso continúa automáticamente; no hace falta repetir la acción.</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet androidCalendarFallback()}
	{#if calendarHandoffStage === 'idle' && showAndroidCalendarFallback && ((renderedPushState === 'needs_device_check' && phoneNotificationGuide) || !data.notificationBrowser.samsungExclusive)}
		<div class="mt-5 space-y-4" aria-live="polite">
			{#if renderedPushState === 'needs_device_check' && phoneNotificationGuide}
				<details
					class="group overflow-hidden rounded-2xl border border-violet-300/30 bg-violet-400/[0.07] shadow-[0_12px_30px_rgba(76,29,149,0.12)]"
					bind:open={showSamsungPhoneGuide}
				>
					<summary class="flex min-h-[5.75rem] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
						<span>
							<span class="block text-base font-bold leading-snug text-white">¿Tu teléfono es Samsung?</span>
							<span class="mt-1.5 block text-sm font-bold text-violet-200">Configurar el recordatorio</span>
						</span>
						<svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5 shrink-0 text-violet-200/75 transition-transform group-open:rotate-180">
							<path d="m5.75 7.75 4.25 4.25 4.25-4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</summary>
					<div class="border-t border-violet-200/15 px-5 pb-5 pt-5">
						{#if deviceCheckReason === 'test_missing'}
							<button
								type="button"
								aria-label="Enviar otra notificación de prueba"
								class="ux-btn-primary ux-btn-cta mb-5 min-h-[4.25rem] w-full px-5 py-4 text-center text-cta font-bold leading-snug ring-2 ring-violet-300/30"
								disabled={syncing}
								onclick={enablePush}
							>
								<Icon name="bell" />
								<span>Enviar otra prueba</span>
							</button>
						{/if}
						{@render instructionList(phoneNotificationGuide)}
						{#if deviceCheckReason === 'permission_not_granted'}
							<p class="mt-4 text-xs leading-relaxed text-white/60">
								Después de activar ese ajuste, usá el botón de abajo y elegí “Permitir”.
							</p>
							<button
								type="button"
								class="ux-btn-primary ux-btn-cta mt-4 w-full px-3 text-cta font-bold"
								disabled={syncing}
								onclick={enablePush}
							>
								<Icon name="bell" />Activar recordatorio
							</button>
						{/if}
					</div>
				</details>
			{/if}

			{#if !data.notificationBrowser.samsungExclusive}
				<a
					href={`${base}/ir/google`}
					onclick={() => beginCalendarHandoff('google')}
					class="flex min-h-[5.75rem] items-center justify-between gap-4 rounded-2xl border border-violet-300/30 bg-violet-400/[0.07] px-5 py-4 shadow-[0_12px_30px_rgba(76,29,149,0.12)] transition hover:border-violet-300/45 hover:bg-violet-400/[0.1]"
				>
					<span>
						<span class="block text-base font-bold leading-snug text-white">¿Tu teléfono es de otra marca?</span>
						<span class="mt-1.5 block text-sm font-bold text-violet-200">Agregar a Google Calendar</span>
					</span>
					<svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5 shrink-0 text-violet-200/75">
						<path d="m7.75 5.75 4.25 4.25-4.25 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</a>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet calendarHandoffFeedback()}
	{#if calendarHandoffAllowed && calendarHandoffStage === 'asking'}
		<div
			class="mt-5 rounded-2xl border border-violet-300/30 bg-violet-400/[0.075] p-5 shadow-[0_16px_36px_rgba(76,29,149,0.16)]"
			aria-live="polite"
			aria-labelledby="calendar-handoff-question"
		>
			<h3 id="calendar-handoff-question" class="text-lg font-bold leading-snug text-white">
				¿Pudiste guardar el turno en tu calendario?
			</h3>
			<div class="mt-4 grid gap-3 sm:grid-cols-2">
				<button type="button" class="ux-btn-primary w-full" onclick={confirmCalendarSaved}>
					Sí, quedó guardado
				</button>
				<a
					href={calendarHandoffRetryHref}
					class="ux-btn-secondary w-full text-center"
					onclick={() => beginCalendarHandoff(calendarHandoffProvider ?? 'google')}
				>
					No, volver a intentarlo
				</a>
			</div>
		</div>
	{:else if calendarHandoffAllowed && calendarHandoffStage === 'saved'}
		<div
			class="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] px-4 py-2 text-sm font-bold text-emerald-100"
			role="status"
			aria-live="polite"
		>
			<svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 shrink-0 text-emerald-300">
				<path d="m5.5 10 3 3 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<span>Listo, quedó guardado</span>
		</div>
	{/if}
{/snippet}

{#snippet locationCard(current: NonNullable<PageData['appointment']>)}
	<section class="ux-card">
		{#if data.isSoon}
			<h2 class="ux-section-title">{isVirtual ? 'Tu turno es pronto: revisá el acceso a tu consulta' : 'Tu turno es pronto: revisá la dirección'}</h2>
		{:else}
			<h2 class="ux-section-title">{isVirtual ? 'Tu consulta virtual' : 'Dónde es'}</h2>
		{/if}
		<p class="mt-4 text-lg font-bold text-white">{isVirtual ? 'Modalidad: Virtual' : current.business.address}</p>
		{#if current.business.address_instructions}
			<p class="mt-2 text-sm text-white/70">{current.business.address_instructions}</p>
		{/if}
		{#if current.business.maps_link}
			<a href={`${base}/ir/maps`} target="_blank" rel="noreferrer" class="ux-btn-primary mt-5 block w-full text-center">
				Cómo llegar
			</a>
		{/if}
	</section>
{/snippet}

{#snippet reminderCard()}
	<section class="ux-card">
		<h2 class="text-2xl font-bold leading-tight tracking-tight text-white">
			{reminderTitle}
		</h2>
		<p class="mt-3 text-sm leading-relaxed text-white/70">{reminderIntro}</p>

		{#if device === 'android'}
			{#if googleCalendarHasVisibleStatus}
				{@render googleCalendarBlock()}
			{:else}
				{@render pushBlock(true)}
				{@render androidCalendarFallback()}
			{/if}
		{:else if device === 'ios'}
			{#if calendarHandoffStage === 'idle'}
				<a
					href={`${base}/calendario.ics?p=phone`}
					onclick={() => beginCalendarHandoff('iphone')}
					class="ux-btn-primary ux-btn-cta mt-5 flex w-full px-3 text-center text-cta font-bold"
				>
					<Icon name="calendar" />Agregar al calendario
				</a>
				<p class="mt-3 text-center text-xs leading-relaxed text-white/45">
					El evento queda preparado con la fecha, la hora y sus avisos.
				</p>
			{/if}
		{:else}
			<details class="mt-4 rounded-2xl border border-white/10 bg-white/[0.035]">
				<summary class={`${calendarSummaryClass} block w-full cursor-pointer list-none text-center`}>
					<span class="inline-flex items-center justify-center gap-2"><Icon name={needsCalendarUpdate ? 'refresh' : 'calendar'} />{needsCalendarUpdate ? 'Actualizar calendario' : 'Agregar al calendario'}</span>
				</summary>
				<div class="border-t border-white/10 p-4">
					{#if hasCalendarAction && !needsCalendarUpdate}
						<p class="ux-alert mb-4">
							Ya registramos una acción de calendario para este turno. Si lo agregás otra vez,
							podrías recibir avisos duplicados.
						</p>
					{/if}
					<div class="grid gap-3">
						{#each calendarOptions as option}
							<a href={option.href} class="ux-choice flex items-center justify-between px-5 py-4">
								<span class="font-bold text-white">{option.label}</span>
								{#if option.hint}
									<span class="ux-badge">{option.hint}</span>
								{/if}
							</a>
						{/each}
					</div>
					<p class="mt-4 text-xs text-white/45">
						El evento incluye avisos sugeridos 24 horas y 2 horas antes, {isVirtual ? 'las indicaciones de acceso' : 'la dirección'} y este enlace.
						Algunos calendarios usan tus recordatorios habituales.
					</p>
				</div>
			</details>
			{@render pushBlock(false)}
		{/if}

		{@render calendarHandoffFeedback()}

		<details class="mt-4 rounded-2xl border border-white/10 bg-white/[0.02]">
			<summary class="cursor-pointer list-none px-5 py-3 text-sm font-bold text-white/70">
				Copiar detalles del turno
			</summary>
			<div class="border-t border-white/10 p-4">
				<pre class="overflow-x-auto whitespace-pre-wrap text-sm text-white/80">{copyDetailsText}</pre>
				<button type="button" class="ux-btn-secondary mt-3 w-full" onclick={copyDetails}>
					{#if copied}<Icon name="check" class="h-4 w-4 shrink-0" />Copiado{:else}Copiar al portapapeles{/if}
				</button>
			</div>
		</details>
	</section>
{/snippet}

<BookingAppearance theme={appointment?.booking_context?.theme ?? 'cita-suite'}>
<main class="min-h-screen bg-[#06111f] px-4 py-6 text-white sm:py-10">{#if data.appointment?.price_quote_snapshot}<section class="ux-card mb-5"><h2 class="ux-section-title">Arancel registrado al reservar</h2><p class="mt-2 font-bold">{formatQuotedPrice(data.appointment.price_quote_snapshot)}</p></section>{/if}{#if data.appointment?.patient_instructions_snapshot}<section class="ux-card mb-5"><h2 class="ux-section-title">Indicaciones para tu turno</h2><p class="mt-2 whitespace-pre-wrap break-words">{data.appointment.patient_instructions_snapshot}</p></section>{/if}
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
		<section class="ux-hero">
			{#if appointment?.business?.logo_url}
				<img src={appointment.business.logo_url} alt={appointment.business.name} class="mb-5 h-16 w-16 rounded-2xl object-cover" />
			{/if}
			<h1 class="ux-title">{data.created ? 'Tu turno quedó reservado' : 'Tu turno'}</h1>
			{#if isActive && whenLabels}
				<p class="ux-subtitle">Te esperamos el {whenLabels.full}.</p>
			{:else}
				<p class="ux-subtitle">{data.message}</p>
			{/if}
			{#if form?.message}
				<p class={form.success ? 'ux-alert ux-alert-success mt-5' : 'ux-alert mt-5'}>{form.message}</p>
			{/if}
			{#if data.calendarMessage}
				<p class="ux-alert ux-alert-success mt-5">{data.calendarMessage}</p>
			{/if}
		</section>

		{#if appointment}
			{#if data.bookingInformationEnabled && isActive}
				<section class="ux-soft-card p-5"><h2 class="ux-section-title">Información para tu consulta</h2><p class="mt-2 text-white/65">Podés ampliar la información para la profesional. Los campos configurados se incorporan a tu perfil. Tu reserva se conserva.</p><a class="ux-btn-primary mt-4" href={`/turno/${appointment.token}/informacion`}>Ver y ampliar mis datos</a></section>
			{/if}
			{#if googleCalendarIsUpdating && isActive}
				<div class="ux-alert ux-alert-success">
					La nueva fecha y hora se están actualizando automáticamente en tu cuenta Google.
				</div>
			{:else if needsCalendarUpdate && isActive}
				<div class="ux-alert">
					Tu turno fue reprogramado. Actualizá el calendario para recibir el aviso correcto.
				</div>
			{/if}

			{#if data.isSoon && (appointment.business.address || isVirtual)}
				{@render locationCard(appointment)}
			{/if}

			{#if isActive}
				{@render reminderCard()}
			{/if}

			<section class="ux-card">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h2 class="text-2xl font-bold text-white">{data.created ? 'Resumen de la reserva' : appointment.business.name}</h2>
						<p class="mt-1 text-sm text-white/55">{appointment.business.name}</p>
					</div>
					<span class="ux-badge">{appointment.public_status_label}</span>
				</div>

				<div class="mt-6 grid gap-4 sm:grid-cols-2">
					{#if appointment.booking_context}
						<div class="ux-soft-card p-5 sm:col-span-2">
							<p class="text-sm font-bold text-white/55">Modalidad</p>
							<p class="mt-2 text-lg font-bold text-white">{BOOKING_MODALITY_LABELS[appointment.booking_context.modality as BookingModality]}</p>
						</div>
					{/if}
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">Servicio</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.service_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-white/55">
							{appointment.is_joint ? 'Equipo profesional' : 'Profesional'}
						</p>
						<p class="mt-2 text-lg font-bold text-white">{appointment.professional_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5 sm:col-span-2">
						<p class="text-sm font-bold text-white/55">Fecha y hora</p>
						<p class="mt-2 text-lg font-bold text-white">{formatDateTime(appointment.starts_at, timezone)}</p>
					</div>
				</div>

				{#if appointment.business.cancellation_policy}
					<p class="ux-empty mt-5">{appointment.business.cancellation_policy}</p>
				{/if}

				<a
					href={`${base}/comprobante.pdf`}
					download="comprobante-turno.pdf"
					class="ux-btn-secondary mt-6 w-full"
				>
					<Icon name="receipt" />Guardar comprobante
				</a>
			</section>

			{#if !data.isSoon && (appointment.business.address || isVirtual)}
				{@render locationCard(appointment)}
			{/if}

			{#if isCancelled}
				<section class="ux-card">
					<h2 class="ux-section-title">Turno cancelado</h2>
					{#if data.googleCalendar.state === 'removed'}
						<p class="mt-3 text-sm text-white/70">También quitamos el evento de tu cuenta Google.</p>
					{:else if data.googleCalendar.state === 'removing'}
						<p class="mt-3 text-sm text-white/70">También estamos quitando el evento de tu cuenta Google.</p>
					{:else}
						<p class="mt-3 text-sm text-white/70">
							Si lo guardaste con otra aplicación de calendario, podés eliminar esa copia desde allí.
						</p>
						<p class="mt-3 text-xs text-white/45">
							<a href={`${base}/calendario.ics`} class="underline">Abrir actualización de calendario</a>
							para calendarios compatibles.
						</p>
					{/if}
				</section>
			{/if}

			{#if !isCancelled}
				<section class="ux-card">
					<h2 class="ux-section-title">Acciones</h2>
					<div class="mt-5 grid gap-3">
						<form method="POST" action="?/confirm" use:enhance>
							<button disabled={!appointment.can_confirm} class="ux-btn-primary w-full">Confirmo que voy</button>
						</form>
						<details class="rounded-2xl border border-white/10 bg-white/[0.035]">
							<summary class="cursor-pointer list-none px-5 py-4 text-base font-bold text-white">Necesito reprogramar</summary>
							<form method="POST" action="?/request_reschedule" class="border-t border-white/10 p-5" use:enhance>
								<label>
									<span class="ux-label">Comentario (opcional)</span>
									<textarea name="note" rows="2" disabled={!appointment.can_request_reschedule} class="ux-textarea"></textarea>
								</label>
								<button disabled={!appointment.can_request_reschedule} class="ux-btn-secondary mt-4 w-full">
									Enviar pedido
								</button>
							</form>
						</details>
						{#if canShowCancelAction}
							<details class="rounded-2xl border border-red-400/20 bg-red-500/10">
								<summary class="cursor-pointer list-none px-5 py-4 text-base font-bold text-red-100">Cancelar turno</summary>
								<form method="POST" action="?/cancel" class="border-t border-red-400/20 p-5" use:enhance>
									<label>
										<span class="ux-label">Motivo (opcional)</span>
										<textarea name="note" rows="2" disabled={!appointment.can_cancel} class="ux-textarea"></textarea>
									</label>
									<label class="mt-4 flex items-start gap-3 text-sm font-bold text-red-100">
										<input type="checkbox" name="confirm_cancel" value="true" required disabled={!appointment.can_cancel} class="mt-1 h-4 w-4 accent-red-600 disabled:opacity-60" />
										<span>Confirmo que quiero cancelar este turno.</span>
									</label>
									<button disabled={!appointment.can_cancel} class="ux-btn-danger mt-4 w-full">Cancelar turno</button>
								</form>
							</details>
						{/if}
					</div>
					{#if !appointment.can_confirm && !appointment.can_cancel && !appointment.can_request_reschedule}
						<p class="ux-empty mt-5">Este enlace ya no admite acciones online.</p>
					{/if}
				</section>
			{/if}
		{:else}
			<section class="ux-card">No encontramos un turno asociado a este enlace.</section>
		{/if}
	</div>
</main>
</BookingAppearance>
