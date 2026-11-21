<script lang="ts">
	import type { PageProps } from './$types';

	import BackLink from '$lib/components/BackLink.svelte';
	import type { BusinessSubscriptionRow } from '$lib/access/commercial-access';
	import { visibleCommercialAccessNote } from '$lib/utils/commercial-access-copy';
	import { formatAccessRemaining, formatDateTime as formatZonedDateTime } from '$lib/utils/format';

	let { data, form }: PageProps = $props();

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
	// Cancelar no tiene vuelta atrás en Mercado Pago: se pide una confirmación explícita.
	let confirmingCancel = $state(false);
	// Tras un rechazo, el correo escrito; si no, el de ingreso.
	// Vacío al empezar: el consultorio escribe el correo de la cuenta de Mercado Pago con la que va a pagar, que puede
	// ser otro que el de ingreso (18-nov-2026). Tras un error, lo que escribió.
	const payerEmailValue = $derived(
		String((form && 'payerEmail' in form ? form.payerEmail : undefined) ?? '')
	);
	const lastChargeRejected = $derived(
		mpSub?.status === 'authorized' && mpSub.last_charge_status === 'rejected'
	);
	// Acceso provisorio en curso: el último movimiento es el provisorio y el acceso sigue activo. Hasta
	// el primer cobro no hay pago: la página no lo anuncia como acreditado (20261118020000).
	const provisionalInForce = $derived(
		data.grants?.[0]?.operation === 'provisional_access' && access.commercialStatus === 'active'
	);
	const mpPaid = $derived(
		Boolean(
			mpReturn &&
				!provisionalInForce &&
				(mpReturn.creditedNow ||
					(mpReturn.subscriptionStatus === 'authorized' && access.commercialStatus === 'active'))
		)
	);
	const isManualBlock = $derived(!access.commercialAccessEnabled || Boolean(access.archivedAt));
	// Plan pagado aparte, por ejemplo por transferencia (decisión de Juan del 18-nov-2026): mientras esté vigente
	// no se ofrece Mercado Pago, para que nadie pague dos veces. Una suscripción de Mercado Pago que ya existe se
	// sigue mostrando, para poder gestionarla o cancelarla.
	const manualPlanInForce = $derived(
		!access.isPermanent &&
			access.commercialStatus === 'active' &&
			subscription.access_source === 'manual' &&
			mpSub?.status !== 'authorized' &&
			mpSub?.status !== 'paused'
	);
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
		if (manualPlanInForce) return 'Gestioná el acceso del consultorio.';
		if (access.commercialStatus === 'active' || access.commercialStatus === 'grace') {
			return 'Gestioná el acceso del consultorio y la suscripción mensual.';
		}
		if (isManualBlock) {
			return 'El acceso fue suspendido por el administrador del sistema. Contactá soporte; un pago no lo reactiva automáticamente.';
		}
		return 'Tu agenda, pacientes y configuración siguen guardados. Activá tu suscripción para volver a usar Cita Suite.';
	});

	const businessTimeZone = $derived(data.context.business.timezone);
	const formatDateTime = (value?: string | null, empty = 'No vence') =>
		value ? formatZonedDateTime(value, businessTimeZone) : empty;

	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'Sin registrar';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
	};

	const grantTitle = (grant: { operation: string; source?: string | null }) => {
		if (grant.operation === 'set_permanent') return 'Acceso permanente';
		if (grant.operation === 'grant_access' || grant.operation === 'extend_access') return 'Acceso actualizado';
		if (grant.operation === 'payment_registered') return grant.source === 'mercado_pago' ? 'Pago de Mercado Pago' : 'Pago registrado';
		if (grant.operation === 'payment_cancelled') return 'Reembolso o contracargo';
		if (grant.operation === 'provisional_access') return 'Acceso provisorio';
		return 'Cambio registrado';
	};

	const howToContinue = $derived.by(() => {
		if (access.isPermanent) return 'Contactá soporte del sistema.';
		if (isManualBlock) return 'Contactá soporte.';
		if (manualPlanInForce) {
			return access.visualStatus === 'expiring'
				? 'Tu plan manual vence pronto. Coordiná la renovación con soporte antes del vencimiento.'
				: 'Tu plan está pago: no necesitás suscribirte ahora.';
		}
		if (mpSub?.status === 'authorized') return 'Tu suscripción se renueva sola cada mes con Mercado Pago.';
		if (mpSub?.status === 'paused') return 'Tu suscripción está pausada en Mercado Pago.';
		return 'Activá la suscripción con Mercado Pago más abajo.';
	});

	const statusLabel = $derived.by(() => {
		if (!access.commercialAccessEnabled) return 'Acceso pausado';
		if (access.visualStatus === 'permanent') return 'Permanente';
		if (access.visualStatus === 'expiring') {
			return formatAccessRemaining(access.paidUntil, new Date(), businessTimeZone) ?? 'Vence pronto';
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

<section class="ux-page mx-auto w-full max-w-5xl">
	<header>
		{#if access.canUseBusiness}
			<BackLink href="/odonto/configuracion" label="Configuración" class="mb-5" />
		{/if}
		<h1 class="ux-title">{mainTitle}</h1>
		<p class="ux-subtitle">{mainDescription}</p>
	</header>

	<div class="ux-card">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<span class={statusClass}>{statusLabel}</span>
				<h2 class="mt-4 text-3xl font-bold text-fg">{data.context.business.name}</h2>
				<p class="mt-2 text-sm text-fg-55">
					{access.isPermanent ? 'Tu cuenta no tiene vencimiento.' : 'Estado de acceso del consultorio.'}
				</p>
			</div>
			<div class="grid gap-3 sm:grid-cols-2 lg:min-w-[34rem]">
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-copy-subtle">Vencimiento</p>
					<p class="mt-2 font-bold text-fg">{access.isPermanent ? 'No vence' : formatDateTime(access.paidUntil, 'Sin pago registrado')}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-copy-subtle">Límite antes de suspensión</p>
					<p class="mt-2 font-bold text-fg">{access.isPermanent ? 'No vence' : formatDateTime(access.graceUntil, 'Sin pago registrado')}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-copy-subtle">Límite antes de archivo</p>
					<p class="mt-2 font-bold text-fg">{access.isPermanent ? 'No vence' : formatDateTime(access.restrictedUntil, 'Sin fecha')}</p>
				</div>
				<div class="ux-soft-card p-4">
					<p class="text-sm font-bold text-copy-subtle">Último pago</p>
					<p class="mt-2 font-bold text-fg">{money(subscription.last_payment_amount)}</p>
				</div>
			</div>
		</div>

		<div class="mt-6 grid gap-3 md:grid-cols-2">
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-copy-subtle">Última actualización</p>
				<p class="mt-2 font-bold text-fg">{formatDateTime(subscription.updated_at, 'Sin registrar')}</p>
			</div>
			<div class="ux-soft-card p-4">
				<p class="text-sm font-bold text-copy-subtle">Cómo continuar</p>
				<p class="mt-2 font-bold text-fg">{howToContinue}</p>
			</div>
		</div>

		{#if accessNote}
			<p class={`ux-alert mt-5 ${access.canUseBusiness ? 'ux-alert-success' : 'ux-alert-warning'}`}>
				{accessNote}
			</p>
		{/if}
	</div>

	{#if manualPlanInForce}
		<div class="ux-card">
			<h2 class="ux-section-title">Tu plan</h2>
			{#if access.visualStatus === 'expiring'}
				<p class="ux-alert ux-alert-warning mt-4" role="status">
					Tu plan manual vence el {formatDateTime(access.paidUntil, 'próximo vencimiento')}. Coordiná la
					renovación con soporte antes de esa fecha para evitar interrupciones en la agenda y las reservas online.
				</p>
			{:else}
				<p class="mt-2 text-sm text-fg-55">
					Tu plan está pago hasta el {formatDateTime(access.paidUntil, 'vencimiento de tu plan')}. No necesitás
					suscribirte ahora: te avisamos con 30 días de anticipación para coordinar la renovación.
				</p>
			{/if}
		</div>
	{:else if !access.isPermanent}
		<div class="ux-card">
			<h2 class="ux-section-title">Suscripción con Mercado Pago</h2>
			<p class="mt-2 text-sm text-fg-55">
				Plan Cita Suite: <span class="font-bold text-fg">{money(data.mpAmount)}</span> por mes.
				Serás redirigido a Mercado Pago para completar el pago de forma segura. Los medios
				de pago disponibles los muestra Mercado Pago al momento de autorizar.
			</p>
			{#if data.mpPriceLocked}
				<p class="mt-2 text-sm text-fg-55">
					Es el precio de tu suscripción: lo conservás aunque el precio general cambie, también si
					cancelás y volvés a suscribirte.
				</p>
			{/if}
			{#if provisionalInForce}
				<p class="ux-alert ux-alert-success mt-4">
					Tenés acceso provisorio hasta el {formatDateTime(access.paidUntil, 'momento del primer cobro')}, mientras
					Mercado Pago procesa el primer cobro, que puede tardar hasta una hora. Cuando se acredite, el acceso
					se extiende solo.
				</p>
			{/if}
			{#if data.mpEnvironment === 'test'}
				<div class="ux-alert ux-alert-warning mt-4">
					<p class="font-bold">Mercado Pago está en modo de prueba.</p>
					<p class="mt-1">
						Abrí el checkout en una ventana privada e ingresá con un comprador de prueba de
						Argentina. No uses tu cuenta personal de Mercado Pago: las tarjetas de prueba se
						rechazan cuando el comprador o el vendedor pertenece al entorno productivo.
					</p>
				</div>
			{/if}
			{#if access.commercialStatus === 'active' && access.paidUntil && !data.mpSubscriptionUnavailable && mpSub?.status !== 'authorized' && mpSub?.status !== 'paused'}
				<p class="ux-alert ux-alert-success mt-4">
					Tu tiempo vigente se conserva: cada cobro de Mercado Pago suma un mes a tu vencimiento
					actual.
				</p>
			{/if}

			{#if form?.message && !form?.success}
				<p class="ux-alert mt-4">{form.message}</p>
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
				{:else if mpReturn.subscriptionStatus === 'authorized' && !provisionalInForce}
					<p class="ux-alert ux-alert-success mt-4">
						Suscripción autorizada. Mercado Pago puede tardar hasta una hora en procesar el
						primer cobro; tu acceso se acredita solo. Podés actualizar esta página para verlo.
					</p>
				{:else if mpReturn.subscriptionStatus === 'authorized'}
					<p class="ux-alert ux-alert-success mt-4">
						Suscripción autorizada. Ya podés usar Cita Suite con el acceso provisorio de arriba.
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
				<p class="mt-4 text-sm font-semibold text-fg-55">¿Necesitás ayuda? Contactar soporte</p>
			{:else if data.mpSubscriptionUnavailable}
				<p class="ux-alert ux-alert-warning mt-5">
					No pudimos comprobar el estado de tu suscripción en Mercado Pago. Volvé a intentar en
					unos minutos antes de suscribirte o cancelar.
				</p>
			{:else if mpSub?.status === 'authorized' || mpSub?.status === 'paused'}
				<div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-copy-subtle">Estado</p>
						<p class="mt-2 font-bold text-fg">{mpSub.status === 'authorized' ? 'Activa' : 'Pausada'}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-copy-subtle">Monto mensual</p>
						<p class="mt-2 font-bold text-fg">{money(mpSub.transaction_amount)}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-copy-subtle">Próximo cobro</p>
						<p class="mt-2 font-bold text-fg">{formatDateTime(mpSub.next_charge_at, 'Programado por MP')}</p>
					</div>
					<div class="ux-soft-card p-4">
						<p class="text-sm font-bold text-copy-subtle">Pagador</p>
						<p class="mt-2 break-all font-bold text-fg">{mpSub.payer_email ?? 'Sin registrar'}</p>
					</div>
				</div>
				{#if mpSub.status === 'paused'}
					<p class="ux-alert ux-alert-warning mt-4">
						Esta suscripción está pausada en Mercado Pago y no genera cobros. Podés revisarla
						desde tu cuenta de Mercado Pago, o cancelarla acá y crear una nueva.
					</p>
				{/if}
				{#if lastChargeRejected}
					<p class="ux-alert ux-alert-warning mt-4">
						Mercado Pago no pudo cobrar la última cuota{mpSub.last_charge_at ? ` (${formatDateTime(mpSub.last_charge_at)})` : ''}.
						Va a reintentar durante unos días: revisá o cambiá tu medio de pago en tu cuenta de
						Mercado Pago para no perder el acceso.
					</p>
				{/if}
				{#if confirmingCancel}
					<form method="POST" action="?/cancel" class="mt-5" onsubmit={() => (mpSubmitting = true)}>
						<input type="hidden" name="preapproval_id" value={mpSub.preapproval_id} />
						<p class="ux-alert ux-alert-warning">
							¿Cancelar la suscripción? Mercado Pago no permite reactivarla: para volver a
							pagar hay que crear una nueva. El tiempo ya pagado sigue vigente hasta su
							vencimiento.
						</p>
						<div class="mt-4 flex flex-col gap-3 sm:flex-row">
							<button type="submit" disabled={mpSubmitting} class="ux-btn-secondary">
								{mpSubmitting ? 'Cancelando…' : 'Sí, cancelar la suscripción'}
							</button>
							<button type="button" disabled={mpSubmitting} class="ux-btn-primary" onclick={() => (confirmingCancel = false)}>
								No, mantenerla
							</button>
						</div>
					</form>
				{:else}
					<div class="mt-5">
						<button type="button" class="ux-btn-secondary" onclick={() => (confirmingCancel = true)}>
							Cancelar suscripción
						</button>
						<p class="mt-2 text-sm text-copy-subtle">
							Al cancelar no se generan más cobros; el tiempo ya pagado sigue vigente hasta su
							vencimiento.
						</p>
					</div>
				{/if}
			{:else if canActivateWithMp}
				{#if mpSub?.status === 'pending'}
					<p class="mt-4 text-sm text-fg-55">
						Hay una autorización pendiente sin completar{mpSub.payer_email ? ` para «${mpSub.payer_email}»` : ''}.
						En Mercado Pago sólo se puede confirmar entrando con esa cuenta; si vas a pagar con otra, escribí su
						correo abajo y activá de nuevo.
					</p>
				{:else if mpSub?.status === 'cancelled'}
					<p class="mt-4 text-sm text-fg-55">
						Tu suscripción anterior fue cancelada. Podés suscribirte de nuevo cuando quieras.
					</p>
				{/if}
				<form method="POST" action="?/subscribe" class="mt-5" onsubmit={() => (mpSubmitting = true)} aria-busy={mpSubmitting}>
					<label class="block max-w-md">
						<span class="ux-label">Correo de tu cuenta de Mercado Pago</span>
						<input
							name="payer_email"
							type="email"
							required
							autocomplete="email"
							placeholder="El correo con el que entrás a Mercado Pago"
							value={payerEmailValue}
							class="ux-input"
						/>
					</label>
					<p class="mt-2 max-w-xl text-sm text-copy-subtle">
						Escribí el correo con el que entrás a Mercado Pago para pagar; puede ser distinto del que usás en
						Cita Suite. Mercado Pago sólo deja pagar con ese correo. No se aceptan correos con «+».
					</p>
					<button type="submit" disabled={mpSubmitting} class="ux-btn-primary mt-4">
						{mpSubmitting ? 'Creando enlace seguro en Mercado Pago…' : 'Activar suscripción con Mercado Pago'}
					</button>
					{#if mpSubmitting}
						<p class="mt-2 text-sm font-semibold text-fg-60">
							Esto puede tardar unos segundos. No cierres esta ventana ni vuelvas a tocar el botón.
						</p>
					{:else}
						<p class="mt-2 text-sm text-copy-subtle">
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
				<p class="mt-2 text-sm text-fg-55">Cambios de acceso registrados.</p>
			</div>
		</div>

		<div class="mt-5 space-y-3">
			{#if data.grants === null}
				<p class="ux-alert ux-alert-warning">No pudimos cargar el historial. Volvé a intentar en unos minutos.</p>
			{:else if data.grants.length === 0}
				<p class="ux-empty">Sin movimientos registrados.</p>
			{:else}
				{#each data.grants as grant}
					<div class="ux-soft-card p-4">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="font-bold text-fg">{grantTitle(grant)}</p>
								<p class="mt-1 text-sm text-fg-55">
									{money(grant.amount)}
								</p>
							</div>
							<time class="text-sm font-bold text-copy-subtle">{formatDateTime(grant.created_at)}</time>
						</div>
						<div class="mt-3 grid gap-3 text-sm md:grid-cols-2">
							<p class="text-fg-55">Antes: <span class="font-bold text-fg">{formatDateTime(grant.paid_until_before)}</span></p>
							<p class="text-fg-55">Después: <span class="font-bold text-fg">{formatDateTime(grant.paid_until_after)}</span></p>
						</div>
						{#if grant.note}
							<p class="mt-3 text-sm text-fg-70">{grant.note}</p>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
