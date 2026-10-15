<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const isNotFound = $derived(status === 404);
	const title = $derived(isNotFound ? 'Página no encontrada' : 'No se pudo cargar la página');
	const detail = $derived.by(() => {
		const message = $page.error?.message ?? '';
		// Errores de servidor (5xx): nunca exponer detalles internos al usuario.
		if (status >= 500) {
			return 'Ocurrió un problema al cargar esta página. Volvé a intentarlo. Si continúa, contactá a soporte.';
		}
		// 404 / otros 4xx: mostramos el mensaje propio si es claro (ej. enlaces inválidos).
		if (message && message !== 'Internal Error' && message !== 'Not Found') {
			return message;
		}
		return isNotFound
			? 'El enlace no existe o ya no está disponible.'
			: 'No se pudo cargar la página. Reintentá en unos segundos.';
	});
</script>

<svelte:head>
	<title>{title} — Cita Suite</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<section class="ux-hero w-full max-w-lg text-center">
		<picture>
			<img
				src="/logo-cita-suite.png"
				alt="Cita Suite"
				class="mx-auto h-14 w-14 rounded-2xl"
				width="56"
				height="56"
			/>
		</picture>
		<h1 class="ux-title mt-5">{title}</h1>
		<p class="ux-subtitle mx-auto">{detail}</p>
		<div class="mt-6 flex flex-wrap justify-center gap-3">
			<button type="button" class="ux-btn-primary" onclick={() => window.location.reload()}>
				Volver a intentar
			</button>
			<a href="/" class="ux-btn-secondary">Ir al inicio</a>
		</div>
	</section>
</div>
