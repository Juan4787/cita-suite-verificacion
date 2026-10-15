<script lang="ts">
	let {
		href,
		label,
		class: className = ''
	} = $props<{
		href: string;
		label: string;
		class?: string;
	}>();
</script>

<a
	{href}
	class={`group inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-white/85 px-3 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/40 hover:bg-[#f5f3ff] hover:text-[#5b21b6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed] dark:border-[#1f3554] dark:bg-[#0f1f36]/80 dark:text-neutral-100 dark:hover:border-[#7c3aed]/50 dark:hover:bg-[#182842] dark:hover:text-white ${className}`}
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
