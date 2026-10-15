<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessSubscriptionRow } from '$lib/server/commercial-access';
	import { visibleCommercialAccessNote } from '$lib/utils/commercial-access-copy';
	import { formatAccessRemaining } from '$lib/utils/format';

	let { data, form } = $props();

	const access = $derived(data.context.access);
	const subscription = $derived((access.subscription ?? {}) as Partial<BusinessSubscriptionRow>);
	const accessNote = $derived(
		visibleCommercialAccessNote(subscription.access_note, access.canUseBusiness)
	);
	const mpSub = $derived(data.mpSubscription);
	const mpReturn = $derived(data.mpReturn);
	// Anti doble-click: los forms son POST nativos (sin enhance, porque el 303
	// externo a MP no funciona con fetch); se deshabilita el botón al enviar.
	let mpSubmitting = $state(false);
	const mpPaid = $derived(
		Boolean(
			mpReturn &&
				(mpReturn.creditedNow ||
					(mpReturn.subscriptionStatus === 'authorized' && access.commercialStatus === 'active'))
		)
	);
	const isManualBlock = $derived(!access.commercialAccessEnabled || Boolean(access.archivedAt));
	const canActivateWithMp = $derived(
		!access.isPermanent && access.commercialAccessEnabled && !access.archivedAt
	);
	const isInitialActivation = $derived(
		!access.isPermanent &&
			!access.paidUntil &&
			!subscription.last_payment_at &&
			(access.commercialStatus === 'restricted' || access.commercialStatus === 'archived')
	);
	const mainTitle = $derived.by(() => {
		if (isInitialActivation) return 'Activá tu suscripción';
		if (access.commercialStatus === 'active' || access.commercialStatus === 'grace') {
			return 'Suscripción de Cita Suite';
		}
		if (isManualBlock) return 'Tu cuenta requiere soporte';
		return 'Tu acceso a Cita Suite venció';
	});
	const mainDescription = $derived.by(() => {
		if (isInitialActivation) {
			return 'Tu cuenta ya está creada. Activá tu suscripción para comenzar a gestionar turnos, pacientes y tu agenda.';
		}
		if (access.commercialStatus === 'active' || access.commercialStatus === 'grace') {
			return 'Gestioná el acceso del consultorio y la suscripción mensual.';
		}
		if (isManualBlock) {
			return 'El acceso fue suspendido por el administrador del sistema. Contactá soporte; un pago no lo reactiva automáticamente.';
		}
		return 'Tu agenda, pacientes y configuración siguen guardados. Activá tu suscripción para volver a usar Cita Suite.';
	});

	const formatDateTime = (value?: string | null, empty = 'No vence') =>
		value ? new Date(value).toLocaleString('es-AR') : empty;

	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'Sin registrar';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
	};

	const statusLabel = $derived.by(() => {
		if (!access.commercialAccessEnabled) return 'Acceso pausado';
		if (access.visualStatus === 'permanent') return 'Permanente';
		if (access.visualStatus === 'expiring') {
			return formatAccessRemaining(access.paidUntil) ?? 'Vence pronto';
		}
		if (access.commercialStatus === 'active') return 'Activo';
		if (access.commercialStatus === 'grace') return 'Vencido';
		if (access.commercialStatus === 'restricted') return 'Pendiente';
		return 'Archivado';
	});

	const statusClass = $derived.by(() => {
		if (access.commercialStatus === 'archived') {
			return 'ux-badge ux-badge-danger';
		}
		if (!access.commercialAccessEnabled || access.commercialStatus === 'restricted') {
			return 'ux-badge ux-badge-warning';
		}
		if (access.commercialStatus === 'grace' || access.visualStatus === 'expiring') {
			return 'ux-badge ux-badge-warning';
		}
		return 'ux-badge ux-badge-success';
	});
</script>

<section class="ux-page">
	<div class="ux-hero">
		{#if access.canUseBusiness}
			<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		{/if}
		<p class="ux-badge">Cita Suite</p>
		<h1 class="ux-title mt-4">{mainTitle}</h1>
		<p class="ux-subtitle">{mainDescription}</p>
	</div>

	<div class="ux-card">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<span class={statusClass}>{statusLabel}</span>
				<h2 class="mt-4 text-3xl font-black text-white">{data.context.business.name}</h2>
				<p class="mt-2 text-sm text-white/55">
					{access.isPermanent ? 'Tu cuenta no tiene vencimiento.' : 'Estado de acceso del consultorio.'}
				</p>
			</div>
			<div class="grid gap-3 sm:grid-cols-2 lg:min-w-[34rem]">
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Vencimiento</p>
					<p class="mt-2 font-bold text-white">{access.isPermanent ? 'No vence' : formatDateTime(access.paidUntil)}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Límite antes de suspensión</p>
					<p class="mt-2 font-bold text-white">{access.isPermanent ? 'No vence' : formatDateTime(access.graceUntil)}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Límite antes de archivo</p>
					<p class="mt-2 font-bold text-white">{access.isPermanent ? 'No vence' : formatDateTime(access.restrictedUntil)}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-white/45">Último pago</p>
					<p class="mt-2 font-bold text-white">{money(subscription.last_payment_amount)}</p>
				</div>
			</div>
		</div>

		<div class="mt-6 grid gap-3 md:grid-cols-2">
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/45">Última actualización</p>
				<p class="mt-2 font-bold text-white">{formatDateTime(subscription.updated_at, 'Sin registrar')}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-white/45">Cómo continuar</p>
				<p class="mt-2 font-bold text-white">
					{access.isPermanent ? 'Contactá soporte del sistema.' : isManualBlock ? 'Contactá soporte.' : 'Activá la suscripción con Mercado Pago más abajo.'}
				</p>
			</div>
		</div>

		{#if accessNote}
			<p class={`ux-alert mt-5 ${access.canUseBusiness ? 'ux-alert-success' : 'ux-alert-warning'}`}>
				{accessNote}
			</p>
		{/if}
	</div>

	{#if !access.isPermanent}
		<div class="ux-card">
			<h2 class="ux-section-title">Suscripción con Mercado Pago</h2>
			<p class="mt-2 text-sm text-white/55">
				Plan Cita Suite: <span class="font-bold text-white">{money(data.mpAmount)}</span> por mes.
				Serás redirigido a Mercado Pago para completar el pago de forma segura. Los medios
				de pago disponibles los muestra Mercado Pago al momento de autorizar.
			</p>
			{#if data.mpEnvironment === 'test'}
				<div class="ux-alert ux-alert-warning mt-4">
					<p class="font-black">Mercado Pago está en modo de prueba.</p>
					<p class="mt-1">
						Abrí el checkout en una ventana privada e ingresá con un comprador de prueba de
						Argentina. No uses tu cuenta personal de Mercado Pago: las tarjetas de prueba se
						rechazan cuando el comprador o el vendedor pertenece al entorno productivo.
					</p>
				</div>
			{/if}
			{#if access.commercialStatus === 'active' && access.paidUntil && mpSub?.status !== 'authorized' && mpSub?.status !== 'paused'}
				<p class="ux-alert ux-alert-success mt-4">
					Tu tiempo vigente se conserva: cuando se acredite el primer pago, se suman 30 días
					al vencimiento actual.
				</p>
			{/if}

			{#if form?.message && !form?.success}
				<p class="ux-alert ux-alert-danger mt-4">{form.message}</p>
			{/if}
			{#if form?.success}
				<p class="ux-alert ux-alert-success mt-4">{form.message}</p>
			{/if}

			{#if mpReturn}
				{#if mpReturn.accessBlocked}
					<p class="ux-alert ux-alert-warning mt-4">
						Tu pago se registró correctamente, pero la habilitación del acceso requiere una
						revisión del administrador. Ya quedó avisado.
					</p>
				{:else if mpPaid}
					<p class="ux-alert ux-alert-success mt-4">
						¡Pago acreditado! Tu acceso ya está activo y se renueva automáticamente cada mes.
					</p>
				{:else if mpReturn.subscriptionStatus === 'authorized'}
					<p class="ux-alert ux-alert-success mt-4">
						Suscripción autorizada. El primer cobro está en proceso y tu acceso se acredita
						solo en los próximos minutos; podés actualizar esta página para verlo.
					</p>
				{:else if mpReturn.subscriptionStatus === 'pending'}
					<p class="ux-alert ux-alert-warning mt-4">
						La autorización quedó pendiente en Mercado Pago. Si la completaste recién, dale
						unos minutos; si no, podés reintentar desde acá.
					</p>
				{:else}
					<p class="ux-alert ux-alert-warning mt-4">
						Todavía no vimos una suscripción activa. Si autorizaste el débito recién, el
						sistema la acredita solo en unos minutos.
					</p>
				{/if}
			{:else if data.mpReturnFailed}
				<p class="ux-alert ux-alert-warning mt-4">
					No pudimos confirmar con Mercado Pago en este momento. Si autorizaste la
					suscripción, el pago se acredita automáticamente; no hace falta pagar de nuevo.
				</p>
			{/if}

			{#if isManualBlock}
				<p class="ux-alert ux-alert-warning mt-5">
					El acceso fue suspendido por el administrador del sistema. No inicies un pago desde
					acá: contactá soporte para regularizar la cuenta.
				</p>
				<p class="mt-4 text-sm font-semibold text-white/55">¿Necesitás ayuda? Contactar soporte</p>
			{:else if mpSub?.status === 'authorized' || mpSub?.status === 'paused'}
				<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-white/45">Estado</p>
						<p class="mt-2 font-bold text-white">{mpSub.status === 'authorized' ? 'Activa' : 'Pausada'}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-white/45">Monto mensual</p>
						<p class="mt-2 font-bold text-white">{money(mpSub.transaction_amount)}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-white/45">Próximo cobro</p>
						<p class="mt-2 font-bold text-white">{formatDateTime(mpSub.next_charge_at, 'Programado por MP')}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-white/45">Pagador</p>
						<p class="mt-2 break-all font-bold text-white">{mpSub.payer_email ?? 'Sin registrar'}</p>
					</div>
				</div>
				{#if mpSub.status === 'paused'}
					<p class="ux-alert ux-alert-warning mt-4">
						Mercado Pago pausó esta suscripción (suele pasar por cobros fallidos). Podés
						actualizar el medio de pago desde tu cuenta de Mercado Pago, o cancelarla acá y
						crear una nueva.
					</p>
				{/if}
				<form method="POST" action="?/cancel" class="mt-5" onsubmit={() => (mpSubmitting = true)}>
					<input type="hidden" name="preapproval_id" value={mpSub.preapproval_id} />
					<button type="submit" disabled={mpSubmitting} class="ux-btn-secondary">
						{mpSubmitting ? 'Cancelando…' : 'Cancelar suscripción'}
					</button>
					<p class="mt-2 text-sm text-white/45">
						Al cancelar no se generan más cobros; el tiempo ya pagado sigue vigente hasta su
						vencimiento.
					</p>
				</form>
			{:else if canActivateWithMp}
				{#if mpSub?.status === 'pending'}
					<p class="mt-4 text-sm text-white/55">
						Hay una autorización pendiente sin completar. Podés retomarla iniciando la
						suscripción de nuevo.
					</p>
				{:else if mpSub?.status === 'cancelled'}
					<p class="mt-4 text-sm text-white/55">
						Tu suscripción anterior fue cancelada. Podés suscribirte de nuevo cuando quieras.
					</p>
				{/if}
				<form method="POST" action="?/subscribe" class="mt-5" onsubmit={() => (mpSubmitting = true)} aria-busy={mpSubmitting}>
					<button type="submit" disabled={mpSubmitting} class="ux-btn-primary">
						{mpSubmitting ? 'Creando enlace seguro en Mercado Pago…' : 'Activar suscripción con Mercado Pago'}
					</button>
					{#if mpSubmitting}
						<p class="mt-2 text-sm font-semibold text-white/60">
							Esto puede tardar unos segundos. No cierres esta ventana ni vuelvas a tocar el botón.
						</p>
					{:else}
						<p class="mt-2 text-sm text-white/45">
							Te redirigimos a Mercado Pago para autorizar el débito mensual de forma segura.
						</p>
					{/if}
				</form>
			{/if}
		</div>
	{/if}

	<div class="ux-card">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="ux-section-title">Historial</h2>
				<p class="mt-2 text-sm text-white/55">Cambios de acceso registrados.</p>
			</div>
		</div>

		<div class="mt-5 space-y-3">
			{#if data.grants.length === 0}
				<p class="ux-empty">Sin movimientos registrados.</p>
			{:else}
				{#each data.grants as grant}
					<div class="ux-soft-card p-4">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="font-black text-white">
									{grant.operation === 'set_permanent' ? 'Acceso permanente' : grant.operation === 'grant_access' || grant.operation === 'extend_access' ? 'Acceso actualizado' : 'Cambio registrado'}
								</p>
								<p class="mt-1 text-sm text-white/55">
									{money(grant.amount)}
								</p>
							</div>
							<time class="text-sm font-bold text-white/45">{formatDateTime(grant.created_at)}</time>
						</div>
						<div class="mt-3 grid gap-3 text-sm md:grid-cols-2">
							<p class="text-white/55">Antes: <span class="font-bold text-white">{formatDateTime(grant.paid_until_before)}</span></p>
							<p class="text-white/55">Después: <span class="font-bold text-white">{formatDateTime(grant.paid_until_after)}</span></p>
						</div>
						{#if grant.note}
							<p class="mt-3 text-sm text-white/70">{grant.note}</p>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
