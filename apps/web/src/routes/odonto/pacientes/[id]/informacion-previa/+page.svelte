<script lang="ts">
	import type { PageProps } from './$types';

  import { formatDateTime } from '$lib/utils/format';
  let { data }: PageProps = $props();
</script>
<section class="space-y-6">
  <a class="ux-btn-secondary" href={`/odonto/pacientes/${data.patient.id}`}>Volver a la ficha</a>
  <div><h1 class="ux-title">Información previa de {data.patient.full_name}</h1><p class="mt-2 text-white/65">Datos informados por el paciente. Los campos configurados se incorporan automáticamente al perfil y los envíos anteriores se conservan.</p></div>
  <section class="space-y-4"><h2 class="ux-section-title">Respuestas e historial de envíos</h2>
    {#each data.history as entry (entry.id)}<article class="ux-soft-card p-5"><h3 class="font-semibold">{formatDateTime(entry.created_at, data.timezone)}</h3><dl class="mt-4 grid gap-4 sm:grid-cols-2">{#each entry.responses as response}<div><dt class="text-sm text-white/60">{response.label}</dt><dd class="mt-1 whitespace-pre-wrap break-words">{response.value}</dd></div>{/each}{#if entry.comment}<div class="sm:col-span-2"><dt class="text-sm text-white/60">Comentario</dt><dd class="mt-1 whitespace-pre-wrap break-words">{entry.comment}</dd></div>{/if}</dl>{#if entry.changes.length}<details class="mt-4"><summary class="cursor-pointer text-sm">Cambios incorporados al perfil por el paciente</summary><dl class="mt-3 space-y-3">{#each entry.changes as change}<div><dt class="font-medium">{change.label}</dt><dd class="whitespace-pre-wrap break-words text-sm text-white/65">Antes: {change.before}<br />Informado: {change.after}</dd></div>{/each}</dl></details>{/if}</article>{:else}<p class="text-white/60">Todavía no hay respuestas enviadas desde las reservas.</p>{/each}
  </section>
  {#if data.limited}<p class="text-white/60">Se muestran los últimos envíos de cada sección. Los anteriores se conservan en el registro del consultorio.</p>{/if}
</section>
