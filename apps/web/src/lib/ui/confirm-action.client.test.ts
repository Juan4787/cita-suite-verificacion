import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ beforeNavigate: vi.fn(), goto: vi.fn() }));
vi.mock("$app/navigation", () => mocks);
import { guardUnsavedChanges } from "./confirm-action";
beforeEach(() => {
  mocks.beforeNavigate.mockReset();
  mocks.goto.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => document.body.replaceChildren());
function navigate(willUnload = false) {
  const cancel = vi.fn();
  const navigation = {
    cancel,
    willUnload,
    type: "link",
    to: { url: new URL("http://127.0.0.1/webs?nuevo=1") },
  };
  mocks.beforeNavigate.mock.calls[0][0](navigation);
  return cancel;
}
it("discards the old draft before resuming navigation to another entity", async () => {
  const discard = vi.fn();
  guardUnsavedChanges(() => true, "Tenés cambios sin guardar.", discard);
  expect(navigate()).toHaveBeenCalledOnce();
  document.querySelectorAll<HTMLButtonElement>("dialog button")[1].click();
  await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledOnce());
  expect(discard).toHaveBeenCalledOnce();
  expect(discard.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.goto.mock.invocationCallOrder[0],
  );
});
it("keeps the draft when the professional chooses to continue editing", async () => {
  const discard = vi.fn();
  guardUnsavedChanges(() => true, "Tenés cambios sin guardar.", discard);
  navigate();
  document.querySelector<HTMLButtonElement>("dialog button")!.click();
  await Promise.resolve();
  expect(discard).not.toHaveBeenCalled();
  expect(mocks.goto).not.toHaveBeenCalled();
  expect(document.querySelector("dialog")).toBeNull();
});
it("protects browser exits without creating a custom dialog", () => {
  guardUnsavedChanges(() => true, "Tenés cambios sin guardar.", vi.fn());
  expect(navigate(true)).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")).toBeNull();
});
it("does not interrupt navigation for a saved form", () => {
  guardUnsavedChanges(() => false, "Tenés cambios sin guardar.", vi.fn());
  expect(navigate()).not.toHaveBeenCalled();
  expect(document.querySelector("dialog")).toBeNull();
});
