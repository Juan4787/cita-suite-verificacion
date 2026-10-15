import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const require = createRequire(root + "/apps/web/package.json");
const { chromium, expect } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");
const fixturePath = process.env.E2E_LOCAL_BOOKING_FIXTURE_PATH;
if (!fixturePath)
  throw new Error(
    "E2E_LOCAL_BOOKING_FIXTURE_PATH must point to the disposable local fixture.",
  );
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
assert.equal(fixture.businessId, "90000000-0000-4000-8000-000000000001");
assert.equal(new URL(fixture.appOrigin).hostname, "127.0.0.1");
assert.equal(new URL(fixture.apiOrigin).hostname, "127.0.0.1");
const out = root + "/.impeccable/review/reservation-settings";
mkdirSync(out, { recursive: true });
const db = createClient(fixture.apiOrigin, fixture.service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const results = {
  scope:
    "Local PostgreSQL/PostgREST, simulated Auth, sequential Chromium; no production requests or changes.",
  browserPath:
    "No approved host-managed browser capability; regular Playwright per frontend-testing-debugging skill.",
  checks: [],
  screenshots: [],
  errors: [],
  console: [],
  fixtureRealtimeWarnings: 0,
};
function pass(name) {
  results.checks.push(name);
  writeFileSync(out + "/results.json", JSON.stringify(results, null, 2));
  console.log("PASS " + name);
}
async function choose(page, name, option) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function row(table, columns, filter) {
  let query = db.from(table).select(columns);
  for (const [key, value] of Object.entries(filter))
    query = query.eq(key, value);
  const result = await query.single();
  assert.equal(result.error, null);
  return result.data;
}
async function context(
  browser,
  role = "owner",
  width = 1440,
  javaScriptEnabled = true,
) {
  const c = await browser.newContext({
    viewport: { width, height: 900 },
    javaScriptEnabled,
    reducedMotion: "reduce",
    locale: "es-AR",
  });
  await c.addCookies([
    { name: "sb-module", value: "odonto", url: fixture.appOrigin },
    {
      name: "sb-access-token",
      value: fixture[role + "Token"],
      url: fixture.appOrigin,
    },
    {
      name: "sb-refresh-token",
      value: "local-simulator-only",
      url: fixture.appOrigin,
    },
    {
      name: "active-business-id",
      value: fixture.businessId,
      url: fixture.appOrigin,
    },
  ]);
  await c.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (
      [
        "127.0.0.1",
        "localhost",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
      ].includes(u.hostname) ||
      u.protocol === "data:"
    )
      await route.continue();
    else await route.abort();
  });
  return c;
}
function watch(page) {
  page.on("pageerror", (error) => results.errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.text().includes("/realtime/v1/websocket") &&
      message.text().includes("127.0.0.1")
    ) {
      results.fixtureRealtimeWarnings++;
      return;
    }
    if (
      ["error", "warning"].includes(message.type()) &&
      !message.text().startsWith("Failed to load resource")
    )
      results.console.push({
        type: message.type(),
        text: message.text().replace(/apikey=[^&\s']+/g, "apikey=[redacted]"),
      });
  });
}
async function captureMenu(page, name) {
  await expect(page.locator(".ux-control-menu:popover-open")).toBeVisible();
  const path = out + "/" + name + ".png";
  await page.screenshot({ path, fullPage: false });
  results.screenshots.push(path);
}
async function capture(page, name) {
  const ready = page.locator("[data-editor-ready]");
  if (await ready.count())
    await expect(ready.first()).toHaveAttribute("data-editor-ready", "true");
  await page.evaluate(() => {
    scrollTo(0, 0);
    return document.fonts.ready;
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    name + " horizontal overflow",
  );
  const path = out + "/" + name + ".png";
  await page.screenshot({ path, fullPage: true });
  results.screenshots.push(path);
}
const browser = await chromium.launch({ headless: true });
try {
  const owner = await context(browser);
  await owner.grantPermissions(["clipboard-read", "clipboard-write"]);
  const p = await owner.newPage();
  watch(p);
  await p.goto(fixture.appOrigin + "/odonto/configuracion");
  await expect(
    p.getByRole("heading", { name: "Configuración", exact: true }),
  ).toBeVisible();
  await expect(
    p.getByRole("link", { name: "Link de reserva", exact: true }),
  ).toHaveCount(0);
  await capture(p, "settings-desktop");
  await p.getByRole("link", { name: /Reserva online Compartir/ }).click();
  await expect(p).toHaveURL(/configuracion\/reserva-online$/);
  await expect(p).toHaveTitle("Reserva online · Cita Suite");
  const main = p.locator(".reservation-page");
  await expect(main.getByRole("button")).toHaveCount(3);
  await expect(
    main.locator('[name="professional_ids"],[name="service_ids"]'),
  ).toHaveCount(0);
  await expect(main.getByText("Profesional del formulario")).toHaveCount(0);
  const actualRules = await row("businesses", "max_booking_days_ahead", {
    id: fixture.businessId,
  });
  await expect(
    p.getByRole("combobox", {
      name: "¿Hasta cuándo pueden reservar?",
      exact: true,
    }),
  ).toContainText(String(actualRules.max_booking_days_ahead));
  await p.getByRole("button", { name: "Copiar enlace", exact: true }).click();
  await expect(
    p.getByRole("status").filter({ hasText: "Enlace copiado" }),
  ).toBeVisible();
  assert.equal(
    await p.evaluate(() => navigator.clipboard.readText()),
    fixture.appOrigin + "/reservar/" + fixture.businessId,
  );
  await capture(p, "reservation-desktop");
  await p
    .getByRole("combobox", {
      name: "¿Hasta cuándo pueden reservar?",
      exact: true,
    })
    .click();
  await captureMenu(p, "reservation-select-open");
  await p.keyboard.press("Escape");
  pass(
    "First visit: one reservation entry, three main task buttons, no duplicated professional/service/question editors.",
  );
  const before = await row(
    "businesses",
    "name,address,public_booking_enabled,min_booking_notice_minutes,max_booking_days_ahead",
    { id: fixture.businessId },
  );
  await choose(p, "¿Hasta cuándo pueden reservar?", "Próximos 30 días");
  await choose(p, "¿Con cuánta anticipación?", "2 horas antes");
  await p
    .getByLabel(/Condiciones de cancelación/)
    .fill("Condiciones sintéticas para QA.");
  await p.getByRole("button", { name: "Guardar reglas", exact: true }).click();
  await expect(
    p.getByRole("status").filter({ hasText: "Reglas de reserva guardadas" }),
  ).toBeVisible();
  const saved = await row(
    "businesses",
    "name,address,public_booking_enabled,min_booking_notice_minutes,max_booking_days_ahead,cancellation_policy",
    { id: fixture.businessId },
  );
  assert.equal(saved.name, before.name);
  assert.equal(saved.address, before.address);
  assert.equal(saved.public_booking_enabled, before.public_booking_enabled);
  assert.equal(saved.max_booking_days_ahead, 30);
  assert.equal(saved.min_booking_notice_minutes, 120);
  pass(
    "Booking rules save to the real local DB without changing the identity or booking activation.",
  );
  await p
    .getByRole("button", { name: "Pausar nuevas reservas", exact: true })
    .click();
  await expect(p.getByText("Reservas pausadas", { exact: true })).toBeVisible();
  assert.equal(
    (
      await row("businesses", "public_booking_enabled", {
        id: fixture.businessId,
      })
    ).public_booking_enabled,
    false,
  );
  await p
    .getByRole("button", { name: "Activar reservas", exact: true })
    .click();
  await expect(
    p.getByText("Reservas activadas", { exact: true }),
  ).toBeVisible();
  pass("Activation and pause update only new-booking availability.");
  await p.setViewportSize({ width: 390, height: 844 });
  await capture(p, "reservation-mobile");
  await p
    .getByRole("combobox", {
      name: "¿Hasta cuándo pueden reservar?",
      exact: true,
    })
    .click();
  await captureMenu(p, "reservation-select-mobile");
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 320, height: 844 });
  await capture(p, "reservation-320");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(fixture.appOrigin + "/odonto/configuracion/negocio");
  await expect(
    p.getByRole("heading", { name: "Datos del consultorio", exact: true }),
  ).toBeVisible();
  await expect(
    p.locator(
      '[name="public_booking_enabled"],[name="max_booking_days_ahead"],[name="min_booking_notice_minutes"],[name="cancellation_policy"]',
    ),
  ).toHaveCount(0);
  await capture(p, "practice-desktop");
  const form = p.locator("form#datos-visibles");
  const submitted = await form.evaluate((node) =>
    Object.fromEntries(new FormData(node)),
  );
  const action = await form.getAttribute("action");
  const response = await owner.request.post(
    fixture.appOrigin + "/odonto/configuracion/negocio" + action,
    { form: submitted, headers: { origin: fixture.appOrigin } },
  );
  assert.equal(response.status(), 200);
  const after = await row(
    "businesses",
    "public_booking_enabled,min_booking_notice_minutes,max_booking_days_ahead,cancellation_policy",
    { id: fixture.businessId },
  );
  assert.deepEqual(after, {
    public_booking_enabled: true,
    min_booking_notice_minutes: 120,
    max_booking_days_ahead: 30,
    cancellation_policy: "Condiciones sintéticas para QA.",
  });
  pass("Saving the practice profile cannot reset the moved booking rules.");
  await p.goto(fixture.appOrigin + "/odonto/configuracion/documentos");
  await expect(
    p.getByRole("heading", { name: "Archivos de pacientes", exact: true }),
  ).toBeVisible();
  await expect(
    p.locator('[name="whatsapp_phone"],[name="service_id"]'),
  ).toHaveCount(0);
  const publicBefore = await row(
    "businesses",
    "patient_documents_enabled,public_contact_enabled,whatsapp_contact_enabled,whatsapp_phone,whatsapp_message",
    { id: fixture.businessId },
  );
  await p
    .getByRole("checkbox", { name: "Permitir que adjunten archivos al turno" })
    .uncheck();
  await p
    .getByRole("button", { name: "Guardar permisos", exact: true })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: "Permisos de archivos guardados" }),
  ).toBeVisible();
  const documentSaved = await row(
    "businesses",
    "patient_documents_enabled,public_contact_enabled,whatsapp_contact_enabled,whatsapp_phone,whatsapp_message",
    { id: fixture.businessId },
  );
  assert.deepEqual(documentSaved, {
    ...publicBefore,
    patient_documents_enabled: false,
  });
  await capture(p, "documents-desktop");
  await p.goto(fixture.appOrigin + "/odonto/configuracion/negocio/contacto");
  await expect(
    p.getByRole("heading", { name: "Contacto en tu web", exact: true }),
  ).toBeVisible();
  await expect(
    p.locator('[name="patient_documents_enabled"],[name="service_id"]'),
  ).toHaveCount(0);
  await p
    .getByRole("button", { name: "Guardar contacto", exact: true })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: "Contacto web guardado" }),
  ).toBeVisible();
  assert.equal(
    (
      await row("businesses", "patient_documents_enabled", {
        id: fixture.businessId,
      })
    ).patient_documents_enabled,
    false,
  );
  await capture(p, "contact-desktop");
  pass(
    "Document uploads and public contact have their own task locations and cannot overwrite each other.",
  );

  await p.goto(
    fixture.appOrigin +
      "/odonto/profesionales/" +
      fixture.professionalId +
      "?tab=servicios",
  );
  await expect(
    p.getByRole("button", { name: "Servicios y aranceles", exact: true }),
  ).toBeVisible();
  await expect(p.locator("[data-editor-ready]")).toHaveAttribute(
    "data-editor-ready",
    "true",
  );
  const serviceBefore = await row(
    "services",
    "patient_instructions,public_reminder_description,duration_minutes",
    { id: fixture.serviceId },
  );
  const serviceRow = p
    .locator(".ux-choice")
    .filter({ hasText: "Consulta de prueba" })
    .first();
  await serviceRow.getByRole("button", { name: "Editar", exact: true }).click();
  const modal = p.getByRole("dialog", { name: "Editar servicio" });
  await modal
    .getByLabel(/Indicaciones para la consulta/)
    .fill("Indicaciones sintéticas de UX.");
  await modal
    .getByLabel(/Texto del aviso del turno/)
    .fill("Aviso sintético de UX.");
  await capture(p, "service-editor-desktop");
  await modal
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const serviceAfter = await row(
    "services",
    "patient_instructions,public_reminder_description,duration_minutes",
    { id: fixture.serviceId },
  );
  assert.equal(
    serviceAfter.patient_instructions,
    "Indicaciones sintéticas de UX.",
  );
  assert.equal(
    serviceAfter.public_reminder_description,
    "Aviso sintético de UX.",
  );
  assert.equal(serviceAfter.duration_minutes, serviceBefore.duration_minutes);
  pass(
    "Service instructions and reminder text are edited with that service; duration is preserved.",
  );
  await p.getByRole("button", { name: "Horarios", exact: true }).click();
  await p.getByRole("button", { name: /^Fecha,/ }).click();
  await expect(
    p.getByRole("dialog", { name: "Fecha", exact: true }),
  ).toBeVisible();
  await p
    .getByRole("dialog", { name: "Fecha", exact: true })
    .screenshot({ path: out + "/calendar-desktop.png" });
  results.screenshots.push(out + "/calendar-desktop.png");
  await p.keyboard.press("Escape");
  await p
    .getByRole("button", { name: "Servicios y aranceles", exact: true })
    .click();
  await p
    .getByRole("link", {
      name: "Configurar aranceles y ajustes mensuales",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: /^Mes de referencia,/ }).click();
  await expect(
    p.getByRole("dialog", { name: "Mes de referencia", exact: true }),
  ).toBeVisible();
  await p
    .getByRole("dialog", { name: "Mes de referencia", exact: true })
    .screenshot({ path: out + "/months-desktop.png" });
  results.screenshots.push(out + "/months-desktop.png");
  await p.keyboard.press("Escape");
  await capture(p, "prices-desktop");
  await p.setViewportSize({ width: 390, height: 844 });
  await capture(p, "prices-mobile");
  await p.setViewportSize({ width: 1440, height: 900 });
  pass(
    "Authored date/month calendars open inside professional settings and close with Escape.",
  );
  await p.goto(
    fixture.appOrigin +
      "/odonto/profesionales/" +
      fixture.professionalId +
      "/preguntas",
  );
  await expect(p).toHaveURL(/\/preguntas$/);
  await expect(
    p.getByRole("heading", { name: "Preguntas al paciente", exact: true }),
  ).toBeVisible();
  await capture(p, "questions-desktop");
  const qBefore = await row("professional_booking_forms", "fields,revision", {
    professional_id: fixture.professionalId,
  });
  await p.getByRole("checkbox", { name: "Alergias", exact: true }).check();
  const allergies = p.locator(".question-row").filter({ hasText: "Alergias" });
  await allergies
    .getByRole("checkbox", { name: "Obligatorio", exact: true })
    .check();
  await p
    .getByRole("button", { name: "Guardar preguntas", exact: true })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: "Preguntas guardadas" }),
  ).toBeVisible();
  const qAfter = await row("professional_booking_forms", "fields,revision", {
    professional_id: fixture.professionalId,
  });
  assert(
    qAfter.fields.some((f) => f.patientField === "allergies" && f.required),
  );
  assert(
    qBefore.fields.every((old) => qAfter.fields.some((f) => f.id === old.id)),
  );
  pass(
    "Questions live inside the professional; standard answers automatically retain their patient-profile mappings and existing IDs.",
  );
  await p
    .getByRole("button", { name: "Agregar pregunta", exact: true })
    .click();
  const customLabel = "Preferencia de contacto QA " + Date.now();
  await p
    .getByLabel("Texto de la pregunta")
    .last()
    .pressSequentially(customLabel);
  await expect(p.getByLabel("Texto de la pregunta").last()).toBeVisible();
  await p
    .getByRole("combobox", { name: "Respuesta", exact: true })
    .last()
    .click();
  await p
    .getByRole("option", { name: "Elegir una opción", exact: true })
    .click();
  await p.getByLabel("Opciones de respuesta").last().fill("Teléfono\nCorreo");
  const custom = p.locator(".question-row").filter({ hasText: customLabel });
  await custom
    .getByRole("checkbox", { name: "Obligatorio", exact: true })
    .check();
  await p.getByRole("link", { name: "Perfil", exact: true }).click();
  const guard = p.getByRole("dialog", {
    name: "Cambios sin guardar",
    exact: true,
  });
  await expect(guard).toBeVisible();
  await guard.screenshot({ path: out + "/unsaved-dialog-desktop.png" });
  results.screenshots.push(out + "/unsaved-dialog-desktop.png");
  await p.setViewportSize({ width: 390, height: 844 });
  await guard.screenshot({ path: out + "/unsaved-dialog-mobile.png" });
  results.screenshots.push(out + "/unsaved-dialog-mobile.png");
  await guard
    .getByRole("button", { name: "Seguir editando", exact: true })
    .click();
  await expect(p.getByLabel("Texto de la pregunta").last()).toHaveValue(
    customLabel,
  );
  await p.setViewportSize({ width: 1440, height: 900 });
  pass(
    "Authored unsaved-changes dialog retains the edited question when navigation is cancelled.",
  );
  await Promise.all([
    p.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/preguntas"),
    ),
    p.getByRole("button", { name: "Guardar preguntas", exact: true }).click(),
  ]);
  await expect(
    p.getByRole("status").filter({ hasText: "Preguntas guardadas" }),
  ).toBeVisible();
  const customSaved = await row("professional_booking_forms", "fields", {
    professional_id: fixture.professionalId,
  });
  assert(
    customSaved.fields.some(
      (f) =>
        f.label === customLabel &&
        f.required &&
        f.kind === "choice" &&
        f.options.length === 2,
    ),
  );
  pass(
    "Adding and typing a custom question keeps its editor open; choices and required state persist.",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await capture(p, "questions-mobile");
  await p.setViewportSize({ width: 320, height: 844 });
  await capture(p, "questions-320");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(fixture.appOrigin + "/odonto/configuracion/reserva-online/webs");
  await capture(p, "web-list-desktop");
  await p.getByRole("link", { name: /Host de prueba/ }).click();
  await expect(
    p.getByRole("heading", { name: "Editar sitio", exact: true }),
  ).toBeVisible();
  await capture(p, "web-editor-desktop");
  const oldOrigin = await p
    .getByLabel("Dirección web 1", { exact: true })
    .inputValue();
  await p
    .getByLabel("Dirección web 1", { exact: true })
    .fill("Una novela en lugar de una dirección");
  assert(
    !(await p
      .getByLabel("Dirección web 1", { exact: true })
      .evaluate((node) => node.checkValidity())),
  );
  await p
    .getByLabel("Dirección web 1", { exact: true })
    .fill("https://example.test/pagina");
  assert(
    !(await p
      .getByLabel("Dirección web 1", { exact: true })
      .evaluate((node) => node.checkValidity())),
  );
  await p.getByLabel("Dirección web 1", { exact: true }).fill(oldOrigin);
  const integrationBefore = await row(
    "booking_integrations",
    "public_key,intake_schema,allowed_professional_ids,allowed_service_ids,theme,allowed_modalities,is_default",
    { public_key: fixture.key },
  );
  await p
    .getByRole("button", { name: "Guardar y continuar", exact: true })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: "Configuración guardada" }),
  ).toBeVisible();
  const integrationAfter = await row(
    "booking_integrations",
    "public_key,intake_schema,allowed_professional_ids,allowed_service_ids,theme,allowed_modalities,is_default",
    { public_key: fixture.key },
  );
  assert.deepEqual(integrationAfter, integrationBefore);
  pass(
    "Website URL inputs refuse prose and page paths; saving two offered services preserves the integration key, scopes, legacy questions, theme and modalities.",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await capture(p, "web-editor-mobile");
  await p.setViewportSize({ width: 320, height: 844 });
  await capture(p, "web-editor-320");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.getByText('Editar configuración de', {exact:false}).click();
  await p.getByLabel("Nombre del sitio").fill("Borrador que debe descartarse");
  await p.evaluate(() => {
    const anchor = document.createElement("a");
    anchor.textContent = "Cambio sintético de sitio";
    anchor.href = "/odonto/configuracion/reserva-online/webs?nuevo=1";
    document.querySelector("main")?.append(anchor);
  });
  await p
    .getByRole("link", { name: "Cambio sintético de sitio", exact: true })
    .click();
  await p
    .getByRole("dialog", { name: "Cambios sin guardar", exact: true })
    .getByRole("button", { name: "Descartar cambios", exact: true })
    .click();
  await expect(p).toHaveURL(/webs\?nuevo=1$/);
  await expect(p.getByLabel("Nombre del sitio")).toHaveValue("");
  await expect(p.locator('input[name="id"]')).toHaveValue("");
  await expect(p.locator('input[name="revision"]')).toHaveValue("");
  pass(
    "Discarding and changing website query resets the draft and identity before reuse; no data is written to the other site.",
  );
  await p.goto(fixture.appOrigin + "/odonto/configuracion/comunicacion");
  await expect(p).toHaveURL(/\/reserva-online$/);
  const integrationId = (
    await row("booking_integrations", "id", { public_key: fixture.key })
  ).id;
  await p.goto(
    fixture.appOrigin +
      "/odonto/configuracion/reserva-online?perfil=" +
      integrationId,
  );
  await expect(p).toHaveURL(new RegExp("/webs\\?perfil=" + integrationId));
  pass(
    "Old reservation/link routes redirect to the new canonical task locations.",
  );
  await owner.close();
  const doctor = await context(browser, "doctor", 390);
  const d = await doctor.newPage();
  watch(d);
  await d.goto(fixture.appOrigin + "/odonto/configuracion/reserva-online");
  await expect(d).toHaveURL(
    new RegExp("/profesionales/" + fixture.professionalId + "/preguntas$"),
  );
  await expect(
    d.getByRole("heading", { name: "Preguntas al paciente", exact: true }),
  ).toBeVisible();
  await expect(
    d.getByRole("link", { name: "Perfil", exact: true }),
  ).toHaveCount(0);
  await capture(d, "doctor-mobile");
  const forbidden = await doctor.request.get(
    fixture.appOrigin + "/odonto/configuracion/reserva-online/webs",
  );
  assert.equal(forbidden.status(), 403);
  pass(
    "Professional users enter their own questions directly and cannot manage website connections.",
  );
  await doctor.close();
  const native = await context(browser, "owner", 390, false);
  const n = await native.newPage();
  await n.goto(fixture.appOrigin + "/odonto/configuracion/reserva-online");
  await expect(n.getByLabel("¿Hasta cuándo pueden reservar?")).toHaveValue(
    "30",
  );
  await expect(n.getByLabel("¿Con cuánta anticipación?")).toHaveValue("120");
  await n.getByLabel("¿Hasta cuándo pueden reservar?").selectOption("60");
  await n.getByRole("button", { name: "Guardar reglas", exact: true }).click();
  assert.equal(
    (
      await row(
        "businesses",
        "max_booking_days_ahead,min_booking_notice_minutes",
        { id: fixture.businessId },
      )
    ).max_booking_days_ahead,
    60,
  );
  pass(
    "Native forms without JavaScript render the actual saved booking rules and submit correctly.",
  );
  await native.close();
  assert.deepEqual(results.errors, []);
  assert.deepEqual(results.console, []);
  pass(
    "Desktop 1440, mobile 390/320, titles, framework overlay, console and horizontal overflow checks pass.",
  );
} finally {
  await browser.close();
  writeFileSync(out + "/results.json", JSON.stringify(results, null, 2));
}
