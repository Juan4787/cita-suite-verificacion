<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
 import {formatQuotedPrice, quotedPriceEstimateNotice} from '$lib/booking/pricing';
 import {splitTextWithHttpsLinks} from '$lib/utils/safe-links';
	import PatientManagementPanel from '$lib/components/appointments/PatientManagementPanel.svelte';
	import BookingAppearance from '$lib/booking/BookingAppearance.svelte';
	import { BOOKING_MODALITY_LABELS, type BookingModality } from '@cita-suite/shared/booking-integration';
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
	import type { DepositWhatsAppNotices, PracticeWhatsAppNotice } from '$lib/scheduling/contracts';
	import { describeDepositDeadline, formatDepositAmount } from '$lib/scheduling/deposits';
	import { buildSelfManagementCutoffNotice } from '$lib/scheduling/email-policy';
	import {
		refineDeviceClass,
		whatsappHrefFor,
		type DeviceClass,
		type NotificationBrowserProfile,
		type NotificationGuide
	} from '$lib/device';
	import { revealNotice } from '$lib/ui/reveal-notice';
	import type { PublicAppointmentView } from '$lib/scheduling/public-appointment';
	import type { PatientManagementPanelData, PatientManagementFeedback } from '$lib/scheduling/patient-management-page';

	let { data, form }: {
		data: {
			appointment: PublicAppointmentView | null;
   management?: PatientManagementPanelData | null;
			message: string;
			created: boolean;
			informationSaved?: boolean;
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
			emailRemindersActive?: boolean;
			scheduleChangedSinceMessage?: boolean;
			calendarMessage: string | null;
			bookingInformationEnabled?: boolean;
   remindersEnabled: boolean;
			practiceWhatsApp: PracticeWhatsAppNotice | null;
			depositWhatsApp: DepositWhatsAppNotices | null;
			rebookUrl: string | null;
		};
		form?: PatientManagementFeedback;
	} = $props();

	const appointment = $derived(data.appointment);
 const managementDecision = $derived(!!data.management && data.management.mode !== 'overview' && !form?.success);
 const managementPriority = $derived(!!data.management && (managementDecision || (!!form?.message && form?.action !== 'report_deposit_payment')));
	const isVirtual = $derived(appointment?.booking_context?.modality === 'video');

	// El server clasifica por User-Agent; acá solo se corrige el iPad que se
	// presenta como Mac (invisible para el UA, detectable por touch).
	let refinedDevice = $state<DeviceClass | null>(null);
	const device = $derived(refinedDevice ?? data.device);

	// En iOS el flujo es el calendario. En los demás dispositivos, el permiso sólo se
	// solicita con un toque cuando aún está sin decidir; si ya estaba concedido, el
	// alta se recupera automáticamente sin volver a interrumpir.
	// `undecided` y `denied` son lo único que la página puede saber cuando el permiso no llega.
	// Chrome devuelve `default` tanto si la pregunta venció como si la contrajo o si Android tiene
	// sus avisos apagados, y pasa solo a `denied` tras varios pedidos: repetir el botón no sirve y
	// termina en bloqueo. Por eso ninguno de los dos estados ofrece sólo «volver a intentar».
	type PushState =
		| 'unavailable'
		| 'unsupported'
		| 'idle'
		| 'asking'
		| 'working'
		| 'test_waiting'
		| 'test_question'
		| 'subscribed'
		| 'needs_device_check'
		| 'undecided'
		| 'denied'
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
	let currentSiteOrigin = $state<string | null>(null);
	let inMemoryPushSessionId = '';
	const testRetrySequence: Record<TestPhase, number> = { initial: 0, recovery: 0 };
	// Sobrevive a los cambios de permiso: una prueba perdida sigue perdida aunque el permiso se bloquee y
	// se conceda de nuevo, y repetir su clave devolvería el intento viejo en vez de enviar otro.
	let lastTestMissing = false;
	const nextTestPhase = (): TestPhase => (lastTestMissing && activeTestDeliveryId ? 'recovery' : 'initial');

	const base = $derived(appointment ? `/turno/${appointment.token}` : '');
 const managementBase = $derived(data.management?.url ?? base);
	type CalendarHandoffProvider = 'google' | 'phone';
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
	const calendarHandoffAllowed = $derived(device === 'ios' || device === 'android');
	const calendarHandoffRetryHref = $derived(
		calendarHandoffProvider === 'phone'
			? `${managementBase}/calendario.ics?p=phone`
			: `${managementBase}/ir/google`
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
			const validProvider = provider === 'google' || provider === 'phone';
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
  if (!data.remindersEnabled) return;
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
		guide ? { title: guide.title, steps: guide.steps.map((step) => step.replaceAll('{{site}}', `“${siteLabel}”`)) } : null;
	const sitePermissionGuide = $derived(resolveGuide(data.notificationBrowser.sitePermissionGuide));
	const phoneNotificationGuide = $derived(
		resolveGuide(data.notificationBrowser.phoneNotificationGuide)
	);
	const permissionChoiceLabel = $derived(
		data.notificationBrowser.id === 'firefox' ? 'Siempre' : 'Permitir'
	);

	const pushSessionStorageKey = () =>
		appointment ? `cita-suite:push-session:${appointment.token}` : 'cita-suite:push-session';
	const recoveryRetryStorageKey = () => `${pushSessionStorageKey()}:recovery-retry`;
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
		const response = await fetch(`${managementBase}/push`, {
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
			lastTestMissing = false;
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
			lastTestMissing = true;
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
				`${managementBase}/push?delivery_id=${encodeURIComponent(deliveryId)}`,
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
					: 'undecided';
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
					pushState = readNotificationPermission() === 'denied' ? 'denied' : 'undecided';
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
			pushMessage = 'Chrome sigue bloqueando los avisos de este sitio. Revisá los pasos de arriba.';
			return;
		}
		pushState = 'asking';
		try {
			await Notification.requestPermission();
			// La promesa puede decir `default` aunque el permiso ya haya pasado a bloqueado:
			// la propiedad efectiva es la única fuente de verdad.
			const effectivePermission = readNotificationPermission();
			lastObservedNotificationPermission = effectivePermission;
			if (effectivePermission === 'granted') await syncPushSubscription(true, phase);
			else pushState = effectivePermission === 'denied' ? 'denied' : 'undecided';
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
			const response = await fetch(`${managementBase}/push`, {
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
			if (pushState === 'denied') {
				pushState = 'undecided';
				pushMessage = 'Listo: ya no está bloqueado. Ahora tocá “Preguntar de nuevo”.';
			} else if (previousPermission === 'granted') {
				// Restablecieron un permiso concedido: Chrome borró la suscripción, y lo que la
				// pantalla decía del permiso, de la prueba o del recordatorio ya no es cierto.
				pollRun += 1;
				activeTestDeliveryId = null;
				activeTestPhase = null;
				pushState = 'idle';
				pushMessage = '';
			}
			return;
		}
		// Volver a la página sólo para releer una guía no demuestra que el ajuste haya
		// cambiado. La recuperación automática se conserva exclusivamente cuando la
		// Web API pasa de default/denied a granted. Si ya era granted, una nueva prueba
		// requiere el CTA explícito que se muestra junto a los pasos.
		if (
			previousPermission !== null &&
			previousPermission !== 'granted' &&
			['undecided', 'denied', 'idle', 'needs_device_check'].includes(pushState)
		) {
			void syncPushSubscription(true, nextTestPhase());
		}
	};

	onMount(() => {
  if (!data.remindersEnabled) return;
		mounted = true;
		currentSiteOrigin = window.location.origin;
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
			pushState = 'idle';
		} else {
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
	const hasCalendarAction = $derived(
		appointment !== null &&
			['clicked_google', 'clicked_ics', 'downloaded_ics', 'clicked_outlook', 'clicked_phone_calendar', 'synced_google'].includes(
				appointment.calendar_action_status
			)
	);
	const managedGoogleCalendar = $derived(data.googleCalendar.available);
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
	// Ningún estado del aviso del teléfono deja a la persona sin salida: mientras el aviso no esté
	// activo y comprobado, el calendario se ofrece aunque nunca se haya podido enviar una prueba.
	const showCalendarAlternative = $derived(
		device === 'android' && ['unsupported', 'undecided', 'denied', 'needs_device_check', 'error'].includes(renderedPushState)
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
		if (data.emailRemindersActive) return 'Te vamos a recordar el turno por correo';
		return 'Último paso: activá el recordatorio';
	});
	const reminderIntro = $derived.by(() => {
		if (pushReminderIsActive) {
			return `Este teléfono confirmó que recibe los avisos, ${pushWindowsLabel}.`;
		}
		if (googleCalendarIsCurrent) {
			return `El turno está guardado en tu cuenta Google con avisos ${data.googleCalendar.reminderLabel}. Si cambia el horario, lo actualizamos automáticamente.`;
		}
		if (calendarHandoffSaved) return 'Tu calendario va a usar sus propios avisos. Si el turno cambia, te vamos a avisar para que lo actualices.';
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
			return 'El turno cambió. Si lo habías guardado en tu calendario, borrá el evento anterior y guardá el nuevo.';
		}
		if (renderedPushState === 'undecided') {
			return 'No pudimos activar los avisos en este teléfono. A veces el navegador no muestra la pregunta o se cierra sola. Elegí cómo seguir.';
		}
		if (renderedPushState === 'denied') {
			return 'Este teléfono tiene bloqueados los avisos de este sitio. Elegí cómo seguir.';
		}
		if (renderedPushState === 'needs_device_check') {
			return 'El permiso está dado, pero la notificación de prueba no se vio en este teléfono. Elegí cómo seguir.';
		}
		if (renderedPushState === 'unsupported') {
			return 'Este navegador no puede avisarte en el teléfono. Guardá el turno en tu calendario.';
		}
		if (data.emailRemindersActive) {
			return device === 'ios'
				? 'También podés guardarlo en el calendario del iPhone.'
				: 'Si querés, también podés recibir un aviso en este teléfono.';
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
				{ label: 'Google Calendar', href: `${managementBase}/ir/google`, hint: 'Recomendado' },
				{ label: 'Outlook', href: `${managementBase}/ir/outlook` },
				{ label: 'Descargar calendario', href: `${managementBase}/calendario-descargar.ics` }
			];
		}
		return [
			{ label: 'Agregar al calendario', href: `${managementBase}/calendario.ics`, hint: 'Recomendado' },
			{ label: 'Google Calendar', href: `${managementBase}/ir/google` }
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

	// Seña pendiente: pagarla es lo que confirma el turno (plan de señas y avisos, 4.2, 4.9 y P1).
	const depositPending = $derived(appointment?.deposit?.status === 'pending');
	const paymentNoticeAt = $derived(
		form?.action === 'report_deposit_payment' && form?.success && form?.paymentNoticeAt
			? form.paymentNoticeAt
			: (appointment?.deposit?.patient_payment_notice_at ?? null)
	);
	const paidNowHref = $derived(
		data.depositWhatsApp
			? whatsappHrefFor(device, data.depositWhatsApp.paidNow.whatsappUrl, data.depositWhatsApp.paidNow.whatsappWebUrl)
			: null
	);
	let confirmPaymentNoticeOpen = $state(false);
	let reportingPaymentNotice = $state(false);
	let paymentNoticePopupBlocked = $state(false);
	let paymentNoticeError = $state('');
	const submitPaymentNotice: SubmitFunction = ({ cancel }) => {
		if (reportingPaymentNotice) {
			cancel();
			return;
		}
		reportingPaymentNotice = true;
		paymentNoticeError = '';
		paymentNoticePopupBlocked = false;
		const targetHref = paidNowHref;
		return async ({ result, update }) => {
			try {
				if (result.type === 'error') {
					paymentNoticeError = 'No pudimos registrar tu aviso de pago. Volvé a intentar en unos segundos.';
					return;
				}
				await update({ reset: false });
				if (result.type === 'success') {
					confirmPaymentNoticeOpen = false;
					if (targetHref && typeof window !== 'undefined' && typeof window.open === 'function') {
						const opened = window.open(targetHref, '_blank', 'noopener,noreferrer');
						if (!opened) paymentNoticePopupBlocked = true;
					}
				}
			} catch {
				paymentNoticeError = 'No pudimos registrar tu aviso de pago. Volvé a intentar en unos segundos.';
			} finally {
				reportingPaymentNotice = false;
			}
		};
	};
	let transferCopied = $state(false);
	const copyTransferDetails = async () => {
		try {
			await navigator.clipboard.writeText(appointment?.deposit_transfer_details ?? '');
			transferCopied = true;
			setTimeout(() => (transferCopied = false), 2500);
		} catch {
			// Sin portapapeles, los datos siguen a la vista para seleccionarlos a mano.
			transferCopied = false;
		}
	};


	// Coming back from «Información para tu consulta»: the notice is read once, and a reload does not
	// announce again something that happened before.
	let informationSavedNotice = $state<HTMLParagraphElement>();
	onMount(() => {
		if (!data.informationSaved) return;
		revealNotice(informationSavedNotice);
		const clean = new URL(window.location.href);
		clean.searchParams.delete('informacion');
		void tick().then(() => replaceState(clean, {})).catch(() => {});
	});
</script>

{#snippet instructionList(guide: NotificationGuide)}
	<h3 class="text-lg font-bold leading-snug text-fg bk-text">{guide.title}</h3>
	<ol class="mt-4 space-y-3 text-sm leading-relaxed text-fg-80 bk-muted">
		{#each guide.steps as step, index}
			<li class="flex gap-3">
				<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-400-15 text-xs font-bold text-accent-200 bk-notice-text bk-notice-fill">
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
					class="inline-flex items-center gap-2 rounded-full border border-success-300-25 bg-success-300-08 px-4 py-2 text-sm font-bold text-success-100 bk-success-text bk-success-fill bk-success-line"
					aria-live="polite"
				>
					<svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 shrink-0">
						<path d="m5.5 10 3 3 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span>Listo para este turno</span>
				</div>
			{:else if renderedPushState === 'asking'}
				<div class="ux-alert ux-alert-warning" aria-live="polite">
					<p class="font-bold text-fg bk-text">Mirá arriba de todo</p>
					<p class="mt-1">Si el navegador te pregunta, tocá “{permissionChoiceLabel}” enseguida: la pregunta dura unos segundos.</p>
				</div>
			{:else if renderedPushState === 'working'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent-400 bk-accent-text">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-fg bk-text">
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
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-bold text-fg bk-text">Notificación de prueba enviada</p>
					<p class="mt-1">Estamos comprobando que este teléfono pueda mostrarla…</p>
				</div>
			{:else if renderedPushState === 'test_question'}
				<div class="ux-alert ux-alert-success" aria-live="polite">
					<p class="font-bold text-fg bk-text">¿Recibiste la notificación de prueba?</p>
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
			{:else if renderedPushState === 'error'}
				{#if pushMessage}
					<p class="ux-alert" aria-live="polite">{pushMessage}</p>
				{/if}
				<button type="button" class="ux-btn-secondary mt-3 w-full" disabled={syncing} onclick={enablePush}>
					Volver a intentar
				</button>
			{:else if ['unsupported', 'needs_device_check', 'denied', 'undecided'].includes(renderedPushState)}
				<!-- La salida de estos estados está en reminderAlternatives: nunca el mismo botón solo. -->
			{:else}
				<button
					type="button"
					class={primary ? 'ux-btn-primary ux-btn-cta w-full px-3 text-cta font-bold' : 'ux-btn-secondary w-full px-3 text-cta font-bold'}
					onclick={enablePush}
				>
					<Icon name="bell" />Activar recordatorio
				</button>
				<p class="mt-3 text-center text-xs leading-relaxed text-copy-subtle bk-muted">
					Te pedimos permiso y enviamos una prueba para confirmar que llega. Si aparece la pregunta, tocá “{permissionChoiceLabel}” enseguida.
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
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 text-success-300 bk-success-text">
							<rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" />
							<path d="M7.5 3.5v3M16.5 3.5v3M4 9h16M8 14l2.2 2.2L16 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<div>
							<p class="font-bold text-fg bk-text">Recordatorio guardado en tu calendario</p>
							<p class="mt-1">Avisos {data.googleCalendar.reminderLabel}. Si cambia el horario, actualizamos el mismo evento automáticamente.</p>
						</div>
					</div>
				</div>
				<details class="mt-2 rounded-2xl border border-line bg-fill-04 bk-line bk-soft">
					<summary class="cursor-pointer list-none px-4 py-3 text-center text-xs font-bold text-fg-55 bk-muted">
						Administrar calendario
					</summary>
					<form method="POST" action="?/remove_google_calendar" class="border-t border-line p-3 bk-line">
						<button class="ux-btn-secondary w-full text-sm">Quitar de mi cuenta Google</button>
					</form>
				</details>
			{:else if data.googleCalendar.state === 'preparing' || data.googleCalendar.state === 'updating' || data.googleCalendar.state === 'removing'}
				<div class="ux-alert ux-alert-success">
					<div class="flex items-start gap-3">
						<svg viewBox="0 0 24 24" aria-hidden="true" class="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent-400 bk-accent-text">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
							<path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
						</svg>
						<div>
							<p class="font-bold text-fg bk-text">
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

{#snippet phoneCalendarOption(primary: boolean)}
	<a
		href={`${managementBase}/calendario.ics?p=phone`}
		onclick={() => beginCalendarHandoff('phone')}
		class={primary ? 'ux-btn-primary ux-btn-cta flex w-full px-3 text-center text-cta font-bold' : 'ux-btn-secondary flex w-full px-3 text-center font-bold'}
	>
		<Icon name="calendar" />Guardar en mi calendario
	</a>
	<p class="mt-2 text-xs leading-relaxed text-fg-60 bk-muted">
		El navegador descarga un archivo: tocá “Abrir” y elegí tu calendario. Cada calendario usa sus propios avisos. Si el turno cambia, hay que volver a guardarlo.
	</p>
{/snippet}

{#snippet managedCalendarOption()}
	{#if managedGoogleCalendar && !googleCalendarHasVisibleStatus}
		<a href={`${managementBase}/google-calendar/connect${data.googleCalendar.state === 'needs_reconnect' ? '?reauthorize=1' : ''}`} class="ux-btn-secondary mt-4 flex w-full px-3 text-center font-bold">
			Conectar mi cuenta Google
		</a>
		<p class="mt-2 text-xs leading-relaxed text-fg-60 bk-muted">
			Guardamos el turno en tu Google Calendar con avisos {data.googleCalendar.reminderLabel}, y si cambia lo actualizamos solos. Sirve si usás esa cuenta en tu calendario.
		</p>
	{/if}
{/snippet}

{#snippet phoneRecovery()}
	<details class="mt-4 rounded-2xl border border-line bg-fill-04 bk-line bk-soft" open={renderedPushState === 'needs_device_check'}>
		<summary class="cursor-pointer list-none px-5 py-3 text-sm font-bold text-fg-70 bk-muted">
			Prefiero recibir el aviso en este teléfono
		</summary>
		<div class="border-t border-line p-5 bk-line">
			<!-- Android va primero: con Chrome apagado ahí, «Suscribirse» no cambia nada (plan, 4.1). -->
			{#if phoneNotificationGuide}
				{@render instructionList(phoneNotificationGuide)}
			{/if}
			{#if renderedPushState !== 'needs_device_check' && sitePermissionGuide}
				<div class={phoneNotificationGuide ? 'mt-6' : ''}>
					{@render instructionList(sitePermissionGuide)}
				</div>
			{/if}
			{#if !sitePermissionGuide && !phoneNotificationGuide}
				<p class="text-sm leading-relaxed text-fg-70 bk-muted">Revisá los permisos de notificaciones del navegador en los ajustes del teléfono.</p>
			{/if}
			{#if pushMessage}
				<p class="ux-alert ux-alert-warning mt-4" role="status">{pushMessage}</p>
			{/if}
			<button
				type="button"
				class="ux-btn-primary mt-5 w-full"
				aria-label={renderedPushState === 'needs_device_check' ? 'Enviar otra notificación de prueba' : undefined}
				disabled={syncing}
				onclick={enablePush}
			>
				<Icon name="bell" />{renderedPushState === 'needs_device_check' ? 'Enviar otra prueba' : renderedPushState === 'denied' ? 'Ya lo cambié' : 'Preguntar de nuevo'}
			</button>
			{#if renderedPushState === 'undecided' && sitePermissionGuide}
				<p class="mt-3 text-center text-xs leading-relaxed text-fg-60 bk-muted">
					Si no ves “Permisos”, tocá “Preguntar de nuevo” y volvé a entrar.
				</p>
			{/if}
		</div>
	</details>
{/snippet}

{#snippet reminderAlternatives()}
	{#if showCalendarAlternative && calendarHandoffStage === 'idle'}
		<div class="mt-5" aria-live="polite">
			{@render phoneCalendarOption(true)}
			{@render managedCalendarOption()}
			{#if renderedPushState !== 'unsupported'}
				{@render phoneRecovery()}
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet calendarHandoffFeedback()}
	{#if calendarHandoffAllowed && calendarHandoffStage === 'asking'}
		<div
			class="mt-5 rounded-2xl border border-accent-300-30 bg-accent-400-10 p-5 shadow-[0_16px_36px_rgba(76,29,149,0.16)] bk-notice-fill bk-notice-line"
			aria-live="polite"
			aria-labelledby="calendar-handoff-question"
		>
			<h3 id="calendar-handoff-question" class="text-lg font-bold leading-snug text-fg bk-text">
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
			class="mt-5 inline-flex items-center gap-2 rounded-full border border-success-300-25 bg-success-300-08 px-4 py-2 text-sm font-bold text-success-100 bk-success-text bk-success-fill bk-success-line"
			role="status"
			aria-live="polite"
		>
			<svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4 shrink-0 text-success-300 bk-success-text">
				<path d="m5.5 10 3 3 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<span>Listo, quedó guardado</span>
		</div>
	{/if}
{/snippet}

{#snippet depositCard(current: PublicAppointmentView, deposit: NonNullable<PublicAppointmentView['deposit']>)}
	{@const deadline = describeDepositDeadline(
		{ amount: deposit.amount, dueAt: deposit.due_at, autoCancel: deposit.auto_cancel, paymentNoticeAt },
		current.business.timezone,
		new Date(data.management?.now ?? Date.now())
	)}
	<section class="ux-card" id="sena-del-turno" data-deposit-card>
		<h2 class="ux-section-title">Seña del turno</h2>
		<p class="mt-2 text-fg-65 bk-muted">Tu turno se confirma cuando el consultorio registra la seña.</p>
		<p class="mt-2 text-fg-80 bk-muted">{deadline.turnPageLine}</p>
		{#if !paymentNoticeAt && deadline.autoCancelSentence}
			<p class="mt-2 text-sm text-fg-65 bk-muted">{deadline.autoCancelSentence}</p>
		{/if}
		{#if current.deposit_transfer_details}
			<div class="ux-soft-card mt-4 p-4">
				<p class="text-sm font-bold text-fg-55 bk-muted">Datos para transferir</p>
				<p class="mt-1 whitespace-pre-wrap break-words font-bold text-fg bk-text">{current.deposit_transfer_details}</p>
				<button type="button" class="ux-btn-secondary mt-3 w-full" onclick={copyTransferDetails}>
					{#if transferCopied}<Icon name="check" class="h-4 w-4 shrink-0" />Copiado{:else}Copiar datos{/if}
				</button>
			</div>
		{/if}
		{#if paymentNoticeError}
			<p class="ux-alert mt-4" role="alert">{paymentNoticeError}</p>
		{:else if form?.action === 'report_deposit_payment' && !form?.success && form?.message}
			<p class="ux-alert mt-4" role="alert">{form.message}</p>
		{/if}
		{#if paymentNoticeAt}
			<div class="ux-alert ux-alert-success mt-4" role="status" data-payment-notice-recorded>
				<p class="font-bold text-fg bk-text">Avisamos al consultorio que transferiste la seña.</p>
				<p class="mt-1 text-sm text-fg-80 bk-muted">
					Aviso registrado el {formatInTimeZone(paymentNoticeAt, current.business.timezone).full}. El consultorio va a verificar tu pago y confirmar el turno.
				</p>
			</div>
			{#if paidNowHref}
				{#if paymentNoticePopupBlocked}
					<p class="mt-3 text-sm text-fg-70 bk-muted">Si WhatsApp no se abrió automáticamente, tocá abajo para enviar el comprobante.</p>
				{/if}
				<a
					href={paidNowHref}
					target="_blank"
					rel="noreferrer"
					class="ux-btn-primary mt-3 w-full"
					data-payment-notice-whatsapp-link
				>
					Enviar comprobante por WhatsApp
				</a>
			{/if}
		{:else}
			<div class="mt-4 grid gap-3">
				{#if confirmPaymentNoticeOpen}
					<div class="ux-soft-card border border-accent-300-30 bg-accent-400-10 p-4 bk-notice-fill bk-notice-line" data-payment-notice-confirm>
						<p class="font-bold text-fg bk-text">¿Confirmás que ya transferiste {formatDepositAmount(deposit.amount)}?</p>
						<p class="mt-1 text-sm text-fg-70 bk-muted">
							{paidNowHref
								? 'Registramos tu aviso para el consultorio y abrimos WhatsApp para que envíes el comprobante.'
								: 'Registramos tu aviso para que el consultorio verifique el pago y confirme tu turno.'}
						</p>
						<form method="POST" action="?/report_deposit_payment" use:enhance={submitPaymentNotice} class="mt-3 grid gap-2 sm:grid-cols-2">
							<button type="submit" class="ux-btn-primary w-full" disabled={reportingPaymentNotice}>
								{reportingPaymentNotice ? 'Avisando…' : 'Sí, ya transferí'}
							</button>
							<button type="button" class="ux-btn-secondary w-full" disabled={reportingPaymentNotice} onclick={() => (confirmPaymentNoticeOpen = false)}>
								Todavía no
							</button>
						</form>
					</div>
				{:else}
					<button
						type="button"
						class="ux-btn-primary w-full"
						onclick={() => {
							paymentNoticeError = '';
							confirmPaymentNoticeOpen = true;
						}}
						data-payment-notice-trigger
					>
						{data.depositWhatsApp ? 'Ya transferí: enviar el comprobante' : 'Ya transferí la seña'}
					</button>
				{/if}
				{#if data.depositWhatsApp}
					<a
						href={whatsappHrefFor(device, data.depositWhatsApp.payLater.whatsappUrl, data.depositWhatsApp.payLater.whatsappWebUrl)}
						target="_blank"
						rel="noreferrer"
						class="ux-btn-secondary w-full"
					>
						Voy a pagar la seña más adelante
					</a>
				{/if}
			</div>
		{/if}
	</section>
{/snippet}

{#snippet practiceWhatsAppCard(notice: PracticeWhatsAppNotice)}
	<section class="ux-card">
		<h2 class="ux-section-title">{data.created ? 'Avisale al consultorio' : 'Contacto con el consultorio'}</h2>
		<p class="mt-2 text-sm text-fg-65 bk-muted">
			{data.created
				? 'Mandales un WhatsApp con tu nombre, el día y la hora: así les queda el aviso y el chat abierto. Podés revisar el mensaje antes de enviarlo.'
				: 'Si necesitás escribirle al consultorio por este turno, el mensaje ya sale con tu nombre, el día y la hora.'}
		</p>
		<a
			href={whatsappHrefFor(device, notice.whatsappUrl, notice.whatsappWebUrl)}
			target="_blank"
			rel="noreferrer"
			class="ux-btn-primary mt-4 w-full"
		>
			{data.created ? 'Avisar al consultorio por WhatsApp' : 'Escribir al consultorio por WhatsApp'}
		</a>
	</section>
{/snippet}

{#snippet locationCard(current: PublicAppointmentView)}
	<section class="ux-card">
		{#if data.isSoon}
			<h2 class="ux-section-title">{isVirtual ? 'Tu turno es pronto: revisá el acceso a tu consulta' : 'Tu turno es pronto: revisá la dirección'}</h2>
		{:else}
			<h2 class="ux-section-title">{isVirtual ? 'Tu consulta virtual' : 'Dónde es'}</h2>
		{/if}
		<p class="mt-4 text-lg font-bold text-fg bk-text">{isVirtual ? 'Modalidad: Virtual' : current.business.address}</p>
		{#if current.business.address_instructions}
			{#if isVirtual}
				<p class="mt-2 whitespace-pre-wrap break-words text-sm text-fg-70 bk-muted">
					{#each splitTextWithHttpsLinks(current.business.address_instructions) as part}{#if part.type === 'link'}<a href={part.href} target="_blank" rel="noopener noreferrer" class="ux-link break-all bk-accent-text">{part.label}</a>{:else}{part.value}{/if}{/each}
				</p>
			{:else}
				<p class="mt-2 text-sm text-fg-70 bk-muted">{current.business.address_instructions}</p>
			{/if}
		{/if}
		{#if current.business.maps_link}
			<a href={`${managementBase}/ir/maps`} target="_blank" rel="noreferrer" class="ux-btn-primary mt-5 block w-full text-center">
				Cómo llegar
			</a>
		{/if}
	</section>
{/snippet}

{#snippet reminderCard()}
	<section class="ux-card">
		<h2 class="text-2xl font-bold leading-tight tracking-tight text-fg bk-text">
			{reminderTitle}
		</h2>
		<p class="mt-3 text-sm leading-relaxed text-fg-70 bk-muted">{reminderIntro}</p>

		{#if device === 'android'}
			{#if googleCalendarHasVisibleStatus}
				{@render googleCalendarBlock()}
			{:else}
				{@render pushBlock(true)}
				{@render reminderAlternatives()}
				{#if pushReminderIsActive || (!showCalendarAlternative && calendarHandoffStage === 'idle')}
					<details class="mt-4 rounded-2xl border border-line bg-fill-04 bk-line bk-soft">
						<summary class="cursor-pointer list-none px-5 py-3 text-sm font-bold text-fg-70 bk-muted">Guardarlo también en mi calendario</summary>
						<div class="border-t border-line p-4 bk-line">
							{@render phoneCalendarOption(false)}
							{@render managedCalendarOption()}
						</div>
					</details>
				{/if}
			{/if}
		{:else if device === 'ios'}
			{#if calendarHandoffStage === 'idle'}
				<a
					href={`${managementBase}/calendario.ics?p=phone`}
					onclick={() => beginCalendarHandoff('phone')}
					class="ux-btn-primary ux-btn-cta mt-5 flex w-full px-3 text-center text-cta font-bold"
				>
					<Icon name="calendar" />Agregar al calendario
				</a>
				<p class="mt-3 text-center text-xs leading-relaxed text-copy-subtle bk-muted">
					El evento queda preparado con la fecha y la hora. Si el turno cambia, hay que volver a guardarlo.
				</p>
				{@render managedCalendarOption()}
			{/if}
		{:else}
			<details class="mt-4 rounded-2xl border border-line bg-fill-04 bk-line bk-soft">
				<summary class={`${calendarSummaryClass} block w-full cursor-pointer list-none text-center`}>
					<span class="inline-flex items-center justify-center gap-2"><Icon name={needsCalendarUpdate ? 'refresh' : 'calendar'} />{needsCalendarUpdate ? 'Actualizar calendario' : 'Agregar al calendario'}</span>
				</summary>
				<div class="border-t border-line p-4 bk-line">
					{#if hasCalendarAction && !needsCalendarUpdate}
						<p class="ux-alert ux-alert-warning mb-4">
							Ya registramos una acción de calendario para este turno. Si lo agregás otra vez,
							podrías recibir avisos duplicados.
						</p>
					{/if}
					<div class="grid gap-3">
						{#each calendarOptions as option}
							<a href={option.href} class="ux-choice flex items-center justify-between px-5 py-4">
								<span class="font-bold text-fg bk-text">{option.label}</span>
								{#if option.hint}
									<span class="ux-badge">{option.hint}</span>
								{/if}
							</a>
						{/each}
					</div>
					<p class="mt-4 text-xs text-copy-subtle bk-muted">
						El evento incluye {isVirtual ? 'las indicaciones de acceso' : 'la dirección'} y este enlace. Cada calendario usa sus propios avisos.
					</p>
					{@render managedCalendarOption()}
				</div>
			</details>
			{@render pushBlock(false)}
		{/if}

		{@render calendarHandoffFeedback()}

		<details class="mt-4 rounded-2xl border border-line bg-fill-04 bk-line bk-soft">
			<summary class="cursor-pointer list-none px-5 py-3 text-sm font-bold text-fg-70 bk-muted">
				Copiar detalles del turno
			</summary>
			<div class="border-t border-line p-4 bk-line">
				<pre class="overflow-x-auto whitespace-pre-wrap text-sm text-fg-80 bk-muted">{copyDetailsText}</pre>
				<button type="button" class="ux-btn-secondary mt-3 w-full" onclick={copyDetails}>
					{#if copied}<Icon name="check" class="h-4 w-4 shrink-0" />Copiado{:else}Copiar al portapapeles{/if}
				</button>
			</div>
		</details>
	</section>
{/snippet}


{#snippet managementControls()}
			{#if appointment && data.management}
    <PatientManagementPanel context={{ ...data.management,
     device,
     practiceWhatsApp: data.practiceWhatsApp
      ? { whatsappUrl: data.practiceWhatsApp.whatsappUrl, whatsappWebUrl: data.practiceWhatsApp.whatsappWebUrl }
      : data.management.practiceWhatsApp ?? null,
     practicePhone: appointment.business.phone ?? data.management.practicePhone ?? null,
     canCancel: isActive && appointment.can_cancel && data.management.canCancel,
     canReschedule: isActive && appointment.can_request_reschedule && data.management.canReschedule,
     canConfirm: isActive && appointment.status === 'reserved' && appointment.can_confirm && data.management.canConfirm &&
      (!appointment.deposit || appointment.deposit.waived_reason === 'policy_disabled')
    }} feedback={form} />
   {/if}
{/snippet}

<svelte:head><title>Tu turno{appointment?.business?.name ? ` · ${appointment.business.name}` : ''}</title></svelte:head>

<BookingAppearance theme={appointment?.booking_context?.theme ?? 'cita-suite'}>
<main class="min-h-screen bg-fill-06111f px-4 py-6 text-fg sm:py-10 bk-text">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
		{#if data.informationSaved}
			<p bind:this={informationSavedNotice} tabindex="-1" role="status" class="ux-alert ux-alert-success" data-information-saved>La información quedó guardada para la profesional.</p>
		{/if}
		<section class="ux-hero">
			{#if appointment?.business?.logo_url}
				<img src={appointment.business.logo_url} alt={appointment.business.name} class="mb-5 h-16 w-16 rounded-2xl object-cover" />
			{/if}
			<h1 class="ux-title">{data.created ? 'Tu turno quedó reservado' : 'Tu turno'}</h1>
			{#if isActive && whenLabels}
				<p class="ux-subtitle">{managementDecision ? whenLabels.full : `Te esperamos el ${whenLabels.full}.`}</p>
			{:else}
				<p class="ux-subtitle">{data.message}</p>
			{/if}
			{#if form?.message && !data.management}
				<p class={form.success ? 'ux-alert ux-alert-success mt-5' : 'ux-alert mt-5'}>{form.message}</p>
			{/if}
			{#if data.calendarMessage}
				<p class="ux-alert mt-5">{data.calendarMessage}</p>
			{/if}
			{#if data.scheduleChangedSinceMessage}
				<p class="ux-alert ux-alert-warning mt-5" role="status">Este turno cambió después de ese correo. Lo que ves acá es la fecha y la hora actuales.</p>
			{/if}
		</section>

		{#if appointment}
   {#if managementPriority}{@render managementControls()}{/if}
   {#if !managementDecision}
			{#if isActive && depositPending && appointment.deposit}
				{@render depositCard(appointment, appointment.deposit)}
			{:else if isActive && data.created && data.practiceWhatsApp}
				{@render practiceWhatsAppCard(data.practiceWhatsApp)}
			{/if}
			{#if isActive && appointment.deposit?.status === 'paid'}
				<p class="ux-alert ux-alert-success">Recibimos tu seña. Tu turno está confirmado.</p>
			{/if}
			{#if data.bookingInformationEnabled && isActive}
				<section class="ux-soft-card p-5"><h2 class="ux-section-title">Información para tu consulta</h2><p class="mt-2 text-fg-65 bk-muted">Podés ampliar la información para la profesional. Los campos configurados se incorporan a tu perfil. Tu reserva se conserva.</p><a class="ux-btn-primary mt-4" href={`${data.management?.url ?? base}/informacion`}>Ver y ampliar mis datos</a></section>
			{/if}
			{#if googleCalendarIsUpdating && isActive}
				<div class="ux-alert ux-alert-success">
					La nueva fecha y hora se están actualizando automáticamente en tu cuenta Google.
				</div>
			{:else if needsCalendarUpdate && isActive && data.remindersEnabled}
				<div class="ux-alert">
					Tu turno cambió. Si lo habías guardado en tu calendario, borrá el evento anterior y guardá el nuevo.
				</div>
			{/if}

			{#if data.isSoon && (appointment.business.address || isVirtual)}
				{@render locationCard(appointment)}
			{/if}

			{#if isActive && data.remindersEnabled}
				{@render reminderCard()}
			{/if}
   {/if}

			<section class="ux-card">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h2 class="text-2xl font-bold text-fg bk-text">{data.created ? 'Resumen de la reserva' : appointment.business.name}</h2>
						<p class="mt-1 text-sm text-fg-55 bk-muted">{appointment.business.name}</p>
					</div>
					<span class="ux-badge">{appointment.public_status_label}</span>
				</div>

				<div class="mt-6 grid gap-4 sm:grid-cols-2">
					{#if appointment.booking_context}
						<div class="ux-soft-card p-5 sm:col-span-2">
							<p class="text-sm font-bold text-fg-55 bk-muted">Modalidad</p>
							<p class="mt-2 text-lg font-bold text-fg bk-text">{BOOKING_MODALITY_LABELS[appointment.booking_context.modality as BookingModality]}</p>
						</div>
					{/if}
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-fg-55 bk-muted">Servicio</p>
						<p class="mt-2 text-lg font-bold text-fg bk-text">{appointment.service_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5">
						<p class="text-sm font-bold text-fg-55 bk-muted">
							{appointment.is_joint ? 'Equipo profesional' : 'Profesional'}
						</p>
						<p class="mt-2 text-lg font-bold text-fg bk-text">{appointment.professional_name_snapshot}</p>
					</div>
					<div class="ux-soft-card p-5 sm:col-span-2">
						<p class="text-sm font-bold text-fg-55 bk-muted">Fecha y hora</p>
						<p class="mt-2 text-lg font-bold text-fg bk-text">{formatDateTime(appointment.starts_at, timezone)}</p>
					</div>
				</div>

				{#if isActive && data.management?.selfManagementCutoffHours}
					{@const cutoffSummary = buildSelfManagementCutoffNotice({
						startsAt: appointment.starts_at,
						cutoffHours: data.management.selfManagementCutoffHours,
						timezone,
						now: new Date(data.management.now),
						context: 'confirmed'
					})}
					{#if cutoffSummary}
						<p class="mt-4 text-sm text-fg-65 bk-muted" data-self-management-summary>{cutoffSummary}</p>
					{/if}
				{/if}

				{#if appointment.business.cancellation_policy}
					<p class="ux-empty mt-5">{appointment.business.cancellation_policy}</p>
				{/if}

				<a
					href={`${managementBase}/comprobante.pdf`}
					download="comprobante-turno.pdf"
					class="ux-btn-secondary mt-6 w-full px-3 sm:px-5"
				>
					<Icon name="receipt" />Guardar comprobante
				</a>
			</section>

			{#if !managementDecision && appointment.price_quote_snapshot}
				{@const registeredPriceNotice = quotedPriceEstimateNotice(appointment.price_quote_snapshot, 'registered')}
				<section class="ux-card">
					<h2 class="ux-section-title">Arancel registrado al reservar</h2>
					<p class="mt-2 font-bold">{formatQuotedPrice(appointment.price_quote_snapshot)}</p>
					{#if registeredPriceNotice}
						<p class="mt-2 text-sm text-fg-70 bk-muted">{registeredPriceNotice}</p>
					{/if}
				</section>
			{/if}

			{#if !managementDecision && appointment.patient_instructions_snapshot}
				<section class="ux-card">
					<h2 class="ux-section-title">Indicaciones para tu turno</h2>
					<p class="mt-2 whitespace-pre-wrap break-words">{appointment.patient_instructions_snapshot}</p>
				</section>
			{/if}

			{#if isActive && !data.created && !depositPending && data.practiceWhatsApp}
				{@render practiceWhatsAppCard(data.practiceWhatsApp)}
			{/if}

			{#if !data.isSoon && (appointment.business.address || isVirtual)}
				{@render locationCard(appointment)}
			{/if}

			{#if isCancelled}
				{@const cancellationOutcome = data.management?.cancellationDepositOutcome ?? null}
				<section class="ux-card">
					<h2 class="ux-section-title">Turno cancelado</h2>
					{#if cancellationOutcome}
						{#if cancellationOutcome.outcome === 'credit'}
							<p class="ux-alert ux-alert-success mt-3" data-cancellation-deposit-outcome>
								{cancellationOutcome.reason === 'force_majeure'
									? `Tu seña de ${formatDepositAmount(Number(cancellationOutcome.amount))} quedó a cuenta por decisión del consultorio para una próxima consulta.`
									: `Tu seña de ${formatDepositAmount(Number(cancellationOutcome.amount))} quedó a cuenta para tu próximo turno.`}
							</p>
						{:else}
							<p class="ux-alert ux-alert-warning mt-3" data-cancellation-deposit-outcome>
								La seña de {formatDepositAmount(Number(cancellationOutcome.amount))} se perdió porque la cancelación fue con menos de {cancellationOutcome.cutoffHours} {cancellationOutcome.cutoffHours === 1 ? 'hora' : 'horas'} de anticipación.
							</p>
						{/if}
					{/if}
					{#if appointment.deposit?.status === 'expired'}
						<p class="mt-3 text-sm text-fg-70 bk-muted">
							Este turno se canceló porque no se registró la seña antes del {formatInTimeZone(appointment.deposit.due_at, timezone).full}.
							Si ya transferiste, escribile al consultorio.
						</p>
						{#if data.practiceWhatsApp}
							<a
								href={whatsappHrefFor(device, data.practiceWhatsApp.whatsappUrl, data.practiceWhatsApp.whatsappWebUrl)}
								target="_blank"
								rel="noreferrer"
								class="ux-btn-primary mt-4 w-full"
							>
								Escribir al consultorio por WhatsApp
							</a>
						{/if}
					{/if}
					{#if data.rebookUrl}
						<a href={data.rebookUrl} class="ux-btn-secondary mt-3 w-full">Reservar otro turno</a>
					{/if}
					{#if data.googleCalendar.state === 'removed'}
						<p class="mt-3 text-sm text-fg-70 bk-muted">También quitamos el evento de tu cuenta Google.</p>
					{:else if data.googleCalendar.state === 'removing'}
						<p class="mt-3 text-sm text-fg-70 bk-muted">También estamos quitando el evento de tu cuenta Google.</p>
					{:else}
						<p class="mt-3 text-sm text-fg-70 bk-muted">
							Si guardaste el archivo en tu calendario, borralo desde ahí: ese evento no se quita solo.
						</p>
					{/if}
				</section>
			{/if}

   {#if !managementPriority}{@render managementControls()}{/if}
		{:else}
			<section class="ux-card">No encontramos un turno asociado a este enlace.</section>
		{/if}
	</div>
</main>
</BookingAppearance>
