<script lang="ts">
	// One drawn icon set: a 24-unit grid and a 2px round stroke in the current text color.
	// The icon is decorative; the text beside it, or the control's label, names it.
	type IconName = 'alert' | 'bell' | 'calendar' | 'check' | 'circle' | 'receipt' | 'refresh';

	let { name, class: className = 'h-5 w-5 shrink-0' }: { name: IconName; class?: string } = $props();
</script>

<svg
	aria-hidden="true"
	viewBox="0 0 24 24"
	class={className}
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#if name === 'alert'}
		<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
		<path d="M12 9v4" />
		<path d="M12 17h.01" />
	{:else if name === 'bell'}
		<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
		<path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
	{:else if name === 'calendar'}
		<rect x="3" y="4" width="18" height="18" rx="2" />
		<path d="M16 2v4M8 2v4M3 10h18" />
	{:else if name === 'check'}
		<path d="M20 6 9 17l-5-5" />
	{:else if name === 'circle'}
		<circle cx="12" cy="12" r="8" />
	{:else if name === 'receipt'}
		<path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z" />
		<path d="M9 7h6M9 11h6M9 15h4" />
	{:else if name === 'refresh'}
		<path d="M21 12a9 9 0 0 0-15.5-6.4L3 8" />
		<path d="M3 3v5h5" />
		<path d="M3 12a9 9 0 0 0 15.5 6.4L21 16" />
		<path d="M16 16h5v5" />
	{/if}
</svg>
