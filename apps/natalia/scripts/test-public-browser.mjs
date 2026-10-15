import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import assert from "node:assert/strict";

// All Cita Suite traffic is intercepted. No database, Auth or real booking is used.
// Existing monorepo Playwright is reused; one browser, sequential contexts only.
const require = createRequire(
  new URL("../../web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const origin = "https://app.cita-suite.workers.dev";
const key = "a".repeat(32);
const serviceId = "11111111-1111-4111-8111-111111111111";
const phone = "+54 342 1234567";
assert(
  existsSync(dist + "index.html"),
  "Build Natalia before running browser contracts.",
);
const compiledKey = readFileSync(dist + "index.html", "utf8").match(/data-booking-key="([a-f0-9]{32})"/)?.[1];
assert(compiledKey, "Build with the public booking identifier configured.");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    response.writeHead(400).end();
    return;
  }
  let target = resolve(dist, "." + pathname);
  const root = resolve(dist);
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(404).end();
    return;
  }
  if (!extname(target)) target += sep + "index.html";
  if (!existsSync(target)) {
    response.writeHead(404).end();
    return;
  }
  let body = readFileSync(target);
  if (extname(target) === ".html")
    body = Buffer.from(
      body
        .toString()
        .replaceAll(compiledKey, key)
        .replace(
          /data-booking-key(?:="[^"]*")?(?=\s|>)/,
          `data-booking-key="${key}"`,
        )
        .replaceAll('href="/turnos"', `href="${origin}/embed/v1/${key}"`)
        .replace(/href="https:\/\/app\.cita-suite\.workers\.dev\/embed\/v1\/[a-f0-9]{32}"/g, `href="${origin}/embed/v1/${key}"`),
    );
  response
    .writeHead(200, {
      "content-type": mime[extname(target)] || "application/octet-stream",
    })
    .end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const local = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const results = [];
  for (const scenario of [
    "configured",
    "contact-before-catalogue",
    "empty-services",
    "absent-contact",
    "invalid-phone",
    "without-js",
    "turnos-redirect",
    "turnos-without-js",
    "light-with-dark-system",
    "dark-with-light-system",
    "turnos-dark",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: !scenario.endsWith("without-js"),
      colorScheme: scenario === 'light-with-dark-system' || scenario.endsWith('without-js') ? 'dark' : 'light',
    });
    if (scenario === 'dark-with-light-system' || scenario === 'turnos-dark') {
      await context.addInitScript(() => localStorage.setItem('nf_theme', 'dark'));
    }
    let sdkLoads = 0;
    const unexpected = [];
    await context.route(origin + "/**", async (route) => {
      const url = new URL(route.request().url());
      assert.equal(
        route.request().method(),
        "GET",
        "Public fixture must never write to a remote service.",
      );
      if (url.pathname.startsWith("/booking/")) {
        sdkLoads++;
        unexpected.push(url.pathname);
        await route.abort();
      } else if (url.pathname.startsWith("/api/public/contacto/")) {
        const contact =
          scenario === "absent-contact"
            ? {}
            : {
                phone:
                  scenario === "invalid-phone" ? "javascript:alert(1)" : phone,
                address: "Dirección <img src=x onerror=alert(1)> de prueba",
              };
        await route.fulfill({
          contentType: "application/json",
          headers: { "access-control-allow-origin": local },
          body: JSON.stringify({ contact }),
        });
      } else if (url.pathname.endsWith("/catalogo")) {
        const contact =
          scenario === "absent-contact"
            ? {}
            : {
                phone:
                  scenario === "invalid-phone" ? "javascript:alert(1)" : phone,
                address: "Dirección <img src=x onerror=alert(1)> de prueba",
              };
        const services =
          scenario === "configured"
            ? [
                {
                  id: serviceId,
                  name: "Consulta de prueba",
                  duration_minutes: 60,
                  price_label: "Arancel de prueba",
                },
              ]
            : [];
        await route.fulfill({
          contentType: "application/json",
          headers: { "access-control-allow-origin": local },
          body: JSON.stringify({ services, contact }),
        });
      } else if (url.pathname.startsWith("/embed/v1/")) {
        await route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="es"><body><h1>Agenda de prueba</h1></body></html>',
        });
      } else {
        unexpected.push(url.pathname);
        await route.abort();
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      local +
        (scenario.startsWith('turnos-') ? '/turnos/' : ["configured", "contact-before-catalogue", "without-js"].includes(
          scenario,
        )
          ? "/"
          : "/contacto/"),
    );
    assert.equal(sdkLoads, 0, "Natalia must not load an embedded booking SDK.");
    assert.equal(await page.locator("iframe").count(), 0);
    if (scenario.startsWith('turnos-')) {
      await page.waitForURL(origin + '/embed/v1/' + key + '?color_mode=' + (scenario === 'turnos-dark' ? 'dark' : 'light'));
      assert(await page.getByRole('heading', {name:'Agenda de prueba',exact:true}).isVisible());
      assert(await page.evaluate(() => window.top === window));
    } else if (scenario === 'without-js') {
      await page.locator('a[data-booking]:visible').first().click();
      await page.waitForURL(origin + '/embed/v1/' + key + '?color_mode=light');
      assert(await page.getByRole('heading', {name:'Agenda de prueba',exact:true}).isVisible());
      assert(await page.evaluate(() => window.top === window));
    } else if (scenario === "configured") {
      await page.locator("#areas").scrollIntoViewIfNeeded();
      await page
        .locator("#public-catalogue .service-commercial-card")
        .waitFor();
      assert.equal(
        await page.locator('#contacto a[href="tel:+543421234567"]').count(),
        1,
      );
      const serviceLink = page.locator("#public-catalogue a").first();
      assert.equal(
        new URL(await serviceLink.getAttribute("href")).searchParams.get(
          "service_id",
        ),
        serviceId,
      );
      assert.equal(
        await serviceLink.getAttribute("data-booking"),
        null,
        "Direct booking must preserve the selected service.",
      );
      assert.equal(new URL(await serviceLink.getAttribute('href')).searchParams.get('color_mode'), 'light');
      await serviceLink.click();
      await page.waitForURL(url => url.origin === origin && url.searchParams.get('service_id') === serviceId);
      assert(await page.evaluate(() => window.top === window));
      await page.goto(local + '/');
      await page.locator('#theme-toggle').click();
      await page.locator('#areas').scrollIntoViewIfNeeded();
      await page.locator('#public-catalogue .service-commercial-card').waitFor();
      assert.equal(new URL(await page.locator('#public-catalogue a').first().getAttribute('href')).searchParams.get('color_mode'), 'dark');
      const booking = page.locator('a[data-booking]:visible').first();
      assert.equal(await booking.getAttribute('href'), origin + '/embed/v1/' + key + '?color_mode=dark');
      assert.equal(await booking.getAttribute('target'), null);
      await booking.click();
      await page.waitForURL(origin + '/embed/v1/' + key + '?color_mode=dark');
      assert(await page.getByRole('heading', {name:'Agenda de prueba',exact:true}).isVisible());
      assert(await page.evaluate(() => window.top === window));
      assert.equal(sdkLoads, 0);
      assert.equal(await page.locator('iframe').count(), 0);
      await page.goto(local + "/contacto/");
      await page.locator('a[href="tel:+543421234567"]').waitFor();
    } else if (scenario === 'light-with-dark-system' || scenario === 'dark-with-light-system') {
      const mode = scenario === 'dark-with-light-system' ? 'dark' : 'light';
      await page.locator('a[data-booking]:visible').first().click();
      await page.waitForURL(origin + '/embed/v1/' + key + '?color_mode=' + mode);
      assert(await page.evaluate(() => window.top === window));
    } else if (scenario === "contact-before-catalogue") {
      // Programmatic dispatch isolates contact intent from the viewport observer.
      await page.evaluate(() =>
        document.querySelector('a[data-dialog="contact-dialog"]').click(),
      );
      await page
        .locator('#contact-dialog a[href="tel:+543421234567"]')
        .waitFor();
    } else if (scenario === "empty-services") {
      await page.locator('a[href="tel:+543421234567"]').waitFor();
      assert(
        await page
          .getByText("Dirección <img src=x onerror=alert(1)> de prueba", {
            exact: true,
          })
          .isVisible(),
      );
      assert.equal(
        await page.locator("img").count(),
        0,
        "API contact must render as text.",
      );
    } else {
      await page.waitForTimeout(350);
      assert.equal(await page.locator('a[href^="tel:"]').count(), 0);
      assert(
        await page
          .getByText(
            scenario === "absent-contact"
              ? "Contacto directo pendiente de confirmar"
              : "Teléfono pendiente de confirmación.",
            { exact: true },
          )
          .isVisible(),
      );
    }
    assert.equal(sdkLoads, 0);
    assert.equal(errors.length, 0);
    assert.equal(unexpected.length, 0);
    results.push({ scenario, passed: true, databaseWrites: 0 });
    await context.close();
  }
  console.log(
    JSON.stringify({
      fixtureOnly: true,
      actualSDK: false,
      directSamePageBooking: true,
      sequential: true,
      results,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
