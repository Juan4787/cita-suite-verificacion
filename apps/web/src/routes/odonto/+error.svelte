<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const isNotFound = $derived(status === 404);
	const homeHref = $derived(
		$page.data?.activeBusiness?.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda'
	);
	const title = $derived(isNotFound ? 'Página no encontrada' : 'No se pudo cargar la página');
	const detail = $derived.by(() => {
		const message = $page.error?.message ?? '';
		// Errores de servidor (5xx): nunca exponer detalles internos al usuario.
		if (status >= 500) {
			return 'Ocurrió un problema al cargar esta página. Volvé a intentarlo. Si continúa, contactá a soporte.';
		}
		// 404 / otros 4xx: mostramos el mensaje propio si es claro.
		if (message && message !== 'Internal Error' && message !== 'Not Found') {
			return message;
		}
		return isNotFound
			? 'El contenido no existe o ya no está disponible.'
			: 'No se pudo cargar la página. Reintentá en unos segundos.';
	});
</script>

<section class="ux-page">
	<div class="ux-hero text-center">
		<p class="ux-badge mx-auto">{isNotFound ? 'No disponible' : 'Error'}</p>
		<h1 class="ux-title mt-4">{title}</h1>
		<p class="ux-subtitle mx-auto">{detail}</p>
		<div class="mt-6 flex flex-wrap justify-center gap-3">
			<button type="button" class="ux-btn-primary" onclick={() => window.location.reload()}>
				Volver a intentar
			</button>
			<a href={homeHref} class="ux-btn-secondary">Volver al inicio</a>
			<a href="/odonto/pacientes" class="ux-btn-secondary">Ver pacientes</a>
		</div>
	</div>
</section>
