<script lang="ts">
	import DismissibleNotice from '$lib/components/notices/DismissibleNotice.svelte';
	import FollowUpActions from './FollowUpActions.svelte';

	type Item = {
		id: string;
		patient_id: string;
		patient_name: string;
		message: string | null;
		remind_on: string;
		updated_at: string;
	};
	type Notice = { count: number; single: Item | null; dismissalKey: string };

	let { notice, todayISO, storageKeyPrefix } = $props<{
		notice: Notice;
		todayISO: string;
		storageKeyPrefix: string;
	}>();

	const singleLine = $derived(
		notice.single
			? `${notice.single.patient_name}: ${notice.single.message?.trim() || 'control pendiente'}`
			: ''
	);
</script>

{#if notice.count > 0}
	{#if notice.count === 1 && notice.single}
		<DismissibleNotice
			storageKey={`${storageKeyPrefix}:follow-ups:${notice.dismissalKey}`}
			eyebrow="Seguimiento"
			title="Tenés un recordatorio importante"
			message={singleLine}
			tone="warning"
		>
			<div class="mt-3">
				<FollowUpActions item={notice.single} {todayISO} />
			</div>
		</DismissibleNotice>
	{:else}
		<DismissibleNotice
			storageKey={`${storageKeyPrefix}:follow-ups:${notice.dismissalKey}`}
			eyebrow="Seguimientos"
			title={`Tenés ${notice.count} recordatorios importantes`}
			tone="warning"
		>
			<div class="mt-3 flex justify-start sm:justify-end">
				<a href="/odonto/seguimientos/importantes" class="ux-btn-primary shrink-0 text-center">VER</a>
			</div>
		</DismissibleNotice>
	{/if}
{/if}
