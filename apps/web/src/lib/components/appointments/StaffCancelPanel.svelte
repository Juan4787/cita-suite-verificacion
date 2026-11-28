<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { AppointmentDepositView } from '$lib/scheduling/deposits';
	import { formatDepositAmount } from '$lib/scheduling/deposits';

	// Says what is about to happen before it happens (plan, P1). Nothing here promises a delivery:
	// whether the receipt really left is what «Correos de este turno» shows afterwards.
	let {
		patientName,
		when,
		patientHasEmail,
		deposit,
		depositCreditCutoffHours = null,
		startsAt = null,
		nowIso = null,
		operationId,
		revision,
		disabled,
		onsubmit
	}: {
		patientName: string;
		when: string;
		patientHasEmail: boolean;
		deposit: AppointmentDepositView | null;
		depositCreditCutoffHours?: number | null;
		startsAt?: string | null;
		nowIso?: string | null;
		operationId: string;
		revision: string;
		disabled: boolean;
		onsubmit: SubmitFunction;
	} = $props();

	const paidAmount = $derived(deposit?.status === 'paid' ? (deposit.applied_credit_amount ?? deposit.amount) : null);
	const p4Active = $derived(typeof depositCreditCutoffHours === 'number' && depositCreditCutoffHours >= 1);
	const hoursUntilStart = $derived(
		startsAt ? (Date.parse(startsAt) - (nowIso ? Date.parse(nowIso) : Date.now())) / 3_600_000 : null
	);
	const p4InTime = $derived(p4Active && hoursUntilStart !== null && hoursUntilStart >= depositCreditCutoffHours!);
	const p4Late = $derived(p4Active && hoursUntilStart !== null && hoursUntilStart < depositCreditCutoffHours!);
	const cutoffHoursLabel = $derived(
		depositCreditCutoffHours === 1 ? '1\u00a0hora' : `${depositCreditCutoffHours}\u00a0horas`
	);
</script>

<details class="ux-disclosure ux-disclosure-danger" data-cancel-panel>
	<summary>Cancelar turno</summary>
	<form method="POST" action="?/update_status" use:enhance={onsubmit} class="ux-disclosure-body flex flex-col gap-4">
		<input type="hidden" name="status" value="cancelled" />
		<input type="hidden" name="operation_id" value={operationId} />
		<input type="hidden" name="expected_revision" value={revision} />
		<div>
			<p class="text-base text-fg">Vas a cancelar el turno de <strong>{patientName}</strong>, {when}.</p>
			<ul class="mt-2 grid gap-1 text-sm text-fg-65">
				<li>El horario queda libre para otra reserva.</li>
				{#if deposit?.status === 'paid' && paidAmount !== null}
					{#if p4InTime}
						<li>La seña de {formatDepositAmount(paidAmount)} quedará a cuenta en la ficha del paciente (se cancela con {cutoffHoursLabel} o más de anticipación). Cancelar no registra una devolución.</li>
					{:else if p4Late}
						<li>Con menos de {cutoffHoursLabel} de anticipación, la seña de {formatDepositAmount(paidAmount)} se pierde, salvo que marques la excepción por fuerza mayor abajo. Cancelar no registra una devolución.</li>
					{:else}
						<li>La seña de {formatDepositAmount(paidAmount)} queda por resolver con el paciente. Cancelar no registra una devolución.</li>
					{/if}
				{:else if deposit?.status === 'pending'}
					<li>La seña pendiente deja de pedirse.</li>
				{/if}
				<li>
					{patientHasEmail
						? 'Si el consultorio tiene los correos activos, el paciente recibe el comprobante de cancelación.'
						: 'El paciente no tiene correo cargado: avisale por otro medio.'}
				</li>
			</ul>
		</div>
		{#if deposit?.status === 'paid' && paidAmount !== null && p4Late}
			<label class="ux-choice flex items-start gap-3 px-4 py-3 text-sm font-semibold text-fg" data-force-majeure-credit>
				<input type="checkbox" name="keep_deposit_as_credit" value="true" {disabled} class="mt-0.5 accent-check-accent-600" />
				<span>Excepción por fuerza mayor o decisión del consultorio: dejar la seña de {formatDepositAmount(paidAmount)} a cuenta del paciente</span>
			</label>
		{/if}
		<label>
			<span class="ux-label">Motivo (opcional)</span>
			<textarea name="reason" maxlength="500" rows="2" {disabled} class="ux-textarea"></textarea>
		</label>
		<label class="flex items-start gap-3 text-sm font-bold text-fg">
			<input type="checkbox" name="confirm_cancel" value="true" required {disabled} class="mt-0.5" />
			<span>Confirmo que quiero cancelar este turno.</span>
		</label>
		<button {disabled} class="ux-btn-danger w-full sm:w-auto sm:self-start">Cancelar turno</button>
	</form>
</details>
