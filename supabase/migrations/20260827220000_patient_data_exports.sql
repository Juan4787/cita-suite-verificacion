-- Exportacion versionada y consistente de datos tabulares de pacientes.
--
-- Principios:
-- - solo owner/admin con membresia directa activa y aceptada;
-- - asistencia temporal nunca autoriza;
-- - restricted conserva la salida de datos, archived/pausa manual no;
-- - ninguna tabla clinica recibe triggers ni trabajo adicional por esta feature;
-- - la consistencia se comprueba con una huella calculada solo al inicio/final;
-- - las funciones exponen listas de campos fijas y nunca nombres de tabla.

begin;

create schema if not exists private;

create table if not exists public.patient_export_sessions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses(id) on delete cascade,
	requested_by_user_id uuid not null references auth.users(id) on delete cascade,
	scope text not null check (scope in ('patient', 'all_patients')),
	patient_id uuid,
	request_key uuid not null,
	schema_version text not null default 'cita-suite-patient-export/v1'
		check (schema_version = 'cita-suite-patient-export/v1'),
	dataset_fingerprint text not null
		check (dataset_fingerprint ~ '^[0-9a-f]{64}$'),
	expected_counts jsonb not null check (jsonb_typeof(expected_counts) = 'object'),
	status text not null default 'requested' check (
		status in ('requested', 'streaming', 'dataset_validated', 'failed', 'expired', 'cancelled')
	),
	failure_code text,
	created_at timestamptz not null default statement_timestamp(),
	last_accessed_at timestamptz not null default statement_timestamp(),
	expires_at timestamptz not null,
	validated_at timestamptz,
	finished_at timestamptz,
	check (
		(scope = 'patient' and patient_id is not null)
		or (scope = 'all_patients' and patient_id is null)
	),
	check (expires_at > created_at),
	unique (requested_by_user_id, request_key)
);

create unique index if not exists patient_export_one_active_global_uq
	on public.patient_export_sessions (business_id)
	where scope = 'all_patients' and status in ('requested', 'streaming');

create index if not exists patient_export_active_expiry_idx
	on public.patient_export_sessions (expires_at)
	where status in ('requested', 'streaming');

create index if not exists patient_export_requester_created_idx
	on public.patient_export_sessions (requested_by_user_id, created_at desc);

alter table public.patient_export_sessions enable row level security;
revoke all on table public.patient_export_sessions from public, anon, authenticated;
grant all on table public.patient_export_sessions to service_role;

-- Elimina firmas de una revision local previa que aceptaba auth.uid(). La
-- version publicable mantiene todo el control plane detras del backend.
drop function if exists public.cancel_patient_export(uuid);
drop function if exists public.validate_patient_export(uuid, jsonb);
drop function if exists public.read_patient_export_page(uuid, text, jsonb, integer);
drop function if exists public.begin_patient_export(uuid, text, uuid, uuid);
drop function if exists private.user_can_export_patient_data(uuid);

create or replace function private.user_can_export_patient_data(
	p_business_id uuid,
	p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
	select p_actor_user_id is not null
		and exists (
			select 1
			from public.business_users membership
			where membership.business_id = p_business_id
				and membership.user_id = p_actor_user_id
				and membership.role in ('owner', 'admin')
				and coalesce(membership.status, 'active') = 'active'
				and membership.accepted_at is not null
				and membership.disabled_at is null
		)
		and public.business_allows_owner_restricted_read(p_business_id);
$$;

revoke all on function private.user_can_export_patient_data(uuid, uuid)
	from public, anon, authenticated;

create or replace function private.patient_export_snapshot(
	p_business_id uuid,
	p_scope text,
	p_patient_id uuid
)
returns table(dataset_fingerprint text, expected_counts jsonb)
language sql
stable
security definer
set search_path = public, private, extensions, pg_catalog
as $$
	with scoped_patients as materialized (
		select patient.id, patient.xmin::text as row_version
		from public.patients patient
		where patient.business_id = p_business_id
			and (p_scope = 'all_patients' or patient.id = p_patient_id)
	),
	scoped_profiles as materialized (
		select
			profile.id,
			profile.patient_id,
			profile.custom_fields,
			profile.xmin::text as row_version
		from public.patient_clinical_profiles profile
		join scoped_patients patient on patient.id = profile.patient_id
		where profile.business_id = p_business_id
	),
	scoped_entries as materialized (
		select
			entry.id,
			entry.created_by_professional_id,
			entry.xmin::text as row_version
		from public.clinical_entries entry
		join scoped_patients patient on patient.id = entry.patient_id
		where entry.business_id = p_business_id
	),
	scoped_costs as materialized (
		select cost.id, cost.xmin::text as row_version
		from public.clinical_entry_costs cost
		join scoped_entries entry on entry.id = cost.clinical_entry_id
		where cost.business_id = p_business_id
	),
	scoped_appointments as materialized (
		select appointment.id, appointment.xmin::text as row_version
		from public.appointments appointment
		join scoped_patients patient on patient.id = appointment.patient_id
		where appointment.business_id = p_business_id
	),
	scoped_allocations as materialized (
		select allocation.id, allocation.xmin::text as row_version
		from public.appointment_professionals allocation
		join scoped_appointments appointment on appointment.id = allocation.appointment_id
		where allocation.business_id = p_business_id
	),
	scoped_follow_ups as materialized (
		select
			follow_up.id,
			follow_up.assigned_professional_id,
			follow_up.xmin::text as row_version
		from public.follow_ups follow_up
		join scoped_patients patient on patient.id = follow_up.patient_id
		where follow_up.business_id = p_business_id
	),
	referenced_professional_ids as materialized (
		select entry.created_by_professional_id as professional_id
		from scoped_entries entry
		where entry.created_by_professional_id is not null
		union
		select follow_up.assigned_professional_id
		from scoped_follow_ups follow_up
		where follow_up.assigned_professional_id is not null
	),
	scoped_professionals as materialized (
		select professional.id, professional.xmin::text as row_version
		from public.professionals professional
		join referenced_professional_ids referenced on referenced.professional_id = professional.id
		where professional.business_id = p_business_id
	),
	scoped_custom_fields as materialized (
		select profile.patient_id, field.key as field_key
		from scoped_profiles profile
		cross join lateral jsonb_each(
			case
				when profile.custom_fields is null then '{}'::jsonb
				when jsonb_typeof(profile.custom_fields) = 'object' then profile.custom_fields
				else jsonb_build_object('__valor_sin_clave__', profile.custom_fields)
			end
		) as field(key, value)
	),
	versions as materialized (
		select 'business|' || business.id::text || '|' || business.xmin::text as version_token
		from public.businesses business
		where business.id = p_business_id
		union all
		select 'patient|' || patient.id::text || '|' || patient.row_version
		from scoped_patients patient
		union all
		select 'profile|' || profile.id::text || '|' || profile.row_version
		from scoped_profiles profile
		union all
		select 'entry|' || entry.id::text || '|' || entry.row_version
		from scoped_entries entry
		union all
		select 'cost|' || cost.id::text || '|' || cost.row_version
		from scoped_costs cost
		union all
		select 'appointment|' || appointment.id::text || '|' || appointment.row_version
		from scoped_appointments appointment
		union all
		select 'allocation|' || allocation.id::text || '|' || allocation.row_version
		from scoped_allocations allocation
		union all
		select 'follow_up|' || follow_up.id::text || '|' || follow_up.row_version
		from scoped_follow_ups follow_up
		union all
		select 'professional|' || professional.id::text || '|' || professional.row_version
		from scoped_professionals professional
	),
	counts as (
		select
			(select count(*) from scoped_patients)::bigint as patients,
			(select count(*) from scoped_custom_fields)::bigint as custom_fields,
			(select count(*) from scoped_entries)::bigint as clinical_entries,
			(select count(*) from scoped_appointments)::bigint as appointments,
			(select count(*) from scoped_allocations)::bigint as appointment_professionals,
			(select count(*) from scoped_follow_ups)::bigint as follow_ups
	),
	fingerprint_input as (
		select coalesce(
			string_agg(version.version_token, E'\n' order by version.version_token),
			'empty'
		) as value
		from versions version
	)
	select
		encode(digest(fingerprint_input.value, 'sha256'), 'hex') as dataset_fingerprint,
		jsonb_build_object(
			'patients', counts.patients,
			'custom_fields', counts.custom_fields,
			'clinical_entries', counts.clinical_entries,
			'appointments', counts.appointments,
			'appointment_professionals', counts.appointment_professionals,
			'follow_ups', counts.follow_ups
		) as expected_counts
	from counts
	cross join fingerprint_input;
$$;

revoke all on function private.patient_export_snapshot(uuid, text, uuid)
	from public, anon, authenticated;

create or replace function private.patient_export_session_response(
	p_session public.patient_export_sessions
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
	select jsonb_build_object(
		'ok', true,
		'export_id', p_session.id,
		'scope', p_session.scope,
		'patient_id', p_session.patient_id,
		'schema_version', p_session.schema_version,
		'expected_counts', p_session.expected_counts,
		'datasets', jsonb_build_array(
			'patients',
			'custom_fields',
			'clinical_entries',
			'appointments',
			'appointment_professionals',
			'follow_ups'
		),
		'business', jsonb_build_object(
			'name', business.name,
			'timezone', business.timezone
		),
		'expires_at', p_session.expires_at,
		'status', p_session.status
	)
	from public.businesses business
	where business.id = p_session.business_id;
$$;

revoke all on function private.patient_export_session_response(public.patient_export_sessions)
	from public, anon, authenticated;

create or replace function private.fail_patient_export_session(
	p_export_id uuid,
	p_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
	v_session public.patient_export_sessions%rowtype;
begin
	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
	for update;

	if not found or v_session.status in ('failed', 'expired', 'cancelled') then
		return false;
	end if;

	update public.patient_export_sessions
	set
		status = 'failed',
		failure_code = left(coalesce(nullif(trim(p_failure_code), ''), 'unexpected'), 80),
		last_accessed_at = statement_timestamp(),
		finished_at = statement_timestamp()
	where id = p_export_id;

	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		reason_code,
		metadata
	)
	values (
		v_session.business_id,
		v_session.requested_by_user_id,
		'patient_export_failed',
		'patient_export_session',
		v_session.id,
		'error',
		left(coalesce(nullif(trim(p_failure_code), ''), 'unexpected'), 80),
		jsonb_strip_nulls(jsonb_build_object(
			'export_id', v_session.id,
			'scope', v_session.scope,
			'patient_id', v_session.patient_id,
			'schema_version', v_session.schema_version,
			'duration_ms', greatest(
				0,
				floor(extract(epoch from (statement_timestamp() - v_session.created_at)) * 1000)::bigint
			)
		))
	);

	return true;
end;
$$;

revoke all on function private.fail_patient_export_session(uuid, text)
	from public, anon, authenticated;

create or replace function private.expire_patient_export_sessions(
	p_business_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
	v_expired_count integer := 0;
begin
	with expired as (
		update public.patient_export_sessions session
		set
			status = 'expired',
			failure_code = 'session_expired',
			last_accessed_at = statement_timestamp(),
			finished_at = statement_timestamp()
		where session.status in ('requested', 'streaming')
			and session.expires_at <= statement_timestamp()
			and (p_business_id is null or session.business_id = p_business_id)
		returning session.*
	),
	audited as (
		insert into public.audit_logs (
			business_id,
			user_id,
			action,
			entity_type,
			entity_id,
			result,
			reason_code,
			metadata
		)
		select
			expired.business_id,
			expired.requested_by_user_id,
			'patient_export_expired',
			'patient_export_session',
			expired.id,
			'error',
			'session_expired',
			jsonb_strip_nulls(jsonb_build_object(
				'export_id', expired.id,
				'scope', expired.scope,
				'patient_id', expired.patient_id,
				'schema_version', expired.schema_version,
				'duration_ms', greatest(
					0,
					floor(extract(epoch from (statement_timestamp() - expired.created_at)) * 1000)::bigint
				)
			))
		from expired
		returning 1
	)
	select count(*)::integer into v_expired_count from audited;

	return v_expired_count;
end;
$$;

revoke all on function private.expire_patient_export_sessions(uuid)
	from public, anon, authenticated;
grant execute on function private.expire_patient_export_sessions(uuid)
	to service_role;

create or replace function public.begin_patient_export(
	p_actor_user_id uuid,
	p_business_id uuid,
	p_scope text,
	p_patient_id uuid,
	p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
	v_user_id uuid := p_actor_user_id;
	v_existing public.patient_export_sessions%rowtype;
	v_session public.patient_export_sessions%rowtype;
	v_fingerprint text;
	v_expected_counts jsonb;
begin
	if v_user_id is null then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHENTICATED');
	end if;

	if p_business_id is null
		or p_request_key is null
		or p_scope is null
		or p_scope not in ('patient', 'all_patients')
		or (p_scope = 'patient' and p_patient_id is null)
		or (p_scope = 'all_patients' and p_patient_id is not null)
	then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	if not private.user_can_export_patient_data(p_business_id, v_user_id) then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	perform pg_advisory_xact_lock(
		hashtextextended('patient-export-business:' || p_business_id::text, 0)
	);
	perform private.expire_patient_export_sessions(p_business_id);

	select session.*
	into v_existing
	from public.patient_export_sessions session
	where session.requested_by_user_id = v_user_id
		and session.request_key = p_request_key;

	if found then
		if v_existing.business_id <> p_business_id
			or v_existing.scope <> p_scope
			or v_existing.patient_id is distinct from p_patient_id
		then
			return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
		end if;

		if v_existing.status in ('requested', 'streaming', 'dataset_validated') then
			return private.patient_export_session_response(v_existing)
				|| jsonb_build_object('reused', true);
		end if;

		if v_existing.status = 'expired' then
			return jsonb_build_object('ok', false, 'error_code', 'EXPORT_SESSION_EXPIRED');
		end if;
		if v_existing.status = 'cancelled' then
			return jsonb_build_object('ok', false, 'error_code', 'EXPORT_CANCELLED');
		end if;

		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_UNEXPECTED');
	end if;

	if p_scope = 'patient' and not exists (
		select 1
		from public.patients patient
		where patient.business_id = p_business_id
			and patient.id = p_patient_id
	) then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_PATIENT_NOT_FOUND');
	end if;

	if p_scope = 'all_patients' and exists (
		select 1
		from public.patient_export_sessions session
		where session.business_id = p_business_id
			and session.scope = 'all_patients'
			and session.status in ('requested', 'streaming')
	) then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_IN_PROGRESS');
	end if;

	select snapshot.dataset_fingerprint, snapshot.expected_counts
	into strict v_fingerprint, v_expected_counts
	from private.patient_export_snapshot(p_business_id, p_scope, p_patient_id) snapshot;

	insert into public.patient_export_sessions (
		business_id,
		requested_by_user_id,
		scope,
		patient_id,
		request_key,
		schema_version,
		dataset_fingerprint,
		expected_counts,
		status,
		expires_at
	)
	values (
		p_business_id,
		v_user_id,
		p_scope,
		p_patient_id,
		p_request_key,
		'cita-suite-patient-export/v1',
		v_fingerprint,
		v_expected_counts,
		'requested',
		statement_timestamp() + interval '30 minutes'
	)
	returning * into v_session;

	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		reason_code,
		metadata
	)
	values (
		p_business_id,
		v_user_id,
		'patient_export_requested',
		'patient_export_session',
		v_session.id,
		'success',
		null,
		jsonb_strip_nulls(jsonb_build_object(
			'export_id', v_session.id,
			'scope', v_session.scope,
			'patient_id', v_session.patient_id,
			'schema_version', v_session.schema_version,
			'expected_counts', v_session.expected_counts
		))
	);

	return private.patient_export_session_response(v_session)
		|| jsonb_build_object('reused', false);
end;
$$;

revoke all on function public.begin_patient_export(uuid, uuid, text, uuid, uuid)
	from public, anon, authenticated;
grant execute on function public.begin_patient_export(uuid, uuid, text, uuid, uuid)
	to service_role;

create or replace function public.read_patient_export_page(
	p_actor_user_id uuid,
	p_export_id uuid,
	p_dataset text,
	p_cursor jsonb default null,
	p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
	v_user_id uuid := p_actor_user_id;
	v_session public.patient_export_sessions%rowtype;
	v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
	v_after_id text;
	v_after_key text;
	v_rows jsonb := '[]'::jsonb;
	v_last_row jsonb;
	v_next_cursor jsonb := null;
	v_has_more boolean := false;
	v_candidate_count integer := 0;
	v_keep_count integer := 0;
	v_page_max_bytes constant integer := 1500000;
begin
	if v_user_id is null then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHENTICATED');
	end if;

	if p_export_id is null or p_dataset is null or p_dataset not in (
		'patients',
		'custom_fields',
		'clinical_entries',
		'appointments',
		'appointment_professionals',
		'follow_ups'
	) then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	if p_cursor is not null and jsonb_typeof(p_cursor) <> 'object' then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	if p_dataset = 'custom_fields' then
		if p_cursor is not null and (
			(select count(*) from jsonb_object_keys(p_cursor)) <> 2
			or coalesce(p_cursor ->> 'patient_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			or not (p_cursor ? 'field_key')
			or jsonb_typeof(p_cursor -> 'field_key') <> 'string'
		) then
			return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
		end if;
		v_after_id := p_cursor ->> 'patient_id';
		v_after_key := p_cursor ->> 'field_key';
	else
		if p_cursor is not null and (
			(select count(*) from jsonb_object_keys(p_cursor)) <> 1
			or coalesce(p_cursor ->> 'id', '') !~*
				'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		)
		then
			return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
		end if;
		v_after_id := p_cursor ->> 'id';
	end if;

	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
		and session.requested_by_user_id = v_user_id;

	if not found then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	perform private.expire_patient_export_sessions(v_session.business_id);

	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
		and session.requested_by_user_id = v_user_id
	for update;

	if v_session.status = 'expired' then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_SESSION_EXPIRED');
	end if;
	if v_session.status = 'cancelled' then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_CANCELLED');
	end if;
	if v_session.status = 'failed' then
		return jsonb_build_object(
			'ok', false,
			'error_code', case v_session.failure_code
				when 'data_changed' then 'EXPORT_DATA_CHANGED'
				when 'count_mismatch' then 'EXPORT_COUNT_MISMATCH'
				when 'authorization_revoked' then 'EXPORT_NOT_AUTHORIZED'
				else 'EXPORT_DEPENDENCY_UNAVAILABLE'
			end
		);
	end if;
	if v_session.status = 'dataset_validated' then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	if not private.user_can_export_patient_data(v_session.business_id, v_user_id) then
		perform private.fail_patient_export_session(v_session.id, 'authorization_revoked');
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	if p_dataset = 'patients' then
		select coalesce(
			jsonb_agg(to_jsonb(page_row) order by page_row.patient_id),
			'[]'::jsonb
		)
		into v_rows
		from (
			select
				patient.id::text as patient_id,
				patient.full_name,
				patient.dni,
				patient.phone,
				patient.email,
				patient.birth_date,
				patient.address,
				patient.insurance,
				patient.insurance_plan,
				profile.allergies,
				profile.medication,
				profile.background,
				profile.clinical_alert_note,
				profile.notes as clinical_notes,
				case when patient.archived_at is null then 'active' else 'archived' end as status,
				patient.archived_at,
				patient.created_at,
				patient.updated_at
			from public.patients patient
			left join public.patient_clinical_profiles profile
				on profile.business_id = patient.business_id
				and profile.patient_id = patient.id
			where patient.business_id = v_session.business_id
				and (v_session.scope = 'all_patients' or patient.id = v_session.patient_id)
				and (v_after_id is null or patient.id::text > v_after_id)
			order by patient.id::text
			limit v_limit + 1
		) page_row;
	elsif p_dataset = 'custom_fields' then
		select coalesce(
			jsonb_agg(
				to_jsonb(page_row)
				order by page_row.patient_id, page_row.field_key collate "C"
			),
			'[]'::jsonb
		)
		into v_rows
		from (
			select
				patient.id::text as patient_id,
				field.key as field_key,
				case
					when field.key = '__valor_sin_clave__'
						and jsonb_typeof(profile.custom_fields) <> 'object'
						then 'Valor sin clave'
					else field.key
				end as field_label,
				jsonb_typeof(field.value) as value_type,
				case jsonb_typeof(field.value)
					when 'string' then field.value #>> '{}'
					when 'number' then field.value::text
					when 'boolean' then field.value::text
					else null
				end as value_text,
				case
					when jsonb_typeof(field.value) in ('object', 'array') then field.value::text
					else null
				end as value_json
			from public.patients patient
			join public.patient_clinical_profiles profile
				on profile.business_id = patient.business_id
				and profile.patient_id = patient.id
			cross join lateral jsonb_each(
				case
					when profile.custom_fields is null then '{}'::jsonb
					when jsonb_typeof(profile.custom_fields) = 'object' then profile.custom_fields
					else jsonb_build_object('__valor_sin_clave__', profile.custom_fields)
				end
			) as field(key, value)
			where patient.business_id = v_session.business_id
				and (v_session.scope = 'all_patients' or patient.id = v_session.patient_id)
				and (
					v_after_id is null
					or patient.id::text > v_after_id
					or (
						patient.id::text = v_after_id
						and field.key collate "C" > v_after_key collate "C"
					)
				)
			order by patient.id::text, field.key collate "C"
			limit v_limit + 1
		) page_row;
	elsif p_dataset = 'clinical_entries' then
		select coalesce(
			jsonb_agg(to_jsonb(page_row) order by page_row.clinical_entry_id),
			'[]'::jsonb
		)
		into v_rows
		from (
			select
				entry.id::text as clinical_entry_id,
				entry.patient_id::text as patient_id,
				entry.created_at as occurred_at,
				entry.entry_type,
				entry.description,
				entry.teeth,
				entry.internal_note,
				cost.amount::text as amount,
				entry.created_by_professional_id::text as professional_id,
				professional.name as professional_name,
				case when entry.archived_at is null then 'active' else 'archived' end as status,
				entry.archived_at,
				entry.created_at,
				entry.updated_at
			from public.clinical_entries entry
			join public.patients patient
				on patient.business_id = entry.business_id
				and patient.id = entry.patient_id
			left join public.clinical_entry_costs cost
				on cost.business_id = entry.business_id
				and cost.clinical_entry_id = entry.id
			left join public.professionals professional
				on professional.business_id = entry.business_id
				and professional.id = entry.created_by_professional_id
			where entry.business_id = v_session.business_id
				and (v_session.scope = 'all_patients' or entry.patient_id = v_session.patient_id)
				and (v_after_id is null or entry.id::text > v_after_id)
			order by entry.id::text
			limit v_limit + 1
		) page_row;
	elsif p_dataset = 'appointments' then
		select coalesce(
			jsonb_agg(to_jsonb(page_row) order by page_row.appointment_id),
			'[]'::jsonb
		)
		into v_rows
		from (
			select
				appointment.id::text as appointment_id,
				appointment.patient_id::text as patient_id,
				appointment.starts_at,
				appointment.ends_at,
				appointment.status,
				appointment.source,
				appointment.service_name_snapshot,
				appointment.internal_note,
				appointment.professional_name_snapshot,
				appointment.confirmed_at,
				appointment.cancelled_at,
				appointment.reschedule_requested_at,
				appointment.cancelled_reason,
				appointment.created_at,
				appointment.updated_at
			from public.appointments appointment
			join public.patients patient
				on patient.business_id = appointment.business_id
				and patient.id = appointment.patient_id
			where appointment.business_id = v_session.business_id
				and (v_session.scope = 'all_patients' or appointment.patient_id = v_session.patient_id)
				and (v_after_id is null or appointment.id::text > v_after_id)
			order by appointment.id::text
			limit v_limit + 1
		) page_row;
	elsif p_dataset = 'appointment_professionals' then
		select coalesce(
			jsonb_agg(to_jsonb(page_row) order by page_row.allocation_id),
			'[]'::jsonb
		)
		into v_rows
		from (
			select
				allocation.id::text as allocation_id,
				allocation.appointment_id::text as appointment_id,
				appointment.patient_id::text as patient_id,
				allocation.professional_id::text as professional_id,
				allocation.professional_name_snapshot as professional_name,
				allocation.is_primary,
				allocation.position
			from public.appointment_professionals allocation
			join public.appointments appointment
				on appointment.business_id = allocation.business_id
				and appointment.id = allocation.appointment_id
			where allocation.business_id = v_session.business_id
				and (v_session.scope = 'all_patients' or appointment.patient_id = v_session.patient_id)
				and (v_after_id is null or allocation.id::text > v_after_id)
			order by allocation.id::text
			limit v_limit + 1
		) page_row;
	else
		select coalesce(
			jsonb_agg(to_jsonb(page_row) order by page_row.follow_up_id),
			'[]'::jsonb
		)
		into v_rows
		from (
			select
				follow_up.id::text as follow_up_id,
				follow_up.patient_id::text as patient_id,
				follow_up.remind_on,
				follow_up.message,
				follow_up.status,
				follow_up.assigned_professional_id::text as assigned_professional_id,
				professional.name as assigned_professional_name,
				follow_up.done_at,
				follow_up.created_at,
				follow_up.updated_at
			from public.follow_ups follow_up
			join public.patients patient
				on patient.business_id = follow_up.business_id
				and patient.id = follow_up.patient_id
			left join public.professionals professional
				on professional.business_id = follow_up.business_id
				and professional.id = follow_up.assigned_professional_id
			where follow_up.business_id = v_session.business_id
				and (v_session.scope = 'all_patients' or follow_up.patient_id = v_session.patient_id)
				and (v_after_id is null or follow_up.id::text > v_after_id)
			order by follow_up.id::text
			limit v_limit + 1
		) page_row;
	end if;

	-- Mantiene cada respuesta acotada por filas y, cuando hay textos grandes,
	-- tambien por bytes JSON. La primera fila siempre se conserva para que un
	-- valor historico grande pueda avanzar sin truncamiento silencioso.
	v_candidate_count := jsonb_array_length(v_rows);
	if v_candidate_count > 0 then
		with row_sizes as (
			select
				item.ordinality::integer as row_number,
				sum(octet_length(item.value::text)) over (order by item.ordinality) as bytes_so_far
			from jsonb_array_elements(v_rows) with ordinality as item(value, ordinality)
		)
		select coalesce(max(row_number), 1)
		into v_keep_count
		from row_sizes
		where row_number <= v_limit
			and (row_number = 1 or bytes_so_far <= v_page_max_bytes);
	end if;

	v_has_more := v_candidate_count > v_keep_count;
	if v_has_more then
		v_last_row := v_rows -> (v_keep_count - 1);
		if p_dataset = 'custom_fields' then
			v_next_cursor := jsonb_build_object(
				'patient_id', v_last_row ->> 'patient_id',
				'field_key', v_last_row ->> 'field_key'
			);
		elsif p_dataset = 'patients' then
			v_next_cursor := jsonb_build_object('id', v_last_row ->> 'patient_id');
		elsif p_dataset = 'clinical_entries' then
			v_next_cursor := jsonb_build_object('id', v_last_row ->> 'clinical_entry_id');
		elsif p_dataset = 'appointments' then
			v_next_cursor := jsonb_build_object('id', v_last_row ->> 'appointment_id');
		elsif p_dataset = 'appointment_professionals' then
			v_next_cursor := jsonb_build_object('id', v_last_row ->> 'allocation_id');
		else
			v_next_cursor := jsonb_build_object('id', v_last_row ->> 'follow_up_id');
		end if;
	end if;

	select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
	into v_rows
	from jsonb_array_elements(v_rows) with ordinality as item(value, ordinality)
	where item.ordinality <= v_keep_count;

	update public.patient_export_sessions
	set
		status = 'streaming',
		last_accessed_at = statement_timestamp()
	where id = v_session.id;

	return jsonb_build_object(
		'ok', true,
		'export_id', v_session.id,
		'dataset', p_dataset,
		'rows', v_rows,
		'row_count', jsonb_array_length(v_rows),
		'next_cursor', v_next_cursor,
		'done', not v_has_more,
		'expires_at', v_session.expires_at
	);
exception
	when others then
		if v_session.id is not null then
			perform private.fail_patient_export_session(v_session.id, 'dependency_unavailable');
		end if;
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_DEPENDENCY_UNAVAILABLE');
end;
$$;

revoke all on function public.read_patient_export_page(uuid, uuid, text, jsonb, integer)
	from public, anon, authenticated;
grant execute on function public.read_patient_export_page(uuid, uuid, text, jsonb, integer)
	to service_role;

create or replace function public.validate_patient_export(
	p_actor_user_id uuid,
	p_export_id uuid,
	p_received_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
	v_user_id uuid := p_actor_user_id;
	v_session public.patient_export_sessions%rowtype;
	v_current_fingerprint text;
	v_current_counts jsonb;
	v_received_counts jsonb;
begin
	if v_user_id is null then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHENTICATED');
	end if;

	if p_export_id is null
		or p_received_counts is null
		or jsonb_typeof(p_received_counts) <> 'object'
	then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	if (select count(*) from jsonb_object_keys(p_received_counts)) <> 6
		or exists (
			select 1
			from jsonb_each(p_received_counts) item
			where item.key not in (
				'patients',
				'custom_fields',
				'clinical_entries',
				'appointments',
				'appointment_professionals',
				'follow_ups'
			)
				or jsonb_typeof(item.value) <> 'number'
				or item.value::text !~ '^[0-9]+$'
				or item.value::numeric > 9223372036854775807
		)
	then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	v_received_counts := jsonb_build_object(
		'patients', (p_received_counts ->> 'patients')::bigint,
		'custom_fields', (p_received_counts ->> 'custom_fields')::bigint,
		'clinical_entries', (p_received_counts ->> 'clinical_entries')::bigint,
		'appointments', (p_received_counts ->> 'appointments')::bigint,
		'appointment_professionals', (p_received_counts ->> 'appointment_professionals')::bigint,
		'follow_ups', (p_received_counts ->> 'follow_ups')::bigint
	);

	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
		and session.requested_by_user_id = v_user_id;

	if not found then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	perform private.expire_patient_export_sessions(v_session.business_id);

	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
		and session.requested_by_user_id = v_user_id
	for update;

	if v_session.status = 'expired' then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_SESSION_EXPIRED');
	end if;
	if v_session.status = 'cancelled' then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_CANCELLED');
	end if;
	if v_session.status = 'failed' then
		return jsonb_build_object(
			'ok', false,
			'error_code', case v_session.failure_code
				when 'data_changed' then 'EXPORT_DATA_CHANGED'
				when 'count_mismatch' then 'EXPORT_COUNT_MISMATCH'
				when 'authorization_revoked' then 'EXPORT_NOT_AUTHORIZED'
				else 'EXPORT_DEPENDENCY_UNAVAILABLE'
			end
		);
	end if;
	if v_session.status = 'dataset_validated' then
		if v_received_counts = v_session.expected_counts then
			return jsonb_build_object(
				'ok', true,
				'validated', true,
				'validated_at', v_session.validated_at
			);
		end if;
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_COUNT_MISMATCH');
	end if;

	if not private.user_can_export_patient_data(v_session.business_id, v_user_id) then
		perform private.fail_patient_export_session(v_session.id, 'authorization_revoked');
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	select snapshot.dataset_fingerprint, snapshot.expected_counts
	into strict v_current_fingerprint, v_current_counts
	from private.patient_export_snapshot(
		v_session.business_id,
		v_session.scope,
		v_session.patient_id
	) snapshot;

	if v_current_fingerprint is distinct from v_session.dataset_fingerprint
		or v_current_counts is distinct from v_session.expected_counts
	then
		perform private.fail_patient_export_session(v_session.id, 'data_changed');
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_DATA_CHANGED');
	end if;

	if v_received_counts is distinct from v_session.expected_counts then
		perform private.fail_patient_export_session(v_session.id, 'count_mismatch');
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_COUNT_MISMATCH');
	end if;

	update public.patient_export_sessions
	set
		status = 'dataset_validated',
		failure_code = null,
		last_accessed_at = statement_timestamp(),
		validated_at = statement_timestamp(),
		finished_at = statement_timestamp()
	where id = v_session.id
	returning * into v_session;

	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		reason_code,
		metadata
	)
	values (
		v_session.business_id,
		v_session.requested_by_user_id,
		'patient_export_dataset_validated',
		'patient_export_session',
		v_session.id,
		'success',
		null,
		jsonb_strip_nulls(jsonb_build_object(
			'export_id', v_session.id,
			'scope', v_session.scope,
			'patient_id', v_session.patient_id,
			'schema_version', v_session.schema_version,
			'counts', v_session.expected_counts,
			'duration_ms', greatest(
				0,
				floor(extract(epoch from (statement_timestamp() - v_session.created_at)) * 1000)::bigint
			)
		))
	);

	return jsonb_build_object(
		'ok', true,
		'validated', true,
		'validated_at', v_session.validated_at
	);
exception
	when others then
		if v_session.id is not null then
			perform private.fail_patient_export_session(v_session.id, 'dependency_unavailable');
		end if;
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_DEPENDENCY_UNAVAILABLE');
end;
$$;

revoke all on function public.validate_patient_export(uuid, uuid, jsonb)
	from public, anon, authenticated;
grant execute on function public.validate_patient_export(uuid, uuid, jsonb)
	to service_role;

create or replace function public.cancel_patient_export(
	p_actor_user_id uuid,
	p_export_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
	v_user_id uuid := p_actor_user_id;
	v_session public.patient_export_sessions%rowtype;
begin
	if v_user_id is null then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHENTICATED');
	end if;

	if p_export_id is null then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_INVALID_REQUEST');
	end if;

	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
		and session.requested_by_user_id = v_user_id;

	if not found then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	perform private.expire_patient_export_sessions(v_session.business_id);

	select session.*
	into v_session
	from public.patient_export_sessions session
	where session.id = p_export_id
		and session.requested_by_user_id = v_user_id
	for update;

	if v_session.status in ('cancelled', 'expired', 'failed') then
		return jsonb_build_object('ok', true, 'status', v_session.status);
	end if;

	if not private.user_can_export_patient_data(v_session.business_id, v_user_id) then
		perform private.fail_patient_export_session(v_session.id, 'authorization_revoked');
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_NOT_AUTHORIZED');
	end if;

	update public.patient_export_sessions
	set
		status = 'cancelled',
		failure_code = 'cancelled_by_user',
		last_accessed_at = statement_timestamp(),
		finished_at = statement_timestamp()
	where id = v_session.id;

	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		reason_code,
		metadata
	)
	values (
		v_session.business_id,
		v_session.requested_by_user_id,
		'patient_export_cancelled',
		'patient_export_session',
		v_session.id,
		'success',
		'cancelled_by_user',
		jsonb_strip_nulls(jsonb_build_object(
			'export_id', v_session.id,
			'scope', v_session.scope,
			'patient_id', v_session.patient_id,
			'schema_version', v_session.schema_version,
			'duration_ms', greatest(
				0,
				floor(extract(epoch from (statement_timestamp() - v_session.created_at)) * 1000)::bigint
			)
		))
	);

	return jsonb_build_object('ok', true, 'status', 'cancelled');
exception
	when others then
		return jsonb_build_object('ok', false, 'error_code', 'EXPORT_DEPENDENCY_UNAVAILABLE');
end;
$$;

revoke all on function public.cancel_patient_export(uuid, uuid)
	from public, anon, authenticated;
grant execute on function public.cancel_patient_export(uuid, uuid)
	to service_role;

-- Amplia el limitador server-side existente para inicios de exportacion. Los
-- sujetos siguen llegando hasheados y estas funciones continúan reservadas al
-- backend con service_role.
create or replace function public.consume_server_rate_limit(
	p_action text,
	p_subject_hash text,
	p_limit integer,
	p_window_seconds integer
)
returns table(allowed boolean, used integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_action text := lower(nullif(trim(coalesce(p_action, '')), ''));
	v_subject_hash text := lower(nullif(trim(coalesce(p_subject_hash, '')), ''));
	v_limit integer := greatest(coalesce(p_limit, 0), 0);
	v_window_seconds integer := greatest(coalesce(p_window_seconds, 0), 0);
	v_since timestamptz;
	v_used integer;
	v_oldest timestamptz;
begin
	if v_action is null or v_subject_hash is null or v_limit <= 0 or v_window_seconds <= 0 then
		raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
	end if;

	if v_action not in (
		'signup_email_by_email',
		'signup_email_by_ip',
		'signup_google_by_ip',
		'login_password_by_email',
		'login_password_by_ip',
		'pending_business_creation_by_user',
		'pending_business_creation_by_ip',
		'mp_subscription_create_by_business',
		'radiograph_upload_by_user',
		'radiograph_original_access_by_user',
		'radiograph_trash_by_user',
		'radiograph_restore_by_user',
		'patient_export_individual_by_user',
		'patient_export_global_by_business'
	) then
		raise exception 'RATE_LIMIT_UNKNOWN_ACTION';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(v_action || ':' || v_subject_hash, 0));
	v_since := now() - make_interval(secs => v_window_seconds);

	delete from public.server_rate_limit_events
	where created_at < now() - interval '7 days';

	select count(*)::integer, min(created_at)
	into v_used, v_oldest
	from public.server_rate_limit_events
	where action = v_action
		and subject_hash = v_subject_hash
		and created_at >= v_since;

	if v_used >= v_limit then
		allowed := false;
		used := v_used;
		retry_after_seconds := greatest(
			1,
			ceil(extract(epoch from (v_oldest + make_interval(secs => v_window_seconds) - now())))::integer
		);
		return next;
		return;
	end if;

	insert into public.server_rate_limit_events (action, subject_hash)
	values (v_action, v_subject_hash);

	allowed := true;
	used := v_used + 1;
	retry_after_seconds := 0;
	return next;
end;
$$;

create or replace function public.consume_server_rate_limits(
	p_action text,
	p_subject_hash text,
	p_windows jsonb
)
returns table(allowed boolean, used integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_action text := lower(nullif(trim(coalesce(p_action, '')), ''));
	v_subject_hash text := lower(nullif(trim(coalesce(p_subject_hash, '')), ''));
	v_window record;
	v_since timestamptz;
	v_used integer;
	v_oldest timestamptz;
	v_max_used integer := 0;
	v_retry_after integer := 0;
begin
	if v_action is null or v_subject_hash is null
		or jsonb_typeof(p_windows) <> 'array'
		or jsonb_array_length(p_windows) = 0
	then
		raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
	end if;

	if v_action not in (
		'signup_email_by_email',
		'signup_email_by_ip',
		'signup_google_by_ip',
		'login_password_by_email',
		'login_password_by_ip',
		'pending_business_creation_by_user',
		'pending_business_creation_by_ip',
		'mp_subscription_create_by_business',
		'radiograph_upload_by_user',
		'radiograph_original_access_by_user',
		'radiograph_trash_by_user',
		'radiograph_restore_by_user',
		'patient_export_individual_by_user',
		'patient_export_global_by_business'
	) then
		raise exception 'RATE_LIMIT_UNKNOWN_ACTION';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(v_action || ':' || v_subject_hash, 0));
	delete from public.server_rate_limit_events
	where created_at < now() - interval '7 days';

	for v_window in
		select *
		from jsonb_to_recordset(p_windows) as window_defs(limit_count integer, window_seconds integer)
	loop
		if coalesce(v_window.limit_count, 0) <= 0 or coalesce(v_window.window_seconds, 0) <= 0 then
			raise exception 'RATE_LIMIT_INVALID_ARGUMENTS';
		end if;

		v_since := now() - make_interval(secs => v_window.window_seconds);
		select count(*)::integer, min(created_at)
		into v_used, v_oldest
		from public.server_rate_limit_events
		where action = v_action
			and subject_hash = v_subject_hash
			and created_at >= v_since;

		v_max_used := greatest(v_max_used, v_used);
		if v_used >= v_window.limit_count then
			v_retry_after := greatest(
				v_retry_after,
				greatest(
					1,
					ceil(extract(epoch from (v_oldest + make_interval(secs => v_window.window_seconds) - now())))::integer
				)
			);
		end if;
	end loop;

	if v_retry_after > 0 then
		allowed := false;
		used := v_max_used;
		retry_after_seconds := v_retry_after;
		return next;
		return;
	end if;

	insert into public.server_rate_limit_events (action, subject_hash)
	values (v_action, v_subject_hash);

	allowed := true;
	used := v_max_used + 1;
	retry_after_seconds := 0;
	return next;
end;
$$;

revoke execute on function public.consume_server_rate_limit(text, text, integer, integer)
	from public, anon, authenticated;
revoke execute on function public.consume_server_rate_limits(text, text, jsonb)
	from public, anon, authenticated;
grant execute on function public.consume_server_rate_limit(text, text, integer, integer)
	to service_role;
grant execute on function public.consume_server_rate_limits(text, text, jsonb)
	to service_role;

create or replace function private.maintain_patient_export_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
	v_expired integer;
	v_deleted integer;
begin
	v_expired := private.expire_patient_export_sessions(null);

	delete from public.patient_export_sessions session
	where session.status in ('dataset_validated', 'failed', 'expired', 'cancelled')
		and coalesce(session.finished_at, session.last_accessed_at) < statement_timestamp() - interval '30 days';
	get diagnostics v_deleted = row_count;

	return jsonb_build_object('expired', v_expired, 'deleted', v_deleted);
end;
$$;

revoke all on function private.maintain_patient_export_sessions()
	from public, anon, authenticated;
grant execute on function private.maintain_patient_export_sessions()
	to service_role;

create extension if not exists pg_cron;

do $$
declare
	v_job_id bigint;
begin
	if to_regnamespace('cron') is null then
		raise exception 'PATIENT_EXPORT_CRON_UNAVAILABLE';
	end if;

	for v_job_id in
		select jobid
		from cron.job
		where jobname = 'cita-suite-patient-export-maintenance'
	loop
		perform cron.unschedule(v_job_id);
	end loop;

	perform cron.schedule(
		'cita-suite-patient-export-maintenance',
		'*/15 * * * *',
		'select private.maintain_patient_export_sessions()'
	);
end;
$$;

notify pgrst, 'reload schema';

commit;
