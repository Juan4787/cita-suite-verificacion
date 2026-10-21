<script lang="ts">
	import { createClientReadiness } from '$lib/client/readiness.svelte';
	const client = createClientReadiness();
	import type {
		PatientDetailViewData,
		PatientFormState,
		PatientHistoryEntry
	} from '$lib/patients/contracts';
	import {
		comparePatientHistoryEntries,
		readSavedPatientEntry
	} from '$lib/patients/history-contract';
	import { page } from '$app/stores';
	import { invalidate, replaceState } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import FollowUpComposer from '$lib/components/seguimientos/FollowUpComposer.svelte';
	import RadiographsPanel from '$lib/components/patients/RadiographsPanel.svelte';
	import PatientHistoryPanel from '$lib/components/patients/PatientHistoryPanel.svelte';
	import PatientProfilePanel from '$lib/components/patients/PatientProfilePanel.svelte';
	import ClinicalEntryDialog from '$lib/components/patients/ClinicalEntryDialog.svelte';
	import PatientProfileDialog from '$lib/components/patients/PatientProfileDialog.svelte';
	import { markPatientRevisionUnverified } from '$lib/client/patient-list-cache';
	import {
		activatePatientRadiographCache,
		schedulePatientRadiographPreload
	} from '$lib/client/patient-radiographs-cache';
	import { formatDate, formatDateTime } from '$lib/utils/format';

	let { data, form }: { data: PatientDetailViewData; form?: PatientFormState | null } = $props();

	let showEntryModal = $state(false);
	let showEditModal = $state(false);
	let showArchiveConfirm = $state(false);
	let showDeleteConfirm = $state($page.url.searchParams.has('eliminar'));
	let showMobileActions = $state(false);
	let showFollowUpModal = $state(false);
	let tab = $state<'historial' | 'datos' | 'radiografias'>(
		untrack(() => (data.permissions.canReadClinicalHistory ? 'historial' : 'datos'))
	);
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
	const permissions = $derived(data.permissions);
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

	let showEditEntryModal = $state(false);
	let editingEntry: PatientHistoryEntry | null = $state(null);
	let archiveForm: HTMLFormElement | null = $state(null);
	let unarchiveForm: HTMLFormElement | null = $state(null);

	const openEditPatient = () => {
		showEditModal = true;
	};
	const isArchived = $derived(
		Boolean(isProfessional ? data.patient.professional_archived_at : data.patient.archived_at)
	);
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

	const acceptCreatedEntry = (value: unknown) => {
		markPatientRevisionUnverified();
		return mergeSavedClinicalEntry(value);
	};
	const openEditEntry = (entry: PatientHistoryEntry) => {
		editingEntry = entry;
		showEditEntryModal = true;
	};
	const openNewEntryModal = () => {
		showEntryModal = true;
	};
	const handleFollowUpCreated = async () => {
		showFollowUpModal = false;
		await invalidate('app:follow-ups');
	};
</script>

<div class="flex flex-col gap-5">
	<div class="ux-card">
		<!-- The name keeps a 24rem basis: actions sit beside it only when both fit, otherwise they wrap below. -->
		<div class="flex min-w-0 flex-wrap items-start justify-between gap-4">
			<div class="flex min-w-0 flex-[1_1_24rem] items-start justify-between gap-3">
				<div class="min-w-0 space-y-1">
					<h1 class="break-words text-3xl font-semibold text-neutral-900 dark:text-white">
						{data.patient.full_name}
					</h1>
				</div>
				<button disabled={!client.ready}
					type="button"
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-100 dark:hover:bg-[#122641] md:hidden"
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
			<div class="hidden min-w-0 md:flex md:flex-wrap md:items-center md:gap-2 [&_.ux-btn-secondary]:shrink-0 [&_.ux-btn-primary]:shrink-0 [&_.ux-btn-danger]:shrink-0">
				{#if permissions.canArchivePatient}
					<form method="post" action="?/archive_patient" class="contents" bind:this={archiveForm}>
						<button disabled={!client.ready}
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
					<button disabled={!client.ready}
						type="button"
						class="ux-btn-danger md:col-span-2 md:justify-self-start lg:col-span-1"
						onclick={() => (showDeleteConfirm = true)}
					>
						Eliminar paciente
					</button>
				{/if}
				{#if permissions.canCreateClinicalEntry}
					<button disabled={!client.ready}
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
					<button disabled={!client.ready}
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
		<!-- Each section keeps its label on one line and grows to fill its row; no half-empty cells. -->
		<div class="mt-4 flex flex-wrap gap-2 text-xs sm:text-sm md:items-center md:gap-3">
			<a
				href="/odonto/pacientes"
				class="flex flex-auto items-center justify-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:-translate-y-0.5 hover:bg-neutral-100 hover:shadow-card dark:border-[#1f3554] dark:text-[#eaf1ff] dark:hover:bg-[#122641] sm:px-4 sm:text-sm md:flex-none"
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
			<button disabled={!client.ready}
				class={`flex-auto whitespace-nowrap rounded-full px-3 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:flex-none ${
					tab === 'historial'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => selectTab('historial')}
			>
				Historial
			</button>
			{/if}
			<button disabled={!client.ready}
				class={`flex-auto whitespace-nowrap rounded-full px-3 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:flex-none ${
					tab === 'datos'
						? 'bg-[#7c3aed] text-white shadow-sm'
						: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-[#0f1f36]'
				}`}
				onclick={() => selectTab('datos')}
			>
				Datos
			</button>
			<button disabled={!client.ready}
				class={`flex-auto whitespace-nowrap rounded-full px-3 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:flex-none ${
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
					<span class="shrink-0 text-micro uppercase tracking-wide">{chip.label}:</span>
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
				<h2 id="patient-export-title" class="text-lg font-bold text-neutral-950 dark:text-white">Exportar datos de este paciente</h2>
				<p class="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
					Prepará un Excel con su ficha, historial, turnos y seguimientos. No incluye radiografías ni adjuntos.
				</p>
			</div>
			<a
				href={`/odonto/exportar-datos?patient_id=${encodeURIComponent(String(data.patient.id))}`}
				class="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-800 transition hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] dark:border-violet-400/35 dark:bg-violet-400/10 dark:text-violet-100 dark:hover:bg-violet-400/15 sm:mt-0 sm:w-auto"
			>
				Abrir exportación
			</a>
		</section>
	{/if}
</div>
<!-- FAB móvil para nueva entrada -->
{#if tab === 'historial' && permissions.canCreateClinicalEntry}
	<button disabled={!client.ready}
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
			<button disabled={!client.ready}
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
			<button disabled={!client.ready}
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
			<button disabled={!client.ready}
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
			<button disabled={!client.ready}
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
		<button disabled={!client.ready}
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

<ClinicalEntryDialog bind:open={showEntryModal} patient={data.patient}
    scope={`${data.currentUserId ?? 'session'}:${data.role ?? ''}:${permissions.canCreateClinicalEntry}:${permissions.canViewCosts}`}
    canViewCosts={permissions.canViewCosts} {isProfessional} timeZone={data.businessTimeZone}
    industry={data.businessIndustry} errorMessage={form?.message}
    onCreated={acceptCreatedEntry} onCommitted={markPatientRevisionUnverified} />
<ClinicalEntryDialog bind:open={showEditEntryModal} patient={data.patient} entry={editingEntry}
    scope={`${data.currentUserId ?? 'session'}:${data.role ?? ''}:${permissions.canEditClinicalEntry}:${permissions.canViewCosts}`}
    canViewCosts={permissions.canViewCosts} {isProfessional} timeZone={data.businessTimeZone}
    industry={data.businessIndustry} errorMessage={form?.message}
    onCreated={acceptCreatedEntry} onCommitted={markPatientRevisionUnverified} />

<Modal open={showArchiveConfirm} title={isArchived ? 'Desarchivar paciente' : 'Archivar paciente'} on:close={() => (showArchiveConfirm = false)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		{#if isArchived}
			<p>{isProfessional ? 'El paciente volverá a tu lista de activos.' : 'El paciente volverá a la lista de activos.'}</p>
		{:else}
			<p>{isProfessional ? 'El paciente se ocultará de tu lista activa. Podrás recuperarlo desde Archivados.' : 'El paciente se moverá a “Archivados”. Podrás recuperarlo más adelante.'}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button disabled={!client.ready}
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => (showArchiveConfirm = false)}
			>
				Cancelar
			</button>
				<button disabled={!client.ready}
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
			<button disabled={!client.ready}
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-white dark:hover:bg-[#1b2d4b] sm:w-auto"
				onclick={() => {
					showDeleteConfirm = false;
				}}
			>
				Entendido
			</button>
			{#if !isProfessional && permissions.canArchivePatient && !isArchived}
				<button disabled={!client.ready}
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



<PatientProfileDialog bind:open={showEditModal} patient={data.patient} {permissions} {form}
    scope={`${data.currentUserId ?? 'session'}:${data.role ?? ''}:${permissions.canEditPatient}:${permissions.canEditClinicalProfile}:${permissions.canReadClinicalProfile}`}
    onCommitted={markPatientRevisionUnverified} />
