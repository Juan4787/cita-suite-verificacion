<script lang="ts">
  import { guardUnsavedChanges, confirmAction } from "$lib/ui/confirm-action";
  import { styledDate, styledSelect } from "$lib/ui/styled-controls";
  import { enhance } from "$app/forms";
  import {
    previewMonthlyPrices,
    MAX_PRICE_MONTH_OFFSET,
    PriceConfigurationError,
    formatQuotedPrice,
    type PriceAdjustment,
    type PricePolicy,
  } from "./pricing";
  let {
    services,
    policies = [],
    professionalId,
    currentMonth,
    canEdit = true,
    canConfigureShared = false,
  }: {
    services: Array<{ id: string; name: string }>;
    policies: PricePolicy[];
    professionalId: string;
    currentMonth: string;
    canEdit?: boolean;
    canConfigureShared?: boolean;
  } = $props();
  const feedbackId = $props.id();
  let scope = $state("professional");
  const initialService = () => services[0]?.id ?? "";
  let selected = $state(initialService());
  const initialPolicy = () =>
    policies.find(
      (item) =>
        item.service_id === initialService() &&
        item.professional_id === professionalId,
    );
  const initialBase = () => {
    const policy = initialPolicy();
    return policy ? String(policy.base_amount) : "";
  };
  const initialRate = () => String(initialPolicy()?.monthly_percentage ?? 0);
  const initialRounding = () => String(initialPolicy()?.rounding_unit ?? 1);
  const initialReference = () =>
    (initialPolicy()?.base_month ?? currentMonth).slice(0, 7);
  const nextMonth = (reference: string) => {
    const [year, month] = reference.split("-").map(Number);
    return `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
  };
  const initialFirst = () =>
    initialPolicy()?.first_adjustment_month?.slice(0, 7) ??
    nextMonth(initialReference());
  const initialRevision = () => initialPolicy()?.revision ?? 0;
  const initialAdjustments = () =>
    (initialPolicy()?.service_price_monthly_adjustments ?? []).map(
      (row) => ({
        month: row.month,
        kind: row.kind,
        percentage: row.percentage,
      }),
    );
  let base = $state(initialBase());
  let rate = $state(initialRate());
  let currency = $state("ARS");
  let rounding = $state(initialRounding());
  let baseMonth = $state(initialReference());
  let firstMonth = $state(initialFirst());
  let revision = $state(initialRevision());
  let adjustments = $state<PriceAdjustment[]>(initialAdjustments());
  let saving = $state(false);
  let dirty = $state(false);
  guardUnsavedChanges(
    () => dirty && !saving,
    "Tenés aranceles sin guardar.",
    () => {
      dirty = false;
      appliedPolicyKey = "";
    },
  );
  async function changeSelection(event: Event, field: "scope" | "service") {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value;
    select.value = field === "scope" ? scope : selected;
    if (dirty && !(await confirmAction("Tenés aranceles sin guardar."))) return;
    if (field === "scope") scope = next;
    else selected = next;
  }
  const initialPolicyKey = () =>
    initialService() + ":professional:" + initialRevision();
  let appliedPolicyKey = $state(initialPolicyKey());
  $effect(() => {
    const policy = policies.find(
      (item) =>
        item.service_id === selected &&
        item.professional_id ===
          (scope === "service_default" ? null : professionalId),
    );
    const nextKey = selected + ":" + scope + ":" + (policy?.revision ?? 0);
    if (nextKey === appliedPolicyKey) return;
    appliedPolicyKey = nextKey;
    revision = policy?.revision ?? 0;
    base = policy ? String(policy.base_amount) : "";
    rate = String(policy?.monthly_percentage ?? 0);
    currency = policy?.currency ?? "ARS";
    rounding = String(policy?.rounding_unit ?? "1");
    const reference = (policy?.base_month ?? currentMonth).slice(0, 7);
    baseMonth = reference;
    const [year, month] = reference.split("-").map(Number);
    firstMonth =
      policy?.first_adjustment_month?.slice(0, 7) ??
      `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
    adjustments = (policy?.service_price_monthly_adjustments ?? []).map(
      (row) => ({
        month: row.month,
        kind: row.kind,
        percentage: row.percentage,
      }),
    );
    dirty = false;
  });
  const configuration = $derived(
    JSON.stringify({
      base_amount: base.replace(",", "."),
      currency,
      base_month: baseMonth + "-01",
      first_adjustment_month: firstMonth + "-01",
      monthly_percentage: rate.replace(",", "."),
      rounding_unit: rounding.replace(",", "."),
      adjustments,
    }),
  );
  const previewResult = $derived.by(() => {
    if (![base, rate, rounding, baseMonth, firstMonth].every(value => value.trim()))
      return { rows: [], error: null, monthlyError: false };
    try {
      const [baseYear, baseNumber] = baseMonth.split("-").map(Number);
      const [startYear, startNumber] = currentMonth.split("-").map(Number);
      const offset = (startYear - baseYear) * 12 + startNumber - baseNumber;
      // The editor asks for up to six valid results. It must still display the
      // inclusive last month, rather than requesting five out-of-range months.
      const count = Math.min(6, Math.max(1, MAX_PRICE_MONTH_OFFSET - offset + 1));
      return { rows: previewMonthlyPrices(base, rate, rounding, baseMonth, firstMonth, adjustments, count, currentMonth), error: null, monthlyError: false };
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      const monthlyError = cause instanceof PriceConfigurationError && cause.field === 'monthly_percentage';
      const message = monthlyError ? 'El aumento mensual admite valores de 0 a 1.000 %, con hasta cuatro decimales.' : code === 'PRICE_DATE_INVALID'
        ? 'El mes de referencia no puede ser posterior al actual ni tener más de 50 años de antigüedad.'
        : code === 'PRICE_AMOUNT_INVALID'
          ? 'Los ajustes superan el arancel máximo admitido. Reducí el importe o el porcentaje.'
          : 'Revisá el importe, los porcentajes y los meses de los ajustes.';
      return { rows: [], error: message, monthlyError };
    }
  });
  const preview = $derived(previewResult.rows);

</script>

<form
  method="POST"
  action="?/save_price_policy"
  class="ux-card mt-6 price-policy"
  oninput={(event) => {
    if (
      !["price_service_id", "price_scope_choice"].includes(
        (event.target as HTMLInputElement).name,
      )
    )
      dirty = true;
  }}
  use:enhance={() => {
    saving = true;
    return async ({ update, result }) => {
      try {
        await update({
          reset: false,
          invalidateAll: result.type === "success",
        });
      } finally {
        saving = false;
      }
    };
  }}
>
  <fieldset disabled={!canEdit || saving} class="min-w-0">
    <h2 class="ux-section-title">Aranceles y ajustes mensuales</h2>
    <p class="mt-2 text-sm text-white/70">
      El paciente verá el arancel correspondiente a la fecha que elija. Los
      aumentos se acumulan con precisión y el arancel se redondea sólo al
      cotizar cada fecha.
    </p>
    <input type="hidden" name="price_scope" value={scope} /><input
      type="hidden"
      name="price_configuration"
      value={configuration}
    /><input type="hidden" name="price_revision" value={revision} />
    <!-- Shared tariffs are an explicit manager choice, never a sum of individual fees. -->
    {#if canConfigureShared}<label class="ux-label mt-5 block"
        >Tarifa que querés configurar<select
          use:styledSelect={scope}
          name="price_scope_choice"
          value={scope}
          class="ux-input mt-2"
          onchange={(event) => changeSelection(event, "scope")}
          ><option value="professional">Tarifa individual</option><option
            value="service_default">Predeterminada de la prestación</option
          ></select
        ></label
      >{#if scope === "service_default"}<p class="mt-2 text-sm text-white/75">
          Se usa en turnos conjuntos y en individuales sin una tarifa propia. No
          suma los aranceles de los participantes.
        </p>{/if}{/if}
    <div class="mt-5 grid gap-4 sm:grid-cols-2">
      <label class="ux-label"
        >Prestación<select
          use:styledSelect={selected}
          name="price_service_id"
          value={selected}
          onchange={(event) => changeSelection(event, "service")}
          class="ux-input mt-2"
          required
          ><option value="" disabled>Elegí una prestación</option
          >{#each services as service}<option value={service.id}
              >{service.name}</option
            >{/each}</select
        ></label
      >
      <label class="ux-label"
        >Arancel de referencia en pesos enteros<input
          bind:value={base}
          inputmode="numeric"
          pattern="[0-9]+"
          placeholder="20000"
          class="ux-input mt-2"
          required
        /></label
      >
      <label class="ux-label"
        >Mes de referencia<input
          use:styledDate={baseMonth}
          type="month"
          max={currentMonth}
          bind:value={baseMonth}
          class="ux-input mt-2 price-month"
          required
        /></label
      >
      <label class="ux-label"
        >Primer mes con ajuste<input
          use:styledDate={firstMonth}
          type="month"
          bind:value={firstMonth}
          class="ux-input mt-2 price-month"
          required
        /></label
      >
      <label class="ux-label"
        >Aumento mensual desde el primer ajuste (%)<input
          aria-invalid={previewResult.monthlyError || undefined}
          aria-describedby={previewResult.monthlyError ? feedbackId : undefined}
          bind:value={rate}
          inputmode="decimal"
          class="ux-input mt-2"
          required
        /><span class="mt-1 block text-xs text-white/70"
          >0 mantiene el arancel sin aumentos.</span
        ></label
      >
      <label class="ux-label"
        >Redondeo<select
          use:styledSelect={rounding}
          bind:value={rounding}
          class="ux-input mt-2"
          ><option value="1">A pesos</option><option value="100"
            >Al múltiplo de $100 más cercano</option
          ></select
        ></label
      >
    </div>
    <p class="mt-4 text-sm text-white/75">
      Aranceles en pesos argentinos, sin centavos.
    </p>
    <fieldset class="mt-6">
      <legend class="text-base font-bold">Cambios de meses específicos</legend>
      <p class="mt-1 text-sm text-white/70">
        Un cambio de un solo mes reemplaza el porcentaje habitual. Para revisar
        el aumento a partir de un mes, elegí “Desde este mes en adelante”; los
        meses anteriores y las excepciones posteriores se conservan.
      </p>
      {#each adjustments as item, index}<div
          class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1.5fr_auto]"
        >
          <label class="ux-label"
            >Mes<input
              use:styledDate={item.month.slice(0, 7)}
              type="month"
              value={item.month.slice(0, 7)}
              onchange={(event) =>
                (item.month = event.currentTarget.value + "-01")}
              class="ux-input mt-1 price-month"
              required
            /></label
          >
          <label class="ux-label"
            >Aumento (%)<input
              type="number"
              min="0"
              max="1000"
              step="0.0001"
              bind:value={item.percentage}
              class="ux-input mt-1"
              required
            /></label
          >
          <label class="ux-label"
            >Aplicación<select
              use:styledSelect={item.kind}
              bind:value={item.kind}
              class="ux-input mt-1"
              ><option value="override">Sólo este mes</option><option
                value="default">Desde este mes en adelante</option
              ></select
            ></label
          >
          <button
            type="button"
            class="ux-btn-secondary self-end"
            onclick={() => {
              dirty = true;
              adjustments = adjustments.filter((_, i) => i !== index);
            }}
            aria-label={`Quitar cambio ${index + 1}`}>Quitar</button
          >
        </div>{/each}
      <button
        type="button"
        class="ux-btn-secondary mt-3"
        disabled={adjustments.length >= 120}
        onclick={() => {
          dirty = true;
          adjustments = [
            ...adjustments,
            { month: firstMonth + "-01", kind: "override", percentage: 0 },
          ];
        }}>Agregar cambio mensual</button
      >
    </fieldset>
    {#if preview.length}<div class="mt-6 overflow-x-auto">
        <table class="price-preview w-full text-left text-sm">
          <caption class="mb-2 text-left font-bold"
            >Vista previa del arancel</caption
          ><thead
            ><tr
              ><th class="py-2">Mes</th><th class="py-2 text-right">Arancel</th
              ></tr
            ></thead
          ><tbody
            >{#each preview as row}<tr
                ><td class="py-2"
                  >{new Intl.DateTimeFormat("es-AR", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(row.month + "-01T12:00:00Z"))}</td
                ><td class="py-2 pl-3 text-right tabular-nums"
                  >{formatQuotedPrice({ amount: row.amount, currency })}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      </div>{:else if previewResult.error}<p id={feedbackId} role="status" class="ux-alert mt-4">{previewResult.error}</p>{:else}<p class="mt-4 text-sm text-white/70">
        Completá el importe y los meses para ver los aranceles antes de guardar.
      </p>{/if}
    <button
      class="ux-btn-primary mt-5"
      disabled={saving || !preview.length || !selected}
      >{saving ? "Guardando aranceles…" : "Guardar aranceles"}</button
    >
  </fieldset>
</form>

<style>
  .price-preview {
    table-layout: auto;
  }
  .price-preview td:last-child,
  .price-preview th:last-child {
    white-space: nowrap;
    overflow-wrap: normal;
    width: 1%;
  }
  @media (max-width: 639px) {
    .price-policy {
      padding-inline: 1rem;
    }
    .price-month {
      min-width: 0;
      font-size: 1rem;
      padding-inline: 0.25rem;
    }
  }
</style>
