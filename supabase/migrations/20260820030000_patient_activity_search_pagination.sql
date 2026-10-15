begin;

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.normalize_patient_search_text(p_value text)
returns text
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
	select trim(
		regexp_replace(
			lower(extensions.unaccent(coalesce(p_value, ''))),
			'\s+',
			' ',
			'g'
		)
	);
$$;

create or replace function public.normalize_patient_search_digits(p_value text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
	select regexp_replace(coalesce(p_value, ''), '[^0-9]+', '', 'g');
$$;

alter table public.patients
	add column if not exists search_name_normalized text not null default '',
	add column if not exists search_dni_digits text not null default '',
	add column if not exists search_phone_digits text not null default '';

update public.patients p
set
	search_name_normalized = public.normalize_patient_search_text(p.full_name),
	search_dni_digits = public.normalize_patient_search_digits(p.dni),
	search_phone_digits = public.normalize_patient_search_digits(coalesce(p.phone_e164, p.phone));

create or replace function private.prepare_patient_search_fields()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
	new.search_name_normalized := public.normalize_patient_search_text(new.full_name);
	new.search_dni_digits := public.normalize_patient_search_digits(new.dni);
	new.search_phone_digits := public.normalize_patient_search_digits(coalesce(new.phone_e164, new.phone));
	return new;
end;
$$;

drop trigger if exists trg_patients_prepare_search_fields on public.patients;
create trigger trg_patients_prepare_search_fields
before insert or update of full_name, dni, phone, phone_e164
on public.patients
for each row execute function private.prepare_patient_search_fields();

-- Backfill de actividad real. No se usa starts_at de turnos futuros y tampoco
-- una edición administrativa genérica de patients.updated_at.
with latest_activity as (
	select
		p.id as patient_id,
		greatest(
			p.created_at,
			p.last_entry_at,
			(
				select max(greatest(a.created_at, a.updated_at))
				from public.appointments a
				where a.business_id = p.business_id and a.patient_id = p.id
			),
			(
				select max(greatest(ce.created_at, ce.updated_at))
				from public.clinical_entries ce
				where ce.business_id = p.business_id and ce.patient_id = p.id
			),
			(
				select max(coalesce(pr.ready_at, pr.created_at))
				from public.patient_radiographs pr
				where pr.business_id = p.business_id
					and pr.patient_id = p.id
					and pr.storage_provider = 'supabase_storage'
					and pr.status in ('ready', 'trashed')
			)
		) as occurred_at
	from public.patients p
)
update public.patients p
set activity_at = coalesce(latest_activity.occurred_at, p.created_at)
from latest_activity
where latest_activity.patient_id = p.id;

create or replace function private.touch_patient_activity_from_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_business_id uuid;
	v_patient_id uuid;
begin
	v_business_id := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
	v_patient_id := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;

	if v_business_id is not null and v_patient_id is not null then
		update public.patients p
		set activity_at = greatest(coalesce(p.activity_at, p.created_at), statement_timestamp())
		where p.business_id = v_business_id and p.id = v_patient_id;
	end if;

	return null;
end;
$$;

drop trigger if exists trg_appointments_touch_patient_activity on public.appointments;
create trigger trg_appointments_touch_patient_activity
after insert or update on public.appointments
for each row execute function private.touch_patient_activity_from_domain();

drop trigger if exists trg_clinical_entries_touch_patient_activity on public.clinical_entries;
create trigger trg_clinical_entries_touch_patient_activity
after insert or update on public.clinical_entries
for each row execute function private.touch_patient_activity_from_domain();

create index if not exists patients_business_archived_activity_idx
	on public.patients (business_id, archived_at, activity_at desc, id desc);

create index if not exists patients_search_name_trgm_idx
	on public.patients using gin (search_name_normalized extensions.gin_trgm_ops);

create index if not exists patients_search_dni_trgm_idx
	on public.patients using gin (search_dni_digits extensions.gin_trgm_ops);

create index if not exists patients_search_phone_trgm_idx
	on public.patients using gin (search_phone_digits extensions.gin_trgm_ops);

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
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
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
			select link.archived_at
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
			and public.user_can_read_basic_patient(p.business_id, p.id)
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
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
begin
	if v_actor is null or p_business_id is null or not public.user_has_business_access(p_business_id) then
		raise exception 'PATIENT_LIST_DENIED';
	end if;
	v_role := public.user_business_role(p_business_id);
	if coalesce(v_role, '') not in ('owner', 'admin', 'reception', 'professional', 'readonly') then
		raise exception 'PATIENT_LIST_DENIED';
	end if;

	return query
	with accessible as (
		select
			case when v_role = 'professional' then ppl.archived_at else p.archived_at end as effective_archived_at
		from public.patients p
		left join lateral (
			select link.archived_at
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
			and public.user_can_read_basic_patient(p.business_id, p.id)
			and (v_role <> 'professional' or p.archived_at is null)
	)
	select
		count(*)::bigint,
		count(*) filter (where accessible.effective_archived_at is null)::bigint,
		count(*) filter (where accessible.effective_archived_at is not null)::bigint
	from accessible;
end;
$$;

create or replace function public.list_trashed_patient_radiographs_page(
	p_business_id uuid,
	p_query text default '',
	p_limit integer default 30,
	p_cursor_deleted_at timestamptz default null,
	p_cursor_id uuid default null
)
returns table (
	id uuid,
	patient_id uuid,
	patient_name text,
	original_filename text,
	mime_type text,
	bytes bigint,
	taken_at date,
	created_at timestamptz,
	deleted_at timestamptz,
	deleted_by_label text,
	integrity_status text,
	thumbnail_path text
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
	v_actor uuid := auth.uid();
	v_query text := public.normalize_patient_search_text(left(coalesce(p_query, ''), 80));
	v_query_like text;
	v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 30);
begin
	v_query_like := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner', 'admin')
		or not public.business_allows_owner_restricted_read(p_business_id)
	then
		raise exception 'RADIOGRAPH_TRASH_DENIED';
	end if;
	if (p_cursor_deleted_at is null) <> (p_cursor_id is null) then
		raise exception 'RADIOGRAPH_CURSOR_INVALID';
	end if;

	return query
	select
		pr.id,
		pr.patient_id,
		p.full_name,
		pr.original_filename,
		pr.mime_type,
		pr.bytes,
		pr.taken_at,
		pr.created_at,
		pr.deleted_at,
		case
			when professional.name is not null then professional.name
			when member.role = 'owner' then 'Dueño'
			when member.role = 'admin' then 'Administrador'
			when pr.deleted_by is null then 'Usuario anterior'
			else 'Usuario autorizado'
		end,
		pr.integrity_status,
		pr.thumbnail_path
	from public.patient_radiographs pr
	join public.patients p
		on p.business_id = pr.business_id and p.id = pr.patient_id
	left join public.business_users member
		on member.business_id = pr.business_id and member.user_id = pr.deleted_by
	left join public.professional_users professional_user
		on professional_user.business_id = pr.business_id and professional_user.user_id = pr.deleted_by
	left join public.professionals professional
		on professional.business_id = professional_user.business_id
		and professional.id = professional_user.professional_id
	where pr.business_id = p_business_id
		and pr.storage_provider = 'supabase_storage'
		and pr.status = 'trashed'
		and (
			v_query = ''
			or p.search_name_normalized like '%' || v_query_like || '%' escape '\'
			or public.normalize_patient_search_text(pr.original_filename) like '%' || v_query_like || '%' escape '\'
		)
		and (
			p_cursor_deleted_at is null
			or pr.deleted_at < p_cursor_deleted_at
			or (pr.deleted_at = p_cursor_deleted_at and pr.id < p_cursor_id)
		)
	order by pr.deleted_at desc, pr.id desc
	limit v_limit + 1;
end;
$$;

revoke all on function public.normalize_patient_search_text(text) from public, anon;
revoke all on function public.normalize_patient_search_digits(text) from public, anon;
revoke all on function public.list_accessible_patients_page(uuid, boolean, text, integer, timestamptz, integer, timestamptz, uuid) from public, anon;
revoke all on function public.accessible_patient_counts(uuid) from public, anon;
revoke all on function public.list_trashed_patient_radiographs_page(uuid, text, integer, timestamptz, uuid) from public, anon;

grant execute on function public.normalize_patient_search_text(text) to authenticated, service_role;
grant execute on function public.normalize_patient_search_digits(text) to authenticated, service_role;
grant execute on function public.list_accessible_patients_page(uuid, boolean, text, integer, timestamptz, integer, timestamptz, uuid) to authenticated;
grant execute on function public.accessible_patient_counts(uuid) to authenticated;
grant execute on function public.list_trashed_patient_radiographs_page(uuid, text, integer, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
