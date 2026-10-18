import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitaSupabaseClient } from '$lib/types/database';

const state = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('$lib/server/platform/supabase', () => ({
	createSupabaseAdminClient: vi.fn(async () => ({ from: () => ({ insert: state.insert }) }))
}));
import { writeAuditLog } from '$lib/server/platform/audit';

describe('best effort audit storage', () => {
	beforeEach(() => state.insert.mockReset());
	it('keeps the operation successful on malformed metadata or storage failure without leaking data', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const cyclic: Record<string, unknown> = { confidential: 'PRIVATE_SENTINEL' };
			cyclic.self = cyclic;
			const client = {} as CitaSupabaseClient;
			const input = { businessId: 'synthetic', action: 'test', entityType: 'test' };
			await expect(writeAuditLog(client, { ...input, metadata: cyclic })).resolves.toBeUndefined();
			expect(state.insert).not.toHaveBeenCalled();
			state.insert.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'));
			await expect(writeAuditLog(client, input)).resolves.toBeUndefined();
			state.insert.mockResolvedValueOnce({ error: { message: 'PRIVATE_SENTINEL' } });
			await expect(writeAuditLog(client, input)).resolves.toBeUndefined();
			expect(log).toHaveBeenCalledTimes(3);
			expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SENTINEL');
		} finally { log.mockRestore(); }
	});
});
