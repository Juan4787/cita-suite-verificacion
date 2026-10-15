<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { invalidate, replaceState } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import FollowUpComposer from '$lib/components/seguimientos/FollowUpComposer.svelte';
	import DateTimePartsInput from '$lib/components/DateTimePartsInput.svelte';
	import DatePartsInput from '$lib/components/DatePartsInput.svelte';
	import RadiographsPanel from '$lib/components/patients/RadiographsPanel.svelte';
	import { markPatientRevisionUnverified } from '$lib/client/patient-list-cache';
	import {
		activatePatientRadiographCache,
		schedulePatientRadiographPreload
	} from '$lib/client/patient-radiographs-cache';
	import { CLINICAL_ENTRY_TYPES } from '$lib/constants';
	import { formatDate, formatDateTime } from '$lib/utils/format';
	import { formatMoneyInteger, moneyDigits } from '$lib/utils/money-input';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props<{
		data: {
			patient: any;
			entries: any[];
			appointments: any[];
			radiographs: any[];
			changeEvents?: any[];
			changeEventsDeferred?: boolean;
			role?: string;
			currentUserId?: string | null;
			clinicalTodayISO: string;
			businessTimeZone?: string;
			bookingInformationEnabled?: boolean;
			hasMoreEntries?: boolean;
			permissions: {
				canReadClinicalProfile: boolean;
				canEditClinicalProfile: boolean;
				canViewCosts: boolean;
				canEditPatient: boolean;
				canArchivePatient: boolean;
				canCreateClinicalEntry: boolean;
				canEditClinicalEntry: boolean;
				canCreateAppointment: boolean;
				canViewRadiographs: boolean;
				canUploadRadiographs: boolean;
				canViewRadiographTrash: boolean;
				canTrashRadiographs: boolean;
				canExportPatientData: boolean;
			};
			demo?: boolean;
		};
		form: {
			message?: string;
			duplicate?: boolean;
			existingId?: string;
			savedEntry?: Record<string, unknown>;
			currentPatientUpdatedAt?: string;
			currentClinicalProfileUpdatedAt?: string;
		};
	}>();

	let showEntryModal = $state(false);
	let showEditModal = $state(false);
	let editPatientDismissed = $state(false);
	let showArchiveConfirm = $state(false);
	let showDeleteConfirm = $state($page.url.searchParams.has('eliminar'));
	let showMobileActions = $state(false);
	let showFollowUpModal = $state(false);
	let tab = $state<'historial' | 'datos' | 'radiografias'>('historial');
	let filterType = $state<'Todos' | 'Consulta' | 'Tratamiento'>('Todos');
	let onlyWithNote = $state(false);
	let timelineSearch = $state('');
	let expandedId = $state<string | null>(null);
	const currentYear = new Date().getFullYear();
	const appointmentStatusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Quiere reprogramar'
	};
	let entries = $state<any[]>([]);
	let changeEvents = $state<any[]>([]);
	let hasMoreEntries = $state(false);
	let changeEventsLoaded = $state(false);
	let loadingChangeEvents = $state(false);
	let changeEventsLoadError = $state('');
	let historyLoadError = $state('');
	let loadingMoreEntries = $state(false);
	const requestedTab = $derived.by(() => $page.url.searchParams.get('tab'));
	const requestedDelete = $derived.by(() => $page.url.searchParams.has('eliminar'));
	const permissions = $derived(
		data.permissions ?? {
			canReadClinicalProfile: true,
			canEditClinicalProfile: true,
			canViewCosts: true,
			canEditPatient: true,
			canArchivePatient: true,
			canCreateClinicalEntry: true,
			canEditClinicalEntry: true,
				canCreateAppointment: true,
				canViewRadiographs: true,
				canUploadRadiographs: true,
				canViewRadiographTrash: true,
				canTrashRadiographs: true,
				canExportPatientData: false
		}
	);
	const isProfessional = $derived(data.role === 'professional');
	const radiographCacheScope = $derived(
		`${data.currentUserId ?? 'session'}:${data.patient.id}:${data.demo ? 'demo' : 'live'}:${permissions.canViewRadiographs ? 'view' : 'hidden'}`
	);
	let scheduledRadiographCacheScope = '';
	let cancelRadiographPreload: (() => void) | null = null;
	$effect(() => {
		const cacheScope = radiographCacheScope;
		const patientId = String(data.patient.id);
		const canPreload = !data.demo && permissions.canViewRadiographs;
		if (cacheScope === scheduledRadiographCacheScope) return;

		cancelRadiographPreload?.();
		cancelRadiographPreload = null;
		scheduledRadiographCacheScope = cacheScope;
		activatePatientRadiographCache(cacheScope);
		if (canPreload) {
			cancelRadiographPreload = schedulePatientRadiographPreload({
				cacheScope,
				endpoint: `/odonto/pacientes/${patientId}/radiografias`
			});
		}
	});
	onDestroy(() => cancelRadiographPreload?.());
	$effect(() => {
		if (
			requestedTab === 'historial' ||
			requestedTab === 'datos' ||
			requestedTab === 'radiografias'
		) {
			tab = requestedTab;
		}
	});
	$effect(() => {
		if (requestedDelete) {
			showDeleteConfirm = true;
		}
	});
	$effect(() => {
		if (!permissions.canArchivePatient) {
			showDeleteConfirm = false;
		}
	});
	$effect(() => {
		entries = data.entries ?? [];
		changeEvents = data.changeEvents ?? [];
		hasMoreEntries = Boolean(data.hasMoreEntries);
		changeEventsLoaded = !data.changeEventsDeferred;
		changeEventsLoadError = '';
	});
	const fmtTime = (dateStr: string) =>
		new Intl.DateTimeFormat('es-AR', {
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).format(new Date(dateStr));
	const mainTitle = (entry: any) => entry.title ?? entry.description ?? entry.entry_type;
	const isDuplicateDescription = (entry: any) =>
		entry.description ? entry.description.trim().toLowerCase() === mainTitle(entry).trim().toLowerCase() : false;
	const hasDistinctNote = (entry: any) =>
		entry.internal_note &&
		entry.internal_note.trim() &&
		entry.internal_note.trim().toLowerCase() !== (entry.description ?? '').trim().toLowerCase();

	const copyToClipboard = (text?: string) => {
		if (!text) return;
		if (navigator?.clipboard) {
			navigator.clipboard.writeText(text).catch(() => {});
		}
	};

	const lastVisit = $derived(entries?.[0]?.created_at ?? null);
	const chips = $derived(
		(
			[
				lastVisit
					? {
							label: 'Última visita',
							value: formatDate(lastVisit, data.businessTimeZone),
							intent: 'neutral' as const
					  }
					: null,
				data.patient.allergies
					? {
							label: 'Alergias',
							value: data.patient.allergies,
							intent: 'alert' as const
					  }
					: null,
				data.patient.insurance
					? {
							label: 'Obra social',
							value: data.patient.insurance,
							intent: 'neutral' as const
					  }
					: null
			].filter((c): c is { label: string; value: string; intent: 'neutral' | 'alert' } => Boolean(c))
		)
	);

	const entryMatches = (entry: any) => {
		if (filterType !== 'Todos' && entry.entry_type !== filterType) return false;
		if (onlyWithNote && !entry.internal_note) return false;
		if (timelineSearch.trim()) {
			const q = timelineSearch.toLowerCase();
			const dateText = formatDate(entry.created_at, data.businessTimeZone);
			const haystack = `${entry.entry_type} ${entry.description ?? ''} ${entry.internal_note ?? ''} ${entry.teeth ?? ''} ${dateText} ${entry.created_at}`.toLowerCase();
			if (!haystack.includes(q)) return false;
		}
		return true;
	};

	const canEditEntry = (entry: any) => {
		if (!permissions.canEditClinicalEntry) return false;
		if (!isProfessional) return true;
		const ownsEntry = entry.created_by_user_id && entry.created_by_user_id === data.currentUserId;
		const lockedAt = entry.locked_after ? new Date(entry.locked_after).getTime() : null;
		const isUnlocked = lockedAt === null || Date.now() <= lockedAt;
		return Boolean(ownsEntry && isUnlocked);
	};

	const loadMoreEntries = async () => {
		if (loadingMoreEntries || !hasMoreEntries) return;
		const last = entries.at(-1);
		if (!last?.created_at || !last?.id) {
			hasMoreEntries = false;
			return;
		}
		loadingMoreEntries = true;
		historyLoadError = '';
		try {
			const params = new URLSearchParams({
				cursor_created_at: String(last.created_at),
				cursor_id: String(last.id)
			});
			const response = await fetch(
				`/odonto/pacientes/${data.patient.id}/historial?${params.toString()}`
			);
			if (!response.ok) {
				throw new Error('No se pudo cargar más historial.');
			}
			const payload = (await response.json()) as {
				items?: any[];
				has_more?: boolean;
			};
			const incoming = Array.isArray(payload.items) ? payload.items : [];
			const existing = new Set(entries.map((entry) => entry.id));
			const deduped = incoming.filter((entry) => !existing.has(entry.id));
			entries = [...entries, ...deduped];
			hasMoreEntries = Boolean(payload.has_more);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'No se pudo cargar más historial.';
			historyLoadError = message;
		} finally {
			loadingMoreEntries = false;
		}
	};

	const loadChangeEvents = async () => {
		if (data.demo || changeEventsLoaded || loadingChangeEvents) return;
		loadingChangeEvents = true;
		changeEventsLoadError = '';
		try {
			const response = await fetch(`/odonto/pacientes/${data.patient.id}/datos`);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message ?? 'No se pudieron cargar los últimos cambios.');
			}
			changeEvents = Array.isArray(payload?.change_events) ? payload.change_events : [];
			changeEventsLoaded = true;
		} catch (error) {
			changeEventsLoadError =
				error instanceof Error ? error.message : 'No se pudieron cargar los últimos cambios.';
		} finally {
			loadingChangeEvents = false;
		}
	};

	const selectTab = (nextTab: 'historial' | 'datos' | 'radiografias') => {
		tab = nextTab;
		const url = new URL($page.url);
		if (nextTab === 'historial') url.searchParams.delete('tab');
		else url.searchParams.set('tab', nextTab);
		const nextUrl = `${url.pathname}${url.search}${url.hash}`;
		if (nextUrl !== `${$page.url.pathname}${$page.url.search}${$page.url.hash}`) {
			replaceState(nextUrl, $page.state);
		}
		if (nextTab === 'datos') void loadChangeEvents();
	};

	$effect(() => {
		if (tab === 'datos') void loadChangeEvents();
	});

	const formatCurrency = (value?: number | string | null) => {
		if (value == null || value === '') return '';
		const normalized =
			typeof value === 'string' ? value.replace(/\./g, '').replace(',', '.') : value;
		const numeric = Number(normalized);
		if (!Number.isFinite(numeric)) return '';
		const formatted = new Intl.NumberFormat('es-AR', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(numeric);
		return `$ ${formatted}`;
	};

let showEntryErrors = $state(false);
let showEditErrors = $state(false);
let showEditEntryErrors = $state(false);
let showEditEntryModal = $state(false);
let editingEntry: any | null = $state(null);
let editEntryType = $state('');
let editEntryDescription = $state('');
let editEntryTeeth = $state('');
let editEntryNote = $state('');
let editEntryCreatedAt = $state('');
let amountDisplay = $state('');
let amountRaw = $state('');
let editAmountDisplay = $state('');
let editAmountRaw = $state('');
let savingEntry = $state(false);
let savingPatient = $state(false);
let patientUpdateError = $state('');
let archiveForm: HTMLFormElement | null = $state(null);
let unarchiveForm: HTMLFormElement | null = $state(null);

const openEditPatient = () => {
	editPatientDismissed = false;
	patientUpdateError = '';
	showEditErrors = false;
	showEditModal = true;
};

const closeEditPatient = () => {
	editPatientDismissed = true;
	patientUpdateError = '';
	showEditModal = false;
};
	const isArchived = $derived(
		Boolean(isProfessional ? data.patient.professional_archived_at : data.patient.archived_at)
	);
	const hasPatientData = $derived(
		Boolean(
			data.patient.dni ||
			data.patient.phone ||
				data.patient.email ||
				data.patient.address ||
				data.patient.birth_date ||
				data.patient.insurance ||
				data.patient.insurance_plan ||
				data.patient.allergies ||
				data.patient.medication ||
				data.patient.background
		)
	);

const formatAmountInput = (value: string) => {
	const digits = moneyDigits(value);
	const formatted = formatMoneyInteger(digits);
	return { digits, formatted };
};

const mergeSavedClinicalEntry = (savedEntry: Record<string, unknown>) => {
	if (typeof savedEntry.id !== 'string' || typeof savedEntry.created_at !== 'string') return;

	const merged = [savedEntry, ...entries.filter((entry) => entry.id !== savedEntry.id)].sort(
		(left, right) => {
			const timeDifference =
				Date.parse(String(right.created_at)) - Date.parse(String(left.created_at));
			if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
			return String(right.id).localeCompare(String(left.id));
		}
	);
	const exceededFirstPage = merged.length > 30;
	entries = merged.slice(0, 30);
	hasMoreEntries = hasMoreEntries || exceededFirstPage;
};

const enhanceEntry: SubmitFunction = ({ cancel, formElement }) => {
	showEntryErrors = true;
	const hidden = formElement.querySelector<HTMLInputElement>('input[name="created_at"]');
	if (!hidden || !hidden.value || hidden.value === '__invalid__') {
		cancel();
		return;
	}
	savingEntry = true;
	return async ({ update, result }) => {
		try {
			if (result.type === 'success') {
				const savedEntry = result.data?.savedEntry;
				if (savedEntry && typeof savedEntry === 'object' && !Array.isArray(savedEntry)) {
					mergeSavedClinicalEntry(savedEntry);
				}
				markPatientRevisionUnverified();
				showEntryModal = false;
				showEntryErrors = false;
				await update({ invalidateAll: false });
				return;
			}
			if (result.type === 'redirect') {
				markPatientRevisionUnverified();
				showEntryModal = false;
			}
			await update();
		} finally {
			savingEntry = false;
		}
	};
};

const handleAmountChange = (event: Event, type: 'new' | 'edit') => {
	const target = event.currentTarget as HTMLInputElement;
	const { digits, formatted } = formatAmountInput(target.value);
	target.value = formatted;
	if (type === 'new') {
		amountDisplay = formatted;
		amountRaw = digits;
	} else {
		editAmountDisplay = formatted;
		editAmountRaw = digits;
	}
};

const handleEditSubmit = (event: SubmitEvent) => {
	showEditErrors = true;
	const formEl = event.currentTarget as HTMLFormElement;
	const birthHidden = formEl.querySelector<HTMLInputElement>('input[name="birth_date"]');
	if (birthHidden && birthHidden.value === '__invalid__') {
		event.preventDefault();
	}
};

const enhancePatientUpdate: SubmitFunction = ({ cancel, formElement }) => {
	showEditErrors = true;
	patientUpdateError = '';
	editPatientDismissed = false;
	const birthHidden = formElement.querySelector<HTMLInputElement>('input[name="birth_date"]');
	if (birthHidden && birthHidden.value === '__invalid__') {
		cancel();
		return;
	}
	if (savingPatient) {
		cancel();
		return;
	}
	savingPatient = true;
	return async ({ result, update }) => {
		try {
			if (result.type === 'error') {
				patientUpdateError =
					'No pudimos guardar los cambios. Revisá tu conexión y volvé a intentar; tus datos siguen en el formulario.';
				return;
			}
			if (result.type === 'redirect' || result.type === 'success') {
				markPatientRevisionUnverified();
				showEditModal = false;
				showEditErrors = false;
				patientUpdateError = '';
				await update();
				return;
			}
			await update({ reset: false });
		} finally {
			savingPatient = false;
		}
	};
};

const handleEditEntrySubmit = (event: SubmitEvent) => {
	showEditEntryErrors = true;
	const formEl = event.currentTarget as HTMLFormElement;
	const hidden = formEl.querySelector<HTMLInputElement>('input[name="created_at"]');
	if (!hidden || !hidden.value || hidden.value === '__invalid__') {
		event.preventDefault();
	}
};

const openEditEntry = (entry: any) => {
	editingEntry = entry;
	editEntryType = entry.entry_type ?? '';
	editEntryDescription = entry.description ?? '';
	editEntryTeeth = entry.teeth ?? '';
	const initialAmount = entry.amount != null ? String(entry.amount) : '';
	const { digits, formatted } = formatAmountInput(initialAmount);
	editAmountDisplay = formatted;
	editAmountRaw = digits;
	editEntryNote = entry.internal_note ?? '';
	editEntryCreatedAt = entry.created_at ?? '';
	showEditEntryErrors = false;
	showEditEntryModal = true;
};

const openNewEntryModal = () => {
	amountDisplay = '';
	amountRaw = '';
	showEntryErrors = false;
	showEntryModal = true;
};

const handleFollowUpCreated = async () => {
	showFollowUpModal = false;
	await invalidate('app:follow-ups');
};

const preventEnterSubmit = (event: KeyboardEvent) => {
	if (event.key !== 'Enter') return;
	const target = event.target as HTMLElement | null;
	if (target instanceof HTMLTextAreaElement) return;
	event.preventDefault();
	};
</script>

<div class="flex flex-col gap-5">
	<div class="ux-card">
		<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 space-y-1">
					<h1 class="break-words text-[28px] font-semibold text-neutral-900 dark:text-white sm:text-[30px]">
						{data.patient.full_name}
					</h1>
				</div>
				<button
					type="button"
					class="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641] md:hidden"
					onclick={() => (showMobileActions = true)}
					aria-label="Acciones del paciente"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
						<circle cx="6" cy="12" r="1.6" />
						<circle cx="12" cy="12" r="1.6" />
						<circle cx="18" cy="12" r="1.6" />
					</svg>
				</button>
			</div>
			<div class="hidden md:grid md:grid-cols-2 md:gap-2 md:justify-items-start lg:flex lg:flex-wrap lg:items-center lg:gap-3">
				{#if permissions.canArchivePatient}
					<form method="post" action="?/archive_patient" class="contents" bind:this={archiveForm}>
						<button
							type="submit"
							class="ux-btn-secondary md:justify-self-start"
							onclick={(event: MouseEvent) => {
								event.preventDefault();
								showArchiveConfirm = true;
							}}
						>
							{isArchived ? 'Desarchivar paciente' : 'Archivar paciente'}
						</button>
					</form>
				{/if}
				<form method="post" action="?/unarchive_patient" class="hidden" bind:this={unarchiveForm}></form>
				{#if isProfessional}
					<button
						type="button"
						class="ux-btn-danger md:col-span-2 md:justify-self-start lg:col-span-1"
						onclick={() => (showDeleteConfirm = true)}
					>
						Eliminar paciente
					</button>
				{/if}
				{#if permissions.canCreateClinicalEntry}
					<button
						class="ux-btn-primary md:col-span-2 md:justify-self-start lg:col-span-1"
						type="button"
						onclick={openNewEntryModal}
					>
						+ Registrar consulta
					</button>
				{/if}
				{#if permissions.canCreateAppointment}
					<a
						href={`/odonto/agenda?patient_id=${data.patient.id}`}
						class="ux-btn-secondary md:col-span-2 md:justify-self-start lg:col-span-1"
					>
						+ Nuevo turno
					</a>
				{/if}
				{#if data.followUpParticipates}
					<button
						class="ux-btn-secondary md:col-span-2 md:justify-self-start lg:col-span-1"
						type="button"
						onclick={() => (showFollowUpModal = true)}
					>
						+ Agregar seguimiento
					</button>
				{/if}
			</div>
		</div>
		{#if data.bookingInformationEnabled && data.permissions.canReadClinicalProfile}<a class="ux-btn-secondary mt-4" href={`/odonto/pacientes/${data.patient.id}/informacion-previa`}>Información aportada al reservar</a>{/if}
		<div class="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 sm:text-sm md:flex md:items-center md:gap-3">
			<a
				href="/odonto/pacientes"
				class="flex w-full items-center justify-center gap-2 rounded-full border border-neutral-200 px-2 py-2 text-xs font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 hover:shadow-card dark:border-[#1f3554] dark:text-[#eaf1ff] dark:hover:bg-[#122641] sm:px-4 sm:text-sm md:w-auto"
			>
				<svg
					aria-hidden="true"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
				</svg>
				Atrás
			</a>
			<button
				class={`w-full rounded-full px-2 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:w-auto ${
					tab === 'historial'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => selectTab('historial')}
			>
				Historial
			</button>
			<button
				class={`w-full rounded-full px-2 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:w-auto ${
					tab === 'datos'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => selectTab('datos')}
			>
				Datos
			</button>
			<button
				class={`w-full rounded-full px-2 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:w-auto ${
					tab === 'radiografias'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => selectTab('radiografias')}
			>
				Estudios y documentos
			</button>
		</div>
		<div class="mt-4 flex flex-wrap gap-3">
			{#each chips as chip}
				<div
					class={`flex min-w-0 max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
						{
							neutral: 'bg-white/60 text-neutral-800 dark:bg-white/10 dark:text-neutral-100',
							alert: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100',
							warn: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-100'
						}[chip.intent]
					}`}
				>
					<span class="shrink-0 text-[11px] uppercase tracking-wide">{chip.label}:</span>
					<span class="min-w-0 break-words">{chip.value}</span>
				</div>
			{/each}
		</div>
		<div class="mt-5 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-sm font-semibold text-neutral-900 dark:text-white">Próximos turnos</h2>
				<a href={`/odonto/agenda`} class="text-xs font-semibold text-[#7c3aed] hover:underline">Abrir agenda</a>
			</div>
			<div class="mt-3 grid gap-2">
				{#each data.appointments as appointment}
					<a href={`/odonto/turnos/${appointment.id}`} class="rounded-xl border border-neutral-100 bg-white px-3 py-2 text-sm transition hover:bg-neutral-50 dark:border-[#1f3554] dark:bg-[#152642] dark:hover:bg-[#122641]">
						<span class="block font-semibold text-neutral-900 dark:text-white">{formatDateTime(appointment.starts_at)} · {appointment.service_name_snapshot}</span>
						<span class="text-xs text-neutral-500 dark:text-neutral-300">{appointment.professional_name_snapshot} · {appointmentStatusLabels[appointment.status] ?? 'Estado pendiente'}</span>
					</a>
				{/each}
				{#if data.appointments.length === 0}
					<p class="text-sm text-neutral-600 dark:text-neutral-200">No hay próximos turnos.</p>
				{/if}
			</div>
		</div>
	</div>

	{#if tab === 'historial'}
		<div class="ux-card">
			<div class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center">
				<div class="relative w-full sm:max-w-xs">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18M6 12h12M10 19h4" />
						</svg>
					</span>
					<select
						bind:value={filterType}
						class="w-full rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-[#1f3554] dark:bg-[#0f1f36]"
					>
						<option value="Todos">Filtrar por tipo: Todos</option>
						<option value="Consulta">Filtrar por tipo: Consulta</option>
						<option value="Diagnóstico">Filtrar por tipo: Diagnóstico</option>
						<option value="Tratamiento">Filtrar por tipo: Tratamiento</option>
					</select>
				</div>
				<div class="relative w-full">
					<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="11" cy="11" r="7" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M20 20l-3.5-3.5" />
						</svg>
					</span>
					<input
						type="search"
						placeholder="Buscar (palabra, fecha)"
						class="w-full rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-700 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-50"
						bind:value={timelineSearch}
					/>
					</div>
				</div>
				{#if historyLoadError}
					<div class="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100" role="alert">
						<p>{historyLoadError}</p>
						<button type="button" class="font-semibold underline" onclick={() => (historyLoadError = '')}>Cerrar</button>
					</div>
				{/if}
				<div class="mt-4">
				{#if entries.length === 0}
					<p class="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-200">
						<span class="md:hidden">Sin consultas registradas. Cargá la primera tocando el botón + de abajo a la derecha.</span>
						<span class="hidden md:inline">Sin consultas registradas. Cargá la primera desde “Registrar consulta”.</span>
					</p>
				{:else}
					<div class="relative pl-8">
						<span class="absolute left-2 top-0 h-full w-px bg-neutral-200 dark:bg-[#1f3554]/60"></span>
						<div class="space-y-3">
							{#each entries as entry (entry.id ?? entry.created_at)}
								{#if entryMatches(entry)}
									{#key entry.id ?? entry.created_at}
										<div
											role="button"
											tabindex="0"
											onclick={() => (expandedId = expandedId === (entry.id ?? entry.created_at) ? null : entry.id ?? entry.created_at)}
											onkeydown={(e) => e.key === 'Enter' && (expandedId = expandedId === (entry.id ?? entry.created_at) ? null : entry.id ?? entry.created_at)}
											class="group relative overflow-hidden rounded-xl border border-neutral-100 bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] dark:border-[#1f3554] dark:bg-[#0f1f36]"
										>
											<span class="absolute left-[-14px] top-5 h-3 w-3 rounded-full border-2 border-white bg-[#7c3aed] shadow dark:border-[#0f1f36]"></span>
											<div class="flex flex-wrap items-start gap-3">
												<div class="flex min-w-0 flex-1 items-center gap-3">
													<span class="rounded-full bg-[#7c3aed]/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#5b21b6] dark:bg-[#7c3aed]/20 dark:text-[#d9c5ff]">
														{entry.entry_type}
													</span>
													<p class="text-[16px] font-semibold text-neutral-900 dark:text-white line-clamp-1">
														{mainTitle(entry)}
													</p>
												</div>
												<div class="flex w-full items-center justify-end gap-2 sm:w-auto sm:shrink-0 sm:justify-start">
													{#if entry.amount}
														<span class="text-[15px] font-semibold text-neutral-800 whitespace-nowrap dark:text-neutral-100">
															{formatCurrency(entry.amount)}
														</span>
													{/if}
													{#if canEditEntry(entry)}
														<button
															type="button"
															class="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641]"
															onclick={(event) => {
																event.stopPropagation();
																openEditEntry(entry);
															}}
														>
															<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
																<path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
																<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
															</svg>
															Editar
														</button>
													{/if}
												</div>
											</div>
											{#if entry.description && !isDuplicateDescription(entry)}
												<p class="mt-1 text-[13px] font-medium text-neutral-700 opacity-85 line-clamp-1 dark:text-neutral-200">
													{entry.description}
												</p>
											{/if}
											<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-300">
												<span>{formatDate(entry.created_at, data.businessTimeZone)}</span>
												<span>·</span>
												<span>{fmtTime(entry.created_at)}</span>
												{#if entry.teeth}
													<span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-white/10 dark:text-neutral-200">
														Zona {entry.teeth}
													</span>
												{/if}
											</div>
											{#if hasDistinctNote(entry)}
												<p class="mt-2 text-xs text-neutral-500 dark:text-neutral-300 line-clamp-1">
													Nota: {entry.internal_note}
												</p>
											{/if}
											{#if expandedId === (entry.id ?? entry.created_at)}
												<div class="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-100">
													{#if entry.amount}
														<p><span class="font-semibold">Importe:</span> {formatCurrency(entry.amount)}</p>
													{/if}
													{#if entry.internal_note}
														<p><span class="font-semibold">Nota completa:</span> {entry.internal_note}</p>
													{/if}
												</div>
											{/if}
										</div>
									{/key}
								{/if}
							{/each}
						</div>
					</div>
					{#if hasMoreEntries}
						<div class="mt-4 flex justify-center">
							<button
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-200 dark:hover:bg-[#122641] disabled:cursor-not-allowed disabled:opacity-60"
								onclick={loadMoreEntries}
								disabled={loadingMoreEntries}
							>
								{loadingMoreEntries ? 'Cargando...' : 'Cargar más historial'}
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{:else if tab === 'datos'}
		<div class="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm dark:border-[#1f3554] dark:bg-[#122641] sm:p-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Datos del paciente</h2>
				{#if permissions.canEditPatient}
					<button
						type="button"
						class="w-full rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white sm:w-auto"
						onclick={openEditPatient}
					>
						{hasPatientData ? 'Editar datos del paciente' : 'Agregar datos del paciente'}
					</button>
				{/if}
			</div>
			<div class="mt-4 space-y-4">
				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Identidad</p>
						{#if permissions.canEditPatient}
							<button
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
								onclick={openEditPatient}
							>
								Editar
							</button>
						{/if}
					</div>
					<div class="space-y-1">
						<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Nombre</p>
						<p class="break-words text-[17px] font-semibold text-neutral-900 dark:text-white">
							{data.patient.full_name}
						</p>
					</div>
				</div>
				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Alertas médicas</p>
							{#if permissions.canEditPatient}
								<button
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
									onclick={openEditPatient}
								>
									Editar
								</button>
							{/if}
					</div>
					{#if data.patient.clinical_profile_patient_reported}<p class="mb-3 text-xs text-neutral-600 dark:text-neutral-300">Última actualización informada por el paciente desde su reserva. Revisá el historial de información previa para consultar los cambios.</p>{/if}
                    {#if permissions.canReadClinicalProfile && data.patient.custom_fields?.booking_age}<p class="mb-3 text-sm">Edad declarada: {data.patient.custom_fields.booking_age.years} años (al {data.patient.custom_fields.booking_age.as_of}).</p>{/if}
                    {#if permissions.canReadClinicalProfile && data.patient.booking_extra_fields?.length}<dl class="mb-4 space-y-2">{#each data.patient.booking_extra_fields as field}<div><dt class="text-xs text-neutral-600 dark:text-neutral-300">{field.label}</dt><dd class="text-sm whitespace-pre-wrap break-words">{typeof field.value === 'boolean' ? field.value ? 'Sí' : 'No' : String(field.value)}</dd></div>{/each}</dl>{/if}
                    <div class="space-y-3">
                        <div class="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-amber-100/30 px-3 py-2 dark:bg-amber-500/10">
							<div class="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-200">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
								</svg>
								Alergias
							</div>
							<p
								class={`min-w-0 flex-1 break-words text-right text-[15px] font-semibold ${
									data.patient.allergies ? 'text-amber-900 dark:text-amber-100' : 'text-amber-700/70 dark:text-amber-200/70'
								}`}
							>
								{data.patient.allergies ?? 'Sin registrar'}
							</p>
						</div>
						<div class="flex min-w-0 items-start justify-between gap-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75 17.25 17.25M9 5.25 5.25 9 9 12.75 12.75 9 9 5.25Z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 11.25 11.25 15 15 18.75 18.75 15 15 11.25Z" />
								</svg>
								Medicación
							</div>
							<p
								class={`min-w-0 flex-1 break-words text-left text-[15px] font-semibold ${
									data.patient.medication ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'
								}`}
							>
								{data.patient.medication ?? 'Sin registrar'}
							</p>
						</div>
						<div class="flex min-w-0 items-start justify-between gap-3">
							<div class="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v12.75l-4.5-2.25L9.75 18.75 5.25 21V6A1.5 1.5 0 0 1 6.75 4.5Z" />
								</svg>
								Antecedentes
							</div>
							<p
								class={`min-w-0 flex-1 break-words text-left text-[15px] font-semibold whitespace-pre-wrap ${
									data.patient.background ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'
								}`}
							>
								{data.patient.background ?? 'Sin registrar'}
							</p>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Contacto</p>
							{#if permissions.canEditPatient}
								<button
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
									onclick={openEditPatient}
								>
									Editar
								</button>
							{/if}
					</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Teléfono</p>
							<div class="flex items-center gap-2">
								<p class={`min-w-0 flex-1 break-words text-[15px] font-semibold ${data.patient.phone ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{data.patient.phone ?? 'Sin registrar'}
								</p>
								{#if data.patient.phone}
									<button
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(data.patient.phone)}
										title="Copiar"
									>
										⧉
									</button>
								{/if}
							</div>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Correo electrónico</p>
							<div class="flex items-center gap-2">
								<p class={`min-w-0 flex-1 break-all text-[15px] font-semibold ${data.patient.email ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{data.patient.email ?? 'Sin registrar'}
								</p>
								{#if data.patient.email}
									<button
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(data.patient.email)}
										title="Copiar"
									>
										⧉
									</button>
								{/if}
							</div>
						</div>
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Dirección</p>
							<div class="flex items-center gap-2">
								<p class={`min-w-0 flex-1 break-words text-[15px] font-semibold ${data.patient.address ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{data.patient.address ?? 'Sin registrar'}
								</p>
								{#if data.patient.address}
									<button
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(data.patient.address)}
										title="Copiar"
									>
										⧉
									</button>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Administrativo</p>
							{#if permissions.canEditPatient}
								<button
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
									onclick={openEditPatient}
								>
									Editar
								</button>
							{/if}
					</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Obra social</p>
							<p class={`text-[15px] font-semibold ${data.patient.insurance ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{data.patient.insurance ?? 'Sin registrar'}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Plan de la obra social</p>
							<p class={`text-[15px] font-semibold ${data.patient.insurance_plan ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{data.patient.insurance_plan ?? 'Sin registrar'}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Nacimiento</p>
							<p class={`text-[15px] font-semibold ${data.patient.birth_date ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{data.patient.birth_date ? formatDate(data.patient.birth_date, data.businessTimeZone) : 'Sin registrar'}
							</p>
						</div>
					</div>
				</div>
			</div>
			{#if loadingChangeEvents}
				<div class="mt-5 rounded-xl border border-neutral-100 bg-white/60 p-4 text-sm font-semibold text-neutral-500 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-300" aria-live="polite">
					Cargando últimos cambios…
				</div>
			{:else if changeEventsLoadError}
				<div class="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100">
					<p>{changeEventsLoadError}</p>
					<button type="button" class="mt-3 font-semibold underline" onclick={loadChangeEvents}>Reintentar</button>
				</div>
			{:else if changeEvents.length > 0}
				<div class="mt-5 rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<p class="text-[13px] font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Últimos cambios</p>
					<div class="mt-3 space-y-3">
						{#each changeEvents.slice(0, 5) as event}
							<div class="rounded-lg border border-neutral-100 bg-white/70 px-3 py-2 dark:border-[#1f3554] dark:bg-[#122641]">
								<p class="text-sm font-semibold text-neutral-900 dark:text-white">{event.summary}</p>
								<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
									{formatDateTime(event.created_at)} · {event.changed_by_name}
								</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<details class="mt-4 text-[11px] text-[#65738d] dark:text-[#7b8aa5]">
				<summary class="cursor-pointer text-neutral-600 dark:text-neutral-200">Ver detalles</summary>
				<p class="mt-1">
					Creado: {formatDate(data.patient.created_at, data.businessTimeZone)} • Última actualización: {formatDateTime(data.patient.updated_at, data.businessTimeZone)}
				</p>
			</details>
		</div>
	{:else if tab === 'radiografias'}
		<RadiographsPanel
			patientId={data.patient.id}
			cacheScope={radiographCacheScope}
			initialItems={data.demo ? data.radiographs : []}
			canView={permissions.canViewRadiographs}
			canUpload={permissions.canUploadRadiographs}
			canViewTrash={permissions.canViewRadiographTrash}
			canTrash={permissions.canTrashRadiographs}
			todayISO={data.clinicalTodayISO}
			demo={Boolean(data.demo)}
		/>
	{/if}
	{#if permissions.canExportPatientData && !data.demo}
		<section class="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-[#1f3554] dark:bg-[#0f1f36] sm:flex sm:items-center sm:justify-between sm:gap-5" aria-labelledby="patient-export-title">
			<div class="min-w-0">
				<h2 id="patient-export-title" class="text-lg font-black text-neutral-950 dark:text-white">Exportar datos de este paciente</h2>
				<p class="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
					Prepará un Excel con su ficha, historial, turnos y seguimientos. No incluye radiografías ni adjuntos.
				</p>
			</div>
			<a
				href={`/odonto/exportar-datos?patient_id=${encodeURIComponent(String(data.patient.id))}`}
				class="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-black text-violet-800 transition hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] dark:border-violet-400/35 dark:bg-violet-400/10 dark:text-violet-100 dark:hover:bg-violet-400/15 sm:mt-0 sm:w-auto"
			>
				Abrir exportación
			</a>
		</section>
	{/if}
</div>
<!-- FAB móvil para nueva entrada -->
{#if tab === 'historial' && permissions.canCreateClinicalEntry}
	<button
		class="fixed bottom-20 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#7c3aed] text-2xl font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] md:hidden"
		onclick={openNewEntryModal}
		aria-label="Registrar consulta"
	>
		+
	</button>
{/if}

<Modal open={showMobileActions} title="Acciones del paciente" on:close={() => (showMobileActions = false)}>
	<div class="space-y-3">
		{#if permissions.canArchivePatient}
			<button
				type="button"
				class="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641]"
				onclick={() => {
					showMobileActions = false;
					showArchiveConfirm = true;
				}}
			>
				{isArchived ? 'Desarchivar paciente' : 'Archivar paciente'}
			</button>
		{/if}
		{#if permissions.canCreateClinicalEntry}
			<button
				type="button"
				class="w-full rounded-xl bg-[#7c3aed] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6d28d9]"
				onclick={() => {
					showMobileActions = false;
					openNewEntryModal();
				}}
			>
				Registrar consulta
			</button>
		{/if}
		{#if permissions.canCreateAppointment}
			<a
				href={`/odonto/agenda?patient_id=${data.patient.id}`}
				class="block w-full rounded-xl border border-[#7c3aed]/40 px-4 py-3 text-center text-sm font-semibold text-[#7c3aed] transition hover:bg-[#7c3aed]/10 dark:text-[#c4b5fd]"
				onclick={() => (showMobileActions = false)}
			>
				Nuevo turno
			</a>
		{/if}
		{#if data.followUpParticipates}
			<button
				type="button"
				class="block w-full rounded-xl border border-[#7c3aed]/40 px-4 py-3 text-center text-sm font-semibold text-[#7c3aed] transition hover:bg-[#7c3aed]/10 dark:text-[#c4b5fd]"
				onclick={() => {
					showMobileActions = false;
					showFollowUpModal = true;
				}}
			>
				Agregar seguimiento
			</button>
		{/if}
		{#if isProfessional}
			<button
				type="button"
				class="w-full rounded-xl border border-red-300/70 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-500/10"
				onclick={() => {
					showMobileActions = false;
					showDeleteConfirm = true;
				}}
			>
				Eliminar paciente
			</button>
		{/if}
		<button
			type="button"
			class="w-full rounded-xl px-4 py-3 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-[#122641]"
			onclick={() => (showMobileActions = false)}
		>
			Cerrar
		</button>
	</div>
</Modal>

<Modal open={showFollowUpModal} title="Agregar seguimiento" closable on:close={() => (showFollowUpModal = false)}>
	<FollowUpComposer
		patient={{ id: data.patient.id, full_name: data.patient.full_name }}
		canAssign={data.followUpCanAssign}
		todayISO={data.followUpTodayISO}
		onCancel={() => (showFollowUpModal = false)}
		onCreated={handleFollowUpCreated}
	/>
</Modal>

<Modal open={showEntryModal} title={`Registrar consulta - ${data.patient.full_name}`} on:close={() => (showEntryModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form
		method="post"
		action="?/add_entry"
		use:enhance={enhanceEntry}
		class="space-y-4"
		onkeydown={preventEnterSubmit}
	>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="entry_type">Tipo de consulta</label>
				<select
					id="entry_type"
					name="entry_type"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				>
					<option value="">Seleccionar</option>
					{#each CLINICAL_ENTRY_TYPES as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="created_at-year">Fecha y hora</label>
				<DateTimePartsInput name="created_at" minYear={2000} maxYear={2045} showErrors={showEntryErrors} />
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="description">Descripción</label>
			<textarea
				id="description"
				name="description"
				required
				rows="4"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				placeholder="Motivo de consulta, hallazgos, indicaciones..."
			></textarea>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="teeth">{data.businessIndustry && data.businessIndustry!=='odontology'?'Zona / referencia (opcional)':'Dientes / zona (opcional)'}</label>
				<input
					id="teeth"
					name="teeth"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Ej: 11-12"
				/>
			</div>
			{#if permissions.canViewCosts}
				<div class="space-y-2">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="amount">Importe (opcional)</label>
					<input type="hidden" name="amount" value={amountRaw} />
					<input
						id="amount"
						name="amount_display"
						type="text"
						inputmode="numeric"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						placeholder="Ej: 18.000"
						value={amountDisplay}
						oninput={(event) => handleAmountChange(event, 'new')}
					/>
				</div>
			{/if}
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="internal_note">Nota interna (opcional)</label>
				<input
					id="internal_note"
					name="internal_note"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					placeholder="Ej: recordar control"
				/>
			</div>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				disabled={savingEntry}
				onclick={() => (showEntryModal = false)}
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
			>
				Cancelar
			</button>
			<button
				type="submit"
				disabled={savingEntry}
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				{savingEntry ? 'Guardando…' : 'Guardar'}
			</button>
		</div>
	</form>
</Modal>

<Modal open={showArchiveConfirm} title={isArchived ? 'Desarchivar paciente' : 'Archivar paciente'} on:close={() => (showArchiveConfirm = false)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		{#if isArchived}
			<p>{isProfessional ? 'El paciente volverá a tu lista de activos.' : 'El paciente volverá a la lista de activos.'}</p>
		{:else}
			<p>{isProfessional ? 'El paciente se ocultará de tu lista activa. Podrás recuperarlo desde Archivados.' : 'El paciente se moverá a “Archivados”. Podrás recuperarlo más adelante.'}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => (showArchiveConfirm = false)}
			>
				Cancelar
			</button>
				<button
					type="button"
					class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
					onclick={() => {
						showArchiveConfirm = false;
					if (isArchived) {
						unarchiveForm?.submit();
					} else {
						archiveForm?.submit();
					}
					}}
				>
					{isArchived ? 'Desarchivar paciente' : 'Archivar paciente'}
				</button>
			</div>
		</div>
	</Modal>

<Modal open={showDeleteConfirm} title="Eliminar paciente" on:close={() => (showDeleteConfirm = false)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		{#if isProfessional}
			<p class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100">
				Para eliminar un paciente, consultá al dueño del consultorio.
			</p>
		{:else}
			<p class="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100">
				La app no elimina pacientes desde esta pantalla. Para ocultarlo de la lista, archivá el paciente.
			</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => {
					showDeleteConfirm = false;
				}}
			>
				Entendido
			</button>
			{#if !isProfessional && permissions.canArchivePatient && !isArchived}
				<button
					type="button"
					class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
					onclick={() => {
						showDeleteConfirm = false;
						showArchiveConfirm = true;
					}}
				>
					Archivar paciente
				</button>
			{/if}
		</div>
	</div>
</Modal>

<Modal open={showEditEntryModal} title="Editar entrada" on:close={() => (showEditEntryModal = false)}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form method="post" action="?/update_entry" class="space-y-4" onkeydown={preventEnterSubmit} onsubmit={handleEditEntrySubmit}>
		<input type="hidden" name="entry_id" value={editingEntry?.id ?? ''} />
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_entry_type">Tipo de consulta</label>
				<select
					id="edit_entry_type"
					name="entry_type"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={editEntryType}
				>
					<option value="">Seleccionar</option>
					{#each CLINICAL_ENTRY_TYPES as type}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_created_at-year">Fecha y hora</label>
				<DateTimePartsInput name="created_at" minYear={2000} maxYear={2045} initialValue={editEntryCreatedAt} showErrors={showEditEntryErrors} />
			</div>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_description">Descripción</label>
			<textarea
				id="edit_description"
				name="description"
				required
				rows="4"
				class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
				bind:value={editEntryDescription}
				placeholder="Motivo de consulta, hallazgos, indicaciones..."
			></textarea>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_teeth">{data.businessIndustry && data.businessIndustry!=='odontology'?'Zona / referencia (opcional)':'Dientes / zona (opcional)'}</label>
				<input
					id="edit_teeth"
					name="teeth"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={editEntryTeeth}
					placeholder="Ej: 11-12"
				/>
			</div>
			{#if permissions.canViewCosts}
				<div class="space-y-2">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_amount">Importe (opcional)</label>
					<input type="hidden" name="amount" value={editAmountRaw} />
					<input
						id="edit_amount"
						name="amount_display"
						type="text"
						inputmode="numeric"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={editAmountDisplay}
						oninput={(event) => handleAmountChange(event, 'edit')}
						placeholder="Ej: 18.000"
					/>
				</div>
			{/if}
			<div class="space-y-2">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="edit_internal_note">Nota interna (opcional)</label>
				<input
					id="edit_internal_note"
					name="internal_note"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					bind:value={editEntryNote}
					placeholder="Ej: recordar control"
				/>
			</div>
		</div>
		{#if form?.message}
			<p class="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{form.message}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				onclick={() => (showEditEntryModal = false)}
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				Guardar cambios
			</button>
		</div>
	</form>
</Modal>

<Modal open={showEditModal} title="Editar datos" on:close={closeEditPatient}>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form
		method="post"
		action="?/update_patient"
		class="space-y-3"
		onkeydown={preventEnterSubmit}
		onsubmit={handleEditSubmit}
		use:enhance={enhancePatientUpdate}
		aria-busy={savingPatient}
	>
		<input
			type="hidden"
			name="expected_patient_updated_at"
			value={form?.currentPatientUpdatedAt ?? data.patient.updated_at ?? ''}
		/>
		<input
			type="hidden"
			name="expected_clinical_profile_updated_at"
			value={form?.currentClinicalProfileUpdatedAt ?? data.patient.clinical_profile_updated_at ?? ''}
		/>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="full_name">Nombre del paciente *</label>
				<input
					id="full_name"
					name="full_name"
					required
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.full_name ?? ''}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="email">Correo electrónico (opcional)</label>
				<input
					id="email"
					name="email"
					type="email"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.email ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="phone">Teléfono (opcional)</label>
				<input
					id="phone"
					name="phone"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.phone ?? ''}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="dni">DNI (opcional)</label>
				<input
					id="dni"
					name="dni"
					inputmode="numeric"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.dni ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="birth_date-year">Fecha de nacimiento (opcional)</label>
				<DatePartsInput
					name="birth_date"
					initialValue={data.patient.birth_date ?? null}
					minYear={1900}
					maxYear={currentYear}
					showErrors={showEditErrors}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="address">Dirección (opcional)</label>
				<input
					id="address"
					name="address"
					class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					value={data.patient.address ?? ''}
				/>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<div class="space-y-3">
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="insurance">Obra social (opcional)</label>
					<input
						id="insurance"
						name="insurance"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={data.patient.insurance ?? ''}
					/>
				</div>
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="insurance_plan">
						Plan de la obra social (opcional)
					</label>
					<input
						id="insurance_plan"
						name="insurance_plan"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={data.patient.insurance_plan ?? ''}
					/>
				</div>
			</div>
			{#if permissions.canEditClinicalProfile}
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="allergies">Alergias (opcional)</label>
					<input
						id="allergies"
						name="allergies"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
						value={data.patient.allergies ?? ''}
					/>
				</div>
			{/if}
		</div>
		{#if permissions.canEditClinicalProfile}
			<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="medication">Medicación (opcional)</label>
					<textarea
						id="medication"
						name="medication"
						rows="2"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					>{data.patient.medication ?? ''}</textarea>
				</div>
				<div class="space-y-1">
					<label class="text-sm font-semibold text-neutral-800 dark:text-white" for="background">Antecedentes (opcional)</label>
					<textarea
						id="background"
						name="background"
						rows="2"
						class="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm shadow-sm outline-none transition text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white dark:placeholder:text-neutral-500"
					>{data.patient.background ?? ''}</textarea>
				</div>
			</div>
		{/if}
		{#if form?.message && !editPatientDismissed}
			<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/50 dark:bg-red-500/15 dark:text-red-100">
				<p>{form.message}</p>
				{#if form.duplicate && form.existingId}
					<a
						class="mt-3 inline-flex rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400"
						href={`/odonto/pacientes/${form.existingId}`}
						data-sveltekit-preload-data="tap"
					>
						Abrir paciente existente
					</a>
				{/if}
			</div>
		{/if}
		{#if patientUpdateError}
			<div
				class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/50 dark:bg-red-500/15 dark:text-red-100"
				role="alert"
			>
				{patientUpdateError}
			</div>
		{/if}
		<p class="text-xs text-neutral-500 dark:text-neutral-300">Todos los datos son opcionales.</p>
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={closeEditPatient}
			>
				Cancelar
			</button>
			<button
				type="submit"
				disabled={savingPatient}
				class="w-full rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 sm:w-auto"
			>
				{savingPatient ? 'Guardando…' : 'Guardar cambios'}
			</button>
		</div>
	</form>
</Modal>
