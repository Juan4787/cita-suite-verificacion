-- Verifica que el privilegio que evade RLS no vuelva a quedar expuesto a roles
-- de navegador. Se consulta el catálogo; no se ejecuta ningún TRUNCATE.
select plan(4);

select is(
	(
		select count(*)::integer
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public'
			and c.relkind = 'r'
			and has_table_privilege('anon', c.oid, 'TRUNCATE')
	),
	0,
	'anon no tiene TRUNCATE en tablas public'
);

select is(
	(
		select count(*)::integer
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public'
			and c.relkind = 'r'
			and has_table_privilege('authenticated', c.oid, 'TRUNCATE')
	),
	0,
	'authenticated no tiene TRUNCATE en tablas public'
);

select ok(
	has_table_privilege('service_role', 'public.patients', 'TRUNCATE'),
	'service_role conserva TRUNCATE para tareas backend controladas'
);

select ok(
	(
		select convalidated
		from pg_constraint
		where conname = 'business_user_invites_professional_role_supported_chk'
	),
	'la restricción de rol profesional está validada también sobre filas existentes'
);

select * from finish();
