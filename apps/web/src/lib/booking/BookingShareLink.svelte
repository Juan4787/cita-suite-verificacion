<script lang="ts">
  let { url }: { url: string } = $props();
  let message = $state("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      message = "Enlace copiado.";
    } catch {
      message = "Seleccioná el enlace y copialo.";
    }
  }
</script>

<div class="share-link">
  <label class="min-w-0 flex-1"
    ><span class="sr-only">Enlace para pacientes</span><input
      class="ux-input"
      readonly
      value={url}
      onfocus={(event) => event.currentTarget.select()}
    /></label
  ><button type="button" class="ux-btn-primary" onclick={copy}
    >Copiar enlace</button
  ><a
    class="ux-btn-secondary text-center"
    href={url}
    target="_blank"
    rel="noreferrer">Ver como paciente</a
  >
</div>
<p class="min-h-5 mt-2 text-sm text-fg-80" role="status">{message}</p>

<style>
  .share-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .share-link :global(.ux-btn-primary),
  .share-link :global(.ux-btn-secondary) {
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    /* The field takes the first row. The two actions share the next one while both labels fit on
       one line; otherwise each takes its own row, so a label never splits in two lines. */
    .share-link {
      flex-wrap: wrap;
    }
    .share-link label {
      flex-basis: 100%;
    }
    .share-link :global(.ux-btn-primary),
    .share-link :global(.ux-btn-secondary) {
      flex: 1 1 auto;
      padding: 0.75rem 1rem;
    }
  }
</style>
