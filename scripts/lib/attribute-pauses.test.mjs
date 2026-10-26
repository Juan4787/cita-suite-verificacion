import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../attribute-pauses.mjs', import.meta.url));
function attribute(before, after) {
 const directory=mkdtempSync(join(tmpdir(),'cita-pause-metrics-test-'));
 try {
  const samples=join(directory,'samples.jsonl'),requests=join(directory,'requests.jsonl');
  writeFileSync(samples,[{at:'2026-10-24T00:00:00Z',kind:'metrics',values:before},{at:'2026-10-24T00:01:00Z',kind:'metrics',values:after}].map(JSON.stringify).join('\n')+'\n');writeFileSync(requests,'');
  const run=spawnSync(process.execPath,['--max-old-space-size=128',script,samples,requests],{encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
 } finally {rmSync(directory,{recursive:true,force:true});}
}
test('absent pressure and memory counters stay unknown',()=>{
 const r=attribute({cpu_idle:10,cpu_user:1,cpu_system:1},{cpu_idle:20,cpu_user:1,cpu_system:1});
 assert.equal(r.median.cpuPressure.withoutSlowRequests,null);
 assert.equal(r.median.memoryAvailableMb.withoutSlowRequests,null);
 assert.equal(r.median.swapInPerSecond.withoutSlowRequests,null);
});
test('reported zero remains a measured zero',()=>{
 const before={cpu_idle:10,cpu_user:1,cpu_system:1,node_vmstat_pswpin:0,node_pressure_cpu_waiting_seconds_total:0,node_memory_MemAvailable_bytes:0};
 const r=attribute(before,{...before,cpu_idle:20});
 assert.equal(r.median.cpuPressure.withoutSlowRequests,0);
 assert.equal(r.median.swapInPerSecond.withoutSlowRequests,0);
 assert.equal(r.median.memoryAvailableMb.withoutSlowRequests,0);
 assert.equal(r.median.busy.withoutSlowRequests,0);
});
test('a reset counter cannot produce a negative utilization rate',()=>{
 const r=attribute({cpu_idle:10,cpu_user:100,cpu_system:10},{cpu_idle:20,cpu_user:1,cpu_system:11});
 assert.equal(r.median.busy.withoutSlowRequests,null);
});
test('reported rates keep their scale when counters are available',()=>{
 const r=attribute({cpu_idle:10,cpu_user:0,cpu_system:0,node_vmstat_pswpin:60},{cpu_idle:20,cpu_user:60,cpu_system:0,node_vmstat_pswpin:180});
 assert.equal(r.median.busy.withoutSlowRequests,0.5);
 assert.equal(r.median.swapInPerSecond.withoutSlowRequests,2);
});
