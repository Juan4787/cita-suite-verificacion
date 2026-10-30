<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { formatDepositAmount } from '$lib/scheduling/deposits';
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
	let excluded = $state<string[]>([...initial.excludedServiceIds]);
	const canSave = $derived(!data.demo);
	const errors = $derived(form?.errors ?? {});

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

<section class="ux-page">
	<div class="ux-hero">
		<BackLink href="/odonto/configuracion" label="Volver" class="mb-5" />
		<h1 class="ux-title">Señas</h1>
		<p class="ux-subtitle">
			Cuánto se pide, cuándo y qué pasa si no llega. Los cambios se aplican a las reservas nuevas: cada
			turno conserva las condiciones que se le informaron al reservar.
		</p>
	</div>

	{#if !data.whatsappConfigured}
		<p class="ux-alert" role="alert">
			El consultorio no tiene su WhatsApp habilitado: las personas no van a ver los botones para mandar
			el comprobante. <a href="/odonto/configuracion/whatsapp" class="underline">Configurar el WhatsApp</a>
		</p>
	{/if}
	{#if data.automationStopped}
		<p class="ux-alert" role="alert">
			La cancelación automática está detenida por el operador de Cita Suite: aunque la enciendas acá,
			ningún turno se cancela solo hasta que vuelva a encenderse.
		</p>
	{/if}
	{#if form?.message}
		<p class={form.success ? 'ux-alert ux-alert-success' : 'ux-alert'} role="status">{form.message}</p>
	{/if}

	<form method="post" action="?/save" class="ux-card grid gap-6">
		<input type="hidden" name="expected_revision" value={data.policy.revision} />

		<label class="ux-choice flex items-center gap-3 px-4 py-3">
			<input type="checkbox" name="enabled" value="true" bind:checked={enabled} disabled={!canSave} class="accent-[#7c3aed]" />
			<span class="font-bold text-white">Pedir seña en las reservas</span>
		</label>
		{#if !enabled && data.policy.enabled}
			<p class="text-sm text-amber-300">
				Al guardar con la seña apagada, las señas pendientes quedan exceptuadas y ningún turno se cancela por ellas.
			</p>
		{/if}

		<fieldset class="grid gap-4">
			<legend class="ux-section-title">Monto</legend>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="amount_mode" value="fixed" bind:group={amountMode} disabled={!canSave} class="accent-[#7c3aed]" />
				<span class="text-white">Un monto fijo, el mismo para todas las prestaciones</span>
			</label>
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="radio" name="amount_mode" value="percentage" bind:group={amountMode} disabled={!canSave} class="accent-[#7c3aed]" />
				<span class="text-white">Un porcentaje del arancel del mes del turno</span>
			</label>
			<label>
				<span class="ux-label">Monto fijo, en pesos{amountMode === 'percentage' ? ' (se usa cuando la prestación no tiene arancel)' : ''}</span>
				<input name="fixed_amount" inputmode="numeric" bind:value={fixedAmount} disabled={!canSave} class="ux-input" placeholder="40.000" />
				{#if errors.fixed_amount}<span class="mt-1 block text-sm text-amber-300">{errors.fixed_amount}</span>{/if}
			</label>
			{#if amountMode === 'percentage'}
				<label>
					<span class="ux-label">Porcentaje del arancel</span>
					<input name="percentage" inputmode="decimal" bind:value={percentage} disabled={!canSave} class="ux-input" placeholder="35" />
					<span class="mt-1 block text-xs text-white/45">Se redondea con la misma unidad que el arancel.</span>
					{#if errors.percentage}<span class="mt-1 block text-sm text-amber-300">{errors.percentage}</span>{/if}
				</label>
				{#if withoutFee.length > 0}
					<div class="ux-soft-card p-4 text-sm text-white/70" data-without-fee>
						<p class="font-bold text-white">
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

		<fieldset class="grid gap-4 sm:grid-cols-3">
			<legend class="ux-section-title sm:col-span-3">Plazos</legend>
			<label>
				<span class="ux-label">Días antes del turno para pedirla</span>
				<input name="request_days" inputmode="numeric" value={initial.requestDays} disabled={!canSave} class="ux-input" />
				{#if errors.request_days}<span class="mt-1 block text-sm text-amber-300">{errors.request_days}</span>{/if}
			</label>
			<label>
				<span class="ux-label">Horas antes del turno en que vence</span>
				<input name="deadline_hours" inputmode="numeric" value={initial.deadlineHours} disabled={!canSave} class="ux-input" />
				{#if errors.deadline_hours}<span class="mt-1 block text-sm text-amber-300">{errors.deadline_hours}</span>{/if}
			</label>
			<label>
				<span class="ux-label">Plazo mínimo para pagar, en horas</span>
				<input name="min_payment_hours" inputmode="numeric" value={initial.minPaymentHours} disabled={!canSave} class="ux-input" />
				{#if errors.min_payment_hours}<span class="mt-1 block text-sm text-amber-300">{errors.min_payment_hours}</span>{/if}
			</label>
		</fieldset>

		<div class="grid gap-2">
			<label class="ux-choice flex items-center gap-3 px-4 py-3">
				<input type="checkbox" name="auto_cancel_enabled" value="true" bind:checked={autoCancelEnabled} disabled={!canSave} class="accent-[#7c3aed]" />
				<span class="font-bold text-white">Cancelar solo el turno si la seña no llega a tiempo</span>
			</label>
			<p class="text-sm text-white/55">
				Al vencer, el turno se cancela y el horario vuelve a estar disponible. Nunca cancela un turno reservado
				con menos del plazo mínimo para pagar, uno con un pedido de reprogramación ni una seña vencida hace
				más de 24 horas: esos quedan en la lista para decidir a mano.
			</p>
		</div>

		<label>
			<span class="ux-label">Datos para transferir</span>
			<textarea name="transfer_details" rows="3" maxlength="500" disabled={!canSave} class="ux-textarea" placeholder="Alias, CBU y titular">{initial.transferDetails}</textarea>
			<span class="mt-1 block text-xs text-white/45">La persona los ve en la página de su turno y en el pedido por WhatsApp.</span>
			{#if errors.transfer_details}<span class="mt-1 block text-sm text-amber-300">{errors.transfer_details}</span>{/if}
		</label>

		<label class="ux-choice flex items-center gap-3 px-4 py-3">
			<input type="checkbox" name="applies_to_manual" value="true" checked={initial.appliesToManual} disabled={!canSave} class="accent-[#7c3aed]" />
			<span class="text-white">Pedirla también en los turnos que carga el consultorio</span>
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
							class="accent-[#7c3aed]"
						/>
						<span class="text-white">{service.name}</span>
					</label>
				{/each}
			</fieldset>
		{/if}

		{#if enabled && amountMode === 'fixed' && fixedFallback}
			<p class="text-sm text-white/55">
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
