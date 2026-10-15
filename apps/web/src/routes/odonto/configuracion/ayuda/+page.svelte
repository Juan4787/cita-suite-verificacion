<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';

	let { data, form } = $props();

	const assistance = $derived(data.assistance);
	const context = $derived(data.context);
	const isOwner = $derived(context?.role === 'owner' && !context?.assistance);
	const isAssisting = $derived(Boolean(context?.assistance));
	const canUseBusiness = $derived(Boolean(context?.access?.canUseBusiness));
	const returnTo = '/odonto/configuracion/ayuda';
</script>

<section class="ux-page mx-auto w-full max-w-4xl">
	<div class="ux-card">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />

		{#if form?.message}
			<p class="ux-alert mb-5">{form.message}</p>
		{/if}

		{#if isAssisting}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="inline-flex items-center gap-2 text-sm font-black text-emerald-100">
						<span class="h-[0.85em] w-[0.85em] rounded-full bg-emerald-400 shadow-[0_0_0.8rem_rgba(52,211,153,0.85)]"></span>
						Activa
					</p>
					<h1 class="ux-title mt-3">Configurando esta cuenta</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						Termina a las {assistance.endsAtLabel ?? 'hora indicada'}.
					</p>
				</div>
			</div>
		{:else if !canUseBusiness}
			<div class="max-w-2xl">
				<p class="ux-badge ux-badge-warning">Cuenta inactiva</p>
				<h1 class="ux-title mt-3">Ayuda para configurar</h1>
				<p class="mt-3 text-sm leading-6 text-white/60">
					Primero activá la cuenta. Después podemos ayudarte a completar la configuración inicial.
				</p>
			</div>
		{:else if assistance.status === 'active'}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="inline-flex items-center gap-2 text-sm font-black text-emerald-100">
						<span class="h-[0.85em] w-[0.85em] rounded-full bg-emerald-400 shadow-[0_0_0.8rem_rgba(52,211,153,0.85)]"></span>
						Ayuda activa
					</p>
					<h1 class="ux-title mt-3">Ayuda de Cita Suite activa</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						Podemos configurar esta cuenta hasta las {assistance.endsAtLabel ?? 'hora indicada'}.
					</p>
				</div>
				{#if isOwner}
					<form method="post" action="?/revoke" class="w-full sm:w-auto">
						<input type="hidden" name="return_to" value={returnTo} />
						<button class="ux-btn-secondary w-full sm:w-auto">Detener ayuda</button>
					</form>
				{/if}
			</div>
		{:else if assistance.status === 'expired'}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="ux-badge ux-badge-warning">Finalizada</p>
					<h1 class="ux-title mt-3">La ayuda de Cita Suite finalizó</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						Si todavía necesitás ayuda, podés activarla otra vez.
					</p>
				</div>
				{#if isOwner}
					<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
						<form method="post" action="?/activate" class="w-full sm:w-auto">
							<input type="hidden" name="return_to" value={returnTo} />
							<button class="ux-btn-primary w-full sm:w-auto">Volver a activar</button>
						</form>
						{#if assistance.canDismiss && assistance.grantId}
							<form method="post" action="?/dismiss" class="w-full sm:w-auto">
								<input type="hidden" name="return_to" value={returnTo} />
								<input type="hidden" name="grant_id" value={assistance.grantId} />
								<button class="ux-btn-secondary w-full sm:w-auto">Cerrar aviso</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		{:else if assistance.status === 'revoked'}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="ux-badge">Detenida</p>
					<h1 class="ux-title mt-3">Ayuda detenida</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						Cita Suite ya no puede hacer cambios en esta cuenta.
					</p>
				</div>
				{#if isOwner}
					<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
						<form method="post" action="?/activate" class="w-full sm:w-auto">
							<input type="hidden" name="return_to" value={returnTo} />
							<button class="ux-btn-secondary w-full sm:w-auto">Activar nuevamente</button>
						</form>
						{#if assistance.canDismiss && assistance.grantId}
							<form method="post" action="?/dismiss" class="w-full sm:w-auto">
								<input type="hidden" name="return_to" value={returnTo} />
								<input type="hidden" name="grant_id" value={assistance.grantId} />
								<button class="ux-btn-secondary w-full sm:w-auto">Cerrar aviso</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="ux-badge">Configuración</p>
					<h1 class="ux-title mt-3">¿Querés que te ayudemos a configurar tu cuenta?</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						Podemos cargar profesionales, servicios y horarios iniciales durante 1 hora.
					</p>
				</div>
				{#if isOwner}
					<form method="post" action="?/activate" class="w-full sm:w-auto">
						<input type="hidden" name="return_to" value={returnTo} />
						<button class="ux-btn-primary w-full sm:w-auto">Quiero ayuda por 1 hora</button>
					</form>
				{:else}
					<p class="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/65">
						Esta opción la puede activar el dueño del consultorio.
					</p>
				{/if}
			</div>
		{/if}

		<div class="mt-5 border-t border-white/10 pt-4">
			<p class="text-sm leading-6 text-white/50">
				Tu suscripción y tu equipo quedan siempre bajo tu control.
			</p>
		</div>
	</div>
</section>
