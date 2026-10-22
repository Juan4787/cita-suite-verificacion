import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPTED_PRODUCTION_DRIFT, CATALOG_SECTIONS, compareCatalogs, isForeign } from './access-catalog.mjs';

const empty = () => Object.fromEntries(CATALOG_SECTIONS.map(section => [section, {}]));

test('objects of other products in the project are reported apart, never as differences', () => {
	assert.equal(isForeign('tables', 'landing_leads:anon'), true);
	assert.equal(isForeign('policies', 'public.business_limits:business_limits_manage_select'), true);
	assert.equal(isForeign('functions', 'landing_start_session(text,text,text,text,text,text,text)'), true);
	assert.equal(isForeign('columns', 'patients.owner_id'), false);
	const production = empty();
	production.rls.landing_events = [true, false];
	production.functions['check_and_increment_rate_limit(uuid,text,text,text,text,timestamp with time zone)'] = [false, false, true, true];
	assert.deepEqual(compareCatalogs(empty(), production).rls.onlyInProduction, []);
	assert.deepEqual(compareCatalogs(empty(), production).functions.onlyInProduction, []);
});

test('accepted drift is accepted only as an object production alone holds, by its exact name', () => {
	const [column] = ACCEPTED_PRODUCTION_DRIFT.columns;
	const expected = empty(), production = empty();
	production.columns[column] = ['text', false, 'digest'];
	production.columns['patients.unexpected'] = ['text', false, 'digest'];
	const differences = compareCatalogs(expected, production);
	assert.deepEqual(differences.columns.onlyInProduction, ['patients.unexpected']);
	assert.equal(differences.columns.accepted, 1);
	// The same name in both catalogs with another definition is a difference, accepted or not.
	expected.columns[column] = ['integer', true, 'digest'];
	assert.deepEqual(compareCatalogs(expected, production).columns.different, [column]);
});

test('every kind of drift on the objects of Cita Suite is reported', () => {
	const expected = empty(), production = empty();
	expected.policies['public.patients:patients_role_scoped_select'] = ['SELECT', ['authenticated'], 'PERMISSIVE', 'a', 'b'];
	production.policies['public.patients:patients_role_scoped_select'] = ['SELECT', ['authenticated'], 'PERMISSIVE', 'changed', 'b'];
	expected.constraints['allowed_emails:allowed_emails_email_key'] = ['u', 'digest'];
	production.indexes['patients:patients_owner_dni_unique'] = 'digest';
	const differences = compareCatalogs(expected, production);
	assert.deepEqual(differences.policies.different, ['public.patients:patients_role_scoped_select']);
	assert.deepEqual(differences.constraints.onlyInMigrations, ['allowed_emails:allowed_emails_email_key']);
	assert.deepEqual(differences.indexes.onlyInProduction, ['patients:patients_owner_dni_unique']);
});
