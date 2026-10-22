import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The synthetic master of the disposable platform, by its configured email: found if an earlier
 * spec created it, created otherwise. It owns global audit entries, so it is never deleted here.
 */
export async function syntheticMasterId(admin: SupabaseClient['auth']['admin'], email: string, password: string) {
	for (let index = 1; ; index++) {
		const users = await admin.listUsers({ page: index, perPage: 200 });
		if (users.error) throw users.error;
		const master = users.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
		if (master) return master.id;
		if (users.data.users.length < 200) break;
	}
	const created = await admin.createUser({ email, password, email_confirm: true });
	if (created.error || !created.data.user) throw new Error('Could not prepare the synthetic master identity.');
	return created.data.user.id;
}
