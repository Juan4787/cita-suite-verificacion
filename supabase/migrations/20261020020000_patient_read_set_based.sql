-- Reading a patient depends on the actor's role in its practice and, for a
-- professional, on an active link. The rule was evaluated row by row through
-- user_can_read_basic_patient, five lookups each time (about 0.45 ms): listing,
-- counting or searching a practice of 6,000 patients took 2.9 s in the capacity
-- scenario of CI, 326,226 evaluations in three minutes. Same rules, evaluated once
-- per statement: the practices where the actor reads every patient, and the pairs
-- of practice and patient a professional reads through an active link.
-- user_can_read_basic_patient stays as the single-row check it is elsewhere.
begin;

-- Practices whose patients the actor reads in full: owner and admin (account
-- assistance included) in the restricted read state, reception and readonly while
-- the practice operates. The role and states are the same functions as before.
create function public.user_patient_reader_business_ids() returns uuid[]
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(array_agg(candidate.business_id),'{}') from (
  select bu.business_id from public.business_users bu
  where bu.user_id=auth.uid() and coalesce(bu.status,'active')='active' and bu.accepted_at is not null
  union
  select aag.business_id from public.account_assistance_grants aag
  where aag.support_user_id=auth.uid() and aag.status='active' and aag.revoked_at is null and aag.expires_at>now()
 ) candidate
 where case public.user_business_role(candidate.business_id)
  when 'owner' then public.business_allows_owner_restricted_read(candidate.business_id)
  when 'admin' then public.business_allows_owner_restricted_read(candidate.business_id)
  when 'reception' then public.business_allows_operation(candidate.business_id)
  when 'readonly' then public.business_allows_operation(candidate.business_id)
  else false end
$$;

-- Patients a professional reads: active links of their professional profiles in the
-- practices where their role is professional and the practice operates.
create function public.user_linked_patient_ids() returns table(business_id uuid, patient_id uuid)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with professional_business as (
  select bu.business_id from public.business_users bu
  where bu.user_id=auth.uid() and coalesce(bu.status,'active')='active' and bu.accepted_at is not null
   and public.user_business_role(bu.business_id)='professional' and public.business_allows_operation(bu.business_id)
 )
 select distinct link.business_id,link.patient_id
 from public.professional_patient_links link
 join public.professional_users pu on pu.business_id=link.business_id and pu.professional_id=link.professional_id
 where pu.user_id=auth.uid() and link.is_active=true and link.business_id in (select pb.business_id from professional_business pb)
$$;

revoke all on function public.user_patient_reader_business_ids(),public.user_linked_patient_ids() from public,anon;
grant execute on function public.user_patient_reader_business_ids(),public.user_linked_patient_ids() to authenticated,service_role;

-- The scalar subquery is an InitPlan, evaluated once per statement (the cast keeps
-- ANY on the array instead of its subquery form); the pairs are a non-correlated
-- subquery that PostgreSQL hashes once.
drop policy patients_role_scoped_select on public.patients;
create policy patients_role_scoped_select on public.patients for select to authenticated
using (
 business_id=any((select public.user_patient_reader_business_ids())::uuid[])
 or (business_id,id) in (select linked.business_id,linked.patient_id from public.user_linked_patient_ids() linked)
);

create or replace function public.list_accessible_patients_page(
	p_business_id uuid,
	p_show_archived boolean default false,
	p_query text default '',
	p_limit integer default 30,
	p_snapshot_at timestamptz default null,
	p_cursor_rank integer default null,
	p_cursor_activity_at timestamptz default null,
	p_cursor_id uuid default null
)
returns table (
	id uuid,
	full_name text,
	dni text,
	phone text,
	archived_at timestamptz,
	professional_archived_at timestamptz,
	last_entry_at timestamptz,
	activity_at timestamptz,
	created_at timestamptz,
	search_rank integer
)
language plpgsql
security definer
-- The path 20261016012000 established for privileged functions: temporary schemas last.
set search_path = public, pg_catalog, pg_temp
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_reads_all boolean;
	v_reads_linked boolean;
	v_query text := public.normalize_patient_search_text(left(coalesce(p_query, ''), 80));
	v_query_like text;
	v_digits text := public.normalize_patient_search_digits(left(coalesce(p_query, ''), 80));
	v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 30);
	v_snapshot_at timestamptz := coalesce(p_snapshot_at, statement_timestamp());
begin
	v_query_like := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if p_business_id is null or not public.user_has_business_access(p_business_id) then
		raise exception 'PATIENT_LIST_DENIED';
	end if;

	v_role := public.user_business_role(p_business_id);
	if coalesce(v_role, '') not in ('owner', 'admin', 'reception', 'professional', 'readonly') then
		raise exception 'PATIENT_LIST_DENIED';
	end if;
	if (p_cursor_rank is null) <> (p_cursor_activity_at is null)
		or (p_cursor_rank is null) <> (p_cursor_id is null)
	then
		raise exception 'PATIENT_CURSOR_INVALID';
	end if;
	-- user_can_read_basic_patient, once for the practice instead of once per row.
	v_reads_all := p_business_id = any(public.user_patient_reader_business_ids());
	v_reads_linked := v_role = 'professional' and public.business_allows_operation(p_business_id);

	return query
	with candidates as (
		select
			p.id,
			p.full_name,
			p.dni,
			p.phone,
			case when v_role = 'professional' then ppl.archived_at else p.archived_at end as effective_archived_at,
			case when v_role = 'professional' then ppl.archived_at else null end as professional_archived_at,
			p.last_entry_at,
			p.activity_at,
			p.created_at,
			case
				when v_query = '' then 0
				when v_digits <> '' and (p.search_dni_digits = v_digits or p.search_phone_digits = v_digits) then 0
				when p.search_name_normalized = v_query then 1
				when p.search_name_normalized like v_query_like || '%' escape '\' then 1
				when p.search_name_normalized like '%' || v_query_like || '%' escape '\' then 2
				when v_digits <> '' and (
					p.search_dni_digits like '%' || v_digits || '%'
					or p.search_phone_digits like '%' || v_digits || '%'
				) then 3
				else 4
			end as rank_value
		from public.patients p
		left join lateral (
			select link.archived_at, true as linked
			from public.professional_patient_links link
			join public.professional_users pu
				on pu.business_id = link.business_id
				and pu.professional_id = link.professional_id
			where link.business_id = p.business_id
				and link.patient_id = p.id
				and link.is_active = true
				and pu.user_id = v_actor
			order by link.created_at asc
			limit 1
		) ppl on v_role = 'professional'
		where p.business_id = p_business_id
			and p.activity_at <= v_snapshot_at
			and (v_reads_all or (v_reads_linked and ppl.linked is true))
			and (
				(
					v_role = 'professional'
					and p.archived_at is null
					and ppl.archived_at is not distinct from case
						when coalesce(p_show_archived, false) then ppl.archived_at
						else null
					end
					and (
						(coalesce(p_show_archived, false) and ppl.archived_at is not null)
						or (not coalesce(p_show_archived, false) and ppl.archived_at is null)
					)
				)
				or (
					v_role <> 'professional'
					and (
						(coalesce(p_show_archived, false) and p.archived_at is not null)
						or (not coalesce(p_show_archived, false) and p.archived_at is null)
					)
				)
			)
			and (
				v_query = ''
				or p.search_name_normalized like '%' || v_query_like || '%' escape '\'
				or (
					v_digits <> ''
					and (
						p.search_dni_digits like '%' || v_digits || '%'
						or p.search_phone_digits like '%' || v_digits || '%'
					)
				)
			)
	)
	select
		candidate.id,
		candidate.full_name,
		candidate.dni,
		candidate.phone,
		candidate.effective_archived_at,
		candidate.professional_archived_at,
		candidate.last_entry_at,
		candidate.activity_at,
		candidate.created_at,
		candidate.rank_value
	from candidates candidate
	where p_cursor_rank is null
		or candidate.rank_value > p_cursor_rank
		or (
			candidate.rank_value = p_cursor_rank
			and candidate.activity_at < p_cursor_activity_at
		)
		or (
			candidate.rank_value = p_cursor_rank
			and candidate.activity_at = p_cursor_activity_at
			and candidate.id < p_cursor_id
		)
	order by candidate.rank_value asc, candidate.activity_at desc, candidate.id desc
	limit v_limit + 1;
end;
$$;

create or replace function public.accessible_patient_counts(p_business_id uuid)
returns table(total_count bigint, active_count bigint, archived_count bigint)
language plpgsql
security definer
-- The path 20261016012000 established for privileged functions: temporary schemas last.
set search_path = public, pg_catalog, pg_temp
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_reads_all boolean;
	v_reads_linked boolean;
begin
	if v_actor is null or p_business_id is null or not public.user_has_business_access(p_business_id) then
		raise exception 'PATIENT_LIST_DENIED';
	end if;
	v_role := public.user_business_role(p_business_id);
	if coalesce(v_role, '') not in ('owner', 'admin', 'reception', 'professional', 'readonly') then
		raise exception 'PATIENT_LIST_DENIED';
	end if;
	-- user_can_read_basic_patient, once for the practice instead of once per row.
	v_reads_all := p_business_id = any(public.user_patient_reader_business_ids());
	v_reads_linked := v_role = 'professional' and public.business_allows_operation(p_business_id);

	return query
	with accessible as (
		select
			case when v_role = 'professional' then ppl.archived_at else p.archived_at end as effective_archived_at
		from public.patients p
		left join lateral (
			select link.archived_at, true as linked
			from public.professional_patient_links link
			join public.professional_users pu
				on pu.business_id = link.business_id
				and pu.professional_id = link.professional_id
			where link.business_id = p.business_id
				and link.patient_id = p.id
				and link.is_active = true
				and pu.user_id = v_actor
			order by link.created_at asc
			limit 1
		) ppl on v_role = 'professional'
		where p.business_id = p_business_id
			and (v_reads_all or (v_reads_linked and ppl.linked is true))
			and (v_role <> 'professional' or p.archived_at is null)
	)
	select
		count(*)::bigint,
		count(*) filter (where accessible.effective_archived_at is null)::bigint,
		count(*) filter (where accessible.effective_archived_at is not null)::bigint
	from accessible;
end;
$$;

notify pgrst,'reload schema';
commit;
