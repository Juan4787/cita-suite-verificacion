<script lang="ts">
	let { data } = $props();

	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'ARS 0';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', {
			style: 'currency',
			currency: 'ARS',
			maximumFractionDigits: 0
		});
	};

	const confirmedByReturn = $derived(
		Boolean(
			data.mpReturn &&
				(data.mpReturn.creditedNow ||
					(data.mpReturn.subscriptionStatus === 'authorized' && data.activated))
		)
	);
	const refreshHref = $derived(
		data.mpReturnRequested ? '/odonto/pago/procesando?mp=retorno' : '/odonto/pago/procesando'
	);
</script>

<section class="ux-page">
	<div class="mx-auto max-w-2xl">
		<div class="ux-card text-center">
			{#if data.activated}
				<p class="ux-badge ux-badge-success mx-auto">Suscripción activada</p>
				<h1 class="ux-title mt-5">Suscripción activada</h1>
				<p class="mx-auto mt-4 max-w-lg text-base font-semibold text-white/65">
					Ahora configurá tu agenda para empezar a recibir turnos.
				</p>
				<a href="/odonto/disponibilidad" class="ux-btn-primary mt-7 inline-flex">
					Configurar mi agenda
				</a>
				{#if confirmedByReturn}
					<p class="mt-4 text-sm font-semibold text-white/45">
						Confirmamos el pago directamente con Mercado Pago.
					</p>
				{/if}
			{:else if data.manualBlock}
				<p class="ux-badge ux-badge-warning mx-auto">Revisión necesaria</p>
				<h1 class="ux-title mt-5">Tu cuenta requiere soporte</h1>
				<p class="mx-auto mt-4 max-w-lg text-base font-semibold text-white/65">
					El acceso fue suspendido por el administrador del sistema. Un pago no lo
					reactiva automáticamente.
				</p>
				<a href="/odonto/configuracion/suscripcion" class="ux-btn-secondary mt-7 inline-flex">
					Ver estado de suscripción
				</a>
			{:else}
				<p class="ux-badge mx-auto">Pago en proceso</p>
				<h1 class="ux-title mt-5">Estamos confirmando tu pago</h1>
				<p class="mx-auto mt-4 max-w-lg text-base font-semibold text-white/65">
					Esto suele demorar solo unos segundos. Tu cuenta y tus datos ya están guardados.
				</p>

				<div class="mx-auto mt-7 max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left">
					<p class="text-sm font-bold text-white/45">Plan Cita Suite</p>
					<p class="mt-2 text-2xl font-black text-white">{money(data.mpAmount)} por mes</p>
					<p class="mt-2 text-sm font-semibold text-white/55">
						Acceso completo a agenda, pacientes, turnos y recordatorios.
					</p>
				</div>

				{#if data.mpReturnFailed}
					<p class="ux-alert ux-alert-warning mt-6 text-left">
						No pudimos confirmar con Mercado Pago en este momento. Si autorizaste la
						suscripción, el webhook la acredita automáticamente; no hace falta pagar de nuevo.
					</p>
				{:else if data.mpReturn?.subscriptionStatus === 'pending'}
					<p class="ux-alert ux-alert-warning mt-6 text-left">
						La autorización todavía figura pendiente en Mercado Pago. Si acabás de aprobarla,
						actualizá esta pantalla en unos segundos.
					</p>
				{:else if data.mpReturn?.subscriptionStatus && data.mpReturn.subscriptionStatus !== 'authorized'}
					<p class="ux-alert ux-alert-warning mt-6 text-left">
						Mercado Pago devolvió el estado "{data.mpReturn.subscriptionStatus}". Si el pago no
						se completó, podés volver a activar la suscripción.
					</p>
				{/if}

				<div class="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
					<a href={refreshHref} class="ux-btn-secondary text-center">Actualizar estado</a>
					<a href="/odonto/configuracion/suscripcion" class="ux-btn-primary text-center">
						Volver a activación
					</a>
				</div>
			{/if}
		</div>
	</div>
</section>
