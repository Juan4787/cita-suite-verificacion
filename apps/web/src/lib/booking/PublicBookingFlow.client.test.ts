import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import type { BookingIntakeField } from '@cita-suite/shared/booking-integration';
const requestId = "10000000-0000-4000-8000-000000000001";
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
const navigation = vi.hoisted(() => ({
  after: (_event: { from: { url: URL }; to: { url: URL }; type: string }) => {},
}));
vi.mock("$app/navigation", () => ({
  afterNavigate: (callback: typeof navigation.after) => {
    navigation.after = callback;
  },
  invalidateAll: vi.fn(async () => {}),
}));
vi.mock("$app/state", () => ({
  page: {
    url: new URL(
      "https://booking.example.test/embed/v1/" +
        "a".repeat(32) +
        "?service_id=service&professional_id=professional&date=2026-11-02&slot=2026-11-02T09%3A00%3A00.000Z",
    ),
  },
  navigating: { to: null },
}));
import { navigating } from "$app/state";
import PublicBookingFlow from "./PublicBookingFlow.svelte";
afterEach(cleanup);

it("renders a server-reported unknown result as recovery-required, preserving the attempt and frame context", () => {
  render(PublicBookingFlow, {
    data: {
      state: {
        business: { name: "Consultorio sintético", timezone: "UTC" },
        services: [
          {
            id: "service",
            name: "Consulta",
            description: null,
            duration_minutes: 30,
            price_label: null,
          },
        ],
        professionals: [
          {
            id: "professional",
            name: "Profesional sintético",
            specialty: null,
          },
        ],
        days: [{ date: "2026-11-02", label: "Lunes", count: 1 }],
        slots: [
          {
            date: "2026-11-02",
            time: "09:00",
            starts_at: "2026-11-02T09:00:00.000Z",
            ends_at: "2026-11-02T09:30:00.000Z",
            professional_id: "professional",
            professional_name: "Profesional sintético",
          },
        ],
        issue: null,
      },
      selected: {
        serviceId: "service",
        professionalId: "professional",
        professionalIds: [],
        bookingMode: "individual",
        date: "2026-11-02",
      },
      mapsLink: null,
      turnstileSiteKey: null,
      bookingRequestId: requestId,
      integration: { publicKey: "a".repeat(32), revision: 1 },
      presentation: {
        theme: "cita-suite",
        modalities: ["in_person"],
        intakeFields: [],
        videoInstructions: null,
      },
      embed: {
        parentOrigin: "https://natalia.example.test",
        instanceId: "b".repeat(32),
      },
      demo: false,
    },
    form: {
      uncertain: true,
      message: "No pudimos comprobar el resultado.",
      values: { idempotency_key: requestId },
    },
  });
  expect(
    screen.getByRole("button", { name: "Confirmar reserva" }),
  ).toBeDisabled();
  const recovery = new URL(
    screen
      .getByRole("link", { name: "Revisar resultado de la reserva" })
      .getAttribute("href")!,
    "https://booking.example.test",
  );
  expect(recovery.searchParams.get("request_id")).toBe(requestId);
  expect(recovery.searchParams.get("recover")).toBe("1");
  expect(recovery.searchParams.get("parent_origin")).toBe(
    "https://natalia.example.test",
  );
  const restart = new URL(
    screen
      .getByRole("link", { name: "Empezar de nuevo" })
      .getAttribute("href")!,
    "https://booking.example.test",
  );
  expect(restart.searchParams.get("request_id")).toBe(requestId);
  expect(restart.searchParams.has("service_id")).toBe(false);
  const action = new URL(
    screen
      .getByRole("button", { name: "Confirmar reserva" })
      .closest("form")!
      .getAttribute("action")!,
    "https://booking.example.test",
  );
  expect(action.searchParams.has("/create_booking")).toBe(true);
  expect(action.searchParams.get("instance_id")).toBe("b".repeat(32));
});

it("keeps the pending virtual selection in the form and onward links", () => {
  const pending = new URL(
    "https://booking.example.test/embed/v1/" +
      "a".repeat(32) +
      "?service_id=service&professional_id=professional&date=2026-11-02&slot=2026-11-02T09%3A00%3A00.000Z&modality=video",
  );
  Object.assign(navigating, { to: { url: pending } });
  try {
    render(PublicBookingFlow, { data: bookingFixture(["in_person", "video"]) });
    expect(
      document.querySelector<HTMLInputElement>('[name="modality"]')?.value,
    ).toBe("video");
    const restart = new URL(
      screen
        .getByRole("link", { name: "Empezar de nuevo" })
        .getAttribute("href")!,
      pending,
    );
    expect(restart.searchParams.get("modality")).toBe("video");
  } finally {
    Object.assign(navigating, { to: null });
  }
});
it("renders the professional required profile data in the shared native flow", () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, {
    patientFields: {
      hash: "c".repeat(64),
      fields: [
        {
          id: "profile_insurance",
          label: "Cobertura exigida",
          kind: "text",
          required: true,
          maxLength: 120,
          patientField: "insurance",
        },
      ],
    },
  });
  render(PublicBookingFlow, { data });
  expect(screen.getByLabelText("Cobertura exigida")).toBeRequired();
  expect(
    document.querySelector<HTMLInputElement>('[name="patient_schema_hash"]')
      ?.value,
  ).toBe("c".repeat(64));
});
function bookingFixture(modalities: Array<"in_person" | "video">) {
  return {
    state: {
      business: { name: "Consultorio sintético", timezone: "UTC" },
      services: [
        {
          id: "service",
          name: "Consulta",
          description: null,
          duration_minutes: 30,
          price_label: null as string | null,
        },
      ],
      professionals: [
        { id: "professional", name: "Profesional sintético", specialty: null },
      ],
      days: [{ date: "2026-11-02", label: "Lunes", count: 1 }],
      slots: [
        {
          date: "2026-11-02",
          time: "09:00",
          starts_at: "2026-11-02T09:00:00.000Z",
          ends_at: "2026-11-02T09:30:00.000Z",
          professional_id: "professional",
          professional_name: "Profesional sintético",
        },
      ],
      issue: null,
    },
    selected: {
      serviceId: "service",
      professionalId: "professional",
      professionalIds: [],
      bookingMode: "individual" as const,
      date: "2026-11-02",
    },
    mapsLink: null,
    turnstileSiteKey: null,
    bookingRequestId: requestId,
    // The loaded day asks no deposit unless a test says otherwise, as the real load returns it.
    depositTerms: {} as Record<
      string,
      { amount: number; dueAt: string; autoCancel: boolean }
    > | null,
    integration: { publicKey: "a".repeat(32), revision: 1 },
    presentation: {
      theme: "cita-suite" as const,
      modalities,
      intakeFields: [],
      videoInstructions: null,
    },
    demo: false,
  };
}

it.each([true, false])('preserves selection in a native POST action, including integrated=%s', integrated => {
  const fixture = bookingFixture(['in_person']);
  const data = { ...fixture, integration: integrated ? fixture.integration : null,
    presentation: integrated ? fixture.presentation : null };
  render(PublicBookingFlow, { data });
  const form = screen.getByRole('button', { name: 'Confirmar reserva' }).closest('form')!;
  const action = new URL(form.getAttribute('action')!, 'https://booking.example.test/reservar/synthetic?date=2026-11-02');
  expect(action.searchParams.has('/create_booking')).toBe(true);
  expect(action.searchParams.get('service_id')).toBe('service');
  expect(action.searchParams.get('professional_id')).toBe('professional');
  expect(action.searchParams.get('date')).toBe('2026-11-02');
  expect(action.searchParams.get('slot')).toBe('2026-11-02T09:00:00.000Z');
  expect(action.searchParams.has('patient_email')).toBe(false);
  expect(action.searchParams.has('patient_phone')).toBe(false);
});

it("does not animate the step into view when going back, so the page is not moving under a press", () => {
  const scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 0;
  });
  Element.prototype.scrollIntoView = scrollIntoView;
  render(PublicBookingFlow, { data: bookingFixture(["in_person"]), form: null });
  const days = { url: new URL("https://booking.example.test/reservar/a?service_id=service") };
  const hours = { url: new URL("https://booking.example.test/reservar/a?service_id=service&date=2026-11-02") };
  navigation.after({ from: days, to: hours, type: "link" });
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
  navigation.after({ from: hours, to: days, type: "popstate" });
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "instant", block: "start" });
  vi.unstubAllGlobals();
});

it('keeps edited contact, questions and a valid birth date when the same booking form remounts', async () => {
  const fields: BookingIntakeField[] = [
    { id: 'coverage', label: 'Cobertura', kind: 'text', required: false, patientField: 'insurance' },
    { id: 'age', label: 'Edad', kind: 'text', required: false, patientField: 'age' },
    { id: 'detail', label: 'Detalle adicional', kind: 'textarea', required: false },
    { id: 'choice', label: 'Opción preferida', kind: 'choice', required: false, options: ['Primera', 'Segunda'] },
    { id: 'answer', label: 'Pregunta booleana', kind: 'boolean', required: false },
    { id: 'birth', label: 'Nacimiento', kind: 'text', required: false, patientField: 'birth_date' }
  ];
  const data = { ...bookingFixture(['in_person']), patientFields: { hash: 'c'.repeat(64), fields } };
  const form = { values: { patient_name: 'Nombre anterior', patient_phone: '3425048200', patient_email: 'Old@Example.test' } };
  const { container, rerender } = render(PublicBookingFlow, { data, form });
  await fireEvent.input(screen.getByLabelText('Nombre y apellido'), { target: { value: 'Paciente Reserva Nueva' } });
  await fireEvent.input(screen.getByLabelText('Teléfono de contacto'), { target: { value: '3425048230' } });
  await fireEvent.input(screen.getByLabelText('Correo electrónico'), { target: { value: 'Draft+New@Example.test' } });
  await fireEvent.input(screen.getByLabelText('Comentario'), { target: { value: 'Comentario conservado' } });
  await fireEvent.input(screen.getByLabelText('Cobertura'), { target: { value: 'Cobertura conservada' } });
  await fireEvent.input(screen.getByLabelText('Edad'), { target: { value: '36' } });
  await fireEvent.input(screen.getByLabelText('Detalle adicional'), { target: { value: 'Detalle conservado' } });
  await fireEvent.change(container.querySelector('select[name="intake_choice"]')!, { target: { value: 'Segunda' } });
  await fireEvent.click(screen.getByRole('radio', { name: 'Sí' }));
  await fireEvent.input(screen.getByLabelText('Nacimiento: día'), { target: { value: '02' } });
  await fireEvent.input(screen.getByLabelText('Nacimiento: mes'), { target: { value: '01' } });
  await fireEvent.input(screen.getByLabelText('Nacimiento: año'), { target: { value: '1990' } });
  const payload = () => Object.fromEntries(new FormData(container.querySelector('form')!).entries());
  const expected = { patient_name: 'Paciente Reserva Nueva', patient_phone: '3425048230', patient_email: 'Draft+New@Example.test',
    note: 'Comentario conservado', intake_coverage: 'Cobertura conservada', intake_age: '36', intake_detail: 'Detalle conservado',
    intake_choice: 'Segunda', intake_answer: 'true', intake_birth: '1990-01-02' };
  expect(payload()).toMatchObject(expected);
  await rerender({ data: { ...data, state: { ...data.state, slots: [] } } });
  expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).toBeNull();
  await rerender({ data });
  expect(payload()).toMatchObject(expected);
});

it('does not interpret an echoed local birth date edit as an external reset while incomplete', async () => {
  const fields: BookingIntakeField[] = [{ id: 'birth', label: 'Nacimiento', kind: 'text', required: false, patientField: 'birth_date' }];
  const data = { ...bookingFixture(['in_person']), patientFields: { hash: 'c'.repeat(64), fields } };
  const { container } = render(PublicBookingFlow, { data, form: { values: { intake_birth: '2000-01-02' } } });
  const month = screen.getByLabelText('Nacimiento: mes');
  await fireEvent.input(month, { target: { value: '0' } });
  expect((screen.getByLabelText('Nacimiento: año') as HTMLInputElement).value).toBe('2000');
  expect((screen.getByLabelText('Nacimiento: día') as HTMLInputElement).value).toBe('02');
  expect(new FormData(container.querySelector('form')!).get('intake_birth')).toBe('');
  await fireEvent.input(month, { target: { value: '02' } });
  expect(new FormData(container.querySelector('form')!).get('intake_birth')).toBe('2000-02-02');
});

it("places every required question and contact before optional fields without changing schema order", () => {
  const data = bookingFixture(["in_person"]);
  const fields = [
    {
      id: "optional_first",
      label: "Información adicional",
      kind: "textarea",
      required: false,
      maxLength: 500,
    },
    {
      id: "required_first",
      label: "Cobertura",
      kind: "text",
      required: true,
      maxLength: 120,
    },
    {
      id: "optional_last",
      label: "Otra consulta",
      kind: "text",
      required: false,
      maxLength: 120,
    },
    {
      id: "required_last",
      label: "Pregunta necesaria",
      kind: "boolean",
      required: true,
    },
  ];
  Object.assign(data, { patientFields: { hash: "c".repeat(64), fields } });
  render(PublicBookingFlow, { data });
  const form = screen
    .getByRole("button", { name: "Confirmar reserva" })
    .closest("form")!;
  const names = (scope: string) =>
    [...form.querySelectorAll<HTMLInputElement>(scope + " [name]")].map(
      (el) => el.name,
    );
  expect([...new Set(names(".patient-required-fields"))]).toEqual([
    "patient_name",
    "patient_phone",
    "patient_email",
    "intake_required_first",
    "intake_required_last",
  ]);
  expect(names(".patient-optional-fields")).toEqual([
    "intake_optional_first",
    "intake_optional_last",
    "note",
  ]);
  expect(fields.map((field) => field.id)).toEqual([
    "optional_first",
    "required_first",
    "optional_last",
    "required_last",
  ]);
  expect(
    screen.queryByText("Información para el consultorio"),
  ).not.toBeInTheDocument();
});
it("requires an explicit yes/no answer and preserves false as the submitted value", async () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, {
    patientFields: {
      hash: "c".repeat(64),
      fields: [
        {
          id: "required_bool",
          label: "Pregunta necesaria",
          kind: "boolean",
          required: true,
        },
      ],
    },
  });
  render(PublicBookingFlow, { data });
  const group = screen.getByRole("group", { name: "Pregunta necesaria" });
  const no = group.querySelector<HTMLInputElement>('input[value="false"]')!;
  expect(no).not.toBeChecked();
  expect(no.validity.valueMissing).toBe(true);
  const { fireEvent } = await import("@testing-library/svelte");
  await fireEvent.click(no);
  expect(no).toBeChecked();
  expect(no.validity.valueMissing).toBe(false);
  expect(new FormData(no.form!).get("intake_required_bool")).toBe("false");
});
it("lets patients clear an optional yes/no answer", async () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, {
    patientFields: {
      hash: "c".repeat(64),
      fields: [
        {
          id: "optional_bool",
          label: "Dato adicional",
          kind: "boolean",
          required: false,
        },
      ],
    },
  });
  render(PublicBookingFlow, { data });
  const group = screen.getByRole("group", { name: "Dato adicional" });
  const { fireEvent } = await import("@testing-library/svelte");
  const yes = group.querySelector<HTMLInputElement>('input[value="true"]')!;
  await fireEvent.click(yes);
  expect(new FormData(yes.form!).get("intake_optional_bool")).toBe("true");
  await fireEvent.click(group.querySelector('input[value=""]')!);
  expect(new FormData(yes.form!).get("intake_optional_bool")).toBe("");
});
it("shows the selected-date quote once in the final summary instead of the static service price", () => {
  const data = bookingFixture(["in_person"]);
  data.state.services[0].price_label = "$20.000";
  Object.assign(data, {
    priceQuote: {
      amount: 21016,
      base_amount: 20000,
      currency: "ARS",
      date: "2026-11-02",
      month: "2026-11",
      adjusted: true,
      hash: "d".repeat(64),
      revision: 1,
      policy_id: "policy",
    },
  });
  render(PublicBookingFlow, { data });
  expect(document.querySelector(".patient-price")).toHaveTextContent("21.016");
  expect(screen.getAllByText(/21\.016/)).toHaveLength(1);
  expect(
    screen.getByText(/Este arancel incluye los ajustes/),
  ).toBeInTheDocument();
  expect(
    document.querySelector<HTMLInputElement>('[name="price_quote_hash"]')
      ?.value,
  ).toBe("d".repeat(64));
});

// The notice compares the due date with the current time: the clock is fixed so that the expected
// text never changes with the day the test runs.
const noticeFor = (data: ReturnType<typeof bookingFixture>) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  try {
    render(PublicBookingFlow, { data });
  } finally {
    vi.useRealTimers();
  }
  return document.querySelector("[data-deposit-notice]");
};

it("shows the deposit of the chosen slot in the summary, before the person confirms", () => {
  const data = bookingFixture(["in_person"]);
  data.depositTerms = {
    "2026-11-02T09:00:00.000Z": {
      amount: 40000,
      dueAt: "2026-10-31T09:00:00.000Z",
      autoCancel: true,
    },
  };
  const notice = noticeFor(data);
  expect(notice?.textContent?.replace(/\s+/g, " ")).toBe(
    "Este turno requiere una seña de $ 40.000. Tenés tiempo hasta el sábado, 31 de octubre a las 09:00 para transferirla. Si no se registra, el turno se cancela automáticamente.",
  );
  const confirm = screen.getByRole("button", { name: "Confirmar reserva" });
  const savedTerms = confirm.closest('form')!.querySelector<HTMLInputElement>('[name="deposit_terms"]');
  expect(savedTerms).not.toBeNull();
  expect(JSON.parse(savedTerms!.value)).toEqual(data.depositTerms['2026-11-02T09:00:00.000Z']);
  expect(
    notice!.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("says so when the deposit terms could not be computed, without promising there is none", () => {
  const data = bookingFixture(["in_person"]);
  data.depositTerms = null;
  expect(noticeFor(data)).toHaveTextContent(
    "No pudimos calcular si este turno requiere una seña. Si corresponde, la vas a ver al terminar la reserva.",
  );
});

it("says nothing about a deposit when the chosen slot asks none", () => {
  const data = bookingFixture(["in_person"]);
  data.depositTerms = {
    "2026-11-02T10:00:00.000Z": {
      amount: 40000,
      dueAt: "2026-10-31T10:00:00.000Z",
      autoCancel: true,
    },
  };
  expect(noticeFor(data)).toBeNull();
  expect(screen.queryByText(/seña/)).toBeNull();
});


it("shows optional email only when the clinic disables the requirement and preserves the supplied alias", () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, { requireEmail: false });
  render(PublicBookingFlow, { data, form: { values: { patient_email: "Family+Turnos@Example.test" } } });
  const email = screen.getByLabelText("Correo electrónico");
  expect(email).not.toBeRequired();
  expect(email.closest("fieldset")).toHaveClass("patient-optional-fields");
  expect(email).toHaveValue("Family+Turnos@Example.test");
});


it.each([
  { required: true, disposition: "forfeit", previous: "no se aplicará", next: "se pedirá una nueva" },
  { required: true, disposition: "credit", previous: "seguirá a cuenta", next: "se pedirá una nueva" },
  { required: false, disposition: "credit", previous: "seguirá a cuenta", next: "no se pedirá una nueva" },
  { required: false, disposition: "forfeit", previous: "no se aplicará", next: "no se pedirá una nueva" },
])("discloses $required / $disposition before confirming and submits exactly those rules", ({ required, disposition, previous, next }) => {
  const data = bookingFixture(["in_person"]);
  const policy = { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: required, previous_deposit_disposition: disposition };
  Object.assign(data, { reschedulePolicy: policy });
  data.depositTerms = { "2026-11-02T09:00:00.000Z": { amount: 40000, dueAt: "2026-10-31T09:00:00.000Z", autoCancel: true } };
  noticeFor(data);
  const notice = document.querySelector("[data-reschedule-policy-notice]")!;
  expect(notice).toHaveTextContent(previous); expect(notice).toHaveTextContent(next);
  expect(notice).toHaveTextContent("una sola seña pendiente");
  const confirm = screen.getByRole("button", { name: "Confirmar reserva" });
  expect(notice.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const header = confirm.closest("form")!.querySelector<HTMLInputElement>('[name="reschedule_policy_terms"]')!;
  expect(JSON.parse(header.value)).toEqual(policy);
});

it("discloses conditional rescheduling terms when the deposit quote is unavailable", () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, { reschedulePolicy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: "forfeit" } });
  data.depositTerms = null;
  noticeFor(data);
  expect(document.querySelector("[data-reschedule-policy-notice]")).toHaveTextContent("Si este turno requiere seña");
  expect(document.querySelector('[name="reschedule_policy_terms"]')).not.toBeNull();
});

it("does not show or submit monetary penalties for a slot without a deposit", () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, { reschedulePolicy: { schema_version: 1, policy_revision: 7, require_deposit_on_reschedule: true, previous_deposit_disposition: "forfeit" } });
  noticeFor(data);
  expect(document.querySelector("[data-reschedule-policy-notice]")).toBeNull();
  expect(document.querySelector('[name="reschedule_policy_terms"]')).toBeNull();
});

it("P6: muestra leyenda de valor estimado sólo cuando el arancel incluye ajustes futuros", () => {
  const adjustedData = bookingFixture(["in_person"]);
  Object.assign(adjustedData, {
    priceQuote: {
      amount: 35000,
      base_amount: 32000,
      currency: "ARS",
      date: "2026-11-02",
      month: "2026-11",
      adjusted: true,
      hash: "e".repeat(64),
      revision: 1,
      policy_id: "policy",
    },
  });
  render(PublicBookingFlow, { data: adjustedData });
  expect(screen.getByText(/valor estimado/i)).toBeInTheDocument();
  expect(screen.getByText(/puede actualizarse/i)).toBeInTheDocument();

  cleanup();

  const fixedData = bookingFixture(["in_person"]);
  Object.assign(fixedData, {
    priceQuote: {
      amount: 32000,
      base_amount: 32000,
      currency: "ARS",
      date: "2026-11-02",
      month: "2026-11",
      adjusted: false,
      hash: "f".repeat(64),
      revision: 1,
      policy_id: "policy",
    },
  });
  render(PublicBookingFlow, { data: fixedData });
  expect(screen.queryByText(/valor estimado/i)).not.toBeInTheDocument();
});

it("P10: despliega «¿No tenés correo?» sin perder datos, en el orden correcto y con WhatsApp prearmado", async () => {
  const data = bookingFixture(["in_person", "video"]);
  Object.assign(data.state.business, {
    phone: "+54 341 555-0100",
    whatsapp_contact_phone: "+5493415550101",
  });
  render(PublicBookingFlow, { data });

  const emailLabel = document.querySelector('label[for="patient-email"]')!;
  expect(emailLabel.textContent).not.toMatch(/obligatorio/i);
  expect(screen.getByText(/confirmación y los recordatorios/i)).toBeInTheDocument();

  const nameInput = screen.getByLabelText("Nombre y apellido");
  await fireEvent.input(nameInput, { target: { value: "Marta Gómez" } });

  const trigger = screen.getByRole("button", { name: "¿No tenés correo?" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Preserva lo ya escrito y elegido.
  expect(nameInput).toHaveValue("Marta Gómez");

  const familyText = screen.getByText(/correo de un familiar/i);
  const waButton = screen.getByRole("link", { name: "Pedir turno por WhatsApp" });
  expect(familyText.compareDocumentPosition(waButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(waButton).toHaveAttribute("target", "_blank");
  const waHref = decodeURIComponent(waButton.getAttribute("href") ?? "");
  expect(waHref).toContain("Marta Gómez");
  expect(waHref).toContain("Consulta");
  expect(waHref).toContain("09:00");
  expect(screen.getByText(/no queda reservado hasta que el consultorio/i)).toBeInTheDocument();
});

it("P10: sin WhatsApp configurado muestra sugerencia familiar y teléfono público sin botón roto", async () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data.state.business, { phone: "+54 341 555-0100", whatsapp_contact_phone: null });
  render(PublicBookingFlow, { data });

  await fireEvent.click(screen.getByRole("button", { name: "¿No tenés correo?" }));
  expect(screen.getByText(/correo de un familiar/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /WhatsApp/i })).not.toBeInTheDocument();
  const telLink = screen.getByRole("link", { name: "+54 341 555-0100" });
  expect(telLink).toHaveAttribute("href", "tel:+543415550100");
});

it("P10: al fallar por correo vacío muestra las mismas salidas asociadas al campo y no aparece cuando el correo es opcional", async () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data.state.business, { whatsapp_contact_phone: "+5493415550101" });
  render(PublicBookingFlow, {
    data,
    form: {
      emailMissing: true,
      message: "Completá tu correo electrónico para reservar el turno.",
      values: { patient_name: "Marta Gómez" },
    },
  });

  const email = screen.getByLabelText("Correo electrónico");
  expect(email).toHaveAttribute("aria-invalid", "true");
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent(/correo de un familiar/i);
  expect(alert.querySelector('a[href*="wa.me"], a[href*="whatsapp.com"]')).not.toBeNull();
  expect(email.getAttribute("aria-describedby")).toContain(alert.id);

  cleanup();

  const optionalData = bookingFixture(["in_person"]);
  Object.assign(optionalData, { requireEmail: false });
  render(PublicBookingFlow, { data: optionalData });
  expect(screen.queryByRole("button", { name: "¿No tenés correo?" })).not.toBeInTheDocument();
});

it("P2 + P5: el paso previo a reservar muestra a la vez el vencimiento exacto de la seña y el límite de autogestión", () => {
  const data = bookingFixture(["in_person"]);
  Object.assign(data, {
    selfManagementCutoffHours: 48,
    depositTerms: {
      "2026-11-02T09:00:00.000Z": {
        amount: 40000,
        dueAt: "2026-10-26T09:00:00.000Z",
        autoCancel: true,
      },
    },
  });
  // Freeze time well before the slot so both deposit and cutoff are in the future
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  try {
    render(PublicBookingFlow, { data });
    expect(document.querySelector("[data-deposit-notice]")?.textContent).toContain("26 de octubre a las 09:00");
    expect(document.querySelector("[data-self-management-notice]")?.textContent).toMatch(/48\s*horas antes/i);
    expect(document.querySelector("[data-self-management-notice]")?.textContent).toContain("31 de octubre a las 09:00");
  } finally {
    vi.useRealTimers();
  }
});
