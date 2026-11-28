<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDepositAmount } from '$lib/scheduling/deposits';
	import { buildDepositRuleExamples } from '$lib/scheduling/deposit-examples';
	import { classifyUserAgent, refineDeviceClass, whatsappHrefFor, type DeviceClass } from '$lib/device';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	type FormValues = {
		enabled: boolean;
		autoCancelEnabled: boolean;
		amountMode: 'fixed' | 'percentage';
		fixedAmount: string;
		percentage: string;
		requestDays: string;
		deadlineHours: string;
		minPaymentHours: string;
		lateBookingPaymentHours: string;
		expiringReminderHours?: string;
		depositCreditCutoffHours?: string;
		transferDetails: string;
		appliesToManual: boolean;
		excludedServiceIds: string[];
	};

	let { data, form }: {
		data: PageData;
		form?: { success?: boolean; message?: string; errors?: Partial<Record<string, string>>; values?: FormValues };
	} = $props();

	// What the person wrote when a save was refused; otherwise the saved policy.
	// svelte-ignore state_referenced_locally
	const initial: FormValues = form?.values ?? {
		enabled: data.policy.enabled,
		autoCancelEnabled: data.policy.autoCancelEnabled,
		amountMode: data.policy.amountMode,
		fixedAmount: data.policy.fixedAmount === null ? '' : String(data.policy.fixedAmount),
		percentage: data.policy.percentage === null ? '' : String(data.policy.percentage).replace('.', ','),
		requestDays: String(data.policy.requestDays),
		deadlineHours: String(data.policy.deadlineHours),
		minPaymentHours: String(data.policy.minPaymentHours),
		lateBookingPaymentHours:
			data.policy.lateBookingPaymentHours === null || data.policy.lateBookingPaymentHours === undefined
				? ''
				: String(data.policy.lateBookingPaymentHours),
		expiringReminderHours:
			data.policy.expiringReminderHours === null
				? ''
				: String(data.policy.expiringReminderHours ?? 24),
		depositCreditCutoffHours:
			data.policy.depositCreditCutoffHours === null || data.policy.depositCreditCutoffHours === undefined
				? ''
				: String(data.policy.depositCreditCutoffHours),
		transferDetails: data.policy.transferDetails ?? '',
		appliesToManual: data.policy.appliesToManual,
		excludedServiceIds: data.policy.excludedServiceIds
	};
	let enabled = $state(initial.enabled);
	let autoCancelEnabled = $state(initial.autoCancelEnabled);
	let amountMode = $state<'fixed' | 'percentage'>(initial.amountMode);
	let fixedAmount = $state(initial.fixedAmount);
	// Kept while the other form is chosen: switching back and forth never loses what was written.
	let percentage = $state(initial.percentage);
	let deadlineHours = $state(initial.deadlineHours);
	let minPaymentHours = $state(initial.minPaymentHours);
	let lateBookingPaymentHours = $state(initial.lateBookingPaymentHours ?? '');
	let expiringReminderHours = $state(initial.expiringReminderHours ?? '24');
	let depositCreditCutoffHours = $state(initial.depositCreditCutoffHours ?? '');
	let excluded = $state<string[]>([...initial.excludedServiceIds]);
	let refinedDevice = $state<DeviceClass | null>(null);
	onMount(() => {
		refinedDevice = refineDeviceClass(data.device ?? classifyUserAgent(navigator.userAgent), navigator);
	});
	const device = $derived(refinedDevice ?? data.device ?? 'unknown');
	const canSave = $derived(!data.demo);
	const errors = $derived(form?.errors ?? {});

	const parseHoursInRange = (raw: string | undefined, min: number, max: number, fallback: number): number => {
		const trimmed = String(raw ?? '').trim();
		if (!/^\d{1,4}$/.test(trimmed)) return fallback;
		const parsed = Number(trimmed);
		return parsed >= min && parsed <= max ? parsed : fallback;
	};
	const parseOptionalHoursInRange = (raw: string | undefined, min: number, max: number): number | null => {
		const trimmed = String(raw ?? '').trim();
		if (!trimmed) return null;
		if (!/^\d{1,4}$/.test(trimmed)) return null;
		const parsed = Number(trimmed);
		return parsed >= min && parsed <= max ? parsed : null;
	};

	const ruleExamples = $derived(
		buildDepositRuleExamples({
			enabled,
			autoCancelEnabled,
			deadlineHours: parseHoursInRange(deadlineHours, 1, 720, data.policy.deadlineHours),
			minPaymentHours: parseHoursInRange(minPaymentHours, 0, 168, data.policy.minPaymentHours),
			lateBookingPaymentHours: parseOptionalHoursInRange(lateBookingPaymentHours, 1, 168),
			timezone: data.timezone ?? 'America/Argentina/Buenos_Aires'
		})
	);
	const supportWhatsAppHref = $derived(
		data.supportWhatsApp
			? whatsappHrefFor(device, data.supportWhatsApp.whatsappUrl, data.supportWhatsApp.whatsappWebUrl)
			: null
	);

	// With a percentage, a service without a fee for every professional asks the fixed amount, or nothing
	// when there is none (plan, section 4.3).
	const withoutFee = $derived(
		amountMode === 'percentage'
			? data.services.filter((service) => service.fee !== 'all' && !excluded.includes(service.id))
			: []
	);
	const fixedFallback = $derived(/^(\d{1,3}(\.\d{3})+|\d+)$/.test(fixedAmount.trim()));
	const toggleExcluded = (id: string, checked: boolean) => {
		excluded = checked ? [...new Set([...excluded, id])] : excluded.filter((value) => value !== id);
	};
</script>

<section class="ux-page mx-auto w-full max-w-5xl">
	<header>
		<BackLink href="/odonto/configuracion" label="Configuración" class="mb-5" />
		<h1 class="ux-title">Señas</h1>
		<p class="ux-subtitle">
			Cuánto se pide, cuándo y qué pasa si no llega. Los cambios se aplican a las reservas nuevas: cada
			turno conserva las condiciones que se le informaron al reservar.
		</p>
	</header>

	{#if !data.whatsappConfigured}
		<p class="ux-alert" role="alert">
			El consultorio no tiene su WhatsApp habilitado: las personas no van a ver los botones para mandar
			el comprobante. <a href="/odonto/configuracion/whatsapp" class="underline">Configurar el WhatsApp</a>
		</p>
	{/if}
	{#if data.automationStopped === null}
		<p class="ux-alert" role="alert">
			No pudimos comprobar si las señas están habilitadas por el operador de Cita Suite. Revisá las señas
			pendientes a mano y volvé a cargar esta página en unos segundos.
		</p>
	{:else if data.automationStopped}
		<p class="ux-alert" role="alert">
			La cancelación automática está detenida por el operador de Cita Suite: aunque la enciendas acá,
			ningún turno se cancela solo ni las reservas nuevas piden seña hasta que vuelva a encenderse.
		</p>
	{/if}
	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'} role="status">{form.message}</p>
	{/if}

	<form method="post" action="?/save" class="ux-card grid gap-6">
		<input type="hidden" name="expected_revision" value={data.policy.revision} />

		<label class="ux-choice flex items-center gap-3 px-4 py-3">
			<input type="checkbox" name="enabled" value="true" bind:checked={enabled} disabled={!canSave} class="accent-check-accent-600" />
			<span class="font-bold text-fg">Pedir seña en las reservas</span>
		</label>
		{#if !enabled && data.policy.enabled}
			<p class="text-sm text-warning-300">
				Al guardar con la seña apagada, las señas pendientes quedan exceptuadas y ningún turno se cancela por ellas.
			</p>
		{/if}

		<fieldset class="grid gap-4">
			<legend class="ux-section-title">Monto</legend>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="amount_mode" value="fixed" bind:group={amountMode} disabled={!canSave} class="accent-check-accent-600" />
				<span class="text-fg">Un monto fijo, el mismo para todas las prestaciones</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="amount_mode" value="percentage" bind:group={amountMode} disabled={!canSave} class="accent-check-accent-600" />
				<span class="text-fg">Un porcentaje del arancel del mes del turno</span>
			</label>
			<label>
				<span class="ux-label">Monto fijo, en pesos{amountMode === 'percentage' ? ' (se usa cuando la prestación no tiene arancel)' : ''}</span>
				<input name="fixed_amount" inputmode="numeric" bind:value={fixedAmount} disabled={!canSave} class="ux-input" placeholder="40.000" />
				{#if errors.fixed_amount}<span class="mt-1 block text-sm text-warning-300">{errors.fixed_amount}</span>{/if}
			</label>
			{#if amountMode === 'percentage'}
				<label>
					<span class="ux-label">Porcentaje del arancel</span>
					<input name="percentage" inputmode="decimal" bind:value={percentage} disabled={!canSave} class="ux-input" placeholder="35" />
					<span class="mt-1 block text-xs text-copy-subtle">Se redondea con la misma unidad que el arancel.</span>
					{#if errors.percentage}<span class="mt-1 block text-sm text-warning-300">{errors.percentage}</span>{/if}
				</label>
				{#if withoutFee.length > 0}
					<div class="ux-soft-card p-4 text-sm text-fg-70" data-without-fee>
						<p class="font-bold text-fg">
							{fixedFallback
								? 'Estas prestaciones no tienen arancel para todos los profesionales: ahí se pide el monto fijo.'
								: 'Estas prestaciones no tienen arancel para todos los profesionales: ahí no se va a pedir seña.'}
						</p>
						<ul class="mt-2 list-disc pl-5">
							{#each withoutFee as service (service.id)}
								<li>{service.name}{service.fee === 'some' ? ' (tiene arancel sólo para algunos profesionales)' : ''}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{:else}
				<input type="hidden" name="percentage" value={percentage} />
			{/if}
		</fieldset>

		<fieldset class="grid gap-4 sm:grid-cols-2">
			<legend class="ux-section-title sm:col-span-2">Plazos</legend>
			<label>
				<span class="ux-label">Días antes del turno para pedirla</span>
				<input name="request_days" inputmode="numeric" value={initial.requestDays} disabled={!canSave} class="ux-input" />
				{#if errors.request_days}<span class="mt-1 block text-sm text-warning-300">{errors.request_days}</span>{/if}
			</label>
			<label>
				<span class="ux-label">Horas antes del turno en que vence</span>
				<input name="deadline_hours" inputmode="numeric" bind:value={deadlineHours} disabled={!canSave} class="ux-input" />
				{#if errors.deadline_hours}<span class="mt-1 block text-sm text-warning-300">{errors.deadline_hours}</span>{/if}
			</label>
			<label>
				<span class="ux-label">Plazo mínimo para pagar, en horas</span>
				<input name="min_payment_hours" inputmode="numeric" bind:value={minPaymentHours} disabled={!canSave} class="ux-input" />
				{#if errors.min_payment_hours}<span class="mt-1 block text-sm text-warning-300">{errors.min_payment_hours}</span>{/if}
			</label>
			<label>
				<span class="ux-label">Plazo para reservas tardías, en horas (opcional)</span>
				<input
					name="late_booking_payment_hours"
					inputmode="numeric"
					bind:value={lateBookingPaymentHours}
					disabled={!canSave}
					class="ux-input"
					placeholder="48"
				/>
				<span class="mt-1 block text-xs text-copy-subtle">
					Si reservan después del plazo normal, tienen estas horas para pagar. Si el vencimiento queda a menos de 24&nbsp;horas del turno, no se cancela solo. Vacío, se usa sólo el plazo normal.
				</span>
				{#if errors.late_booking_payment_hours}<span class="mt-1 block text-sm text-warning-300">{errors.late_booking_payment_hours}</span>{/if}
			</label>
		</fieldset>

		<div class="grid gap-2">
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="auto_cancel_enabled" value="true" bind:checked={autoCancelEnabled} disabled={!canSave} class="accent-check-accent-600" />
				<span class="font-bold text-fg">Cancelar solo el turno si la seña no llega a tiempo</span>
			</label>
			<p class="text-sm text-fg-55">
				Al vencer, el turno se cancela y el horario vuelve a estar disponible. Si el plazo queda muy cerca del
				turno (menos de 24&nbsp;horas con reservas tardías, o menos del plazo mínimo para pagar), si el paciente
				está exceptuado en su ficha, si pidió reprogramar o si la seña venció hace más de 24&nbsp;horas, no se
				cancela solo y queda en la lista para decidir a mano.
			</p>
		</div>

		<details class="ux-soft-card p-4" data-deposit-examples-accordion>
			<summary class="cursor-pointer font-bold text-fg">
				¿Cómo funcionan los plazos y la cancelación automática? Ver ejemplos
			</summary>
			<div class="mt-4 grid gap-4 border-t border-line pt-4 text-sm text-fg-70">
				<p>
					Estos ejemplos se calculan con los valores actuales de esta pantalla para que puedas verificar cuándo vence
					la seña y cuándo se cancela solo un turno:
				</p>
				<div class="grid gap-3">
					{#each ruleExamples as example (example.id)}
						<div class="rounded-xl border border-line bg-surface p-4">
							<p class="font-bold text-fg">{example.title}</p>
							<p class="mt-1 text-fg-65">{example.scenario}</p>
							<p class="mt-2 text-fg">{example.summary}</p>
							<p class="mt-1 text-fg-65">{example.outcome}</p>
						</div>
					{/each}
				</div>
				{#if supportWhatsAppHref}
					<div class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
						<p class="text-fg-70">
							Si querés revisar cómo conviene configurar los plazos para tu consultorio, escribinos.
						</p>
						<a
							href={supportWhatsAppHref}
							target="_blank"
							rel="noopener noreferrer"
							class="ux-btn-secondary shrink-0"
						>
							¿Te quedan dudas?
						</a>
					</div>
				{/if}
			</div>
		</details>

		<fieldset class="grid gap-3" data-expiring-reminder-fieldset>
			<legend class="ux-section-title">Aviso automático antes del vencimiento</legend>
			<p class="text-sm text-fg-55">
				Envía un correo automático al paciente antes de que venza la seña, con los datos para transferir y el botón para avisar que ya pagó. Sólo se envía si los correos del consultorio están activos.
			</p>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="expiring_reminder_hours" value="" bind:group={expiringReminderHours} disabled={!canSave} class="accent-check-accent-600" />
				<span class="text-fg">Desactivado</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="expiring_reminder_hours" value="24" bind:group={expiringReminderHours} disabled={!canSave} class="accent-check-accent-600" />
				<span class="text-fg">24 horas antes del vencimiento</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="expiring_reminder_hours" value="48" bind:group={expiringReminderHours} disabled={!canSave} class="accent-check-accent-600" />
				<span class="text-fg">48 horas antes del vencimiento</span>
			</label>
			{#if errors.expiring_reminder_hours}<span class="text-sm text-warning-300">{errors.expiring_reminder_hours}</span>{/if}
		</fieldset>

		<fieldset class="grid gap-3" data-deposit-credit-cutoff-fieldset>
			<legend class="ux-section-title">Seña a cuenta al cancelar o reprogramar</legend>
			<label class="grid gap-2">
				<span class="ux-label">Horas de anticipación para conservar la seña a cuenta (opcional)</span>
				<input
					name="deposit_credit_cutoff_hours"
					inputmode="numeric"
					bind:value={depositCreditCutoffHours}
					disabled={!canSave}
					class="ux-input max-w-44"
					placeholder="48"
				/>
				<span class="block text-xs text-copy-subtle">
					Entre 1 y 720&nbsp;horas. Con esa anticipación o más, la seña pagada queda a cuenta al cancelar o cubre el nuevo horario al reprogramar. Con menos tiempo, la seña se pierde (el consultorio puede hacer excepción por fuerza mayor). Vacío, rige la configuración fija de Correo.
				</span>
				{#if errors.deposit_credit_cutoff_hours}<span class="text-sm text-warning-300">{errors.deposit_credit_cutoff_hours}</span>{/if}
			</label>
		</fieldset>

		<label>
			<span class="ux-label">Datos para transferir</span>
			<textarea name="transfer_details" rows="3" maxlength="500" disabled={!canSave} class="ux-textarea" placeholder="Alias, CBU y titular">{initial.transferDetails}</textarea>
			<span class="mt-1 block text-xs text-copy-subtle">La persona los ve en la página de su turno y en el pedido por WhatsApp.</span>
			{#if errors.transfer_details}<span class="mt-1 block text-sm text-warning-300">{errors.transfer_details}</span>{/if}
		</label>

		<label class="ux-choice flex items-center gap-3 px-4 py-3">
			<input type="checkbox" name="applies_to_manual" value="true" checked={initial.appliesToManual} disabled={!canSave} class="accent-check-accent-600" />
			<span class="text-fg">Pedirla también en los turnos que carga el consultorio</span>
		</label>

		{#if data.services.length > 0}
			<fieldset class="grid gap-2">
				<legend class="ux-section-title">Prestaciones que no piden seña</legend>
				{#each data.services as service (service.id)}
					<label class="ux-choice flex items-center gap-3 px-4 py-3">
						<input
							type="checkbox"
							name="excluded_service_ids"
							value={service.id}
							checked={excluded.includes(service.id)}
							onchange={(event) => toggleExcluded(service.id, event.currentTarget.checked)}
							disabled={!canSave}
							class="accent-check-accent-600"
						/>
						<span class="text-fg">{service.name}</span>
					</label>
				{/each}
			</fieldset>
		{/if}

		{#if enabled && amountMode === 'fixed' && fixedFallback}
			<p class="text-sm text-fg-55">
				Cada reserva nueva va a pedir {formatDepositAmount(Number(fixedAmount.replaceAll('.', '')))}.
			</p>
		{/if}

		<div>
			<button type="submit" disabled={!canSave} class="ux-btn-primary">Guardar</button>
		</div>
	</form>

	{#if data.demo}
		<p class="ux-empty">Modo demo: la configuración no se guarda.</p>
	{/if}
</section>
