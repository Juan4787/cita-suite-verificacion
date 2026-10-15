import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	resolve(process.cwd(), '../../supabase/migrations/20260831050000_revoke_email_probe.sql'),
	'utf8'
);

describe('contrato de privacidad del verificador de correos legado', () => {
	it('no deja la lista de correos consultable por clientes públicos', () => {
		expect(migration).toMatch(
			/revoke all on function public\.is_email_enabled\(text\) from public, anon, authenticated/i
		);
	});
});
