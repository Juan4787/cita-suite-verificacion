<script lang="ts">
	import type { PublicInformationPageData, PublicInformationFeedback } from '$lib/patients/public-booking-information';

  import PatientDocumentUpload from "$lib/booking/PatientDocumentUpload.svelte";
  import BookingAppearance from "$lib/booking/BookingAppearance.svelte";
  import { enhance } from "$app/forms";
  import { styledSelect } from "$lib/ui/styled-controls";
  import { revealNotice } from "$lib/ui/reveal-notice";
  import { tick } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  let { data, form }: { data: PublicInformationPageData; form?: PublicInformationFeedback | null } = $props();
  let busy = $state(false);
  let transportMessage = $state("");
  let feedback = $state<HTMLParagraphElement>();
  const feedbackText = $derived(transportMessage || form?.message || "");
  const submitInformation: SubmitFunction = () => {
    busy = true;
    transportMessage = "";
    return async ({ update, result }) => {
      try {
        if (result.type === "error") {
          // The action may already have committed. Keep the same request key,
          // accepted version and answers so retry recovers that exact submission.
          transportMessage = "No pudimos comprobar el envío. Conservamos tus datos. Volvé a intentar para comprobar si se guardó.";
        } else {
          await update({ reset: false, invalidateAll: result.type === "success" });
        }
        await tick();
        revealNotice(feedback);
      } finally {
        busy = false;
      }
    };
  };
  const initialAnswers = () =>
    Object.fromEntries(
      data.info.schema.map((field: { id: string }) => [
        field.id,
        String((form?.submitted?.answers ?? data.info.answers)[field.id] ?? ""),
      ]),
    );
  let answers = $state<Record<string, string>>(initialAnswers());
  const initialComment = () => form?.submitted?.comment ?? data.info.comment;
  let comment = $state(initialComment());
  const infoKey = () =>
    data.token + ":" + data.info.version + ":" + data.info.schema_hash;
  let appliedInfoKey = $state(infoKey());
  $effect(() => {
    const nextKey = infoKey();
    if (nextKey !== appliedInfoKey) {
      answers = Object.fromEntries(
        data.info.schema.map((field: { id: string }) => [
          field.id,
          String((form?.submitted?.answers ?? data.info.answers)[field.id] ?? ""),
        ]),
      );
      comment = initialComment();
      appliedInfoKey = nextKey;
    }
  });
</script>

<svelte:head><title>{data.businessName ? `Información para tu consulta · ${data.businessName}` : 'Información para tu consulta'}</title></svelte:head>
<BookingAppearance theme={data.info.theme}>
<main class="min-h-screen bg-fill-06111f px-4 py-6 text-fg sm:py-10 bk-text">
<div class="mx-auto max-w-2xl space-y-6">
  <a class="ux-btn-secondary" href={data.managementUrl}>Volver a mi turno</a>
  <div><h1 class="ux-title">Información para tu consulta</h1><p class="mt-3 text-fg-65 bk-muted">Tu turno ya está reservado. Podés ampliar los datos para la profesional. Los campos configurados se guardan automáticamente en tu perfil y los envíos anteriores se conservan.</p></div>
  {#if feedbackText}<p bind:this={feedback} tabindex="-1" class="ux-alert" role="alert">{feedbackText}</p>{/if}
  <form method="POST" action="?/save" use:enhance={submitInformation} class="ux-soft-card space-y-4 p-5">
    <fieldset disabled={busy} class="space-y-4">
    <input type="hidden" name="request_key" value={form?.submitted?.requestKey ?? data.requestKey} /><input type="hidden" name="schema_hash" value={form?.submitted?.schemaHash ?? data.info.schema_hash} /><input type="hidden" name="version" value={form?.submitted?.version ?? data.info.version} />
    {#each data.info.schema as field (field.id)}
      <label class="block"><span class="ux-label">{field.label}{field.required ? ' *' : ' (opcional)'}</span>
        {#if field.kind === 'textarea'}<textarea class="ux-textarea" name={'intake_' + field.id} required={field.required} maxlength={field.maxLength} rows="3" bind:value={answers[field.id]}></textarea>
        {:else if field.kind === 'text'}<input type={field.patientField === 'birth_date' ? 'date' : field.patientField === 'age' ? 'number' : 'text'} min={field.patientField === 'age' ? 0 : undefined} max={field.patientField === 'age' ? 130 : undefined} class="ux-input" name={'intake_' + field.id} required={field.required} maxlength={field.maxLength} bind:value={answers[field.id]} />
        {:else}<select use:styledSelect={answers[field.id]} class="ux-select" required={field.required} name={'intake_' + field.id} bind:value={answers[field.id]}><option value="">Sin responder</option>{#if field.kind === 'boolean'}<option value="true">Sí</option><option value="false">No</option>{:else}{#each field.options ?? [] as option}<option value={option}>{option}</option>{/each}{/if}</select>{/if}
        {#if field.help}<span class="mt-1 block text-sm text-fg-60 bk-muted">{field.help}</span>{/if}
      </label>
    {/each}
    <label class="block"><span class="ux-label">Comentario adicional (opcional)</span><textarea class="ux-textarea" name="comment" maxlength="2000" rows="3" bind:value={comment}></textarea></label>
    <p class="text-sm text-fg-60 bk-muted">Los datos quedan privados para el equipo clínico. Tu reserva se conserva si un envío falla.</p>
    <button class="ux-btn-primary" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar información'}</button>
    </fieldset>
  </form>
  {#if data.info.documents_enabled}<PatientDocumentUpload endpoint={data.documentsUrl}/>{/if}
</div>
</main>
</BookingAppearance>
