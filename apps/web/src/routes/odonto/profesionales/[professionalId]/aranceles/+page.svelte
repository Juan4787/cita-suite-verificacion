<script lang="ts">
	import type { PageProps } from './$types';

  import BackLink from "$lib/components/BackLink.svelte";
  import PricePolicyEditor from "$lib/booking/PricePolicyEditor.svelte";
  let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Aranceles · Cita Suite</title></svelte:head>
<section aria-labelledby="professional-rates-title" class="mx-auto max-w-4xl space-y-5 p-5">
  <BackLink
    href={`/odonto/profesionales/${data.professional.id}?tab=servicios`}
    label="Servicios y aranceles"
  />
  <h1 id="professional-rates-title" class="ux-title">Aranceles de {data.professional.name}</h1>
  {#if form?.message}<p
      class={form.saved ? "ux-success" : "ux-alert"}
      role={form.saved ? "status" : "alert"}
    >
      {form.message}
    </p>{/if}
  {#if !data.canEdit}<p class="ux-alert">
      La edición de aranceles todavía no está habilitada para tu consultorio.
    </p>{/if}
  <PricePolicyEditor
    services={data.services}
    policies={data.policies}
    professionalId={data.professional.id}
    currentMonth={data.currentMonth}
    canEdit={data.canEdit}
    canConfigureShared={data.canConfigureShared}
  />
</section>
