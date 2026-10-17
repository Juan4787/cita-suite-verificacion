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
select jsonb_build_object('maximum',current_setting('max_connections')::int,'groups',coalesce((
 select jsonb_agg(x) from (select usename,application_name,state,wait_event_type,count(*) as count
 from pg_catalog.pg_stat_activity where backend_type='client backend'
 group by usename,application_name,state,wait_event_type) x),'[]'::jsonb));`));
	} catch { connections = { unavailable: true }; }
	const authErrors = [];
	if (auth) {
		try {
			for (const line of docker(['logs', '--tail', '100', auth]).split('\n')) {
				const codes = [...line.matchAll(/SQLSTATE\s+([0-9A-Z]{5})/g)].map(match => match[1]);
				const categories = ['too many clients', 'remaining connection', 'connection refused', 'connection reset', 'deadline exceeded', 'out of memory', 'rate limit']
					.filter(category => line.toLowerCase().includes(category));
				if (codes.length || categories.length) authErrors.push({ sqlStates: codes, categories });
			}
		} catch { authErrors.push({ unavailable: true }); }
	}
	return { at: new Date().toISOString(), containers, stats, connections, authErrors };
}
