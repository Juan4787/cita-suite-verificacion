import "@testing-library/jest-dom/vitest";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/svelte";
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$app/navigation", () => ({ beforeNavigate: vi.fn() }));
import ProfessionalBookingFormEditor from "./ProfessionalBookingFormEditor.svelte";
afterEach(cleanup);
const professional = { id: "professional", name: "Profesional sintético" };
function payload() {
  return JSON.parse(
    document.querySelector<HTMLInputElement>('[name="fields"]')!.value,
  );
}
it("lets the professional request a standard clinical datum without choosing storage mappings", async () => {
  render(ProfessionalBookingFormEditor, { professional, configuration: null });
  const medication = screen.getByRole("checkbox", {
    name: "Medicación actual",
  });
  await waitFor(() => expect(medication).toBeEnabled());
  await fireEvent.click(medication);
  const row = medication.closest(".question-row")!;
  await fireEvent.click(
    within(row as HTMLElement).getByRole("checkbox", {
      name: "Obligatorio",
    }),
  );
  expect(payload()).toEqual([
    expect.objectContaining({
      patientField: "medication",
      required: true,
      kind: "textarea",
    }),
  ]);
  expect(
    screen.queryByText("Profesional del formulario"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Guardar en el perfil como"),
  ).not.toBeInTheDocument();
});
it("keeps configured question identifiers and help text intact", () => {
  const fields = [
    {
      id: "known",
      label: "Medicación indicada",
      kind: "textarea",
      maxLength: 900,
      required: false,
      patientField: "medication",
      help: "Texto configurado",
    },
  ];
  render(ProfessionalBookingFormEditor, {
    professional,
    configuration: { revision: 7, fields: fields as any },
  });
  expect(payload()).toEqual(fields);
  expect(
    document.querySelector<HTMLInputElement>('[name="revision"]')!.value,
  ).toBe("7");
});
it("retains edits and their old revision if another person changes the configuration", async () => {
  const rendered = render(ProfessionalBookingFormEditor, {
    professional,
    configuration: { revision: 3, fields: [] },
  });
  const allergies = screen.getByRole("checkbox", {
    name: "Alergias",
  });
  await waitFor(() => expect(allergies).toBeEnabled());
  await fireEvent.click(allergies);
  await rendered.rerender({
    professional,
    configuration: { revision: 4, fields: [] },
  });
  expect(payload()).toHaveLength(1);
  expect(payload()[0].patientField).toBe("allergies");
  expect(
    document.querySelector<HTMLInputElement>('[name="revision"]')!.value,
  ).toBe("3");
});
it("edits an additional question with options and can remove it", async () => {
  render(ProfessionalBookingFormEditor, { professional, configuration: null });
  const add = screen.getByRole("button", { name: "Agregar pregunta" });
  await waitFor(() => expect(add).toBeEnabled());
  await fireEvent.click(add);
  await fireEvent.input(screen.getByLabelText("Texto de la pregunta"), {
    target: { value: "¿Cómo preferís que te contacten?" },
  });
  await fireEvent.click(screen.getByRole("combobox", { name: "Respuesta" }));
  await fireEvent.click(
    screen.getByRole("option", { name: "Elegir una opción" }),
  );
  await fireEvent.input(screen.getByLabelText("Opciones de respuesta"), {
    target: { value: "Teléfono\nCorreo" },
  });
  expect(payload()[0]).toMatchObject({
    patientField: "custom",
    kind: "choice",
    options: ["Teléfono", "Correo"],
  });
  await fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
  expect(payload()).toEqual([]);
});
