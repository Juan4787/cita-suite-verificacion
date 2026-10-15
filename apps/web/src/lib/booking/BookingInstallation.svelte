<script lang="ts">
  import { dev } from "$app/environment";
  import BookingShareLink from "./BookingShareLink.svelte";
  import {
    bookingInstallation,
    type BookingInstallMode,
  } from "./booking-installation";
  let {
    baseURL,
    profile,
  }: {
    baseURL: string;
    profile: {
      name: string;
      public_key: string;
      allowed_origins: string[];
      is_active: boolean;
    };
  } = $props();
  let mode = $state<BookingInstallMode>("inline");
  let message = $state("");
  const code = $derived(
    bookingInstallation(baseURL, profile.public_key, mode, dev),
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      message =
        "Código copiado. Pegalo en tu web o enviáselo a quien la administra.";
    } catch {
      message = "Abrí «Ver código», seleccioná el contenido y copialo.";
    }
  }
</script>

<section class="ux-card installation" aria-labelledby="install-title">
  <div class="install-heading">
    <div>
      <h2 id="install-title" class="ux-section-title">
        Instalar el turnero en {profile.name}
      </h2>
      <p class="mt-2 text-sm text-white/75">
        El dominio autoriza tu web. Para mostrar la agenda, también tenés que
        instalarla allí.
      </p>
    </div>
    <span class="ux-badge">Paso 2</span>
  </div>
  <fieldset class="install-modes">
    <legend class="ux-label">¿Cómo querés mostrarlo?</legend>
    <label class="install-mode"
      ><input
        type="radio"
        name={"installation-mode-" + profile.public_key}
        value="inline"
        bind:group={mode}
      /><span
        ><strong>Agenda dentro de mi web</strong><small
          >El paciente reserva sin salir del sitio.</small
        ></span
      ></label
    >
    <label class="install-mode"
      ><input
        type="radio"
        name={"installation-mode-" + profile.public_key}
        value="link"
        bind:group={mode}
      /><span
        ><strong>Botón para reservar</strong><small
          >Abre la agenda en otra página.</small
        ></span
      ></label
    >
  </fieldset>
  <div class="install-actions">
    <button type="button" class="ux-btn-primary" onclick={copy}
      >Copiar código</button
    >
  </div>
  <p class="install-feedback" role="status">
    {message || "Pegá el código en un bloque HTML de tu web."}
  </p>
  <details class="install-details">
    <summary>Ver código</summary><label class="block mt-3"
      ><span class="sr-only">Código para instalar el turnero</span><textarea
        class="ux-textarea install-code"
        readonly
        rows="5"
        value={code}
        onfocus={(event) => event.currentTarget.select()}
      ></textarea></label
    >
  </details>
  <div class="install-test">
    <h3 class="ux-label">Probá la instalación</h3>
    <p class="mt-2 text-sm text-white/75">
      Abrí tu web y comprobá que podés elegir un servicio, un día y un horario.
    </p>
    <div class="install-actions">
      {#each profile.allowed_origins as origin}<a
          class="ux-btn-secondary"
          href={origin}
          target="_blank"
          rel="noopener noreferrer">Abrir {new URL(origin).host}</a
        >{/each}
    </div>
  </div>
  <details class="install-details">
    <summary>Compartir sólo el enlace de la agenda</summary>
    <div class="mt-4">
      <BookingShareLink url={`${baseURL}/embed/v1/${profile.public_key}`} />
    </div>
  </details>
  {#if !profile.is_active}<p class="ux-alert mt-4">
      Este turnero está pausado. Activá «Permitir reservas desde este sitio» en
      su configuración para recibir turnos.
    </p>{/if}
</section>

<style>
  .installation {
    min-width: 0;
  }
  .install-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  .install-heading > div {
    min-width: 0;
  }
  .install-heading h2 {
    overflow-wrap: anywhere;
  }
  .install-heading :global(.ux-badge) {
    flex-shrink: 0;
  }
  .install-modes {
    margin-top: 1.5rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .install-modes legend {
    margin-bottom: 0.75rem;
  }
  .install-mode {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius, 1rem);
    cursor: pointer;
  }
  .install-mode:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .install-mode input {
    flex-shrink: 0;
    margin-top: 0.2rem;
  }
  .install-mode strong,
  .install-mode small {
    display: block;
  }
  .install-mode small {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .install-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .install-feedback {
    min-height: 1.5rem;
    margin-top: 0.75rem;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .install-details {
    margin-top: 1rem;
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }
  .install-details summary {
    cursor: pointer;
    min-height: 2.75rem;
    font-weight: 600;
  }
  .install-code {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .install-test {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }
  .install-test :global(a) {
    overflow-wrap: anywhere;
    white-space: normal;
    max-width: 100%;
  }
  @media (max-width: 640px) {
    .install-modes {
      grid-template-columns: 1fr;
    }
    .install-actions :global(button) {
      width: 100%;
    }
  }
</style>
