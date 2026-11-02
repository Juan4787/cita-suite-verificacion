<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description = '',
		actions,
		icon
	}: {
		title: string;
		description?: string;
		actions?: Snippet;
		icon?: Snippet;
	} = $props();
</script>

<div class="ux-empty">
	{#if icon}
		<div class="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
			{@render icon()}
		</div>
	{/if}
	<p class="text-base font-bold text-fg">{title}</p>
	{#if description}
		<p class="max-w-sm text-sm text-fg-55">{description}</p>
	{/if}
	{#if actions}
		<div class="mt-3 flex flex-wrap items-center justify-center gap-2">{@render actions()}</div>
	{/if}
</div>
