<script lang="ts">
 import { enhance } from '$app/forms';
 import { styledDate } from '$lib/ui/styled-controls';
 import type { SubmitFunction } from '@sveltejs/kit';
 import { formatDateTime, formatDuration } from '$lib/utils/format';
 import { revealNotice } from '$lib/ui/reveal-notice';
 import { describeDepositDeadline } from '$lib/scheduling/deposits';
 import { buildSelfManagementCutoffNotice } from '$lib/scheduling/email-policy';
 import { formatDepositMoney } from '$lib/scheduling/reschedule-terms';
 import { whatsappHrefFor } from '$lib/device';
 import type { PatientManagementPanelData, PatientManagementFeedback } from '$lib/scheduling/patient-management-page';
 let { context, feedback }: { context: PatientManagementPanelData; feedback?: PatientManagementFeedback | null } = $props();
 let busy = $state(false);
 let draftDate = $state<string | null>(null);
 $effect(() => { context.date; context.mode; draftDate = null; });
 const dateChanged = $derived(draftDate !== null && draftDate !== context.date);
 let transportFeedback = $state<PatientManagementFeedback | null>(null);
 const outcome = $derived(transportFeedback ?? feedback);
 let responseElement = $state<HTMLParagraphElement | null>(null);
 $effect(() => { if (outcome?.message) revealNotice(responseElement); });
 const progressive: SubmitFunction = ({ action, formData, cancel }) => {
  if (busy) { cancel(); return; }
  busy = true;
  transportFeedback = null;
  const submittedAction = (['cancel', 'confirm', 'reschedule'] as const).find(candidate => action.searchParams.has(`/${candidate}`));
  const submitted = Object.fromEntries([...formData].flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []));
  const preserveRequest = (message: string) => {
   transportFeedback = { message, action: submittedAction, submitted, retrySameOperation: !!submittedAction };
  };
  return async ({ result, update }) => {
   try {
    if (result.type === 'error') {
     preserveRequest('No pudimos comprobar el resultado. Revisá el turno o volvé a comprobar la misma acción.');
     return;
    }
    await update({ reset: false });
   } catch {
    preserveRequest('No pudimos actualizar el turno. Comprobá la misma acción para conocer el resultado.');
   } finally { busy = false; }
  };
 };
 const mode = $derived(outcome?.success ? 'overview' : context.mode);
 const terms = $derived(context.financialTerms);
 const fields = $derived({ operation_id: context.operationId, expected_revision: context.revision });
 const cancelUrl = $derived(`${context.url}?accion=cancelar`);
 const rescheduleUrl = $derived(`${context.url}?accion=reprogramar`);
 const slotUrl = (startsAt: string) => `${rescheduleUrl}&fecha=${encodeURIComponent(context.date)}&horario=${encodeURIComponent(startsAt)}`;
 const positive = (value: string) => BigInt(value) > 0n;
 const cutoffClosedNotice = $derived(
  context.selfManagementWindowClosed
   ? buildSelfManagementCutoffNotice({
      startsAt: context.startsAt,
      cutoffHours: context.selfManagementCutoffHours ?? null,
      timezone: context.timezone,
      now: new Date(context.now),
      context: 'window_closed',
      hasWhatsApp: Boolean(context.practiceWhatsApp)
     })
   : null
 );
 const rescheduleTargetCutoffNotice = $derived(
  context.selectedStart && context.selfManagementCutoffHours
   ? buildSelfManagementCutoffNotice({
      startsAt: context.selectedStart,
      cutoffHours: context.selfManagementCutoffHours,
      timezone: context.timezone,
      now: new Date(context.now),
      context: 'reschedule_target'
     })
   : null
 );
 const rescheduleDepositDeadline = $derived(
  terms?.required && terms.amount && terms.due_at
   ? describeDepositDeadline(
      { amount: Number(terms.amount), dueAt: terms.due_at, autoCancel: terms.auto_cancel },
      context.timezone,
      new Date(context.now)
     )
   : null
 );
 const whatsappContactHref = $derived(
  context.practiceWhatsApp
   ? whatsappHrefFor(
      context.device ?? 'unknown',
      context.practiceWhatsApp.whatsappUrl,
      context.practiceWhatsApp.whatsappWebUrl
     )
   : null
 );
 const practiceTelHref = $derived(
  context.practicePhone ? `tel:${context.practicePhone.replace(/[^\d+]/g, '')}` : null
 );
</script>

{#snippet hiddenFields(values: Record<string, string>)}
 {#each Object.entries(values) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
{/snippet}

<section class="ux-card mt-5" aria-label="Gestión de tu turno" aria-busy={busy}>
 {#if outcome?.message}
  <p bind:this={responseElement} tabindex="-1" role={outcome.success ? 'status' : 'alert'} class={outcome.success ? 'ux-alert ux-alert-success bk-success-text bk-success-fill bk-success-line mb-4' : 'ux-alert bk-error-text bk-error-fill bk-error-line mb-4'}>{outcome.message}</p>
 {/if}

 {#if outcome?.submitted && !outcome.success}
  <a class="ux-btn-secondary" href={context.url}>Revisar el turno</a>
  {#if outcome.retrySameOperation && outcome.action}
   <form method="POST" action={`?/${outcome.action}`} class="mt-4" use:enhance={progressive}>
    {@render hiddenFields(outcome.submitted)}
    <button class="ux-btn-primary w-full" disabled={busy}>{busy ? 'Reintentando…' : 'Reintentar la misma acción'}</button>
   </form>
  {/if}
 {:else if mode === 'cancel' && context.canCancel}
  <h2 class="ux-section-title">¿Querés cancelar este turno?</h2>
  <p class="mt-3 font-bold text-fg bk-text">{formatDateTime(context.startsAt, context.timezone)}</p>
  <p class="mt-3 text-fg-65 bk-muted">Se liberará ese horario.</p>
  {#if positive(context.financialSummary.appliedAmount) || positive(context.financialSummary.unresolvedAmount)}<p class="mt-3 text-fg-65 bk-muted">El consultorio resolverá con vos el dinero registrado. La cancelación no hace una devolución automática.</p>{/if}
  <form method="POST" action="?/cancel" class="mt-5" use:enhance={progressive}>
   {@render hiddenFields(fields)}
   <input type="hidden" name="confirm_cancel" value="true" />
   <button class="ux-btn-danger w-full" disabled={busy}>{busy ? 'Cancelando…' : 'Sí, cancelar turno'}</button>
  </form>
  <a class="ux-btn-secondary mt-3 w-full" href={context.url}>Conservar mi turno</a>
  {#if context.canReschedule}<p class="mt-4 text-center text-sm"><a class="ux-link" href={rescheduleUrl}>Prefiero reprogramar</a></p>{/if}
 {:else if mode === 'reschedule' && context.canReschedule}
  <h2 class="ux-section-title">¿Querés reprogramar este turno?</h2>
  <p class="mt-3 text-fg-65 bk-muted">Hasta confirmar, conservás tu turno del {formatDateTime(context.startsAt, context.timezone)}.</p>
  <form method="GET" action={context.url} class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
   <input type="hidden" name="accion" value="reprogramar" />
   <label class="min-w-0"><span class="ux-label">Día para el nuevo turno</span><input use:styledDate={draftDate ?? context.date} class="ux-input w-full" type="date" name="fecha" value={draftDate ?? context.date} oninput={event => draftDate = event.currentTarget.value} required /></label>
   <button class="ux-btn-secondary">Ver horarios</button>
  </form>
  {#if dateChanged}
   <p class="mt-4 text-fg-65 bk-muted" role="status">Consultá los horarios de la fecha elegida.</p>
  {:else}
  {#if context.unavailableMessage}<p class="ux-alert mt-4" role="status">{context.unavailableMessage}</p>{/if}
  {#if context.slots.length}
   <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Horarios disponibles">
    {#each context.slots as slot (slot.starts_at)}
     <a class={context.selectedStart === slot.starts_at ? 'ux-btn-primary' : 'ux-btn-secondary'} href={slotUrl(slot.starts_at)} aria-current={context.selectedStart === slot.starts_at ? 'true' : undefined}>
      {formatDateTime(slot.starts_at, context.timezone)}
     </a>
    {/each}
   </div>
  {:else if !context.unavailableMessage}<p class="ux-empty mt-4">No hay horarios disponibles ese día. Elegí otra fecha; tu turno actual se conserva.</p>{/if}
  {#if context.selectedStart && terms && context.availabilityRevision !== null}
   <div class="mt-6 border-t border-line pt-5 bk-line">
    <h3 class="ux-section-title">Revisá el cambio antes de confirmar</h3>
    <p class="mt-3 font-bold text-fg bk-text">Nuevo turno: {formatDateTime(context.selectedStart, context.timezone)}</p>
    {#if context.durationMinutes !== null}<p class="mt-2 text-fg-65 bk-muted">Duración vigente: {formatDuration(context.durationMinutes)}.</p>{/if}
    {#if positive(terms.forfeit_amount)}<p class="mt-3 text-fg bk-text">La seña anterior de {formatDepositMoney(terms.forfeit_amount)} dejará de aplicarse al precio de esta consulta al confirmar el cambio. El pago queda registrado.</p>{/if}
    {#if positive(terms.credit_amount)}<p class="mt-3 text-fg bk-text">Anticipos registrados que seguirán a cuenta: {formatDepositMoney(terms.credit_amount)}.</p>{/if}
    {#if terms.required && terms.amount}
     <p class="mt-3 font-bold text-fg bk-text">{terms.kind === 'reuse_pending' ? 'La seña pendiente se conserva' : 'Nueva seña pendiente'}: {formatDepositMoney(terms.amount)}.</p>
     {#if terms.kind === 'reuse_pending'}<p class="mt-2 text-fg-65 bk-muted">No se suma otra deuda a la seña que todavía no pagaste.</p>{/if}
     {#if rescheduleDepositDeadline}
      <p class="mt-2 text-fg-65 bk-muted">Plazo para transferir: antes del {rescheduleDepositDeadline.dueLabel}.{rescheduleDepositDeadline.autoCancelSentence ? ` ${rescheduleDepositDeadline.autoCancelSentence}` : ''}</p>
      {#if terms.last_minute || !terms.auto_cancel}<p class="mt-2 text-fg-65 bk-muted">Este turno no se cancelará automáticamente por falta de seña; cualquier decisión la toma el consultorio.</p>{/if}
     {:else if terms.last_minute}<p class="mt-2 text-fg-65 bk-muted">El consultorio resolverá el plazo de pago. Este plazo no provocará una cancelación automática.</p>{/if}
     <p class="mt-2 text-fg-65 bk-muted">El nuevo horario quedará reservado y pendiente de que el consultorio registre esa seña.</p>
    {:else}<p class="mt-3 text-fg-65 bk-muted">Este cambio no genera una nueva seña.</p>{/if}
    {#if rescheduleTargetCutoffNotice}<p class="ux-alert ux-alert-warning mt-3" role="status">{rescheduleTargetCutoffNotice}</p>{/if}
    {#if terms.quote_amount === null}<p class="mt-3 text-sm text-fg-65 bk-muted">No hay un arancel registrado para calcular cuánto resta de la consulta. Podés consultarlo con el consultorio.</p>
    {:else if terms.quote_remainder !== null}<p class="mt-3 text-sm text-fg-65 bk-muted">Arancel registrado menos anticipos aplicables: {formatDepositMoney(terms.quote_remainder)}. Este cálculo sólo incluye los anticipos registrados en este turno.</p>{/if}
    <form method="POST" action="?/reschedule" class="mt-5" use:enhance={progressive}>
     {@render hiddenFields(fields)}
     <input type="hidden" name="starts_at" value={context.selectedStart} />
     <input type="hidden" name="availability_revision" value={context.availabilityRevision} />
     <input type="hidden" name="integration_revision" value={context.integrationRevision ?? ''} />
     <input type="hidden" name="financial_terms" value={JSON.stringify(terms)} />
     <button class="ux-btn-primary w-full" disabled={busy}>{busy ? 'Guardando el cambio…' : 'Confirmar reprogramación'}</button>
    </form>
   </div>
  {/if}
  {/if}
  <a class="ux-btn-secondary mt-4 w-full" href={context.url}>Conservar mi turno</a>
  {#if context.canCancel}<p class="mt-4 text-center text-sm"><a class="ux-link" href={cancelUrl}>Prefiero cancelar sin reprogramar</a></p>{/if}
 {:else}
  <h2 class="ux-section-title">Gestionar mi turno</h2>
  <div class="mt-4 flex flex-wrap gap-3">
   {#if context.canConfirm}<form method="POST" action="?/confirm" use:enhance={progressive}>{@render hiddenFields(fields)}<button class="ux-btn-primary" disabled={busy}>{busy ? 'Confirmando…' : 'Confirmo que voy'}</button></form>{/if}
   {#if context.canReschedule}<a class="ux-btn-secondary" href={rescheduleUrl}>Reprogramar turno</a>{/if}
   {#if context.canCancel}<a class="ux-btn-secondary" href={cancelUrl}>Cancelar turno</a>{/if}
  </div>
  {#if context.selfManagementWindowClosed}
   <p class="mt-3 text-fg-65 bk-muted" data-self-management-closed-notice>
    {cutoffClosedNotice ?? 'Ya pasó el límite para cancelar o reprogramar este turno online. Escribile al consultorio para coordinar un cambio.'}
   </p>
   {#if whatsappContactHref}
    <a href={whatsappContactHref} target="_blank" rel="noreferrer" class="ux-btn-secondary mt-3 inline-flex">Escribir al consultorio por WhatsApp</a>
   {:else if context.practicePhone && practiceTelHref}
    <p class="mt-2 text-sm text-fg-65 bk-muted">Teléfono del consultorio: <a class="ux-link whitespace-nowrap bk-accent-text" href={practiceTelHref}>{context.practicePhone}</a></p>
   {/if}
  {:else if !context.canConfirm && !context.canCancel && !context.canReschedule}<p class="mt-3 text-fg-65 bk-muted">Este turno no admite cambios online. Si necesitás ayuda, contactá al consultorio.</p>
  {:else if context.unavailableMessage}<p class="mt-3 text-fg-65 bk-muted">{context.unavailableMessage}</p>{/if}
 {/if}
 {#if positive(context.financialSummary.unresolvedAmount)}<p class="mt-5 text-fg-65 bk-muted">Hay {formatDepositMoney(context.financialSummary.unresolvedAmount)} de dinero registrado por resolver con el consultorio. Esto no confirma una devolución ni reactiva el turno.</p>{/if}
 {#if positive(context.financialSummary.forfeitedAmount)}<p class="mt-4 text-sm text-fg-65 bk-muted">Señas anteriores que dejaron de aplicarse por cambios ya registrados: {formatDepositMoney(context.financialSummary.forfeitedAmount)}.</p>{/if}
</section>
