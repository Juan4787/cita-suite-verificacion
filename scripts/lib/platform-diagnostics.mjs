// Disposable-platform diagnostics: no environment variables, query text,
// connection strings, Auth bodies or raw provider logs enter this receipt.
export function capturePlatformDiagnostics(docker, { database, auth, rest, storage }) {
	const containers = [];
	const names = [database, auth, rest, storage].filter(Boolean);
	for (const name of names) {
		try {
			const value = JSON.parse(docker(['inspect', '--format', '{"state":{{json .State}},"memoryBytes":{{json .HostConfig.Memory}},"nanoCpus":{{json .HostConfig.NanoCpus}}}', name]));
			const state = value.state;
			containers.push({ name, running: state.Running, oomKilled: state.OOMKilled, exitCode: state.ExitCode,
				startedAt: state.StartedAt, finishedAt: state.FinishedAt, memoryBytes: value.memoryBytes, nanoCpus: value.nanoCpus });
		} catch { containers.push({ name, unavailable: true }); }
	}
	let stats;
	try {
		stats = docker(['stats', '--no-stream', '--format', '{{json .}}', ...names]).split('\n').filter(Boolean).map(line => {
			const value = JSON.parse(line);
			return { name: value.Name, memory: value.MemUsage, memoryPercent: value.MemPerc, cpuPercent: value.CPUPerc, pids: value.PIDs };
		});
	} catch { stats = { unavailable: true }; }
	let connections;
	try {
		connections = JSON.parse(docker(['exec', '-e', 'PGCONNECT_TIMEOUT=2', '-e', 'PGOPTIONS=-c statement_timeout=2000', '-i', database, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `
select jsonb_build_object('maximum',current_setting('max_connections')::int,
 'deadlocks',(select deadlocks from pg_stat_database where datname=current_database()),'groups',coalesce((
 select jsonb_agg(x) from (select usename,application_name,state,wait_event_type,count(*) as count
 from pg_catalog.pg_stat_activity where backend_type='client backend'
 group by usename,application_name,state,wait_event_type) x),'[]'::jsonb));`));
	} catch { connections = { unavailable: true }; }
	const authErrors = [];
	if (auth) {
		try {
			// The owned, short-lived Auth service logs only errors. Inspect the
			// complete run so a later healthy period cannot hide exhaustion.
			for (const line of docker(['logs', auth]).split('\n')) {
				const codes = [...line.matchAll(/SQLSTATE\s+([0-9A-Z]{5})/g)].map(match => match[1]);
				const categories = ['too many clients', 'remaining connection', 'connection refused', 'connection reset', 'deadline exceeded', 'out of memory', 'rate limit']
					.filter(category => line.toLowerCase().includes(category));
				if (codes.length || categories.length) authErrors.push({ sqlStates: codes, categories });
			}
		} catch { authErrors.push({ unavailable: true }); }
	}
	return { at: new Date().toISOString(), containers, stats, connections, authErrors };
}

export function assertPlatformDiagnostics(state) {
	if (!Array.isArray(state.containers) || state.containers.length !== 4 ||
		state.containers.some(value => value.unavailable || !value.running || value.oomKilled) ||
		!Number.isSafeInteger(state.connections?.maximum) || state.connections?.deadlocks !== 0 || !Array.isArray(state.authErrors) ||
		state.authErrors.some(value => value.unavailable || value.sqlStates?.length || value.categories?.length))
		throw new Error('Disposable platform diagnostics are unavailable or report infrastructure errors. See platform-state.json.');
}

/** A passing browser assertion cannot certify a crashed auxiliary runtime. */
export function assertRuntimeDiagnostics(log) {
 if (typeof log !== 'string' || /Fatal uncaught|kj::Exception|SQLITE_BUSY|JavaScript heap out of memory/i.test(log))
  throw new Error('Application runtime diagnostics are unavailable or report a fatal infrastructure error. See the owned runtime logs.');
}
