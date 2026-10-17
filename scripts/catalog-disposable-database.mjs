import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fixturePath } from './lib/fixture-path.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const receipt = JSON.parse(readFileSync(fixturePath('database.json'), 'utf8'));
if (!/^cita-booking-test-[a-f0-9]{12}$/.test(receipt.container)) throw new Error('Only an owned disposable database can be inspected.');
const inspected = spawnSync('docker', ['inspect', receipt.container], { encoding: 'utf8' });
if (inspected.status !== 0) throw new Error('Disposable database does not exist.');
const labels = JSON.parse(inspected.stdout)[0].Config.Labels;
if (labels['com.cita-suite.booking-fixture'] !== 'true' || labels['com.cita-suite.fixture-run'] !== receipt.runId)
	throw new Error('Disposable database ownership does not match its receipt.');
const query = `select jsonb_build_object(
 'scope','Reconstructed disposable database; not a production catalog',
 'schemas',(select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),
   'privileges',n.nspacl::text,'anonCanCreate',has_schema_privilege('anon',n.oid,'CREATE'),
   'authenticatedCanCreate',has_schema_privilege('authenticated',n.oid,'CREATE')) order by n.nspname)
   from pg_namespace n where n.nspname in('public','private','extensions','storage','auth','realtime','pg_catalog')),
 'functions',(select jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
   'result',pg_get_function_result(p.oid),'securityDefiner',p.prosecdef,
   'owner',pg_get_userbyid(p.proowner),'configuration',p.proconfig,
   'privileges',coalesce(p.proacl,acldefault('f',p.proowner))::text,
   'definitionMd5',md5(pg_get_functiondef(p.oid)), 'definition',pg_get_functiondef(p.oid)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f'),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'forcedRls',c.relforcerowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum)
     from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) order by k.conname),'[]'::jsonb)
     from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,'definition',pg_get_indexdef(ix.indexrelid),'valid',ix.indisvalid) order by i.relname),'[]'::jsonb)
     from pg_index ix join pg_class i on i.oid=ix.indexrelid where ix.indrelid=c.oid),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'roles',p.polroles::text,
     'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname),'[]'::jsonb)
     from pg_policy p where p.polrelid=c.oid),
   'privileges',coalesce(c.relacl,acldefault('r',c.relowner))::text)
   order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r')
);`;
const result = spawnSync('docker', ['exec', '-i', receipt.container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'],
	{ input: query, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (result.status !== 0) throw new Error('Could not extract the disposable schema catalog.');
const catalog = JSON.parse(result.stdout);
mkdirSync(join(root, '.verification'), { recursive: true });
writeFileSync(join(root, '.verification/database-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ functions: catalog.functions.length, tables: catalog.tables.length, scope: catalog.scope }));
