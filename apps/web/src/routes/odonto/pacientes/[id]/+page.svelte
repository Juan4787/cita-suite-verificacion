<script lang="ts">
	import type {
		PatientDetailViewData,
		PatientFormState,
		PatientHistoryEntry
	} from '$lib/patients/contracts';
	import {
		comparePatientHistoryEntries,
		readSavedPatientEntry
	} from '$lib/patients/history-contract';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { invalidate, replaceState } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import FollowUpComposer from '$lib/components/seguimientos/FollowUpComposer.svelte';
	import DateTimePartsInput from '$lib/components/DateTimePartsInput.svelte';
	import DatePartsInput from '$lib/components/DatePartsInput.svelte';
	import RadiographsPanel from '$lib/components/patients/RadiographsPanel.svelte';
	import PatientHistoryPanel from '$lib/components/patients/PatientHistoryPanel.svelte';
	import PatientProfilePanel from '$lib/components/patients/PatientProfilePanel.svelte';
	import { markPatientRevisionUnverified } from '$lib/client/patient-list-cache';
	import {
		activatePatientRadiographCache,
		schedulePatientRadiographPreload
	} from '$lib/client/patient-radiographs-cache';
	import { CLINICAL_ENTRY_TYPES } from '$lib/constants';
	import { formatDate, formatDateTime } from '$lib/utils/format';
	import { formatMoneyInteger, moneyDigits } from '$lib/utils/money-input';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form }: { data: PatientDetailViewData; form?: PatientFormState | null } = $props();

	let showEntryModal = $state(false);
	let showEditModal = $state(false);
	let editPatientDismissed = $state(false);
	let showArchiveConfirm = $state(false);
	let showDeleteConfirm = $state($page.url.searchParams.has('eliminar'));
	let showMobileActions = $state(false);
	let showFollowUpModal = $state(false);
	let tab = $state<'historial' | 'datos' | 'radiografias'>(
		untrack(() => (data.permissions.canReadClinicalHistory ? 'historial' : 'datos'))
	);
	const currentYear = new Date().getFullYear();
	const appointmentStatusLabels: Record<string, string> = {
		reserved: 'Reservado',
		confirmed: 'Confirmado',
		cancelled: 'Cancelado',
		reschedule_requested: 'Quiere reprogramar'
	};
	let entries = $state<PatientHistoryEntry[]>(untrack(() => data.entries));
	let hasMoreEntries = $state(untrack(() => Boolean(data.hasMoreEntries)));
	const requestedTab = $derived.by(() => $page.url.searchParams.get('tab'));
	const requestedDelete = $derived.by(() => $page.url.searchParams.has('eliminar'));
	const permissions = $derived(
		data.permissions ?? {
			canReadClinicalHistory: false,
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
		if (requestedTab === 'historial' || requestedTab === 'datos' || requestedTab === 'radiografias') {
			tab =
				requestedTab === 'historial' && !permissions.canReadClinicalHistory ? 'datos' : requestedTab;
		}
		if (!permissions.canReadClinicalHistory && tab === 'historial') tab = 'datos';
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
		hasMoreEntries = Boolean(data.hasMoreEntries);
	});
	const lastVisit = $derived(entries?.[0]?.created_at ?? null);
	const chips = $derived(
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
	);

	const selectTab = (nextTab: 'historial' | 'datos' | 'radiografias') => {
		if (nextTab === 'historial' && !permissions.canReadClinicalHistory) return;
		tab = nextTab;
		const url = new URL($page.url);
		if (nextTab === 'historial') url.searchParams.delete('tab');
		else url.searchParams.set('tab', nextTab);
		const nextUrl = `${url.pathname}${url.search}${url.hash}`;
		if (nextUrl !== `${$page.url.pathname}${$page.url.search}${$page.url.hash}`) {
			replaceState(nextUrl, $page.state);
		}
	};

	let showEntryErrors = $state(false);
	let showEditErrors = $state(false);
	let showEditEntryErrors = $state(false);
	let showEditEntryModal = $state(false);
	let editingEntry: PatientHistoryEntry | null = $state(null);
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
	const formatAmountInput = (value: string) => {
		const digits = moneyDigits(value);
		const formatted = formatMoneyInteger(digits);
		return { digits, formatted };
	};

	const mergeSavedClinicalEntry = (value: unknown): boolean => {
		let savedEntry;
		try {
			savedEntry = readSavedPatientEntry(value, data.patient.id);
		} catch {
			return false;
		}

		const merged = [savedEntry, ...entries.filter((entry) => entry.id !== savedEntry.id)].sort(
			comparePatientHistoryEntries
		);
		const exceededFirstPage = merged.length > 30;
		entries = merged.slice(0, 30);
		hasMoreEntries = hasMoreEntries || exceededFirstPage;
		return true;
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
					if (!mergeSavedClinicalEntry(savedEntry)) {
						markPatientRevisionUnverified();
						showEntryModal = false;
						await update();
						return;
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

	const openEditEntry = (entry: PatientHistoryEntry) => {
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
			{#if permissions.canReadClinicalHistory}
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
			{/if}
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

	<PatientHistoryPanel
		active={tab === 'historial' && permissions.canReadClinicalHistory}
		patientId={data.patient.id}
		scope={`${data.currentUserId ?? 'session'}:${data.role ?? ''}:${permissions.canReadClinicalHistory}:${permissions.canEditClinicalEntry}:${permissions.canViewCosts}`}
		historyRevision={data.entries}
		bind:entries
		bind:hasMoreEntries
		businessTimeZone={data.businessTimeZone}
		canEditClinicalEntry={permissions.canEditClinicalEntry}
		currentUserId={data.currentUserId}
		isProfessional={isProfessional}
		onEdit={openEditEntry}
	/>
	<PatientProfilePanel
        active={tab === 'datos'} patient={data.patient} {permissions}
        scope={`${data.currentUserId ?? 'session'}:${data.role ?? ''}:${permissions.canReadClinicalProfile}:${permissions.canEditPatient}`}
        initialChangeEvents={data.changeEvents} deferred={Boolean(data.changeEventsDeferred)}
        demo={Boolean(data.demo)} businessTimeZone={data.businessTimeZone} onEdit={openEditPatient}
    />
	{#if tab === 'radiografias'}
		<RadiographsPanel
			patientId={data.patient.id}
			cacheScope={radiographCacheScope}
			initialItems={data.demo ? data.radiographs : []}
			canView={permissions.canViewRadiographs}
			canUpload={permissions.canUploadRadiographs && data.documentUploads === 'available'}
			uploadAvailability={data.documentUploads}
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
