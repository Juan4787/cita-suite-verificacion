<script lang="ts">
 import { enhance } from '$app/forms';
 import type { SubmitFunction } from '@sveltejs/kit';
 import { BOOKING_MODALITY_LABELS, type BookingModality, type BookingIntakeField } from '@cita-suite/shared/booking-integration';
 import { isRecord } from '$lib/contracts/json';
 import type { BookingViewData, BookingFormState, BookingConfirmation } from '$lib/scheduling/booking-view';
 import { normalizePatientFullName, patientFullNameErrorMessage, PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE } from '$lib/utils/patient-name';
 import { formatQuotedPrice } from './pricing';
 import PublicBookingIntakeField from './PublicBookingIntakeField.svelte';

 let { data, form, confirmation, requiresRecovery, onUncertain, localDraft = $bindable({}), activeStepCard = $bindable(null) }: {
  data: BookingViewData; form?: BookingFormState | null; confirmation: BookingConfirmation;
  requiresRecovery: boolean; onUncertain: () => void; localDraft: Record<string, unknown>; activeStepCard: HTMLElement | null;
 } = $props();
 const { service: selectedService, slot: selectedSlot, selection, professionalLabel: professionalSelectionLabel,
  priceQuote: currentPriceQuote, timezone, modality } = $derived(confirmation);
 const selectedProfessional = $derived({ id: confirmation.professionalId });
 const business = $derived(data.state.business);
 const values = $derived(form?.values ?? localDraft);
 const intakeFields = $derived(data.patientFields?.fields ?? data.presentation?.intakeFields ?? []);
 const requiredIntakeFields = $derived(intakeFields.filter((field: BookingIntakeField) => field.required));
 const optionalIntakeFields = $derived(intakeFields.filter((field: BookingIntakeField) => !field.required));
 const patientToday = $derived(new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone
 }).format(new Date()));
 type TurnstileApi = { render: (element: HTMLElement, options: { sitekey: string }) => string; reset: (id: string) => void };
 function isTurnstileApi(value: unknown): value is TurnstileApi {
  return isRecord(value) && typeof value.render === 'function' && typeof value.reset === 'function';
 }
 function getTurnstile(): TurnstileApi | null {
  const value: unknown = Reflect.get(window, 'turnstile');
  return isTurnstileApi(value) ? value : null;
 }
	// ------------------------------ Turnstile ------------------------------
	// Render explícito: el form aparece tras navegaciones client-side y el modo
	// implícito de Cloudflare solo escanea el DOM al cargar el documento.
	let turnstileContainer = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;

	$effect(() => {
		const el = turnstileContainer;
		const siteKey = data.turnstileSiteKey;
		if (!el || !siteKey) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tryRender = () => {
			if (cancelled) return;
			const api = getTurnstile();
			if (!api) {
				timer = setTimeout(tryRender, 250);
				return;
			}
			if (el.childElementCount === 0) {
				turnstileWidgetId = api.render(el, { sitekey: siteKey });
			}
		};
		tryRender();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
			turnstileWidgetId = null;
		};
	});

	const resetTurnstile = () => {
		const api = getTurnstile();
		if (api && turnstileWidgetId !== null) {
			try {
				api.reset(turnstileWidgetId);
			} catch {
				/* el widget pudo desmontarse junto con el form */
			}
		}
	};

	let bookingSubmitting = $state(false);
	const validatePatientNameInput = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		input.setCustomValidity(patientFullNameErrorMessage(input.value));
	};
	const normalizePatientNameInput = (event: FocusEvent) => {
		const input = event.currentTarget as HTMLInputElement;
		input.value = normalizePatientFullName(input.value);
		validatePatientNameInput(event);
	};
	const onBookingSubmit: SubmitFunction = ({ formData, cancel }) => {
		if (requiresRecovery) { cancel(); return; }
		localDraft = Object.fromEntries(formData.entries());
		bookingSubmitting = true;
		return async ({ result, update }) => {
			try {
				if (data.integration && (result.type === 'error' || (result.type === 'failure' && result.data?.uncertain === true))) {
					if (result.type === 'failure') await update({ reset: false });
					onUncertain();
				} else await update({ reset: false });
			} finally { bookingSubmitting = false; }
			// El token de Turnstile es de un solo uso: tras un intento fallido hay
			// que regenerarlo o el reintento moriría siempre en el captcha.
			if (result.type === 'failure' || result.type === 'error') resetTurnstile();
			requestAnimationFrame(() => activeStepCard?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
		};
	};

</script>

				<form
				  method="POST"
				  action={confirmation.action}
				  class="ux-card patient-booking-form scroll-mt-5"
				  aria-labelledby="patient-booking-title"
				  bind:this={activeStepCard}
				  use:enhance={onBookingSubmit}
				>
				  <section class="patient-booking-summary" aria-label="Resumen del turno">
				    <div class="patient-summary-heading">
				      <h2 id="patient-booking-title">
				        {selectedService.name}
				        {selection.bookingMode === "joint" ? "con el equipo" : "con"}
				        {professionalSelectionLabel}
				      </h2>
				      {#if currentPriceQuote || selectedService.price_label}<p
				          class="patient-price"
				        >
				          <span class="sr-only"
				            >Arancel para la fecha elegida:
				          </span>{currentPriceQuote
				            ? formatQuotedPrice(currentPriceQuote)
				            : selectedService.price_label}
				        </p>{/if}
				    </div>
				    <p class="patient-summary-date">
				      {new Intl.DateTimeFormat("es-AR", {
				        weekday: "short",
				        day: "numeric",
				        month: "long",
				        year: "numeric",
				        timeZone: timezone,
				      }).format(new Date(selectedSlot.starts_at))} ·&nbsp;{selectedSlot.time}&nbsp;h ·&nbsp;{selectedService.duration_minutes}&nbsp;min
				    </p>
				    {#if data.presentation && (data.presentation.modalities.length > 1 || modality === "video")}<p
				        class="patient-summary-modality"
				      >
				        {BOOKING_MODALITY_LABELS[modality as BookingModality]}
				      </p>{/if}
				    {#if currentPriceQuote?.adjusted}<p class="patient-price-notice">
				        Este arancel incluye los ajustes del consultorio para la fecha elegida.
				      </p>{/if}
				  </section>

				  {#if data.integration}
				    <input
				      type="hidden"
				      name="integration_revision"
				      value={data.integration.revision}
				    />
				    <input type="hidden" name="modality" value={modality} />
				  {/if}
				  <input type="hidden" name="service_id" value={selectedService.id} />
				  <input type="hidden" name="booking_mode" value={selection.bookingMode} />
				  <input
				    type="hidden"
				    name="professional_id"
				    value={selectedProfessional?.id ?? selection.professionalIds[0] ?? ""}
				  />
				  {#if selection.bookingMode === "joint"}
				    <input
				      type="hidden"
				      name="professional_ids"
				      value={selection.professionalIds.join(",")}
				    />
				  {/if}
				  <input type="hidden" name="slot_starts_at" value={selectedSlot.starts_at} />
				  <input
				    type="hidden"
				    name="price_quote_hash"
				    value={data.priceQuote?.hash ?? ""}
				  />
				  <input
				    type="hidden"
				    name="idempotency_key"
				    value={String(values.idempotency_key ?? data.bookingRequestId)}
				  />

				  <input
				    type="hidden"
				    name="patient_schema_hash"
				    value={data.patientFields?.hash ?? ""}
				  />

				  <fieldset class="patient-required-fields" disabled={bookingSubmitting}>
				    <legend class="sr-only">Datos obligatorios</legend>
				    <div class="patient-field">
				      <label for="patient-name" class="patient-label"
				        ><span>Nombre y apellido</span><span
				          class="patient-required"
				          aria-hidden="true">*</span
				        ></label
				      >
				      <input
				        id="patient-name"
				        aria-label="Nombre y apellido"
				        name="patient_name"
				        maxlength={data.integration ? 200 : undefined}
				        required
				        minlength="5"
				        pattern=".*[^ ] +[^ ].*"
				        title={PATIENT_FULL_NAME_INVALID_ERROR_MESSAGE}
				        autocomplete="name"
				        value={String(values.patient_name ?? "")}
				        oninput={validatePatientNameInput}
				        onblur={normalizePatientNameInput}
				        class="ux-input patient-control"
				      />
				    </div>
				    <div class="patient-field">
				      <label for="patient-phone" class="patient-label"
				        ><span>Teléfono de contacto</span><span
				          class="patient-required"
				          aria-hidden="true">*</span
				        ></label
				      >
				      <input
				        id="patient-phone"
				        aria-label="Teléfono de contacto"
				        name="patient_phone"
				        maxlength={data.integration ? 50 : undefined}
				        required
				        inputmode="tel"
				        autocomplete="tel"
				        placeholder="Código de área y número"
				        value={String(values.patient_phone ?? "")}
				        class="ux-input patient-control"
				      />
				    </div>
				    {#each requiredIntakeFields as field (field.id)}<PublicBookingIntakeField
				        {field}
				        today={patientToday}
				        value={String(values["intake_" + field.id] ?? "")}
				      />{/each}
				  </fieldset>
				  <fieldset class="patient-optional-fields" disabled={bookingSubmitting}>
				    <legend class="sr-only">Datos opcionales</legend>
				    {#each optionalIntakeFields as field (field.id)}<PublicBookingIntakeField
				        {field}
				        today={patientToday}
				        value={String(values["intake_" + field.id] ?? "")}
				      />{/each}
				    <div class="patient-field">
				      <label for="patient-comment" class="patient-label"
				        ><span>Comentario</span><span
				          class="patient-optional"
				          aria-hidden="true">Opcional</span
				        ></label
				      >
				      <textarea
				        id="patient-comment"
				        aria-label="Comentario"
				        name="note"
				        maxlength={data.integration ? 2000 : undefined}
				        rows="3"
				        class="ux-textarea patient-control"
				        placeholder="Podés agregar algo que quieras consultar."
				        >{String(values.note ?? "")}</textarea
				      >
				    </div>
				    <div class="patient-field">
				      <label for="patient-email" class="patient-label"
				        ><span>Correo electrónico</span><span
				          class="patient-optional"
				          aria-hidden="true">Opcional</span
				        ></label
				      >
				      <input
				        id="patient-email"
				        aria-label="Correo electrónico"
				        name="patient_email"
				        maxlength={data.integration ? 254 : undefined}
				        type="email"
				        autocomplete="email"
				        value={String(values.patient_email ?? "")}
				        class="ux-input patient-control"
				      />
				    </div>
				  </fieldset>

				  {#if data.turnstileSiteKey}
				    <div class="mt-5" bind:this={turnstileContainer}></div>
				  {/if}
				  {#if form?.message}
				    <p class="ux-alert mt-5" role="alert">{form.message}</p>
				  {/if}

				  <button
				    type="submit"
				    disabled={bookingSubmitting || requiresRecovery}
				    class="ux-btn-primary patient-confirm-button"
				  >
				    {bookingSubmitting ? "Confirmando reserva…" : "Confirmar reserva"}
				  </button>

				  <p class="patient-privacy">
				    Tus datos quedan disponibles para el equipo autorizado del consultorio.
				  </p>
				  <p class="patient-next-step">
				    Al confirmar podés agregar el turno al calendario, pedir un cambio o
				    cancelarlo.
				  </p>

				  {#if business?.cancellation_policy}
				    <p class="ux-empty mt-4">{business.cancellation_policy}</p>
				  {/if}
				</form>
