<script lang="ts">
	import type { PageProps } from './$types';

  import { guardUnsavedChanges } from "$lib/ui/confirm-action";
  import { enhance } from "$app/forms";
  import BackLink from "$lib/components/BackLink.svelte";
  import { untrack } from "svelte";
  let { data, form }: PageProps = $props();
  let saving = $state(false);
  let dirty = $state(false);
  let version = $state(untrack(() => data.settings.updated_at));
  let settings = $state(untrack(() => ({ ...data.settings })));
  $effect(() => {
    if (!dirty && version !== data.settings.updated_at) {
      settings = { ...data.settings };
      version = data.settings.updated_at;
    }
  });
  guardUnsavedChanges(
    () => dirty,
    "Tenés cambios sin guardar.",
    () => {
      dirty = false;
      settings = { ...data.settings };
    },
  );
</script>

<svelte:head><title>Contacto en tu web · Cita Suite</title></svelte:head>
<svelte:window
  onbeforeunload={(event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }}
/>
<section class="ux-page mx-auto max-w-4xl">
  <header>
    <BackLink
      href="/odonto/configuracion/negocio"
      label="Datos del consultorio"
      class="mb-5"
    />
    <h1 class="ux-title">Contacto en tu web</h1>
  </header>
  {#if form?.message}<p
      class={form.saved ? "ux-alert ux-alert-success" : "ux-alert"}
      role={form.saved ? "status" : "alert"}
    >
      {form.message}
    </p>{/if}
  <form
    class="ux-card"
    method="POST"
    action="?/save"
    oninput={() => (dirty = true)}
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
  >
    <input type="hidden" name="settings_updated_at" value={version} />
    <fieldset disabled={saving} class="space-y-5">
      <label class="flex min-h-11 items-center gap-3"
        ><input
          type="checkbox"
          name="public_contact_enabled"
          value="true"
          bind:checked={settings.public_contact_enabled}
        /><span>Mostrar el teléfono y la dirección en la web</span></label
      >
      <p class="text-sm text-white/75">
        Se usan los datos del consultorio, incluso si las reservas están
        pausadas.
      </p>
      <div class="border-t border-white/10 pt-5">
        <h2 class="ux-section-title">WhatsApp de contacto</h2>
        <label class="mt-4 flex min-h-11 items-center gap-3"
          ><input
            type="checkbox"
            name="whatsapp_contact_enabled"
            value="true"
            bind:checked={settings.whatsapp_contact_enabled}
          /><span>Mostrar un botón para que el paciente escriba</span></label
        >
        <div class="mt-4 space-y-4">
          <label class="block"
            ><span class="ux-label">Número con código de país</span><input
              class="ux-input mt-2"
              type="tel"
              name="whatsapp_phone"
              maxlength="30"
              autocomplete="tel"
              required={settings.whatsapp_contact_enabled}
              bind:value={settings.whatsapp_phone}
            /></label
          ><label class="block"
            ><span class="ux-label"
              >Mensaje inicial <span class="text-white/65">(opcional)</span
              ></span
            ><textarea
              class="ux-textarea mt-2"
              rows="2"
              name="whatsapp_message"
              maxlength="180"
              bind:value={settings.whatsapp_message}
            ></textarea></label
          >
        </div>
      </div>
      <button class="ux-btn-primary"
        >{saving ? "Guardando…" : "Guardar contacto"}</button
      >
    </fieldset>
  </form>
</section>
