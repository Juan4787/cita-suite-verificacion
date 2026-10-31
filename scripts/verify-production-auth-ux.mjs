// One sequential hosted-browser check of the published app; no build, service or database key.
// Own ephemeral credentials stay in memory; never retain a trace or an Auth URL.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const origin = 'https://app.cita-suite.com.ar';
const revision = '408ca04d9e6750e4657dc087264644665a63fb37';
const owned = JSON.parse(process.env.CITA_AUTH_UX_20261031 ?? 'null');
if (!owned || !/^citasuite\+recuperacion-[a-z0-9-]+@gmail\.com$/.test(owned.signupEmail) ||
 !/^confirmation-browser-[a-f0-9-]+@example\.test$/.test(owned.linkEmail) || !owned.password ||
 new URL(owned.link).origin !== 'https://yjzferwuzbtgpmdnzlcb.supabase.co' ||
 new URL(owned.link).pathname !== '/auth/v1/verify') throw Error('OWNED_BROWSER_CONFIGURATION_INVALID');
const out = '.verification/production-auth-ux';
mkdirSync(out, { recursive: true });
const proof = { at: new Date().toISOString(), revision, origin, browser: 'chromium', workers: 1,
 browserAvailability: 'No host-managed browser capability exposed; existing Playwright on CI',
 traceRetained: false, externalMailboxDelivery: false, generatedAuthLink: true, checks: [] };
const browser = await chromium.launch();
let stage = 'start';
const errors = [];
const watch = page => {
 page.on('pageerror', () => errors.push('pageerror'));
 page.on('console', message => { if (message.type() === 'error') errors.push('console-error'); });
};
const noSession = async context => expect((await context.cookies()).some(c => ['sb-access-token','sb-refresh-token'].includes(c.name))).toBe(false);
const screenshot = async (page, name) => {
 expect(new URL(page.url()).hash).toBe('');
 await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
};
const followOwnedLink = async page => {
 // Playwright navigation diagnostics can contain the credential: replace them with a fixed error.
 try { await page.goto(owned.link); } catch { throw Error('OWNED_LINK_NAVIGATION_FAILED'); }
};
try {
 const served = await fetch(origin+'/_app/version.json').then(r=>r.json());
 expect(served.version).toBe(revision);
 const context = await browser.newContext({ viewport: { width:1280, height:900 } });
 const page = await context.newPage(); watch(page);
 stage = 'rendered-signup';
 await page.goto(origin+'/login?registro=1');
 await expect(page.getByRole('heading', {name:'Cita Suite',exact:true})).toBeVisible();
 await page.getByLabel('Correo electrónico').fill(owned.signupEmail);
 await page.locator('#password').fill(owned.password);
 await page.getByLabel('Confirmar contraseña').fill(owned.password);
 await page.getByRole('checkbox').check();
 await page.locator('form').first().getByRole('button',{name:'Crear cuenta',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Revisá tu correo',exact:true})).toBeVisible({timeout:30000});
 expect(new URL(page.url()).pathname).toBe('/confirmar-correo');
 await expect(page).toHaveTitle('Confirmá tu correo · Cita Suite');
 await expect(page.getByRole('alert')).toHaveCount(0);
 await expect(page.locator('.ux-alert, .confirmation-feedback.error')).toHaveCount(0);
 await expect(page.getByText(owned.signupEmail,{exact:true})).toBeVisible();
 await noSession(context);
 proof.checks.push('real-browser-signup-pending-no-error-no-session');
 for (const width of [320,390,768,1280,1600]) {
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  for (const element of await page.locator('button, a, input:not([type=hidden])').all()) {
   if (!await element.isVisible()) continue;
   const box=await element.boundingBox();
   expect(Boolean(box&&box.x>=-1&&box.x+box.width<=width+1)).toBe(true);
  }
  await screenshot(page,`pending-${width}`);
 }
 proof.checks.push('five-responsive-widths-no-horizontal-overflow');
 stage='resend';
 await expect(page.getByRole('button',{name:'Reenviar correo',exact:true})).toBeEnabled({timeout:70000});
 await page.getByRole('button',{name:'Reenviar correo',exact:true}).click();
 await expect(page.getByText('Si tu cuenta necesita confirmación, vas a recibir un nuevo enlace. Revisá también el correo no deseado.',{exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByRole('alert')).toHaveCount(0);
 proof.checks.push('real-provider-resend-accepted-neutral');
 await page.getByRole('link',{name:'¿Escribiste mal el correo? Usar otro',exact:true}).click();
 await expect(page.locator('#confirm_password')).toBeVisible();
 proof.checks.push('correct-address-returns-to-signup');
 stage='unconfirmed-login';
 await page.goto(origin+'/login');
 await page.getByLabel('Correo electrónico').fill(owned.linkEmail);
 await page.locator('#password').fill(owned.password);
 await page.locator('form').first().getByRole('button',{name:'Ingresar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Revisá tu correo',exact:true})).toBeVisible({timeout:30000});
 await noSession(context);
 proof.checks.push('unconfirmed-password-login-opens-pending');
 stage='real-link-in-new-browser';
 const other=await browser.newContext({viewport:{width:390,height:844}});
 const confirm=await other.newPage();watch(confirm);
 await followOwnedLink(confirm);
 await expect(confirm.getByRole('heading',{name:'Correo confirmado',exact:true})).toBeVisible({timeout:30000});
 expect(new URL(confirm.url()).origin).toBe(origin);
 expect(new URL(confirm.url()).hash).toBe('');
 await noSession(other);
 await screenshot(confirm,'confirmed-mobile');
 await expect(confirm.getByRole('link',{name:'Ingresar a mi cuenta',exact:true})).toHaveAttribute('href','/login');
 proof.checks.push('real-hosted-generated-link-confirmed-in-new-browser-hash-cleared-no-auto-session');
 stage='invalid-link-after-success';
 await confirm.goto(origin+'/confirmar-correo#access_token=a.b.c&type=signup');
 await expect(confirm.getByRole('heading',{name:'Abrí el enlace más reciente',exact:true})).toBeVisible({timeout:30000});
 await expect(confirm.getByRole('heading',{name:'Correo confirmado',exact:true})).toHaveCount(0);
 await expect(confirm.getByRole('alert')).toHaveCount(0);
 expect(new URL(confirm.url()).hash).toBe('');
 proof.checks.push('forged-link-overrides-previous-success-neutral');
 stage='reused-link';
 await followOwnedLink(confirm);
 await expect(confirm.getByRole('heading',{name:'Abrí el enlace más reciente',exact:true})).toBeVisible({timeout:30000});
 await expect(confirm.getByRole('alert')).toHaveCount(0);
 expect(new URL(confirm.url()).hash).toBe('');
 await screenshot(confirm,'reused-link-mobile');
 proof.checks.push('reused-real-link-neutral-and-hash-cleared');
 expect(errors).toEqual([]);
 proof.checks.push('no-browser-runtime-or-console-errors');
 proof.ok=true;
} catch {
 proof.ok=false; proof.failedStage=stage; proof.browserErrors=errors;
 process.exitCode=1;
} finally {
 await browser.close();
 writeFileSync(out+'/proof.json',JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof));
}
