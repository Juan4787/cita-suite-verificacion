<script lang="ts">
	import { createClientReadiness } from '$lib/client/readiness.svelte';
	const client = createClientReadiness();
	import { onDestroy, untrack } from 'svelte';
	import type {
		PatientDetailViewData,
		PatientChangeEvent,
		PatientPermissions
	} from '$lib/patients/contracts';
	import { readPatientChangeEvents } from '$lib/patients/history-contract';
	import { formatDate, formatDateTime } from '$lib/utils/format';
	let {
		active,
		patient,
		permissions,
		scope,
		initialChangeEvents,
		deferred,
		demo,
		businessTimeZone,
		onEdit
	}: {
		active: boolean;
		patient: PatientDetailViewData['patient'];
		permissions: PatientPermissions;
		scope: string;
		initialChangeEvents?: PatientChangeEvent[];
		deferred: boolean;
		demo: boolean;
		businessTimeZone?: string;
		onEdit: () => void;
	} = $props();
	let changeEvents = $state<PatientChangeEvent[]>(untrack(() => initialChangeEvents ?? []));
	let changeEventsLoaded = $state(untrack(() => !deferred || demo));
	let loadingChangeEvents = $state(false);
	let changeEventsLoadError = $state('');
	let request: AbortController | null = null;
	let generation = 0;
	let destroyed = false;
	let previousSeedKey: string | null = null;
	let previousSeedEvents: PatientChangeEvent[] | undefined;
	$effect(() => {
		const seedKey = `${patient.id}:${patient.updated_at ?? ''}:${patient.clinical_profile_updated_at ?? ''}:${scope}:${deferred}:${demo}`;
		const seedEvents = initialChangeEvents;
		// Prop reevaluation on tab navigation is not a new server projection.
		if (seedKey === previousSeedKey && seedEvents === previousSeedEvents) return;
		previousSeedKey = seedKey;
		previousSeedEvents = seedEvents;
		generation += 1;
		request?.abort();
		request = null;
		changeEvents = seedEvents ?? [];
		changeEventsLoaded = !deferred || demo;
		loadingChangeEvents = false;
		changeEventsLoadError = '';
	});
	onDestroy(() => {
		destroyed = true;
		generation += 1;
		request?.abort();
	});
	const loadChangeEvents = async () => {
		if (demo || changeEventsLoaded || loadingChangeEvents) return;
		const patientId = patient.id,
			patientRevision = patient.updated_at,
			profileRevision = patient.clinical_profile_updated_at,
			requestedScope = scope,
			sequence = generation;
		const controller = new AbortController();
		request = controller;
		const isCurrent = () =>
			!destroyed &&
			sequence === generation &&
			patientId === patient.id &&
			patientRevision === patient.updated_at &&
			profileRevision === patient.clinical_profile_updated_at &&
			requestedScope === scope &&
			!controller.signal.aborted;
		loadingChangeEvents = true;
		changeEventsLoadError = '';
		try {
			const response = await fetch(`/odonto/pacientes/${patientId}/datos`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Patient changes unavailable');
			const incoming = readPatientChangeEvents(await response.json());
			if (!isCurrent()) return;
			changeEvents = incoming;
			changeEventsLoaded = true;
		} catch {
			if (isCurrent())
				changeEventsLoadError = 'No pudimos cargar los últimos cambios. Volvé a intentar.';
		} finally {
			if (isCurrent()) {
				loadingChangeEvents = false;
				request = null;
			}
		}
	};
	$effect(() => {
		if (active && !changeEventsLoaded && !loadingChangeEvents && !changeEventsLoadError)
			void loadChangeEvents();
	});
	let copyMessage = $state('');
	const copyToClipboard = async (text?: string | null) => {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			copyMessage = 'Dato copiado.';
		} catch {
			copyMessage = 'No pudimos copiar el dato. Seleccionalo y copialo manualmente.';
		}
	};

	const hasPatientData = $derived(
		Boolean(
			patient.dni ||
			patient.phone ||
			patient.email ||
			patient.address ||
			patient.birth_date ||
			patient.insurance ||
			patient.insurance_plan ||
			patient.allergies ||
			patient.medication ||
			patient.background
		)
	);
</script>

{#snippet copyIcon()}
	<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path stroke-linecap="round" stroke-linejoin="round" d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
{/snippet}

{#if active}
		<div class="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm dark:border-[#1f3554] dark:bg-[#122641] sm:p-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="text-lg font-semibold text-neutral-900 dark:text-white">Datos del paciente</h2>
				{#if permissions.canEditPatient}
					<button disabled={!client.ready}
						type="button"
						class="w-full rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-white sm:w-auto"
						onclick={onEdit}
					>
						{hasPatientData ? 'Editar datos del paciente' : 'Agregar datos del paciente'}
					</button>
				{/if}
			</div>
			<div class="mt-4 space-y-4">
				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-caption font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Identidad</p>
						{#if permissions.canEditPatient}
							<button disabled={!client.ready}
								type="button"
								class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
								onclick={onEdit}
							>
								Editar
							</button>
						{/if}
					</div>
					<div class="space-y-1">
						<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Nombre</p>
						<p class="break-words text-body font-semibold text-neutral-900 dark:text-white">
							{patient.full_name}
						</p>
					</div>
				</div>
				{#if permissions.canReadClinicalProfile}
				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-caption font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Alertas médicas</p>
							{#if permissions.canEditClinicalProfile}
								<button disabled={!client.ready}
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
									onclick={onEdit}
								>
									Editar
								</button>
							{/if}
					</div>
					{#if patient.clinical_profile_patient_reported}<p class="mb-3 text-xs text-neutral-600 dark:text-neutral-300">Última actualización informada por el paciente desde su reserva. Revisá el historial de información previa para consultar los cambios.</p>{/if}
                    {#if permissions.canReadClinicalProfile && patient.booking_age}<p class="mb-3 text-sm">Edad declarada: {patient.booking_age.years} años (al {patient.booking_age.as_of}).</p>{/if}
                    {#if permissions.canReadClinicalProfile && patient.booking_extra_fields?.length}<dl class="mb-4 space-y-2">{#each patient.booking_extra_fields as field}<div><dt class="text-xs text-neutral-600 dark:text-neutral-300">{field.label}</dt><dd class="text-sm whitespace-pre-wrap break-words">{typeof field.value === 'boolean' ? field.value ? 'Sí' : 'No' : String(field.value)}</dd></div>{/each}</dl>{/if}
                    <div class="space-y-3">
                        <div class="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-lg bg-amber-100/30 px-3 py-2 dark:bg-amber-500/10">
							<div class="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-200">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M4.93 19h14.14a1 1 0 0 0 .9-1.45L12.9 4.55a1 1 0 0 0-1.8 0L4.03 17.55A1 1 0 0 0 4.93 19Z" />
								</svg>
								Alergias
							</div>
							<p
								class={`min-w-0 flex-[1_1_10rem] break-words text-left text-supporting font-semibold sm:text-right ${
									patient.allergies ? 'text-amber-900 dark:text-amber-100' : 'text-amber-700/70 dark:text-amber-200/70'
								}`}
							>
								{patient.allergies ?? 'Sin registrar'}
							</p>
						</div>
						<div class="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
							<div class="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75 17.25 17.25M9 5.25 5.25 9 9 12.75 12.75 9 9 5.25Z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 11.25 11.25 15 15 18.75 18.75 15 15 11.25Z" />
								</svg>
								Medicación
							</div>
							<p
								class={`min-w-0 flex-[1_1_10rem] break-words text-left text-supporting font-semibold ${
									patient.medication ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'
								}`}
							>
								{patient.medication ?? 'Sin registrar'}
							</p>
						</div>
						<div class="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
							<div class="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v12.75l-4.5-2.25L9.75 18.75 5.25 21V6A1.5 1.5 0 0 1 6.75 4.5Z" />
								</svg>
								Antecedentes
							</div>
							<p
								class={`min-w-0 flex-[1_1_10rem] break-words text-left text-supporting font-semibold whitespace-pre-wrap ${
									patient.background ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'
								}`}
							>
								{patient.background ?? 'Sin registrar'}
							</p>
						</div>
					</div>
				</div>

				{/if}

				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-caption font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Contacto</p>
							{#if permissions.canEditPatient}
								<button disabled={!client.ready}
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
									onclick={onEdit}
								>
									Editar
								</button>
							{/if}
					</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Teléfono</p>
							<div class="flex items-center gap-2">
								<p class={`min-w-0 flex-1 break-words text-supporting font-semibold ${patient.phone ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{patient.phone ?? 'Sin registrar'}
								</p>
								{#if patient.phone}
									<button disabled={!client.ready}
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(patient.phone)}
										aria-label="Copiar teléfono" title="Copiar teléfono"
									>
										{@render copyIcon()}
									</button>
								{/if}
							</div>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Correo electrónico</p>
							<div class="flex items-center gap-2">
								<p class={`min-w-0 flex-1 break-all text-supporting font-semibold ${patient.email ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{patient.email ?? 'Sin registrar'}
								</p>
								{#if patient.email}
									<button disabled={!client.ready}
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(patient.email)}
										aria-label="Copiar correo electrónico" title="Copiar correo electrónico"
									>
										{@render copyIcon()}
									</button>
								{/if}
							</div>
						</div>
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Dirección</p>
							<div class="flex items-center gap-2">
								<p class={`min-w-0 flex-1 break-words text-supporting font-semibold ${patient.address ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
									{patient.address ?? 'Sin registrar'}
								</p>
								{#if patient.address}
									<button disabled={!client.ready}
										type="button"
										class="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 text-xs text-neutral-600 dark:border-[#1f3554] dark:text-neutral-200"
										onclick={() => copyToClipboard(patient.address)}
										aria-label="Copiar dirección" title="Copiar dirección"
									>
										{@render copyIcon()}
									</button>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<div class="mb-3 flex items-center justify-between">
						<p class="text-caption font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Administrativo</p>
							{#if permissions.canEditPatient}
								<button disabled={!client.ready}
									type="button"
									class="rounded-full border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-[#1f3554] dark:text-neutral-50 dark:hover:bg-[#122641]"
									onclick={onEdit}
								>
									Editar
								</button>
							{/if}
					</div>
					<div class="grid gap-3 md:grid-cols-2">
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Obra social</p>
							<p class={`text-supporting font-semibold ${patient.insurance ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{patient.insurance ?? 'Sin registrar'}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Plan de la obra social</p>
							<p class={`text-supporting font-semibold ${patient.insurance_plan ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{patient.insurance_plan ?? 'Sin registrar'}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs font-semibold text-neutral-500 dark:text-neutral-300">Nacimiento</p>
							<p class={`text-supporting font-semibold ${patient.birth_date ? 'text-neutral-800 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'}`}>
								{patient.birth_date ? formatDate(patient.birth_date, businessTimeZone) : 'Sin registrar'}
							</p>
						</div>
					</div>
				</div>
			</div>
			{#if copyMessage}<p class="mt-3 text-sm text-neutral-600 dark:text-neutral-200" role="status">{copyMessage}</p>{/if}
			{#if loadingChangeEvents}
				<div class="mt-5 rounded-xl border border-neutral-100 bg-white/60 p-4 text-sm font-semibold text-neutral-500 dark:border-[#1f3554] dark:bg-[#0f1f36] dark:text-neutral-300" aria-live="polite">
					Cargando últimos cambios…
				</div>
			{:else if changeEventsLoadError}
				<div class="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-100">
					<p>{changeEventsLoadError}</p>
					<button disabled={!client.ready} type="button" class="mt-3 font-semibold underline" onclick={loadChangeEvents}>Reintentar</button>
				</div>
			{:else if changeEvents.length > 0}
				<div class="mt-5 rounded-xl border border-neutral-100 bg-white/60 p-4 dark:border-[#1f3554] dark:bg-[#0f1f36]">
					<p class="text-caption font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Últimos cambios</p>
					<div class="mt-3 space-y-3">
						{#each changeEvents.slice(0, 5) as event}
							<div class="rounded-lg border border-neutral-100 bg-white/70 px-3 py-2 dark:border-[#1f3554] dark:bg-[#122641]">
								<p class="text-sm font-semibold text-neutral-900 dark:text-white">{event.summary}</p>
								<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
									{formatDateTime(event.created_at, businessTimeZone)} · {event.changed_by_name}
								</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<details class="mt-4 text-micro text-[#65738d] dark:text-[#7b8aa5]">
				<summary class="cursor-pointer text-neutral-600 dark:text-neutral-200">Ver detalles</summary>
				<p class="mt-1">
					Creado: {formatDate(patient.created_at, businessTimeZone)} • Última actualización: {formatDateTime(patient.updated_at, businessTimeZone)}
				</p>
			</details>
		</div>
{/if}
