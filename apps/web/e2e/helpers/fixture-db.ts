import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '../../src/lib/types/database';

export type FixtureClient = SupabaseClient<CitaDatabase>;

/** Typed service-role client for owned synthetic fixtures: column and enum mistakes fail type checking. */
export function createFixtureClient(url: string, serviceRoleKey: string): FixtureClient {
	return createClient<CitaDatabase>(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

// Only the SQLSTATE is reported: constraint messages can echo row values.
function fixtureFailure(error: unknown) {
	const code =
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		/^[A-Z0-9]{5}$/.test(error.code)
			? error.code
			: 'unknown';
	return new Error(`Owned fixture operation failed (${code}).`);
}

/** A fixture read or returning write: an error or a missing row fails instead of yielding null. */
export async function must<T>(
	operation: PromiseLike<{ data: T; error: unknown }>
): Promise<NonNullable<T>> {
	const { data, error } = await operation;
	if (error) throw fixtureFailure(error);
	if (data == null) throw new Error('Owned fixture operation returned no row.');
	return data;
}

/** A fixture write without a selection, including cleanup: its error is never ignored. */
export async function write(operation: PromiseLike<{ error: unknown }>): Promise<void> {
	const { error } = await operation;
	if (error) throw fixtureFailure(error);
}
