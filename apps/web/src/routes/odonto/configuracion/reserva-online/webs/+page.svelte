<script lang="ts">
  import { guardUnsavedChanges } from "$lib/ui/confirm-action";
  import { styledSelect, styledTime } from "$lib/ui/styled-controls";
  import { enhance } from "$app/forms";
  import { page } from "$app/stores";
  import { onMount, untrack } from "svelte";
  import BackLink from "$lib/components/BackLink.svelte";
  import BookingInstallation from "$lib/booking/BookingInstallation.svelte";
  import { revealInvalidFields } from "$lib/client/reveal-invalid-fields";
  import type {
    BookingIntakeField,
    BookingModalityWindow,
  } from "@turnos-saas/shared/booking-integration";
  let { data, form } = $props();
  const profile = $derived(
    data.profiles.find((item) => item.id === data.selectedId),
  );
  const editing = $derived(!!profile || data.isNew);
  const installing = $derived(!!profile && $page.url.searchParams.get('instalar') === '1');
  function initial() {
    const row = profile;
    const publicProfessionals = data.professionals
      .filter((person) => person.is_active && person.is_public)
      .map((person) => person.id);
    const selectedProfessionals = row?.allowed_professional_ids?.length
      ? row.allowed_professional_ids
      : publicProfessionals;
    const offeredServices = data.services
      .filter(
        (service) =>
          service.is_active &&
          service.is_public &&
          data.assignments.some(
            (assignment) =>
              assignment.service_id === service.id &&
              selectedProfessionals.includes(assignment.professional_id),
          ),
      )
      .map((service) => service.id);
    const sameSelection = (left: string[], right: string[]) =>
      left.length === right.length && left.every((id) => right.includes(id));
    return {
      key: `${row?.id ?? "new"}:${row?.revision ?? 0}`,
      name: row?.name ?? "",
      theme: row?.theme ?? "cita-suite",
      origins: row?.allowed_origins?.length ? [...row.allowed_origins] : [""],
      professionalIds: [...(row?.allowed_professional_ids ?? [])],
      serviceIds: [...(row?.allowed_service_ids ?? [])],
      limitProfessionals:
        !!row?.allowed_professional_ids?.length &&
        !sameSelection(row.allowed_professional_ids, publicProfessionals),
      limitServices:
        !!row?.allowed_service_ids?.length &&
        !sameSelection(row.allowed_service_ids, offeredServices),
      video: row?.allowed_modalities?.includes("video") ?? false,
      videoInstructions: row?.video_instructions ?? "",
      isDefault: row?.is_default ?? false,
      active: row?.is_active ?? false,
      fields: structuredClone(row?.intake_schema ?? []) as BookingIntakeField[],
      windows: structuredClone(
        row?.modality_windows ?? [],
      ) as BookingModalityWindow[],
    };
  }
  let draft = $state(untrack(initial));
  let dirty = $state(false);
  let saving = $state(false);
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  $effect(() => {
    const key = `${profile?.id ?? "new"}:${profile?.revision ?? 0}`;
    if (!dirty && key !== draft.key) draft = initial();
  });
  guardUnsavedChanges(
    () => dirty,
    "Tenés una conexión sin guardar.",
    () => {
      dirty = false;
      draft = initial();
    },
  );
  const chosenProfessionals = $derived(
    draft.limitProfessionals
      ? draft.professionalIds
      : data.professionals
          .filter((p) => p.is_active && p.is_public)
          .map((p) => p.id),
  );
  const eligibleServices = $derived(
    data.services.filter(
      (service) =>
        service.is_active &&
        service.is_public &&
        data.assignments.some(
          (a) =>
            a.service_id === service.id &&
            chosenProfessionals.includes(a.professional_id),
        ),
    ),
  );
  const chosenServices = $derived(
    draft.limitServices
      ? draft.serviceIds
      : eligibleServices.map((service) => service.id),
  );
  const weekdays = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
  ];
  function selectProfessional(id: string, checked: boolean) {
    draft.professionalIds = checked
      ? [...draft.professionalIds, id]
      : draft.professionalIds.filter((value) => value !== id);
    dirty = true;
  }
  function selectService(id: string, checked: boolean) {
    draft.serviceIds = checked
      ? [...draft.serviceIds, id]
      : draft.serviceIds.filter((value) => value !== id);
    dirty = true;
  }
  function addWindow() {
    draft.windows = [
      ...draft.windows,
      {
        modality: "in_person",
        weekday: 1,
        startTime: "09:00",
        endTime: "12:00",
      },
    ];
    dirty = true;
  }
</script>

<svelte:head><title>Sitios web · Cita Suite</title></svelte:head>
<svelte:window
  onbeforeunload={(event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<section class="ux-page web-connections">
  <header>
    <BackLink
      href="/odonto/configuracion/reserva-online"
      label="Reserva online"
      class="mb-5"
    />
    <div class="connection-heading">
      <div>
        <h1 class="ux-title">Reservas en tu sitio web</h1>
        <p class="ux-subtitle">Mostrá tu agenda en una web externa.</p>
      </div>
      {#if !editing && data.enabled}<a class="ux-btn-primary" href="?nuevo=1"
          >Agregar sitio web</a
        >{/if}
    </div>
  </header>
  {#if form?.message}<p role="alert" class="ux-alert">{form.message}</p>{/if}
  {#if $page.url.searchParams.get("guardado") === "1"}<p
      role="status"
      class="ux-alert ux-alert-success"
    >
      Configuración guardada. Completá la instalación en tu web.
    </p>{/if}
  {#if !data.enabled}<p class="ux-empty">
      La conexión con sitios externos todavía no está habilitada.
    </p>
  {:else if !editing}
    {#if data.profiles.length}<div class="divide-y divide-white/10">
        {#each data.profiles as item}<a
            class="connected-site"
            href={`?perfil=${item.id}`}
            ><div class="min-w-0">
              <strong class="block text-lg">{item.name}</strong><span
                class="mt-1 block break-words text-sm text-white/75"
                >{item.allowed_origins.join(" · ") ||
                  "Sitio pendiente de configurar"}</span
              >
            </div>
            <span
              class={item.is_active ? "ux-badge ux-badge-success" : "ux-badge"}
              >{item.is_active ? "Autorizado" : "Pausado"}</span
            ><span class="text-sm font-semibold">Configurar e instalar</span></a
          >{/each}
      </div>
    {:else}<div class="ux-card">
        <h2 class="ux-section-title">Agregá el sitio donde querés mostrar la agenda</h2>
        <p class="mt-2 text-white/75">
          Podés seguir compartiendo el enlace de tu agenda.
        </p>
      </div>{/if}
  {:else}
    {#if profile}<BookingInstallation baseURL={data.baseURL} {profile}/>{/if}
    <details class="connection-editor" open={!installing}>
      <summary>{profile ? 'Editar configuración de ' + profile.name : 'Paso 1 · Configurar el sitio'}</summary>
    <form
      method="POST"
      action="?/save"
      data-editor-ready={ready}
      use:revealInvalidFields
      class="ux-card"
      oninput={() => (dirty = true)}
      use:enhance={() => {
        saving = true;
        return async ({ result, update }) => {
          try {
            if (result.type === "redirect" || result.type === "success")
              dirty = false;
            await update({
              reset: false,
              invalidateAll: result.type === "success",
            });
          } finally {
            saving = false;
          }
        };
      }}
    >
      <input type="hidden" name="id" value={profile?.id ?? ""} /><input
        type="hidden"
        name="revision"
        value={profile?.revision ?? ""}
      /><input
        type="hidden"
        name="intake_schema"
        value={JSON.stringify(draft.fields)}
      /><input
        type="hidden"
        name="modality_windows"
        value={JSON.stringify(draft.windows)}
      />
      {#each chosenProfessionals as id}<input
          type="hidden"
          name="professional_ids"
          value={id}
        />{/each}{#each chosenServices as id}<input
          type="hidden"
          name="service_ids"
          value={id}
        />{/each}
      <fieldset disabled={!ready || saving} class="space-y-7">
        <h2 class="ux-section-title">
          {profile ? "Configuración del sitio" : "Elegir la agenda de tu web"}
        </h2>
        <label class="block"
          ><span class="ux-label">Nombre del sitio</span><input
            class="ux-input mt-2"
            name="name"
            required
            maxlength="120"
            placeholder="Web del consultorio"
            bind:value={draft.name}
          /></label
        >
        <fieldset>
          <legend class="ux-label">Dirección de la web</legend>
          <div class="mt-2 space-y-3">
            {#each draft.origins as origin, index}<div class="domain-row">
                <label class="min-w-0 flex-1"
                  ><span class="sr-only">Dirección web {index + 1}</span><input
                    class="ux-input"
                    type="url"
                    inputmode="url"
                    name="origins"
                    required
                    maxlength="300"
                    pattern="https?://[^\s\/?#]+\/?"
                    title="Usá el dominio completo, como https://tu-sitio.com, sin páginas ni textos adicionales."
                    placeholder="https://tu-sitio.com"
                    bind:value={draft.origins[index]}
                  /></label
                >{#if draft.origins.length > 1}<button
                    class="ux-btn-secondary"
                    type="button"
                    aria-label={`Eliminar dirección web ${index + 1}`}
                    onclick={() => {
                      draft.origins = draft.origins.filter(
                        (_, n) => n !== index,
                      );
                      dirty = true;
                    }}>Eliminar</button
                  >{/if}
              </div>{/each}
          </div>
          <button
            type="button"
            class="text-sm underline underline-offset-4 mt-3"
            disabled={draft.origins.length >= 20}
            onclick={() => {
              draft.origins = [...draft.origins, ""];
              dirty = true;
            }}>Agregar otra dirección web</button
          >
        </fieldset>
        <section>
          <h3 class="ux-label">Agenda que se mostrará</h3>
          <label class="flex min-h-11 items-center gap-3 mt-2"
            ><input
              type="radio"
              name="scope"
              value="all"
              checked={!draft.limitProfessionals}
              onchange={() => {
                draft.limitProfessionals = false;
                dirty = true;
              }}
            />Todo el equipo actual</label
          ><label class="flex min-h-11 items-center gap-3"
            ><input
              type="radio"
              name="scope"
              value="selected"
              checked={draft.limitProfessionals}
              onchange={() => {
                draft.limitProfessionals = true;
                dirty = true;
              }}
            />Sólo algunos profesionales</label
          >
          {#if draft.limitProfessionals}<fieldset class="mt-3 space-y-2">
              <legend class="sr-only">Elegir profesionales</legend
              >{#each data.professionals as person}<label
                  class="flex min-h-11 items-center gap-3"
                  ><input
                    type="checkbox"
                    checked={draft.professionalIds.includes(person.id)}
                    onchange={(event) =>
                      selectProfessional(
                        person.id,
                        event.currentTarget.checked,
                      )}
                  /><span
                    >{person.name}{!person.is_active || !person.is_public
                      ? " · No recibe reservas online"
                      : ""}</span
                  ></label
                >{/each}
            </fieldset>{/if}
          <p class="mt-3 text-sm text-white/75">
            Servicios y horarios ya configurados en Equipo.
          </p>
        </section>
        <details class="connection-options">
          <summary>Opciones de esta web</summary>
          <div class="space-y-6 pt-5">
            <label class="block"
              ><span class="ux-label">Diseño del turnero</span><select
                use:styledSelect={draft.theme}
                class="ux-select mt-2"
                name="theme"
                bind:value={draft.theme}
                ><option value="cita-suite">Estándar de Cita Suite</option
                ><option value="natalia">Diseño de Natalia Frutos</option
                ></select
              ></label
            >
            <fieldset>
              <legend class="ux-label">Servicios que se muestran</legend><label
                class="flex min-h-11 items-center gap-3"
                ><input
                  type="checkbox"
                  name="limit_services"
                  value="true"
                  bind:checked={draft.limitServices}
                />Mostrar sólo algunos servicios</label
              >{#if draft.limitServices}<div class="mt-2 space-y-2">
                  {#each data.services.filter((service) => eligibleServices.some((item) => item.id === service.id) || draft.serviceIds.includes(service.id)) as service}<label
                      class="flex min-h-11 items-center gap-3"
                      ><input
                        type="checkbox"
                        checked={draft.serviceIds.includes(service.id)}
                        onchange={(event) =>
                          selectService(
                            service.id,
                            event.currentTarget.checked,
                          )}
                      /><span
                        >{service.name}{!eligibleServices.some(
                          (item) => item.id === service.id,
                        )
                          ? " · No disponible en esta selección"
                          : ""}</span
                      ></label
                    >{/each}
                </div>{/if}
            </fieldset>
            <fieldset>
              <legend class="ux-label">Atención virtual</legend><label
                class="flex min-h-11 items-center gap-3"
                ><input
                  type="checkbox"
                  name="video"
                  value="true"
                  bind:checked={draft.video}
                />Permitir reservas de consultas virtuales</label
              >{#if draft.video}<label class="block mt-3"
                  ><span class="ux-label">Cómo se conecta el paciente</span
                  ><textarea
                    class="ux-textarea mt-2"
                    name="video_instructions"
                    required
                    rows="2"
                    maxlength="1000"
                    bind:value={draft.videoInstructions}
                  ></textarea></label
                >{:else}<input
                  type="hidden"
                  name="video_instructions"
                  value={draft.videoInstructions}
                />{/if}
            </fieldset>
            <details>
              <summary class="cursor-pointer min-h-11 flex items-center text-sm"
                >Limitar los horarios que muestra esta web</summary
              >
              <div class="mt-3 space-y-4">
                <p class="text-sm text-white/75">
                  Estos filtros se aplican sólo en esta web.
                </p>
                {#each draft.windows as window, index}<div class="window-row">
                    <label
                      ><span class="ux-label">Consulta</span><select
                        use:styledSelect={window.modality}
                        class="ux-select mt-2"
                        bind:value={window.modality}
                        ><option value="in_person">Presencial</option><option
                          value="video"
                          disabled={!draft.video}>Virtual</option
                        ></select
                      ></label
                    ><label
                      ><span class="ux-label">Día</span><select
                        use:styledSelect={window.weekday}
                        class="ux-select mt-2"
                        bind:value={window.weekday}
                        >{#each weekdays as day, n}<option value={n}
                            >{day}</option
                          >{/each}</select
                      ></label
                    ><label
                      ><span class="ux-label">Desde</span><input
                        use:styledTime
                        class="ux-input mt-2"
                        type="time"
                        required
                        bind:value={window.startTime}
                      /></label
                    ><label
                      ><span class="ux-label">Hasta</span><input
                        use:styledTime
                        class="ux-input mt-2"
                        type="time"
                        required
                        bind:value={window.endTime}
                      /></label
                    ><label class="window-professional"
                      ><span class="ux-label">Aplicar a</span><select
                        use:styledSelect={window.professionalId ?? ""}
                        class="ux-select mt-2"
                        value={window.professionalId ?? ""}
                        onchange={(event) => {
                          if (event.currentTarget.value)
                            window.professionalId = event.currentTarget.value;
                          else delete window.professionalId;
                          dirty = true;
                        }}
                        ><option value="">Profesionales de esta agenda</option
                        >{#each data.professionals.filter( (person) => chosenProfessionals.includes(person.id) ) as person}<option
                            value={person.id}>{person.name}</option
                          >{/each}</select
                      ></label
                    ><button
                      type="button"
                      class="ux-btn-secondary self-end"
                      onclick={() => {
                        draft.windows = draft.windows.filter(
                          (_, n) => n !== index,
                        );
                        dirty = true;
                      }}>Eliminar horario</button
                    >
                  </div>{/each}{#if !draft.video && draft.windows.some((window) => window.modality === "video")}<p
                    class="ux-alert"
                    role="alert"
                  >
                    Eliminá los filtros virtuales para quitar la atención
                    virtual.
                  </p>{/if}<button
                  type="button"
                  class="ux-btn-secondary"
                  disabled={draft.windows.length >= 100}
                  onclick={addWindow}>Agregar filtro de horario</button
                >
              </div>
            </details>
            {#if draft.fields.length}<details>
                <summary
                  class="cursor-pointer min-h-11 flex items-center text-sm"
                  >Preguntas anteriores de esta web</summary
                >
                <ul class="mt-2 space-y-2 text-sm text-white/75">
                  {#each draft.fields as field}<li>
                      {field.label}{field.required ? " · Obligatoria" : ""}
                    </li>{/each}
                </ul>
              </details>{/if}
            <label class="flex min-h-11 items-center gap-3"
              ><input
                type="checkbox"
                name="default"
                value="true"
                bind:checked={draft.isDefault}
              />Usar esta selección también en la agenda general</label
            >
          </div>
        </details>
        <label class="flex min-h-11 items-center gap-3"
          ><input
            type="checkbox"
            name="active"
            value="true"
            bind:checked={draft.active}
          />Permitir reservas desde este sitio</label
        >
        <div class="connection-footer">
          <button class="ux-btn-primary" type="submit"
            >{saving ? "Guardando…" : "Guardar y continuar"}</button
          ><a
            class="ux-btn-secondary"
            href="/odonto/configuracion/reserva-online/webs">Cancelar</a
          >{#if dirty}<span class="text-sm text-amber-100"
              >Cambios sin guardar</span
            >{/if}
        </div>
      </fieldset>
      <noscript
        ><p class="ux-alert mt-4">
          Activá JavaScript para configurar la conexión con una web.
        </p></noscript
      >
    </form>
    </details>
  {/if}
</section>

<style>
  .web-connections {
    max-width: 64rem;
    margin-inline: auto;
  }
  .connection-editor > summary { cursor: pointer; min-height: 2.75rem; font-weight: 600; padding-block: .625rem; overflow-wrap: anywhere; }
  .connection-editor > form { margin-top: 1rem; }
  .connection-heading,
  .connected-site {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
  }
  .connected-site {
    padding: 1.5rem 0;
  }
  .connected-site > div {
    flex: 1;
  }
  .connected-site:hover strong {
    color: var(--accent);
  }
  .domain-row {
    display: flex;
    gap: 0.75rem;
  }
  .connection-options {
    border-block: 1px solid rgba(255, 255, 255, 0.12);
    padding-block: 1rem;
  }
  .connection-options > summary {
    cursor: pointer;
    min-height: 2.75rem;
    font-weight: 600;
    padding-top: 0.625rem;
  }
  .window-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
    padding-block: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }
  .window-professional {
    grid-column: 1/4;
  }
  .connection-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }
  @media (max-width: 640px) {
    .connection-heading {
      align-items: flex-start;
      flex-direction: column;
    }
    .connected-site {
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .connected-site > div {
      flex-basis: 100%;
    }
    .window-row {
      grid-template-columns: 1fr 1fr;
    }
    .window-professional {
      grid-column: 1/-1;
    }
    .domain-row {
      align-items: flex-start;
    }
    .domain-row :global(button) {
      padding-inline: 0.75rem;
    }
  }
</style>
