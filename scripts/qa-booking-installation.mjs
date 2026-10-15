import { fixturePath } from './lib/fixture-path.mjs';
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const require = createRequire(root + "/apps/web/package.json");
const { chromium, expect } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");
const f = JSON.parse(readFileSync(fixturePath("runtime.json"), "utf8"));
assert.equal(f.businessId, "90000000-0000-4000-8000-000000000001");
for (const url of [f.appOrigin, f.apiOrigin])
  assert.equal(new URL(url).hostname, "127.0.0.1");
const db = createClient(f.apiOrigin, f.service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ownerDB = createClient(f.apiOrigin, f.anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: "Bearer " + f.ownerToken } },
});
const output = root + "/.impeccable/review/website-installation";
mkdirSync(output, { recursive: true });
const result = {
  scope:
    "Local disposable PostgreSQL/PostgREST, simulated Auth, real app and SDK. No production requests or bookings.",
  browserPath:
    "No host-managed browser tools exposed; installed Playwright used per frontend-testing-debugging skill.",
  checks: [],
  screenshots: [],
  errors: [],
};
function pass(text) {
  result.checks.push(text);
  console.log("PASS " + text);
}
async function profile() {
  const r = await db
    .from("booking_integrations")
    .select("*")
    .eq("public_key", f.key)
    .single();
  assert.equal(r.error, null);
  return r.data;
}
let hostCode = "";
const hostServer = createServer((req, res) => {
  if (req.method !== "GET" || req.url !== "/installation-example") {
    res.writeHead(404).end();
    return;
  }
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8" })
    .end(
      '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web de prueba</title><body><h1>Web de prueba</h1>' +
        hostCode +
        "</body></html>",
    );
});
await new Promise((resolve) => hostServer.listen(0, "127.0.0.1", resolve));
const hostOrigin = "http://127.0.0.1:" + hostServer.address().port;
const hostURL = hostOrigin + "/installation-example";
let browser;
try {
  const seed = await profile();
  const allowed = await ownerDB.rpc("save_booking_integration", {
    p_business_id: f.businessId,
    p_integration_id: seed.id,
    p_expected_revision: seed.revision,
    p_config: {
      name: seed.name,
      theme: seed.theme,
      origins: [...seed.allowed_origins, hostOrigin],
      professional_ids: seed.allowed_professional_ids,
      service_ids: seed.allowed_service_ids,
      intake_schema: seed.intake_schema,
      modality_windows: seed.modality_windows,
      modalities: seed.allowed_modalities,
      video_instructions: seed.video_instructions,
      active: seed.is_active,
      default: seed.is_default,
    },
  });
  assert.equal(allowed.error, null);
  browser = await chromium.launch({ headless: true });
  const owner = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: "reduce",
    locale: "es-AR",
  });
  await owner.addCookies([
    { name: "sb-module", value: "odonto", url: f.appOrigin },
    { name: "sb-access-token", value: f.ownerToken, url: f.appOrigin },
    { name: "sb-refresh-token", value: "local-only", url: f.appOrigin },
    { name: "active-business-id", value: f.businessId, url: f.appOrigin },
  ]);
  const filter = (route) =>
    [
      "127.0.0.1",
      "localhost",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort();
  await owner.route("**/*", filter);
  const p = await owner.newPage();
  p.on("pageerror", (e) => result.errors.push(e.message));
  const before = await profile();
  await p.goto(
    f.appOrigin +
      "/odonto/configuracion/reserva-online/webs?perfil=" +
      before.id,
  );
  await expect(p.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(
    p.getByRole("heading", { name: "Instalar el turnero en " + before.name }),
  ).toBeVisible();
  // Empty explicit restrictions must fail instead of silently opening the scope.
  await p.getByLabel("Sólo algunos profesionales", { exact: true }).check();
  const people = p.getByRole("group", {
    name: "Elegir profesionales",
    exact: true,
  });
  for (const checkbox of await people.getByRole("checkbox").all())
    await checkbox.uncheck();
  await p
    .getByRole("button", { name: "Guardar y continuar", exact: true })
    .click();
  await expect(p.getByRole("alert")).toHaveText(
    "Elegí al menos un profesional para esta web.",
  );
  assert.equal((await profile()).revision, before.revision);
  await p.getByLabel("Todo el equipo actual", { exact: true }).check();
  await p.getByText("Opciones de esta web", { exact: true }).click();
  await p.getByLabel("Mostrar sólo algunos servicios", { exact: true }).check();
  const services = p.getByRole("group", {
    name: "Servicios que se muestran",
    exact: true,
  });
  for (const checkbox of await services.getByRole("checkbox").all())
    if ((await checkbox.getAttribute("name")) !== "limit_services")
      await checkbox.uncheck();
  await p
    .getByRole("button", { name: "Guardar y continuar", exact: true })
    .click();
  await expect(p.getByRole("alert")).toHaveText(
    "Elegí al menos un servicio para esta web.",
  );
  assert.equal((await profile()).revision, before.revision);
  await p
    .getByLabel("Mostrar sólo algunos servicios", { exact: true })
    .uncheck();
  await p
    .getByRole("button", { name: "Guardar y continuar", exact: true })
    .click();
  await expect(p).toHaveURL(/instalar=1&guardado=1$/);
  await expect(
    p.getByRole("status").filter({ hasText: "Configuración guardada" }),
  ).toBeVisible();
  assert.equal(
    await p.locator(".connection-editor").getAttribute("open"),
    null,
  );
  const after = await profile();
  for (const field of [
    "public_key",
    "allowed_origins",
    "theme",
    "allowed_modalities",
    "intake_schema",
    "modality_windows",
    "is_default",
    "is_active",
  ])
    assert.deepEqual(after[field], before[field]);
  pass(
    "Saving leads to installation, preserves the public key and settings; explicit empty professional/service restrictions cannot broaden the scope.",
  );
  await p.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => (window.__copied = text) },
    }),
  );
  await p.getByRole("button", { name: "Copiar código", exact: true }).click();
  const code = await p.evaluate(() => window.__copied);
  writeFileSync(output + "/copied-code.html", code);
  assert(code.includes('data-cita-suite-booking="' + f.key + '"'));
  assert(code.includes(f.appOrigin + "/booking/embed-v1.js"));
  await p.getByText("Ver código", { exact: true }).click();
  await expect(
    p.getByLabel("Código para instalar el turnero", { exact: true }),
  ).toHaveValue(code);
  await p.getByText("Ver código", { exact: true }).click();
  for (const [name, width] of [
    ["desktop", 1440],
    ["mobile", 390],
    ["user-320", 320],
  ]) {
    await p.setViewportSize({ width, height: 960 });
    await p.evaluate(() => document.fonts.ready);
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await p.screenshot({ path: output + "/" + name + ".png", fullPage: true });
    result.screenshots.push(name + ".png");
  }
  await p.getByLabel("Botón para reservar", { exact: false }).check();
  await p.getByRole("button", { name: "Copiar código", exact: true }).click();
  const link = await p.evaluate(() => window.__copied);
  assert(!link.includes("<script"));
  assert(link.includes(f.appOrigin + "/embed/v1/" + f.key));
  pass(
    "Both installation choices copy their actual key/source; 1440/390/320 layouts have no horizontal overflow.",
  );
  // Serve precisely the copied code on another allowed origin. Backend and SDK stay real.
  await owner.close();
  hostCode = code;
  const anonymous = await browser.newContext({
    viewport: { width: 390, height: 960 },
    locale: "es-AR",
  });
  await anonymous.route("**/*", filter);
  const a = await anonymous.newPage();
  a.on("pageerror", (e) => result.errors.push(e.message));
  await a.goto(hostURL);
  const frame = a.frameLocator("iframe");
  await expect(a.locator(".cita-booking-host iframe")).toBeVisible();
  assert.equal(await a.locator("iframe").count(), 1);
  await expect(
    frame.getByRole("heading", { name: "¿Qué necesitás?", exact: true }),
  ).toBeVisible();
  assert.equal(
    new URL(await a.locator("iframe").getAttribute("src")).searchParams.get(
      "parent_origin",
    ),
    hostOrigin,
  );
  await frame.getByRole("link", { name: /Consulta de prueba/ }).click();
  await expect(
    frame.getByRole("heading", { name: "Elegí un día", exact: true }),
  ).toBeVisible();
  await frame
    .getByRole("link", { name: /Horarios disponibles/ })
    .nth(1)
    .click();
  await frame
    .getByRole("link", { name: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  await expect(
    frame.getByRole("button", { name: "Confirmar reserva", exact: true }),
  ).toBeVisible();
  await a.screenshot({
    path: output + "/installed-site-mobile.png",
    fullPage: true,
  });
  result.screenshots.push("installed-site-mobile.png");
  await a.addScriptTag({ url: f.appOrigin + "/booking/embed-v1.js" });
  assert.equal(await a.locator("iframe").count(), 1);
  pass(
    "Exactly the copied markup loads the actual SDK/calendar on the allowed external origin and reaches the patient form; repeated loading does not duplicate it.",
  );
  await anonymous.close();
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  await nojs.route("**/*", filter);
  const n = await nojs.newPage();
  await n.goto(hostURL);
  await expect(
    n.getByRole("link", { name: "Reservar turno", exact: true }),
  ).toBeVisible();
  assert.equal(await n.locator("iframe").count(), 0);
  const popupPromise = n.waitForEvent("popup");
  await n.getByRole("link", { name: "Reservar turno", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).origin, f.appOrigin);
  assert.equal(new URL(popup.url()).pathname, "/embed/v1/" + f.key);
  await expect(
    popup.getByRole("heading", { name: "¿Qué necesitás?", exact: true }),
  ).toBeVisible();
  pass(
    "Without JavaScript the copied block opens the actual booking page through its fallback link.",
  );
  await nojs.close();
  const doctor = await browser.newContext();
  await doctor.addCookies([
    { name: "sb-module", value: "odonto", url: f.appOrigin },
    { name: "sb-access-token", value: f.doctorToken, url: f.appOrigin },
    { name: "sb-refresh-token", value: "local-only", url: f.appOrigin },
    { name: "active-business-id", value: f.businessId, url: f.appOrigin },
  ]);
  await doctor.route("**/*", filter);
  const forbidden = await doctor.request.get(
    f.appOrigin + "/odonto/configuracion/reserva-online/webs",
    { maxRedirects: 0 },
  );
  assert.equal(forbidden.status(), 403);
  await doctor.close();
  pass(
    "A professional without management permission cannot administer site installation.",
  );
  assert.deepEqual(result.errors, []);
  pass("No application page errors and no actual booking submissions.");
} finally {
  await browser?.close();
  await new Promise((resolve) => hostServer.close(resolve));
  writeFileSync(
    output + "/results.json",
    JSON.stringify(result, null, 2) + "\n",
  );
}
