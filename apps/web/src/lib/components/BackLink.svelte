<script lang="ts">
	let {
		href,
		label,
		class: className = ''
	}: {
		href: string;
		label: string;
		class?: string;
	} = $props();
</script>

<a
	{href}
	class={`group inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-accent-600 border-line-strong bg-fill-13243d-70 text-fg-n100 hover:border-accent-600-50 hover:bg-fill-182842 hover:text-fg ${className}`}
>
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:-translate-x-0.5"
	>
		<path d="M19 12H5" />
		<path d="m12 19-7-7 7-7" />
	</svg>
	<span>{label}</span>
</a>
