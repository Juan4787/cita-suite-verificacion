<script lang="ts">
 import { SLOT_RELEASE_REASONS, slotReleaseHref, type SlotReleaseListView } from '$lib/scheduling/slot-releases';
 import { formatInTimeZone } from '$lib/utils/format';
 let { list, timezone, canOperate, demo, query = '' }: {
  list: SlotReleaseListView; timezone: string; canOperate: boolean; demo: boolean; query?: string;
 } = $props();
 const params = $derived([...new URLSearchParams(query)].filter(([key]) => !key.startsWith('/')));
 const preserved = $derived(params.filter(([key]) => key !== 'dias_liberados' && key !== 'pagina_liberados'));
 const action = $derived(`?${new URLSearchParams(params)}${params.length ? '&' : ''}/hide_slot_release`);
 const windows = $derived([...new Set([7, 14, 30, 60, list.days])].sort((a, b) => a - b));
 const pageHref = (page: number) => {
  const next = new URLSearchParams(params);
  next.set('dias_liberados', String(list.days));next.set('pagina_liberados', String(page));
  return `?${next}#horarios-liberados`;
 };
</script>

<details id="horarios-liberados" data-slot-release-alert class="ux-soft-card p-4 sm:p-5" open={list.items === null || list.items.length > 0 || list.page > 1}>
 <summary class="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 font-bold text-amber-200">
  <span>Horarios que se liberaron</span>
  {#if list.items && list.items.length > 0}<span class="ux-badge ux-badge-warning">{list.items.length} en esta página</span>{/if}
 </summary>
 <p class="mt-3 text-sm text-white/65">Siguen libres al revisar la agenda. Las correcciones de menos de <span class="whitespace-nowrap">30 minutos</span> no generan avisos.</p>
 <form method="GET" action="/odonto/agenda#horarios-liberados" class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
  {#each preserved as [name, value]}<input type="hidden" {name} {value} />{/each}
  <label class="flex min-w-0 flex-1 flex-col gap-2 text-sm text-white/70">
   <span>Ver próximos días</span>
   <select name="dias_liberados" value={String(list.days)} class="ux-input" disabled={demo}>
    {#each windows as days}<option value={String(days)}>{days} días</option>{/each}
   </select>
  </label>
  <button class="ux-btn-secondary" disabled={demo}>Actualizar</button>
 </form>
 {#if list.items === null}
  <p class="ux-alert mt-4" role="alert">No pudimos comprobar los horarios liberados. Recargá la agenda antes de reasignarlos.</p>
 {:else if list.items.length === 0}
  <p class="mt-4 text-sm text-white/60">No hay horarios liberados para mostrar en este rango.</p>
 {:else}
  <div class="mt-4 grid gap-3">
   {#each list.items as release (release.id)}
    <div class="rounded-xl border border-white/10 p-3 sm:p-4" data-slot-release={release.id}>
     <p class="break-words font-bold text-white">{release.professionalName}</p>
     <p class="mt-1 text-sm text-white/80">{formatInTimeZone(release.startsAt, timezone).full}</p>
     <p class="mt-2 text-sm text-amber-200">{SLOT_RELEASE_REASONS[release.reason]}</p>
     {#if demo}
      <div class="mt-3 flex flex-col gap-2 sm:flex-row"><button class="ux-btn-primary" disabled>Dar este horario</button><button class="ux-btn-secondary" disabled>Ocultar</button></div>
     {:else if canOperate}
      <div class="mt-3 flex flex-col gap-2 sm:flex-row">
       <a href={slotReleaseHref(release, timezone)} class="ux-btn-primary">Dar este horario</a>
       <form method="POST" {action}>
        <input type="hidden" name="release_id" value={release.id} />
        <button class="ux-btn-secondary w-full">Ocultar</button>
       </form>
      </div>
     {/if}
    </div>
   {/each}
  </div>
 {/if}
 {#if list.page > 1 || list.truncated}
  <nav class="mt-4 flex flex-wrap items-center gap-3" aria-label="Páginas de horarios liberados">
   {#if list.page > 1}<a href={pageHref(list.page - 1)} class="ux-btn-secondary">Anteriores</a>{/if}
   <span class="text-sm text-white/60">Página {list.page}</span>
   {#if list.truncated && list.page < 1001}<a href={pageHref(list.page + 1)} class="ux-btn-secondary">Más horarios</a>{/if}
  </nav>
 {/if}
 {#if list.truncated && list.page >= 1001}<p class="mt-3 text-sm text-white/65">Hay más horarios. Elegí un rango más corto para revisarlos.</p>{/if}
</details>
