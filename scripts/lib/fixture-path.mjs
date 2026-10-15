import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const directory = join(tmpdir(), `cita-fixtures-${createHash('sha256').update(root).digest('hex').slice(0, 20)}`);

export function fixturePath(filename) {
	if (!/^[a-z0-9.-]+$/.test(filename)) throw new Error('Invalid fixture artifact name.');
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	return join(directory, filename);
}
