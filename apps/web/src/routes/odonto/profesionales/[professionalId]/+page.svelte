<script lang="ts">
  import { styledDate, styledSelect } from "$lib/ui/styled-controls";
	import { beforeNavigate, goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import BackLink from '$lib/components/BackLink.svelte';
	import { clearTtlDraft, loadTtlDraft, saveTtlDraft } from '$lib/client/ttl-draft';
	import { formatDate, formatDateTime, formatInTimeZone } from '$lib/utils/format';
	import { formatPriceLabel } from '$lib/utils/money-input';
	import {
		normalizeTimeRangesForCommit,
		normalizeTimeRangesInput,
		parseTimeRanges
	} from '$lib/utils/time-ranges';
	import {
		canonicalScheduleBlocks,
		createEmptyScheduleBlock,
		scheduleBlocksFromRules,
		serializeScheduleBlocks,
		validateScheduleBlocks,
		type ScheduleBlockDraft
	} from '$lib/utils/schedule-blocks';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { onMount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';

	const weekdays = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	const tabs = [
		{ id: 'perfil', label: 'Perfil' },
		{ id: 'servicios', label: 'Servicios y aranceles' },
		{ id: 'horarios', label: 'Horarios' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];
	type Service = {
		id: string;
		name: string;
		description: string | null;
		duration_minutes: number;
		buffer_before_minutes: number;
		buffer_after_minutes: number;
		price_label: string | null;
		updated_at: string;
		patient_instructions: string | null;
		public_reminder_description: string | null;
		is_active: boolean;
		is_public: boolean;
		sort_order: number;
	};
	type Rule = {
        service_scope?:'all'|'restricted';rule_services?:Array<{service_id:string}>;
		id: string;
		weekday: number;
		start_time: string;
		end_time: string;
		slot_interval_minutes: number;
		break_minutes: number;
		is_active: boolean;
		created_at: string | null;
	};
	type Exception = {
        exception_services?:Array<{service_id:string}>;
		id: string;
		professional_id: string | null;
		starts_at: string;
		ends_at: string;
		type: 'blocked' | 'extra_available' | 'restricted';
		reason: string | null;
	};
	type ProfessionalDraft = {
		name: string;
		specialty: string;
		phone: string;
		email: string;
		isAvailable: boolean;
		serviceIds: string[];
		schedule: {
			blocks: ScheduleBlockDraft[];
		};
		exception: {
			appliesTo: 'professional' | 'business';
			type: 'blocked' | 'extra_available' | 'restricted';
			periodMode: 'single' | 'range' | 'multiple';
            allowedServiceIds:string[];requestId:string;
            dates:string[];
			date: string;
			dateFrom: string;
			dateTo: string;
			timeRange: string;
			reason: string;
		};
	};
	type DirtyFields = {
		name: boolean;
		specialty: boolean;
		phone: boolean;
		email: boolean;
		profilePublic: boolean;
		services: boolean;
		schedule: boolean;
		exception: boolean;
	};
	type PageData = {
		context: {
			business: { id: string; timezone: string };
			canOperate: boolean;
			canManage: boolean;
		};
		professional: {
			id: string;
			name: string;
			specialty: string | null;
			phone: string | null;
			email: string | null;
			is_active: boolean;
			is_public: boolean;
		} | null;
		services: Service[];currentPriceLabels?:Record<string,string>;
        availabilityRevision?:number;exceptionRequestId?:string;
		assignedServiceIds: string[];
		defaultServiceIds: string[];
		rules: Rule[];
		exceptions: Exception[];
		appointmentCount: number | null;
		clinicalEntryCount: number | null;
		followUpCount: number | null;
		dependencyCountsDeferred?: boolean;
		tab: string;
		userId: string | null;
		pendingAccountEmail: string | null;
		demo: boolean;
	};

	let { data, form } = $props<{
		data: PageData;
		form?: { success?: boolean; message?: string;exceptionConflict?:boolean };
	}>();

	const cloneDraft = (value: ProfessionalDraft): ProfessionalDraft => JSON.parse(JSON.stringify(value));
    const restrictionLabel=(ids:string[])=>ids.length?ids.map(id=>{const service=data.services.find((s:Service)=>s.id===id);return service?service.name+(service.is_active?'':' (no disponible)'):'Prestación no disponible';}).join(', '):'Franja cerrada';
	const normalizedText = (value: string) => value.trim();
	const uniqueSortedNumbers = (items: number[]) => [...new Set(items)].sort((a, b) => a - b);
	const uniqueSortedStrings = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));
	const sameStringList = (left: string[], right: string[]) =>
		uniqueSortedStrings(left).join('|') === uniqueSortedStrings(right).join('|');

	const emptyExceptionDraft = (): ProfessionalDraft['exception'] => ({
		appliesTo: 'professional',
		type: 'blocked',
		periodMode: 'single',dates:[],allowedServiceIds:[],requestId:crypto.randomUUID(),
		date: '',
		dateFrom: '',
		dateTo: '',
		timeRange: '',
		reason: ''
	});

	const scheduleFromRules = (rules: Rule[]): ProfessionalDraft['schedule'] => ({
		blocks: scheduleBlocksFromRules(rules, 'saved-block')
	});

	const buildServerDraft = (source: PageData): ProfessionalDraft => ({
		name: source.professional?.name ?? '',
		specialty: source.professional?.specialty ?? '',
		phone: source.professional?.phone ?? '',
		email: source.professional?.email ?? '',
		isAvailable: Boolean(source.professional?.is_active && source.professional?.is_public),
		serviceIds: [...(source.assignedServiceIds ?? [])],
		schedule: scheduleFromRules(source.rules as Rule[]),
		exception: emptyExceptionDraft()
	});

	const sanitizeSchedule = (
		value: Partial<ProfessionalDraft> | null,
		fallback: ProfessionalDraft
	): ProfessionalDraft['schedule'] => {
		if (Array.isArray(value?.schedule?.blocks)) {
			const blocks = value.schedule.blocks.map((block, index) => ({
				serviceScope:block?.serviceScope==='restricted'?'restricted' as const:'all' as const,allowedServiceIds:Array.isArray(block?.allowedServiceIds)?block.allowedServiceIds.map(String):[],
                id: typeof block?.id === 'string' ? block.id : `restored-block-${index + 1}`,
				weekdays: Array.isArray(block?.weekdays)
					? block.weekdays.map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
					: [],
				timeRanges: typeof block?.timeRanges === 'string' ? block.timeRanges : '',
				slotInterval: typeof block?.slotInterval === 'string' ? block.slotInterval : '15',
				gridInterval:
					typeof block?.gridInterval === 'string' ? block.gridInterval : '15'
			}));
			return { blocks: blocks.length > 0 ? blocks : cloneDraft(fallback).schedule.blocks };
		}
		const legacySchedule = value?.schedule as any;
		if (legacySchedule && Array.isArray(legacySchedule.weekdays)) {
			return {
				blocks: [
					{
						id: 'restored-block-1',
						weekdays: legacySchedule.weekdays
							.map(Number)
							.filter((item: number) => Number.isInteger(item) && item >= 0 && item <= 6),
						timeRanges: typeof legacySchedule.timeRanges === 'string' ? legacySchedule.timeRanges : '',
						slotInterval:
							typeof legacySchedule.breakMinutes === 'string'
								? legacySchedule.breakMinutes
								: '15',
						gridInterval:
							typeof legacySchedule.slotInterval === 'string'
								? legacySchedule.slotInterval
								: '15'
					}
				]
			};
		}
		return cloneDraft(fallback).schedule;
	};

	const sanitizeDraft = (value: Partial<ProfessionalDraft> | null, fallback: ProfessionalDraft): ProfessionalDraft => ({
		name: typeof value?.name === 'string' ? value.name : fallback.name,
		specialty: typeof value?.specialty === 'string' ? value.specialty : fallback.specialty,
		phone: typeof value?.phone === 'string' ? value.phone : fallback.phone,
		email: typeof value?.email === 'string' ? value.email : fallback.email,
		isAvailable: typeof value?.isAvailable === 'boolean' ? value.isAvailable : fallback.isAvailable,
		serviceIds: Array.isArray(value?.serviceIds) ? value.serviceIds.map(String) : fallback.serviceIds,
		schedule: sanitizeSchedule(value, fallback),
		exception: {
			appliesTo: value?.exception?.appliesTo === 'business' ? 'business' : 'professional',
			type: value?.exception?.type === 'extra_available' ? 'extra_available' : value?.exception?.type==='restricted'?'restricted':'blocked',
			periodMode: value?.exception?.periodMode === 'range' ? 'range' : value?.exception?.periodMode==='multiple'?'multiple':'single',
            dates:Array.isArray(value?.exception?.dates)?value.exception.dates.map(String):[],allowedServiceIds:Array.isArray(value?.exception?.allowedServiceIds)?value.exception.allowedServiceIds.map(String):[],requestId:typeof value?.exception?.requestId==='string'&&/^[0-9a-f-]{36}$/i.test(value.exception.requestId)?value.exception.requestId:crypto.randomUUID(),
			date: typeof value?.exception?.date === 'string' ? value.exception.date : fallback.exception.date,
			dateFrom: typeof value?.exception?.dateFrom === 'string' ? value.exception.dateFrom : fallback.exception.dateFrom,
			dateTo: typeof value?.exception?.dateTo === 'string' ? value.exception.dateTo : fallback.exception.dateTo,
			timeRange: typeof value?.exception?.timeRange === 'string' ? value.exception.timeRange : fallback.exception.timeRange,
			reason: typeof value?.exception?.reason === 'string' ? value.exception.reason : fallback.exception.reason
		}
	});

	const hasValidSchedule = (schedule: ProfessionalDraft['schedule']) => {
		return validateScheduleBlocks(schedule.blocks).ok;
	};

	const hasExceptionDraft = (exception: ProfessionalDraft['exception']) =>
		exception.periodMode === 'multiple' ? Boolean(exception.dates?.length||exception.date.trim()||exception.reason.trim()) : exception.periodMode === 'range'
			? Boolean(exception.dateFrom.trim() || exception.dateTo.trim() || exception.reason.trim())
			: Boolean(exception.date.trim() || exception.timeRange.trim() || exception.reason.trim());

	const canOperate = $derived(data.context.canManage && !data.demo);
	const canManage = $derived(data.context.canManage && !data.demo);
	const accountLinkPending = $derived(Boolean(data.pendingAccountEmail));
	const defaultServiceIdSet = $derived(new Set(data.defaultServiceIds ?? []));
	const professional = $derived(data.professional);
	// svelte-ignore state_referenced_locally
	let appointmentCount = $state<number | null>(data.appointmentCount);
	// svelte-ignore state_referenced_locally
	let clinicalEntryCount = $state<number | null>(data.clinicalEntryCount);
	// svelte-ignore state_referenced_locally
	let followUpCount = $state<number | null>(data.followUpCount);
	// svelte-ignore state_referenced_locally
	let dependencyCountsLoaded = $state(!data.dependencyCountsDeferred);
	let dependencyCountsLoading = $state(false);
	let dependencyCountsError = $state('');
	const canDelete = $derived(
		dependencyCountsLoaded &&
		appointmentCount === 0 &&
		clinicalEntryCount === 0 &&
		followUpCount === 0
	);
	let showDeleteConfirm = $state(false);
	const businessId = $derived(data.context.business?.id ?? 'sin-consultorio');
	const businessTimeZone = $derived(data.context.business?.timezone ?? 'America/Argentina/Buenos_Aires');
	const userId = $derived(data.userId ?? 'sin-usuario');
	const professionalId = $derived(data.professional?.id ?? 'nuevo');
	const professionalDependencyKey = $derived(`app:professional:${professionalId}`);
	const draftStorageKey = $derived(`cita-suite:draft:professional-profile:${businessId}:${userId}:${professionalId}`);

	// svelte-ignore state_referenced_locally
	let baseline = $state<ProfessionalDraft>(buildServerDraft(data));
	// svelte-ignore state_referenced_locally
	let draft = $state<ProfessionalDraft>(cloneDraft(baseline));
	let draftReady = $state(false);
	let draftRestored = $state(false);
	// svelte-ignore state_referenced_locally
	let activeTab = $state<TabId>(tabs.some((tab) => tab.id === data.tab) ? (data.tab as TabId) : 'perfil');
	let showNewService = $state(false);
	let editingServiceId = $state<string | null>(null);
	let serviceEditError = $state('');
	let saving = $state<'profile' | 'services' | 'schedule' | 'exception' | 'all' | 'service-create' | 'service-update' | null>(null);
	let archiveSubmitting = $state(false);
	let restoreSubmitting = $state(false);
	let deleteSubmitting = $state(false);
	let showExitGuard = $state(false);
	let pendingNavigationHref = $state<string | null>(null);
	let guardError = $state('');

	const loadDependencyCounts = async () => {
		if (dependencyCountsLoaded || dependencyCountsLoading || !professional?.id) return;
		dependencyCountsLoading = true;
		dependencyCountsError = '';
		try {
			const response = await fetch(
				`/odonto/profesionales/${professional.id}/dependencias`
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message ?? 'No se pudo comprobar el historial del profesional.');
			}
			appointmentCount = Number(payload?.appointment_count ?? 0);
			clinicalEntryCount = Number(payload?.clinical_entry_count ?? 0);
			followUpCount = Number(payload?.follow_up_count ?? 0);
			dependencyCountsLoaded = true;
		} catch (error) {
			dependencyCountsError =
				error instanceof Error
					? error.message
					: 'No se pudo comprobar el historial del profesional.';
		} finally {
			dependencyCountsLoading = false;
		}
	};

	const openDeleteConfirm = () => {
		showDeleteConfirm = true;
		void loadDependencyCounts();
	};
	let acknowledgedAppointments=$state(false);
    $effect(()=>{JSON.stringify(draft.exception);acknowledgedAppointments=false;});

	let saveAllForm = $state<HTMLFormElement | null>(null);
	let scheduleError = $state('');
	let scheduleTimeEditing = $state(false);
	let scheduleBlockSeq = 100;
	let allowNavigation = false;

	$effect(() => {
		if (data.services.length === 0) showNewService = true;
	});

	$effect(() => {
		if (draft.exception.type === 'extra_available' && draft.exception.periodMode === 'range') {
			draft.exception.periodMode = 'single';
		}
	});

	const calculateDirtyFields = (current: ProfessionalDraft, saved: ProfessionalDraft): DirtyFields => {
		const editableCurrentServices = current.serviceIds.filter((id) => !defaultServiceIdSet.has(id));
		const editableSavedServices = saved.serviceIds.filter((id) => !defaultServiceIdSet.has(id));
		return {
			name: normalizedText(current.name) !== normalizedText(saved.name),
			specialty: normalizedText(current.specialty) !== normalizedText(saved.specialty),
			phone: normalizedText(current.phone) !== normalizedText(saved.phone),
			email: normalizedText(current.email).toLowerCase() !== normalizedText(saved.email).toLowerCase(),
			profilePublic: current.isAvailable !== saved.isAvailable,
			services: !sameStringList(editableCurrentServices, editableSavedServices),
			schedule: canonicalScheduleBlocks(current.schedule.blocks) !== canonicalScheduleBlocks(saved.schedule.blocks),
			exception: hasExceptionDraft(current.exception)
		};
	};
	const dirtyFields = $derived.by(() => calculateDirtyFields(draft, baseline));
	const hasUnsavedChanges = $derived.by(() => Object.values(dirtyFields).some(Boolean));
	const dirtyItems = $derived.by(() => {
		const items: string[] = [];
		if (dirtyFields.name) items.push('Nombre');
		if (dirtyFields.email) items.push('Email');
		if (dirtyFields.specialty) items.push('Especialidad');
		if (dirtyFields.phone) items.push('Teléfono');
		if (dirtyFields.profilePublic) items.push('Perfil público');
		if (dirtyFields.services) items.push('Servicios');
		if (dirtyFields.schedule) items.push('Horarios');
		if (dirtyFields.exception) items.push('Disponibilidad');
		return items;
	});
	const missingItems = $derived.by(() => {
		const items: string[] = [];
		if (!draft.name.trim()) items.push('Nombre visible');
		if (!hasValidSchedule(draft.schedule)) items.push('Horarios de atención');
		return items;
	});
	const hasMissingMinimum = $derived.by(() => missingItems.length > 0);
	const visibleName = $derived.by(() => draft.name.trim() || professional?.name || 'Profesional');
	const visibleSubtitle = $derived.by(() => draft.specialty.trim() || 'Definí qué atiende y cuándo.');
	const missingSummary = $derived.by(() => missingItems.join(', '));
	const isVisibleInBooking = $derived.by(() => draft.isAvailable && !hasMissingMinimum);
	const bookingStatusLabel = $derived.by(() => (isVisibleInBooking ? 'Visible en reservas' : 'No visible en reservas'));
	const bookingStatusClass = $derived.by(() =>
		isVisibleInBooking ? 'ux-badge ux-badge-success' : hasMissingMinimum ? 'ux-badge ux-badge-danger' : 'ux-badge'
	);
	const showSaveAllAction = $derived.by(() => hasUnsavedChanges);
	const shouldSaveProfile = $derived.by(() =>
		Boolean(dirtyFields.name || dirtyFields.specialty || dirtyFields.phone || dirtyFields.email || dirtyFields.profilePublic)
	);
	const tabStates = $derived.by(
		() =>
			({
				perfil: { dirty: shouldSaveProfile, missing: missingItems.includes('Nombre visible') },
				servicios: { dirty: dirtyFields.services, missing: false },
				horarios: {
					dirty: Boolean(dirtyFields.schedule || dirtyFields.exception),
					missing: missingItems.includes('Horarios de atención')
				}
			}) satisfies Record<TabId, { dirty: boolean; missing: boolean }>
	);
	const serviceDelta = $derived.by(() => {
		const current = new Set(draft.serviceIds.filter((id) => !defaultServiceIdSet.has(id)));
		const saved = new Set(baseline.serviceIds.filter((id) => !defaultServiceIdSet.has(id)));
		const added = [...current].filter((id) => !saved.has(id));
		const removed = [...saved].filter((id) => !current.has(id));
		return { added, removed, count: added.length + removed.length };
	});
	const serviceChangeSummary = $derived.by(() =>
		serviceDelta.count === 1 ? '1 cambio sin guardar' : `${serviceDelta.count} cambios sin guardar`
	);
	const guardTitle = $derived.by(() => {
		if (hasUnsavedChanges && hasMissingMinimum) return 'Tenés cambios sin guardar y datos pendientes';
		if (hasUnsavedChanges) return 'Tenés cambios sin guardar';
		return 'Faltan datos para recibir turnos';
	});
	const scheduleBlocksJson = $derived(serializeScheduleBlocks(draft.schedule.blocks));
	const scheduleHasAnyDay = $derived(draft.schedule.blocks.some((block) => block.weekdays.length > 0));
	const scheduleCanSave = $derived(validateScheduleBlocks(draft.schedule.blocks).ok);
	const exceptionErrorFor = (exception: ProfessionalDraft['exception']) => {
		if (!hasExceptionDraft(exception)) return '';
        if(exception.periodMode==='multiple')return exception.dates?.length?'':'Agregá al menos una fecha.';
		if (exception.periodMode === 'range') {
			if (!exception.dateFrom.trim() || !exception.dateTo.trim()) {
				return 'Completá las fechas Desde y Hasta.';
			}
			if (exception.dateTo < exception.dateFrom) {
				return 'La fecha Hasta no puede ser anterior a Desde.';
			}
			return '';
		}
		if (!exception.date.trim() || !exception.timeRange.trim()) {
			return 'Completá la fecha y el horario.';
		}
		const ranges = parseTimeRanges(exception.timeRange);
		return !ranges || ranges.length !== 1 ? 'Ingresá una sola franja horaria válida.' : '';
	};
	const exceptionValidationMessage = $derived(exceptionErrorFor(draft.exception));
	const exceptionCanSave = $derived(dirtyFields.exception && !exceptionValidationMessage);
	const schedulePreview = (block: ScheduleBlockDraft) => parseTimeRanges(block.timeRanges) ?? [];
	const sameNumberList = (left: number[], right: number[]) =>
		uniqueSortedNumbers(left).join('|') === uniqueSortedNumbers(right).join('|');

	const baselineBlockFor = (block: ScheduleBlockDraft) =>
		baseline.schedule.blocks.find((saved) => saved.id === block.id) ?? null;

	const canonicalTimeRanges = (value: string) => {
		const parsed = parseTimeRanges(value);
		return parsed ? parsed.map((range) => `${range.start}-${range.end}`).join(',') : normalizedText(value);
	};

	const scheduleBlockDaysDirty = (block: ScheduleBlockDraft) => {
		const saved = baselineBlockFor(block);
		if (!saved) return block.weekdays.length > 0;
		return !sameNumberList(block.weekdays, saved.weekdays);
	};

	const scheduleBlockTimeDirty = (block: ScheduleBlockDraft) => {
		const saved = baselineBlockFor(block);
		if (!saved) return normalizedText(block.timeRanges).length > 0;
		return canonicalTimeRanges(block.timeRanges) !== canonicalTimeRanges(saved.timeRanges);
	};

	const scheduleBlockIntervalDirty = (block: ScheduleBlockDraft) => {
		const saved = baselineBlockFor(block);
		if (!saved) return Number(block.slotInterval || 15) !== 15;
		return String(Number(block.slotInterval || 15)) !== String(Number(saved.slotInterval || 15));
	};

	const scheduleBlockTimeStatus = (block: ScheduleBlockDraft) => {
		const parsed = parseTimeRanges(block.timeRanges);
		if (!parsed || parsed.length === 0) {
			return normalizedText(block.timeRanges) ? 'Horario inválido' : 'Necesario para recibir turnos';
		}
		return scheduleBlockTimeDirty(block) ? 'Sin guardar' : '';
	};

	const scheduleBlockIntervalStatus = (block: ScheduleBlockDraft) => {
		const rawInterval = String(block.slotInterval ?? '').trim();
		const interval = rawInterval === '' ? Number.NaN : Number(rawInterval);
		if (!Number.isInteger(interval) || interval < 0) return 'Ingresá un entero desde 0';
		return scheduleBlockIntervalDirty(block) ? 'Sin guardar' : '';
	};

	const scheduleBlockDaysStatus = (block: ScheduleBlockDraft) => {
		if (block.weekdays.length === 0) return 'Elegí días';
		return scheduleBlockDaysDirty(block) ? 'Sin guardar' : '';
	};

	const scheduleBlockCardClass = (block: ScheduleBlockDraft) => {
		const hasProblem =
			block.weekdays.length === 0 ||
			!parseTimeRanges(block.timeRanges) ||
			Boolean(scheduleBlockIntervalStatus(block) && scheduleBlockIntervalStatus(block) !== 'Sin guardar');
		if (hasProblem) return 'border-red-400/35';
		if (
			scheduleBlockDaysDirty(block) ||
			scheduleBlockTimeDirty(block) ||
			scheduleBlockIntervalDirty(block) ||
			!baselineBlockFor(block)
		) {
			return 'border-amber-300/35';
		}
		return '';
	};

	const toggleService = (serviceId: string) => {
        if(draft.serviceIds.includes(serviceId)){draft.schedule.blocks=draft.schedule.blocks.map(block=>({...block,allowedServiceIds:(block.allowedServiceIds??[]).filter(id=>id!==serviceId)}));if(draft.exception.appliesTo==='professional')draft.exception.allowedServiceIds=draft.exception.allowedServiceIds.filter(id=>id!==serviceId);}
		draft.serviceIds = draft.serviceIds.includes(serviceId)
			? draft.serviceIds.filter((id) => id !== serviceId)
			: [...draft.serviceIds, serviceId];
	};

	const usedWeekdays = (exceptBlockId = '') =>
		new Set(
			draft.schedule.blocks
				.filter((block) => block.id !== exceptBlockId)
				.flatMap((block) => block.weekdays)
		);

	const updateScheduleBlock = (blockId: string | undefined, patch: Partial<ScheduleBlockDraft>) => {
		draft.schedule.blocks = draft.schedule.blocks.map((block) =>
			block.id === blockId ? { ...block, ...patch } : block
		);
		scheduleError = '';
	};

	const toggleBlockWeekday = (blockId: string | undefined, weekday: number) => {
		const target = draft.schedule.blocks.find((block) => block.id === blockId);
		if (!target) return;
		const adding = !target.weekdays.includes(weekday);
		draft.schedule.blocks = draft.schedule.blocks.map((block) => {
			if (block.id === blockId) {
				return {
					...block,
					weekdays: adding
						? [...block.weekdays, weekday].sort((a, b) => a - b)
						: block.weekdays.filter((item) => item !== weekday)
				};
			}
			return block;
		});
		scheduleError = '';
	};

	const setBlockWeekdays = (blockId: string | undefined, items: number[]) => {
		const normalized = uniqueSortedNumbers(items);
		draft.schedule.blocks = draft.schedule.blocks.map((block) => {
			if (block.id === blockId) return { ...block, weekdays: normalized };
			return block;
		});
		scheduleError = '';
	};

	const addScheduleBlock = () => {
		const next = createEmptyScheduleBlock(`new-block-${scheduleBlockSeq++}`);
		draft.schedule.blocks = [...draft.schedule.blocks, next];
		scheduleError = '';
	};

	const removeScheduleBlock = (blockId: string | undefined) => {
		if (draft.schedule.blocks.length <= 1) {
			draft.schedule.blocks = [
				{ ...draft.schedule.blocks[0], weekdays: [], timeRanges: '', slotInterval: '15' }
			];
		} else {
			draft.schedule.blocks = draft.schedule.blocks.filter((block) => block.id !== blockId);
		}
		scheduleError = '';
	};

	const rulesByWeekday = $derived.by(() =>
		weekdays.map((day, weekday) => ({
			day,
			weekday,
			rules: (data.rules as Rule[]).filter((rule) => rule.weekday === weekday)
		}))
	);

	const exceptionTarget = (item: Exception) =>
		item.professional_id ? professional?.name ?? 'Profesional' : 'Todo el consultorio';
	const exceptionPeriodLabel = (item: Exception) => {
		const starts = formatInTimeZone(item.starts_at, businessTimeZone);
		const ends = formatInTimeZone(item.ends_at, businessTimeZone);
		const isMidnight = (value: string) => value === '00:00' || value === '24:00';
		const endMs = Date.parse(item.ends_at);
		if (isMidnight(starts.timeLabel) && isMidnight(ends.timeLabel) && Number.isFinite(endMs)) {
			const inclusiveEnd = new Date(endMs - 60_000);
			const startLabel = formatDate(item.starts_at, businessTimeZone);
			const endLabel = formatDate(inclusiveEnd.toISOString(), businessTimeZone);
			return startLabel === endLabel
				? `${startLabel} · Día completo`
				: `Del ${startLabel} al ${endLabel} · Días completos`;
		}
		return `${formatDateTime(item.starts_at, businessTimeZone)} - ${formatDateTime(item.ends_at, businessTimeZone)}`;
	};

	const durationLabel = (minutes: number) => `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
	const editingService = $derived(
		data.services.find((service: Service) => service.id === editingServiceId) ?? null
	);
	const editingDefaultService = $derived(
		Boolean(editingService && defaultServiceIdSet.has(editingService.id))
	);
	const openServiceEditor = (serviceId: string) => {
		editingServiceId = serviceId;
		serviceEditError = '';
	};
	const closeServiceEditor = () => {
		if (saving === 'service-update') return;
		editingServiceId = null;
		serviceEditError = '';
	};
	const handlePriceInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatPriceLabel(input.value);
	};

	const commitScheduleBlockTimeRanges = (blockId: string | undefined) => {
		const block = draft.schedule.blocks.find((item) => item.id === blockId);
		if (!block) return false;
		const result = normalizeTimeRangesForCommit(block.timeRanges);
		if (!result.ok) {
			scheduleError = 'Horario inválido.';
			return false;
		}
		updateScheduleBlock(block.id, { timeRanges: result.value });
		return true;
	};
	const finishScheduleBlockTimeEdit = (blockId: string | undefined) => {
		commitScheduleBlockTimeRanges(blockId);
		scheduleTimeEditing = false;
	};

	const normalizeScheduleBeforeSubmit = (event?: SubmitEvent) => {
		for (const block of draft.schedule.blocks) {
			if (!commitScheduleBlockTimeRanges(block.id)) {
				event?.preventDefault();
				return false;
			}
		}
		const result = validateScheduleBlocks(draft.schedule.blocks);
		if (!result.ok) {
			scheduleError = result.message;
			event?.preventDefault();
			return false;
		}
		scheduleError = '';
		if (!event) return true;
		const form = event.currentTarget as HTMLFormElement;
		const input = form.elements.namedItem('schedule_blocks') as HTMLInputElement | null;
		if (input) {
			input.value = serializeScheduleBlocks(draft.schedule.blocks);
		}
		return true;
	};

	const normalizeExceptionTime = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		draft.exception.timeRange = normalizeTimeRangesInput(input.value);
	};
	const normalizeExceptionBeforeSubmit = (event?: SubmitEvent) => {
		if (draft.exception.periodMode === 'single') {
			draft.exception.timeRange = normalizeTimeRangesInput(draft.exception.timeRange);
		}
		if (exceptionErrorFor(draft.exception)) {
			event?.preventDefault();
			return false;
		}
		return true;
	};

	const fieldStateClass = (dirty: boolean, missing = false) =>
		missing ? 'ux-state-required' : dirty ? 'ux-state-unsaved' : '';
	const sectionStateClass = fieldStateClass;
	const serviceRowStateClass = (serviceId: string) => {
		if (serviceDelta.added.includes(serviceId)) return 'ux-choice-pending';
		if (serviceDelta.removed.includes(serviceId)) return 'ux-choice-removed';
		return '';
	};
	const resetExceptionDraft = () => {
		draft.exception = emptyExceptionDraft();
	};
	const markSaved = (section: 'profile' | 'services' | 'schedule' | 'exception' | 'all') => {
		if (section === 'all') {
			baseline = cloneDraft(draft);
			resetExceptionDraft();
			baseline.exception = emptyExceptionDraft();
			clearTtlDraft(draftStorageKey);
			draftRestored = false;
			return;
		}
		if (section === 'profile') {
			baseline.name = draft.name;
			baseline.specialty = draft.specialty;
			baseline.phone = draft.phone;
			baseline.email = draft.email;
			baseline.isAvailable = draft.isAvailable;
		}
		if (section === 'services') baseline.serviceIds = [...draft.serviceIds];
		if (section === 'schedule') baseline.schedule = cloneDraft(draft).schedule;
		if (section === 'exception') resetExceptionDraft();
		if (!Object.values(calculateDirtyFields(draft, baseline)).some(Boolean)) {
			clearTtlDraft(draftStorageKey);
			draftRestored = false;
		}
	};

	const messageFromResult = (result: any, fallback: string) =>
		typeof result?.data?.message === 'string' ? result.data.message : fallback;

	const sectionEnhance = (section: 'profile' | 'services' | 'schedule' | 'exception'): SubmitFunction => () => {
		saving = section;
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				markSaved(section);
				await update({ reset: false, invalidateAll: false });
				await invalidate(professionalDependencyKey);
				return;
			}
			await update({ reset: false });
		};
	};

	const createServiceEnhance: SubmitFunction = () => {
		saving = 'service-create';
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				const serviceId = typeof (result.data as any)?.serviceId === 'string' ? (result.data as any).serviceId : '';
				if (serviceId) {
					if (!draft.serviceIds.includes(serviceId)) draft.serviceIds = [...draft.serviceIds, serviceId];
					if (!baseline.serviceIds.includes(serviceId)) baseline.serviceIds = [...baseline.serviceIds, serviceId];
				}
				showNewService = false;
				await update({ reset: true, invalidateAll: false });
				await invalidate(professionalDependencyKey);
				return;
			}
			await update({ reset: false });
		};
	};

	const updateServiceEnhance: SubmitFunction = () => {
		saving = 'service-update';
		serviceEditError = '';
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				editingServiceId = null;
				await update({ reset: true, invalidateAll: false });
				await invalidate(professionalDependencyKey);
				return;
			}
			serviceEditError = messageFromResult(result, 'No pudimos guardar el servicio. Revisá los datos e intentá nuevamente.');
			await update({ reset: false, invalidateAll: false });
		};
	};

	const refreshEnhance: SubmitFunction = () => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
			await invalidate(professionalDependencyKey);
		};
	};

	const continuePendingNavigation = () => {
		const href = pendingNavigationHref;
		showExitGuard = false;
		pendingNavigationHref = null;
		guardError = '';
		if (!href) return;
		allowNavigation = true;
		goto(href);
	};

	const stayEditing = () => {
		showExitGuard = false;
		pendingNavigationHref = null;
		guardError = '';
		if (missingItems.includes('Nombre visible')) activeTab = 'perfil';
		else if (missingItems.includes('Horarios de atención')) activeTab = 'horarios';
	};

	const discardAndLeave = () => {
		draft = cloneDraft(baseline);
		clearTtlDraft(draftStorageKey);
		draftRestored = false;
		continuePendingNavigation();
	};

	const saveAllEnhance: SubmitFunction = () => {
		saving = 'all';
		guardError = '';
		return async ({ result, update }) => {
			saving = null;
			if (result.type === 'success') {
				markSaved('all');
				await update({ reset: false, invalidateAll: false });
				await invalidate(professionalDependencyKey);
				continuePendingNavigation();
				return;
			}
			guardError = messageFromResult(result, 'No se pudieron guardar los cambios.');
			await update({ reset: false });
		};
	};

	const requestSaveAll = () => {
		if (dirtyFields.schedule && !normalizeScheduleBeforeSubmit()) {
			activeTab = 'horarios';
			return;
		}
		if (dirtyFields.exception && !normalizeExceptionBeforeSubmit()) {
			activeTab = 'horarios';
			return;
		}
		saveAllForm?.requestSubmit();
	};

	const shouldGuardExit = () => hasUnsavedChanges || hasMissingMinimum;

	beforeNavigate((navigation) => {
		const target = navigation.to?.url;
		if (!target || allowNavigation) return;
		if (target.pathname === location.pathname) return;
		if (!shouldGuardExit()) return;
		navigation.cancel();
		pendingNavigationHref = `${target.pathname}${target.search}${target.hash}`;
		guardError = '';
		showExitGuard = true;
	});

	$effect(() => {
		if (!draftReady) return;
		if (hasUnsavedChanges) saveTtlDraft(draftStorageKey, cloneDraft(draft));
		else clearTtlDraft(draftStorageKey);
	});

	$effect(() => {
		// A shorthand like 09:00-20 is equivalent to 09:00-20:00, but must stay raw while editing.
		if (!draftReady || hasUnsavedChanges || scheduleTimeEditing) return;
		const serverDraft = buildServerDraft(data);
		baseline = cloneDraft(serverDraft);
		draft = cloneDraft(serverDraft);
	});

	onMount(() => {
		const savedDraft = loadTtlDraft<Partial<ProfessionalDraft>>(draftStorageKey);
		if (savedDraft) {
			const restored = sanitizeDraft(savedDraft, baseline);
			if (Object.values(calculateDirtyFields(restored, baseline)).some(Boolean)) {
				draft = restored;
				draftRestored = true;
			}
		}
		draftReady = true;

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!shouldGuardExit()) return;
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	});
</script>

<section class="ux-page" data-editor-ready={draftReady}>
		<div class="ux-hero">
			<BackLink href="/odonto/configuracion/usuarios" label="Volver" class="mb-5" />
			<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<p class="text-xs font-bold uppercase text-white/42">Profesional</p>
					<h1 class="ux-title mt-3">{visibleName}</h1>
					<p class="ux-subtitle">{visibleSubtitle}</p>
					{#if hasMissingMinimum}
						<p class="mt-3 text-sm font-bold text-red-100">Falta completar: {missingSummary}</p>
					{/if}
					{#if hasUnsavedChanges}
						<p class="mt-2 text-sm font-bold text-amber-100">Cambios sin guardar</p>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<span class={bookingStatusClass}>{bookingStatusLabel}</span>
					{#if hasUnsavedChanges}
						<button type="button" disabled={!canOperate || saving === 'all'} class="ux-btn-primary" onclick={requestSaveAll}>
							{saving === 'all' ? 'Guardando...' : 'Guardar todo'}
						</button>
					{/if}
				</div>
			</div>
		</div>

		{#if accountLinkPending}
			<div class="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-5 py-4" role="status">
				<p class="font-black text-amber-100">Cuenta profesional pendiente</p>
				<p class="mt-1 text-sm text-amber-50/80">
					Este profesional no aparecerá en las reservas online hasta que cree su cuenta con
					<strong>{data.pendingAccountEmail}</strong>. Cuando se registre, accederá automáticamente a este
					perfil con los servicios y horarios ya configurados.
				</p>
			</div>
		{/if}

		{#if form?.message}
			<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'}>{form.message}</p>
		{/if}
		{#if draftRestored}
			<p class="ux-alert ux-alert-warning">Tenés cambios sin guardar recuperados.</p>
		{/if}

		<form method="POST" action="?/save_all" class="hidden" use:enhance={saveAllEnhance} bind:this={saveAllForm}>
			<input type="hidden" name="ack_existing_appointments" value={acknowledgedAppointments?'true':'false'}/>{#each draft.exception.allowedServiceIds as serviceId}<input type="hidden" name="exception_service_ids" value={serviceId}/>{/each}
			<input type="hidden" name="save_profile" value={shouldSaveProfile ? 'true' : 'false'} />
			<input type="hidden" name="save_services" value={dirtyFields.services ? 'true' : 'false'} />
			<input type="hidden" name="save_schedule" value={dirtyFields.schedule ? 'true' : 'false'} />
			<input type="hidden" name="save_exception" value={dirtyFields.exception ? 'true' : 'false'} />
			<input type="hidden" name="name" value={draft.name} />
			<input type="hidden" name="specialty" value={draft.specialty} />
			<input type="hidden" name="phone" value={draft.phone} />
			<input type="hidden" name="email" value={draft.email} />
			<input type="hidden" name="is_available" value={draft.isAvailable ? 'true' : 'false'} />
			{#each draft.serviceIds.filter((id) => !defaultServiceIdSet.has(id)) as serviceId}
				<input type="hidden" name="service_id" value={serviceId} />
			{/each}
			<input type="hidden" name="schedule_blocks" value={scheduleBlocksJson} /><input type="hidden" name="availability_revision" value={data.availabilityRevision??0}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/>
			<input type="hidden" name="applies_to" value={draft.exception.appliesTo} />
			<input type="hidden" name="type" value={draft.exception.type} />
			<input type="hidden" name="period_mode" value={draft.exception.periodMode} /><input type="hidden" name="availability_revision" value={data.availabilityRevision??0}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/><input type="hidden" name="dates" value={JSON.stringify(draft.exception.dates??[])}/>
			<input type="hidden" name="date" value={draft.exception.date} />
			<input type="hidden" name="date_from" value={draft.exception.dateFrom} />
			<input type="hidden" name="date_to" value={draft.exception.dateTo} />
			<input type="hidden" name="time_range" value={draft.exception.timeRange} />
			<input type="hidden" name="reason" value={draft.exception.reason} />
		</form>

		<div class="ux-card p-2">
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				{#each tabs as tab}
					<button
					type="button"
					class={`ux-profile-tab ${activeTab === tab.id ? 'ux-profile-tab-active' : ''} ${
						tabStates[tab.id].missing ? 'ux-profile-tab-required' : tabStates[tab.id].dirty ? 'ux-profile-tab-unsaved' : ''
					}`}
					onclick={() => (activeTab = tab.id)}
					>
						<span class="inline-flex items-center justify-center gap-2">
							{tab.label}
							{#if tabStates[tab.id].missing}
								<span class="ux-tab-marker ux-tab-marker-danger" aria-label="Dato necesario faltante">!</span>
							{:else if tabStates[tab.id].dirty}
								<span class="ux-tab-marker ux-tab-marker-warning" aria-label="Cambios sin guardar">·</span>
							{/if}
						</span>
					</button>
				{/each}
				<a class="ux-profile-tab text-center" href={`/odonto/profesionales/${professional?.id}/preguntas`}>Preguntas al paciente</a>
			</div>
		</div>

	{#if activeTab === 'perfil'}
		<form method="POST" action="?/update_profile" class={`ux-card ${sectionStateClass(shouldSaveProfile, missingItems.includes('Nombre visible'))}`} use:enhance={sectionEnhance('profile')}>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="ux-section-title">Perfil</h2>
					<p class="mt-1 text-sm text-white/55">Datos básicos del profesional.</p>
					{#if missingItems.includes('Nombre visible')}
						<p class="ux-section-meta ux-section-meta-danger">Nombre visible necesario para recibir turnos</p>
					{:else if shouldSaveProfile}
						<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
					{/if}
				</div>
				<button type="submit" disabled={!canOperate || saving === 'profile' || !shouldSaveProfile} class="ux-btn-secondary">
					{saving === 'profile' ? 'Guardando...' : 'Guardar sólo perfil'}
				</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Nombre
						{#if missingItems.includes('Nombre visible')}
							<span class="ux-inline-status ux-inline-status-danger">Necesario para recibir turnos</span>
						{:else if dirtyFields.name}
							<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>
						{/if}
					</span>
					<input name="name" bind:value={draft.name} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.name, missingItems.includes('Nombre visible'))}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Especialidad (opcional)
						{#if dirtyFields.specialty}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="specialty" bind:value={draft.specialty} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.specialty)}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Teléfono (opcional)
						{#if dirtyFields.phone}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="phone" bind:value={draft.phone} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.phone)}`} />
				</label>
				<label>
					<span class="ux-label flex flex-wrap items-center gap-2">
						Correo electrónico (opcional)
						{#if dirtyFields.email}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
					</span>
					<input name="email" bind:value={draft.email} type="email" disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.email)}`} />
				</label>
			</div>
			<label class={`mt-5 inline-flex items-center gap-3 rounded-2xl border bg-white/[0.04] px-4 py-3 text-sm font-bold text-white ${fieldStateClass(dirtyFields.profilePublic) || 'border-white/10'}`}>
				<input
					type="checkbox"
						name="is_available"
						value="true"
						bind:checked={draft.isAvailable}
						disabled={!canOperate || accountLinkPending}
						class="accent-[#7c3aed]"
					/>
					{accountLinkPending ? 'Visible cuando vincule su cuenta' : 'Visible en reservas'}
				{#if dirtyFields.profilePublic}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
			</label>
		</form>

		{#if canManage}
			<div class="ux-card flex flex-col gap-4 border-red-400/15 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0">
					<p class="font-bold text-white">{professional?.is_active ? 'Archivar profesional' : 'Restaurar profesional'}</p>
					<p class="mt-1 text-sm text-white/55">
						{professional?.is_active
							? 'Se oculta de la agenda y de las reservas. Reversible.'
							: 'Vuelve a estar disponible para asignar turnos.'}
					</p>
				</div>
				<div class="flex shrink-0 flex-wrap items-center gap-2">
					{#if professional?.is_active}
						<form
							method="POST"
							action="?/archive_professional"
							use:enhance={() => {
								archiveSubmitting = true;
								return async ({ result, update }) => {
									if (result.type === 'redirect') {
										window.location.assign(result.location);
										return;
									}
									archiveSubmitting = false;
									await update({ reset: false, invalidateAll: false });
									await invalidate(professionalDependencyKey);
								};
							}}
						>
							<button type="submit" disabled={archiveSubmitting} class="ux-btn-secondary">
								{archiveSubmitting ? 'Archivando...' : 'Archivar'}
							</button>
						</form>
					{:else}
						<form
							method="POST"
							action="?/restore_professional"
							use:enhance={() => {
								restoreSubmitting = true;
								return async ({ result, update }) => {
									if (result.type === 'redirect') {
										window.location.assign(result.location);
										return;
									}
									restoreSubmitting = false;
									await update({ reset: false, invalidateAll: false });
									await invalidate(professionalDependencyKey);
								};
							}}
						>
							<button type="submit" disabled={restoreSubmitting} class="ux-btn-primary">
								{restoreSubmitting ? 'Restaurando...' : 'Restaurar'}
							</button>
						</form>
					{/if}
					<button type="button" class="ux-btn-danger" onclick={openDeleteConfirm}>Eliminar</button>
				</div>
			</div>

			<Modal
				open={showDeleteConfirm}
				title={dependencyCountsLoading
					? 'Comprobando historial'
					: dependencyCountsError
						? 'No se pudo comprobar'
						: canDelete
							? 'Eliminar profesional'
							: 'No se puede eliminar'}
				on:close={() => (showDeleteConfirm = false)}
			>
				{#if dependencyCountsLoading}
					<p class="text-sm font-semibold text-white/70" aria-live="polite">
						Revisando turnos, consultas y seguimientos…
					</p>
				{:else if dependencyCountsError}
					<p class="text-sm text-red-100">{dependencyCountsError}</p>
					<div class="mt-5 flex justify-end">
						<button type="button" class="ux-btn-secondary" onclick={loadDependencyCounts}>Reintentar</button>
					</div>
				{:else if canDelete}
					<p class="text-sm text-white/70">
						¿Eliminar a <span class="font-bold text-white">{professional?.name}</span> de forma permanente? Esta acción no se puede deshacer.
					</p>
					<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" onclick={() => (showDeleteConfirm = false)}>Cancelar</button>
						<form
							method="POST"
							action="?/delete_professional"
							use:enhance={() => {
								deleteSubmitting = true;
								return async ({ result, update }) => {
									if (result.type === 'redirect') {
										window.location.assign(result.location);
										return;
									}
									deleteSubmitting = false;
									showDeleteConfirm = false;
									await update({ reset: false, invalidateAll: false });
									await invalidate(professionalDependencyKey);
								};
							}}
						>
							<button type="submit" disabled={deleteSubmitting} class="ux-btn-danger">
								{deleteSubmitting ? 'Eliminando...' : 'Eliminar profesional'}
							</button>
						</form>
					</div>
				{:else}
					<p class="text-sm text-white/70">
						No se puede eliminar a <span class="font-bold text-white">{professional?.name}</span> porque tiene historial cargado{#if clinicalEntryCount && clinicalEntryCount > 0} ({clinicalEntryCount} consulta{clinicalEntryCount === 1 ? '' : 's'}){/if}{#if appointmentCount && appointmentCount > 0}{clinicalEntryCount && clinicalEntryCount > 0 ? ' y' : ''} {appointmentCount} turno{appointmentCount === 1 ? '' : 's'}{/if}{#if followUpCount && followUpCount > 0}{(clinicalEntryCount ?? 0) + (appointmentCount ?? 0) > 0 ? ' y' : ''} {followUpCount} seguimiento{followUpCount === 1 ? '' : 's'}{/if}. Esos registros pertenecen a los pacientes y se conservan.
					</p>
					<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" onclick={() => (showDeleteConfirm = false)}>Cerrar</button>
						<a href={`/odonto/profesionales/${professional?.id}/historial`} class="ux-btn-primary">Ver historial</a>
					</div>
				{/if}
			</Modal>
		{/if}
	{/if}

	{#if activeTab === 'servicios'}
        <a class="ux-btn-secondary mb-5 inline-flex" href={`/odonto/profesionales/${data.professional?.id}/aranceles`}>Configurar aranceles y ajustes mensuales</a>
		<div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
			<form method="POST" action="?/save_services" class={`ux-card ${sectionStateClass(dirtyFields.services)}`} use:enhance={sectionEnhance('services')}>
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h2 class="ux-section-title">Servicios que ofrece</h2>
						<p class="mt-1 text-sm text-white/55">Estos servicios estarán disponibles para reservar con este profesional.</p>
						{#if dirtyFields.services}
							<p class="ux-section-meta ux-section-meta-warning">{serviceChangeSummary}</p>
						{/if}
					</div>
					<button type="submit" disabled={!canOperate || saving === 'services' || !dirtyFields.services} class="ux-btn-secondary">
						{saving === 'services' ? 'Guardando...' : 'Guardar sólo servicios'}
					</button>
				</div>

				<div class="mt-5 grid gap-3">
					{#each data.services as service}
						{@const isDefault = defaultServiceIdSet.has(service.id)}
						<div class={`ux-choice flex items-center gap-3 p-4 ${isDefault || draft.serviceIds.includes(service.id) ? 'ux-choice-active' : ''} ${serviceRowStateClass(service.id)}`}>
							<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
								<input
									type="checkbox"
									name="service_id"
									value={service.id}
									checked={isDefault || draft.serviceIds.includes(service.id)}
									disabled={!canOperate || isDefault}
									class="accent-[#7c3aed]"
									onchange={() => !isDefault && toggleService(service.id)}
								/>
								<span class="min-w-0 flex-1">
									<span class="block font-black text-white">{service.name}</span>
									<span class="mt-1 block text-sm text-white/55">
										{durationLabel(service.duration_minutes)}{data.currentPriceLabels?.[service.id] ? ` · ${data.currentPriceLabels[service.id]} este mes` : service.price_label ? ` · ${service.price_label}` : ''}
									</span>
								</span>
							</label>
							<button
								type="button"
								disabled={!canManage}
								class="ux-btn-secondary shrink-0 px-3 py-2 text-sm"
								onclick={() => openServiceEditor(service.id)}
							>
								Editar
							</button>
						</div>
					{/each}
					{#if data.services.length === 0}
						<p class="ux-empty">Todavía no hay servicios cargados.</p>
					{/if}
				</div>
			</form>

			<div class="ux-soft-card p-5">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="ux-section-title">¿No encontrás el servicio?</h2>
						<p class="mt-1 text-sm text-white/55">Crealo una vez y queda asignado a {professional?.name ?? 'este profesional'}.</p>
					</div>
					<button type="button" class="ux-btn-secondary" onclick={() => (showNewService = !showNewService)}>
						{showNewService ? 'Cerrar' : 'Crear servicio nuevo'}
					</button>
				</div>
				{#if showNewService}
					<form method="POST" action="?/create_service" class="mt-5 grid gap-4" use:enhance={createServiceEnhance}>
						<label>
							<span class="ux-label">Nombre</span>
							<input name="name" required disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Duración en minutos</span>
							<input name="duration_minutes" type="number" min="5" max="480" step="5" value="30" disabled={!canOperate} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Arancel a mostrar (opcional)</span>
							<input name="price_label" type="text" inputmode="numeric" disabled={!canOperate} placeholder="$ 35.000" class="ux-input" oninput={handlePriceInput} />
							<p class="mt-2 text-sm text-white/70">Se usa cuando no configuraste ajustes mensuales.</p>
						</label>
						<button class="ux-btn-primary" disabled={!canOperate || saving === 'service-create'}>
							{saving === 'service-create' ? 'Creando...' : 'Crear y asignar'}
						</button>
					</form>
				{/if}
			</div>
		</div>

		<Modal open={Boolean(editingService)} title="Editar servicio" on:close={closeServiceEditor}>
			{#if editingService}
				<form method="POST" action="?/update_service" class="grid gap-4" use:enhance={updateServiceEnhance}>
					<input type="hidden" name="service_id" value={editingService.id} />
					<input type="hidden" name="service_updated_at" value={editingService.updated_at} />
					<p class="text-sm text-white/60">
						Los cambios se aplican a los turnos nuevos. Los turnos ya reservados conservan el servicio y la duración originales.
					</p>
					<label>
						<span class="ux-label">Nombre</span>
						<input
							name="name"
							required
							value={editingService.name}
							disabled={!canManage || editingDefaultService}
							class="ux-input"
						/>
						{#if editingDefaultService}
							<span class="mt-1 block text-xs text-white/45">Este nombre identifica un servicio base del consultorio.</span>
						{/if}
					</label>
					<div class="grid gap-4 sm:grid-cols-2">
						<label>
							<span class="ux-label">Duración en minutos</span>
							<input name="duration_minutes" type="number" min="5" max="480" step="5" required value={editingService.duration_minutes} disabled={!canManage} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Arancel a mostrar (opcional)</span>
							<input name="price_label" type="text" inputmode="numeric" value={editingService.price_label ?? ''} disabled={!canManage} placeholder="$ 35.000" class="ux-input" oninput={handlePriceInput} />
							<p class="mt-2 text-sm text-white/70">Se usa cuando no configuraste ajustes mensuales.</p>
						</label>
					</div>
					<label>
						<span class="ux-label">Descripción (opcional)</span>
						<textarea name="description" rows="3" disabled={!canManage} class="ux-textarea">{editingService.description ?? ''}</textarea>
					</label>
					<div class="grid gap-4 sm:grid-cols-2">
						<label>
							<span class="ux-label">Margen antes (minutos)</span>
							<input name="buffer_before_minutes" type="number" min="0" max="480" step="5" required value={editingService.buffer_before_minutes} disabled={!canManage} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Margen después (minutos)</span>
							<input name="buffer_after_minutes" type="number" min="0" max="480" step="5" required value={editingService.buffer_after_minutes} disabled={!canManage} class="ux-input" />
						</label>
					</div>
					<fieldset class="space-y-4 border-t border-white/10 pt-4"><legend class="ux-section-title">Información para el paciente</legend><label class="block"><span class="ux-label">Indicaciones para la consulta <span class="text-white/65">(opcional)</span></span><textarea class="ux-textarea mt-2" name="patient_instructions" rows="2" maxlength="2000" disabled={!canManage}>{editingService.patient_instructions??''}</textarea></label><label class="block"><span class="ux-label">Texto del aviso del turno <span class="text-white/65">(opcional)</span></span><textarea class="ux-textarea mt-2" name="public_reminder_description" rows="2" maxlength="180" disabled={!canManage}>{editingService.public_reminder_description??''}</textarea><span class="mt-1 block text-sm text-white/75">Puede verse con el teléfono bloqueado. Evitá datos clínicos.</span></label></fieldset>
					{#if editingDefaultService}
						<input type="hidden" name="is_active" value="true" />
						<input type="hidden" name="is_public" value="true" />
					{:else}
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="ux-choice flex items-center gap-3 px-4 py-3">
								<input type="checkbox" name="is_active" value="true" checked={editingService.is_active} disabled={!canManage} class="accent-[#7c3aed]" />
								<span class="font-bold text-white">Servicio activo</span>
							</label>
							<label class="ux-choice flex items-center gap-3 px-4 py-3">
								<input type="checkbox" name="is_public" value="true" checked={editingService.is_public} disabled={!canManage} class="accent-[#7c3aed]" />
								<span class="font-bold text-white">Visible al reservar</span>
							</label>
						</div>
					{/if}
					{#if serviceEditError}
						<p class="ux-alert">{serviceEditError}</p>
					{/if}
					<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<button type="button" class="ux-btn-secondary" disabled={saving === 'service-update'} onclick={closeServiceEditor}>Cancelar</button>
						<button type="submit" class="ux-btn-primary" disabled={!canManage || saving === 'service-update'}>
							{saving === 'service-update' ? 'Guardando...' : 'Guardar cambios'}
						</button>
					</div>
				</form>
			{/if}
		</Modal>
	{/if}

	{#if activeTab === 'horarios'}
		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<form method="POST" action="?/save_weekly_rules" class={`ux-card ${sectionStateClass(dirtyFields.schedule, missingItems.includes('Horarios de atención'))}`} onsubmit={normalizeScheduleBeforeSubmit} use:enhance={sectionEnhance('schedule')}>
				<div>
					<h2 class="ux-section-title">Horarios de atención</h2>
					<p class="mt-2 text-sm text-white/55">Marcá los días y escribí los bloques horarios.</p>
					{#if missingItems.includes('Horarios de atención')}
						<p class="ux-section-meta ux-section-meta-danger">Necesario para recibir turnos</p>
					{:else if dirtyFields.schedule}
						<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
					{/if}
				</div>
				<input type="hidden" name="schedule_blocks" value={scheduleBlocksJson} /><input type="hidden" name="availability_revision" value={data.availabilityRevision??0}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/>
				<div class="mt-6 grid gap-4">
					{#each draft.schedule.blocks as block, blockIndex (block.id)}
						{@const assignedByOtherBlock = usedWeekdays(block.id)}
						{@const preview = schedulePreview(block)}
						{@const daysStatus = scheduleBlockDaysStatus(block)}
						{@const timeStatus = scheduleBlockTimeStatus(block)}
						{@const intervalStatus = scheduleBlockIntervalStatus(block)}
						<div class={`ux-soft-card p-4 ${scheduleBlockCardClass(block)}`}>
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<h3 class="text-base font-black text-white">Bloque {blockIndex + 1}</h3>
									<p class="mt-1 text-sm text-white/55">Días que comparten la misma franja habitual.</p><div class="mt-4"><label class="ux-label">Prestaciones de esta franja<select use:styledSelect={block.serviceScope??'all'} class="ux-input mt-2" value={block.serviceScope??'all'} onchange={event=>updateScheduleBlock(block.id,{serviceScope:event.currentTarget.value as 'all'|'restricted',allowedServiceIds:block.allowedServiceIds??[]})}><option value="all">Todas las habilitadas</option><option value="restricted">Sólo las seleccionadas</option></select></label>{#if block.serviceScope==='restricted'}<fieldset class="mt-3"><legend class="ux-label">Prestaciones permitidas</legend>{#if dirtyFields.services}<p class="mt-2 text-sm text-white/75">Usá Guardar todo para aplicar juntos los cambios de prestaciones y horarios.</p>{/if}{#each data.services.filter((service:Service)=>draft.serviceIds.includes(service.id)||defaultServiceIdSet.has(service.id)) as service}<label class="mt-2 flex min-h-11 items-center gap-3 text-sm text-white/80"><input type="checkbox" checked={block.allowedServiceIds?.includes(service.id)??false} onchange={event=>updateScheduleBlock(block.id,{allowedServiceIds:event.currentTarget.checked?[...(block.allowedServiceIds??[]),service.id]:(block.allowedServiceIds??[]).filter(id=>id!==service.id)})}/>{service.name}</label>{/each}{#if !block.allowedServiceIds?.length}<p class="mt-2 text-sm text-white/80">La franja está cerrada hasta que elijas una prestación.</p>{/if}</fieldset>{/if}</div>
								</div>
								<button type="button" class="ux-btn-secondary text-sm" disabled={!canOperate} onclick={() => removeScheduleBlock(block.id)}>
									Quitar bloque
								</button>
							</div>

							<div class="mt-5">
								<span class="ux-label flex flex-wrap items-center gap-2">
									Días
									{#if daysStatus === 'Elegí días'}
										<span class="ux-inline-status ux-inline-status-danger">{daysStatus}</span>
									{:else if daysStatus}
										<span class="ux-inline-status ux-inline-status-warning">{daysStatus}</span>
									{/if}
								</span>
								<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2">
									{#each weekdays as day, index}
										<button
											type="button"
											disabled={!canOperate}
											class={`min-h-14 min-w-0 rounded-2xl border px-3 py-3 text-center text-sm font-black leading-tight whitespace-normal transition disabled:cursor-not-allowed disabled:opacity-50 ${
												block.weekdays.includes(index)
													? 'border-[#8b5cf6] bg-[#7c3aed] text-white shadow-lg shadow-[#7c3aed]/20'
													: false /* Another block on this weekday is valid when the time ranges do not overlap. */
														? 'border-white/5 bg-white/[0.015] text-white/30'
														: 'border-white/10 bg-white/[0.03] text-white/65 hover:border-[#8b5cf6]/60 hover:bg-white/[0.06]'
											}`}
											onclick={() => toggleBlockWeekday(block.id, index)}
										>
											{day}
										</button>
									{/each}
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [1, 2, 3, 4, 5])}>Lunes a viernes</button>
									<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [6])}>Sólo sábado</button>
									<button type="button" class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/65 hover:bg-white/[0.06]" onclick={() => setBlockWeekdays(block.id, [])}>Limpiar</button>
								</div>
							</div>

							<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_180px]">
								<label>
									<span class="ux-label flex flex-wrap items-center gap-2">
										Horarios
										{#if timeStatus === 'Necesario para recibir turnos' || timeStatus === 'Horario inválido'}
											<span class="ux-inline-status ux-inline-status-danger">{timeStatus}</span>
										{:else if timeStatus}
											<span class="ux-inline-status ux-inline-status-warning">{timeStatus}</span>
										{/if}
									</span>
									<input
										type="text"
										placeholder="9 a 13, 15 a 19"
										value={block.timeRanges}
										disabled={!canOperate}
										aria-invalid={timeStatus === 'Necesario para recibir turnos' || timeStatus === 'Horario inválido'}
										class={`ux-input text-lg font-bold ${fieldStateClass(
											timeStatus === 'Sin guardar',
											timeStatus === 'Necesario para recibir turnos' || timeStatus === 'Horario inválido'
										)}`}
										oninput={(event) => updateScheduleBlock(block.id, { timeRanges: (event.currentTarget as HTMLInputElement).value })}
										onfocus={() => (scheduleTimeEditing = true)}
										onblur={() => finishScheduleBlockTimeEdit(block.id)}
									/>
									{#if preview.length > 0}
										<div class="mt-3 flex flex-wrap gap-2">
											{#each preview as range}
												<span class="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
													{range.start} - {range.end}
												</span>
											{/each}
										</div>
									{/if}
								</label>
								<label>
									<span class="ux-label flex flex-wrap items-center gap-2">
										Descanso entre consultas
										{#if intervalStatus === 'Ingresá un entero desde 0'}
											<span class="ux-inline-status ux-inline-status-danger">{intervalStatus}</span>
										{:else if intervalStatus}
											<span class="ux-inline-status ux-inline-status-warning">{intervalStatus}</span>
										{/if}
									</span>
									<input
										type="number"
										inputmode="numeric"
										min="0"
										step="1"
										value={block.slotInterval}
										disabled={!canOperate}
										class={`ux-input text-lg font-bold ${fieldStateClass(
											intervalStatus === 'Sin guardar',
											intervalStatus === 'Ingresá un entero desde 0'
										)}`}
										oninput={(event) => updateScheduleBlock(block.id, { slotInterval: (event.currentTarget as HTMLInputElement).value })}
									/>
									<span class="mt-2 block text-xs font-semibold leading-relaxed text-white/45">
										0 permite otro turno inmediatamente. También podés usar cualquier entero, por ejemplo 2, 23 o 60.
									</span>
								</label>
							</div>
						</div>
					{/each}
				</div>
				{#if scheduleError}
					<p class="ux-alert mt-4">{scheduleError}</p>
				{/if}
				<button type="button" disabled={!canOperate} class="ux-btn-secondary mt-4 w-full" onclick={addScheduleBlock}>
					Agregar otro bloque
				</button>
				<button type="submit" disabled={!canOperate || !scheduleHasAnyDay || !scheduleCanSave || saving === 'schedule' || !dirtyFields.schedule} class="ux-btn-secondary mt-3 w-full">
					{saving === 'schedule' ? 'Guardando...' : 'Guardar sólo horarios'}
				</button>
			</form>

			<form
				method="POST"
				action="?/create_exception"
				class={`ux-card ${sectionStateClass(dirtyFields.exception)}`}
				onsubmit={normalizeExceptionBeforeSubmit}
				use:enhance={sectionEnhance('exception')}
			>
				<h2 class="ux-section-title">Ausencia o cambio de horario</h2>{#if form?.exceptionConflict}<label class="ux-alert mt-3 flex items-start gap-3"><input type="checkbox" name="ack_existing_appointments" value="true" bind:checked={acknowledgedAppointments} required/><span>Revisé los turnos existentes. Confirmo el bloqueo de nuevos turnos; los anteriores se conservan.</span></label>{/if}
				<p class="mt-2 text-sm text-white/55">Bloqueá un horario puntual o varios días completos.</p><label class="mt-4 flex min-h-11 items-center gap-3 text-sm text-white/80"><input type="radio" name="type" value="restricted" bind:group={draft.exception.type} onclick={()=>draft.exception.periodMode='single'}/>Reservar esta franja para prestaciones específicas</label>{#if draft.exception.type==='restricted'}<fieldset class="mt-3"><legend class="ux-label">Prestaciones permitidas en esta fecha</legend>{#each data.services.filter((service:Service)=>draft.exception.appliesTo==='business'||draft.serviceIds.includes(service.id)||defaultServiceIdSet.has(service.id)) as service}<label class="mt-2 flex min-h-11 items-center gap-3 text-sm text-white/80"><input type="checkbox" name="exception_service_ids" value={service.id} bind:group={draft.exception.allowedServiceIds}/>{service.name}</label>{/each}</fieldset>{/if}
				{#if dirtyFields.exception}
					<p class="ux-section-meta ux-section-meta-warning">Cambios sin guardar</p>
				{/if}
				<input type="hidden" name="period_mode" value={draft.exception.periodMode} /><input type="hidden" name="availability_revision" value={data.availabilityRevision??0}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/><input type="hidden" name="dates" value={JSON.stringify(draft.exception.dates??[])}/>
				<div class="mt-5 grid gap-4">
					<div>
						<span class="ux-label">Afecta a</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.appliesTo === 'professional' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="applies_to" value="professional" bind:group={draft.exception.appliesTo} class="mr-2 accent-[#7c3aed]" />
								{professional?.name ?? 'Profesional'}
							</label>
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.appliesTo === 'business' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="applies_to" value="business" bind:group={draft.exception.appliesTo} class="mr-2 accent-[#7c3aed]" />
								Todo el consultorio
							</label>
						</div>
					</div>
					<div>
						<span class="ux-label">Tipo</span>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.type === 'blocked' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="type" value="blocked" bind:group={draft.exception.type} class="mr-2 accent-[#7c3aed]" />
								Bloquear
							</label>
							<label class={`ux-choice px-4 py-3 text-sm font-bold ${draft.exception.type === 'extra_available' ? 'ux-choice-active' : ''}`}>
								<input type="radio" name="type" value="extra_available" bind:group={draft.exception.type} class="mr-2 accent-[#7c3aed]" />
								Sumar horario
							</label>
						</div>
					</div>
					{#if draft.exception.type === 'blocked'}
						<div>
							<span class="ux-label flex flex-wrap items-center gap-2">
								Duración del bloqueo
								{#if dirtyFields.exception}<span class="ux-inline-status ux-inline-status-warning">Sin guardar</span>{/if}
							</span>
							<div class="mt-3 grid gap-2 sm:grid-cols-2">
								<button
									type="button"
									disabled={!canOperate}
									aria-pressed={draft.exception.periodMode === 'single'}
									class={`ux-choice p-4 text-left ${draft.exception.periodMode === 'single' ? 'ux-choice-active' : ''}`}
									onclick={() => (draft.exception.periodMode = 'single')}
								>
									<span class="block font-black text-white">Un día</span>
									<span class="mt-1 block text-xs text-white/50">Elegís fecha y horario.</span>
								</button>
								<button
									type="button"
									disabled={!canOperate}
									aria-pressed={draft.exception.periodMode === 'range'}
									class={`ux-choice p-4 text-left ${draft.exception.periodMode === 'range' ? 'ux-choice-active' : ''}`}
									onclick={() => (draft.exception.periodMode = 'range')}
								>
									<span class="block font-black text-white">Rango de días</span>
									<span class="mt-1 block text-xs text-white/50">Desde y hasta, días completos.</span>
								</button><button type="button" class="ux-choice p-4 text-left" aria-pressed={draft.exception.periodMode==='multiple'} onclick={()=>draft.exception.periodMode='multiple'}><span class="block font-bold">Fechas separadas</span><span class="mt-1 block text-xs text-white/70">Elegí varios días completos.</span></button>
							</div>
						</div>
					{/if}
					{#if draft.exception.periodMode==='multiple'}<label class="ux-label">Agregar una fecha<input use:styledDate={draft.exception.date} type="date" bind:value={draft.exception.date} class="ux-input"/></label><button type="button" class="ux-btn-secondary" disabled={!draft.exception.date} onclick={()=>{draft.exception.dates=[...new Set([...(draft.exception.dates??[]),draft.exception.date])].sort();draft.exception.date='';}}>Agregar fecha</button><ul>{#each draft.exception.dates??[] as date}<li class="mt-2 flex items-center justify-between gap-3"><span>{date}</span><button type="button" class="ux-btn-secondary" aria-label={`Quitar fecha ${date}`} onclick={()=>draft.exception.dates=draft.exception.dates.filter(item=>item!==date)}>Quitar</button></li>{/each}</ul>{:else if draft.exception.periodMode === 'single'}
						<div class="grid gap-4 sm:grid-cols-2">
							<label>
								<span class="ux-label">Fecha</span>
								<input use:styledDate={draft.exception.date} name="date" type="date" bind:value={draft.exception.date} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
							<label>
								<span class="ux-label">Horario</span>
								<input name="time_range" type="text" placeholder="10 a 12" bind:value={draft.exception.timeRange} onblur={normalizeExceptionTime} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
						</div>
					{:else}
						<div class="grid gap-4 sm:grid-cols-2">
							<label>
								<span class="ux-label">Desde</span>
								<input use:styledDate={draft.exception.dateFrom} name="date_from" type="date" bind:value={draft.exception.dateFrom} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
							<label>
								<span class="ux-label">Hasta</span>
								<input use:styledDate={draft.exception.dateTo} name="date_to" type="date" min={draft.exception.dateFrom} bind:value={draft.exception.dateTo} required disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
							</label>
						</div>
						<p class="rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-sm font-bold text-violet-100">
							Incluye ambos días completos. Los turnos ya agendados no se cancelan.
						</p>
					{/if}
					<label>
						<span class="ux-label">Motivo (opcional)</span>
						<input name="reason" placeholder="Vacaciones, feriado, trámite..." bind:value={draft.exception.reason} disabled={!canOperate} class={`ux-input ${fieldStateClass(dirtyFields.exception)}`} />
					</label>
					{#if exceptionValidationMessage}
						<p class="ux-alert">{exceptionValidationMessage}</p>
					{/if}
				</div>
				<button type="submit" disabled={!canOperate || saving === 'exception' || !exceptionCanSave} class="ux-btn-secondary mt-5 w-full">
					{saving === 'exception' ? 'Guardando...' : draft.exception.periodMode === 'range' ? 'Guardar rango' : 'Guardar cambio'}
				</button>
			</form>
		</div>

		<div class="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
			<div class="ux-card">
				<div class="flex items-center justify-between gap-4">
					<h2 class="ux-section-title">Semana habitual</h2>
					<span class="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55">
						{data.rules.length} bloques
					</span>
				</div>
				<div class="mt-5 grid gap-3">
					{#each rulesByWeekday as day}
						<div class="ux-soft-card p-4">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<p class="min-w-28 text-sm font-black text-white">{day.day}</p>
								<div class="flex flex-1 flex-wrap gap-2">
									{#if day.rules.length > 0}
										{#each day.rules as rule}
											<form method="POST" action="?/delete_rule" class="flex w-full flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2" use:enhance={refreshEnhance}>
												<input type="hidden" name="rule_id" value={rule.id}/><input type="hidden" name="availability_revision" value={data.availabilityRevision??0} />
												<span class="whitespace-nowrap text-sm font-bold text-white">{rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)}</span>
												<span class="text-xs font-bold text-white/50">Descanso entre consultas: {rule.break_minutes} min</span>{#if rule.service_scope==='restricted'}<span class="text-xs text-white/75">{restrictionLabel((rule.rule_services??[]).map(item=>item.service_id))}</span>{/if}
												<button type="submit" disabled={!canOperate} class="min-h-11 whitespace-nowrap font-black text-red-200 disabled:opacity-50">Quitar</button>
											</form>
										{/each}
									{:else}
										<span class="rounded-full border border-dashed border-white/10 px-3 py-2 text-sm font-bold text-white/35">Sin atención</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="ux-card">
				<h2 class="ux-section-title">Cambios puntuales</h2>
				<div class="mt-5 grid gap-3">
						{#each data.exceptions as item}
							<form method="POST" action="?/delete_exception" class="ux-soft-card p-4" use:enhance={refreshEnhance}>
							<input type="hidden" name="exception_id" value={item.id} />
							<div class="flex items-start justify-between gap-3">
								<div class="text-sm">
									<p class="font-bold text-white">{item.type === 'blocked' ? 'Bloqueo' : item.type==='restricted'?'Franja reservada':'Horario extra'} · {exceptionTarget(item)}</p>
									<p class="mt-1 text-white/55">{exceptionPeriodLabel(item)}</p>{#if item.type==='restricted'}<p class="mt-1 text-xs text-white/75">{restrictionLabel((item.exception_services??[]).map((row:{service_id:string})=>row.service_id))}</p>{/if}
									{#if item.reason}<p class="mt-1 text-xs text-white/42">{item.reason}</p>{/if}
								</div>
								<button type="submit" disabled={!canOperate} class="min-h-11 shrink-0 whitespace-nowrap text-sm font-bold text-red-200 disabled:opacity-50">Eliminar</button>
							</div>
						</form>
					{/each}
					{#if data.exceptions.length === 0}
						<p class="ux-empty">Sin cambios puntuales cargados.</p>
					{/if}
				</div>
			</div>
			</div>
		{/if}

		<Modal open={showExitGuard} title={guardTitle}>
			<div class="space-y-5 text-sm text-white/72">
				{#if hasUnsavedChanges}
					<div>
						<p class="font-bold text-white">Hay cambios sin guardar en:</p>
						<ul class="mt-3 grid gap-2">
							{#each dirtyItems as item}
								<li class="rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 font-bold text-amber-100">
									{item}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if hasMissingMinimum}
					<div>
						<p class="font-bold text-white">{hasUnsavedChanges ? 'Además faltan datos necesarios:' : 'Este profesional todavía no tiene:'}</p>
						<ul class="mt-3 grid gap-2">
							{#each missingItems as item}
								<li class="rounded-xl border border-red-300/25 bg-red-400/10 px-3 py-2 font-bold text-red-100">
									{item}
								</li>
							{/each}
						</ul>
						<p class="mt-3">
							Sin estos datos, el profesional no va a poder aparecer correctamente al reservar un turno.
						</p>
					</div>
				{:else if hasUnsavedChanges}
					<p>Si salís ahora, esos cambios se van a perder.</p>
				{/if}

				{#if guardError}
					<p class="ux-alert">{guardError}</p>
				{/if}

				<div class="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
					{#if showSaveAllAction}
						<button type="button" class="ux-btn-secondary border-red-400/35 text-red-100" onclick={discardAndLeave}>
							Salir sin guardar
						</button>
						<button type="button" class="ux-btn-secondary" onclick={stayEditing}>Seguir editando</button>
						<button type="button" disabled={!canOperate || saving === 'all'} class="ux-btn-primary" onclick={requestSaveAll}>
							{saving === 'all' ? 'Guardando...' : 'Guardar todo'}
						</button>
					{:else}
						<button type="button" class="ux-btn-secondary border-red-400/35 text-red-100" onclick={continuePendingNavigation}>
							Salir sin completar
						</button>
						<button type="button" class="ux-btn-primary" onclick={stayEditing}>Completar ahora</button>
					{/if}
				</div>
			</div>
		</Modal>
	</section>
