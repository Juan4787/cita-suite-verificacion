<script lang="ts">
  import { guardUnsavedChanges } from "$lib/ui/confirm-action";
  import { styledSelect } from "$lib/ui/styled-controls";
  import { enhance } from "$app/forms";
  import { untrack } from "svelte";
  import BackLink from "$lib/components/BackLink.svelte";
  import BookingShareLink from "$lib/booking/BookingShareLink.svelte";
  let { data, form } = $props();
  let saving = $state("");
  let dirty = $state(false);
  let version = $state(untrack(() => data.business.updated_at ?? ""));
  let maxDays = $state(untrack(() => data.business.max_booking_days_ahead));
  let notice = $state(untrack(() => data.business.min_booking_notice_minutes));
  let policy = $state(untrack(() => data.business.cancellation_policy ?? ""));
  $effect(() => {
    if (!dirty && version !== data.business.updated_at) {
      maxDays = data.business.max_booking_days_ahead;
      notice = data.business.min_booking_notice_minutes;
      policy = data.business.cancellation_policy ?? "";
      version = data.business.updated_at ?? "";
    }
  });
  guardUnsavedChanges(
    () => dirty,
    "Tenés reglas sin guardar.",
    () => {
      dirty = false;
      maxDays = data.business.max_booking_days_ahead;
      notice = data.business.min_booking_notice_minutes;
      policy = data.business.cancellation_policy ?? "";
    },
  );
  const notices = [
    { value: 0, label: "Hasta el momento del turno" },
    { value: 60, label: "1 hora antes" },
    { value: 120, label: "2 horas antes" },
    { value: 360, label: "6 horas antes" },
    { value: 720, label: "12 horas antes" },
    { value: 1440, label: "1 día antes" },
    { value: 2880, label: "2 días antes" },
  ];
</script>

<svelte:head><title>Reserva online · Cita Suite</title></svelte:head>
<svelte:window
  onbeforeunload={(event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<section class="ux-page reservation-page">
  <header>
    <BackLink href="/odonto/configuracion" label="Configuración" class="mb-5" />
    <h1 class="ux-title">Reserva online</h1>
    <p class="ux-subtitle">
      Compartí tu agenda y recibí turnos de tus pacientes.
    </p>
  </header>
  {#if form?.message}<p
      role={form.saved ? "status" : "alert"}
      class={form.saved ? "ux-alert ux-alert-success" : "ux-alert"}
    >
      {form.message}
    </p>{/if}
  <section class="ux-card" aria-labelledby="share-title">
    <div class="reservation-heading">
      <div>
        <h2 id="share-title" class="ux-section-title">
          Agenda de {data.business.name}
        </h2>
        <p class="mt-2 text-sm text-white/75">
          Tus pacientes reservan con los servicios y horarios de tu equipo.
        </p>
      </div>
      <span
        class={data.business.public_booking_enabled &&
        data.canBook &&
        data.business.is_active
          ? "ux-badge ux-badge-success"
          : "ux-badge"}
        >{data.business.public_booking_enabled
          ? data.canBook && data.business.is_active
            ? "Reservas activadas"
            : "Reservas suspendidas"
          : "Reservas pausadas"}</span
      >
    </div>
    <div class="mt-5">
      <BookingShareLink url={`${data.baseURL}/reservar/${data.business.id}`} />
    </div>
    <form
      method="POST"
      action="?/set_enabled"
      use:enhance={() => {
        saving = "activation";
        return async ({ result, update }) => {
          try {
            await update({
              reset: false,
              invalidateAll: result.type === "success",
            });
          } finally {
            saving = "";
          }
        };
      }}
      class="reservation-activation"
    >
      <input
        type="hidden"
        name="revision"
        value={data.business.updated_at ?? ""}
      /><input
        type="hidden"
        name="enabled"
        value={data.business.public_booking_enabled ? "false" : "true"}
      />
      <button
        type="submit"
        class={data.business.public_booking_enabled
          ? "ux-btn-secondary"
          : "ux-btn-primary"}
        disabled={!!saving || dirty}
        >{saving === "activation"
          ? "Guardando…"
          : data.business.public_booking_enabled
            ? "Pausar nuevas reservas"
            : "Activar reservas"}</button
      >
      <span class="text-sm text-white/75"
        >{dirty
          ? "Guardá las reglas antes de cambiar el estado."
          : "Los turnos ya reservados se conservan."}</span
      >
    </form>
    {#if !data.business.address}<p class="mt-4 text-sm text-amber-100">
        Falta la dirección. <a
          class="underline underline-offset-4"
          href="/odonto/configuracion/negocio"
          >Completar datos del consultorio</a
        >
      </p>{/if}
  </section>
  <form
    method="POST"
    action="?/save_rules"
    class="ux-card"
    oninput={() => (dirty = true)}
    use:enhance={() => {
      saving = "rules";
      return async ({ result, update }) => {
        try {
          if (result.type === "success") dirty = false;
          await update({
            reset: false,
            invalidateAll: result.type === "success",
          });
        } finally {
          saving = "";
        }
      };
    }}
  >
    <h2 class="ux-section-title">Reglas para reservar</h2>
    <input
      type="hidden"
      name="revision"
      value={version || data.business.updated_at || ""}
    />
    <fieldset disabled={!!saving} class="mt-5 grid gap-5 sm:grid-cols-2">
      <label
        ><span class="ux-label">¿Hasta cuándo pueden reservar?</span><select
          use:styledSelect={maxDays}
          class="ux-select mt-2"
          name="max_booking_days_ahead"
          bind:value={maxDays}
          >{#if ![15, 30, 60, 90].includes(maxDays)}<option value={maxDays}
              >Próximos {maxDays} días</option
            >{/if}{#each [15, 30, 60, 90] as days}<option value={days}
              >Próximos {days} días</option
            >{/each}</select
        ></label
      >
      <label
        ><span class="ux-label">¿Con cuánta anticipación?</span><select
          use:styledSelect={notice}
          class="ux-select mt-2"
          name="min_booking_notice_minutes"
          bind:value={notice}
          >{#if !notices.some((item) => item.value === notice)}<option
              value={notice}>{notice} minutos antes</option
            >{/if}{#each notices as item}<option value={item.value}
              >{item.label}</option
            >{/each}</select
        ></label
      >
      <label class="sm:col-span-2"
        ><span class="ux-label"
          >Condiciones de cancelación <span class="text-white/65"
            >(opcional)</span
          ></span
        ><textarea
          class="ux-textarea mt-2"
          name="cancellation_policy"
          rows="2"
          maxlength="2000"
          bind:value={policy}
        ></textarea></label
      >
    </fieldset>
    <div class="mt-5 flex flex-wrap items-center gap-3">
      <button class="ux-btn-primary" disabled={!!saving}
        >{saving === "rules" ? "Guardando…" : "Guardar reglas"}</button
      >{#if dirty}<span class="text-sm text-amber-100">Cambios sin guardar</span
        >{/if}
    </div>
  </form>
  {#if data.enabled}<a
      href="/odonto/configuracion/reserva-online/webs"
      class="reservation-web-link"
      ><span
        ><strong class="block">Reservas desde tu sitio web</strong><span
          class="mt-1 block text-sm text-white/75"
          >{data.connectedSites
            ? `${data.connectedSites} sitio${data.connectedSites === 1 ? "" : "s"} configurado${data.connectedSites === 1 ? "" : "s"}`
            : "Configurá e instalá la agenda en tu web."}</span
        ></span
      ><span class="text-sm font-semibold"
        >{data.connectedSites ? "Administrar sitios" : "Agregar sitio"}</span
      ></a
    >{/if}
</section>

<style>
  .reservation-page {
    max-width: 64rem;
    margin-inline: auto;
  }
  .reservation-heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
  }
  .reservation-heading :global(.ux-badge) {
    flex-shrink: 0;
  }
  .reservation-activation {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .reservation-web-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.25rem 0;
    border-block: 1px solid rgba(255, 255, 255, 0.12);
  }
  .reservation-web-link:hover {
    color: var(--accent);
  }
  @media (max-width: 640px) {
    .reservation-heading,
    .reservation-activation {
      flex-direction: column;
      align-items: flex-start;
    }
    .reservation-web-link {
      align-items: flex-start;
    }
    .reservation-web-link > span:last-child {
      max-width: 7rem;
      text-align: right;
    }
  }
</style>
