<script lang="ts">
	import type { LayoutProps } from './$types';

	import '../app.css';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>Cita Suite</title>
	<link rel="icon" type="image/png" href="/logo-cita-suite.png" />
</svelte:head>

{@render children()}
