<script lang="ts">
	let { data } = $props();

	const copy = $derived.by(() => {
		if (data.reason === 'temporarily_unavailable') {
			return {
				badge: 'Alta pausada',
				title: 'No pudimos preparar tu consultorio',
				detail:
					'Tu cuenta está creada, pero todavía no pudimos terminar el consultorio. Detuvimos el alta de forma segura: volvé a intentar en unos minutos.',
				note: 'Si continúa, contactá a soporte para que podamos completar el alta.',
				canRetry: true
			};
		}
		if (data.reason === 'rate_limited') {
			return {
				badge: 'Alta pausada',
				title: 'Esperá antes de volver a intentar',
				detail:
					'Hicimos varios intentos de preparar tu consultorio y detuvimos el alta para evitar duplicados.',
				note: 'Esperá unos minutos y volvé a intentar. Si continúa, contactá a soporte.',
				canRetry: true
			};
		}
		return {
			badge: 'Cuenta creada',
			title: 'Estamos configurando tu consultorio',
			detail:
				'Tu email ya está habilitado, pero todavía falta que soporte cree o vincule tu consultorio. Tus accesos quedarán disponibles cuando esa configuración esté completa.',
			note: 'No hace falta pagar todavía. Si necesitás acelerar el alta, contactá soporte.',
			canRetry: false
		};
	});
</script>

<section class="ux-page">
	<div class="mx-auto max-w-2xl">
		<div class="ux-card text-center">
			<p class="ux-badge mx-auto">{copy.badge}</p>
			<h1 class="ux-title mt-5">{copy.title}</h1>
			<p class="mx-auto mt-4 max-w-lg text-base font-semibold text-white/65">
				{copy.detail}
			</p>
			<p class="mt-7 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/70">
				{copy.note}
			</p>
			{#if copy.canRetry}
				<a href="/odonto/agenda" class="ux-btn-primary mt-6 inline-flex">Volver a intentar</a>
			{/if}
		</div>
	</div>
</section>
