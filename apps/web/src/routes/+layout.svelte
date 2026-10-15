<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/logo-cita-suite.png" />
</svelte:head>

{@render children()}
