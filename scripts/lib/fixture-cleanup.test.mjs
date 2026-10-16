import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupFixtureResources } from './fixture-cleanup.mjs';
const owner = '11111111-2222-4333-8444-555555555555';
const container = 'a'.repeat(12), network = 'b'.repeat(12);
function fixture({ foreign = false, removalFails = false } = {}) {
  const calls = [];
  return { calls, execute(args) {
    calls.push(args);
    let stdout = '';
    if (args[0] === 'ps') stdout = container;
    else if (args[0] === 'inspect') stdout = JSON.stringify({ 'com.cita-suite.fixture-run': foreign ? 'someone-else' : owner, 'com.cita-suite.booking-fixture': 'true' });
    else if (args[0] === 'network' && args[1] === 'ls') stdout = network;
    else if (args[0] === 'network' && args[1] === 'inspect') stdout = JSON.stringify({ Internal: true, Labels: { 'com.cita-suite.fixture-run': owner } });
    return { status: removalFails && args[0] === 'rm' ? 1 : 0, stdout };
  } };
}
test('cleanup checks both ownership labels and internal network before removing owned resources', () => {
  const fake = fixture();
  assert.deepEqual(cleanupFixtureResources(owner, fake.execute), { containers: 1, networks: 1 });
  assert.ok(fake.calls.some(args => args[0] === 'rm'));
});
test('foreign containers are preserved and cleanup still examines the remaining owned network', () => {
  const fake = fixture({ foreign: true });
  assert.throws(() => cleanupFixtureResources(owner, fake.execute), AggregateError);
  assert.equal(fake.calls.some(args => args[0] === 'rm'), false);
  assert.ok(fake.calls.some(args => args[0] === 'network' && args[1] === 'rm'));
});
test('malformed owners make no calls and removal failures cannot report success', () => {
  const fake = fixture({ removalFails: true });
  assert.throws(() => cleanupFixtureResources('invalid', fake.execute));
  assert.equal(fake.calls.length, 0);
  assert.throws(() => cleanupFixtureResources(owner, fake.execute), AggregateError);
});
