import { spawnSync } from 'node:child_process';

/** Delete only resources owned by this synthetic run, never a linked project. */
export function cleanupFixtureResources(runId, execute = (args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 })) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(runId)) throw new Error('Invalid fixture cleanup owner.');
  const problems = [];
  const removed = { containers: 0, networks: 0 };
  function command(args) {
    const result = execute(args);
    if (result.error || result.status !== 0) throw new Error('Could not inspect or clean owned verification resources.');
    return result.stdout?.trim() ?? '';
  }
  for (const kind of ['container', 'network']) {
    let ids;
    try {
      ids = command(kind === 'container'
        ? ['ps', '-aq', '--filter', 'label=com.cita-suite.fixture-run=' + runId]
        : ['network', 'ls', '-q', '--filter', 'label=com.cita-suite.fixture-run=' + runId]).split(/\s+/).filter(Boolean);
    } catch (error) { problems.push(error); continue; }
    for (const id of ids) {
      try {
        if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid verification resource identifier.');
        const inspected = JSON.parse(command(kind === 'container'
          ? ['inspect', '--format', '{{json .Config.Labels}}', id]
          : ['network', 'inspect', '--format', '{{json .}}', id]));
        const labels = kind === 'container' ? inspected : inspected.Labels;
        if (labels?.['com.cita-suite.fixture-run'] !== runId ||
          (kind === 'container' ? labels?.['com.cita-suite.booking-fixture'] !== 'true' : inspected.Internal !== true))
          throw new Error('Verification resource ownership mismatch; it was not removed.');
        command(kind === 'container' ? ['rm', '-f', '-v', id] : ['network', 'rm', id]);
        removed[kind === 'container' ? 'containers' : 'networks']++;
      } catch (error) { problems.push(error); }
    }
  }
  if (problems.length) throw new AggregateError(problems, 'Verification cleanup was incomplete; unrelated resources were preserved.');
  return removed;
}
