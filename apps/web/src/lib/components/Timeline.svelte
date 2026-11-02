<script lang="ts">
	type Item = {
		id: string;
		title: string;
		description?: string;
		meta?: string;
		badge?: string;
	};

	let { items = [] as Item[] }: { items?: Item[] } = $props();
</script>

<ul class="space-y-4">
	{#each items as item (item.id)}
		<li class="rounded-xl border border-line-n100 bg-chip-white px-4 py-3 shadow-sm">
			<div class="flex items-start justify-between gap-3">
				<div class="space-y-1">
					<p class="text-sm font-semibold text-ink-n900">{item.title}</p>
					{#if item.description}
						<p class="text-sm text-ink-n600 whitespace-pre-line">{item.description}</p>
					{/if}
					{#if item.meta}
						<p class="text-xs uppercase tracking-wide text-copy-subtle">{item.meta}</p>
					{/if}
				</div>
				{#if item.badge}
					<span class="rounded-full bg-chip-primary-50 px-3 py-1 text-xs font-semibold text-ink-primary-700">{item.badge}</span>
				{/if}
			</div>
		</li>
	{/each}
</ul>
