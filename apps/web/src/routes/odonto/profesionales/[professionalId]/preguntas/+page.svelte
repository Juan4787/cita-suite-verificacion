<script lang="ts">
  import ProfessionalBookingFormEditor from "$lib/booking/ProfessionalBookingFormEditor.svelte";
  import BackLink from "$lib/components/BackLink.svelte";
  let { data, form } = $props();
</script>

<svelte:head
  ><title>Preguntas de {data.professional.name} · Cita Suite</title
  ></svelte:head
>
<section class="ux-page mx-auto max-w-5xl">
  <header>
    <BackLink
      href={data.canManage
        ? `/odonto/profesionales/${data.professional.id}`
        : "/odonto/mis-turnos"}
      label={data.canManage ? "Perfil profesional" : "Mis turnos"}
      class="mb-5"
    />
    <h1 class="ux-title">{data.professional.name}</h1>
  </header>
  {#if data.canManage}<nav
      aria-label="Configuración del profesional"
      class="professional-navigation"
    >
      {#each [{ id: "perfil", label: "Perfil" }, { id: "servicios", label: "Servicios y aranceles" }, { id: "horarios", label: "Horarios" }] as tab}<a
          href={`/odonto/profesionales/${data.professional.id}?tab=${tab.id}`}
          >{tab.label}</a
        >{/each}<span aria-current="page">Preguntas al paciente</span>
    </nav>{/if}
  {#if form?.message}<p
      class={form.formSaved ? "ux-alert ux-alert-success" : "ux-alert"}
      role={form.formSaved ? "status" : "alert"}
    >
      {form.message}
    </p>{/if}
  <section class="ux-card">
    {#if data.enabled}<ProfessionalBookingFormEditor
        professional={data.professional}
        configuration={data.configuration}
      />{:else}<p class="ux-empty">
        Las preguntas de reserva todavía no están habilitadas.
      </p>{/if}
  </section>
</section>

<style>
  .professional-navigation {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }
  .professional-navigation a,
  .professional-navigation span {
    padding: 0.875rem 1rem;
    min-height: 2.75rem;
    font-size: 0.9375rem;
  }
  .professional-navigation span {
    color: var(--accent);
    border-bottom: 2px solid currentColor;
  }
  .professional-navigation a:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  @media (max-width: 480px) {
    .professional-navigation {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .professional-navigation a,
    .professional-navigation span {
      padding: 0.75rem 0.5rem;
    }
  }
</style>
