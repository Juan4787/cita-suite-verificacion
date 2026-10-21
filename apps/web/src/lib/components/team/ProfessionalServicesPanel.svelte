<script lang="ts">
	import { formatDuration } from '$lib/utils/format';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Modal from '$lib/components/Modal.svelte';
	import { isRecord } from '$lib/contracts/json';
	import { formatPriceLabel } from '$lib/utils/money-input';
	import type {
		ProfessionalEditorService as Service,
		ProfessionalEditorSaving
	} from '$lib/team/professional-editor';
	let {
		active,
		services,
		professional,
		currentPriceLabels,
		defaultServiceIds,
		canManage,
		selectedIds = $bindable(),
		baselineIds = $bindable(),
		saving = $bindable(),
		dependencyKey,
		scope,
		onToggleService,
		availabilityRevision
	}: {
		active: boolean;
		services: Service[];
		professional: { id: string; name: string } | null;
		currentPriceLabels?: Record<string, string>;
		defaultServiceIds: string[];
		canManage: boolean;
		selectedIds: string[];
		baselineIds: string[];
		saving: ProfessionalEditorSaving;
		dependencyKey: string;
		scope: string;
		onToggleService: (serviceId: string) => void;
		availabilityRevision: number;
	} = $props();
	let showNewService = $state(false),
		editingService = $state<Service | null>(null),
		serviceEditError = $state('');
	let uncertainCreation = $state(false),
		destroyed = false;
	let previousScope = untrack(() => scope);
	const defaultServiceIdSet = $derived(new Set(defaultServiceIds));
	const serviceDelta = $derived.by(() => {
		const current = new Set(selectedIds.filter((id) => !defaultServiceIdSet.has(id)));
		const saved = new Set(baselineIds.filter((id) => !defaultServiceIdSet.has(id)));
		const added = [...current].filter((id) => !saved.has(id)),
			removed = [...saved].filter((id) => !current.has(id));
		return { added, removed, count: added.length + removed.length };
	});
	const dirty = $derived(serviceDelta.count > 0);
	const serviceChangeSummary = $derived(
		serviceDelta.count === 1 ? '1 cambio sin guardar' : `${serviceDelta.count} cambios sin guardar`
	);
	const serviceRowStateClass = (id: string) =>
		serviceDelta.added.includes(id)
			? 'ux-choice-pending'
			: serviceDelta.removed.includes(id)
				? 'ux-choice-removed'
				: '';
	$effect(() => {
		if (services.length === 0) showNewService = true;
	});
	$effect(() => {
		if (previousScope === scope) return;
		previousScope = scope;
		showNewService = false;
		editingService = null;
		serviceEditError = '';
		uncertainCreation = false;
		if (saving === 'services' || saving === 'service-create' || saving === 'service-update')
			saving = null;
	});
	onDestroy(() => {
		destroyed = true;
	});
	function isCurrent(requestedScope: string) {
		return !destroyed && requestedScope === scope;
	}
	function messageFromResult(result: unknown, fallback: string) {
		return isRecord(result) && isRecord(result.data) && typeof result.data.message === 'string'
			? result.data.message
			: fallback;
	}
	const editingDefaultService = $derived(
		Boolean(editingService && defaultServiceIdSet.has(editingService.id))
	);
	function openServiceEditor(id: string) {
		if (saving) return;
		const service = services.find((item) => item.id === id);
		if (!service) return;
		editingService = { ...service };
		serviceEditError = '';
	}
	function closeServiceEditor() {
		if (saving === 'service-update') return;
		editingService = null;
		serviceEditError = '';
	}
	function handlePriceInput(event: Event) {
		const input = event.currentTarget;
		if (input instanceof HTMLInputElement) input.value = formatPriceLabel(input.value);
	}
	const saveAssignment: SubmitFunction = ({ cancel }) => {
		if (saving) {
			cancel();
			return;
		}
		const requestedScope = scope,
			submittedIds = [...selectedIds];
		saving = 'services';
		return async ({ result, update }) => {
			if (!isCurrent(requestedScope)) return;
			try {
				if (result.type === 'success') {
					baselineIds = submittedIds;
					await update({ reset: false, invalidateAll: false });
					await invalidate(dependencyKey);
				} else await update({ reset: false });
			} finally {
				if (isCurrent(requestedScope)) saving = null;
			}
		};
	};
	const createServiceEnhance: SubmitFunction = ({ cancel }) => {
		if (saving || uncertainCreation) {
			cancel();
			return;
		}
		const requestedScope = scope;
		saving = 'service-create';
		return async ({ result, update }) => {
			if (!isCurrent(requestedScope)) return;
			try {
				if (result.type === 'success') {
					const id =
						isRecord(result.data) && typeof result.data.serviceId === 'string'
							? result.data.serviceId
							: '';
					if (!id) { uncertainCreation = true; return; }
					if (id) {
						if (!selectedIds.includes(id)) selectedIds = [...selectedIds, id];
						if (!baselineIds.includes(id)) baselineIds = [...baselineIds, id];
					}
					showNewService = false;
					await update({ reset: true, invalidateAll: false });
					await invalidate(dependencyKey);
					return;
				}
				if (result.type === 'error' || (result.type === 'failure' && result.status >= 500)) {
					uncertainCreation = true;
					return;
				}
				await update({ reset: false });
			} finally {
				if (isCurrent(requestedScope)) saving = null;
			}
		};
	};
	const updateServiceEnhance: SubmitFunction = ({ cancel }) => {
		if (saving) {
			cancel();
			return;
		}
		const requestedScope = scope;
		saving = 'service-update';
		serviceEditError = '';
		return async ({ result, update }) => {
			if (!isCurrent(requestedScope)) return;
			try {
				if (result.type === 'success') {
					editingService = null;
					await update({ reset: true, invalidateAll: false });
					await invalidate(dependencyKey);
					return;
				}
				serviceEditError = messageFromResult(
					result,
					'No pudimos guardar el servicio. Revisá los datos e intentá nuevamente.'
				);
				if (result.type !== 'error') await update({ reset: false, invalidateAll: false });
			} finally {
				if (isCurrent(requestedScope)) saving = null;
			}
		};
	};
</script>

	{#if active}
        <a class="ux-btn-secondary mb-5 inline-flex" href={`/odonto/profesionales/${professional?.id}/aranceles`}>Configurar aranceles y ajustes mensuales</a>
		<div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
			<form method="POST" action="?/save_services" class={`ux-card ${dirty ? 'ux-state-unsaved' : ''}`} use:enhance={saveAssignment}>
				<input type="hidden" name="availability_revision" value={availabilityRevision} />
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div class="min-w-0 flex-1">
						<h2 class="ux-section-title">Servicios que ofrece</h2>
						<p class="mt-1 text-sm text-white/55">Estos servicios estarán disponibles para reservar con este profesional.</p>
						{#if dirty}
							<p class="ux-section-meta ux-section-meta-warning">{serviceChangeSummary}</p>
						{/if}
					</div>
					<button type="submit" disabled={!canManage || saving !== null || !dirty} class="ux-btn-secondary shrink-0">
						{saving === 'services' ? 'Guardando...' : 'Guardar sólo servicios'}
					</button>
				</div>

				<div class="mt-5 grid gap-3">
					{#each services as service}
						{@const isDefault = defaultServiceIdSet.has(service.id)}
						<!-- The name keeps a 12rem basis: on a narrow row the edit action wraps below instead of squeezing it. -->
						<div class={`ux-choice flex flex-wrap items-center gap-3 p-4 ${isDefault || selectedIds.includes(service.id) ? 'ux-choice-active' : ''} ${serviceRowStateClass(service.id)}`}>
							<label class="flex min-w-0 flex-[1_1_12rem] cursor-pointer items-center gap-4">
								<input
									type="checkbox"
									name="service_id"
									value={service.id}
									checked={isDefault || selectedIds.includes(service.id)}
									disabled={!canManage || isDefault}
									class="accent-[#7c3aed]"
									onchange={() => !isDefault && onToggleService(service.id)}
								/>
								<span class="min-w-0 flex-1">
									<span class="block font-bold text-white">{service.name}</span>
									<span class="mt-1 block text-sm text-white/55">
										{formatDuration(service.duration_minutes)}{currentPriceLabels?.[service.id] ? ` ·\u00a0${currentPriceLabels[service.id]} este mes` : service.price_label ? ` ·\u00a0${service.price_label}` : ''}
									</span>
								</span>
							</label>
							<button
								type="button"
								disabled={!canManage}
								class="ux-btn-secondary ml-auto shrink-0 px-3 py-2 text-sm"
								onclick={() => openServiceEditor(service.id)}
							>
								Editar
							</button>
						</div>
					{/each}
					{#if services.length === 0}
						<p class="ux-empty">Todavía no hay servicios cargados.</p>
					{/if}
				</div>
			</form>

			<div class="ux-soft-card p-5">
				<div class="flex flex-col items-start gap-4">
					<div class="min-w-0">
						<h2 class="ux-section-title">¿No encontrás el servicio?</h2>
						<p class="mt-1 text-sm text-white/55">Crealo una vez y queda asignado a {professional?.name ?? 'este profesional'}.</p>
					</div>
					<button type="button" class="ux-btn-secondary" disabled={!canManage || saving === 'service-create'} onclick={() => (showNewService = !showNewService)}>
						{showNewService ? 'Cerrar' : 'Crear servicio nuevo'}
					</button>
				</div>
				{#if uncertainCreation}<p class="ux-alert mt-4" role="alert">No pudimos confirmar si se creó el servicio. Revisá la lista antes de intentar de nuevo.</p><a class="ux-btn-secondary mt-3 inline-flex" href={`/odonto/profesionales/${professional?.id}?tab=servicios`} data-sveltekit-reload>Revisar servicios</a>{/if}
				{#if showNewService}
					<form method="POST" action="?/create_service" class="mt-5 grid gap-4" use:enhance={createServiceEnhance}>
						<label>
							<span class="ux-label">Nombre</span>
							<input name="name" required disabled={!canManage} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Duración en minutos</span>
							<input name="duration_minutes" type="number" min="5" max="480" step="1" value="30" disabled={!canManage} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Arancel a mostrar (opcional)</span>
							<input name="price_label" type="text" inputmode="numeric" disabled={!canManage} placeholder="$ 35.000" class="ux-input" oninput={handlePriceInput} />
							<p class="mt-2 text-sm text-white/70">Se usa cuando no configuraste ajustes mensuales.</p>
						</label>
						<button class="ux-btn-primary" disabled={!canManage || saving !== null || uncertainCreation}>
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
							<input name="duration_minutes" type="number" min="5" max="480" step="1" required value={editingService.duration_minutes} disabled={!canManage} class="ux-input" />
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
							<input name="buffer_before_minutes" type="number" min="0" max="480" step="1" required value={editingService.buffer_before_minutes} disabled={!canManage} class="ux-input" />
						</label>
						<label>
							<span class="ux-label">Margen después (minutos)</span>
							<input name="buffer_after_minutes" type="number" min="0" max="480" step="1" required value={editingService.buffer_after_minutes} disabled={!canManage} class="ux-input" />
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
