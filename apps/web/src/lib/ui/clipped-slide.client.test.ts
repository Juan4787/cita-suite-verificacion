import { afterEach, expect, it, vi } from "vitest";
import { clippedSlide } from "./clipped-slide";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const panel = () => {
  const node = document.createElement("div");
  node.style.height = "66px";
  document.body.append(node);
  return node;
};

it("clips with overflow: clip and keeps every other slide frame", () => {
  vi.stubGlobal("CSS", {
    supports: (property: string, value: string) => property === "overflow" && value === "clip",
  });
  const node = panel();
  const config = clippedSlide(node, { duration: 180 });
  expect(node.style.overflow).toBe("clip");
  expect(config.duration).toBe(180);
  for (const [t, height] of [[0, "0px"], [0.5, "33px"], [1, "66px"]] as const) {
    const frame = config.css?.(t, 1 - t) ?? "";
    // A frame with `overflow: hidden` would override the inline clip and make the panel
    // scrollable again while it opens.
    expect(frame).not.toMatch(/overflow/);
    expect(frame).toContain(`height: ${height}`);
    expect(frame).toContain("opacity:");
  }
});

it("keeps hidden where the browser does not support clip", () => {
  vi.stubGlobal("CSS", { supports: () => false });
  const node = panel();
  clippedSlide(node);
  expect(node.style.overflow).toBe("hidden");
});

// jsdom exposes `CSS` without `supports`; the panel must still open there.
it("keeps hidden where CSS.supports is unavailable", () => {
  for (const css of [{}, undefined]) {
    vi.stubGlobal("CSS", css);
    const node = panel();
    expect(() => clippedSlide(node)).not.toThrow();
    expect(node.style.overflow).toBe("hidden");
  }
});
