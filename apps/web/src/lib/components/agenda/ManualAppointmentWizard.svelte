<script lang="ts">
	import {
		calculateAvailabilitySlots,
		type AvailabilitySlot
	} from '$lib/availability/calculate';
	import {
		snapshotContainsRange,
		type AvailabilitySnapshot,
		type AvailabilitySnapshotAssignment,
		type AvailabilitySnapshotProfessional,
		type AvailabilitySnapshotService
	} from '$lib/availability/snapshot';
	import { classifyCommunicationPhone } from '$lib/utils/communication-phone';
	import { onDestroy, tick, untrack } from 'svelte';

	type Service = { id: string; name: string; duration_minutes: number };
	type Professional = {
		id: string;
		name: string;
		specialty?: string | null;
		is_active: boolean;
	};
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
	type Slot = AvailabilitySlot;
	type PhoneWarningKind = 'missing' | 'invalid';

	let {
		services,
		professionals,
		serviceProfessionalIds,
		availabilitySnapshot = null,
		patients,
		patientsLoaded = false,
		patientsLoading = false,
		patientsError = '',
		onNeedPatients = () => undefined,
		initialDate,
		initialPatientId = '',
		appointmentRequestId,
		canOperate,
		form
	} = $props<{
		services: Service[];
		professionals: Professional[];
		serviceProfessionalIds: Record<string, string[]>;
		availabilitySnapshot?: AvailabilitySnapshot | null;
		patients: Patient[];
		patientsLoaded?: boolean;
		patientsLoading?: boolean;
		patientsError?: string;
		onNeedPatients?: () => void | Promise<void>;
		initialDate: string;
		initialPatientId?: string;
		appointmentRequestId: string;
		canOperate: boolean;
		form?: {
			message?: string;
			phoneWarning?: { kind: PhoneWarningKind };
			values?: Record<string, unknown>;
		};
	}>();

	const value = (key: string) => String(form?.values?.[key] ?? '');
	const today = () => new Date().toISOString().slice(0, 10);
	const addDays = (date: string, days: number) => {
		const next = new Date(date + 'T12:00:00');
		next.setDate(next.getDate() + days);
		return next.toISOString().slice(0, 10);
	};
	const safeStartDate = () => {
		const current = today();
		return initialDate && initialDate >= current ? initialDate : current;
	};
	const formatDayName = (date: string) =>
		new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(new Date(date + 'T12:00:00'));
	const formatDayNumber = (date: string) =>
		new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' }).format(
			new Date(date + 'T12:00:00')
		);
	const formatLongDate = (date: string) =>
		new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }).format(
			new Date(date + 'T12:00:00')
		);
	const durationLabel = (minutes: number) =>
		String(minutes) + ' ' + (minutes === 1 ? 'minuto' : 'minutos');
	const patientDateFormatter = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC' });
	const initialsFor = (name: string) =>
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');

	const stepLabels = ['Servicio', 'Profesional', 'Día', 'Horario', 'Paciente'];
	const initialStep = () => {
		if (value('time')) return 5;
		if (value('date') && (value('professional_id') || value('professional_ids'))) return 4;
		if (value('professional_id') || value('professional_ids')) return 3;
		if (value('service_id')) return 2;
		return 1;
	};
	const getInitialPatientSelection = () => value('patient_id') || initialPatientId;
	const initialProfessionalIds = value('professional_ids')
		.split(',')
		.map((professionalId) => professionalId.trim())
		.filter(Boolean);

	let step = $state(initialStep());
	let selectedServiceId = $state(value('service_id'));
	let bookingMode = $state<'individual' | 'joint'>(
		value('booking_mode') === 'joint' ? 'joint' : 'individual'
	);
	let selectedProfessionalIds = $state<string[]>(initialProfessionalIds);
	let selectedProfessionalId = $state(value('professional_id') || initialProfessionalIds[0] || '');
	let visibleWeekStart = $state(value('date') || safeStartDate());
	let selectedSlotDate = $state(value('time') ? value('date') : '');
	let selectedSlotStartsAt = $state('');
	let patientMode = $state<'existing' | 'new'>(getInitialPatientSelection() ? 'existing' : 'new');
	let selectedPatientId = $state(getInitialPatientSelection());
	let patientName = $state(value('patient_name'));
	let patientPhone = $state(value('patient_phone'));
	let newPatientPhoneDraft = $state(
		untrack(() => (patientMode === 'new' ? value('patient_phone') : ''))
	);
	let patientEmail = $state(value('patient_email'));
	let patientSearch = $state('');
	let internalNote = $state(value('internal_note'));
	let idempotencyKey = $state(
		untrack(() => value('idempotency_key') || appointmentRequestId)
	);
	let pendingInitialTime = $state(value('time'));
	let ignoreBreak = $state(value('ignore_break') === 'true');
	let slots = $state<Slot[]>([]);
	let loadingSlots = $state(false);
	let slotsLoaded = $state(false);
	let slotsError = $state('');
	let slotRequest = 0;
	let slotAbortController: AbortController | null = null;
	let remotePatients = $state<Patient[]>([]);
	let patientSearchLoading = $state(false);
	let patientSearchError = $state('');
	let patientSearchRequest = 0;
	let appointmentForm = $state<HTMLFormElement | null>(null);
	let phoneInput = $state<HTMLInputElement | null>(null);
	let patientPhoneChanged = $state(value('patient_phone_changed') === 'true');
	let phoneWarningOverride = $state<'' | PhoneWarningKind>(
		value('phone_warning_override') === 'missing' || value('phone_warning_override') === 'invalid'
			? (value('phone_warning_override') as PhoneWarningKind)
			: ''
	);
	let phoneWarning = $state<PhoneWarningKind | null>(
		untrack(() => form?.phoneWarning?.kind ?? null)
	);
	let phoneNeedsAttention = $state(false);
	let hydratedPatientId = untrack(() => (value('patient_phone') ? selectedPatientId : ''));
	let appliedFormResult = untrack(() => form);

	onDestroy(() => slotAbortController?.abort());

	const selectedService = $derived(
		services.find((service: Service) => service.id === selectedServiceId) ?? null
	);
	const offeredProfessionalIds = $derived(serviceProfessionalIds[selectedServiceId] ?? []);
	const offeringProfessionals = $derived(
		professionals.filter((professional: Professional) => offeredProfessionalIds.includes(professional.id))
	);
	const selectedTeam = $derived(
		selectedProfessionalIds
			.map(
				(professionalId) =>
					offeringProfessionals.find(
						(professional: Professional) => professional.id === professionalId
					) ?? null
			)
			.filter((professional): professional is Professional => Boolean(professional))
	);
	const hasValidProfessionalSelection = $derived(
		bookingMode === 'joint'
			? selectedTeam.length >= 2
			: Boolean(selectedProfessionalId)
	);
	const selectedProfessional = $derived(
		professionals.find((professional: Professional) => professional.id === selectedProfessionalId) ?? null
	);
	const weekDays = $derived(Array.from({ length: 7 }, (_, index) => addDays(visibleWeekStart, index)));
	const professionalSlots = $derived(
		slots.filter(
			(slot) =>
				weekDays.includes(slot.date) &&
				(bookingMode === 'joint'
					? selectedProfessionalIds.every((professionalId) =>
							slot.professional_ids?.includes(professionalId)
						)
					: slot.professional_id === selectedProfessionalId)
		)
	);
	const slotsByDay = $derived(
		weekDays
			.map((day) => ({
				day,
				slots: professionalSlots.filter((slot) => slot.date === day)
			}))
			.filter((day) => day.slots.length > 0)
	);
	const selectedDaySlots = $derived(
		professionalSlots.filter((slot) => slot.date === selectedSlotDate)
	);
	const morningSlots = $derived(
		selectedDaySlots.filter((slot) => Number(slot.time.slice(0, 2)) < 12)
	);
	const afternoonSlots = $derived(
		selectedDaySlots.filter((slot) => Number(slot.time.slice(0, 2)) >= 12)
	);
	const selectedSlot = $derived(
		professionalSlots.find((slot) => slot.starts_at === selectedSlotStartsAt) ?? null
	);
	const patientCandidates = $derived(patientSearch.trim().length >= 1 ? remotePatients : patients);
	const visiblePatients = $derived(
		patientCandidates
			.filter((patient: Patient) => !patient.blocked)
			.filter((patient: Patient) => {
				const query = patientSearch.trim().toLowerCase();
				if (patientSearch.trim().length >= 1) return true;
				if (!query) return true;
				return (
					patient.full_name.toLowerCase().includes(query) ||
					(patient.phone_e164 ?? '').toLowerCase().includes(query)
				);
			})
			.slice(0, patientSearch.trim().length >= 1 ? 12 : 8)
	);
	const selectedPatient = $derived(
		[...patients, ...remotePatients].find((patient: Patient) => patient.id === selectedPatientId) ??
			null
	);
	const canUseExistingPatient = $derived(patientMode === 'existing' && Boolean(selectedPatientId));
	const canUseNewPatient = $derived(patientMode === 'new' && patientName.trim().length >= 2);
	const canCreate = $derived(
		Boolean(
			selectedService &&
				hasValidProfessionalSelection &&
				selectedSlot &&
				(canUseExistingPatient || canUseNewPatient)
		)
	);

	const clearSlotSelection = () => {
		selectedSlotDate = '';
		selectedSlotStartsAt = '';
	};

	const restart = () => {
		slotRequest += 1;
		step = 1;
		selectedServiceId = '';
		bookingMode = 'individual';
		selectedProfessionalId = '';
		selectedProfessionalIds = [];
		visibleWeekStart = safeStartDate();
		clearSlotSelection();
		selectedPatientId = '';
		patientMode = 'new';
		patientName = '';
		patientPhone = '';
		newPatientPhoneDraft = '';
		patientEmail = '';
		patientSearch = '';
		internalNote = '';
		idempotencyKey = crypto.randomUUID();
		patientPhoneChanged = false;
		phoneWarningOverride = '';
		phoneWarning = null;
		phoneNeedsAttention = false;
		hydratedPatientId = '';
		ignoreBreak = false;
		slots = [];
		slotsLoaded = false;
		loadingSlots = false;
		slotsError = '';
	};

	const selectService = (serviceId: string) => {
		slotRequest += 1;
		selectedServiceId = serviceId;
		bookingMode = 'individual';
		selectedProfessionalId = '';
		selectedProfessionalIds = [];
		clearSlotSelection();
		selectedPatientId = '';
		slots = [];
		slotsLoaded = false;
		slotsError = '';
		visibleWeekStart = safeStartDate();
		step = 2;
	};

	const selectProfessional = (professionalId: string) => {
		slotRequest += 1;
		bookingMode = 'individual';
		selectedProfessionalId = professionalId;
		selectedProfessionalIds = [professionalId];
		clearSlotSelection();
		slots = [];
		slotsLoaded = false;
		visibleWeekStart = safeStartDate();
		step = 3;
	};

	const selectBookingMode = (mode: 'individual' | 'joint') => {
		if (bookingMode === mode) return;
		slotRequest += 1;
		bookingMode = mode;
		selectedProfessionalId = '';
		selectedProfessionalIds = [];
		clearSlotSelection();
		slots = [];
		slotsLoaded = false;
		loadingSlots = false;
		slotsError = '';
	};

	const toggleTeamProfessional = (professionalId: string) => {
		slotRequest += 1;
		if (selectedProfessionalIds.includes(professionalId)) {
			selectedProfessionalIds = selectedProfessionalIds.filter(
				(selectedId) => selectedId !== professionalId
			);
		} else {
			selectedProfessionalIds = [...selectedProfessionalIds, professionalId];
		}
		selectedProfessionalId = selectedProfessionalIds[0] ?? '';
		clearSlotSelection();
		slots = [];
		slotsLoaded = false;
		loadingSlots = false;
		slotsError = '';
	};

	const continueWithTeam = () => {
		if (selectedTeam.length < 2) return;
		const firstAvailableDate = slots[0]?.date ?? safeStartDate();
		// `slots` ya contiene un día válido por fecha para el equipo. Conservarlo
		// evita dejar el paso siguiente vacío cuando la primera fecha disponible
		// coincide con `visibleWeekStart` y, por lo tanto, no dispara otra carga.
		visibleWeekStart = firstAvailableDate;
		clearSlotSelection();
		step = 3;
	};

	const selectDay = (date: string) => {
		slotRequest += 1;
		selectedSlotDate = date;
		selectedSlotStartsAt = '';
		slots = [];
		slotsLoaded = false;
		step = 4;
	};

	const selectSlot = (slot: Slot) => {
		selectedSlotStartsAt = slot.starts_at;
		step = 5;
	};

	const patientPhoneValue = (patient: Patient | null) =>
		String(patient?.phone_raw ?? patient?.phone ?? patient?.phone_e164 ?? '').trim();
	const patientDisambiguation = (patient: Patient) => {
		const activityDate = new Date(patient.activity_at);
		const details = [
			patient.phone_e164,
			patient.dni ? `DNI ${patient.dni}` : null,
			patient.birth_date
				? `Nac. ${patientDateFormatter.format(new Date(`${patient.birth_date}T00:00:00Z`))}`
				: null,
			Number.isNaN(activityDate.getTime())
				? null
				: `Últ. actividad ${patientDateFormatter.format(activityDate)}`
		].filter(Boolean);
		return details.join(' · ');
	};

	const selectPatient = (patient: Patient) => {
		selectedPatientId = patient.id;
		patientPhone = patientPhoneValue(patient);
		patientPhoneChanged = false;
		phoneWarningOverride = '';
		phoneWarning = null;
		phoneNeedsAttention = false;
		hydratedPatientId = patient.id;
	};

	const selectPatientMode = (mode: 'existing' | 'new') => {
		if (mode === patientMode) return;
		if (patientMode === 'new') newPatientPhoneDraft = patientPhone;
		patientMode = mode;
		phoneWarningOverride = '';
		phoneWarning = null;
		phoneNeedsAttention = false;
		if (mode === 'new') {
			selectedPatientId = '';
			patientPhone = newPatientPhoneDraft;
			patientPhoneChanged = false;
			hydratedPatientId = '';
		}
	};

	const handlePhoneInput = () => {
		const shouldKeepAttention = phoneNeedsAttention || Boolean(phoneWarning);
		patientPhoneChanged = patientMode === 'existing';
		if (patientMode === 'new') newPatientPhoneDraft = patientPhone;
		phoneWarningOverride = '';
		phoneWarning = null;
		phoneNeedsAttention = shouldKeepAttention;
	};

	const correctPhone = async () => {
		phoneWarning = null;
		phoneWarningOverride = '';
		phoneNeedsAttention = true;
		await tick();
		phoneInput?.focus();
		phoneInput?.select();
	};

	const confirmWithoutPhone = async () => {
		if (!phoneWarning) return;
		phoneWarningOverride = phoneWarning;
		phoneWarning = null;
		phoneNeedsAttention = false;
		await tick();
		appointmentForm?.requestSubmit();
	};

	const validatePhoneBeforeSubmit = (event: SubmitEvent) => {
		const decision = classifyCommunicationPhone(patientPhone);
		if (decision.status === 'valid') {
			phoneWarning = null;
			phoneWarningOverride = '';
			phoneNeedsAttention = false;
			return;
		}
		if (phoneWarningOverride === decision.status) return;
		event.preventDefault();
		phoneWarningOverride = '';
		phoneWarning = decision.status;
		phoneNeedsAttention = false;
	};

	const changeWeek = (days: number) => {
		slotRequest += 1;
		visibleWeekStart = addDays(visibleWeekStart, days);
		clearSlotSelection();
		slots = [];
		slotsLoaded = false;
	};

	const changeDay = () => {
		slotRequest += 1;
		clearSlotSelection();
		slots = [];
		slotsLoaded = false;
		step = 3;
	};

	const calculateSnapshotSlots = (input: {
		serviceId: string;
		fromDate: string;
		toDate: string;
		professionalId: string;
		teamProfessionalIds: string[];
		shouldIgnoreBreak: boolean;
		maxSlotsPerDate?: number;
	}): Slot[] | null => {
		const snapshot = availabilitySnapshot;
		if (!snapshot || !snapshotContainsRange(snapshot, input.fromDate, input.fromDate)) return null;
		// Nunca afirmamos que una semana está vacía usando un snapshot que sólo
		// cubre una parte de esos siete días. En ese borde se consulta al servidor.
		if (input.maxSlotsPerDate && snapshot.to_date < addDays(input.fromDate, 6)) return null;
		const calculationToDate =
			input.toDate <= snapshot.to_date ? input.toDate : snapshot.to_date;
		const service = snapshot.services.find(
			(candidate: AvailabilitySnapshotService) => candidate.id === input.serviceId
		);
		if (!service) return [];
		const assignedProfessionalIds = new Set(
			snapshot.assignments
				.filter(
					(assignment: AvailabilitySnapshotAssignment) =>
						assignment.service_id === input.serviceId
				)
				.map((assignment: AvailabilitySnapshotAssignment) => assignment.professional_id)
		);
		const requiredProfessionalIds =
			input.teamProfessionalIds.length >= 2
				? input.teamProfessionalIds
				: input.professionalId
					? [input.professionalId]
					: [];
		if (
			requiredProfessionalIds.length === 0 ||
			requiredProfessionalIds.some((professionalId) => !assignedProfessionalIds.has(professionalId))
		) {
			return [];
		}
		const generatedAt = new Date(snapshot.generated_at);
		if (Number.isNaN(generatedAt.getTime())) return null;
		return calculateAvailabilitySlots({
			business: snapshot.business,
			service,
			professionals: snapshot.professionals.filter(
				(professional: AvailabilitySnapshotProfessional) =>
					assignedProfessionalIds.has(professional.id)
			),
			rules: snapshot.rules,
			exceptions: snapshot.exceptions,
			blocks: snapshot.blocks,
			fromDate: input.fromDate,
			toDate: calculationToDate,
			requiredProfessionalIds,
			ignoreBreak: input.shouldIgnoreBreak,
			now: generatedAt,
			maxSlotsPerDate: input.maxSlotsPerDate
		});
	};

	const loadServiceSlots = async (
		input: {
			serviceId: string;
			fromDate: string;
			toDate: string;
			professionalId: string;
			teamProfessionalIds: string[];
			shouldIgnoreBreak: boolean;
			maxSlotsPerDate?: number;
		},
		options: { silent?: boolean } = {}
	) => {
		const silent = options.silent === true;
		slotAbortController?.abort();
		const controller = new AbortController();
		slotAbortController = controller;
		const request = ++slotRequest;
		if (!silent) {
			loadingSlots = true;
			slotsLoaded = false;
			slotsError = '';
		}
		try {
			const params = new URLSearchParams({
				service_id: input.serviceId,
				from: input.fromDate,
				to: input.toDate,
				ignore_break: input.shouldIgnoreBreak ? 'true' : 'false'
			});
			if (input.professionalId) params.set('professional_id', input.professionalId);
			if (input.teamProfessionalIds.length >= 2) {
				params.set('professional_ids', input.teamProfessionalIds.join(','));
			}
			if (input.maxSlotsPerDate) {
				params.set('max_slots_per_date', String(input.maxSlotsPerDate));
			}
			const response = await fetch('/odonto/disponibilidad/slots?' + params.toString(), {
				signal: controller.signal
			});
			const payload = await response.json().catch(() => ({}));
			if (request !== slotRequest) return;
			if (!response.ok) {
				if (silent) return;
				slots = [];
				slotsError =
					payload?.message ??
					'No pudimos cargar los horarios. No se reservó nada. Revisá la conexión y volvé a intentar.';
				return;
			}
			const liveSlots: Slot[] = Array.isArray(payload?.slots) ? payload.slots : [];
			slots = liveSlots;
			slotsLoaded = true;
			if (
				silent &&
				selectedSlotStartsAt &&
				!liveSlots.some((slot) => slot.starts_at === selectedSlotStartsAt)
			) {
				selectedSlotStartsAt = '';
				step = 4;
				slotsError =
					'Ese horario acaba de dejar de estar disponible. Elegí otra de las opciones actualizadas.';
			}
		} catch (error) {
			if (request !== slotRequest) return;
			if (error instanceof DOMException && error.name === 'AbortError') return;
			if (silent) return;
			slots = [];
			slotsError =
				'No pudimos cargar los horarios porque se interrumpió la conexión. No se reservó nada. Revisá internet y volvé a intentar.';
		} finally {
			if (request === slotRequest) {
				if (!silent) loadingSlots = false;
				if (slotAbortController === controller) slotAbortController = null;
			}
		}
	};

	const loadPatients = async (query: string) => {
		const request = ++patientSearchRequest;
		patientSearchLoading = true;
		patientSearchError = '';
		try {
			const response = await fetch('/odonto/pacientes/buscar?q=' + encodeURIComponent(query));
			const payload = await response.json().catch(() => ({}));
			if (request !== patientSearchRequest) return;
			if (!response.ok) {
				remotePatients = [];
					patientSearchError = payload?.message ?? 'No pudimos buscar pacientes para crear el turno. Revisá tu conexión y volvé a intentar.';
				return;
			}
			remotePatients = Array.isArray(payload?.patients) ? payload.patients : [];
		} catch {
			if (request !== patientSearchRequest) return;
			remotePatients = [];
			patientSearchError = 'No pudimos buscar pacientes para crear el turno. Revisá tu conexión y volvé a intentar.';
		} finally {
			if (request === patientSearchRequest) patientSearchLoading = false;
		}
	};

	$effect(() => {
		const serviceId = selectedServiceId;
		const individualProfessionalId = bookingMode === 'individual' ? selectedProfessionalId : '';
		const teamProfessionalIds =
			bookingMode === 'joint' && selectedProfessionalIds.length >= 2
				? [...selectedProfessionalIds]
				: [];
		if (!serviceId || (!individualProfessionalId && teamProfessionalIds.length < 2)) {
			slotAbortController?.abort();
			slotAbortController = null;
			slotRequest += 1;
			slots = [];
			slotsLoaded = false;
			loadingSlots = false;
			slotsError = '';
			return;
		}

		const isTimeRequest = Boolean(selectedSlotDate);
		const fromDate = isTimeRequest ? selectedSlotDate : visibleWeekStart || safeStartDate();
		const requestInput = {
			serviceId,
			fromDate,
			toDate: isTimeRequest ? fromDate : addDays(fromDate, 27),
			professionalId: individualProfessionalId,
			teamProfessionalIds,
			shouldIgnoreBreak: ignoreBreak,
			maxSlotsPerDate: isTimeRequest ? undefined : 1
		};
		const snapshotSlots = calculateSnapshotSlots(requestInput);
		if (snapshotSlots !== null) {
			slotAbortController?.abort();
			slotAbortController = null;
			slotRequest += 1;
			slots = snapshotSlots;
			slotsLoaded = true;
			loadingSlots = false;
			slotsError = '';
			if (isTimeRequest) {
				void loadServiceSlots(requestInput, { silent: true });
			}
			return;
		}
		void loadServiceSlots(requestInput);
	});

	$effect(() => {
		if (bookingMode === 'joint') {
			const validIds = selectedProfessionalIds.filter((professionalId) =>
				offeringProfessionals.some(
					(professional: Professional) => professional.id === professionalId
				)
			);
			if (validIds.length !== selectedProfessionalIds.length) {
				selectedProfessionalIds = validIds;
				selectedProfessionalId = validIds[0] ?? '';
				clearSlotSelection();
				step = 2;
			}
			return;
		}
		if (
			selectedProfessionalId &&
			!offeringProfessionals.some(
				(professional: Professional) => professional.id === selectedProfessionalId
			)
		) {
			selectedProfessionalId = '';
			selectedProfessionalIds = [];
			clearSlotSelection();
			step = 2;
		}
	});

	const updateIgnoreBreak = (event: Event) => {
		slotRequest += 1;
		ignoreBreak = (event.currentTarget as HTMLInputElement).checked;
		clearSlotSelection();
		slots = [];
		slotsLoaded = false;
		if (step > 3) step = 3;
	};

	$effect(() => {
		if (slots.length === 0 || !pendingInitialTime || !selectedSlotDate) return;
		const initialSlot = slots.find(
			(slot) => slot.date === selectedSlotDate && slot.time === pendingInitialTime
		);
		if (initialSlot) {
			selectedSlotStartsAt = initialSlot.starts_at;
			pendingInitialTime = '';
			step = 5;
		}
	});

	$effect(() => {
		const query = patientSearch.trim();
		if (query.length < 1) {
			remotePatients = [];
			patientSearchLoading = false;
			patientSearchError = '';
			return;
		}
		const timeout = window.setTimeout(() => void loadPatients(query), 120);
		return () => window.clearTimeout(timeout);
	});

	$effect(() => {
		const result = form;
		if (result === appliedFormResult) return;
		appliedFormResult = result;
		const warning = result?.phoneWarning?.kind;
		if (!warning) return;
		const serverPhone = String(result.values?.patient_phone ?? patientPhone);
		patientPhone = serverPhone;
		if (patientMode === 'new') newPatientPhoneDraft = serverPhone;
		patientPhoneChanged = result.values?.patient_phone_changed === 'true';
		phoneWarningOverride = '';
		phoneWarning = warning;
		phoneNeedsAttention = false;
	});

	$effect(() => {
		const patient = selectedPatient;
		if (patientMode !== 'existing' || !patient || hydratedPatientId === patient.id) return;
		patientPhone = patientPhoneValue(patient);
		patientPhoneChanged = false;
		hydratedPatientId = patient.id;
	});

	$effect(() => {
		if (
			step !== 5 ||
			patientMode !== 'existing' ||
			patientsLoaded ||
			patientsLoading ||
			patientsError
		) {
			return;
		}
		void onNeedPatients();
	});
</script>

<form bind:this={appointmentForm} method="POST" action="?/create_appointment" class="mx-auto grid w-full max-w-5xl gap-4" onsubmit={validatePhoneBeforeSubmit}>
	<input type="hidden" name="service_id" value={selectedServiceId} />
	<input type="hidden" name="booking_mode" value={bookingMode} />
	<input type="hidden" name="patient_mode" value={patientMode} />
	<input type="hidden" name="idempotency_key" value={idempotencyKey} />
	<input type="hidden" name="professional_id" value={selectedProfessionalId} />
	{#each selectedProfessionalIds as professionalId}
		<input type="hidden" name="professional_ids" value={professionalId} />
	{/each}
	<input type="hidden" name="date" value={selectedSlot?.date || selectedSlotDate || visibleWeekStart} />
	<input type="hidden" name="time" value={selectedSlot?.time ?? ''} />
	<input type="hidden" name="internal_note" value={internalNote} />
	<input type="hidden" name="ignore_break" value={ignoreBreak ? 'true' : 'false'} />
	<input type="hidden" name="patient_phone_changed" value={patientPhoneChanged ? 'true' : 'false'} />
	<input type="hidden" name="phone_warning_override" value={phoneWarningOverride} />

	<section class="ux-card min-w-0 w-full px-5 py-4 sm:px-6">
		<div class="flex items-center justify-between gap-4">
			<p class="text-base font-bold text-white/75 sm:text-lg">
				Paso {step} de 5 · {stepLabels[step - 1]}
			</p>
			{#if step > 1}
				<button
					type="button"
					onclick={restart}
					class="shrink-0 text-sm font-bold text-white/55 transition hover:text-white sm:text-base"
				>
					Empezar de nuevo
				</button>
			{/if}
		</div>
		<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
			<div
				class="h-full rounded-full bg-[#7c3aed] transition-all duration-300"
				style={'width:' + ((step / 5) * 100) + '%'}
			></div>
		</div>
	</section>

	{#if step === 1}
		<section class="ux-card min-w-0 w-full p-5 sm:p-7">
			<h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">¿Qué necesita el paciente?</h2>
			<p class="mt-2 text-base text-white/60">Elegí un procedimiento.</p>

			<div class="mt-6 grid gap-3 sm:grid-cols-2">
				{#each services as service}
					<button
						type="button"
						disabled={!canOperate}
						onclick={() => selectService(service.id)}
						class="ux-choice flex min-h-28 min-w-0 w-full items-center justify-between gap-4 p-5 text-left disabled:cursor-not-allowed disabled:opacity-60"
						class:ux-choice-active={selectedServiceId === service.id}
					>
						<span class="min-w-0">
							<span class="block text-lg font-bold leading-tight text-white">{service.name}</span>
						</span>
						<span class="ux-badge shrink-0 text-sm">{durationLabel(service.duration_minutes)}</span>
					</button>
				{/each}
			</div>

			{#if services.length === 0}
				<p class="ux-empty mt-6 text-base">No hay servicios cargados.</p>
			{/if}
		</section>
	{:else if step === 2}
		<section class="ux-card min-w-0 w-full p-5 sm:p-7">
			<h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">¿Con quién?</h2>
			{#if selectedService}
				<p class="mt-2 text-base text-white/60">
					{selectedService.name} · {durationLabel(selectedService.duration_minutes)}
				</p>
			{/if}

			<div class="ux-soft-card mt-6 grid grid-cols-2 gap-2 p-1.5">
				<button
					type="button"
					onclick={() => selectBookingMode('individual')}
					aria-pressed={bookingMode === 'individual'}
					class={bookingMode === 'individual'
						? 'min-h-12 rounded-xl bg-[#7c3aed] px-4 py-3 text-base font-bold text-white shadow-lg shadow-[#7c3aed]/25'
						: 'min-h-12 rounded-xl px-4 py-3 text-base font-bold text-white/60 transition hover:bg-white/[0.06] hover:text-white'}
				>
					Un profesional
				</button>
				<button
					type="button"
					onclick={() => selectBookingMode('joint')}
					aria-pressed={bookingMode === 'joint'}
					class={bookingMode === 'joint'
						? 'min-h-12 rounded-xl bg-[#7c3aed] px-4 py-3 text-base font-bold text-white shadow-lg shadow-[#7c3aed]/25'
						: 'min-h-12 rounded-xl px-4 py-3 text-base font-bold text-white/60 transition hover:bg-white/[0.06] hover:text-white'}
				>
					Equipo de profesionales
				</button>
			</div>

			{#if bookingMode === 'joint'}
				<p class="mt-5 text-base text-white/60">Elegí dos o más profesionales.</p>
			{:else}
				<p class="mt-5 text-base text-white/60">Elegí quién realizará el procedimiento.</p>
			{/if}

			<div class="mt-5 grid gap-3 sm:grid-cols-2">
				{#if bookingMode === 'individual'}
					{#each offeringProfessionals as professional}
						<button
							type="button"
							disabled={!canOperate}
							onclick={() => selectProfessional(professional.id)}
							class="ux-choice flex min-h-28 min-w-0 w-full items-start gap-4 p-5 text-left disabled:cursor-not-allowed disabled:opacity-50"
							class:ux-choice-active={selectedProfessionalId === professional.id}
						>
							<span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-base font-bold text-white/80">
								{initialsFor(professional.name)}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-lg font-bold text-white">{professional.name}</span>
								<span class="mt-1 block truncate text-base text-white/55">
									{professional.specialty ?? 'Profesional'}
								</span>
							</span>
							<svg class="mt-1 h-5 w-5 shrink-0 text-white/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
						</button>
					{/each}
				{:else}
					{#each offeringProfessionals as professional}
						{@const selected = selectedProfessionalIds.includes(professional.id)}
						<button
							type="button"
							disabled={!canOperate}
							onclick={() => toggleTeamProfessional(professional.id)}
							aria-pressed={selected}
							class="ux-choice flex min-h-28 min-w-0 w-full items-start gap-4 p-5 text-left disabled:cursor-not-allowed disabled:opacity-50"
							class:ux-choice-active={selected}
						>
							<span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/10 text-base font-bold text-white/80">
								{initialsFor(professional.name)}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-lg font-bold text-white">{professional.name}</span>
								<span class="mt-1 block truncate text-base text-white/55">
									{professional.specialty ?? 'Profesional'}
								</span>
							</span>
							<span
								aria-hidden="true"
								class={selected
									? 'grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#a78bfa] bg-[#7c3aed] text-sm font-black text-white'
									: 'grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/20 text-sm font-black text-transparent'}
							>
								✓
							</span>
						</button>
					{/each}
				{/if}
			</div>

			{#if offeringProfessionals.length === 0}
				<p class="ux-empty mt-6 text-base">
					No hay profesionales asignados a este procedimiento. Revisá la configuración del equipo.
				</p>
			{:else if bookingMode === 'joint' && offeringProfessionals.length < 2}
				<p class="ux-empty mt-6 text-base">
					Este procedimiento necesita al menos dos profesionales asignados para crear un turno conjunto.
				</p>
			{/if}

			{#if bookingMode === 'joint' && selectedProfessionalIds.length >= 2}
				<p class="mt-5 text-base font-semibold text-white/70" aria-live="polite">
					{loadingSlots
						? 'Comparando la disponibilidad de todo el equipo…'
						: selectedTeam.length + ' integrantes seleccionados.'}
				</p>
			{/if}

			{#if slotsError}
				<p class="ux-alert mt-5">{slotsError}</p>
			{/if}

			<div class="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
				<button type="button" onclick={() => (step = 1)} class="ux-btn-secondary">Volver</button>
				{#if bookingMode === 'joint'}
					<button
						type="button"
						disabled={selectedTeam.length < 2 || loadingSlots || slots.length === 0}
						onclick={continueWithTeam}
						class="ux-btn-primary group min-h-16 min-w-0 w-full justify-between rounded-2xl px-6 py-4 text-left shadow-xl shadow-violet-950/40 sm:w-auto sm:min-w-80"
					>
						<span class="min-w-0">
							<span class="block text-lg font-black leading-tight tracking-tight">
								{selectedTeam.length < 2
									? 'Seleccioná al menos dos integrantes'
									: loadingSlots
										? 'Buscando días…'
										: slots.length === 0
											? 'Sin días en común'
											: 'Ver días disponibles'}
							</span>
						</span>
						<span
							class="ml-4 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/20 transition-transform duration-150 group-hover:translate-x-0.5"
							aria-hidden="true"
						>
							<svg
								class="h-6 w-6"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.4"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M5 12h14" />
								<path d="m13 6 6 6-6 6" />
							</svg>
						</span>
					</button>
				{/if}
			</div>
		</section>
	{:else if step === 3}
		<section class="ux-card min-w-0 w-full p-5 sm:p-7">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Elegí un día</h2>
					{#if selectedService}
						<p class="mt-2 text-base text-white/60">
							{selectedService.name} · {durationLabel(selectedService.duration_minutes)}
						</p>
					{/if}
				</div>
				<button type="button" onclick={() => (step = 2)} class="ux-btn-secondary w-fit">Volver</button>
			</div>

			{#if bookingMode === 'joint'}
				<div class="ux-soft-card mt-6 p-4">
					<p class="text-sm font-bold uppercase tracking-wide text-[#c4b5fd]">Equipo seleccionado</p>
					<p class="mt-2 text-base text-white/70">{selectedTeam.map((professional) => professional.name).join(' · ')}</p>
				</div>
			{/if}

			<label class="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-400/[0.07] p-4">
				<input
					type="checkbox"
					checked={ignoreBreak}
					onchange={updateIgnoreBreak}
					disabled={!canOperate}
					class="mt-1 h-5 w-5 shrink-0 accent-amber-400"
				/>
				<span>
					<span class="block text-base font-bold text-amber-100">Permitir turno sin descanso</span>
					<span class="mt-1 block text-sm text-amber-100/70">Solo para esta reserva.</span>
				</span>
			</label>

			{#if loadingSlots}
				<div class="mt-6 grid gap-3 sm:grid-cols-2" aria-live="polite">
					{#each [0, 1, 2, 3] as placeholder (placeholder)}
						<div class="skeleton-shimmer relative h-28 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.05]"></div>
					{/each}
					<p class="text-base text-white/55">Buscando días disponibles…</p>
				</div>
			{:else if slotsByDay.length > 0}
				<div class="mt-6 grid gap-3 sm:grid-cols-2">
					{#each slotsByDay as dayGroup (dayGroup.day)}
						<button
							type="button"
							onclick={() => selectDay(dayGroup.day)}
							class="ux-choice flex min-h-28 min-w-0 w-full items-center justify-between gap-4 p-5 text-left"
						>
							<span>
								<span class="block capitalize text-lg font-bold text-white">{formatDayName(dayGroup.day)}</span>
								<span class="mt-1.5 block text-base text-white/55">{formatDayNumber(dayGroup.day)}</span>
							</span>
							<svg class="h-5 w-5 shrink-0 text-white/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
						</button>
					{/each}
				</div>
			{:else}
				<div class="ux-empty mt-6">
					<p class="text-lg font-bold text-white/85">
						{bookingMode === 'joint'
							? 'No hay un día en común para todo el equipo esta semana.'
							: 'No hay días disponibles esta semana.'}
					</p>
					<p class="mt-2 text-base text-white/55">
						Probá la semana siguiente o volvé para cambiar la selección.
					</p>
				</div>
			{/if}

			{#if slotsError}
				<p class="ux-alert mt-5">{slotsError}</p>
			{/if}

			<div class="mt-7 flex flex-wrap gap-3">
				<button type="button" onclick={() => changeWeek(-7)} class="ux-btn-secondary">Semana anterior</button>
				<button type="button" onclick={() => changeWeek(7)} class="ux-btn-secondary">Semana siguiente</button>
			</div>
		</section>
	{:else if step === 4}
		<section class="ux-card min-w-0 w-full p-5 sm:p-7">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Elegí un horario</h2>
					<p class="mt-2 capitalize text-base text-white/60">{formatLongDate(selectedSlotDate)}</p>
				</div>
				<button type="button" onclick={changeDay} class="ux-btn-secondary w-fit">Cambiar día</button>
			</div>

			{#if loadingSlots}
				<div class="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-live="polite">
					{#each [0, 1, 2, 3, 4] as placeholder (placeholder)}
						<div class="skeleton-shimmer relative h-12 overflow-hidden rounded-xl border border-white/5 bg-white/[0.05]"></div>
					{/each}
					<p class="col-span-full text-base text-white/55">Buscando horarios libres…</p>
				</div>
			{:else}
				{#if morningSlots.length > 0}
					<p class="mt-6 text-sm font-bold uppercase tracking-wider text-white/45">Mañana</p>
					<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
						{#each morningSlots as slot (slot.starts_at)}
							<button
								type="button"
								onclick={() => selectSlot(slot)}
								class="ux-choice min-h-12 px-3 py-3 text-center text-base font-bold text-white"
							>
								{slot.time}
							</button>
						{/each}
					</div>
				{/if}
				{#if afternoonSlots.length > 0}
					<p class="mt-6 text-sm font-bold uppercase tracking-wider text-white/45">Tarde</p>
					<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
						{#each afternoonSlots as slot (slot.starts_at)}
							<button
								type="button"
								onclick={() => selectSlot(slot)}
								class="ux-choice min-h-12 px-3 py-3 text-center text-base font-bold text-white"
							>
								{slot.time}
							</button>
						{/each}
					</div>
				{/if}
				{#if selectedDaySlots.length === 0}
					<p class="ux-empty mt-6 text-base">No hay horarios para ese día. Probá con otro día.</p>
				{/if}
			{/if}

			{#if slotsError}
				<p class="ux-alert mt-5">{slotsError}</p>
			{/if}
		</section>
	{:else}
		<section class="ux-card grid w-full gap-7 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
			<div>
				<button type="button" onclick={() => (step = 4)} class="ux-btn-secondary">Volver</button>

				<div class="mt-6">
					<h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">¿Para quién es el turno?</h2>
					<p class="mt-2 text-base text-white/60">Buscá una ficha existente o cargá un paciente nuevo.</p>
				</div>

				<div class="mt-6 grid gap-3 sm:grid-cols-2">
					<button
						type="button"
						onclick={() => selectPatientMode('existing')}
						class="ux-choice flex min-h-28 min-w-0 w-full items-center gap-4 p-5 text-left"
						class:ux-choice-active={patientMode === 'existing'}
					>
						<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#7c3aed]/25 text-white ring-1 ring-[#8b5cf6]/35">
							<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21 21a7 7 0 0 0-14 0" />
								<circle cx="14" cy="8" r="4" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 11h5M5.5 8.5v5" />
							</svg>
						</span>
						<span>
							<span class="block text-lg font-bold text-white">Buscar paciente</span>
							<span class="mt-1 block text-base text-white/55">Usar una ficha existente</span>
						</span>
					</button>
					<button
						type="button"
						onclick={() => selectPatientMode('new')}
						class="ux-choice flex min-h-28 min-w-0 w-full items-center gap-4 p-5 text-left"
						class:ux-choice-active={patientMode === 'new'}
					>
						<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/10">
							<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M20 21a8 8 0 0 0-16 0" />
								<circle cx="12" cy="8" r="4" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 8v6M16 11h6" />
							</svg>
						</span>
						<span>
							<span class="block text-lg font-bold text-white">Nuevo paciente</span>
							<span class="mt-1 block text-base text-white/55">Crear una ficha al agendar</span>
						</span>
					</button>
				</div>

				{#if patientMode === 'existing'}
					<input type="hidden" name="patient_name" value="" />
					<input type="hidden" name="patient_email" value="" />
					<input type="hidden" name="patient_id" value={selectedPatientId} />
					<div class="mt-6">
						<label>
							<span class="ux-label">Buscar por nombre, teléfono o DNI</span>
							<input
								bind:value={patientSearch}
								placeholder="Buscar paciente"
								class="ux-input"
							/>
						</label>
						{#if patientSearchLoading}
							<p class="mt-3 text-base font-semibold text-white/55">Buscando pacientes…</p>
						{:else if patientsLoading && patientSearch.trim().length < 1}
							<p class="mt-3 text-base font-semibold text-white/55" aria-live="polite">
								Cargando fichas recientes…
							</p>
						{/if}
						{#if patientSearchError}
							<p class="ux-alert mt-3">{patientSearchError}</p>
						{/if}
						{#if patientsError && patientSearch.trim().length < 1}
							<div class="ux-alert mt-3">
								{patientsError}
								<button type="button" class="ml-2 font-bold underline" onclick={() => void onNeedPatients()}>
									Reintentar
								</button>
							</div>
						{/if}
						<div class="mt-3 grid gap-2">
							{#each visiblePatients as patient}
								<button
									type="button"
									onclick={() => selectPatient(patient)}
									class="ux-choice px-4 py-3 text-left"
									class:ux-choice-active={selectedPatientId === patient.id}
								>
									<span class="block text-base font-bold text-white">{patient.full_name}</span>
									{#if patientDisambiguation(patient)}
										<span class="mt-1 block text-sm text-white/55">{patientDisambiguation(patient)}</span>
									{/if}
								</button>
							{/each}
							{#if visiblePatients.length === 0 && !patientsLoading && !patientSearchLoading}
								<p class="ux-empty p-4 text-base">
									{patientSearch.trim().length >= 1
										? 'No encontramos pacientes con esa búsqueda.'
										: patientsLoaded
											? 'No hay fichas de pacientes para mostrar.'
											: 'Buscá una ficha.'}
								</p>
							{/if}
						</div>
					</div>
					{#if selectedPatientId}
						<label class="mt-4 block">
							<span class="ux-label">Teléfono</span>
							<input
								bind:this={phoneInput}
								id="patient_phone"
								name="patient_phone"
								inputmode="tel"
								autocomplete="tel"
								bind:value={patientPhone}
								oninput={handlePhoneInput}
								aria-invalid={phoneNeedsAttention || phoneWarning ? 'true' : undefined}
								aria-describedby={phoneWarning ? 'phone-warning' : undefined}
								class={`ux-input ${phoneNeedsAttention || phoneWarning ? 'border-amber-300 ring-2 ring-amber-300/25' : ''}`}
							/>
						</label>
					{:else}
						<input type="hidden" name="patient_phone" value="" />
					{/if}
				{:else}
					<input type="hidden" name="patient_id" value="" />
					<div class="mt-6 grid gap-4">
						<label>
							<span class="ux-label">Nombre del paciente</span>
							<input
								name="patient_name"
								bind:value={patientName}
								required
								disabled={!canOperate}
								class="ux-input"
							/>
						</label>
						<label>
							<span class="ux-label">Teléfono</span>
							<input
								bind:this={phoneInput}
								id="patient_phone"
								name="patient_phone"
								bind:value={patientPhone}
								inputmode="tel"
								autocomplete="tel"
								oninput={handlePhoneInput}
								disabled={!canOperate}
								aria-invalid={phoneNeedsAttention || phoneWarning ? 'true' : undefined}
								aria-describedby={phoneWarning ? 'phone-warning' : undefined}
								class={`ux-input ${phoneNeedsAttention || phoneWarning ? 'border-amber-300 ring-2 ring-amber-300/25' : ''}`}
							/>
						</label>
						<label>
							<span class="ux-label">Correo electrónico (opcional)</span>
							<input
								name="patient_email"
								type="email"
								bind:value={patientEmail}
								disabled={!canOperate}
								class="ux-input"
							/>
						</label>
					</div>
				{/if}

				{#if phoneWarning}
					<div id="phone-warning" class="mt-5 rounded-2xl border border-amber-300/35 bg-amber-300/[0.09] p-4 text-amber-50" role="alert">
						<p class="text-base font-extrabold">
							{phoneWarning === 'missing'
								? 'Falta el número de teléfono'
								: 'El número de teléfono no es válido'}
						</p>
						<p class="mt-1 text-sm text-amber-50/75">
							{phoneWarning === 'missing'
								? 'Agregalo para que el paciente pueda recibir recordatorios automáticos.'
								: 'Corregilo para que el paciente pueda recibir recordatorios automáticos.'}
						</p>
						<div class="mt-4 flex flex-col gap-2 sm:flex-row">
							<button type="button" class="ux-btn-primary" onclick={correctPhone}>
								{phoneWarning === 'missing' ? 'Agregar número' : 'Corregir número'}
							</button>
							<button type="button" class="ux-btn-secondary" onclick={confirmWithoutPhone}>
								Confirmar de todos modos
							</button>
						</div>
					</div>
				{/if}
			</div>

			<aside class="ux-soft-card p-5">
				<p class="text-lg font-bold text-white">Resumen del turno</p>
				<div class="mt-5 space-y-4">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Servicio</p>
						<p class="mt-1 text-base font-semibold text-white">{selectedService?.name ?? '-'}</p>
					</div>
					<div>
						<p class="text-xs font-semibold uppercase tracking-wide text-white/40">
							{bookingMode === 'joint' ? 'Equipo' : 'Profesional'}
						</p>
						{#if bookingMode === 'joint'}
							<ul class="mt-2 grid gap-1.5">
								{#each selectedTeam as professional}
									<li class="flex items-center gap-2 text-sm font-semibold text-white">
										<span class="h-1.5 w-1.5 rounded-full bg-[#a78bfa]"></span>
										{professional.name}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="mt-1 text-base font-semibold text-white">{selectedProfessional?.name ?? '-'}</p>
						{/if}
					</div>
					<div>
						<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Fecha</p>
						<p class="mt-1 capitalize text-base font-semibold text-white">
							{selectedSlot ? formatLongDate(selectedSlot.date) : '-'}
						</p>
					</div>
					<div>
						<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Hora</p>
						<p class="mt-1 text-base font-semibold text-white">{selectedSlot?.time ?? '-'}</p>
					</div>
					{#if ignoreBreak}
						<div>
							<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Descanso</p>
							<p class="mt-1 text-sm font-semibold text-amber-100">Sin descanso</p>
						</div>
					{/if}
					<div>
						<p class="text-xs font-semibold uppercase tracking-wide text-white/40">Paciente</p>
						<p class="mt-1 text-base font-semibold text-white">
							{patientMode === 'existing' ? selectedPatient?.full_name ?? '-' : patientName || '-'}
						</p>
					</div>
				</div>
				<button
					type="submit"
					disabled={!canOperate || !canCreate || Boolean(phoneWarning)}
					class="ux-btn-primary ux-btn-cta mt-6 w-full"
				>
					{bookingMode === 'joint' ? 'Confirmar turno conjunto' : 'Confirmar turno'}
				</button>
			</aside>
		</section>
	{/if}
</form>
