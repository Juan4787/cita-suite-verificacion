<script lang="ts">
	import ProfessionalSchedulePanel from '$lib/components/team/ProfessionalSchedulePanel.svelte';
	import ProfessionalProfileForm from '$lib/components/team/ProfessionalProfileForm.svelte';
	import ProfessionalLifecyclePanel from '$lib/components/team/ProfessionalLifecyclePanel.svelte';
	import ProfessionalServicesPanel from '$lib/components/team/ProfessionalServicesPanel.svelte';
	import { beforeNavigate, goto, invalidate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import BackLink from '$lib/components/BackLink.svelte';
	import { clearTtlDraft, loadTtlDraft, saveTtlDraft } from '$lib/client/ttl-draft';
	import {
		canonicalScheduleBlocks,
		scheduleBlocksFromRules,
		serializeScheduleBlocks,
		validateScheduleBlocks
	} from '$lib/utils/schedule-blocks';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { onMount, onDestroy } from 'svelte';
	import { isRecord } from '$lib/contracts/json';
	import {
		hasProfessionalExceptionDraft as hasExceptionDraft,
		cloneProfessionalDraft as cloneDraft,
		acceptProfessionalDraftSave,
		professionalBaselineMatches,
		emptyProfessionalException as emptyExceptionDraft,
		sanitizeProfessionalDraft as sanitizeDraft,
		type ProfessionalDraft,
		type ProfessionalEditorService as Service,
		type ProfessionalEditorSaving,
		type ProfessionalEditorData as PageData,
		type ProfessionalEditorRule as Rule,
		type ProfessionalDirtyFields as DirtyFields
	} from '$lib/team/professional-editor';
	import Modal from '$lib/components/Modal.svelte';

	const tabs = [
		{ id: 'perfil', label: 'Perfil' },
		{ id: 'servicios', label: 'Servicios y aranceles' },
		{ id: 'horarios', label: 'Horarios' }
	] as const;

	type TabId = (typeof tabs)[number]['id'];

	let {
		data,
		form
	}: {
		data: PageData;
		form?: { success?: boolean; message?: string; exceptionConflict?: boolean } | null;
	} = $props();

	const normalizedText = (value: string) => value.trim();
	const uniqueSortedStrings = (items: string[]) =>
		[...new Set(items)].sort((a, b) => a.localeCompare(b));
	const sameStringList = (left: string[], right: string[]) =>
		uniqueSortedStrings(left).join('|') === uniqueSortedStrings(right).join('|');

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
		schedule: scheduleFromRules(source.rules),
		exception: emptyExceptionDraft()
	});

	const hasValidSchedule = (schedule: ProfessionalDraft['schedule']) => {
		return validateScheduleBlocks(schedule.blocks).ok;
	};

	// svelte-ignore state_referenced_locally
	let availabilityRevision = $state(data.availabilityRevision ?? 0);
	let draftReady = $state(false);
	const canOperate = $derived(data.context.canManage && !data.demo && draftReady);
	const canManage = $derived(data.context.canManage && !data.demo);
	const accountLinkPending = $derived(Boolean(data.pendingAccountEmail));
	const defaultServiceIdSet = $derived(new Set(data.defaultServiceIds ?? []));
	const professional = $derived(data.professional);
	const businessId = $derived(data.context.business?.id ?? 'sin-consultorio');
	const businessTimeZone = $derived(
		data.context.business?.timezone ?? 'America/Argentina/Buenos_Aires'
	);
	const userId = $derived(data.userId ?? 'sin-usuario');
	const professionalId = $derived(data.professional?.id ?? 'nuevo');
	const professionalDependencyKey = $derived(`app:professional:${professionalId}`);
	const draftStorageKey = $derived(
		`cita-suite:draft:professional-profile:${businessId}:${userId}:${professionalId}`
	);

	// svelte-ignore state_referenced_locally
	let baseline = $state<ProfessionalDraft>(buildServerDraft(data));
	// svelte-ignore state_referenced_locally
	let draft = $state<ProfessionalDraft>(cloneDraft(baseline));
	let draftRestored = $state(false);
	// svelte-ignore state_referenced_locally
	let activeTab = $state<TabId>(
		tabs.some((tab) => tab.id === data.tab) ? (data.tab as TabId) : 'perfil'
	);
	let saving = $state<ProfessionalEditorSaving>(null);
	let showExitGuard = $state(false);
	let pendingNavigationHref = $state<string | null>(null);
	let guardError = $state('');

	let acknowledgedAppointments = $state(false);
	$effect(() => {
		JSON.stringify(draft.exception);
		acknowledgedAppointments = false;
	});

	let saveAllForm = $state<HTMLFormElement | null>(null);
	let schedulePanel: ProfessionalSchedulePanel | undefined = $state();
	let scheduleTimeEditing = $state(false);
	let allowNavigation = false;

	$effect(() => {
		if (draft.exception.type === 'extra_available' && draft.exception.periodMode === 'range') {
			draft.exception.periodMode = 'single';
		}
	});

	const calculateDirtyFields = (
		current: ProfessionalDraft,
		saved: ProfessionalDraft
	): DirtyFields => {
		const editableCurrentServices = current.serviceIds.filter((id) => !defaultServiceIdSet.has(id));
		const editableSavedServices = saved.serviceIds.filter((id) => !defaultServiceIdSet.has(id));
		return {
			name: normalizedText(current.name) !== normalizedText(saved.name),
			specialty: normalizedText(current.specialty) !== normalizedText(saved.specialty),
			phone: normalizedText(current.phone) !== normalizedText(saved.phone),
			email:
				normalizedText(current.email).toLowerCase() !== normalizedText(saved.email).toLowerCase(),
			profilePublic: current.isAvailable !== saved.isAvailable,
			services: !sameStringList(editableCurrentServices, editableSavedServices),
			schedule:
				canonicalScheduleBlocks(current.schedule.blocks) !==
				canonicalScheduleBlocks(saved.schedule.blocks),
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
	const bookingStatusLabel = $derived.by(() =>
		isVisibleInBooking ? 'Visible en reservas' : 'No visible en reservas'
	);
	const bookingStatusClass = $derived.by(() =>
		isVisibleInBooking
			? 'ux-badge ux-badge-success'
			: hasMissingMinimum
				? 'ux-badge ux-badge-danger'
				: 'ux-badge'
	);
	const showSaveAllAction = $derived.by(() => hasUnsavedChanges);
	const shouldSaveProfile = $derived.by(() =>
		Boolean(
			dirtyFields.name ||
			dirtyFields.specialty ||
			dirtyFields.phone ||
			dirtyFields.email ||
			dirtyFields.profilePublic
		)
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
	const guardTitle = $derived.by(() => {
		if (hasUnsavedChanges && hasMissingMinimum) return 'Tenés cambios sin guardar y datos pendientes';
		if (hasUnsavedChanges) return 'Tenés cambios sin guardar';
		return 'Faltan datos para recibir turnos';
	});
	const scheduleBlocksJson = $derived(serializeScheduleBlocks(draft.schedule.blocks));

	const toggleService = (serviceId: string) => {
		if (draft.serviceIds.includes(serviceId)) {
			draft.schedule.blocks = draft.schedule.blocks.map((block) => ({
				...block,
				allowedServiceIds: (block.allowedServiceIds ?? []).filter((id) => id !== serviceId)
			}));
			if (draft.exception.appliesTo === 'professional')
				draft.exception.allowedServiceIds = draft.exception.allowedServiceIds.filter(
					(id) => id !== serviceId
				);
		}
		draft.serviceIds = draft.serviceIds.includes(serviceId)
			? draft.serviceIds.filter((id) => id !== serviceId)
			: [...draft.serviceIds, serviceId];
	};

	const fieldStateClass = (dirty: boolean, missing = false) =>
		missing ? 'ux-state-required' : dirty ? 'ux-state-unsaved' : '';
	const sectionStateClass = fieldStateClass;
	const resetExceptionDraft = () => {
		draft.exception = emptyExceptionDraft();
	};
	const markSaved = (
		section: 'profile' | 'services' | 'schedule' | 'exception' | 'all',
		submitted: ProfessionalDraft
	) => {
		const accepted = acceptProfessionalDraftSave(draft, baseline, submitted, section);
		baseline = accepted.baseline;
		draft = accepted.draft;
		if (!Object.values(calculateDirtyFields(draft, baseline)).some(Boolean)) {
			clearTtlDraft(draftStorageKey);
			draftRestored = false;
		}
	};
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});
	const editorScope = () => `${businessId}:${userId}:${professionalId}:${canManage}`;
	const messageFromResult = (result: unknown, fallback: string) =>
		isRecord(result) && isRecord(result.data) && typeof result.data.message === 'string'
			? result.data.message
			: fallback;

	const sectionEnhance =
		(section: 'profile' | 'services' | 'schedule' | 'exception'): SubmitFunction =>
		({ cancel }) => {
			if (saving) {
				cancel();
				return;
			}
			const submitted = cloneDraft(draft),
				requestedScope = editorScope();
			saving = section;
			return async ({ result, update }) => {
				if (destroyed || requestedScope !== editorScope()) return;
				try {
					if (result.type === 'success') {
						markSaved(section, submitted);
						await update({ reset: false, invalidateAll: false });
						await invalidate(professionalDependencyKey);
						return;
					}
					await update({ reset: false });
				} finally {
					if (!destroyed && requestedScope === editorScope()) saving = null;
				}
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

	const saveAllEnhance: SubmitFunction = ({ cancel }) => {
		if (saving) {
			cancel();
			return;
		}
		const submitted = cloneDraft(draft),
			requestedScope = editorScope();
		saving = 'all';
		guardError = '';
		return async ({ result, update }) => {
			if (destroyed || requestedScope !== editorScope()) return;
			saving = null;
			if (result.type === 'success') {
				markSaved('all', submitted);
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
		if (dirtyFields.schedule && !schedulePanel?.normalizeScheduleBeforeSubmit()) {
			activeTab = 'horarios';
			return;
		}
		if (dirtyFields.exception && !schedulePanel?.normalizeExceptionBeforeSubmit()) {
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
		if (!draftReady || scheduleTimeEditing) return;
		const serverDraft = buildServerDraft(data);
		if (!hasUnsavedChanges) {
			baseline = cloneDraft(serverDraft);
			draft = cloneDraft(serverDraft);
			availabilityRevision = data.availabilityRevision ?? 0;
		} else if (professionalBaselineMatches(serverDraft, baseline)) {
			// Safe rebase after an own partial save or an unrelated clinic edit.
			availabilityRevision = data.availabilityRevision ?? 0;
		}
	});

	onMount(() => {
		const savedDraft = loadTtlDraft<unknown>(draftStorageKey);
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

<section class="ux-page" data-editor-ready={draftReady} data-loaded-availability-revision={data.availabilityRevision} aria-busy={!draftReady}>
		<div class="ux-hero">
			<BackLink href="/odonto/configuracion/usuarios" label="Volver" class="mb-5" />
			<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div class="min-w-0 flex-1">
					<h1 class="ux-title">{visibleName}</h1>
					<p class="ux-subtitle">{visibleSubtitle}</p>
					{#if hasMissingMinimum}
						<p class="mt-3 text-sm font-bold text-red-100">Falta completar: {missingSummary}</p>
					{/if}
					{#if hasUnsavedChanges}
						<p class="mt-2 text-sm font-bold text-amber-100">Cambios sin guardar</p>
					{/if}
				</div>
				<div class="flex shrink-0 flex-wrap items-center gap-2">
					<span class={bookingStatusClass}>{bookingStatusLabel}</span>
					{#if hasUnsavedChanges}
						<button type="button" disabled={!canOperate || saving !== null} class="ux-btn-primary" onclick={requestSaveAll}>
							{saving === 'all' ? 'Guardando...' : 'Guardar todo'}
						</button>
					{/if}
				</div>
			</div>
		</div>

		{#if accountLinkPending}
			<div class="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-5 py-4" role="status">
				<p class="font-bold text-amber-100">Cuenta profesional pendiente</p>
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
			<input type="hidden" name="schedule_blocks" value={scheduleBlocksJson} /><input type="hidden" name="availability_revision" value={availabilityRevision}/><input type="hidden" name="exception_request_id" value={draft.exception.requestId}/>
			<input type="hidden" name="applies_to" value={draft.exception.appliesTo} />
			<input type="hidden" name="type" value={draft.exception.type} />
			<input type="hidden" name="period_mode" value={draft.exception.periodMode} /><input type="hidden" name="dates" value={JSON.stringify(draft.exception.dates??[])}/>
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
					disabled={!draftReady} onclick={() => (activeTab = tab.id)}
					>
						<span class="inline-flex items-center justify-center gap-2">
							{tab.label}
							{#if tabStates[tab.id].missing}
								<span class="ux-tab-marker ux-tab-marker-danger" role="img" aria-label="Dato necesario faltante">
									<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
										<path d="M12 5v9" />
										<path d="M12 19h.01" />
									</svg>
								</span>
							{:else if tabStates[tab.id].dirty}
								<span class="ux-tab-marker ux-tab-marker-warning" role="img" aria-label="Cambios sin guardar">
									<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5" /></svg>
								</span>
							{/if}
						</span>
					</button>
				{/each}
				<a class="ux-profile-tab text-center" href={`/odonto/profesionales/${professional?.id}/preguntas`}>Preguntas al paciente</a>
			</div>
		</div>

	{#if activeTab === 'perfil'}
		<ProfessionalProfileForm bind:draft {dirtyFields} {canOperate} {accountLinkPending} {shouldSaveProfile} {missingItems} {saving} onSave={sectionEnhance('profile')} />

		<ProfessionalLifecyclePanel {data} {canManage} {professionalDependencyKey} />
	{/if}

	<ProfessionalServicesPanel active={activeTab === 'servicios'} services={data.services} professional={data.professional}
		currentPriceLabels={data.currentPriceLabels} defaultServiceIds={data.defaultServiceIds} canManage={canManage && draftReady}
		bind:selectedIds={draft.serviceIds} bind:baselineIds={baseline.serviceIds} bind:saving
		dependencyKey={professionalDependencyKey} scope={`${businessId}:${userId}:${professionalId}:${canManage}`} onToggleService={toggleService} availabilityRevision={availabilityRevision} />

	<ProfessionalSchedulePanel {availabilityRevision} active={activeTab === 'horarios'} {data} bind:draft {baseline} {dirtyFields} {missingItems} {canOperate} {saving}
 bind:acknowledgedAppointments bind:scheduleTimeEditing {sectionEnhance} {refreshEnhance} form={form ?? undefined} bind:this={schedulePanel} />

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
						<button type="button" disabled={!canOperate || saving !== null} class="ux-btn-primary" onclick={requestSaveAll}>
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
