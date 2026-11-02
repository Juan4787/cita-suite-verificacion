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
					<h1 class="break-words text-3xl font-semibold text-fg">
						{data.patient.full_name}
					</h1>
				</div>
				<button disabled={!client.ready}
					type="button"
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition border-line-strong text-fg-n100 hover:bg-raised md:hidden"
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
				class="flex flex-auto items-center justify-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-card border-line-strong text-copy hover:bg-raised sm:px-4 sm:text-sm md:flex-none"
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
						? 'bg-accent-strong text-on-accent shadow-sm'
						: 'text-fg-n200 hover:bg-surface'
				}`}
				onclick={() => selectTab('historial')}
			>
				Historial
			</button>
			{/if}
			<button disabled={!client.ready}
				class={`flex-auto whitespace-nowrap rounded-full px-3 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:flex-none ${
					tab === 'datos'
						? 'bg-accent-strong text-on-accent shadow-sm'
						: 'text-fg-n200 hover:bg-surface'
				}`}
				onclick={() => selectTab('datos')}
			>
				Datos
			</button>
			<button disabled={!client.ready}
				class={`flex-auto whitespace-nowrap rounded-full px-3 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm md:flex-none ${
					tab === 'radiografias'
						? 'bg-accent-strong text-on-accent shadow-sm'
						: 'text-fg-n200 hover:bg-surface'
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
							neutral: ' bg-fill-10 text-fg-n100',
							alert: ' bg-warning-500-15 text-warning-100',
							warn: ' bg-accent-indigo-500-15 text-accent-indigo-100'
						}[chip.intent]
					}`}
				>
					<span class="shrink-0 text-micro uppercase tracking-wide">{chip.label}:</span>
					<span class="min-w-0 break-words">{chip.value}</span>
				</div>
			{/each}
		</div>
		<div class="mt-5 rounded-xl border p-4 border-line-strong bg-surface">
			<div class="flex items-center justify-between gap-3">
				<h2 class="text-sm font-semibold text-fg">Próximos turnos</h2>
				<a href={`/odonto/agenda`} class="text-xs font-semibold text-accent hover:underline">Abrir agenda</a>
			</div>
			<div class="mt-3 grid gap-2">
				{#each data.appointments as appointment}
					<a href={`/odonto/turnos/${appointment.id}`} class="rounded-xl border px-3 py-2 text-sm transition border-line-strong bg-raised hover:bg-raised">
						<span class="block font-semibold text-fg">{formatDateTime(appointment.starts_at)} ·&nbsp;{appointment.service_name_snapshot}</span>
						<span class="text-xs text-fg-n300">{appointment.professional_name_snapshot} ·&nbsp;{appointmentStatusLabels[appointment.status] ?? 'Estado pendiente'}</span>
					</a>
				{/each}
				{#if data.appointments.length === 0}
					<p class="text-sm text-fg-n200">No hay próximos turnos.</p>
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
		<section class="mt-6 rounded-2xl border p-5 shadow-sm border-line-strong bg-surface sm:flex sm:items-center sm:justify-between sm:gap-5" aria-labelledby="patient-export-title">
			<div class="min-w-0">
				<h2 id="patient-export-title" class="text-lg font-bold text-fg">Exportar datos de este paciente</h2>
				<p class="mt-1 text-sm leading-6 text-fg-n300">
					Prepará un Excel con su ficha, historial, turnos y seguimientos. No incluye radiografías ni adjuntos.
				</p>
			</div>
			<a
				href={`/odonto/exportar-datos?patient_id=${encodeURIComponent(String(data.patient.id))}`}
				class="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-accent-600 border-accent-400-35 bg-accent-400-10 text-accent-100 hover:bg-accent-400-15 sm:mt-0 sm:w-auto"
			>
				Abrir exportación
			</a>
		</section>
	{/if}
</div>
<!-- FAB móvil para nueva entrada -->
{#if tab === 'historial' && permissions.canCreateClinicalEntry}
	<button disabled={!client.ready}
		class="fixed bottom-20 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-accent-strong text-2xl font-bold text-on-accent shadow-lg transition hover:-translate-y-0.5 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-accent-600 md:hidden"
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
				class="w-full rounded-xl border px-4 py-3 text-sm font-semibold transition border-line-strong text-fg-n100 hover:bg-raised"
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
				class="w-full rounded-xl bg-accent-strong px-4 py-3 text-sm font-semibold text-on-accent shadow-sm transition hover:bg-accent-press"
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
				class="block w-full rounded-xl border border-accent-600-40 px-4 py-3 text-center text-sm font-semibold transition hover:bg-accent-600-10 text-accent"
				onclick={() => (showMobileActions = false)}
			>
				Nuevo turno
			</a>
		{/if}
		{#if data.followUpParticipates}
			<button disabled={!client.ready}
				type="button"
				class="block w-full rounded-xl border border-accent-600-40 px-4 py-3 text-center text-sm font-semibold transition hover:bg-accent-600-10 text-accent"
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
				class="w-full rounded-xl border px-4 py-3 text-sm font-semibold transition border-danger-400-40 text-danger hover:bg-danger-500-10"
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
			class="w-full rounded-xl px-4 py-3 text-sm font-semibold transition text-fg-n300 hover:bg-raised"
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
	<div class="space-y-4 text-sm text-fg-n100">
		{#if isArchived}
			<p>{isProfessional ? 'El paciente volverá a tu lista de activos.' : 'El paciente volverá a la lista de activos.'}</p>
		{:else}
			<p>{isProfessional ? 'El paciente se ocultará de tu lista activa. Podrás recuperarlo desde Archivados.' : 'El paciente se moverá a “Archivados”. Podrás recuperarlo más adelante.'}</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button disabled={!client.ready}
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-fg hover:bg-fill-1b2d4b sm:w-auto"
				onclick={() => (showArchiveConfirm = false)}
			>
				Cancelar
			</button>
				<button disabled={!client.ready}
					type="button"
					class="w-full rounded-xl bg-info-primary-600 px-4 py-2 text-sm font-semibold text-on-accent shadow-sm transition hover:bg-info-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-info-primary-500 sm:w-auto"
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
	<div class="space-y-4 text-sm text-fg-n100">
		{#if isProfessional}
			<p class="rounded-xl border px-4 py-3 text-sm font-semibold border-warning-400-60 bg-warning-500-15 text-warning-100">
				Para eliminar un paciente, consultá al dueño del consultorio.
			</p>
		{:else}
			<p class="rounded-xl border px-4 py-3 text-sm font-semibold border-warning-400-60 bg-warning-500-15 text-warning-100">
				La app no elimina pacientes desde esta pantalla. Para ocultarlo de la lista, archivá el paciente.
			</p>
		{/if}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
			<button disabled={!client.ready}
				type="button"
				class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-fg hover:bg-fill-1b2d4b sm:w-auto"
				onclick={() => {
					showDeleteConfirm = false;
				}}
			>
				Entendido
			</button>
			{#if !isProfessional && permissions.canArchivePatient && !isArchived}
				<button disabled={!client.ready}
					type="button"
					class="w-full rounded-xl bg-info-primary-600 px-4 py-2 text-sm font-semibold text-on-accent shadow-sm transition hover:bg-info-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-info-primary-500 sm:w-auto"
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
