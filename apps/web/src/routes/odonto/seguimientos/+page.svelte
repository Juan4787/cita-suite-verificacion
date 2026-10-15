<script lang="ts">
	import { invalidate } from '$app/navigation';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import FollowUpComposer from '$lib/components/seguimientos/FollowUpComposer.svelte';

	type Item = {
		id: string;
		patient_id: string;
		patient_name: string;
		message: string | null;
		remind_on: string;
		assigned_professional_id: string | null;
		updated_at: string;
	};

	let { data } = $props<{
		data: { programmed: Item[]; canAssign: boolean; todayISO: string; demo: boolean };
	}>();

	let showComposer = $state(false);
	let editingItem = $state<Item | null>(null);

	const dateLabel = (iso: string) =>
		new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(`${iso}T12:00:00`)
		);

	const handleCreated = async () => {
		showComposer = false;
		await invalidate('app:follow-ups');
	};

	const handleEdited = async () => {
		editingItem = null;
		await invalidate('app:follow-ups');
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<h1 class="ux-title">Seguimientos</h1>
		<p class="ux-subtitle">
			Recordá volver a contactar a tus pacientes. Cuando llega la fecha, te avisamos arriba.
		</p>
	</div>

	<div class="flex justify-end">
		<button type="button" onclick={() => (showComposer = true)} disabled={data.demo} class="ux-btn-primary disabled:opacity-50">
			Agregar seguimiento
		</button>
	</div>

	<div class="ux-card">
		<h2 class="ux-section-title">Recordatorios programados para más adelante</h2>
		<div class="mt-5 grid gap-3">
			{#each data.programmed as f (f.id)}
				<div class="ux-choice flex items-start justify-between gap-3 p-4">
					<div class="min-w-0">
						<p class="font-bold text-white">
							{f.patient_name}{f.message?.trim() ? `: ${f.message.trim()}` : ''}
						</p>
						<p class="mt-1 text-sm text-white/55">Fecha: {dateLabel(f.remind_on)}</p>
					</div>
					<button type="button" onclick={() => (editingItem = f)} class="ux-btn-secondary shrink-0 text-sm">
						Editar
					</button>
				</div>
			{/each}
			{#if data.programmed.length === 0}
				<EmptyState
					title="Sin recordatorios programados"
					description="No hay recordatorios programados para más adelante."
				/>
			{/if}
		</div>
	</div>
</section>

<Modal open={showComposer} title="Agregar seguimiento" closable on:close={() => (showComposer = false)}>
	<FollowUpComposer
		patient={null}
		canAssign={data.canAssign}
		todayISO={data.todayISO}
		onCancel={() => (showComposer = false)}
		onCreated={handleCreated}
	/>
</Modal>

<Modal open={Boolean(editingItem)} title="Editar seguimiento" closable on:close={() => (editingItem = null)}>
	{#if editingItem}
		<FollowUpComposer
			mode="edit"
			existing={{
				id: editingItem.id,
				patient: { id: editingItem.patient_id, full_name: editingItem.patient_name },
				remindOn: editingItem.remind_on,
				message: editingItem.message,
				assignedProfessionalId: editingItem.assigned_professional_id,
				expectedUpdatedAt: editingItem.updated_at
			}}
			canAssign={data.canAssign}
			todayISO={data.todayISO}
			onCancel={() => (editingItem = null)}
			onCreated={handleEdited}
		/>
	{/if}
</Modal>
