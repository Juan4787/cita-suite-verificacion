<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { dismissNotice, isNoticeDismissed } from '$lib/utils/notice-dismissal';

	type NoticeTone = 'neutral' | 'info' | 'success' | 'warning';

	let {
		storageKey,
		title,
		message = '',
		tone = 'neutral',
		children
	}: {
		storageKey: string;
		title: string;
		message?: string;
		tone?: NoticeTone;
		children?: Snippet;
	} = $props();

	let dismissed = $state(false);
	let mounted = $state(false);

	const syncDismissedState = (key: string) => {
		try {
			dismissed = isNoticeDismissed(window.localStorage, key);
		} catch {
			dismissed = false;
		}
	};

	const dismiss = () => {
		dismissed = true;
		try {
			dismissNotice(window.localStorage, storageKey);
		} catch {
			// El cierre sigue funcionando durante esta sesión aunque el navegador bloquee storage.
		}
	};

	onMount(() => {
		mounted = true;
		syncDismissedState(storageKey);
		const handleStorage = (event: StorageEvent) => {
			if (event.key === storageKey) dismissed = event.newValue === '1';
		};
		window.addEventListener('storage', handleStorage);
		return () => window.removeEventListener('storage', handleStorage);
	});

	$effect(() => {
		const key = storageKey;
		if (mounted) syncDismissedState(key);
	});

	const toneClass = $derived.by(() => {
		if (tone === 'warning') {
			return 'border-warning-300-35 bg-warning-400-10 shadow-shade-warning-950-10';
		}
		if (tone === 'success') {
			return 'border-success-300-25 bg-success-400-10 shadow-shade-success-950-10';
		}
		if (tone === 'info') {
			return 'border-accent-300-25 bg-accent-400-10 shadow-shade-accent-950-10';
		}
		return 'border-line bg-fill-102842-95 shadow-shade-black-10';
	});
</script>

{#if !dismissed}
	<section
		class={`relative w-full rounded-2xl border p-4 pr-14 shadow-lg ${toneClass}`}
		data-global-notice={storageKey}
		aria-label={title}
	>
		<button
			type="button"
			class="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-fg-65 transition hover:bg-fill-10 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-accent-300"
			onclick={dismiss}
			aria-label={`Quitar aviso: ${title}`}
			title="Quitar aviso"
		>
			<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<path d="M6 6l12 12M18 6 6 18" />
			</svg>
		</button>

		<h2 class="text-base font-bold text-fg sm:text-lg">{title}</h2>
		{#if message}
			<p class="mt-1 text-sm font-semibold leading-6 text-fg-65">{message}</p>
		{/if}
		{@render children?.()}
	</section>
{/if}
