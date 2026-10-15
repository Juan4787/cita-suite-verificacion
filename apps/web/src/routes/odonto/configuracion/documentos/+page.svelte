<script lang="ts">
  import { guardUnsavedChanges } from "$lib/ui/confirm-action";
  import { enhance } from "$app/forms";
  import BackLink from "$lib/components/BackLink.svelte";
  import { untrack } from "svelte";
  let { data, form } = $props();
  let saving = $state(false);
  let cleaning = $state(false);
  let dirty = $state(false);
  let allowed = $state(untrack(() => data.settings.patient_documents_enabled));
  let version = $state(untrack(() => data.settings.updated_at));
  $effect(() => {
    if (!dirty && version !== data.settings.updated_at) {
      allowed = data.settings.patient_documents_enabled;
      version = data.settings.updated_at;
    }
  });
  guardUnsavedChanges(
    () => dirty,
    "Tenés cambios sin guardar.",
    () => {
      dirty = false;
      allowed = data.settings.patient_documents_enabled;
    },
  );
  const mb = (bytes: unknown) =>
    new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(
      Number(bytes) / 1_000_000,
    );
</script>

<svelte:head><title>Archivos de pacientes · Cita Suite</title></svelte:head>
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
    <BackLink href="/odonto/configuracion" label="Configuración" class="mb-5" />
    <h1 class="ux-title">Archivos de pacientes</h1>
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
    <h2 class="ux-section-title">Envíos del paciente</h2>
    <label class="mt-4 flex min-h-11 items-center gap-3"
      ><input
        type="checkbox"
        name="patient_documents_enabled"
        value="true"
        bind:checked={allowed}
        disabled={saving || cleaning}
      /><span>Permitir que adjunten archivos al turno</span></label
    >
    <p class="mt-2 text-sm text-white/75">
      PDF, JPG o PNG. Hasta 5 MB por archivo y 3 archivos por turno, con un
      total de 10 MB.
    </p>
    <button class="ux-btn-primary mt-5" disabled={saving || cleaning}
      >{saving ? "Guardando…" : "Guardar permisos"}</button
    >
  </form>
  <section class="ux-card" aria-labelledby="storage-title">
    <h2 id="storage-title" class="ux-section-title">Espacio para archivos</h2>
    <p class="mt-4">
      <strong>{mb(data.budget.used_bytes)} MB utilizados</strong> de {mb(
        data.budget.max_bytes,
      )} MB.
    </p>
    <progress
      class="mt-3 w-full"
      max="100"
      value={Number(data.budget.percentage)}
      aria-label="Uso del espacio para archivos"
    ></progress>
    <p class="mt-2 text-sm text-white/75">
      {mb(data.budget.reserved_bytes)} MB reservados para cargas pendientes.
    </p>
    {#if Number(data.budget.percentage) >= 85}<p class="ux-alert mt-4">
        Queda poco espacio. Al agotarse, se detendrán las cargas nuevas.
      </p>{/if}
    <form
      class="mt-5"
      method="POST"
      action="?/cleanup"
      use:enhance={() => {
        cleaning = true;
        return async ({ result, update }) => {
          try {
            await update({
              reset: false,
              invalidateAll: result.type === "success",
            });
          } finally {
            cleaning = false;
          }
        };
      }}
    >
      <button class="ux-btn-secondary" disabled={saving || cleaning || dirty}
        >{cleaning ? "Revisando…" : "Limpiar cargas abandonadas"}</button
      >
      <p class="mt-2 text-sm text-white/75">
        Conserva los archivos guardados y la papelera.
      </p>
    </form>
    <details class="mt-5 border-t border-white/10 pt-4">
      <summary class="cursor-pointer min-h-11">Detalle de consumo</summary>
      <div class="mt-2 space-y-3 text-sm text-white/75">
        <p>
          Base de datos: {mb(data.budget.database_bytes)} MB. Se controla por separado
          del espacio para archivos.
        </p>
        <p>
          Descargas autorizadas este mes: {mb(
            data.budget.monthly_authorized_download_bytes,
          )} MB estimados. Una autorización puede usarse más de una vez.
        </p>
        <p>
          La papelera ocupa espacio. Los límites de transferencia y de la cuenta
          completa se consultan en el proveedor.
        </p>
      </div>
    </details>
  </section>
</section>
