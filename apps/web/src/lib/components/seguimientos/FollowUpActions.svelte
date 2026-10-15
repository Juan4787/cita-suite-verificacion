<script lang="ts">
	import { invalidate } from '$app/navigation';
	import Modal from '$lib/components/Modal.svelte';
	import FollowUpDatePicker from './FollowUpDatePicker.svelte';

	type Item = {
		id: string;
		patient_id: string;
		patient_name: string;
		message: string | null;
		remind_on: string;
		updated_at: string;
	};

	let { item, todayISO } = $props<{ item: Item; todayISO: string }>();

	let busy = $state(false);
	let snoozeOpen = $state(false);
	let showDateModal = $state(false);
	let customDate = $state('');
	let actionError = $state('');

	const tomorrow = (iso: string) => {
		const d = new Date(`${iso}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + 1);
		return d.toISOString().slice(0, 10);
	};

	const snooze = async (payload: { preset: string } | { date: string }) => {
		busy = true;
		actionError = '';
		try {
			const res = await fetch(`/odonto/seguimientos/${item.id}/posponer`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...payload, expected_updated_at: item.updated_at })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				actionError = data?.message ?? 'No se pudo posponer.';
				return;
			}
			snoozeOpen = false;
			showDateModal = false;
			customDate = '';
			await invalidate('app:follow-ups');
		} catch {
			actionError = 'Error de conexión.';
		} finally {
			busy = false;
		}
	};

	const markDone = async () => {
		busy = true;
		actionError = '';
		try {
			const res = await fetch(`/odonto/seguimientos/${item.id}/gestionar`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ expected_updated_at: item.updated_at })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				actionError = data?.message ?? 'No se pudo gestionar.';
				return;
			}
			await invalidate('app:follow-ups');
		} catch {
			actionError = 'Error de conexión.';
		} finally {
			busy = false;
		}
	};
</script>

<div class="space-y-2">
	<div class="flex flex-wrap gap-2">
		<a href={`/odonto/pacientes/${item.patient_id}`} class="ux-btn-secondary text-sm">Ver paciente</a>
		<button type="button" onclick={() => (snoozeOpen = !snoozeOpen)} disabled={busy} class="ux-btn-secondary text-sm disabled:opacity-50">
			Recordar más tarde
		</button>
		<button type="button" onclick={markDone} disabled={busy} class="ux-btn-primary text-sm disabled:opacity-50">
			Ya lo gestioné
		</button>
	</div>

	{#if snoozeOpen}
		<div class="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
			<span class="text-xs font-bold uppercase tracking-wide text-white/40">Recordar:</span>
			<button type="button" onclick={() => snooze({ preset: 'manana' })} disabled={busy} class="rounded-full bg-white/5 px-3 py-1 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50">Mañana</button>
			<button type="button" onclick={() => snooze({ preset: 'tres_dias' })} disabled={busy} class="rounded-full bg-white/5 px-3 py-1 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50">En 3 días</button>
			<button type="button" onclick={() => snooze({ preset: 'semana' })} disabled={busy} class="rounded-full bg-white/5 px-3 py-1 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50">La semana que viene</button>
			<button type="button" onclick={() => { customDate = ''; showDateModal = true; }} disabled={busy} class="rounded-full bg-white/5 px-3 py-1 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50">Elegir fecha</button>
		</div>
	{/if}

	{#if actionError}<p class="ux-alert">{actionError}</p>{/if}
</div>

<Modal open={showDateModal} title="Recordar más tarde" closable on:close={() => (showDateModal = false)}>
	<div class="space-y-5 text-white">
		<FollowUpDatePicker bind:value={customDate} todayISO={tomorrow(todayISO)} />
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<button type="button" onclick={() => (showDateModal = false)} class="ux-btn-secondary">Cancelar</button>
			<button type="button" onclick={() => snooze({ date: customDate })} disabled={busy || !customDate} class="ux-btn-primary disabled:opacity-50">
				Posponer
			</button>
		</div>
	</div>
</Modal>
