import { fixturePath } from './lib/fixture-path.mjs';
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { spawnSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync, openSync, rmSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireVerificationLock } from './lib/verification-lock.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';
import { capturePlatformDiagnostics } from './lib/platform-diagnostics.mjs';
import { activeFixtureDatabaseBudget as fixtureDatabaseBudget, capacityProfile } from './lib/fixture-database-budget.mjs';
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const db = process.argv[2];
assertHostedIntegrationResources();
const options = process.argv.slice(3);
const realAuth = options.includes('--real-auth');
// The capacity scenarios run the built Worker themselves instead of the dev server.
const withoutApp = options.includes('--no-app');
// The release verification serves the downloaded release itself: the production bundle in
// workerd, Cloudflare's runtime, instead of the dev server.
const artifactOption = options.find((option) => option.startsWith('--artifact='));
const artifact = artifactOption ? resolve(artifactOption.slice('--artifact='.length)) : null;
const runtimeLog = artifact ? 'workerd' : 'vite';
if (
  options.some((option) => !['--real-auth', '--no-app'].includes(option) && option !== artifactOption) ||
  (artifact && withoutApp) ||
  new Set(options).size !== options.length ||
  !/^cita-booking-test-[a-f0-9]{12}$/.test(db ?? "")
)
  throw new Error(
    "Supply only the disposable container printed by test-booking-foundation.mjs --keep. Remote databases are forbidden.",
  );
const network = db + "-e2e-net";
let storageFixture;
const rest = db + "-rest";
const authContainer = db + '-auth';
let authOrigin;
let authCreated = false;
let fixtureRunId;
const verificationLease = acquireVerificationLock(root);
const key = "ab".repeat(16),
  businessId = "90000000-0000-4000-8000-000000000001",
  serviceId = "90000000-0000-4000-8000-000000000002",
  professionalId = "90000000-0000-4000-8000-000000000003";
function docker(args, input, includeStderr = false) {
  const r = spawnSync("docker", args, { input, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return (r.stdout + (includeStderr ? '\n' + r.stderr : '')).trim();
}
const secret = "cita-local-disposable-jwt-secret-with-more-than-32-characters";
function jwt(role, sub) {
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      role,
      ...(sub
        ? {
            sub,
            aud: 'authenticated',
            email:
              sub === "90000000-0000-4000-8000-000000000004"
                ? "e2e-owner@example.test"
                : "e2e-doctor@example.test",
          }
        : {}),
      iss: "supabase",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7200,
    }),
  ).toString("base64url");
  return (
    head +
    "." +
    body +
    "." +
    createHmac("sha256", secret)
      .update(head + "." + body)
      .digest("base64url")
  );
}
let child,
  artifactConfig,
  gateway,
  host,
  hostCertificate,
  cleaned = false,
  verified = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (child)
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  if (artifactConfig) rmSync(artifactConfig, { recursive: true, force: true });
  if (gateway) gateway.close();
  if (host) host.close();
  if (hostCertificate) rmSync(hostCertificate, { recursive: true, force: true });
  if (!verified) { verificationLease.release(); return; }
  writeFileSync(fixturePath(`platform-state-${fixtureRunId}.json`), JSON.stringify(capturePlatformDiagnostics((args, input) => docker(args, input, args[0] === 'logs'), {
    database: db, auth: authCreated ? authContainer : undefined, rest, storage: storageFixture?.container
  }), null, 2), { mode: 0o600 });
  if (authCreated) {
    try { docker(['rm', '-f', '-v', authContainer]); } catch {}
  }
  try {
    docker(["rm", "-f", rest]);
  } catch {}
  try {
    if (storageFixture) docker(["rm", "-f", storageFixture.container]);
    docker(["rm", "-f", "-v", db]);
  } catch {}
  for (const name of [network, db + "-net"])
    try {
      docker(["network", "rm", name]);
    } catch {}
  rmSync(fixturePath("runtime.json"), { force: true });
  if (storageFixture) rmSync(fixturePath("storage.json"), { force: true });
  verificationLease.release();
}
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
try {
  if (
    docker([
      "inspect",
      "--format",
      '{{index .Config.Labels "com.cita-suite.booking-fixture"}}',
      db,
    ]) !== "true"
  )
    throw new Error(
      "The container was not created by the isolated fixture runner. Refusing to mutate it.",
    );
  verified = true;
  fixtureRunId = docker(['inspect', '--format', '{{index .Config.Labels "com.cita-suite.fixture-run"}}', db]);
  if (!/^[a-f0-9-]{32,36}$/.test(fixtureRunId)) throw new Error('Disposable database has no valid owner run identifier.');
  try {
    storageFixture = JSON.parse(
      readFileSync(fixturePath("storage.json"), "utf8"),
    );
  } catch {}
  if (
    storageFixture &&
    (storageFixture.database !== db ||
      storageFixture.container !== db + "-storage" ||
      docker([
        "inspect",
        "--format",
        '{{index .Config.Labels "com.cita-suite.booking-fixture"}}',
        storageFixture.container,
      ]) !== "true")
  )
    throw new Error(
      "Storage fixture does not belong to this disposable database.",
    );
  docker(["image", "inspect", "public.ecr.aws/supabase/postgrest:v16.1"]);
  // Local-only gateway publishes on loopback. PostgreSQL has no host ports.
  docker(["network", "create", '--label', 'com.cita-suite.fixture-run=' + fixtureRunId, network]);
  docker(["network", "connect", network, db]);
  docker([
    "run",
    "-d",
    "--label",
    "com.cita-suite.booking-fixture=true",
    '--label', 'com.cita-suite.fixture-run=' + fixtureRunId,
    "--name",
    rest,
    "--network",
    network,
    "--memory",
    capacityProfile ? "256m" : "96m",
    "--cpus",
    capacityProfile ? "1" : "0.5",
    "-p",
    "127.0.0.1::3000",
    "-e",
    // As on the hosted platform: PostgREST logs in as authenticator, whose sessions
    // preload safeupdate, and exposes only public.
    "PGRST_DB_URI=postgres://authenticator:cita-disposable-test-only@" +
      db +
      ":5432/postgres",
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    "PGRST_JWT_SECRET=" + secret,
    "-e",
    `PGRST_DB_POOL=${fixtureDatabaseBudget.rest}`,
    "-e",
    "PGRST_DB_MAX_ROWS=1000",
    "public.ecr.aws/supabase/postgrest:v16.1",
  ]);
  const ports = JSON.parse(
    docker(["inspect", "--format", "{{json .NetworkSettings.Ports}}", rest]),
  );
  const restOrigin = "http://127.0.0.1:" + ports["3000/tcp"][0].HostPort;
  const appOrigin = "http://127.0.0.1:5177";
  gateway = createServer(async (req, res) => {
    // Supabase's production gateway adds CORS; the isolated native Storage server does not.
    if (req.headers.origin === appOrigin) {
      res.setHeader("Access-Control-Allow-Origin", appOrigin);
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,HEAD,POST,PUT,DELETE,OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization,apikey,content-type,x-upsert,x-client-info",
      );
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    // Local Auth simulator only; it validates this fixture's signature and known identities.
    // This is not evidence of a real Supabase Auth session or deployment.
    if (!realAuth && req.url === "/auth/v1/user" && req.method === "GET") {
      const token = String(req.headers.authorization ?? "").replace(
        /^Bearer /,
        "",
      );
      const parts = token.split(".");
      const signature = createHmac("sha256", secret)
        .update(parts.slice(0, 2).join("."))
        .digest("base64url");
      try {
        const claims = JSON.parse(
          Buffer.from(parts[1], "base64url").toString(),
        );
        if (
          parts.length !== 3 ||
          parts[2] !== signature ||
          claims.role !== "authenticated" ||
          claims.exp <= Date.now() / 1000 ||
          ![
            "90000000-0000-4000-8000-000000000004",
            "90000000-0000-4000-8000-000000000007",
          ].includes(claims.sub)
        )
          throw new Error();
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            id: claims.sub,
            email: claims.email,
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          }),
        );
      } catch {
        res.statusCode = 401;
        res.end("{}");
      }
      return;
    }
    const isStorage = req.url.startsWith("/storage/v1/");
    const isAuth = realAuth && req.url.startsWith('/auth/v1/');
    if (!req.url.startsWith("/rest/v1/") && !(isStorage && storageFixture) && !isAuth) {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 6_000_000) {
          res.statusCode = 413;
          res.end("Fixture body too large");
          return;
        }
        chunks.push(chunk);
      }
      const headers = { ...req.headers };
      delete headers.host;
      delete headers["content-length"];
      const response = await fetch(
        isStorage
          ? storageFixture.origin + req.url.slice("/storage/v1".length)
          : isAuth && authOrigin
          ? authOrigin + req.url.slice('/auth/v1'.length)
          : restOrigin + req.url.slice("/rest/v1".length),
        {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method)
            ? undefined
            : Buffer.concat(chunks),
        },
      );
      res.statusCode = response.status;
      if (response.status >= 500 || (isAuth && response.status === 429)) console.error(JSON.stringify({
        kind: 'gateway-upstream-error', service: isAuth ? 'auth' : isStorage ? 'storage' : 'rest',
        path: req.url.split('?')[0], status: response.status
      }));
      response.headers.forEach((value, name) => {
        if (
          !["content-encoding", "content-length", "transfer-encoding"].includes(
            name,
          )
        )
          res.setHeader(name, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(JSON.stringify({ kind: 'gateway-transport-error',
        service: isAuth ? 'auth' : isStorage ? 'storage' : 'rest', path: req.url.split('?')[0],
        name: error?.name, code: error?.cause?.code ?? error?.code ?? null }));
      res.statusCode = 503;
      res.end("Local gateway unavailable");
    }
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const apiOrigin = "http://127.0.0.1:" + gateway.address().port;
  // The website that embeds the booking, on its own HTTPS origin as every real site is: the
  // production build accepts only HTTPS origins. Its certificate exists for this run only.
  hostCertificate = mkdtempSync(join(tmpdir(), "cita-host-tls-"));
  const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", join(hostCertificate, "key.pem"), "-out", join(hostCertificate, "certificate.pem")], { encoding: "utf8" });
  if (certificate.status !== 0) throw new Error("Could not create the certificate of the isolated host page.");
  host = createSecureServer({ key: readFileSync(join(hostCertificate, "key.pem")), cert: readFileSync(join(hostCertificate, "certificate.pem")) }, (req, res) => {
    if (req.url !== "/harness") {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="es"><meta charset="utf-8"><title>Prueba aislada de integración</title><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:24px;background:#f3eee5;font:18px sans-serif"><h1>Host de prueba</h1><button id="book">Reservar consulta</button><script src="${appOrigin}/booking/embed-v1.js"></script><script>window.completions=[];window.widget=CitaSuiteBooking.mount({integrationKey:'${key}',baseURL:'${appOrigin}',onComplete:function(){window.completions.push(Array.from(arguments))}});document.querySelector('#book').onclick=()=>widget.open();</script></body></html>`,
    );
  });
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  const hostOrigin = "https://127.0.0.1:" + host.address().port;
  if (realAuth) {
    const authImage = 'public.ecr.aws/supabase/gotrue:v2.196.0';
    docker(['image', 'inspect', authImage]);
    docker(['exec', '-i', db, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
      "alter role supabase_auth_admin password 'cita-disposable-test-only';");
    const authEnvironment = {
      GOTRUE_API_HOST: '0.0.0.0', PORT: '9999', GOTRUE_API_PORT: '9999',
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_MAX_POOL_SIZE: String(fixtureDatabaseBudget.auth),
      GOTRUE_DB_MAX_IDLE_POOL_SIZE: String(fixtureDatabaseBudget.auth),
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:cita-disposable-test-only@${db}:5432/postgres`,
      GOTRUE_SITE_URL: appOrigin, API_EXTERNAL_URL: apiOrigin + '/auth/v1',
      GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: '7200', GOTRUE_JWT_AUD: 'authenticated',
	  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_LOG_LEVEL: 'error'
    };
    docker(['run', '-d', '--name', authContainer, '--label', 'com.cita-suite.booking-fixture=true',
      '--label', 'com.cita-suite.fixture-run=' + fixtureRunId,
      '--network', network, '--memory', capacityProfile ? '128m' : '96m', '--cpus', '0.5',
      ...Object.entries(authEnvironment).flatMap(([name, value]) => ['-e', `${name}=${value}`]), authImage]);
    authCreated = true;
    const address = docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', authContainer]);
    authOrigin = `http://${address}:9999`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (attempt % 5 === 0 && docker(['inspect', '--format', '{{.State.Running}}', authContainer]) !== 'true') break;
      try { if ((await fetch(authOrigin + '/health', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Real isolated Auth did not start.\n' + docker(['logs', '--tail', '15', authContainer]));
    for (const [id, email] of [
      ['90000000-0000-4000-8000-000000000004', 'e2e-owner@example.test'],
      ['90000000-0000-4000-8000-000000000007', 'e2e-doctor@example.test']
    ]) {
      const response = await fetch(authOrigin + '/admin/users', {
        method: 'POST', headers: { authorization: 'Bearer ' + jwt('service_role'), 'content-type': 'application/json' },
        body: JSON.stringify({ id, email, role: 'authenticated', password: 'CitaFixtureLocal!2026', email_confirm: true }), signal: AbortSignal.timeout(5000)
      });
      const user = await response.json();
      if (!response.ok || user.id !== id) throw new Error('Could not create synthetic users through isolated Auth: ' + response.status);
    }
  }
  docker(
    [
      "exec",
      "-i",
      db,
      "psql",
      "-X",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    `
 begin;
 ${realAuth ? '' : "insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000004','e2e-owner@example.test'),('90000000-0000-4000-8000-000000000007','e2e-doctor@example.test');"}
 insert into public.businesses(id,name,slug,industry,timezone,min_booking_notice_minutes,max_booking_days_ahead,address,patient_documents_enabled,public_contact_enabled,whatsapp_contact_enabled,whatsapp_phone,whatsapp_message) values('${businessId}','Consultorio de prueba','booking-e2e-isolated','other','America/Argentina/Buenos_Aires',60,180,'Dirección sintética 123',true,true,true,'+5491112345678','Consulta general sintética');
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values('${businessId}','90000000-0000-4000-8000-000000000004','owner','active',now()),('${businessId}','90000000-0000-4000-8000-000000000007','professional','active',now());
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null where business_id='${businessId}';
 insert into public.services(id,business_id,name,duration_minutes) values('${serviceId}','${businessId}','Consulta de prueba',30);
 insert into public.professionals(id,business_id,name) values('${professionalId}','${businessId}','Profesional de prueba');
 insert into public.professional_users(business_id,professional_id,user_id) values('${businessId}','${professionalId}','90000000-0000-4000-8000-000000000007');
 insert into public.patients(id,owner_id,business_id,full_name,dni,phone) values('90000000-0000-4000-8000-000000000009','90000000-0000-4000-8000-000000000004','${businessId}','Julia Paciente de prueba','99900001','3425000001');
 insert into public.professional_patient_links(business_id,professional_id,patient_id,source,is_active,created_by) values('${businessId}','${professionalId}','90000000-0000-4000-8000-000000000009','manual',true,'90000000-0000-4000-8000-000000000004');
 insert into public.professional_booking_forms(business_id,professional_id,fields) values('${businessId}','${professionalId}','[{"id":"age","label":"Edad","kind":"text","required":true,"maxLength":3,"patientField":"age"},{"id":"medication","label":"Medicación","kind":"textarea","required":false,"maxLength":1000,"patientField":"medication"},{"id":"insurance","label":"Obra social del perfil","kind":"text","required":true,"maxLength":120,"patientField":"insurance"}]');
 insert into public.services(id,business_id,name,duration_minutes) values('90000000-0000-4000-8000-000000000008','${businessId}','Seguimiento de prueba',30);
 insert into public.professional_services(business_id,professional_id,service_id) values('${businessId}','${professionalId}','${serviceId}'),('${businessId}','${professionalId}','90000000-0000-4000-8000-000000000008');
 insert into public.service_price_policies(business_id,service_id,professional_id,base_amount,currency,base_month,first_adjustment_month,monthly_percentage,rounding_unit) values('${businessId}','${serviceId}','${professionalId}',20000,'ARS',date_trunc('month',now())::date,(date_trunc('month',now())+interval '1 month')::date,2,1);
 update public.services set patient_instructions=E'Indicaciones sintéticas\nTraer los estudios previos.',public_reminder_description='Aviso público sintético' where id='${serviceId}';
 insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes) select '${businessId}','${professionalId}',n,'09:00','17:00',30,10 from generate_series(0,6)n;
 insert into public.booking_integrations(business_id,public_key,name,is_active,is_default,theme,allowed_origins,allowed_service_ids,allowed_professional_ids,allowed_modalities,video_instructions,intake_schema) values('${businessId}','${key}','Host de prueba',true,false,'natalia',array['${hostOrigin}'],array['${serviceId}','90000000-0000-4000-8000-000000000008']::uuid[],array['${professionalId}']::uuid[],array['in_person','video'],'Instrucciones virtuales sintéticas: se coordina el acceso.','[{"id":"insurance","label":"Obra social y plan","kind":"text","required":true,"maxLength":120},{"id":"labs","label":"Estudios recientes","kind":"boolean","required":false}]');
 insert into public.booking_integrations(business_id,public_key,name,is_active,is_default,theme,allowed_origins,allowed_modalities,intake_schema)
 values('${businessId}','${'cd'.repeat(16)}','Agenda general de prueba',true,true,'cita-suite',array['${hostOrigin}'],array['in_person'],
 '[{"id":"insurance","label":"Obra social y plan","kind":"text","required":true,"maxLength":120},{"id":"labs","label":"Estudios recientes","kind":"boolean","required":false}]');
 notify pgrst,'reload schema';
 commit;
 `,
  );
  const anon = jwt("anon"),
    service = jwt("service_role");
  const internalJobSecret = randomBytes(32).toString("hex");
  const sessions = {};
  if (realAuth) for (const [role, email] of [['owner', 'e2e-owner@example.test'], ['doctor', 'e2e-doctor@example.test']]) {
    const response = await fetch(authOrigin + '/token?grant_type=password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'CitaFixtureLocal!2026' }), signal: AbortSignal.timeout(5000)
    });
    const session = await response.json();
    if (!response.ok || !session.access_token || !session.refresh_token)
      throw new Error('Synthetic password login failed against isolated Auth: ' + response.status);
    sessions[role] = session;
  }
  writeFileSync(
    fixturePath("runtime.json"),
    JSON.stringify({
      appOrigin,
      apiOrigin,
      hostOrigin,
      key,
      businessId,
      serviceId,
      professionalId,
      anon,
      service,
      internalJobSecret,
      ownerToken: sessions.owner?.access_token ?? jwt("authenticated", "90000000-0000-4000-8000-000000000004"),
      doctorToken: sessions.doctor?.access_token ?? jwt("authenticated", "90000000-0000-4000-8000-000000000007"),
      ownerRefreshToken: sessions.owner?.refresh_token,
      doctorRefreshToken: sessions.doctor?.refresh_token,
      container: db,
      storageOrigin: storageFixture?.origin,
      realAuth,
      runtime: runtimeLog,
      runId: fixtureRunId,
      followupId: "90000000-0000-4000-8000-000000000008",
    }),
    { mode: 0o600 },
  );
  if (withoutApp) console.log("READY: local services at " + apiOrigin + " without the application");
  else {
    const variables = {
      ODONTO_SUPABASE_URL: apiOrigin,
      ODONTO_SUPABASE_ANON_KEY: anon,
      ODONTO_SUPABASE_SERVICE_ROLE_KEY: service,
      PUBLIC_ODONTO_SUPABASE_URL: apiOrigin,
      PUBLIC_ODONTO_SUPABASE_ANON_KEY: anon,
      PUBLIC_SITE_URL: appOrigin,
      BOOKING_INTEGRATIONS_ENABLED: "true",
      BOOKING_CONTEXTS_AVAILABLE: "true",
      BOOKING_INFORMATION_ENABLED: "true",
      DEMO_MODE: "false",
      MASTER_EMAIL: 'master@cita-suite-test.local',
      GOOGLE_CALENDAR_MANAGED_ENABLED: "false",
      MP_ACCESS_TOKEN: "",
      TURNSTILE_SECRET_KEY: "",
      PUBLIC_TURNSTILE_SITE_KEY: "",
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
      RATE_LIMIT_SALT: "cita-disposable-local-only",
      INTERNAL_JOB_SECRET: internalJobSecret,
      JOB_BUDGET_PROFILE: "free",
    };
    if (artifact) {
      // Production's configuration with this fixture's variables: none of production's values.
      const production = JSON.parse(readFileSync(root + "/apps/web/wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
      artifactConfig = mkdtempSync(join(tmpdir(), "cita-artifact-app-"));
      // Secrets travel in .dev.vars, which wrangler never prints; the rest are plain variables.
      const secrets = ["ODONTO_SUPABASE_SERVICE_ROLE_KEY", "INTERNAL_JOB_SECRET", "RATE_LIMIT_SALT"];
      writeFileSync(join(artifactConfig, ".dev.vars"), secrets.map((name) => `${name}=${variables[name]}`).join("\n") + "\n", { mode: 0o600 });
      writeFileSync(join(artifactConfig, "wrangler.json"), JSON.stringify({
        name: "cita-suite-artifact",
        main: join(artifact, ".verification/cloudflare-bundle-production/_worker.js"),
        no_bundle: true,
        assets: { ...production.assets, directory: join(artifact, "apps/web/.svelte-kit/cloudflare") },
        compatibility_date: production.compatibility_date,
        compatibility_flags: production.compatibility_flags,
        vars: Object.fromEntries(Object.entries(variables).filter(([name]) => !secrets.includes(name))),
      }), { mode: 0o600 });
    }
    child = spawn(
      "pnpm",
      artifact
        ? ["exec", "wrangler", "dev", "--config", join(artifactConfig, "wrangler.json"), "--ip", "127.0.0.1", "--port", "5177", "--local"]
        : ["dev", "--host", "127.0.0.1", "--port", "5177", "--strictPort"],
      {
        cwd: root + "/apps/web",
        detached: true,
        stdio: [
          "ignore",
          openSync(fixturePath(`${runtimeLog}-${fixtureRunId}.log`), "w", 0o600),
          openSync(fixturePath(`${runtimeLog}-errors-${fixtureRunId}.log`), "w", 0o600),
        ],
        env: artifact
          ? { ...process.env, NODE_OPTIONS: "--max-old-space-size=1024", WRANGLER_SEND_METRICS: "false" }
          : {
              ...process.env,
              NODE_OPTIONS: "--max-old-space-size=1024" + (process.env.CITA_VERIFICATION_RUN_ID
                ? " --import=" + new URL('./lib/ssr-fetch-diagnostics.mjs', import.meta.url).href : ""),
              ...variables,
            },
      },
    );
    // workerd starts the 4 MB bundle more slowly than the dev server answers.
    const attempts = artifact ? 240 : 60;
    for (let n = 0; n < attempts; n++) {
      try {
        const response = await fetch(appOrigin + "/embed/v1/" + key);
        if (response.ok) {
          console.log(
            "READY: local integration at " +
              appOrigin +
              "; host " +
              hostOrigin +
              "/harness",
          );
          break;
        }
        if (n === attempts - 1)
          throw new Error("Application did not load: " + response.status);
      } catch (error) {
        if (n === attempts - 1) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await new Promise(() => {});
} catch (error) {
  console.error(error.message);
  cleanup();
  process.exitCode = 1;
}
