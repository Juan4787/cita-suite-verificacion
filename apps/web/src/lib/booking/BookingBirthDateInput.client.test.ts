import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/svelte";
import BookingBirthDateInput from "./BookingBirthDateInput.svelte";
afterEach(cleanup);
it("requires a real date and submits the same ISO field without auxiliary form keys", async () => {
  render(BookingBirthDateInput, {
    name: "intake_birth",
    label: "Nacimiento",
    required: true,
  });
  const day = screen.getByLabelText("Nacimiento: día") as HTMLInputElement;
  await fireEvent.input(day, { target: { value: "29" } });
  await fireEvent.input(screen.getByLabelText("Nacimiento: mes"), {
    target: { value: "02" },
  });
  await fireEvent.input(screen.getByLabelText("Nacimiento: año"), {
    target: { value: "2023" },
  });
  await waitFor(() => expect(day.checkValidity()).toBe(false));
  await fireEvent.input(screen.getByLabelText("Nacimiento: año"), {
    target: { value: "2024" },
  });
  await waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>('[name="intake_birth"]')!.value,
    ).toBe("2024-02-29"),
  );
  expect(day.checkValidity()).toBe(true);
  expect(document.querySelectorAll("[name]")).toHaveLength(1);
});
it("permits an empty optional date but rejects a partial date", async () => {
  render(BookingBirthDateInput, {
    name: "intake_birth",
    label: "Nacimiento",
    required: false,
  });
  const day = screen.getByLabelText("Nacimiento: día") as HTMLInputElement;
  await waitFor(() => expect(day.checkValidity()).toBe(true));
  await fireEvent.input(day, { target: { value: "12" } });
  await waitFor(() => expect(day.checkValidity()).toBe(false));
});

it("keeps birth dates within the same past-date and 130-year boundaries as the server", async () => {
  render(BookingBirthDateInput, {
    name: "intake_birth",
    label: "Nacimiento",
    required: true,
    today: "2026-10-14",
  });
  const day = screen.getByLabelText("Nacimiento: día") as HTMLInputElement;
  await fireEvent.input(day, { target: { value: "15" } });
  await fireEvent.input(screen.getByLabelText("Nacimiento: mes"), {
    target: { value: "10" },
  });
  await fireEvent.input(screen.getByLabelText("Nacimiento: año"), {
    target: { value: "2026" },
  });
  await waitFor(() => expect(day.checkValidity()).toBe(false));
  await fireEvent.input(day, { target: { value: "14" } });
  await waitFor(() => expect(day.checkValidity()).toBe(true));
  await fireEvent.input(screen.getByLabelText("Nacimiento: año"), {
    target: { value: "1896" },
  });
  await waitFor(() => expect(day.checkValidity()).toBe(true));
  await fireEvent.input(day, { target: { value: "13" } });
  await waitFor(() => expect(day.checkValidity()).toBe(false));
});
