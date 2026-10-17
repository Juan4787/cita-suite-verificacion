import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFixtureDatabaseBudget, fixtureDatabaseBudget } from './fixture-database-budget.mjs';

test('the complete service stack fits ordinary connections with superuser capacity preserved', () => {
	assert.equal(assertFixtureDatabaseBudget(), 9);
	assert.equal(fixtureDatabaseBudget.maximum, 12);
});
test('an unlimited pool or independently increased service budget is rejected', () => {
	assert.throws(() => assertFixtureDatabaseBudget({ ...fixtureDatabaseBudget, auth: 0 }), /positive bound/);
	assert.throws(() => assertFixtureDatabaseBudget({ ...fixtureDatabaseBudget, auth: 3 }), /exceed/);
	assert.throws(() => assertFixtureDatabaseBudget({ ...fixtureDatabaseBudget, maximum: 8 }), /exceed/);
});
