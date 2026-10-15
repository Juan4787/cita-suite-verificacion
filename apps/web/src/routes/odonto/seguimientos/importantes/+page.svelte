<script lang="ts">
	import { invalidate } from '$app/navigation';
	import BackLink from '$lib/components/BackLink.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import FollowUpActions from '$lib/components/seguimientos/FollowUpActions.svelte';
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
		data: { executing: Item[]; canAssign: boolean; todayISO: string; demo: boolean };
	}>();

	let editingItem = $state<Item | null>(null);

	const handleEdited = async () => {
		editingItem = null;
		await invalidate('app:follow-ups');
	};
</script>

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/seguimientos" label="Volver a Seguimientos" class="mb-5" />
		<h1 class="ux-title">Recordatorios importantes</h1>
		<p class="ux-subtitle">Seguimientos cuya fecha ya llegó. Gestionalos uno por uno.</p>
	</div>

	<div class="grid gap-3">
		{#each data.executing as f (f.id)}
			<div class="ux-card">
				<div class="flex items-start justify-between gap-3">
					<p class="min-w-0 font-bold text-white">
						{f.patient_name}: {f.message?.trim() || 'control pendiente'}
					</p>
					<button type="button" onclick={() => (editingItem = f)} class="ux-btn-secondary shrink-0 text-sm">
						Editar
					</button>
				</div>
				<div class="mt-3">
					<FollowUpActions item={f} todayISO={data.todayISO} />
				</div>
			</div>
		{/each}
		{#if data.executing.length === 0}
			<EmptyState title="Todo al día" description="No hay recordatorios importantes pendientes." />
		{/if}
	</div>
</section>

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
