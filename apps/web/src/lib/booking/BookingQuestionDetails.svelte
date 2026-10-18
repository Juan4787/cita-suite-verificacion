<script lang="ts">
  import { styledSelect } from "$lib/ui/styled-controls";
  import type { BookingIntakeField } from "@cita-suite/shared/booking-integration";
  let { field, onchange }: {
    field: BookingIntakeField;
    onchange: (changes: Partial<BookingIntakeField>) => void;
  } = $props();
  function changeKind(kind: BookingIntakeField["kind"]) {
    onchange({
      kind,
      options: kind === "choice" ? [] : undefined,
      maxLength: kind === "text" ? 500 : kind === "textarea" ? 2000 : undefined,
    });
  }
</script>

<div class="grid gap-4 sm:grid-cols-2">
  <label class="sm:col-span-2"
    ><span class="ux-label">Texto de la pregunta</span><input
      class="ux-input mt-2"
      required
      maxlength="120"
      value={field.label}
      oninput={(event) => onchange({ label: event.currentTarget.value })}
    /></label
  >
  <label
    ><span class="ux-label">Respuesta</span><select
      use:styledSelect={field.kind}
      aria-label="Respuesta"
      class="ux-select mt-2"
      value={field.kind}
      disabled={field.patientField === "age" ||
        field.patientField === "birth_date"}
      onchange={(event) =>
        changeKind(event.currentTarget.value as BookingIntakeField["kind"])}
      ><option value="text">Texto corto</option><option value="textarea"
        >Texto largo</option
      ><option value="choice">Elegir una opción</option
      >{#if !field.patientField || field.patientField === "custom"}<option
          value="boolean">Sí o no</option
        >{/if}</select
    ></label
  >
  {#if field.kind === "choice"}<label class="sm:col-span-2"
      ><span class="ux-label">Opciones de respuesta</span><textarea
        class="ux-textarea mt-2"
        rows="3"
        required
        placeholder="Una opción por línea"
        value={field.options?.join("\n") ?? ""}
        oninput={(event) =>
          onchange({
            options: event.currentTarget.value
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
          })}
      ></textarea></label
    >{:else if field.kind === "text" || field.kind === "textarea"}<label
      ><span class="ux-label">Límite de caracteres</span><input
        class="ux-input mt-2"
        type="number"
        min="1"
        max="2000"
        required
        value={field.maxLength}
        oninput={(event) =>
          onchange({ maxLength: event.currentTarget.valueAsNumber })}
      /></label
    >{/if}
</div>
