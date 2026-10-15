-- Run against a clean local reconstruction after every migration:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/service_role_backend_privileges.sql
--
-- This contract keeps the trusted backend usable without reopening the
-- clinical-file control plane or append-only operational records.

begin;

select extensions.plan(1);

do $$
declare
	v_table text;
begin
	if exists (
		select 1
		from pg_class relation
		join pg_namespace namespace on namespace.oid = relation.relnamespace
		where namespace.nspname = 'public'
			and relation.relkind in ('r', 'p')
			and not relation.relrowsecurity
	) then
		raise exception 'TEST_PUBLIC_TABLE_WITHOUT_RLS';
	end if;

	foreach v_table in array array[
		'public.businesses',
		'public.business_users',
		'public.appointments',
		'public.follow_ups',
		'public.clinical_entries',
		'public.services'
	]
	loop
		if not has_table_privilege('service_role', v_table, 'SELECT') then
			raise exception 'TEST_SERVICE_ROLE_MISSING_SELECT:%', v_table;
		end if;
		if not has_table_privilege('service_role', v_table, 'INSERT, UPDATE, DELETE') then
			raise exception 'TEST_SERVICE_ROLE_MISSING_BACKEND_DML:%', v_table;
		end if;
	end loop;

	if not has_schema_privilege('service_role', 'public', 'USAGE') then
		raise exception 'TEST_SERVICE_ROLE_MISSING_PUBLIC_SCHEMA_USAGE';
	end if;
	if not has_schema_privilege('authenticated', 'public', 'USAGE') then
		raise exception 'TEST_AUTHENTICATED_MISSING_PUBLIC_SCHEMA_USAGE';
	end if;

	if not has_table_privilege('service_role', 'public.patient_radiographs', 'SELECT') then
		raise exception 'TEST_SERVICE_ROLE_CANNOT_READ_CLINICAL_METADATA';
	end if;
	if has_table_privilege(
		'service_role',
		'public.patient_radiographs',
		'INSERT, UPDATE, DELETE'
	) then
		raise exception 'TEST_SERVICE_ROLE_CAN_BYPASS_CLINICAL_CONTROL_PLANE';
	end if;

	if not has_table_privilege('service_role', 'public.audit_logs', 'SELECT, INSERT') then
		raise exception 'TEST_SERVICE_ROLE_CANNOT_APPEND_AUDIT';
	end if;
	if has_table_privilege('service_role', 'public.audit_logs', 'UPDATE, DELETE') then
		raise exception 'TEST_SERVICE_ROLE_CAN_REWRITE_AUDIT';
	end if;

	if has_table_privilege(
		'service_role',
		'public.server_rate_limit_events',
		'SELECT, INSERT, UPDATE, DELETE'
	) then
		raise exception 'TEST_SERVICE_ROLE_CAN_BYPASS_RATE_LIMIT_FUNCTIONS';
	end if;

	if has_table_privilege(
		'service_role',
		'public.drive_connections',
		'SELECT, INSERT, UPDATE, DELETE'
	) then
		raise exception 'TEST_SERVICE_ROLE_RETAINS_DRIVE_TABLE_ACCESS';
	end if;

	if to_regclass('public.patient_drive_folders') is not null
		and has_table_privilege(
			'service_role',
			'public.patient_drive_folders',
			'SELECT, INSERT, UPDATE, DELETE'
		)
	then
		raise exception 'TEST_SERVICE_ROLE_RETAINS_DRIVE_FOLDER_ACCESS';
	end if;

	if not has_function_privilege(
		'service_role',
		'public.get_clinical_file_daily_transfer_estimates(date)',
		'EXECUTE'
	) then
		raise exception 'TEST_SERVICE_ROLE_CANNOT_READ_TRANSFER_ESTIMATES';
	end if;
	if has_function_privilege(
		'authenticated',
		'public.get_clinical_file_daily_transfer_estimates(date)',
		'EXECUTE'
	) then
		raise exception 'TEST_AUTHENTICATED_CAN_READ_TRANSFER_ESTIMATES';
	end if;
end;
$$;

do $$
declare
	v_contract record;
begin
	for v_contract in
		select *
		from (
			values
				('public.business_users', 'SELECT'),
				('public.appointments', 'SELECT'),
				('public.clinical_entries', 'SELECT'),
				('public.services', 'SELECT'),
				('public.patients', 'SELECT, INSERT, UPDATE, DELETE'),
				('public.patient_radiographs', 'SELECT')
		) as expected(table_name, operations)
	loop
		if not has_table_privilege('authenticated', v_contract.table_name, v_contract.operations) then
			raise exception 'TEST_AUTHENTICATED_MISSING_RLS_BACKED_PRIVILEGE:%:%',
				v_contract.table_name,
				v_contract.operations;
		end if;
	end loop;

	if has_table_privilege(
		'authenticated',
		'public.follow_ups',
		'SELECT, INSERT, UPDATE, DELETE'
	) then
		raise exception 'TEST_AUTHENTICATED_CAN_BYPASS_FOLLOW_UP_BACKEND_CONTROL_PLANE';
	end if;

	if has_table_privilege(
		'authenticated',
		'public.patient_radiographs',
		'INSERT, UPDATE, DELETE'
	) then
		raise exception 'TEST_AUTHENTICATED_CAN_MUTATE_CLINICAL_METADATA';
	end if;
	if has_table_privilege(
		'authenticated',
		'public.drive_connections',
		'SELECT, INSERT, UPDATE, DELETE'
	) then
		raise exception 'TEST_AUTHENTICATED_RETAINS_DRIVE_TABLE_ACCESS';
	end if;
end;
$$;

do $$
begin
	raise notice 'PASS: explicit backend grants and restricted control-plane tables.';
end;
$$;

select extensions.pass('service role backend privileges contract');
select * from extensions.finish();

rollback;
