<script lang="ts">
import { onMount } from 'svelte';

let theme = $state<'light' | 'dark'>('dark');

const applyTheme = (value: 'light' | 'dark') => {
	theme = value;
	if (typeof document !== 'undefined') {
		if (document.documentElement.classList.contains('dark') !== (value === 'dark')) {
			document.documentElement.classList.toggle('dark', value === 'dark');
		}
		localStorage.setItem('theme', value);
	}
};

onMount(() => {
	const stored = localStorage.getItem('theme');
	const fromDom = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	const next = stored === 'dark' || stored === 'light' ? stored : fromDom || (prefersDark ? 'dark' : 'light');
	applyTheme(next === 'dark' ? 'dark' : 'light');
});

	const toggle = () => applyTheme(theme === 'dark' ? 'light' : 'dark');
</script>

<button
	type="button"
	onclick={toggle}
	class="flex items-center gap-2 text-sm font-semibold text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-white"
	aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
>
	<span aria-hidden="true" class="flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-[#13243d]">
		{#if theme === 'dark'}
			<!-- Sol estilizado -->
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
				<circle cx="12" cy="12" r="4.5" />
				<path stroke-linecap="round" d="M12 2.5v2.5m0 14v2.5m9.5-9.5H19m-14 0H2.5m15.01 6.01 1.77 1.77M4.72 4.72 6.49 6.5m0 10.99-1.77 1.77m12.99-12.99 1.77-1.77" />
			</svg>
		{:else}
			<!-- Luna estilizada -->
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
				<path stroke-linecap="round" stroke-linejoin="round" d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
			</svg>
		{/if}
	</span>
	<span>{theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}</span>
</button>
