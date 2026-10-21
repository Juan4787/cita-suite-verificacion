<script lang="ts">
	import type { Snippet } from 'svelte';

  import { createEventDispatcher } from "svelte";

  // dismissible: cierra al click afuera / Escape. closable: muestra la X (cierre explícito) sin click-afuera.
  let {
    open = false,
    title = "",
    children,
    dismissible = false,
    closable = false,
  }: { open?: boolean; title?: string; children?: Snippet; dismissible?: boolean; closable?: boolean } = $props();

  const dispatch = createEventDispatcher<{ close: void }>();
  const close = () => dispatch("close");
  function focusDialog(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      [
        ...node.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]),select,textarea,button,a[href],[tabindex="0"]',
        ),
      ].filter(
        (element) =>
          !element.matches(':disabled,[aria-hidden="true"]') &&
          element.getClientRects().length > 0,
      );
    queueMicrotask(() =>
      (
        node.querySelector<HTMLElement>("[autofocus]") ??
        controls()[0] ??
        node
      ).focus(),
    );
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = controls();
      if (!elements.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = elements[0],
        last = elements.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", trap);
    return {
      destroy() {
        node.removeEventListener("keydown", trap);
        if (previous?.isConnected) previous.focus();
      },
    };
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 pt-4 pb-32 backdrop-blur-sm dark:bg-black/60 sm:px-4 sm:py-10"
    role="presentation"
    onclick={(event) => {
      if (dismissible && event.target === event.currentTarget) {
        close();
      }
    }}
    onkeydown={(event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dismissible) close();
      }
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      use:focusDialog
      class="flex max-h-[calc(100dvh-8rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-card dark:border dark:border-[#1f3554] dark:bg-[#0f1f36] sm:max-h-[calc(100dvh-5rem)]"
    >
      <div
        class="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-[#1f3554] sm:px-6 sm:py-4"
      >
        <h3
          class="min-w-0 break-words text-lg font-semibold text-neutral-900 dark:text-white"
        >
          {title}
        </h3>
        {#if dismissible || closable}
          <button
            type="button"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-[#13243d]"
            onclick={close}
            aria-label="Cerrar"
          >
            <span aria-hidden="true">×</span>
          </button>
        {/if}
      </div>
      <div class="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        {@render children?.()}
      </div>
    </div>
  </div>
{/if}
