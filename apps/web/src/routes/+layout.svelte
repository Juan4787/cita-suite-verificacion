<script lang="ts">
	import type { LayoutProps } from './$types';

	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { installFieldValidation } from '$lib/ui/field-validation';

	let { children }: LayoutProps = $props();
	const hasOwnDocumentTitle = $derived(
		['/reservar/', '/embed/', '/turno/', '/gestion/', '/correo/baja/'].some((prefix) =>
			page.url.pathname.startsWith(prefix)
		)
	);
	onMount(() => installFieldValidation());
</script>

<svelte:head>
	{#if !hasOwnDocumentTitle}
		<title>Cita Suite</title>
	{/if}
	<link rel="icon" type="image/png" href="/logo-cita-suite.png" />
</svelte:head>

{@render children()}
