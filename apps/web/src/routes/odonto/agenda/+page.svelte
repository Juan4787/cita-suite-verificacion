<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import DayFilterPicker from '$lib/components/agenda/DayFilterPicker.svelte';
	import ManualAppointmentWizard from '$lib/components/agenda/ManualAppointmentWizard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import {
		snapshotContainsRange,
		type AvailabilitySnapshot
	} from '$lib/availability/snapshot';
	import { filterAgendaAppointmentsByQuery } from '$lib/utils/agenda-search';
	import { onDestroy, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import {
		ACTIVE_APPOINTMENT_STATUSES,
		isExpiredActiveAppointment,
		isUpcomingActiveAppointment,
		splitActiveAppointmentGroups
	} from '$lib/utils/appointment-visibility';

	type Appointment = {
		id: string;
		patient_id: string;
		service_id: string;
		professional_id: string;
		starts_at: string;
		ends_at: string;
		status: string;
		source: string;
		service_name_snapshot: string;
		professional_name_snapshot: string;
		internal_note?: string | null;
		patients?: { full_name: string; phone_e164: string | null; dni?: string | null; email?: string | null } | null;
	};
	type AppointmentGroups = { upcoming: Appointment[]; past: Appointment[] };
	type Professional = { id: string; name: string; specialty?: string | null; is_active: boolean };
	type Service = { id: string; name: string; duration_minutes: number };
	type Patient = {
		id: string;
		full_name: string;
		phone: string | null;
		phone_raw: string | null;
		phone_e164: string | null;
		dni: string | null;
		birth_date: string | null;
		activity_at: string;
		blocked: boolean;
	};
	type Stat = { status: string; count: number };

	let { data, form } = $props<{
		data: {
			context: { canOperate: boolean; business?: { id?: string } };
			date: string;
			anyDay: boolean;
			anyDayLimited: boolean;
			selectedProfessionalId: string;
			selectedStatus: string;
			selectedServiceId: string;
			selectedPatientId: string;
			searchApplied: boolean;
			appointments: Appointment[];
			stats: Stat[];
			totalAppointments: number;
			professionals: Professional[];
			services: Service[];
			serviceProfessionalIds: Record<string, string[]>;
			availabilitySnapshot?: AvailabilitySnapshot | null;
			patients: Patient[];
			patientsLoaded?: boolean;
			referencesLoaded?: boolean;
			reminderCount?: number;
			appointmentRequestId: string;
			demo: boolean;
		};
			form?: {
				message?: string;
				phoneWarning?: { kind: 'missing' | 'invalid' };
				values?: Record<string, unknown>;
			};
	}>();

	const canOperate = $derived(data.context.canOperate && !data.demo);
	let showCreate = $state(false);
	let showSearch = $state(false);
	let initialized = $state(false);
	let createSection = $state<HTMLElement | null>(null);
	let searchSection = $state<HTMLElement | null>(null);
	// svelte-ignore state_referenced_locally
	let professionals = $state<Professional[]>(data.professionals ?? []);
	// svelte-ignore state_referenced_locally
	let services = $state<Service[]>(data.services ?? []);
	// svelte-ignore state_referenced_locally
	let patients = $state<Patient[]>(data.patients ?? []);
	// svelte-ignore state_referenced_locally
	let serviceProfessionalIds = $state<Record<string, string[]>>(data.serviceProfessionalIds ?? {});
	// svelte-ignore state_referenced_locally
	let availabilitySnapshot = $state<AvailabilitySnapshot | null>(data.availabilitySnapshot ?? null);
	// svelte-ignore state_referenced_locally
	let referencesLoaded = $state(Boolean(data.referencesLoaded));
	let referencesLoading = $state(false);
	let referencesError = $state('');
	// svelte-ignore state_referenced_locally
	let patientsLoaded = $state(Boolean(data.patientsLoaded));
	let patientsLoading = $state(false);
	let patientsError = $state('');
	// svelte-ignore state_referenced_locally
	let referencesBusinessId = $state(String(data.context.business?.id ?? ''));

	const statusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Reprogramar'
	};

	const statusTone: Record<string, string> = {
		reserved: 'ux-badge',
		confirmed: 'ux-badge ux-badge-success',
		cancelled: 'ux-badge ux-badge-danger',
		reschedule_requested: 'ux-badge ux-badge-warning'
	};

	const timeOnly = (value: string) =>
		new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));

	const dayLabel = (value: string) => {
		const label = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(
			new Date(`${value}T12:00:00`)
		);
		return label.charAt(0).toUpperCase() + label.slice(1);
	};

	const statCount = (status: string) => data.stats.find((stat: Stat) => stat.status === status)?.count ?? 0;
	const statusFilterEntries = $derived(
		Object.entries(statusLabels).filter(
			([status]) =>
				!data.anyDay || (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(status)
		)
	);
	const hasActiveSearch = $derived(
		Boolean(data.selectedProfessionalId || data.selectedStatus || data.selectedServiceId || data.anyDay)
	);
	const searchSummary = $derived.by(() => {
		const parts: string[] = [];
		if (data.anyDay) parts.push('Cualquier día');
		const professional = professionals.find((item: Professional) => item.id === data.selectedProfessionalId);
		if (professional) parts.push(professional.name);
		const service = services.find((item: Service) => item.id === data.selectedServiceId);
		if (service) parts.push(service.name);
		if (data.selectedStatus) parts.push(statusLabels[data.selectedStatus] ?? data.selectedStatus);
		return parts.join(' · ');
	});

	// Navegación por día (preserva los filtros activos).
	const shiftDate = (value: string, days: number) => {
		const d = new Date(`${value}T12:00:00`);
		d.setDate(d.getDate() + days);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const today = new Date();
	const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
	const prevDate = $derived(shiftDate(data.date, -1));
	const nextDate = $derived(shiftDate(data.date, 1));
	const isToday = $derived(!data.anyDay && data.date === todayStr);
	const buildAgendaHref = (date: string) => {
		const params = new URLSearchParams();
		params.set('date', date);
		if (data.selectedProfessionalId) params.set('professional_id', data.selectedProfessionalId);
		if (data.selectedServiceId) params.set('service_id', data.selectedServiceId);
		if (data.selectedStatus) params.set('status', data.selectedStatus);
		return `/odonto/agenda?${params.toString()}`;
	};
	const weekHref = $derived(
		`/odonto/agenda/semana?date=${data.date}${data.selectedProfessionalId ? `&professional_id=${data.selectedProfessionalId}` : ''}`
	);

	const localDateOf = (value: string) => {
		const d = new Date(value);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const shortDayLabel = (value: string) => {
		const d = new Date(value);
		const label = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
		return d.getFullYear() === today.getFullYear() ? label : `${label} ${d.getFullYear()}`;
	};

	// Buscador en vivo: independiente de los filtros, busca turnos activos
	// por nombre o teléfono a medida que se escribe. Al entrar en Agenda
	// se carga en segundo plano una instantánea compacta que no se muestra hasta
	// que haya una consulta; la respuesta remota sigue siendo la fuente definitiva.
	const MAX_VISIBLE_LIVE_RESULTS = 60;
	let searchInput = $state('');
	let liveResults = $state<AppointmentGroups | null>(null);
	let liveResolvedQuery = $state('');
	let liveError = $state('');
	let liveRequest = 0;
	let liveController: AbortController | null = null;
	let liveSnapshot = $state<Appointment[] | null>(null);
	let liveSnapshotLoading = false;
	let liveSnapshotBusinessId = '';
	let liveSnapshotRequest = 0;
	let liveSnapshotController: AbortController | null = null;

	const liveQuery = $derived(searchInput.trim());
	const liveActive = $derived(liveQuery.length > 0);
	const splitLiveAppointmentGroups = (appointments: readonly Appointment[]): AppointmentGroups =>
		splitActiveAppointmentGroups(appointments);
	const liveKnownGroups = $derived.by((): AppointmentGroups | null => {
		if (!liveActive) return null;
		const knownAppointments = new Map<string, Appointment>();
		for (const appointment of liveSnapshot ?? []) {
			knownAppointments.set(appointment.id, appointment);
		}
		for (const appointment of [
			...(liveResults?.upcoming ?? []),
			...(liveResults?.past ?? [])
		]) {
			knownAppointments.set(appointment.id, appointment);
		}
		return splitLiveAppointmentGroups(
			filterAgendaAppointmentsByQuery(
				[...knownAppointments.values()],
				liveQuery,
				MAX_VISIBLE_LIVE_RESULTS
			)
		);
	});
	const clearLiveSearch = () => {
		liveRequest += 1;
		liveController?.abort();
		liveController = null;
		searchInput = '';
		liveResults = null;
		liveResolvedQuery = '';
		liveError = '';
	};

	const clearLiveSnapshot = () => {
		liveSnapshotRequest += 1;
		liveSnapshotController?.abort();
		liveSnapshotController = null;
		liveSnapshot = null;
		liveSnapshotLoading = false;
		liveSnapshotBusinessId = '';
	};

	const loadLiveSnapshot = async () => {
		const businessId = String(data.context.business?.id ?? '').trim();
		if (!businessId || data.demo) return;
		if (liveSnapshotBusinessId === businessId && liveSnapshot !== null) return;
		if (liveSnapshotLoading && liveSnapshotBusinessId === businessId) return;

		const request = ++liveSnapshotRequest;
		liveSnapshotController?.abort();
		const controller = new AbortController();
		liveSnapshotController = controller;
		liveSnapshotLoading = true;
		liveSnapshotBusinessId = businessId;
		liveSnapshot = null;
		try {
			const response = await fetch('/odonto/agenda/buscar/precarga', {
				headers: { accept: 'application/json' },
				cache: 'no-store',
				signal: controller.signal
			});
			const payload = await response.json().catch(() => ({}));
			if (
				request !== liveSnapshotRequest ||
				businessId !== String(data.context.business?.id ?? '').trim()
			) {
				return;
			}
			if (!response.ok) return;
			liveSnapshot = Array.isArray(payload?.appointments)
				? payload.appointments.filter((appointment: Appointment) =>
						isUpcomingActiveAppointment(appointment)
					)
				: [];
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError' && request === liveSnapshotRequest) {
				// La precarga es oportunista: la búsqueda remota normal sigue activa.
				liveSnapshot = null;
			}
		} finally {
			if (request === liveSnapshotRequest) {
				liveSnapshotLoading = false;
				if (liveSnapshotController === controller) liveSnapshotController = null;
			}
		}
	};

	const loadLiveResults = async (query: string, request: number) => {
		const controller = new AbortController();
		liveController = controller;
		liveError = '';
		try {
			const response = await fetch(`/odonto/agenda/buscar?q=${encodeURIComponent(query)}`, {
				signal: controller.signal
			});
			const payload = await response.json();
			if (request !== liveRequest) return;
			if (!response.ok) {
				liveResults = { upcoming: [], past: [] };
				liveResolvedQuery = query;
				liveError = payload?.message ?? 'No pudimos buscar turnos ahora. Revisá tu conexión y volvé a intentar.';
				return;
			}
			const serverAppointments = [
				...(Array.isArray(payload?.upcoming) ? payload.upcoming : []),
				...(Array.isArray(payload?.past) ? payload.past : [])
			] as Appointment[];
			liveResults = splitLiveAppointmentGroups(serverAppointments);
			liveResolvedQuery = query;
		} catch (error) {
			if ((error as Error)?.name === 'AbortError') return;
			if (request !== liveRequest) return;
			liveResults = { upcoming: [], past: [] };
			liveResolvedQuery = query;
			liveError = 'No pudimos buscar turnos ahora. Revisá tu conexión y volvé a intentar.';
		} finally {
			if (request === liveRequest) {
				if (liveController === controller) liveController = null;
			}
		}
	};

	$effect(() => {
		const query = liveQuery;
		const request = ++liveRequest;
		liveController?.abort();
		liveController = null;
		liveError = '';
		if (!query) {
			liveResults = null;
			liveResolvedQuery = '';
			return;
		}
		const timeout = window.setTimeout(() => void loadLiveResults(query, request), 120);
		return () => {
			window.clearTimeout(timeout);
			if (request === liveRequest) liveController?.abort();
		};
	});

	const appointmentStatusLabel = (appointment: Pick<Appointment, 'starts_at' | 'status'>) =>
		isExpiredActiveAppointment(appointment)
			? 'Expirado'
			: (statusLabels[appointment.status] ?? appointment.status);
	const appointmentStatusTone = (appointment: Pick<Appointment, 'starts_at' | 'status'>) =>
		isExpiredActiveAppointment(appointment)
			? 'ux-badge ux-badge-warning'
			: (statusTone[appointment.status] ?? 'ux-badge');

	// Al navegar (botón "Buscar", flechas de día, "Hoy") mandan los filtros:
	// se limpia el buscador y la lista vuelve a los resultados del servidor.
	afterNavigate(({ to }) => {
		clearLiveSearch();
		clearLiveSnapshot();
		if (to?.url.pathname === '/odonto/agenda') void loadLiveSnapshot();
	});

	const upcomingOnly = (list: Appointment[]): AppointmentGroups => ({
		upcoming: list.filter((appointment: Appointment) => isUpcomingActiveAppointment(appointment)),
		past: []
	});
	const livePending = $derived(liveActive && liveResolvedQuery !== liveQuery);
	const displayGroups = $derived.by((): AppointmentGroups | null => {
		if (liveActive) {
			if (liveResolvedQuery === liveQuery && liveResults) return liveResults;
			return liveKnownGroups ?? { upcoming: [], past: [] };
		}
		if (data.anyDay) return upcomingOnly(data.appointments);
		return null;
	});
	const visibleCount = $derived(
		displayGroups ? displayGroups.upcoming.length + displayGroups.past.length : data.appointments.length
	);
	const resultLabel = $derived(
		liveActive && livePending && visibleCount === 0
			? '…'
			: `${visibleCount} ${visibleCount === 1 ? 'turno' : 'turnos'}`
	);

	const needsSetup = $derived(
		referencesLoaded && (professionals.length === 0 || services.length === 0)
	);

	const loadReferences = async () => {
		const snapshotCoversAgendaDate = Boolean(
			availabilitySnapshot &&
				snapshotContainsRange(availabilitySnapshot, data.date, data.date)
		);
		const snapshotIsFresh = Boolean(
			availabilitySnapshot &&
				Date.parse(availabilitySnapshot.valid_until) > Date.now()
		);
		if ((referencesLoaded && snapshotCoversAgendaDate && snapshotIsFresh) || referencesLoading) return;
		referencesLoading = true;
		referencesError = '';
		try {
			const response = await fetch(
				'/odonto/agenda/referencias?from=' + encodeURIComponent(data.date)
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(
					payload?.message ?? 'No se pudieron cargar profesionales y servicios.'
				);
			}
			professionals = Array.isArray(payload?.professionals) ? payload.professionals : [];
			services = Array.isArray(payload?.services) ? payload.services : [];
			serviceProfessionalIds = payload?.service_professional_ids ?? {};
			availabilitySnapshot = payload?.availability_snapshot ?? null;
			referencesLoaded = true;
		} catch (error) {
			referencesError =
				error instanceof Error
					? error.message
					: 'No se pudieron cargar profesionales y servicios.';
		} finally {
			referencesLoading = false;
		}
	};

	const loadPatientReferences = async () => {
		if (patientsLoaded || patientsLoading) return;
		patientsLoading = true;
		patientsError = '';
		try {
			const response = await fetch('/odonto/agenda/referencias?scope=patients');
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message ?? 'No se pudieron cargar los pacientes.');
			}
			const fetchedPatients = Array.isArray(payload?.patients) ? payload.patients : [];
			const knownPatients = new Map<string, Patient>();
			for (const patient of [...fetchedPatients, ...patients]) {
				knownPatients.set(patient.id, patient);
			}
			patients = [...knownPatients.values()];
			patientsLoaded = true;
		} catch (error) {
			patientsError =
				error instanceof Error ? error.message : 'No se pudieron cargar los pacientes.';
		} finally {
			patientsLoading = false;
		}
	};

	const scrollToElement = async (element: HTMLElement | null) => {
		await tick();
		if (!element) return;
		requestAnimationFrame(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	};

	const toggleCreate = async () => {
		showCreate = !showCreate;
		if (showCreate) {
			void loadReferences();
			await scrollToElement(createSection);
		}
	};

	const toggleSearch = async () => {
		showSearch = !showSearch;
		if (showSearch) {
			void loadLiveSnapshot();
			void loadReferences();
			await scrollToElement(searchSection);
		} else {
			clearLiveSnapshot();
		}
	};

	$effect(() => {
		const businessId = String(data.context.business?.id ?? '');
		if (businessId && referencesBusinessId && businessId !== referencesBusinessId) {
			clearLiveSearch();
			clearLiveSnapshot();
			professionals = [];
			services = [];
			patients = [];
			serviceProfessionalIds = {};
			availabilitySnapshot = null;
			referencesLoaded = false;
			referencesError = '';
			patientsLoaded = false;
			patientsLoading = false;
			patientsError = '';
		}
		referencesBusinessId = businessId;
		if (data.referencesLoaded) {
			professionals = data.professionals ?? [];
			services = data.services ?? [];
			patients = data.patients ?? [];
			serviceProfessionalIds = data.serviceProfessionalIds ?? {};
			availabilitySnapshot = data.availabilitySnapshot ?? null;
			referencesLoaded = true;
			patientsLoaded = Boolean(data.patientsLoaded);
			patientsLoading = false;
			patientsError = '';
		}
	});

	$effect(() => {
		if (initialized) return;
		showCreate = Boolean(form?.message || form?.phoneWarning || data.selectedPatientId);
		showSearch = Boolean(hasActiveSearch);
		// Recepción usa esta pantalla para operar: empezamos el snapshot en
		// background apenas abre /agenda, antes de que elija el primer servicio.
		if (canOperate || showCreate || showSearch) void loadReferences();
		initialized = true;
	});

	onDestroy(() => {
		liveController?.abort();
		liveSnapshotController?.abort();
	});
</script>

{#snippet appointmentRow(appointment: Appointment, showDate: boolean)}
	<a
		href={`/odonto/turnos/${appointment.id}?from_date=${showDate ? localDateOf(appointment.starts_at) : data.date}`}
		class="ux-choice flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4"
	>
		<div class={`shrink-0 text-center ${showDate ? 'w-16 sm:w-24' : 'w-14 sm:w-20'}`}>
			{#if showDate}
				<p class="text-[11px] font-bold uppercase tracking-wide text-[#c4b5fd]">{shortDayLabel(appointment.starts_at)}</p>
			{/if}
			<p class="text-xl font-bold text-white sm:text-2xl">{timeOnly(appointment.starts_at)}</p>
			<p class="mt-0.5 text-xs text-white/40">{timeOnly(appointment.ends_at)}</p>
		</div>
		<div class="min-w-0 flex-1">
			<p class="truncate text-base font-bold text-white sm:text-lg">{appointment.patients?.full_name ?? 'Paciente'}</p>
			<p class="mt-0.5 truncate text-sm text-white/55">
				{appointment.service_name_snapshot} · {appointment.professional_name_snapshot}
			</p>
			<div class="mt-2 flex flex-wrap gap-2">
				<span class={appointmentStatusTone(appointment)}>{appointmentStatusLabel(appointment)}</span>
				{#if appointment.source === 'public_booking'}<span class="ux-badge">Online</span>{/if}
			</div>
		</div>
		<svg class="h-5 w-5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
	</a>
{/snippet}

<section class="ux-page gap-6 sm:gap-5">
	<div class="ux-hero">
		<div class="flex items-center gap-2">
			{#if !data.anyDay}
				<a
					href={buildAgendaHref(prevDate)}
					class="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80 transition hover:bg-white/10 sm:h-11 sm:w-11"
					aria-label="Día anterior"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg>
				</a>
			{/if}
			<div class="min-w-0 flex-1 text-center">
				<h1 class="text-lg font-bold leading-tight tracking-tight text-white sm:text-2xl lg:text-4xl">
					{data.anyDay ? 'Cualquier día' : dayLabel(data.date)}
				</h1>
			</div>
			{#if !data.anyDay}
				<a
					href={buildAgendaHref(nextDate)}
					class="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/80 transition hover:bg-white/10 sm:h-11 sm:w-11"
					aria-label="Día siguiente"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6" /></svg>
				</a>
			{/if}
		</div>

		<div class="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-3 sm:mt-5 sm:gap-2 sm:justify-start">
			{#if canOperate}
				<button
					type="button"
					class="ux-btn-primary w-full sm:w-auto"
					onclick={toggleCreate}
					onpointerenter={() => void loadReferences()}
					onfocus={() => void loadReferences()}
				>
					{showCreate ? 'Cerrar' : '+ Nuevo turno'}
				</button>
			{/if}
			{#if !isToday}
				<a href={buildAgendaHref(todayStr)} class="ux-btn-secondary">Hoy</a>
			{/if}
			<button
				type="button"
				class="ux-btn-secondary"
				onclick={toggleSearch}
				onpointerenter={() => void loadLiveSnapshot()}
				onfocus={() => void loadLiveSnapshot()}
			>
				{showSearch ? 'Ocultar búsqueda' : 'Buscar'}
			</button>
			<a href={weekHref} class="ux-btn-secondary">Ver turnos de la semana</a>
		</div>
	</div>

	{#if form?.message}
		<p class="ux-alert">{form.message}</p>
	{/if}

	{#if statCount('reschedule_requested') > 0}
		<div class="ux-alert ux-alert-warning">
			{statCount('reschedule_requested')} {statCount('reschedule_requested') === 1 ? 'turno pidió' : 'turnos pidieron'} reprogramación.
		</div>
	{/if}

	{#if (data.reminderCount ?? 0) > 0}
		<div class="ux-alert ux-alert-warning">
			📋 {data.reminderCount}{' '}
			{data.reminderCount === 1
				? 'turno de mañana sin calendario iniciado ni notificación confirmada'
				: 'turnos de mañana sin calendario iniciado ni notificación confirmada'}.
			<a href="/odonto/recordatorios" class="font-bold underline">Ver turnos para recordar</a>
		</div>
	{/if}

	{#if needsSetup}
		<div class="ux-card">
			<h2 class="ux-section-title">Antes de tomar turnos</h2>
			<p class="mt-1 text-sm text-white/55">Completá lo básico para poder agendar.</p>
			<div class="mt-4 flex flex-wrap gap-2">
				{#if professionals.length === 0}
					<a href="/odonto/configuracion/usuarios" class="ux-btn-primary">Agregar profesional</a>
				{:else if services.length === 0}
					<a href="/odonto/configuracion/usuarios" class="ux-btn-secondary">Cargar servicio</a>
				{/if}
			</div>
		</div>
	{/if}

	{#if showSearch}
		<div transition:slide={{ duration: 180 }} class="ux-card scroll-mt-5" bind:this={searchSection}>
			<label>
				<span class="ux-label">Paciente o teléfono</span>
				<input
					type="search"
					bind:value={searchInput}
					placeholder="Ej: Juan Carlos"
					autocomplete="off"
					class="ux-input"
					onfocus={() => void loadLiveSnapshot()}
				/>
			</label>
			<p class="mt-2 text-xs font-semibold text-white/40">Busca turnos activos mientras escribís.</p>
			{#if referencesError}
				<div class="ux-alert mt-3">
					{referencesError}
					<button type="button" class="ml-2 font-bold underline" onclick={loadReferences}>Reintentar</button>
				</div>
			{/if}

			<div class="my-5 flex items-center gap-3" aria-hidden="true">
				<span class="h-px flex-1 bg-white/10"></span>
				<span class="text-xs font-bold uppercase tracking-wide text-white/40">O buscá con filtros</span>
				<span class="h-px flex-1 bg-white/10"></span>
			</div>

			<form method="GET" class="grid gap-4 lg:grid-cols-[1.15fr_1fr_1fr_1fr_auto]">
				<div>
					<span class="ux-label">Día</span>
					<DayFilterPicker value={data.anyDay ? 'any' : data.date} />
				</div>
				<label>
					<span class="ux-label">Profesional</span>
					<select name="professional_id" class="ux-select" disabled={referencesLoading}>
						<option value="">Todos</option>
						{#each professionals as professional}
							<option value={professional.id} selected={professional.id === data.selectedProfessionalId}>{professional.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="ux-label">Servicio</span>
					<select name="service_id" class="ux-select" disabled={referencesLoading}>
						<option value="">Todos</option>
						{#each services as service}
							<option value={service.id} selected={service.id === data.selectedServiceId}>{service.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span class="ux-label">Estado</span>
					<select name="status" class="ux-select">
						<option value="">Todos</option>
						{#each statusFilterEntries as [value, label]}
							<option value={value} selected={value === data.selectedStatus}>{label}</option>
						{/each}
					</select>
				</label>
				<button class="ux-btn-primary self-end">Buscar</button>
			</form>
			{#if hasActiveSearch}
				<a href={`/odonto/agenda?date=${data.date}`} class="mt-3 inline-block text-sm font-semibold text-[#c4b5fd] hover:underline">
					Limpiar filtros
				</a>
			{/if}
		</div>
	{/if}

	{#if showCreate}
		<div transition:slide={{ duration: 180 }} class="scroll-mt-5" bind:this={createSection}>
			{#if referencesLoading && !referencesLoaded}
				<div class="ux-card text-sm font-semibold text-white/60" aria-live="polite">
					Cargando profesionales y servicios…
				</div>
			{:else if referencesError && !referencesLoaded}
				<div class="ux-card">
					<p class="ux-alert">{referencesError}</p>
					<button type="button" class="ux-btn-secondary mt-4" onclick={loadReferences}>Reintentar</button>
				</div>
			{:else if referencesLoaded}
				<ManualAppointmentWizard
					{services}
					{professionals}
					{serviceProfessionalIds}
					{availabilitySnapshot}
					{patients}
					{patientsLoaded}
					{patientsLoading}
					{patientsError}
					onNeedPatients={loadPatientReferences}
					initialDate={data.date}
					initialPatientId={data.selectedPatientId}
					appointmentRequestId={data.appointmentRequestId}
					{canOperate}
					{form}
				/>
			{/if}
		</div>
	{/if}

	<div class="ux-card p-4 sm:p-6">
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<h2 class="ux-section-title">
					{liveActive ? 'Resultado del buscador' : hasActiveSearch ? 'Resultado de búsqueda' : 'Turnos del día'}
				</h2>
				{#if liveActive}
					<p class="mt-1 truncate text-sm font-semibold text-white/50">“{liveQuery}”</p>
				{:else if searchSummary}
					<p class="mt-1 truncate text-sm font-semibold text-white/50">{searchSummary}</p>
				{/if}
			</div>
			<span class="ux-badge shrink-0">{resultLabel}</span>
		</div>

		{#if liveActive && liveError}
			<p class="ux-alert mt-4">{liveError}</p>
		{/if}

		{#if displayGroups}
			{#if visibleCount > 0}
				<div class="mt-5 grid gap-5">
					{#if displayGroups.upcoming.length > 0}
						<div>
							<p class="text-xs font-bold uppercase tracking-wide text-white/40">Próximos</p>
							<div class="mt-2 grid gap-3">
								{#each displayGroups.upcoming as appointment (appointment.id)}
									{@render appointmentRow(appointment, true)}
								{/each}
							</div>
						</div>
					{/if}
					{#if displayGroups.past.length > 0}
						<div>
							<p class="text-xs font-bold uppercase tracking-wide text-white/40">Expirados</p>
							<div class="mt-2 grid gap-3">
								{#each displayGroups.past as appointment (appointment.id)}
									{@render appointmentRow(appointment, true)}
								{/each}
							</div>
						</div>
					{/if}
				</div>
				{#if !liveActive && data.anyDayLimited}
					<p class="mt-4 text-sm font-semibold text-white/45">
						Mostramos los turnos más cercanos a hoy. Refiná los filtros para acotar la búsqueda.
					</p>
				{/if}
			{:else if liveActive && livePending}
				<!-- Esperando la primera respuesta del buscador. -->
			{:else if liveActive}
				<div class="mt-5">
					<EmptyState
						title="Sin resultados"
						description={`No encontramos pacientes con nombre o teléfono que coincidan con “${liveQuery}”.`}
					/>
				</div>
			{:else}
				<div class="mt-5">
					<EmptyState
						title="Sin resultados"
						description="No encontramos turnos con esa búsqueda. Probá con otros filtros."
					/>
				</div>
			{/if}
		{:else if data.appointments.length === 0}
			<div class="mt-5">
				{#if hasActiveSearch}
					<EmptyState
						title="Sin resultados"
						description="No encontramos turnos con esa búsqueda. Probá con otros filtros."
					/>
				{:else}
					<EmptyState
						title="No hay turnos para este día"
						description={canOperate ? 'Agendá el primero o revisá otro día.' : 'Revisá otro día.'}
					>
						{#snippet actions()}
							<a href={buildAgendaHref(nextDate)} class="ux-btn-secondary">Día siguiente</a>
						{/snippet}
					</EmptyState>
				{/if}
			</div>
		{:else}
			<div class="mt-5 grid gap-3">
				{#each data.appointments as appointment (appointment.id)}
					{@render appointmentRow(appointment, false)}
				{/each}
			</div>
		{/if}
	</div>
</section>
