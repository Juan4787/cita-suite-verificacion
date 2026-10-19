<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { createClientReadiness } from '$lib/client/readiness.svelte';
	const client = createClientReadiness();
	import { parseProfessionalDependencyCounts } from '$lib/team/professional-editor';
	import type { ProfessionalEditorData } from '$lib/team/professional-editor';
	let {
		data,
		canManage,
		professionalDependencyKey
	}: { data: ProfessionalEditorData; canManage: boolean; professionalDependencyKey: string } =
		$props();
	const professional = $derived(data.professional);
	let archiveSubmitting = $state(false),
		restoreSubmitting = $state(false),
		deleteSubmitting = $state(false);
	let destroyed = false,
		generation = 0,
		controller: AbortController | null = null;
	onDestroy(() => {
		destroyed = true;
		generation++;
		controller?.abort();
	});
	// svelte-ignore state_referenced_locally
	let appointmentCount = $state<number | null>(data.appointmentCount ?? null);
	// svelte-ignore state_referenced_locally
	let clinicalEntryCount = $state<number | null>(data.clinicalEntryCount ?? null);
	// svelte-ignore state_referenced_locally
	let followUpCount = $state<number | null>(data.followUpCount ?? null);
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
	const loadDependencyCounts = async () => {
		if (dependencyCountsLoaded || dependencyCountsLoading || !professional?.id) return;
		dependencyCountsLoading = true;
		const requestGeneration = ++generation;
		controller?.abort();
		controller = new AbortController();
		dependencyCountsError = '';
		try {
			const response = await fetch(`/odonto/profesionales/${professional.id}/dependencias`, {
				signal: controller.signal
			});
			const payload: unknown = await response.json();
			if (destroyed || generation !== requestGeneration) return;
			const counts = parseProfessionalDependencyCounts(payload);
			if (!response.ok || !counts)
				throw new Error('No pudimos comprobar el historial. Volvé a intentar.');
			appointmentCount = counts.appointment_count;
			clinicalEntryCount = counts.clinical_entry_count;
			followUpCount = counts.follow_up_count;
			dependencyCountsLoaded = true;
		} catch (error) {
			if (destroyed || generation !== requestGeneration) return;
			dependencyCountsError = 'No pudimos comprobar el historial. Volvé a intentar.';
		} finally {
			if (!destroyed && generation === requestGeneration) dependencyCountsLoading = false;
		}
	};

	const openDeleteConfirm = () => {
		showDeleteConfirm = true;
		void loadDependencyCounts();
	};
</script>
		{#if canManage}
			<div class="ux-card flex flex-col gap-4 border-red-400/15 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0 flex-1">
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
					<button type="button" class="ux-btn-danger" disabled={!client.ready} onclick={openDeleteConfirm}>Eliminar</button>
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
