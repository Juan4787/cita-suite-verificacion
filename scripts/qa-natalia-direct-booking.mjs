import { fixturePath } from './lib/fixture-path.mjs';
import { inspectOwnedFixture } from './lib/e2e-environment.mjs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {STAGING_PROJECT_REF} from './lib/staging-database.mjs';
import {STAGING_APP_ORIGIN,STAGING_NATALIA_ORIGIN,STAGING_RELEASE_PRACTICE,stagingSupabaseKey} from './lib/staging-deploy.mjs';
import {assertHostedIntegrationResources} from './lib/verification-resources.mjs';
import {nativeBookingEvidencePath} from './lib/native-booking-evidence.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
assertHostedIntegrationResources();
const require=createRequire(root+'/apps/web/package.json');
const {chromium,expect}=require('@playwright/test');
const {createClient}=require('@supabase/supabase-js');
// By default the local Natalia build, served here, against the owned disposable fixture. With
// --staging, Natalia's deployed staging copy against the staging release practice: nothing is
// substituted, and each booking is cancelled from its management page.
const staging=process.argv[2]==='--staging';
if(process.argv.length!==(staging?3:2))throw new Error('Usage: qa-natalia-direct-booking.mjs [--staging]');
const evidenceDirectory=process.env.CITA_NATIVE_BOOKING_EVIDENCE_DIRECTORY || undefined;
const output=nativeBookingEvidencePath(root,{staging,directory:evidenceDirectory});
if(evidenceDirectory&&existsSync(output))throw new Error('The owned native booking evidence already exists; it will not be overwritten.');
mkdirSync(output,{recursive:true});
let f,natalia,server,result;
if(staging){
 const service=stagingSupabaseKey([{name:'service_role',type:'legacy',api_key:process.env.CITA_STAGING_SERVICE_ROLE_KEY}],'service_role');
 f={appOrigin:STAGING_APP_ORIGIN,apiOrigin:`https://${STAGING_PROJECT_REF}.supabase.co`,key:STAGING_RELEASE_PRACTICE.integrationKey,businessId:STAGING_RELEASE_PRACTICE.businessId,service};
 natalia=STAGING_NATALIA_ORIGIN;
 const source=await(await fetch(natalia+'/',{signal:AbortSignal.timeout(15000)})).text();
 result={scope:'Deployed staging: Natalia\'s staging copy and the Cita Suite staging app on Cloudflare Workers Free and Supabase Free. Synthetic bookings of the release practice, cancelled from their management page.',transportSubstitution:source.match(/data-booking-base="([^"]+)"/)?.[1]!==f.appOrigin||source.match(/data-booking-key="([a-f0-9]{32})"/)?.[1]!==f.key,checks:[],errors:[]};
 assert.equal(result.transportSubstitution,false,'Natalia\'s staging copy must link to the staging booking of the release practice.');
}else{
 f=JSON.parse(readFileSync(fixturePath('runtime.json'),'utf8'));
 inspectOwnedFixture(f);
 assert.equal(f.businessId,'90000000-0000-4000-8000-000000000001');
 for(const value of [f.appOrigin,f.apiOrigin])assert.equal(new URL(value).hostname,'127.0.0.1');
 const dist=resolve(root,'apps/natalia/dist');
 const source=readFileSync(dist+'/index.html','utf8');
 const originalBase=source.match(/data-booking-base="([^"]+)"/)?.[1];
 const originalKey=source.match(/data-booking-key="([a-f0-9]{32})"/)?.[1];
 assert(originalBase&&originalKey);
 result={scope:`Real local Natalia build and Cita Suite app, disposable PostgreSQL/PostgREST/Storage, ${f.realAuth?'real GoTrue Auth':'simulated Auth'}. Synthetic bookings only; no requests or writes to production Cita Suite/Natalia.`,transportSubstitution:originalBase!==f.appOrigin||originalKey!==f.key,checks:[],errors:[]};
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'};
 server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  let file=resolve(dist,'.'+decodeURIComponent(path));
  if(file!==dist&&!file.startsWith(dist+sep)){res.writeHead(404).end();return;}
  if(!extname(file))file+=sep+'index.html';
  if(!existsSync(file)){res.writeHead(404).end();return;}
  let body=readFileSync(file);
  if(file.endsWith('.html'))body=Buffer.from(body.toString().replaceAll(originalBase,f.appOrigin).replaceAll(originalKey,f.key));
  res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 natalia='http://127.0.0.1:'+server.address().port;
}
const db=createClient(f.apiOrigin,f.service,{auth:{persistSession:false,autoRefreshToken:false}});
const booking=f.appOrigin+'/embed/v1/'+f.key;
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
 for(const [name,width,height] of [['desktop',1440,960],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},locale:'es-AR',reducedMotion:'reduce'});
  let sdkRequests=0;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/booking/embed-v1.'))sdkRequests++;
   const allowed=[f.appOrigin,f.apiOrigin,natalia].includes(url.origin)||['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
   assert(allowed,'Unexpected remote request; fixture must not reach production.');
   await route.continue();
  });
  const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.goto(natalia+'/');
  await page.locator('a[data-booking]:visible').first().click();
  await page.waitForURL(url=>url.origin===f.appOrigin&&url.pathname==='/embed/v1/'+f.key);
  assert.equal(new URL(page.url()).searchParams.get('color_mode'),'light');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.bookingColorMode)).toBe('light');
  assert(await page.evaluate(()=>window.top===window));
  assert.equal(await page.locator('iframe').count(),0);
  await expect(page.getByRole('heading',{name:'¿Qué necesitás?',exact:true})).toBeVisible();
  await page.getByRole('link',{name:/Consulta de prueba/}).click();
  await expect(page.getByRole('heading',{name:'¿Con quién?',exact:true})).toBeVisible();
  await page.locator('a.ux-choice[href*="professional_id="]').first().click();
  await page.getByRole('link',{name:/Horarios disponibles/}).first().click();
  await page.getByRole('link',{name:/^\d{2}:\d{2}$/}).first().click();
  await expect(page.getByRole('button',{name:'Confirmar reserva',exact:true})).toBeVisible();
  assert.equal(await page.locator('[data-booking-theme="natalia"]').count(),1);
  const before=await db.from('appointments').select('id',{count:'exact',head:true}).eq('business_id',f.businessId);
  assert.equal(before.error,null);
  const requestId=await page.locator('[name="idempotency_key"]').getAttribute('value');
  assert.match(requestId,/^[a-f0-9-]{36}$/);
  await page.locator('[name="patient_name"]').fill('Paciente Prueba '+name);
  // Staging keeps its bookings: a new synthetic phone per run keeps each one a new patient.
  await page.locator('[name="patient_phone"]').fill(staging?'3415'+String(randomInt(1e6)).padStart(6,'0'):name==='desktop'?'3415551001':'3415551002');
  for(const input of await page.locator('input[name^="intake_"][required], textarea[name^="intake_"][required]').all()){
   const field=await input.getAttribute('name');
   await input.fill(field.includes('age')?'35':'Particular de prueba');
  }
  if(await page.locator('[name="intake_medication"]').count())await page.locator('[name="intake_medication"]').fill('Declaración sintética para la prueba');
  await page.screenshot({path:output+'/'+name+'-form.png'});
  await page.getByRole('button',{name:'Confirmar reserva',exact:true}).click();
  await page.waitForURL(url=>url.origin===f.appOrigin&&/^\/turno\/[a-f0-9]{64}$/.test(url.pathname),{timeout:30000});
  await expect(page.getByRole('heading',{name:'Tu turno quedó reservado',exact:true})).toBeVisible();
  await expect(page.getByText('Cancelar turno',{exact:true}).first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.bookingColorMode)).toBe('light');
  assert.equal(await page.locator('[data-booking-theme="natalia"]').count(),1);
  assert(await page.evaluate(()=>window.top===window));
  assert.equal(await page.locator('iframe').count(),0);
  assert.equal(sdkRequests,0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const token=new URL(page.url()).pathname.split('/').pop();
  const created=await db.from('appointments').select('id').eq('business_id',f.businessId).eq('creation_request_key',requestId).single();
  assert.equal(created.error,null);
  const snapshot=await db.from('appointment_booking_contexts').select('theme_snapshot,integration_id').eq('appointment_id',created.data.id).single();
  assert.equal(snapshot.error,null);
  assert.equal(snapshot.data.theme_snapshot,'natalia');
  await page.screenshot({path:output+'/'+name+'-management.png'});
  await page.goto(booking+'?recover=1&request_id='+requestId);
  await page.waitForURL(f.appOrigin+'/turno/'+token+'?recuperado=1');
  await page.goto(booking+'/turno/'+token+'?creado=1');
  await page.waitForURL(f.appOrigin+'/turno/'+token+'?creado=1');
  const after=await db.from('appointments').select('id',{count:'exact',head:true}).eq('business_id',f.businessId);
  assert.equal(after.error,null);
  assert.equal(after.count,before.count+1,'Recovery and old receipt links must not create duplicate appointments.');
  if(staging){
   await page.locator('details:has(form[action="?/cancel"]) > summary').click();
   await page.locator('form[action="?/cancel"] [name="confirm_cancel"]').check();
   await page.locator('form[action="?/cancel"] button').click();
   await expect(page.getByRole('heading',{name:'Turno cancelado',exact:true})).toBeVisible();
   const state=await db.from('appointments').select('status').eq('id',created.data.id).single();
   assert.equal(state.error,null);
   assert.equal(state.data.status,'cancelled');
  }
  result.checks.push({name,width,height,nativeSameTab:true,fullManagement:true,themeSnapshot:'natalia',recoveryWithoutDuplicate:true,oldReceiptCompatible:true,sdkRequests,syntheticBookings:1,cancelled:staging});
  await context.close();
 }
 assert.deepEqual(result.errors,[]);
 result.passed=true;
}finally{
 await browser?.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 writeFileSync(output+'/results.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
