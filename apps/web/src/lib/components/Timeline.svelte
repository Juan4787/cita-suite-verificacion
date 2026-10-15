<script lang="ts">
	type Item = {
		id: string;
		title: string;
		description?: string;
		meta?: string;
		badge?: string;
	};

	let { items = [] as Item[] } = $props();
</script>

<ul class="space-y-4">
	{#each items as item (item.id)}
		<li class="rounded-xl border border-neutral-100 bg-white px-4 py-3 shadow-sm">
			<div class="flex items-start justify-between gap-3">
				<div class="space-y-1">
					<p class="text-sm font-semibold text-neutral-900">{item.title}</p>
					{#if item.description}
						<p class="text-sm text-neutral-600 whitespace-pre-line">{item.description}</p>
					{/if}
					{#if item.meta}
						<p class="text-xs uppercase tracking-wide text-neutral-500">{item.meta}</p>
					{/if}
				</div>
				{#if item.badge}
					<span class="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">{item.badge}</span>
				{/if}
			</div>
		</li>
	{/each}
</ul>
