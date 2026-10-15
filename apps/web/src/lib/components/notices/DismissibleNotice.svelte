<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { dismissNotice, isNoticeDismissed } from '$lib/utils/notice-dismissal';

	type NoticeTone = 'neutral' | 'info' | 'success' | 'warning';

	let {
		storageKey,
		eyebrow = '',
		title,
		message = '',
		tone = 'neutral',
		children
	} = $props<{
		storageKey: string;
		eyebrow?: string;
		title: string;
		message?: string;
		tone?: NoticeTone;
		children?: Snippet;
	}>();

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
			return 'border-amber-300/35 bg-amber-400/10 shadow-amber-950/10';
		}
		if (tone === 'success') {
			return 'border-emerald-300/25 bg-emerald-400/10 shadow-emerald-950/10';
		}
		if (tone === 'info') {
			return 'border-violet-300/25 bg-violet-400/10 shadow-violet-950/10';
		}
		return 'border-white/10 bg-[#102842]/95 shadow-black/15';
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
			class="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
			onclick={dismiss}
			aria-label={`Quitar aviso: ${title}`}
			title="Quitar aviso"
		>
			<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<path d="M6 6l12 12M18 6 6 18" />
			</svg>
		</button>

		{#if eyebrow}
			<p class="text-[11px] font-black uppercase tracking-wide text-white/55">{eyebrow}</p>
		{/if}
		<h2 class:mt-1={Boolean(eyebrow)} class="text-base font-black text-white sm:text-lg">{title}</h2>
		{#if message}
			<p class="mt-1 text-sm font-semibold leading-6 text-white/65">{message}</p>
		{/if}
		{@render children?.()}
	</section>
{/if}
