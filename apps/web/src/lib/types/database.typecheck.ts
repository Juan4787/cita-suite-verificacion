import type { createSupabaseServerClient } from '$lib/server/platform/supabase';
import type { CitaSupabaseClient } from './database';

// Compile-only negative contract tests. This function is never imported or run.
// An unused @ts-expect-error makes the check fail if a client becomes untyped.
function databaseContract(client: CitaSupabaseClient) {
	client.rpc('list_user_business_contexts');
	client.rpc('user_business_role', { target_business_id: null });
	client.from('patients').update({ phone: null });
	// @ts-expect-error unknown table must remain rejected
	client.from('invented_table');
	// @ts-expect-error unknown RPC must remain rejected
	client.rpc('invented_rpc');
	// @ts-expect-error required identifier cannot become a number
	client.rpc('user_business_role', { target_business_id: 42 });
	// @ts-expect-error no-argument functions do not accept invented arguments
	client.rpc('list_user_business_contexts', { invented: null });
	// @ts-expect-error declared table columns retain their actual types
	client.from('patients').update({ phone: 42 });
}

async function inactiveModuleHasNoInventedDatabase(factory: typeof createSupabaseServerClient) {
  const client = await factory('administrativo');
  client.auth.getUser();
  // @ts-expect-error inactive unrelated schema is not the active Cita Suite schema
  client.from('patients');
}
