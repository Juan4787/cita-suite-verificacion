import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function visit(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) visit(path);
		else if (/\.(?:svelte|ts|sql|sh|astro)$/.test(path)) {
			const text = readFileSync(path, 'utf8');
			files.push({ path: relative(root, path), lines: text.split('\n').length, bytes: Buffer.byteLength(text) });
		}
	}
}
for (const directory of ['apps/web/src', 'apps/web/e2e', 'apps/natalia/src', 'apps/scheduler/src', 'packages/shared/src', 'supabase/migrations', 'supabase/tests']) visit(join(root, directory));
files.sort((a, b) => a.path.localeCompare(b.path));
const inventory = {
	scope: 'Local working tree. File counts do not certify active SQL functions, deployed versions, coverage or runtime behavior.',
	routes: files.filter(file => /\/routes\/.*\+(?:page(?:\.server)?|server|layout(?:\.server)?)\./.test(file.path)),
	migrations: files.filter(file => file.path.startsWith('supabase/migrations/')),
	sqlSuites: files.filter(file => file.path.startsWith('supabase/tests/')),
	e2e: files.filter(file => file.path.endsWith('.spec.ts')),
	largestSources: files.filter(file => !file.path.startsWith('supabase/')).toSorted((a, b) => b.lines - a.lines).slice(0, 30),
	files
};
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, '.verification/inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ sourceFiles: files.length, routeFiles: inventory.routes.length, migrations: inventory.migrations.length, sqlSuites: inventory.sqlSuites.length, e2eFiles: inventory.e2e.length }));
