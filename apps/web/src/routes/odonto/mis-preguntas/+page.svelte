<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Mis preguntas · Cita Suite</title></svelte:head>
<section class="ux-page max-w-3xl">
  <h1 class="ux-title">Preguntas al paciente</h1>
  {#if data.professionals.length}<p class="ux-subtitle">
      Elegí el perfil que querés configurar.
    </p>
    <div class="mt-6 divide-y divide-white/10">
      {#each data.professionals as person}<a
          class="flex min-h-16 items-center justify-between gap-4 py-4 font-semibold"
          href={`/odonto/profesionales/${person.id}/preguntas`}
          >{person.name}<span class="text-sm text-white/70"
            >Configurar preguntas</span
          ></a
        >{/each}
    </div>
  {:else}<p class="ux-empty mt-6">
      Todavía no tenés un perfil profesional vinculado. Pedí al consultorio que
      lo vincule a tu cuenta.
    </p>{/if}
</section>
