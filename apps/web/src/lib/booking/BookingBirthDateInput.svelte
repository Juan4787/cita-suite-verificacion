<script lang="ts">
  import { onMount, untrack } from "svelte";
  let {
    name,
    label,
    value = "",
    required = false,
    helpId,
    today = new Date().toISOString().slice(0, 10),
  }: {
    name: string;
    label: string;
    value?: string;
    required?: boolean;
    helpId?: string;
    today?: string;
  } = $props();
  const initial = () =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-") : ["", "", ""];
  let year = $state(untrack(initial)[0]);
  let month = $state(untrack(initial)[1]);
  let day = $state(untrack(initial)[2]);
  let sourceValue = $state(untrack(() => value));
  let touched = $state(false);
  let enhanced = $state(false);
  let fallbackInput = $state<HTMLInputElement | null>(null);
  let dayInput = $state<HTMLInputElement | null>(null);
  onMount(() => {
    // Preserve a date entered before hydration replaces the native control.
    if (fallbackInput?.value)
      [year, month, day] = fallbackInput.value.split("-");
    enhanced = true;
  });
  $effect(() => {
    if (value !== sourceValue) {
      [year, month, day] = initial();
      sourceValue = value;
    }
  });
  const empty = $derived(!year && !month && !day);
  const dateValue = $derived.by(() => {
    if (
      !/^\d{4}$/.test(year) ||
      !/^\d{1,2}$/.test(month) ||
      !/^\d{1,2}$/.test(day)
    )
      return "";
    const y = Number(year),
      m = Number(month),
      d = Number(day);
    const candidate = new Date(0);
    candidate.setUTCHours(0, 0, 0, 0);
    candidate.setUTCFullYear(y, m - 1, d);
    return y >= 1 &&
      candidate.getUTCFullYear() === y &&
      candidate.getUTCMonth() === m - 1 &&
      candidate.getUTCDate() === d
      ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
      : "";
  });
  const earliest = $derived.by(() => {
    const [year, month, day] = today.split("-").map(Number);
    const y = year - 130;
    const d = Math.min(day, new Date(Date.UTC(y, month, 0)).getUTCDate());
    return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
  const message = $derived(
    empty && !required
      ? ""
      : !dateValue
        ? "Completá una fecha válida con día, mes y año."
        : dateValue > today || dateValue < earliest
          ? "La fecha debe estar dentro de los últimos 130 años y no puede ser futura."
          : "",
  );
  $effect(() => dayInput?.setCustomValidity(message));
  const clean = (value: string, length: number) =>
    value.replace(/\D/g, "").slice(0, length);
</script>

{#if !enhanced}
  <input
    bind:this={fallbackInput}
    type="date"
    {name}
    {value}
    {required}
    min={earliest}
    max={today}
    aria-label={label}
    aria-describedby={helpId}
    autocomplete="bday"
    class="ux-input patient-control"
  />
{:else}
  <input type="hidden" {name} value={dateValue} />
  <div
    class="patient-birth-date"
    role="group"
    aria-label={label}
    aria-describedby={helpId}
    onfocusout={(event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        touched = true;
    }}
  >
    <label
      ><span class="patient-date-part-label">Día</span><input
        bind:this={dayInput}
        class="ux-input patient-control"
        aria-label={`${label}: día`}
        inputmode="numeric"
        autocomplete="bday-day"
        placeholder="DD"
        maxlength="2"
        {required}
        bind:value={day}
        oninput={() => (day = clean(day, 2))}
        oninvalid={() => (touched = true)}
      /></label
    >
    <label
      ><span class="patient-date-part-label">Mes</span><input
        class="ux-input patient-control"
        aria-label={`${label}: mes`}
        inputmode="numeric"
        autocomplete="bday-month"
        placeholder="MM"
        maxlength="2"
        {required}
        bind:value={month}
        oninput={() => (month = clean(month, 2))}
      /></label
    >
    <label
      ><span class="patient-date-part-label">Año</span><input
        class="ux-input patient-control"
        aria-label={`${label}: año`}
        inputmode="numeric"
        autocomplete="bday-year"
        placeholder="AAAA"
        maxlength="4"
        {required}
        bind:value={year}
        oninput={() => (year = clean(year, 4))}
      /></label
    >
  </div>
  {#if touched && message}<p class="patient-field-error" role="status">
      {message}
    </p>{/if}
{/if}
