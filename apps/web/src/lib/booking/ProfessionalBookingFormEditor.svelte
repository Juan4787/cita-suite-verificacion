<script lang="ts">
  import { guardUnsavedChanges } from "$lib/ui/confirm-action";
  import { onMount, untrack, tick } from "svelte";
  import { revealInvalidFields } from "$lib/client/reveal-invalid-fields";
  import { enhance } from "$app/forms";
  import BookingQuestionDetails from "./BookingQuestionDetails.svelte";
  import type { BookingIntakeField } from "@cita-suite/shared/booking-integration";
  let { professional, configuration }: {
    professional: { id: string; name: string };
    configuration: { revision: number; fields: BookingIntakeField[] } | null;
  } = $props();
  let fields = $state<BookingIntakeField[]>(
    untrack(() => structuredClone(configuration?.fields ?? [])),
  );
  let saving = $state(false);
  let ready = $state(false);
  let expandedQuestion = $state<string | null>(null);
  let dirty = $state(false);
  let version = $state(
    untrack(() => `${professional.id}:${configuration?.revision ?? 0}`),
  );
  let revision = $state(untrack(() => configuration?.revision ?? 0));
  const targets: Array<{
    value: NonNullable<BookingIntakeField["patientField"]>;
    label: string;
    kind: "text" | "textarea";
  }> = [
    { value: "insurance", label: "Obra social", kind: "text" },
    { value: "insurance_plan", label: "Plan de obra social", kind: "text" },
    { value: "age", label: "Edad", kind: "text" },
    { value: "birth_date", label: "Fecha de nacimiento", kind: "text" },
    { value: "medication", label: "Medicación actual", kind: "textarea" },
    { value: "background", label: "Antecedentes", kind: "textarea" },
    { value: "allergies", label: "Alergias", kind: "textarea" },
    { value: "dni", label: "DNI", kind: "text" },
    { value: "address", label: "Domicilio", kind: "text" },
  ];
  const custom = $derived(
    fields.filter(
      (field) => !targets.some((target) => target.value === field.patientField),
    ),
  );
  onMount(() => {
    ready = true;
  });
  $effect(() => {
    const next = `${professional.id}:${configuration?.revision ?? 0}`;
    if (next !== version && !dirty) {
      fields = structuredClone(configuration?.fields ?? []);
      revision = configuration?.revision ?? 0;
      version = next;
    }
  });
  guardUnsavedChanges(
    () => dirty,
    "Tenés preguntas sin guardar.",
    () => {
      dirty = false;
      fields = structuredClone(configuration?.fields ?? []);
      revision = configuration?.revision ?? 0;
      version = "";
    },
  );
  function id() {
    return "q_" + crypto.randomUUID().replaceAll("-", "");
  }
  function toggle(target: (typeof targets)[number], checked: boolean) {
    dirty = true;
    if (checked)
      fields = [
        ...fields,
        {
          id: id(),
          label: target.label,
          kind: target.kind,
          maxLength: target.kind === "textarea" ? 2000 : 500,
          required: false,
          patientField: target.value,
        },
      ];
    else fields = fields.filter((field) => field.patientField !== target.value);
  }
  function remove(field: BookingIntakeField) {
    fields = fields.filter((item) => item.id !== field.id);
    dirty = true;
  }
  function add() {
    const questionId = id();
    fields = [
      ...fields,
      {
        id: questionId,
        label: "",
        kind: "text",
        maxLength: 500,
        required: false,
        patientField: "custom",
      },
    ];
    expandedQuestion = questionId;
    dirty = true;
    tick().then(() =>
      document
        .querySelector<HTMLInputElement>(
          `[data-question-id="${questionId}"] input[type="text"], [data-question-id="${questionId}"] input:not([type])`,
        )
        ?.focus(),
    );
  }
  function move(field: BookingIntakeField) {
    const index = fields.findIndex((item) => item.id === field.id);
    if (index > 0) {
      [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
      dirty = true;
    }
  }
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<form
  method="POST"
  action="?/save_form"
  use:revealInvalidFields
  use:enhance={() => {
    saving = true;
    return async ({ result, update }) => {
      try {
        if (result.type === "success") dirty = false;
        await update({
          reset: false,
          invalidateAll: result.type === "success",
        });
      } finally {
        saving = false;
      }
    };
  }}
  class="question-editor"
  data-editor-ready={ready}
>
  <input type="hidden" name="revision" value={revision} /><input
    type="hidden"
    name="fields"
    value={JSON.stringify(fields)}
  />
  <div>
    <h2 class="ux-section-title">Preguntas al paciente</h2>
    <p class="mt-2 text-sm text-white/75">
      El paciente responde al reservar. Sus respuestas quedan en su ficha.
    </p>
  </div>
  <fieldset disabled={!ready || saving} class="mt-6">
    <legend class="text-base font-semibold">Datos habituales</legend>
    <div class="mt-3 divide-y divide-white/10">
      {#each targets as target}
        {@const field = fields.find(
          (item) => item.patientField === target.value,
        )}
        <div class="question-row" data-question-id={field?.id}>
          <div class="question-controls">
            <label
              class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3"
              ><input
                type="checkbox"
                checked={!!field}
                disabled={!field && fields.length >= 24}
                onchange={(event) =>
                  toggle(target, event.currentTarget.checked)}
              /><span>{field?.label || target.label}</span></label
            >{#if field}<label class="flex min-h-11 items-center gap-2 text-sm"
                ><input
                  type="checkbox"
                  bind:checked={field.required}
                  onchange={() => (dirty = true)}
                />Obligatorio</label
              >{/if}
          </div>
          {#if field}<details class="question-details">
              <summary>Editar pregunta</summary>
              <div class="py-4">
                <BookingQuestionDetails
                  {field}
                  onchange={(changes) => {
                    Object.assign(field, changes);
                    dirty = true;
                  }}
                />
              </div>
            </details>{/if}
        </div>
      {/each}
    </div>
  </fieldset>
  <fieldset disabled={!ready || saving} class="mt-8">
    <legend class="text-base font-semibold">Otras preguntas</legend>
    {#if !custom.length}<p class="mt-2 text-sm text-white/75">
        Agregá una pregunta si necesitás otro dato.
      </p>{/if}
    <div class="mt-3 divide-y divide-white/10">
      {#each custom as field (field.id)}<div
          class="question-row"
          data-question-id={field.id}
        >
          <div class="question-controls">
            <span class="min-w-0 flex-1 font-medium"
              >{field.label || "Nueva pregunta"}</span
            ><label class="flex min-h-11 items-center gap-2 text-sm"
              ><input
                type="checkbox"
                bind:checked={field.required}
                onchange={() => (dirty = true)}
              />Obligatorio</label
            ><button
              type="button"
              class="text-sm underline underline-offset-4"
              onclick={() => remove(field)}>Eliminar</button
            >
          </div>
          <details
            class="question-details"
            open={expandedQuestion === field.id}
          >
            <summary>Editar pregunta</summary>
            <div class="py-4">
              <BookingQuestionDetails
                {field}
                onchange={(changes) => {
                  Object.assign(field, changes);
                  dirty = true;
                }}
              />
            </div>
          </details>
        </div>{/each}
    </div>
    <button
      type="button"
      class="ux-btn-secondary mt-4"
      disabled={fields.length >= 24}
      onclick={add}>Agregar pregunta</button
    >
  </fieldset>
  {#if fields.length > 1}<details class="mt-7">
      <summary class="cursor-pointer min-h-11">Orden de las preguntas</summary>
      <ol class="divide-y divide-white/10">
        {#each fields as field, index (field.id)}<li
            class="flex min-h-14 items-center justify-between gap-4 py-2"
          >
            <span>{index + 1}. {field.label || "Nueva pregunta"}</span><button
              type="button"
              class="ux-btn-secondary"
              disabled={index === 0 || saving}
              onclick={() => move(field)}>Subir</button
            >
          </li>{/each}
      </ol>
    </details>{/if}
  <div class="question-footer">
    <button class="ux-btn-primary" type="submit" disabled={!ready || saving}
      >{saving ? "Guardando…" : "Guardar preguntas"}</button
    >{#if dirty}<span class="text-sm text-amber-100">Cambios sin guardar</span
      >{/if}
  </div>
  <noscript
    ><p class="ux-alert mt-4">
      Activá JavaScript para editar las preguntas. Las preguntas guardadas se
      conservan.
    </p></noscript
  >
</form>

<style>
  .question-editor {
    max-width: 52rem;
  }
  .question-row {
    padding: 0.75rem 0;
  }
  .question-controls {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }
  .question-details {
    padding-left: 2rem;
  }
  .question-details summary {
    cursor: pointer;
    width: fit-content;
    min-height: 2.5rem;
    display: flex;
    align-items: center;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .question-details summary:hover {
    color: var(--text);
  }
  .question-footer {
    display: flex;
    gap: 1rem;
    align-items: center;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    margin-top: 2rem;
    padding-top: 1.5rem;
  }
  @media (max-width: 480px) {
    .question-controls {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .question-controls > label:first-child {
      flex-basis: 55%;
    }
    .question-details {
      padding-left: 0;
    }
    .question-controls :global(input) {
      flex-shrink: 0;
    }
  }
</style>
