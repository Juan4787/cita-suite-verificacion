<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import { formatAccessRemaining, formatDateTime } from '$lib/utils/format';
	import { formatMoneyInteger } from '$lib/utils/money-input';

	let { data, form } = $props();

	type BusinessCard = {
		id: string;
		name: string;
		slug: string;
		timezone?: string | null;
		is_active: boolean;
		primaryOwnerEmail: string | null;
		owners: { email: string | null; role: string }[];
		members: { email: string | null; role: string }[];
		access: {
			commercialStatus: 'active' | 'grace' | 'restricted' | 'archived';
			visualStatus: 'permanent' | 'active' | 'expiring' | 'grace' | 'restricted' | 'archived';
			isPermanent: boolean;
			commercialAccessEnabled: boolean;
			paidUntil: string | null;
			graceUntil: string | null;
			restrictedUntil: string | null;
			archivedAt: string | null;
		};
		subscription: {
			access_source?: string | null;
			access_note?: string | null;
			last_payment_at?: string | null;
			last_payment_amount?: number | string | null;
			updated_at?: string | null;
		} | null;
		recentGrants: any[];
		mpSubscription: {
			preapproval_id: string;
			status: string;
			payer_email?: string | null;
			transaction_amount?: number | null;
			next_charge_at?: string | null;
			last_synced_at?: string | null;
		} | null;
	};

	type EmailRow = {
		id: string;
		email: string;
		enabled: boolean;
		onboarding_mode?: 'manual' | 'self_service' | null;
		note?: string | null;
	};

	type AssistanceRow = {
		id: string;
		businessId: string;
		businessName: string;
		businessSlug: string;
		requestedByEmail: string | null;
		startsAt: string;
		expiresAt: string;
	};

	type MasterFilter = 'all' | 'active' | 'attention';
	type DurationOption = { value: string; label: string; selectLabel: string };

	const durationOptions: DurationOption[] = [
		{ value: 'hour_1', label: '1 hora', selectLabel: '1 hora (60 minutos)' },
		{ value: 'day_1', label: '1 día', selectLabel: '1 día (24 horas)' },
		{ value: 'day_7', label: '7 días', selectLabel: '7 días' },
		...Array.from({ length: 12 }, (_, index) => ({
			value: `month_${index + 1}`,
			label: `${index + 1} mes${index === 0 ? '' : 'es'}`,
			selectLabel: `${index + 1} mes${index === 0 ? '' : 'es'} · ${(index + 1) * 30} días`
		})),
		{ value: 'permanent', label: 'acceso permanente', selectLabel: 'Permanente · sin vencimiento' }
	];
	const timedDurationOptions = durationOptions.filter((option) => option.value !== 'permanent');

	const operationLabels: Record<string, string> = {
		grant_access: 'Dar acceso',
		extend_access: 'Sumar acceso',
		reduce_access: 'Quitar tiempo',
		set_permanent: 'Hacer permanente',
		unset_permanent: 'Quitar permanencia',
		disable_business_access: 'Pausar acceso',
		enable_business_access: 'Reanudar acceso',
		archive_business: 'Archivar consultorio',
		reactivate_business: 'Reactivar consultorio',
		manual_correction: 'Corrección manual',
		payment_registered: 'Pago registrado',
		payment_cancelled: 'Pago cancelado',
		sessions_revoked: 'Sesiones cerradas'
	};

	let activeFilter = $state<MasterFilter>('all');
	let search = $state('');
	let showCreatePanel = $state(false);
	let showTools = $state(false);
	let expandedBusinessId = $state<string | null>(null);
	let durationSelections = $state<Record<string, string>>({});
	let confirmModal = $state<{
		formId: string;
		title: string;
		body: string;
		tone: 'danger' | 'warning' | 'normal';
		confirm: string;
	} | null>(null);
	let disableEmailTarget = $state<{ id: string; email: string } | null>(null);
	let disableReason = $state('');
	let mpReconciling = $state(false);

	const masterEmail = $derived(String(data.masterEmail ?? '').trim().toLowerCase());
	const isMasterEmailRow = (email?: string | null) => {
		const normalized = String(email ?? '').trim().toLowerCase();
		return Boolean(normalized && normalized === masterEmail);
	};
	const businesses = $derived(
		((data.businesses ?? []) as BusinessCard[]).filter(
			(business) =>
				!isMasterEmailRow(business.primaryOwnerEmail) &&
				!business.owners.some((owner) => isMasterEmailRow(owner.email))
		)
	);
	const emails = $derived(
		((data.emails ?? []) as EmailRow[]).filter((item) => !isMasterEmailRow(item.email))
	);
	const assistance = $derived((data.assistance ?? []) as AssistanceRow[]);

	const linkedEmails = $derived.by(() => {
		const linked = new Set<string>();
		for (const business of businesses) {
			if (business.primaryOwnerEmail) linked.add(business.primaryOwnerEmail.toLowerCase());
			for (const member of business.members) {
				if (member.email) linked.add(member.email.toLowerCase());
			}
		}
		return linked;
	});

	const needsAttention = (business: BusinessCard) =>
		!business.access.commercialAccessEnabled ||
		business.access.visualStatus === 'expiring' ||
		business.access.commercialStatus !== 'active' ||
		business.mpSubscription?.status === 'paused' ||
		business.mpSubscription?.status === 'pending';

	const activeBusinessesCount = $derived(businesses.filter((business) => !needsAttention(business)).length);
	const attentionBusinessesCount = $derived(businesses.filter(needsAttention).length);

	const filteredBusinesses = $derived.by(() => {
		const normalized = search.trim().toLowerCase();
		return businesses.filter((business) => {
			if (activeFilter === 'active' && needsAttention(business)) return false;
			if (activeFilter === 'attention' && !needsAttention(business)) return false;
			if (!normalized) return true;
			return [
				business.name,
				business.slug,
				business.primaryOwnerEmail ?? '',
				...business.members.map((member) => member.email ?? '')
			]
				.join(' ')
				.toLowerCase()
				.includes(normalized);
		});
	});

	const businessTimeZone = (business: BusinessCard) =>
		business.timezone || 'America/Argentina/Buenos_Aires';
	const dateTime = (value?: string | null, timeZone?: string | null) =>
		value ? formatDateTime(value, timeZone || 'America/Argentina/Buenos_Aires') : 'Sin fecha';
	const money = (value?: number | string | null) => {
		if (value === null || value === undefined || value === '') return 'Sin monto';
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return String(value);
		return parsed.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
	};

	const statusLabel = (business: BusinessCard) => {
		if (!business.access.commercialAccessEnabled) return 'Pausado';
		if (business.access.visualStatus === 'permanent') return 'Permanente';
		if (business.access.visualStatus === 'expiring') return 'Por vencer';
		if (business.access.commercialStatus === 'active') return 'Activo';
		if (business.access.commercialStatus === 'grace') return 'Vencido';
		if (business.access.commercialStatus === 'restricted') return 'Restringido';
		return 'Archivado';
	};

	const statusClass = (business: BusinessCard) => {
		if (!business.access.commercialAccessEnabled) return 'ux-badge ux-badge-danger';
		if (business.access.visualStatus === 'permanent') return 'ux-badge ux-badge-success';
		if (business.access.visualStatus === 'expiring') return 'ux-badge ux-badge-warning';
		if (business.access.commercialStatus === 'active') return 'ux-badge ux-badge-success';
		if (business.access.commercialStatus === 'grace') return 'ux-badge ux-badge-warning';
		return 'ux-badge ux-badge-danger';
	};

	const accessSummary = (business: BusinessCard) => {
		if (!business.access.commercialAccessEnabled) return 'Acceso pausado manualmente';
		if (business.access.isPermanent) return 'Sin vencimiento';
		if (business.access.commercialStatus === 'archived') return 'Cuenta archivada';
		if (business.access.commercialStatus === 'restricted') return 'Sin acceso operativo';
		if (business.access.commercialStatus === 'grace') return 'En período de gracia';
		return formatAccessRemaining(business.access.paidUntil) ?? 'Activo';
	};

	const accessDetail = (business: BusinessCard) => {
		const timeZone = businessTimeZone(business);
		if (!business.access.commercialAccessEnabled) return 'Reanudalo desde las opciones avanzadas.';
		if (business.access.isPermanent) return 'No requiere renovaciones.';
		if (business.access.commercialStatus === 'archived') {
			return business.access.archivedAt
				? `Archivado el ${dateTime(business.access.archivedAt, timeZone)}`
				: 'Requiere reactivación.';
		}
		if (business.access.commercialStatus === 'restricted') {
			return business.access.restrictedUntil
				? `Se archiva el ${dateTime(business.access.restrictedUntil, timeZone)}`
				: 'Requiere un nuevo período de acceso.';
		}
		if (business.access.commercialStatus === 'grace') {
			return business.access.graceUntil
				? `Gracia hasta el ${dateTime(business.access.graceUntil, timeZone)}`
				: 'Requiere regularización.';
		}
		return business.access.paidUntil
			? `Vence el ${dateTime(business.access.paidUntil, timeZone)}`
			: 'Sin vencimiento registrado.';
	};

	const durationFor = (businessId: string) => durationSelections[businessId] ?? 'hour_1';
	const setDurationFor = (businessId: string, value: string) => {
		durationSelections = { ...durationSelections, [businessId]: value };
	};
	const durationLabel = (value: string) =>
		durationOptions.find((option) => option.value === value)?.label ?? value;
	const operationLabel = (value: string) => operationLabels[value] ?? value.replaceAll('_', ' ');

	const criticalOperation = (operation: string, duration: string) =>
		[
			'reduce_access',
			'set_permanent',
			'unset_permanent',
			'disable_business_access',
			'archive_business'
		].includes(operation) || duration === 'permanent';

	const beforeSubmit = (event: SubmitEvent, business: BusinessCard) => {
		const formEl = event.currentTarget as HTMLFormElement;
		if (formEl.dataset.confirmedSubmit === '1') {
			delete formEl.dataset.confirmedSubmit;
			return;
		}

		const formData = new FormData(formEl);
		const operation = String(formData.get('operation') ?? '');
		const duration = String(formData.get('duration') ?? '');
		const idempotency = formEl.querySelector<HTMLInputElement>('input[name="idempotency_key"]');
		if (idempotency) idempotency.value = crypto.randomUUID();

		if (!criticalOperation(operation, duration)) return;
		event.preventDefault();

		const includesDuration = ['reduce_access', 'reactivate_business'].includes(operation);
		const durationText = includesDuration && duration ? ` (${durationLabel(duration)})` : '';
		const isDanger = ['disable_business_access', 'archive_business'].includes(operation);
		confirmModal = {
			formId: formEl.id,
			title: operationLabel(operation),
			body: `${operationLabel(operation)} para ${business.name}${durationText}.`,
			tone: isDanger ? 'danger' : 'warning',
			confirm: isDanger ? 'Sí, continuar' : 'Confirmar cambio'
		};
	};

	const confirmSubmit = () => {
		if (!confirmModal) return;
		const formEl = document.getElementById(confirmModal.formId) as HTMLFormElement | null;
		confirmModal = null;
		if (!formEl) return;
		formEl.dataset.confirmedSubmit = '1';
		formEl.requestSubmit();
	};

	const beforeSessionsSubmit = (event: SubmitEvent, business: BusinessCard) => {
		const formEl = event.currentTarget as HTMLFormElement;
		if (formEl.dataset.confirmedSubmit === '1') {
			delete formEl.dataset.confirmedSubmit;
			return;
		}
		event.preventDefault();
		confirmModal = {
			formId: formEl.id,
			title: 'Cerrar sesiones',
			body: `Todas las personas de ${business.name} deberán volver a iniciar sesión.`,
			tone: 'warning',
			confirm: 'Cerrar sesiones'
		};
	};

	const beforeMpCancelSubmit = (event: SubmitEvent, business: BusinessCard) => {
		const formEl = event.currentTarget as HTMLFormElement;
		if (formEl.dataset.confirmedSubmit === '1') {
			delete formEl.dataset.confirmedSubmit;
			return;
		}
		event.preventDefault();
		confirmModal = {
			formId: formEl.id,
			title: 'Cancelar cobro automático',
			body: `Mercado Pago dejará de cobrar a ${business.name}. El acceso ya otorgado conserva su vencimiento actual.`,
			tone: 'danger',
			confirm: 'Cancelar suscripción'
		};
	};

	const handleMoneyInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = formatMoneyInteger(input.value);
	};

	const MP_STATUS_LABELS: Record<string, string> = {
		authorized: 'Cobro automático activo',
		paused: 'Cobro pausado',
		pending: 'Cobro pendiente',
		cancelled: 'Cobro cancelado'
	};
	const mpStatusLabel = (status?: string | null) =>
		status ? MP_STATUS_LABELS[status] ?? `Mercado Pago: ${status}` : null;
	const mpStatusClass = (status?: string | null) => {
		if (status === 'authorized') return 'ux-badge ux-badge-success';
		if (status === 'paused' || status === 'pending') return 'ux-badge ux-badge-warning';
		return 'ux-badge';
	};
</script>

<section class="ux-page master-page">
	<header class="master-hero">
		<div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
			<div class="max-w-2xl">
				<p class="ux-badge">Panel maestro</p>
				<h1 class="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">Consultorios y accesos</h1>
				<p class="mt-3 max-w-xl text-base leading-relaxed text-white/60">
					Buscá una cuenta, revisá su vencimiento y cambiá el acceso. Las herramientas técnicas quedan apartadas.
				</p>
			</div>
			<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
				<button
					type="button"
					class="ux-btn-primary w-full sm:w-auto"
					onclick={() => {
						showCreatePanel = !showCreatePanel;
						if (showCreatePanel) showTools = false;
					}}
				>
					<svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<path d="M12 5v14M5 12h14" />
					</svg>
					{showCreatePanel ? 'Cerrar alta' : 'Nuevo consultorio'}
				</button>
				<button
					type="button"
					class="ux-btn-secondary w-full sm:w-auto"
					onclick={() => {
						showTools = !showTools;
						if (showTools) showCreatePanel = false;
					}}
				>
					{showTools ? 'Ocultar herramientas' : 'Herramientas'}
				</button>
			</div>
		</div>

		<div class="master-stats" aria-label="Resumen del panel">
			<div>
				<strong>{businesses.length}</strong>
				<span>Total</span>
			</div>
			<div>
				<strong>{activeBusinessesCount}</strong>
				<span>En orden</span>
			</div>
			<div class:has-attention={attentionBusinessesCount > 0}>
				<strong>{attentionBusinessesCount}</strong>
				<span>Por revisar</span>
			</div>
		</div>
	</header>

	{#if form?.message}
		<p class={form?.success === true ? 'ux-alert ux-alert-success' : 'ux-alert'} role="status">{form.message}</p>
	{/if}
	{#if data.loadError}
		<p class="ux-alert">{data.loadError}</p>
	{/if}

	{#if assistance.length > 0}
		<section id="solicitudes-ayuda" class="master-action-strip master-action-strip-help scroll-mt-28" aria-labelledby="assistance-title">
			<div class="master-action-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 3a7 7 0 0 0-4 12.7V19l3-1.5h1a7 7 0 1 0 0-14.5Z" />
					<path d="M9.7 9.3a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1.1.8-1.1 1.5M12 15.8h.01" />
				</svg>
			</div>
			<div class="min-w-0 flex-1">
				<h2 id="assistance-title" class="font-black text-white">
					{assistance.length === 1 ? '1 cuenta pidió ayuda' : `${assistance.length} cuentas pidieron ayuda`}
				</h2>
				<p class="mt-1 text-sm text-white/55">Sólo aparecen mientras el permiso de una hora sigue vigente.</p>
				<div class="mt-4 grid gap-3 lg:grid-cols-2">
					{#each assistance as item}
						<div class="ux-soft-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<p class="truncate font-black text-white">{item.businessName}</p>
								<p class="mt-1 truncate text-sm text-white/55">{item.requestedByEmail ?? 'Dueño del consultorio'}</p>
								<p class="mt-2 text-sm font-bold text-emerald-200">
									{formatAccessRemaining(item.expiresAt) ?? `Hasta ${dateTime(item.expiresAt)}`}
								</p>
							</div>
							<form method="post" action="?/enter_assisted_business" class="shrink-0">
								<input type="hidden" name="grant_id" value={item.id} />
								<input type="hidden" name="business_id" value={item.businessId} />
								<button class="ux-btn-primary w-full sm:w-auto">Abrir configuración</button>
							</form>
						</div>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	{#if (data.mpAttention ?? []).length > 0}
		<details class="master-action-strip master-action-strip-warning">
			<summary>
				<span><strong>{data.mpAttention.length}</strong> {data.mpAttention.length === 1 ? 'evento de Mercado Pago requiere revisión' : 'eventos de Mercado Pago requieren revisión'}</span>
				<span class="text-sm font-bold text-amber-100/70">Ver detalle</span>
			</summary>
			<div class="mt-4 space-y-3">
				{#each data.mpAttention as event}
					<div class="ux-soft-card p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<p class="font-bold text-white">{event.businessName ?? 'Evento global'}</p>
							<time class="text-sm text-white/45">{dateTime(event.received_at)}</time>
						</div>
						<p class="mt-2 text-sm text-white/65">{event.processing_detail}</p>
					</div>
				{/each}
			</div>
		</details>
	{/if}

	{#if showCreatePanel}
		<section class="ux-card master-reveal" aria-labelledby="create-business-title">
			<div class="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
				<div>
					<p class="ux-badge">Alta guiada</p>
					<h2 id="create-business-title" class="mt-4 text-2xl font-black text-white">Nuevo consultorio</h2>
					<p class="mt-3 text-sm leading-relaxed text-white/55">
						Creá el consultorio y definí su primer período de acceso en un solo paso. Si el dueño todavía no tiene cuenta, quedará invitado.
					</p>
				</div>
				<form method="post" action="?/create_business" class="grid gap-4 sm:grid-cols-2">
					<label>
						<span class="ux-label">Nombre del consultorio</span>
						<input name="name" required class="ux-input" placeholder="Ej. Clínica Central" />
					</label>
					<label>
						<span class="ux-label">Email del dueño</span>
						<input name="owner_email" type="email" required class="ux-input" placeholder="nombre@consultorio.com" />
					</label>
					<label>
						<span class="ux-label">Acceso inicial</span>
						<select name="duration" required class="ux-select">
							<option value="" disabled selected>Elegí una duración</option>
							{#each durationOptions as option}
								<option value={option.value}>{option.selectLabel}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="ux-label">Nota interna <span class="font-normal text-white/35">(opcional)</span></span>
						<input name="note" class="ux-input" placeholder="Motivo del alta" />
					</label>
					<p class="sm:col-span-2 rounded-2xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100/80">
						“1 hora” son exactamente 60 minutos. El vencimiento se mostrará con hora y minutos, sin redondearlo a días.
					</p>
					<button class="ux-btn-primary sm:col-span-2">Crear consultorio y dar acceso</button>
				</form>
			</div>
		</section>
	{/if}

	{#if showTools}
		<section class="ux-card master-reveal" aria-labelledby="tools-title">
			<div>
				<p class="ux-badge">Uso ocasional</p>
				<h2 id="tools-title" class="mt-4 text-2xl font-black text-white">Herramientas administrativas</h2>
				<p class="mt-2 text-sm text-white/55">Se mantienen fuera del flujo diario para que no compitan con la gestión de accesos.</p>
			</div>

			<div class="mt-6 grid gap-4 lg:grid-cols-2">
				<div class="ux-soft-card p-5">
					<h3 class="font-black text-white">Mercado Pago</h3>
					<p class="mt-2 text-sm leading-relaxed text-white/55">
						La conciliación automática corre aproximadamente cada 6 horas. Forzala sólo si un pago no aparece.
					</p>
					<form method="post" action="?/mp_reconcile_now" class="mt-4" onsubmit={() => (mpReconciling = true)}>
						<button class="ux-btn-secondary" disabled={mpReconciling}>
							{mpReconciling ? 'Conciliando…' : 'Conciliar ahora'}
						</button>
					</form>
				</div>

				<div class="ux-soft-card p-5">
					<h3 class="font-black text-white">Referencias de email (legacy)</h3>
					<p class="mt-2 text-sm leading-relaxed text-white/55">
						Esta lista sirve para rastrear altas manuales antiguas. <strong class="text-white/80">No define la duración del acceso</strong> de un consultorio.
					</p>
					<form method="post" action="?/add_email" class="mt-4 grid gap-3">
						<input name="email" type="email" required class="ux-input" placeholder="email@consultorio.com" aria-label="Email de referencia" />
						<input type="hidden" name="onboarding_mode" value="manual" />
						<input name="note" class="ux-input" placeholder="Nota interna opcional" aria-label="Nota del email" />
						<button class="ux-btn-secondary">Guardar referencia</button>
					</form>
				</div>
			</div>

			<div class="mt-4 max-h-96 space-y-2 overflow-auto pr-1">
				{#if emails.length === 0}
					<p class="ux-empty">No hay referencias de email.</p>
				{:else}
					{#each emails as item}
						<div class="master-email-row">
							<div class="min-w-0">
								<p class="truncate text-sm font-bold text-white">{item.email}</p>
								<div class="mt-2 flex flex-wrap gap-2">
									<span class={item.enabled ? 'ux-badge ux-badge-success' : 'ux-badge'}>{item.enabled ? 'Referencia activa' : 'Referencia inactiva'}</span>
									<span class="ux-badge">{linkedEmails.has(item.email.toLowerCase()) ? 'Con consultorio' : 'Sin consultorio'}</span>
								</div>
								{#if item.note}<p class="mt-2 text-sm text-white/45">{item.note}</p>{/if}
							</div>
							{#if item.enabled}
								<button
									type="button"
									class="ux-btn-secondary px-3 py-2 text-xs"
									onclick={() => {
										disableEmailTarget = item;
										disableReason = '';
									}}
								>
									Desactivar referencia
								</button>
							{:else}
								<form method="post" action="?/toggle_email">
									<input type="hidden" name="id" value={item.id} />
									<input type="hidden" name="enabled" value="true" />
									<button class="ux-btn-secondary px-3 py-2 text-xs">Restaurar referencia</button>
								</form>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</section>
	{/if}

	<section class="ux-card master-directory" aria-labelledby="businesses-title">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<h2 id="businesses-title" class="text-xl font-black text-white">Consultorios</h2>
				<p class="mt-1 text-sm text-white/50">El acceso se administra por consultorio, no por dirección de email.</p>
			</div>
			<span class="text-sm font-bold text-white/45">{filteredBusinesses.length} resultados</span>
		</div>

		<div class="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
			<label class="master-search">
				<span class="sr-only">Buscar consultorio</span>
				<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<circle cx="11" cy="11" r="7" />
					<path d="m20 20-3.5-3.5" />
				</svg>
				<input id="master-search" class="ux-input" placeholder="Buscar por consultorio o email…" bind:value={search} />
			</label>
			<div class="master-filter" aria-label="Filtrar consultorios">
				<button type="button" class:active={activeFilter === 'all'} onclick={() => (activeFilter = 'all')}>Todos <span>{businesses.length}</span></button>
				<button type="button" class:active={activeFilter === 'active'} onclick={() => (activeFilter = 'active')}>En orden <span>{activeBusinessesCount}</span></button>
				<button type="button" class:active={activeFilter === 'attention'} onclick={() => (activeFilter = 'attention')}>Revisar <span>{attentionBusinessesCount}</span></button>
			</div>
		</div>
	</section>

	<div class="master-business-list">
		{#if filteredBusinesses.length === 0}
			<div class="ux-empty">
				<p class="font-bold text-white">No encontramos consultorios</p>
				<p class="text-sm">Probá otra búsqueda o cambiá el filtro.</p>
			</div>
		{/if}

		{#each filteredBusinesses as business}
			<article class:expanded={expandedBusinessId === business.id} class="master-business-card">
				<div class="master-business-head">
					<div class="master-business-identity">
						<div class="master-business-avatar" aria-hidden="true">{business.name.trim().charAt(0).toUpperCase() || 'C'}</div>
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="truncate text-lg font-black text-white">{business.name}</h3>
								<span class={statusClass(business)}>{statusLabel(business)}</span>
								{#if business.mpSubscription}
									<span class={mpStatusClass(business.mpSubscription.status)}>{mpStatusLabel(business.mpSubscription.status)}</span>
								{/if}
							</div>
							<p class="mt-2 truncate text-sm text-white/55">{business.primaryOwnerEmail ?? 'Sin dueño vinculado'}</p>
							<p class="mt-1 text-xs font-bold text-white/30">/{business.slug}</p>
						</div>
					</div>

					<div class="master-access-summary">
						<p class="font-black text-white">{accessSummary(business)}</p>
						<p class="mt-1 text-sm text-white/50">{accessDetail(business)}</p>
					</div>

					<button
						type="button"
						class="ux-btn-secondary master-manage-button"
						aria-expanded={expandedBusinessId === business.id}
						onclick={() => {
							expandedBusinessId = expandedBusinessId === business.id ? null : business.id;
						}}
					>
						{expandedBusinessId === business.id ? 'Cerrar' : 'Gestionar'}
						<svg aria-hidden="true" class:rotate-180={expandedBusinessId === business.id} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="m6 9 6 6 6-6" />
						</svg>
					</button>
				</div>

				{#if expandedBusinessId === business.id}
					<div class="master-management">
						<section class="master-primary-action" aria-labelledby={`grant-title-${business.id}`}>
							<div>
								<p class="text-xs font-black uppercase tracking-[0.14em] text-violet-200/70">Acción principal</p>
								<h4 id={`grant-title-${business.id}`} class="mt-2 text-xl font-black text-white">Dar más acceso</h4>
								<p class="mt-2 max-w-xl text-sm leading-relaxed text-white/55">
									Si el acceso sigue vigente, el tiempo se suma al vencimiento actual. Si ya venció, empieza ahora.
								</p>
							</div>

							<form
								id={`business-access-${business.id}`}
								method="post"
								action="?/adjust_business_access"
								class="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end"
								onsubmit={(event) => beforeSubmit(event, business)}
							>
								<input type="hidden" name="business_id" value={business.id} />
								<input type="hidden" name="operation" value="extend_access" />
								<input type="hidden" name="idempotency_key" value="" />
								<label>
									<span class="ux-label">Tiempo exacto a sumar</span>
									<select
										name="duration"
										class="ux-select"
										value={durationFor(business.id)}
										onchange={(event) => setDurationFor(business.id, (event.currentTarget as HTMLSelectElement).value)}
									>
										{#each timedDurationOptions as option}
											<option value={option.value}>{option.selectLabel}</option>
										{/each}
									</select>
								</label>
								<button class="ux-btn-primary lg:min-w-48">Sumar {durationLabel(durationFor(business.id))}</button>

								<details class="master-optional lg:col-span-2">
									<summary>Agregar monto o nota <span>(opcional)</span></summary>
									<div class="mt-3 grid gap-3 sm:grid-cols-2">
										<input name="amount" type="text" inputmode="numeric" class="ux-input" placeholder="Monto opcional" oninput={handleMoneyInput} />
										<input name="note" class="ux-input" placeholder="Nota interna opcional" />
									</div>
								</details>
							</form>

							<div class="master-duration-proof">
								<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
								</svg>
								<p><strong>{durationLabel(durationFor(business.id))}</strong> se mostrará con vencimiento exacto en horas y minutos.</p>
							</div>
						</section>

						<details class="master-advanced">
							<summary>
								<span>
									<strong>Opciones avanzadas</strong>
									<small>Pausar, quitar tiempo, permanencia y seguridad</small>
								</span>
								<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
							</summary>

							<div class="master-advanced-grid">
								<div class="master-advanced-group">
									<h5>Estado del acceso</h5>
									<p>Pausa o reanuda la cuenta sin modificar su vencimiento.</p>
									<div class="mt-4 grid gap-2">
										<form id={`business-toggle-${business.id}`} method="post" action="?/adjust_business_access" onsubmit={(event) => beforeSubmit(event, business)}>
											<input type="hidden" name="business_id" value={business.id} />
											<input type="hidden" name="operation" value={business.access.commercialAccessEnabled ? 'disable_business_access' : 'enable_business_access'} />
											<input type="hidden" name="idempotency_key" value="" />
											<button class={business.access.commercialAccessEnabled ? 'ux-btn-danger w-full' : 'ux-btn-secondary w-full'}>
												{business.access.commercialAccessEnabled ? 'Pausar acceso' : 'Reanudar acceso'}
											</button>
										</form>

										<form id={`business-permanent-${business.id}`} method="post" action="?/adjust_business_access" onsubmit={(event) => beforeSubmit(event, business)}>
											<input type="hidden" name="business_id" value={business.id} />
											<input type="hidden" name="operation" value={business.access.isPermanent ? 'unset_permanent' : 'set_permanent'} />
											{#if !business.access.isPermanent}<input type="hidden" name="duration" value="permanent" />{/if}
											<input type="hidden" name="idempotency_key" value="" />
											<button class="ux-btn-secondary w-full">{business.access.isPermanent ? 'Quitar permanencia' : 'Hacer permanente'}</button>
										</form>
									</div>
								</div>

								<div class="master-advanced-group">
									<h5>Quitar tiempo</h5>
									<p>Reduce el vencimiento actual. Siempre pide confirmación.</p>
									<form id={`business-reduce-${business.id}`} method="post" action="?/adjust_business_access" class="mt-4 grid gap-2" onsubmit={(event) => beforeSubmit(event, business)}>
										<input type="hidden" name="business_id" value={business.id} />
										<input type="hidden" name="operation" value="reduce_access" />
										<input type="hidden" name="idempotency_key" value="" />
										<select name="duration" class="ux-select" aria-label="Tiempo a quitar">
											{#each timedDurationOptions as option}<option value={option.value}>{option.selectLabel}</option>{/each}
										</select>
										<button class="ux-btn-secondary">Quitar tiempo</button>
									</form>
								</div>

								<div class="master-advanced-group">
									<h5>Seguridad y archivo</h5>
									<p>Acciones excepcionales que pueden interrumpir el trabajo.</p>
									<div class="mt-4 grid gap-2">
										<form id={`business-sessions-${business.id}`} method="post" action="?/revoke_business_sessions" onsubmit={(event) => beforeSessionsSubmit(event, business)}>
											<input type="hidden" name="business_id" value={business.id} />
											<button class="ux-btn-secondary w-full">Cerrar todas las sesiones</button>
										</form>
										{#if business.access.commercialStatus !== 'archived'}
											<form id={`business-archive-${business.id}`} method="post" action="?/adjust_business_access" onsubmit={(event) => beforeSubmit(event, business)}>
												<input type="hidden" name="business_id" value={business.id} />
												<input type="hidden" name="operation" value="archive_business" />
												<input type="hidden" name="idempotency_key" value="" />
												<button class="ux-btn-danger w-full">Archivar consultorio</button>
											</form>
										{/if}
										{#if business.mpSubscription && (business.mpSubscription.status === 'authorized' || business.mpSubscription.status === 'paused')}
											<form id={`business-mp-cancel-${business.id}`} method="post" action="?/mp_cancel_subscription" onsubmit={(event) => beforeMpCancelSubmit(event, business)}>
												<input type="hidden" name="business_id" value={business.id} />
												<input type="hidden" name="preapproval_id" value={business.mpSubscription.preapproval_id} />
												<button class="ux-btn-danger w-full">Cancelar cobro automático</button>
											</form>
										{/if}
									</div>
								</div>
							</div>

							<details class="master-history">
								<summary>Ver historial de cambios</summary>
								<div class="mt-3 space-y-2">
									{#if business.recentGrants.length === 0}
										<p class="ux-empty">Sin movimientos registrados.</p>
									{:else}
										{#each business.recentGrants as grant}
											<div class="master-history-row">
												<div>
													<p class="font-bold text-white">{operationLabel(grant.operation)}</p>
													<p class="mt-1 text-sm text-white/45">{grant.admin_email ?? 'Sistema'} · {money(grant.amount)}</p>
													{#if grant.note}<p class="mt-1 text-sm text-white/60">{grant.note}</p>{/if}
												</div>
												<time class="shrink-0 text-sm text-white/40">{dateTime(grant.created_at, businessTimeZone(business))}</time>
											</div>
										{/each}
									{/if}
								</div>
							</details>
						</details>
					</div>
				{/if}
			</article>
		{/each}
	</div>
</section>

<Modal open={Boolean(disableEmailTarget)} title="Desactivar referencia" on:close={() => (disableEmailTarget = null)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>
			Vas a desactivar la referencia de <span class="font-semibold">{disableEmailTarget?.email ?? ''}</span>.
			Esto no cambia por sí solo la duración comercial del consultorio.
		</p>
		<input class="ux-input" placeholder="Motivo interno opcional" bind:value={disableReason} />
		<div class="flex justify-end gap-3">
			<button class="ux-btn-secondary" type="button" onclick={() => (disableEmailTarget = null)}>Cancelar</button>
			<form method="post" action="?/toggle_email">
				<input type="hidden" name="id" value={disableEmailTarget?.id ?? ''} />
				<input type="hidden" name="enabled" value="false" />
				<input type="hidden" name="reason" value={disableReason} />
				<button class="ux-btn-danger">Desactivar</button>
			</form>
		</div>
	</div>
</Modal>

<Modal open={Boolean(confirmModal)} title={confirmModal?.title ?? 'Confirmar'} on:close={() => (confirmModal = null)} dismissible>
	<div class="space-y-4 text-sm text-neutral-800 dark:text-neutral-100">
		<p>{confirmModal?.body}</p>
		{#if confirmModal?.tone === 'danger'}
			<p class="ux-alert">Esta acción puede cortar el acceso operativo. Revisá antes de confirmar.</p>
		{:else if confirmModal?.tone === 'warning'}
			<p class="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-amber-100">
				Este cambio modifica la licencia comercial del consultorio.
			</p>
		{/if}
		<div class="flex justify-end gap-3">
			<button class="ux-btn-secondary" type="button" onclick={() => (confirmModal = null)}>Cancelar</button>
			<button class={confirmModal?.tone === 'danger' ? 'ux-btn-danger' : 'ux-btn-primary'} type="button" onclick={confirmSubmit}>
				{confirmModal?.confirm ?? 'Confirmar'}
			</button>
		</div>
	</div>
</Modal>

<style>
	.master-page {
		gap: 1rem;
	}

	.master-hero {
		position: relative;
		overflow: hidden;
		border: 1px solid rgba(139, 92, 246, 0.38);
		border-radius: var(--radius-xl);
		background:
			radial-gradient(circle at 85% 0%, rgba(139, 92, 246, 0.2), transparent 22rem),
			linear-gradient(145deg, #101f36 0%, #09182a 70%);
		padding: 1.35rem;
		box-shadow: var(--shadow);
	}

	.master-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin-top: 1.4rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 1rem;
	}

	.master-stats div {
		display: flex;
		min-width: 0;
		align-items: baseline;
		gap: 0.45rem;
		color: var(--text-muted);
	}

	.master-stats strong {
		color: white;
		font-size: 1.35rem;
		line-height: 1;
	}

	.master-stats span {
		overflow: hidden;
		font-size: 0.78rem;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.master-stats .has-attention strong {
		color: var(--warning-text);
	}

	.master-action-strip {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: rgba(255, 255, 255, 0.035);
		padding: 1rem;
	}

	.master-action-strip-help {
		display: flex;
		align-items: flex-start;
		gap: 0.9rem;
		border-color: rgba(52, 211, 153, 0.26);
		background: rgba(52, 211, 153, 0.065);
	}

	.master-action-strip-warning {
		border-color: rgba(251, 191, 36, 0.3);
		background: rgba(251, 191, 36, 0.07);
	}

	.master-action-strip-warning > summary {
		display: flex;
		min-height: var(--tap);
		cursor: pointer;
		list-style: none;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		color: var(--warning-text);
	}

	.master-action-strip-warning > summary::-webkit-details-marker,
	.master-advanced > summary::-webkit-details-marker,
	.master-optional > summary::-webkit-details-marker,
	.master-history > summary::-webkit-details-marker {
		display: none;
	}

	.master-action-icon {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.9rem;
		background: rgba(52, 211, 153, 0.14);
		color: var(--success-text);
	}

	.master-action-icon svg {
		width: 1.35rem;
		height: 1.35rem;
	}

	.master-reveal {
		animation: master-reveal 180ms ease-out;
	}

	@keyframes master-reveal {
		from { opacity: 0; transform: translateY(-0.35rem); }
		to { opacity: 1; transform: translateY(0); }
	}

	.master-email-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: rgba(255, 255, 255, 0.025);
		padding: 0.9rem;
	}

	.master-directory {
		padding-bottom: 1.1rem;
	}

	.master-search {
		position: relative;
		display: block;
	}

	.master-search svg {
		position: absolute;
		top: 50%;
		left: 1rem;
		z-index: 1;
		width: 1.15rem;
		height: 1.15rem;
		transform: translateY(-50%);
		color: var(--text-subtle);
		pointer-events: none;
	}

	.master-search :global(.ux-input) {
		padding-left: 2.8rem;
	}

	.master-filter {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: rgba(255, 255, 255, 0.025);
		padding: 0.25rem;
	}

	.master-filter button {
		display: inline-flex;
		min-height: calc(var(--tap) - 0.1rem);
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		border-radius: 0.75rem;
		padding: 0.55rem 0.75rem;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 800;
		transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
	}

	.master-filter button span {
		color: var(--text-subtle);
		font-size: 0.72rem;
	}

	.master-filter button.active {
		background: var(--accent-strong);
		color: white;
		box-shadow: 0 8px 20px rgba(124, 58, 237, 0.22);
	}

	.master-filter button.active span {
		color: rgba(255, 255, 255, 0.72);
	}

	.master-business-list {
		display: grid;
		gap: 0.75rem;
	}

	.master-business-card {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: linear-gradient(145deg, rgba(15, 34, 56, 0.94), rgba(8, 24, 41, 0.96));
		box-shadow: var(--shadow-sm);
		transition: border-color 160ms ease, box-shadow 160ms ease;
	}

	.master-business-card:hover,
	.master-business-card.expanded {
		border-color: rgba(139, 92, 246, 0.42);
	}

	.master-business-card.expanded {
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
	}

	.master-business-head {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(15rem, 0.85fr) auto;
		align-items: center;
		gap: 1.25rem;
		padding: 1rem;
	}

	.master-business-identity {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.9rem;
	}

	.master-business-avatar {
		display: grid;
		width: 2.8rem;
		height: 2.8rem;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid rgba(139, 92, 246, 0.32);
		border-radius: 0.9rem;
		background: var(--accent-soft);
		color: var(--accent-text);
		font-size: 1.05rem;
		font-weight: 900;
	}

	.master-access-summary {
		min-width: 0;
		border-left: 1px solid var(--border);
		padding-left: 1.25rem;
	}

	.master-manage-button svg {
		width: 1rem;
		height: 1rem;
		transition: transform 150ms ease;
	}

	.master-management {
		border-top: 1px solid var(--border);
		background: rgba(3, 13, 24, 0.34);
		padding: 1rem;
	}

	.master-primary-action {
		border: 1px solid rgba(139, 92, 246, 0.28);
		border-radius: var(--radius-lg);
		background: rgba(124, 58, 237, 0.075);
		padding: 1rem;
	}

	.master-duration-proof {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-top: 0.9rem;
		border-radius: 0.8rem;
		background: rgba(52, 211, 153, 0.08);
		padding: 0.7rem 0.85rem;
		color: var(--success-text);
		font-size: 0.78rem;
	}

	.master-duration-proof svg {
		width: 1.05rem;
		height: 1.05rem;
		flex: 0 0 auto;
	}

	.master-optional {
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding-top: 0.75rem;
	}

	.master-optional > summary,
	.master-history > summary {
		width: fit-content;
		cursor: pointer;
		list-style: none;
		color: var(--accent-text);
		font-size: 0.82rem;
		font-weight: 800;
	}

	.master-optional > summary span {
		color: var(--text-subtle);
		font-weight: 600;
	}

	.master-advanced {
		margin-top: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: rgba(255, 255, 255, 0.018);
	}

	.master-advanced > summary {
		display: flex;
		min-height: 4.2rem;
		cursor: pointer;
		list-style: none;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 1rem;
	}

	.master-advanced > summary span {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: white;
	}

	.master-advanced > summary small {
		color: var(--text-subtle);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.master-advanced > summary svg {
		width: 1.1rem;
		height: 1.1rem;
		color: var(--text-muted);
		transition: transform 150ms ease;
	}

	.master-advanced[open] > summary svg {
		transform: rotate(180deg);
	}

	.master-advanced-grid {
		display: grid;
		gap: 0.75rem;
		border-top: 1px solid var(--border);
		padding: 1rem;
	}

	.master-advanced-group {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: rgba(255, 255, 255, 0.025);
		padding: 0.9rem;
	}

	.master-advanced-group h5 {
		color: white;
		font-weight: 900;
	}

	.master-advanced-group > p {
		margin-top: 0.35rem;
		color: var(--text-subtle);
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.master-history {
		border-top: 1px solid var(--border);
		padding: 1rem;
	}

	.master-history-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.85rem;
		background: rgba(255, 255, 255, 0.025);
		padding: 0.8rem;
	}

	@media (min-width: 640px) {
		.master-hero { padding: 1.75rem; }
		.master-stats { max-width: 30rem; gap: 1.25rem; }
		.master-action-strip { padding: 1.25rem; }
		.master-business-head,
		.master-management { padding: 1.25rem; }
		.master-primary-action { padding: 1.25rem; }
	}

	@media (min-width: 1024px) {
		.master-advanced-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	}

	@media (max-width: 900px) {
		.master-business-head {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.master-access-summary {
			grid-column: 1 / -1;
			grid-row: 2;
			border-top: 1px solid var(--border);
			border-left: 0;
			padding-top: 0.9rem;
			padding-left: 0;
		}
	}

	@media (max-width: 560px) {
		.master-stats div { flex-direction: column; gap: 0.2rem; }
		.master-business-head { grid-template-columns: minmax(0, 1fr); gap: 0.9rem; }
		.master-manage-button { width: 100%; }
		.master-access-summary { grid-row: auto; }
		.master-filter button { padding-inline: 0.35rem; font-size: 0.75rem; }
		.master-email-row,
		.master-history-row { flex-direction: column; }
	}
</style>
