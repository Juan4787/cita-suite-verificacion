<script lang="ts">
	import type { PageProps } from './$types';

	import BackLink from '$lib/components/BackLink.svelte';
	import ConfirmForm from '$lib/components/ConfirmForm.svelte';
	import {
		ACCOUNT_ASSISTANCE_DURATION_MS,
		ACCOUNT_ASSISTANCE_OPTIONS,
		assistanceEndText,
		formatAssistanceMoment,
		type AccountAssistanceKind
	} from '$lib/access/assistance-durations';

	let { data, form }: PageProps = $props();

	const assistance = $derived(data.assistance);
	const context = $derived(data.context);
	const isOwner = $derived(context?.role === 'owner' && !context?.assistance);
	const isAssisting = $derived(Boolean(context?.assistance));
	const canUseBusiness = $derived(Boolean(context?.access?.canUseBusiness));
	const timeZone = $derived(context?.business?.timezone ?? 'America/Argentina/Buenos_Aires');
	const returnTo = '/odonto/configuracion/ayuda';

	// The server clock when the page was served, kept current with the device clock: the dialog
	// says when a new term would end even if this device's clock is wrong.
	const loadedAt = Date.now();
	const clockOffset = $derived(Number.isFinite(Date.parse(data.serverNow ?? '')) ? Date.parse(data.serverNow) - loadedAt : 0);
	// «el domingo 8 de noviembre, alrededor de las 10:15»: the term starts when the person confirms.
	const endIfConfirmedNow = (kind: AccountAssistanceKind) => {
		const now = new Date(Date.now() + clockOffset);
		const end = formatAssistanceMoment(new Date(now.getTime() + ACCOUNT_ASSISTANCE_DURATION_MS[kind]), timeZone, now);
		return end ? `el ${end.date}, alrededor de las ${end.time}` : 'que se cumpla el plazo elegido';
	};
	const activationBody = (kind: AccountAssistanceKind) => () =>
		`Cita Suite va a poder entrar a tu cuenta hasta ${endIfConfirmedNow(kind)}. Podés terminar la ayuda cuando quieras.`;
	const extensionBody = (kind: AccountAssistanceKind) => () =>
		`La ayuda va a seguir activa hasta ${endIfConfirmedNow(kind)}, contando desde ahora. Podés terminarla antes cuando quieras.`;
	const extensionLabel = (kind: AccountAssistanceKind) =>
		kind === 'initial_setup' && assistance.kind === 'initial_setup' ? 'Sumar 7 días más' : ACCOUNT_ASSISTANCE_OPTIONS[kind].extendLabel;
</script>

<section class="ux-page mx-auto w-full max-w-4xl">
	<div class="ux-card">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />

		{#if form?.message}
			<p class="ux-alert mb-5" role="alert">{form.message}</p>
		{/if}

		{#if isAssisting}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="inline-flex items-center gap-2 text-sm font-bold text-emerald-100">
						<span class="h-[0.85em] w-[0.85em] rounded-full bg-emerald-400 shadow-[0_0_0.8rem_rgba(52,211,153,0.85)]"></span>
						Activa
					</p>
					<h1 class="ux-title mt-3">Configurando {context.business.name}</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						{#if assistance.endsAt}
							La ayuda termina {assistance.endsAt.full}. Al vencer, volvés automáticamente al panel maestro.
						{:else}
							Al vencer la ayuda, volvés automáticamente al panel maestro.
						{/if}
					</p>
				</div>
				{#if assistance.canEnd && assistance.grantId}
					<ConfirmForm
						action="?/end"
						fields={{ grant_id: assistance.grantId, return_to: returnTo }}
						formClass="w-full sm:w-auto"
						buttonClass="ux-btn-secondary w-full sm:w-auto"
						label="Terminar ayuda"
						title="Terminar la ayuda"
						body={() => `Vas a dejar de poder entrar a ${context.business.name} ahora. El consultorio va a ver que Cita Suite terminó la ayuda.`}
						confirmLabel="Terminar ayuda"
						tone="danger"
					/>
				{/if}
			</div>
		{:else if !canUseBusiness}
			<div class="max-w-2xl">
				<h1 class="ux-title">Ayuda para configurar</h1>
				<p class="mt-3 text-sm leading-6 text-white/60">
					Primero activá la cuenta. Después podemos ayudarte a completar la configuración inicial.
				</p>
			</div>
		{:else if assistance.status === 'active'}
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0">
					<p class="inline-flex items-center gap-2 text-sm font-bold text-emerald-100">
						<span class="h-[0.85em] w-[0.85em] rounded-full bg-emerald-400 shadow-[0_0_0.8rem_rgba(52,211,153,0.85)]"></span>
						Ayuda activa{assistance.kind ? ` · ${ACCOUNT_ASSISTANCE_OPTIONS[assistance.kind].title}` : ''}
					</p>
					<h1 class="ux-title mt-3">Ayuda de Cita Suite activa</h1>
					<p class="mt-3 max-w-2xl text-sm leading-6 text-white/60">
						Cita Suite puede entrar a tu cuenta hasta {assistance.endsAt?.full ?? 'la fecha indicada'}.
					</p>
				</div>
				{#if isOwner && assistance.canEnd && assistance.grantId}
					<ConfirmForm
						action="?/end"
						fields={{ grant_id: assistance.grantId, return_to: returnTo }}
						formClass="w-full sm:w-auto"
						buttonClass="ux-btn-secondary w-full sm:w-auto"
						label="Terminar ayuda"
						title="Terminar la ayuda"
						body={() => 'Cita Suite deja de poder entrar a tu cuenta en este momento. Si después la necesitás, podés pedirla otra vez.'}
						confirmLabel="Terminar ayuda"
						tone="danger"
					/>
				{/if}
			</div>

			{#if isOwner && assistance.canExtend && assistance.grantId}
				<div class="mt-6 border-t border-white/10 pt-5">
					<h2 class="text-base font-bold text-white">¿Necesitás más tiempo?</h2>
					<p class="mt-1 text-sm leading-6 text-white/60">El nuevo plazo se cuenta desde el momento en que lo confirmes.</p>
					<ul class="mt-4 grid gap-3">
						{#each assistance.extensionKinds as kind (kind)}
							<li class="ux-soft-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
								<div class="min-w-0">
									<p class="font-bold text-white">{ACCOUNT_ASSISTANCE_OPTIONS[kind].title}</p>
									<p class="mt-1 text-sm leading-6 text-white/60">{ACCOUNT_ASSISTANCE_OPTIONS[kind].description}</p>
								</div>
								<ConfirmForm
									action="?/extend"
									fields={{ grant_id: assistance.grantId, kind, return_to: returnTo }}
									formClass="w-full shrink-0 sm:w-auto"
									buttonClass="ux-btn-secondary w-full sm:w-auto"
									label={extensionLabel(kind)}
									title="Extender la ayuda"
									body={extensionBody(kind)}
									confirmLabel="Extender ayuda"
								/>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{:else}
			{#if assistance.showBanner && assistance.endedAtMoment && assistance.grantId}
				<div class="mb-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-start sm:justify-between">
					<div class="min-w-0">
						<h2 class="text-base font-bold text-white">La ayuda de Cita Suite terminó</h2>
						<p class="mt-1 text-sm leading-6 text-white/60">{assistanceEndText(assistance.endedBy, assistance.endedAtMoment)}</p>
					</div>
					{#if assistance.canDismiss}
						<form method="post" action="?/dismiss" class="w-full shrink-0 sm:w-auto">
							<input type="hidden" name="return_to" value={returnTo} />
							<input type="hidden" name="grant_id" value={assistance.grantId} />
							<button class="ux-btn-secondary w-full sm:w-auto">Cerrar aviso</button>
						</form>
					{/if}
				</div>
			{/if}

			<div class="max-w-2xl">
				<h1 class="ux-title">¿Querés que te ayudemos con tu cuenta?</h1>
				<p class="mt-3 text-sm leading-6 text-white/60">
					Elegí por cuánto tiempo Cita Suite puede entrar a tu cuenta. Podés terminar la ayuda cuando quieras.
				</p>
			</div>

			{#if isOwner && assistance.canActivate}
				<ul class="mt-5 grid gap-3">
					{#each assistance.activationKinds as kind (kind)}
						<li class="ux-soft-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<p class="font-bold text-white">{ACCOUNT_ASSISTANCE_OPTIONS[kind].title}</p>
								<p class="mt-1 text-sm leading-6 text-white/60">{ACCOUNT_ASSISTANCE_OPTIONS[kind].description}</p>
							</div>
							<ConfirmForm
								action="?/activate"
								fields={{ kind, return_to: returnTo }}
								formClass="w-full shrink-0 sm:w-auto"
								buttonClass={`${kind === 'hour' ? 'ux-btn-primary' : 'ux-btn-secondary'} w-full sm:w-auto`}
								label={ACCOUNT_ASSISTANCE_OPTIONS[kind].activateLabel}
								title={ACCOUNT_ASSISTANCE_OPTIONS[kind].activateTitle}
								body={activationBody(kind)}
								confirmLabel="Dar ayuda"
							/>
						</li>
					{/each}
				</ul>
			{:else if !isOwner}
				<p class="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/65">
					Esta opción la puede activar el dueño del consultorio.
				</p>
			{/if}
		{/if}

		<div class="mt-5 border-t border-white/10 pt-4">
			<p class="text-sm leading-6 text-white/50">
				Tu suscripción y tu equipo quedan siempre bajo tu control.
			</p>
		</div>
	</div>
</section>
