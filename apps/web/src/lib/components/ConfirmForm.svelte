<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';

	// An important action that asks first (plan 12.17, point 8): the form has no submit button,
	// so only the dialog sends it, with `confirmed=1`, which the server requires.
	let {
		action,
		fields = {},
		label,
		buttonClass = 'ux-btn-secondary',
		formClass = '',
		title,
		body,
		confirmLabel,
		cancelLabel = 'Cancelar',
		tone = 'normal'
	}: {
		action: string;
		fields?: Record<string, string>;
		label: string;
		buttonClass?: string;
		formClass?: string;
		title: string;
		/** Written when the dialog opens, so a time it mentions is current. */
		body: () => string;
		confirmLabel: string;
		cancelLabel?: string;
		tone?: 'normal' | 'danger';
	} = $props();

	let form = $state<HTMLFormElement>();
	let open = $state(false);
	let text = $state('');
	let mounted = $state(false);
	let sending = $state(false);

	onMount(() => {
		mounted = true;
		// Going back to this page from the browser cache shows it as it was left: sending again.
		const restore = (event: PageTransitionEvent) => {
			if (event.persisted) sending = false;
		};
		window.addEventListener('pageshow', restore);
		return () => window.removeEventListener('pageshow', restore);
	});

	// The dialog lives on the page body, outside any card that could clip or move it.
	const portal = (node: HTMLElement) => {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	};

	const ask = () => {
		text = body();
		open = true;
	};

	const confirm = () => {
		if (!form || sending) return;
		sending = true;
		open = false;
		form.requestSubmit();
	};
</script>

<form method="post" {action} class={formClass} bind:this={form}>
	{#each Object.entries(fields) as [name, value] (name)}
		<input type="hidden" {name} {value} />
	{/each}
	<input type="hidden" name="confirmed" value="1" />
	<button type="button" class={buttonClass} disabled={!mounted || sending} onclick={ask}>{label}</button>
</form>

<div use:portal>
	<Modal {open} {title} on:close={() => (open = false)} dismissible>
		<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
			<p class="leading-6">{text}</p>
			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				<button class="ux-btn-secondary" type="button" onclick={() => (open = false)}>{cancelLabel}</button>
				<button class={tone === 'danger' ? 'ux-btn-danger' : 'ux-btn-primary'} type="button" onclick={confirm}>
					{confirmLabel}
				</button>
			</div>
		</div>
	</Modal>
</div>
