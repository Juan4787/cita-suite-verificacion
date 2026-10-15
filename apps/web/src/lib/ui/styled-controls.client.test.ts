import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { styledSelect, styledDate } from "./styled-controls";
const teardown: Array<() => void> = [];
afterEach(() => {
  teardown.splice(0).forEach((fn) => fn());
  document.body.replaceChildren();
});
function select() {
  document.body.innerHTML =
    '<form><fieldset><label>Anticipación<select name="notice" required><option value="" disabled>Elegir</option><option value="30">30 minutos</option><option value="120">2 horas</option></select></label></fieldset></form>';
  const node = document.querySelector("select")!;
  node.selectedIndex = 0;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const action = styledSelect(node, node.value);
  teardown.push(() => action.destroy?.());
  return {
    node,
    action,
    button: document.querySelector<HTMLButtonElement>('[role="combobox"]')!,
  };
}
it("submits the original field and emits the events used by Svelte bindings", async () => {
  const { node, button } = select();
  const input = vi.fn(),
    change = vi.fn();
  node.addEventListener("input", input);
  node.addEventListener("change", change);
  button.click();
  (document.querySelectorAll('[role="option"]')[2] as HTMLElement).click();
  await tick();
  expect(new FormData(node.form!).get("notice")).toBe("120");
  expect(input).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledOnce();
  expect(button).toHaveTextContent("2 horas");
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(document.activeElement).toBe(button);
});
it("supports arrow keys, selection, Escape and externally changed values", async () => {
  const { node, action, button } = select();
  button.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  button.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await tick();
  expect(node.value).toBe("30");
  node.value = "120";
  action.update?.("120");
  await tick();
  expect(button).toHaveTextContent("2 horas");
  button.click();
  button.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(button).toHaveAttribute("aria-expanded", "false");
});
it("respects fieldset disabled state and restores the original control on teardown", async () => {
  const { node, action, button } = select();
  document.querySelector("fieldset")!.disabled = true;
  await tick();
  await Promise.resolve();
  expect(button).toBeDisabled();
  action.destroy?.();
  teardown.pop();
  expect(node).not.toHaveAttribute("aria-hidden");
  expect(document.querySelector('[role="combobox"]')).toBeNull();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});
it("shows invalid required controls and forwards their focus", () => {
  const { node, button } = select();
  expect(node.checkValidity()).toBe(false);
  expect(button).toHaveAttribute("aria-invalid", "true");
  expect(document.activeElement).toBe(button);
});
it("offers an authored calendar with exact date boundaries and keeps the ISO form value", async () => {
  document.body.innerHTML =
    '<label>Fecha<input name="date" type="date" value="2026-10-14" min="2026-10-14" max="2026-10-16" required></label>';
  const node = document.querySelector("input")!;
  const action = styledDate(node, node.value);
  teardown.push(() => action.destroy());
  const trigger = document.querySelector<HTMLButtonElement>(
    ".ux-control-trigger",
  )!;
  trigger.click();
  const days = [
    ...document.querySelectorAll<HTMLButtonElement>(".ux-calendar-value"),
  ];
  expect(days.filter((day) => !day.disabled)).toHaveLength(3);
  days.find((day) => day.dataset.value === "2026-10-16")!.click();
  await tick();
  expect(node.value).toBe("2026-10-16");
  expect(trigger).toHaveAccessibleName(/^Fecha,.*16.*oct.*2026$/);
  node.min = "2026-10-15";
  node.disabled = true;
  await tick();
  await Promise.resolve();
  expect(trigger).toHaveAccessibleName(/^Fecha,.*16.*oct.*2026$/);
  node.disabled = false;
  await tick();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(document.activeElement).toBe(trigger);
});
it("offers months without a native month popup and honors the maximum", () => {
  document.body.innerHTML =
    '<label>Mes<input name="month" type="month" value="2026-10" max="2026-10" required></label>';
  const node = document.querySelector("input")!;
  const action = styledDate(node, node.value);
  teardown.push(() => action.destroy());
  document.querySelector<HTMLButtonElement>(".ux-control-trigger")!.click();
  expect(
    [
      ...document.querySelectorAll<HTMLButtonElement>(".ux-calendar-value"),
    ].filter((button) => !button.disabled),
  ).toHaveLength(10);
});

it("reads the initialized binding after hydration before showing the saved value", async () => {
  const { node, button } = select();
  node.value = "120";
  await tick();
  expect(button).toHaveTextContent("2 horas");
});
