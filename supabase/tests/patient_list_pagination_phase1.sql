-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/patient_list_pagination_phase1.sql
--
-- Transactional contract for authorized server-side search, 30-row keyset
-- pagination, stable snapshots and clinically meaningful activity ordering.

begin;

select extensions.plan(1);

create temp table patient_list_test_state (
	key text primary key,
	value text not null
);
grant select, insert, update on table patient_list_test_state to authenticated;

insert into auth.users (id, email)
values
	('61000000-0000-4000-8000-000000000001', 'patient-list-owner@example.test'),
	('61000000-0000-4000-8000-000000000002', 'patient-list-professional@example.test'),
	('61000000-0000-4000-8000-000000000003', 'patient-list-reception@example.test'),
	('61000000-0000-4000-8000-000000000004', 'patient-list-outsider@example.test');

insert into public.businesses (id, name, slug, industry)
values
	(
		'62000000-0000-4000-8000-000000000001',
		'Listado fase 1',
		'phase1-patient-list-' || gen_random_uuid()::text,
		'odontology'
	),
	(
		'62000000-0000-4000-8000-000000000002',
		'Listado ajeno fase 1',
		'phase1-patient-list-other-' || gen_random_uuid()::text,
		'odontology'
	);

update public.business_subscriptions
set
	commercial_access_enabled = true,
	is_permanent = true,
	subscription_status = 'active',
	paid_until = null,
	grace_until = null,
	restricted_until = null,
	archived_at = null
where business_id in (
	'62000000-0000-4000-8000-000000000001',
	'62000000-0000-4000-8000-000000000002'
);

insert into public.business_users (business_id, user_id, role, status, accepted_at)
values
	('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
	('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'professional', 'active', now()),
	('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', 'reception', 'active', now()),
	('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000004', 'owner', 'active', now());

insert into public.professionals (id, business_id, name)
values (
	'63000000-0000-4000-8000-000000000001',
	'62000000-0000-4000-8000-000000000001',
	'Profesional de listado'
);
insert into public.professional_users (business_id, professional_id, user_id)
values (
	'62000000-0000-4000-8000-000000000001',
	'63000000-0000-4000-8000-000000000001',
	'61000000-0000-4000-8000-000000000002'
);

with inserted as (
	insert into public.patients (
		owner_id,
		business_id,
		full_name,
		dni,
		phone,
		activity_at,
		created_at,
		updated_at
	)
	select
		'61000000-0000-4000-8000-000000000001'::uuid,
		'62000000-0000-4000-8000-000000000001'::uuid,
		'Paciente Regular ' || lpad(series::text, 2, '0'),
		(35000000 + series)::text,
		'11' || lpad(series::text, 8, '0'),
		now() - make_interval(hours => series),
		now() - make_interval(days => 100 + series),
		now() - make_interval(days => 100 + series)
	from generate_series(1, 36) series
	returning id, full_name
)
insert into patient_list_test_state (key, value)
select 'regular_01_id', id::text from inserted where full_name = 'Paciente Regular 01';

insert into public.patients (
	id,
	owner_id,
	business_id,
	full_name,
	dni,
	phone,
	activity_at,
	created_at,
	updated_at
)
values (
	'64000000-0000-4000-8000-000000000001',
	'61000000-0000-4000-8000-000000000001',
	'62000000-0000-4000-8000-000000000001',
	'Zeta Médica Especial',
	'99887766',
	'+54 11 4444-8899',
	now() - interval '300 days',
	now() - interval '400 days',
	now() - interval '400 days'
);

insert into public.professional_patient_links (
	business_id, professional_id, patient_id, source, is_active, created_by
)
values
	(
		'62000000-0000-4000-8000-000000000001',
		'63000000-0000-4000-8000-000000000001',
		(select value::uuid from patient_list_test_state where key = 'regular_01_id'),
		'manual',
		true,
		'61000000-0000-4000-8000-000000000001'
	),
	(
		'62000000-0000-4000-8000-000000000001',
		'63000000-0000-4000-8000-000000000001',
		'64000000-0000-4000-8000-000000000001',
		'manual',
		true,
		'61000000-0000-4000-8000-000000000001'
	);

-- Owner sees a bounded page. Search covers the full authorized set, including
-- an old record that is outside the first 30, and ranking is deterministic.
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);

do $$
declare
	v_count integer;
	v_first record;
	v_exact record;
	v_prefix record;
	v_partial record;
	v_snapshot timestamptz := statement_timestamp();
begin
	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '', 30, v_snapshot,
		null, null, null
	);
	if v_count <> 31 then
		raise exception 'TEST_PATIENT_PAGE_SENTINEL_EXPECTED_31_GOT_%', v_count;
	end if;

	if exists (
		select 1 from public.list_accessible_patients_page(
			'62000000-0000-4000-8000-000000000001', false, '', 30, v_snapshot,
			null, null, null
		) where id = '64000000-0000-4000-8000-000000000001'
	) then
		raise exception 'TEST_OLD_SPECIAL_PATIENT_UNEXPECTEDLY_IN_FIRST_PAGE';
	end if;

	select * into v_first
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, 'zeta medica', 30, v_snapshot,
		null, null, null
	);
	if v_first.id <> '64000000-0000-4000-8000-000000000001' or v_first.search_rank <> 1 then
		raise exception 'TEST_GLOBAL_ACCENT_INSENSITIVE_SEARCH_FAILED';
	end if;

	select * into v_exact
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '99887766', 30, v_snapshot,
		null, null, null
	);
	if v_exact.id <> '64000000-0000-4000-8000-000000000001' or v_exact.search_rank <> 0 then
		raise exception 'TEST_EXACT_DNI_RANK_FAILED';
	end if;

	select * into v_prefix
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, 'paciente regular 0', 30, v_snapshot,
		null, null, null
	) limit 1;
	if v_prefix.search_rank <> 1 then raise exception 'TEST_NAME_PREFIX_RANK_FAILED'; end if;

	select * into v_partial
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, 'medica esp', 30, v_snapshot,
		null, null, null
	);
	if v_partial.id <> '64000000-0000-4000-8000-000000000001' or v_partial.search_rank <> 2 then
		raise exception 'TEST_NAME_PARTIAL_RANK_FAILED';
	end if;

	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '54 11 4444 8899', 30, v_snapshot,
		null, null, null
	) where id = '64000000-0000-4000-8000-000000000001' and search_rank = 0;
	if v_count <> 1 then raise exception 'TEST_NORMALIZED_PHONE_SEARCH_FAILED'; end if;

	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '%_', 30, v_snapshot,
		null, null, null
	);
	if v_count <> 0 then raise exception 'TEST_SEARCH_WILDCARDS_WERE_NOT_LITERAL'; end if;
end;
$$;

-- Keyset cursor begins strictly after the last visible row and returns the
-- previous sentinel as its first row, with no duplicates.
do $$
declare
	v_snapshot timestamptz := statement_timestamp();
	v_second record;
	v_third record;
	v_next_first record;
begin
	select * into v_second
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '', 2, v_snapshot,
		null, null, null
	) offset 1 limit 1;

	select * into v_third
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '', 2, v_snapshot,
		null, null, null
	) offset 2 limit 1;

	select * into v_next_first
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '', 2, v_snapshot,
		v_second.search_rank, v_second.activity_at, v_second.id
	) limit 1;

	if v_next_first.id <> v_third.id or v_next_first.id = v_second.id then
		raise exception 'TEST_KEYSET_CURSOR_DUPLICATED_OR_SKIPPED_ROW';
	end if;
end;
$$;

-- An activity newer than the current snapshot does not jump into an ongoing
-- traversal, but appears on a fresh visit.
do $$
declare
	v_snapshot timestamptz := clock_timestamp();
	v_target uuid := '64000000-0000-4000-8000-000000000001';
	v_count integer;
begin
	perform pg_sleep(0.01);
	update public.patients set activity_at = clock_timestamp() where id = v_target;

	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, 'zeta', 30, v_snapshot,
		null, null, null
	);
	if v_count <> 0 then raise exception 'TEST_SNAPSHOT_ALLOWED_NEW_ACTIVITY_TO_JUMP_IN'; end if;

	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, 'zeta', 30, clock_timestamp(),
		null, null, null
	);
	if v_count <> 1 then raise exception 'TEST_FRESH_SNAPSHOT_DID_NOT_INCLUDE_ACTIVITY'; end if;
end;
$$;

-- Administrative patient edits do not change activity ordering, while a
-- clinical entry does.
reset role;
do $$
declare
	v_patient_id uuid := (select value::uuid from patient_list_test_state where key = 'regular_01_id');
	v_before timestamptz;
	v_after_admin timestamptz;
	v_after_clinical timestamptz;
begin
	update public.patients
	set activity_at = now() - interval '30 days'
	where id = v_patient_id;
	select activity_at into v_before from public.patients where id = v_patient_id;

	update public.patients set phone = '11 5555 0001' where id = v_patient_id;
	select activity_at into v_after_admin from public.patients where id = v_patient_id;
	if v_after_admin is distinct from v_before then
		raise exception 'TEST_ADMINISTRATIVE_EDIT_CHANGED_ACTIVITY';
	end if;

	perform pg_sleep(0.01);
	insert into public.clinical_entries (
		owner_id, business_id, patient_id, entry_type, description, created_by_user_id
	) values (
		'61000000-0000-4000-8000-000000000001',
		'62000000-0000-4000-8000-000000000001',
		v_patient_id,
		'Consulta',
		'Actividad clínica de prueba',
		'61000000-0000-4000-8000-000000000001'
	);
	select activity_at into v_after_clinical from public.patients where id = v_patient_id;
	if v_after_clinical <= v_after_admin then
		raise exception 'TEST_CLINICAL_ENTRY_DID_NOT_ADVANCE_ACTIVITY';
	end if;
end;
$$;

-- A professional sees only linked patients. Archive is per professional and
-- counts/list tabs remain aligned.
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
do $$
declare
	v_count integer;
	v_counts record;
begin
	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '', 30, clock_timestamp(),
		null, null, null
	);
	if v_count <> 2 then raise exception 'TEST_PROFESSIONAL_LIST_SCOPE_EXPECTED_2_GOT_%', v_count; end if;
	if exists (
		select 1 from public.list_accessible_patients_page(
			'62000000-0000-4000-8000-000000000001', false, '', 30, clock_timestamp(),
			null, null, null
		) where id not in (
			'64000000-0000-4000-8000-000000000001',
			(select value::uuid from patient_list_test_state where key = 'regular_01_id')
		)
	) then
		raise exception 'TEST_PROFESSIONAL_LIST_LEAKED_UNLINKED_PATIENT';
	end if;

	select * into v_counts
	from public.accessible_patient_counts('62000000-0000-4000-8000-000000000001');
	if v_counts.total_count <> 2 or v_counts.active_count <> 2 or v_counts.archived_count <> 0 then
		raise exception 'TEST_PROFESSIONAL_INITIAL_COUNTS_INVALID';
	end if;
end;
$$;

reset role;
update public.professional_patient_links
set archived_at = now(), archived_by = '61000000-0000-4000-8000-000000000001'
where business_id = '62000000-0000-4000-8000-000000000001'
	and professional_id = '63000000-0000-4000-8000-000000000001'
	and patient_id = '64000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
do $$
declare
	v_active integer;
	v_archived integer;
	v_counts record;
begin
	select count(*)::integer into v_active
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, '', 30, clock_timestamp(),
		null, null, null
	);
	select count(*)::integer into v_archived
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', true, '', 30, clock_timestamp(),
		null, null, null
	);
	select * into v_counts
	from public.accessible_patient_counts('62000000-0000-4000-8000-000000000001');
	if v_active <> 1 or v_archived <> 1
		or v_counts.total_count <> 2
		or v_counts.active_count <> 1
		or v_counts.archived_count <> 1
	then
		raise exception 'TEST_PROFESSIONAL_ARCHIVE_TABS_OR_COUNTS_INVALID';
	end if;
end;
$$;

-- Reception can search the basic authorized list, but another business cannot
-- call the RPC against this business.
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
do $$
declare
	v_count integer;
begin
	select count(*)::integer into v_count
	from public.list_accessible_patients_page(
		'62000000-0000-4000-8000-000000000001', false, 'zeta', 30, clock_timestamp(),
		null, null, null
	);
	if v_count <> 1 then raise exception 'TEST_RECEPTION_BASIC_SEARCH_FAILED'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000004', true);
do $$
declare
	v_denied boolean := false;
begin
	begin
		perform public.list_accessible_patients_page(
			'62000000-0000-4000-8000-000000000001', false, '', 30, clock_timestamp(),
			null, null, null
		);
	exception when others then
		v_denied := position('PATIENT_LIST_DENIED' in sqlerrm) > 0;
	end;
	if not v_denied then raise exception 'TEST_CROSS_BUSINESS_PATIENT_LIST_ACCESS'; end if;
end;
$$;

do $$
begin
	raise notice 'PASS: patient list authorization, global search, keyset pagination, snapshot and activity semantics.';
end;
$$;

select extensions.pass('patient list pagination phase 1 contract');
select * from extensions.finish();

rollback;
