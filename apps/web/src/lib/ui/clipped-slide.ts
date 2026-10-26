import { slide, type SlideParams, type TransitionConfig } from "svelte/transition";

// Svelte's `slide` clips with `overflow: hidden`, which keeps the moving panel a scroll
// container: scrolling a clipped control into view (keyboard focus, automation) offsets
// the panel's content, and that offset is dropped when the transition ends, moving the
// controls away from a press that is still down. `overflow: clip` clips the same pixels
// and cannot be scrolled.
const clipping = () => (globalThis.CSS?.supports?.("overflow", "clip") ? "clip" : "hidden");

/** `slide` for panels with controls: the same motion and clipping, never scrollable. */
export function clippedSlide(node: HTMLElement, params?: SlideParams): TransitionConfig {
  const { css, ...timing } = slide(node, params);
  // Inline, as Svelte does for its own overflow; it restores the element's value when the
  // intro ends, and an outro removes the element.
  node.style.overflow = clipping();
  return {
    ...timing,
    css:
      css &&
      ((t, u) =>
        css(t, u)
          .split(";")
          .filter((declaration) => !/^\s*overflow\s*:/.test(declaration))
          .join(";")),
  };
}
