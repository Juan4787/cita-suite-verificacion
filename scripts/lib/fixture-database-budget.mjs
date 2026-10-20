// One shared connection budget for the small disposable verification stack.
// PostgREST has an additional listener. Administrative slots include the
// official generator (one connection) and one probe/fixture SQL connection.
export const fixtureDatabaseBudget = Object.freeze({
	maximum: 12, superuserReserved: 3,
	auth: 2, storage: 2, rest: 2, restListener: 1, administration: 2
});

// Capacity scenarios of the plan: PostgreSQL with 4 GB and two CPUs on the hosted
// runner. Pools follow a small hosted project (60 connections) instead of the
// minimal verification stack, so the load measures queries rather than queueing.
export const capacityDatabaseBudget = Object.freeze({
	maximum: 60, superuserReserved: 3,
	auth: 5, storage: 2, rest: 10, restListener: 1, administration: 4
});

const profile = process.env.CITA_FIXTURE_PROFILE ?? '';
if (!['', 'capacity'].includes(profile)) throw new Error('CITA_FIXTURE_PROFILE accepts only "capacity".');
export const capacityProfile = profile === 'capacity';
export const activeFixtureDatabaseBudget = capacityProfile ? capacityDatabaseBudget : fixtureDatabaseBudget;
export const fixtureDatabaseResources = Object.freeze(capacityProfile
	// Memory per query as the hosted Supabase project reports it (staging, 20 October:
	// work_mem 2184kB, shared_buffers 286728kB, effective_cache_size 491528kB), so a plan
	// that spills to disk there spills here too. Statements inside functions are
	// tracked, and plans of slow ones are logged.
	? { memory: '4096m', cpus: '2', settings: ['shared_buffers=286728kB', 'effective_cache_size=491528kB', 'work_mem=2184kB',
		'maintenance_work_mem=256MB', 'shared_preload_libraries=pg_cron,pg_stat_statements,auto_explain',
		'pg_stat_statements.track=all', 'auto_explain.log_min_duration=250', 'auto_explain.log_nested_statements=on',
		'auto_explain.log_format=json'] }
	: { memory: '384m', cpus: '1', settings: ['shared_buffers=32MB', 'shared_preload_libraries=pg_cron'] });

export function assertFixtureDatabaseBudget(budget = fixtureDatabaseBudget) {
	for (const value of Object.values(budget)) {
		if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Every fixture pool requires an explicit positive bound; zero can mean unlimited.');
	}
	const demand = budget.auth + budget.storage + budget.rest + budget.restListener + budget.administration;
	if (demand > budget.maximum - budget.superuserReserved)
		throw new Error('Disposable service pools exceed the ordinary PostgreSQL connection budget.');
	return demand;
}
assertFixtureDatabaseBudget();
assertFixtureDatabaseBudget(capacityDatabaseBudget);
