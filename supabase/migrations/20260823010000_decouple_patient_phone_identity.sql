-- Patient identity is the immutable patients.id. Phone and name are contact /
-- descriptive attributes and may be shared by different people.
--
-- This migration also makes patient + appointment creation atomic and
-- idempotent. Manual flows must say "existing" or "new" explicitly. Public
-- booking uses a deliberately conservative bridge: it reuses a patient only
-- when exactly one active row has the same normalized full name and phone.

begin;

drop index if exists public.patients_business_phone_e164_uq;
-- This pre-multitenancy index incorrectly couples two businesses when they
-- share the same technical owner. The business-scoped DNI index remains the
-- sole uniqueness rule.
drop index if exists public.patients_owner_dni_uq;

create index if not exists patients_business_phone_e164_idx
	on public.patients (business_id, phone_e164)
	where business_id is not null and phone_e164 is not null;

-- The former unique-index migration kept only the oldest normalized copy and
-- nulled the rest. Restore only a candidate already present on another row in
-- the same business; this repairs known shared contacts without guessing from
-- arbitrary invalid input.
with restore_candidates as (
	select
		patient.id,
		patient.business_id,
		public.normalize_phone_e164(
			coalesce(nullif(trim(patient.phone_raw), ''), patient.phone)
		) as candidate_phone_e164
	from public.patients patient
	where patient.business_id is not null
		and patient.phone_e164 is null
)
update public.patients patient
set phone_e164 = candidate.candidate_phone_e164
from restore_candidates candidate
where patient.id = candidate.id
	and candidate.candidate_phone_e164 is not null
	and exists (
		select 1
		from public.patients retained
		where retained.business_id = candidate.business_id
			and retained.id <> candidate.id
			and retained.phone_e164 = candidate.candidate_phone_e164
	);

comment on index public.patients_business_phone_e164_idx is
	'Non-unique contact lookup. A phone number may belong to more than one patient.';

alter table public.appointments
	add column if not exists patient_name_at_booking text,
	add column if not exists patient_phone_raw_at_booking text,
	add column if not exists patient_phone_e164_at_booking text,
	add column if not exists patient_resolution_strategy text not null default 'legacy_unknown',
	add column if not exists public_booking_contact_key text,
	add column if not exists creation_request_key text,
	add column if not exists creation_request_fingerprint text;

update public.appointments appointment
set
	patient_name_at_booking = coalesce(
		appointment.patient_name_at_booking,
		patient.full_name,
		'Paciente'
	),
	patient_phone_e164_at_booking = coalesce(
		appointment.patient_phone_e164_at_booking,
		patient.phone_e164
	),
	patient_phone_raw_at_booking = coalesce(
		appointment.patient_phone_raw_at_booking,
		nullif(trim(patient.phone_raw), ''),
		nullif(trim(patient.phone), ''),
		patient.phone_e164
	)
from public.patients patient
where patient.business_id = appointment.business_id
	and patient.id = appointment.patient_id
	and (
		appointment.patient_name_at_booking is null
		or appointment.patient_phone_raw_at_booking is null
	);

update public.appointments appointment
set public_booking_contact_key = encode(
	extensions.digest(
		public.normalized_patient_name(appointment.patient_name_at_booking)
			|| ':' || coalesce(appointment.patient_phone_e164_at_booking, ''),
		'sha256'
	),
	'hex'
)
where appointment.source = 'public_booking'
	and appointment.public_booking_contact_key is null;

alter table public.appointments
	alter column patient_name_at_booking set not null;

alter table public.appointments
	drop constraint if exists appointments_patient_resolution_strategy_check,
	drop constraint if exists appointments_public_booking_contact_key_format_check,
	drop constraint if exists appointments_creation_request_key_format_check,
	drop constraint if exists appointments_creation_request_fingerprint_format_check;

alter table public.appointments
	add constraint appointments_patient_resolution_strategy_check check (
		patient_resolution_strategy in (
			'legacy_unknown',
			'existing_id',
			'new_explicit',
			'public_exact_match',
			'public_new',
			'public_ambiguous_new',
			'reassigned_manual'
		)
	),
	add constraint appointments_public_booking_contact_key_format_check check (
		public_booking_contact_key is null
		or public_booking_contact_key ~ '^[0-9a-f]{64}$'
	),
	add constraint appointments_creation_request_key_format_check check (
		creation_request_key is null
		or creation_request_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
	),
	add constraint appointments_creation_request_fingerprint_format_check check (
		creation_request_fingerprint is null
		or creation_request_fingerprint ~ '^[0-9a-f]{64}$'
	);

create unique index if not exists appointments_business_creation_request_uq
	on public.appointments (business_id, creation_request_key)
	where creation_request_key is not null;

create index if not exists appointments_public_booking_contact_limit_idx
	on public.appointments (business_id, public_booking_contact_key, starts_at)
	where source = 'public_booking'
		and status in ('reserved', 'confirmed', 'reschedule_requested')
		and public_booking_contact_key is not null;

comment on column public.appointments.patient_name_at_booking is
	'Diagnostic snapshot of the patient name used when the appointment was created.';
comment on column public.appointments.patient_phone_raw_at_booking is
	'Diagnostic snapshot of the phone text used when the appointment was created, including invalid or incomplete input.';
comment on column public.appointments.patient_phone_e164_at_booking is
	'Diagnostic snapshot of the normalized contact used when the appointment was created.';
comment on column public.appointments.patient_resolution_strategy is
	'Explicit strategy that associated this appointment with patients.id.';
comment on column public.appointments.public_booking_contact_key is
	'Hashed name + phone anti-abuse bucket for anonymous booking limits; it is never patient identity.';
comment on column public.appointments.creation_request_key is
	'Client-generated UUID used to make appointment creation idempotent per business.';
comment on column public.appointments.creation_request_fingerprint is
	'SHA-256 of the normalized creation payload; detects unsafe idempotency-key reuse.';

-- Identity and anonymous anti-abuse are deliberately separate. The patient ID
-- protects clinical separation. A one-way name + phone bucket prevents an
-- ambiguous public request from evading the four-booking limit by creating a
-- fresh patient row each time. Different names sharing one phone do not share
-- this bucket.
create or replace function private.public_booking_contact_bucket(
	p_patient_name text,
	p_phone_e164 text
)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_catalog
as $$
	select encode(
		digest(
			public.normalized_patient_name(coalesce(p_patient_name, ''))
				|| ':' || coalesce(trim(p_phone_e164), ''),
			'sha256'
		),
		'hex'
	);
$$;

revoke all on function private.public_booking_contact_bucket(text, text)
	from public, anon, authenticated;

-- Legacy creators, including the inner joint RPC, do not know the new
-- snapshot columns. Fill them before constraints and quota triggers evaluate
-- the row. The atomic wrapper enriches the strategy and idempotency fields in
-- the same transaction afterwards.
create or replace function public.set_appointment_patient_snapshot_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_patient record;
	v_write_mode text := current_setting('cita_suite.appointment_identity_write', true);
begin
	select
		patient.full_name,
		coalesce(
			nullif(trim(patient.phone_raw), ''),
			nullif(trim(patient.phone), ''),
			patient.phone_e164
		) as phone_raw,
		patient.phone_e164
	into v_patient
	from public.patients patient
	where patient.business_id = new.business_id
		and patient.id = new.patient_id;
	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	if coalesce(v_write_mode, '') <> 'create'
		and (
			new.patient_resolution_strategy is distinct from 'legacy_unknown'
			or new.creation_request_key is not null
			or new.creation_request_fingerprint is not null
		)
	then
		raise exception 'APPOINTMENT_IDENTITY_WRITE_DENIED';
	end if;

	-- These snapshots and the anonymous quota bucket are derived server-side.
	-- A caller cannot provide a different name or phone and manufacture false
	-- provenance for the clinical appointment.
	new.patient_name_at_booking := v_patient.full_name;
	new.patient_phone_raw_at_booking := case
		when coalesce(v_write_mode, '') = 'create'
			then coalesce(new.patient_phone_raw_at_booking, v_patient.phone_raw)
		else v_patient.phone_raw
	end;
	new.patient_phone_e164_at_booking := v_patient.phone_e164;
	if new.source = 'public_booking' then
		new.public_booking_contact_key := private.public_booking_contact_bucket(
			new.patient_name_at_booking,
			new.patient_phone_e164_at_booking
		);
	else
		new.public_booking_contact_key := null;
	end if;
	return new;
end;
$$;

drop trigger if exists appointments_patient_snapshot_backstop on public.appointments;
create trigger appointments_patient_snapshot_backstop
	before insert on public.appointments
	for each row
	execute function public.set_appointment_patient_snapshot_on_insert();

revoke execute on function public.set_appointment_patient_snapshot_on_insert()
	from public, anon, authenticated;

create or replace function private.serialize_patient_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_old_lock_key text;
	v_new_lock_key text;
begin
	if new.business_id is not null
		and new.phone_e164 is not null
		and public.normalized_patient_name(new.full_name) is not null
	then
		v_new_lock_key := 'patient-contact-resolution:' || new.business_id::text || ':'
			|| private.public_booking_contact_bucket(new.full_name, new.phone_e164);
	end if;

	if tg_op = 'UPDATE'
		and old.business_id is not null
		and old.phone_e164 is not null
		and public.normalized_patient_name(old.full_name) is not null
	then
		v_old_lock_key := 'patient-contact-resolution:' || old.business_id::text || ':'
			|| private.public_booking_contact_bucket(old.full_name, old.phone_e164);
	end if;

	if v_old_lock_key is null then
		if v_new_lock_key is not null then
			perform pg_advisory_xact_lock(hashtextextended(v_new_lock_key, 0));
		end if;
	elsif v_new_lock_key is null or v_old_lock_key = v_new_lock_key then
		perform pg_advisory_xact_lock(hashtextextended(v_old_lock_key, 0));
	elsif v_old_lock_key < v_new_lock_key then
		perform pg_advisory_xact_lock(hashtextextended(v_old_lock_key, 0));
		perform pg_advisory_xact_lock(hashtextextended(v_new_lock_key, 0));
	else
		perform pg_advisory_xact_lock(hashtextextended(v_new_lock_key, 0));
		perform pg_advisory_xact_lock(hashtextextended(v_old_lock_key, 0));
	end if;

	return new;
end;
$$;

drop trigger if exists patients_serialize_contact_changes on public.patients;
create trigger patients_serialize_contact_changes
	before insert or update of business_id, full_name, phone_e164, archived_at
	on public.patients
	for each row
	execute function private.serialize_patient_contact_changes();

revoke all on function private.serialize_patient_contact_changes()
	from public, anon, authenticated;

create or replace function public.get_public_booking_active_future_count_for_request(
	p_business_id uuid,
	p_patient_id uuid,
	p_patient_name text,
	p_phone_e164 text,
	p_now timestamptz default statement_timestamp()
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$

declare
	v_contact_key text := private.public_booking_contact_bucket(p_patient_name, p_phone_e164);
	v_count integer;
begin
	select count(*)::integer into v_count
	from public.appointments appointment
	where appointment.business_id = p_business_id
		and (
			(p_patient_id is not null and appointment.patient_id = p_patient_id)
			or (
				appointment.source = 'public_booking'
				and appointment.public_booking_contact_key = v_contact_key
			)
		)
		and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
		and appointment.starts_at > p_now;
	return v_count;
end;
$$;

create or replace function public.enforce_public_booking_future_appointment_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_active_future_count integer;
	v_contact_key text;
begin
	if new.source <> 'public_booking'
		or new.status not in ('reserved', 'confirmed', 'reschedule_requested')
		or new.starts_at <= v_now
	then
		return new;
	end if;

	if new.public_booking_contact_key is null
		or (tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id)
	then
		select private.public_booking_contact_bucket(
			coalesce(new.patient_name_at_booking, patient.full_name),
			coalesce(new.patient_phone_e164_at_booking, patient.phone_e164)
		)
		into v_contact_key
		from public.patients patient
		where patient.business_id = new.business_id
			and patient.id = new.patient_id;
		new.public_booking_contact_key := v_contact_key;
	else
		v_contact_key := new.public_booking_contact_key;
	end if;
	if v_contact_key is null then
		raise exception 'PUBLIC_BOOKING_CONTACT_KEY_REQUIRED';
	end if;

	-- A controlled patient reassignment must repair the descriptive bucket even
	-- when the target patient already has four future turns. The repaired row is
	-- still counted by every later booking; only this audited maintenance write
	-- skips rejecting historical data that already exists.
	if current_setting('cita_suite.appointment_identity_write', true) = 'repair' then
		return new;
	end if;

	perform pg_advisory_xact_lock(
		hashtextextended(
			'public-booking-limit:contact:' || new.business_id::text || ':' || v_contact_key,
			0
		)
	);

	select count(*)::integer
	into v_active_future_count
	from public.appointments appointment
	where appointment.business_id = new.business_id
		and (
			appointment.patient_id = new.patient_id
			or (
				appointment.source = 'public_booking'
				and appointment.public_booking_contact_key = v_contact_key
			)
		)
		and appointment.id is distinct from new.id
		and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
		and appointment.starts_at > v_now;

	if v_active_future_count >= 4 then
		raise exception using
			errcode = 'P0001',
			message = 'PUBLIC_BOOKING_ACTIVE_LIMIT',
			detail = 'The resolved patient or anonymous contact bucket already has 4 active future appointments.';
	end if;

	return new;
end;
$$;

drop trigger if exists appointments_public_booking_future_limit on public.appointments;
create trigger appointments_public_booking_future_limit
	before insert or update of business_id, patient_id, status, starts_at, source, public_booking_contact_key
	on public.appointments
	for each row
	execute function public.enforce_public_booking_future_appointment_limit();

-- The old by-name helper encoded a descriptive field as identity. No current
-- code may call it after this migration.
drop function if exists public.get_public_booking_active_future_count_by_name(uuid, text, timestamptz);
drop function if exists public.get_public_booking_active_future_count_by_patient(uuid, uuid, timestamptz);

create or replace function public.create_appointment_with_patient_identity(
	p_business_id uuid,
	p_patient_mode text,
	p_patient_id uuid,
	p_patient_name text,
	p_patient_phone_raw text,
	p_patient_phone_e164 text,
	p_patient_email text,
	p_update_existing_phone boolean,
	p_owner_id uuid,
	p_service_id uuid,
	p_professional_ids uuid[],
	p_starts_at timestamptz,
	p_internal_note text,
	p_created_by_user_id uuid,
	p_ignore_break boolean,
	p_source text,
	p_phone_communication_status text,
	p_phone_warning_acknowledged boolean,
	p_idempotency_key text,
	p_replay_only boolean default false
)
returns table (
	id uuid,
	patient_id uuid,
	confirmation_token text,
	starts_at timestamptz,
	ends_at timestamptz,
	service_name_snapshot text,
	professional_name_snapshot text,
	patient_created boolean,
	idempotent_replay boolean,
	patient_resolution_strategy text
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
	v_patient_mode text := lower(trim(coalesce(p_patient_mode, '')));
	v_source text := lower(trim(coalesce(p_source, '')));
	v_phone_status text := lower(trim(coalesce(p_phone_communication_status, '')));
	v_phone_acknowledged boolean := coalesce(p_phone_warning_acknowledged, false);
	v_replay_only boolean := coalesce(p_replay_only, false);
	v_idempotency_key text := lower(trim(coalesce(p_idempotency_key, '')));
	v_patient_name text := regexp_replace(trim(coalesce(p_patient_name, '')), '\s+', ' ', 'g');
	v_patient_phone_raw text := nullif(trim(coalesce(p_patient_phone_raw, '')), '');
	v_patient_phone_e164 text := nullif(trim(coalesce(p_patient_phone_e164, '')), '');
	v_patient_email text := nullif(trim(coalesce(p_patient_email, '')), '');
	v_professional_ids uuid[];
	v_request_fingerprint text;
	v_existing_request record;
	v_patient record;
	v_resolved_patient_id uuid;
	v_resolved_patient_name text;
	v_resolved_patient_phone_raw text;
	v_resolved_patient_phone_e164 text;
	v_resolution_strategy text;
	v_patient_created boolean := false;
	v_owner_id uuid := p_owner_id;
	v_exact_match_count integer := 0;
	v_exact_match_id uuid;
	v_service record;
	v_created record;
	v_appointment public.appointments%rowtype;
begin
	if p_business_id is null or p_service_id is null or p_starts_at is null then
		raise exception 'APPOINTMENT_REQUIRED_FIELDS';
	end if;
	if v_patient_mode not in ('existing', 'new', 'public') then
		raise exception 'PATIENT_MODE_INVALID';
	end if;
	if v_source not in ('manual', 'public_booking', 'whatsapp_bot', 'admin') then
		raise exception 'APPOINTMENT_SOURCE_INVALID';
	end if;
	if (v_patient_mode = 'public') <> (v_source = 'public_booking') then
		raise exception 'PATIENT_MODE_SOURCE_MISMATCH';
	end if;
	if v_phone_status not in ('unknown', 'valid', 'missing', 'invalid') then
		raise exception 'PHONE_COMMUNICATION_STATUS_INVALID';
	end if;
	if v_phone_status = 'valid' and v_patient_phone_e164 is null then
		raise exception 'PHONE_COMMUNICATION_STATUS_MISMATCH';
	end if;
	if v_phone_status in ('missing', 'invalid') and not v_phone_acknowledged then
		raise exception 'PHONE_WARNING_ACKNOWLEDGEMENT_REQUIRED';
	end if;
	if v_phone_status in ('unknown', 'valid') and v_phone_acknowledged then
		raise exception 'PHONE_WARNING_ACKNOWLEDGEMENT_UNEXPECTED';
	end if;
	if v_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
		raise exception 'APPOINTMENT_IDEMPOTENCY_KEY_INVALID';
	end if;

	select array_agg(team.professional_id order by team.ordinality)
	into v_professional_ids
	from unnest(coalesce(p_professional_ids, array[]::uuid[])) with ordinality
		as team(professional_id, ordinality)
	where team.professional_id is not null;

	if coalesce(array_length(v_professional_ids, 1), 0) = 0 then
		raise exception 'PROFESSIONAL_NOT_FOUND';
	end if;
	if (
		select count(distinct professional_id)
		from unnest(v_professional_ids) professional_id
	) <> array_length(v_professional_ids, 1) then
		raise exception 'JOINT_APPOINTMENT_DUPLICATE_PROFESSIONAL';
	end if;

	if v_patient_mode = 'existing' then
		if p_patient_id is null then
			raise exception 'PATIENT_ID_REQUIRED';
		end if;
		if v_patient_name <> '' or v_patient_email is not null then
			raise exception 'PATIENT_EXISTING_FIELDS_UNEXPECTED';
		end if;
	else
		if p_patient_id is not null then
			raise exception 'PATIENT_ID_UNEXPECTED';
		end if;
		if v_patient_name = '' then
			raise exception 'PATIENT_NAME_REQUIRED';
		end if;
		if coalesce(p_update_existing_phone, false) then
			raise exception 'PATIENT_PHONE_UPDATE_MODE_INVALID';
		end if;
	end if;
	if v_patient_mode = 'public' and v_patient_phone_e164 is null then
		raise exception 'PUBLIC_PATIENT_PHONE_INVALID';
	end if;

	v_request_fingerprint := encode(
		digest(
			jsonb_build_object(
				'patient_mode', v_patient_mode,
				'patient_id', p_patient_id,
				'patient_name', nullif(v_patient_name, ''),
				'patient_phone_raw', v_patient_phone_raw,
				'patient_phone_e164', v_patient_phone_e164,
				'patient_email', v_patient_email,
				'update_existing_phone', coalesce(p_update_existing_phone, false),
				'owner_id', p_owner_id,
				'service_id', p_service_id,
				'professional_ids', to_jsonb(v_professional_ids),
				'starts_at', p_starts_at,
				'internal_note', nullif(trim(coalesce(p_internal_note, '')), ''),
				'created_by_user_id', p_created_by_user_id,
				'ignore_break', coalesce(p_ignore_break, false),
				'source', v_source,
				'phone_status', v_phone_status,
				'phone_acknowledged', v_phone_acknowledged
			)::text,
			'sha256'
		),
		'hex'
	);

	perform pg_advisory_xact_lock(
		hashtextextended(
			'appointment-create:' || p_business_id::text || ':' || v_idempotency_key,
			0
		)
	);

	select appointment.*
	into v_existing_request
	from public.appointments appointment
	where appointment.business_id = p_business_id
		and appointment.creation_request_key = v_idempotency_key;

	if found then
		if v_existing_request.creation_request_fingerprint is distinct from v_request_fingerprint then
			raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT';
		end if;
		return query
		select
			v_existing_request.id,
			v_existing_request.patient_id,
			v_existing_request.confirmation_token,
			v_existing_request.starts_at,
			v_existing_request.ends_at,
			v_existing_request.service_name_snapshot,
			v_existing_request.professional_name_snapshot,
			false,
			true,
			v_existing_request.patient_resolution_strategy;
		return;
	end if;
	if v_replay_only then
		-- Zero rows means this key has not created an appointment. This read-only
		-- branch deliberately runs before mutable policy and availability checks so
		-- a retry can recover an already committed fourth booking or occupied slot.
		return;
	end if;

	if p_owner_id is not null and not exists (
		select 1
		from public.business_users business_user
		where business_user.business_id = p_business_id
			and business_user.user_id = p_owner_id
			and business_user.status = 'active'
			and business_user.disabled_at is null
	) then
		raise exception 'PATIENT_OWNER_INVALID';
	end if;
	if p_created_by_user_id is not null and not exists (
		select 1
		from public.business_users business_user
		where business_user.business_id = p_business_id
			and business_user.user_id = p_created_by_user_id
			and business_user.status = 'active'
			and business_user.disabled_at is null
	) then
		raise exception 'APPOINTMENT_CREATOR_INVALID';
	end if;

	-- Validate the complete service/team contract before resolving or creating a
	-- patient. Public callers additionally require every selected resource to be
	-- visible in public booking at commit time, closing the race with settings.
	select service.duration_minutes
	into v_service
	from public.services service
	where service.business_id = p_business_id
		and service.id = p_service_id
		and service.is_active = true
		and (v_source <> 'public_booking' or service.is_public = true);
	if not found then
		raise exception 'SERVICE_NOT_FOUND';
	end if;
	if exists (
		select 1
		from unnest(v_professional_ids) selected(professional_id)
		left join public.professionals professional
			on professional.business_id = p_business_id
			and professional.id = selected.professional_id
			and professional.is_active = true
			and (v_source <> 'public_booking' or professional.is_public = true)
		left join public.professional_services assignment
			on assignment.business_id = p_business_id
			and assignment.professional_id = selected.professional_id
			and assignment.service_id = p_service_id
		where professional.id is null or assignment.professional_id is null
	) then
		raise exception 'PROFESSIONAL_SERVICE_NOT_ASSIGNED';
	end if;

	if v_patient_mode = 'existing' then
		select patient.id, patient.full_name, patient.phone_e164, patient.blocked, patient.archived_at
		into v_patient
		from public.patients patient
		where patient.business_id = p_business_id
			and patient.id = p_patient_id
		for update;
		if not found then
			raise exception 'PATIENT_NOT_FOUND';
		end if;
		if v_patient.archived_at is not null then
			raise exception 'PATIENT_ARCHIVED';
		end if;
		if v_patient.blocked then
			raise exception 'PATIENT_BLOCKED';
		end if;

		v_resolved_patient_id := v_patient.id;
		v_resolution_strategy := 'existing_id';
		if coalesce(p_update_existing_phone, false) then
			update public.patients patient
			set
				phone = coalesce(
					regexp_replace(v_patient_phone_e164, '\D', '', 'g'),
					v_patient_phone_raw
				),
				phone_raw = v_patient_phone_raw,
				phone_e164 = v_patient_phone_e164,
				updated_at = statement_timestamp()
			where patient.business_id = p_business_id
				and patient.id = v_resolved_patient_id;
		end if;
	elsif v_patient_mode = 'new' then
		if v_owner_id is null then
			select business_user.user_id
			into v_owner_id
			from public.business_users business_user
			where business_user.business_id = p_business_id
				and business_user.role = 'owner'
				and business_user.status = 'active'
				and business_user.disabled_at is null
			order by business_user.created_at asc, business_user.user_id asc
			limit 1;
		end if;
		if v_owner_id is null then
			raise exception 'PATIENT_OWNER_REQUIRED';
		end if;

		insert into public.patients (
			owner_id,
			business_id,
			full_name,
			phone,
			phone_raw,
			phone_e164,
			email
		)
		values (
			v_owner_id,
			p_business_id,
			v_patient_name,
			coalesce(regexp_replace(v_patient_phone_e164, '\D', '', 'g'), v_patient_phone_raw),
			v_patient_phone_raw,
			v_patient_phone_e164,
			v_patient_email
		)
		returning patients.id into v_resolved_patient_id;
		v_resolution_strategy := 'new_explicit';
		v_patient_created := true;
	else
		perform pg_advisory_xact_lock(
			hashtextextended(
				'patient-contact-resolution:' || p_business_id::text || ':' ||
				private.public_booking_contact_bucket(v_patient_name, v_patient_phone_e164),
				0
			)
		);

		select count(*)::integer
		into v_exact_match_count
		from public.patients patient
		where patient.business_id = p_business_id
			and patient.archived_at is null
			and patient.phone_e164 = v_patient_phone_e164
			and public.normalized_patient_name(patient.full_name)
				= public.normalized_patient_name(v_patient_name);

		if v_exact_match_count = 1 then
			select patient.id
			into v_exact_match_id
			from public.patients patient
			where patient.business_id = p_business_id
				and patient.archived_at is null
				and patient.phone_e164 = v_patient_phone_e164
				and public.normalized_patient_name(patient.full_name)
					= public.normalized_patient_name(v_patient_name)
			limit 1;

			select patient.id, patient.full_name, patient.phone_e164, patient.blocked, patient.archived_at
			into v_patient
			from public.patients patient
			where patient.business_id = p_business_id
				and patient.id = v_exact_match_id;
			-- Contact changes use the same advisory lock. Avoid taking a row lock
			-- here after that advisory lock: patient updates acquire their row lock
			-- first, and the inverse order could otherwise deadlock. A concurrent
			-- change is therefore serialized before or after this booking.
			if v_patient.blocked then
				raise exception 'PATIENT_BLOCKED';
			end if;
			v_resolved_patient_id := v_patient.id;
			v_resolution_strategy := 'public_exact_match';
		else
			if v_owner_id is null then
				select business_user.user_id
				into v_owner_id
				from public.business_users business_user
				where business_user.business_id = p_business_id
					and business_user.role = 'owner'
					and business_user.status = 'active'
					and business_user.disabled_at is null
				order by business_user.created_at asc, business_user.user_id asc
				limit 1;
			end if;
			if v_owner_id is null then
				raise exception 'PATIENT_OWNER_REQUIRED';
			end if;

			insert into public.patients (
				owner_id,
				business_id,
				full_name,
				phone,
				phone_raw,
				phone_e164,
				email
			)
			values (
				v_owner_id,
				p_business_id,
				v_patient_name,
				regexp_replace(v_patient_phone_e164, '\D', '', 'g'),
				v_patient_phone_raw,
				v_patient_phone_e164,
				v_patient_email
			)
			returning patients.id into v_resolved_patient_id;
			v_resolution_strategy := case
				when v_exact_match_count = 0 then 'public_new'
				else 'public_ambiguous_new'
			end;
			v_patient_created := true;
		end if;
	end if;

	select
		patient.full_name,
		coalesce(
			nullif(trim(patient.phone_raw), ''),
			nullif(trim(patient.phone), ''),
			patient.phone_e164
		) as phone_raw,
		patient.phone_e164,
		patient.blocked,
		patient.archived_at
	into v_patient
	from public.patients patient
	where patient.business_id = p_business_id
		and patient.id = v_resolved_patient_id;
	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
	if v_patient.archived_at is not null then
		raise exception 'PATIENT_ARCHIVED';
	end if;
	if v_patient.blocked then
		raise exception 'PATIENT_BLOCKED';
	end if;
	v_resolved_patient_name := v_patient.full_name;
	v_resolved_patient_phone_raw := coalesce(v_patient_phone_raw, v_patient.phone_raw);
	v_resolved_patient_phone_e164 := v_patient.phone_e164;

	if array_length(v_professional_ids, 1) = 1 then
		perform set_config('cita_suite.appointment_identity_write', 'create', true);
		insert into public.appointments (
			business_id,
			patient_id,
			service_id,
			professional_id,
			starts_at,
			ends_at,
			blocking_starts_at,
			blocking_ends_at,
			status,
			source,
			reminder_due_at,
			internal_note,
			ignore_break,
			created_by_user_id,
			updated_by_user_id,
			service_name_snapshot,
			professional_name_snapshot,
			duration_minutes_snapshot,
			phone_communication_status_at_booking,
			phone_warning_acknowledged_at,
			patient_name_at_booking,
			patient_phone_raw_at_booking,
			patient_phone_e164_at_booking,
			patient_resolution_strategy,
			creation_request_key,
			creation_request_fingerprint
		)
		values (
			p_business_id,
			v_resolved_patient_id,
			p_service_id,
			v_professional_ids[1],
			p_starts_at,
			p_starts_at + make_interval(mins => v_service.duration_minutes),
			p_starts_at,
			p_starts_at + make_interval(mins => v_service.duration_minutes),
			'reserved',
			v_source,
			null,
			nullif(trim(coalesce(p_internal_note, '')), ''),
			coalesce(p_ignore_break, false),
			p_created_by_user_id,
			p_created_by_user_id,
			'Pendiente',
			'Pendiente',
			v_service.duration_minutes,
			v_phone_status,
			case when v_phone_acknowledged then statement_timestamp() else null end,
			v_resolved_patient_name,
			v_resolved_patient_phone_raw,
			v_resolved_patient_phone_e164,
			v_resolution_strategy,
			v_idempotency_key,
			v_request_fingerprint
		)
		returning * into v_appointment;
		perform set_config('cita_suite.appointment_identity_write', '', true);

		insert into public.audit_logs (
			business_id,
			user_id,
			action,
			entity_type,
			entity_id,
			metadata
		)
		values (
			p_business_id,
			p_created_by_user_id,
			case when v_source = 'public_booking' then 'appointment.public_created' else 'appointment.created' end,
			'appointment',
			v_appointment.id,
			jsonb_build_object(
				'source', v_source,
				'patient_id', v_resolved_patient_id,
				'patient_created', v_patient_created,
				'patient_resolution_strategy', v_resolution_strategy,
				'patient_name_at_booking', v_resolved_patient_name,
				'patient_phone_raw_at_booking', v_resolved_patient_phone_raw,
				'patient_phone_e164_at_booking', v_resolved_patient_phone_e164,
				'service_id', p_service_id,
				'professional_ids', to_jsonb(v_professional_ids),
				'starts_at', p_starts_at,
				'is_joint', false,
				'ignore_break', coalesce(p_ignore_break, false),
				'phone_communication_status_at_booking', v_phone_status,
				'phone_warning_acknowledged', v_phone_acknowledged,
				'creation_request_key', v_idempotency_key
			)
		);
	else
		select created.*
		into v_created
		from public.create_joint_appointment_with_phone_decision(
			p_business_id,
			v_resolved_patient_id,
			p_service_id,
			v_professional_ids,
			p_starts_at,
			p_internal_note,
			p_created_by_user_id,
			coalesce(p_ignore_break, false),
			v_source,
			v_phone_status,
			v_phone_acknowledged
		) created;
		if v_created.id is null then
			raise exception 'JOINT_APPOINTMENT_NOT_CREATED';
		end if;

		perform set_config('cita_suite.appointment_identity_write', 'create', true);
		update public.appointments appointment
		set
			patient_name_at_booking = v_resolved_patient_name,
			patient_phone_raw_at_booking = v_resolved_patient_phone_raw,
			patient_phone_e164_at_booking = v_resolved_patient_phone_e164,
			patient_resolution_strategy = v_resolution_strategy,
			creation_request_key = v_idempotency_key,
			creation_request_fingerprint = v_request_fingerprint
		where appointment.business_id = p_business_id
			and appointment.id = v_created.id
		returning * into v_appointment;
		perform set_config('cita_suite.appointment_identity_write', '', true);

		update public.audit_logs audit
		set metadata = coalesce(audit.metadata, '{}'::jsonb) || jsonb_build_object(
			'patient_created', v_patient_created,
			'patient_resolution_strategy', v_resolution_strategy,
			'patient_name_at_booking', v_resolved_patient_name,
			'patient_phone_raw_at_booking', v_resolved_patient_phone_raw,
			'patient_phone_e164_at_booking', v_resolved_patient_phone_e164,
			'creation_request_key', v_idempotency_key
		)
		where audit.business_id = p_business_id
			and audit.entity_type = 'appointment'
			and audit.entity_id = v_created.id
			and audit.action in ('appointment.created', 'appointment.public_created');
	end if;

	return query
	select
		v_appointment.id,
		v_appointment.patient_id,
		v_appointment.confirmation_token,
		v_appointment.starts_at,
		v_appointment.ends_at,
		v_appointment.service_name_snapshot,
		v_appointment.professional_name_snapshot,
		v_patient_created,
		false,
		v_resolution_strategy;
end;
$$;

revoke execute on function public.get_public_booking_active_future_count_for_request(
	uuid, uuid, text, text, timestamptz
)
	from public, anon, authenticated;
grant execute on function public.get_public_booking_active_future_count_for_request(
	uuid, uuid, text, text, timestamptz
)
	to service_role;

revoke execute on function public.enforce_public_booking_future_appointment_limit()
	from public, anon, authenticated;

revoke execute on function public.create_appointment_with_patient_identity(
	uuid, text, uuid, text, text, text, text, boolean, uuid, uuid, uuid[], timestamptz,
	text, uuid, boolean, text, text, boolean, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_appointment_with_patient_identity(
	uuid, text, uuid, text, text, text, text, boolean, uuid, uuid, uuid[], timestamptz,
	text, uuid, boolean, text, text, boolean, text, boolean
) to service_role;

-- This unversioned, service-role-only legacy routine existed in the remote
-- database and resolved patients by phone. Drop every overload so it cannot be
-- accidentally revived by a future caller.
do $$
declare
	v_routine record;
begin
	for v_routine in
		select procedure.oid::regprocedure as identity, procedure.prokind
		from pg_proc procedure
		join pg_namespace namespace on namespace.oid = procedure.pronamespace
		where namespace.nspname = 'public'
			and procedure.proname = 'reserve_public_booking_hold_safely'
	loop
		execute format(
			'drop %s %s',
			case when v_routine.prokind = 'p' then 'procedure' else 'function' end,
			v_routine.identity
		);
	end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
