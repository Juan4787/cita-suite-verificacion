// One shared connection budget for the small disposable verification stack.
// PostgREST has an additional listener. Administrative slots include the
// official generator (one connection) and one probe/fixture SQL connection.
export const fixtureDatabaseBudget = Object.freeze({
	maximum: 12, superuserReserved: 3,
	auth: 2, storage: 2, rest: 2, restListener: 1, administration: 2
});

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
