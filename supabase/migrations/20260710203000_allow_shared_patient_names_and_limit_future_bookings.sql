-- Public booking identity and capacity hardening.
--
-- A name is descriptive data, never a unique identity: two different people
-- may legitimately have the same first name or even the same full name. Public
-- booking identifies an existing patient by normalized phone; DNI remains the
-- only duplicate-sensitive document field.
--
-- The application performs an early 4/4 check for friendly feedback. This
-- trigger is the concurrency-safe backstop: the advisory transaction lock and
-- count happen in the same transaction as the appointment INSERT/UPDATE, so
-- two simultaneous requests cannot both create a fifth future active booking.

create or replace function public.prevent_duplicate_patient_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_name text := public.normalized_patient_name(new.full_name);
	v_dni text := nullif(trim(coalesce(new.dni, '')), '');
begin
	if v_name is null then
		raise exception 'PATIENT_NAME_REQUIRED';
	end if;

	new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
	new.dni := v_dni;

	if v_dni is not null then
		perform pg_advisory_xact_lock(
			hashtextextended('patients:dni:' || new.business_id::text || ':' || v_dni, 0)
		);
	end if;

	if v_dni is not null and exists (
		select 1
		from patients p
		where p.business_id = new.business_id
			and p.id is distinct from new.id
			and nullif(trim(coalesce(p.dni, '')), '') = v_dni
	) then
		raise exception 'PATIENT_DNI_ALREADY_EXISTS';
	end if;

	return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_patient_identity on public.patients;
create trigger trg_prevent_duplicate_patient_identity
	before insert or update of business_id, full_name, dni
	on public.patients
	for each row
	execute function public.prevent_duplicate_patient_identity();

create index if not exists appointments_patient_active_starts_idx
	on public.appointments (business_id, patient_id, starts_at)
	where status in ('reserved', 'confirmed', 'reschedule_requested');

create or replace function public.enforce_public_booking_future_appointment_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_active_future_count integer;
begin
	if new.source <> 'public_booking'
		or new.status not in ('reserved', 'confirmed', 'reschedule_requested')
		or new.starts_at <= v_now
	then
		return new;
	end if;

	perform pg_advisory_xact_lock(
		hashtextextended(
			'public-booking-limit:' || new.business_id::text || ':' || new.patient_id::text,
			0
		)
	);

	select count(*)::integer
	into v_active_future_count
	from public.appointments a
	where a.business_id = new.business_id
		and a.patient_id = new.patient_id
		and a.id is distinct from new.id
		and a.status in ('reserved', 'confirmed', 'reschedule_requested')
		and a.starts_at > v_now;

	if v_active_future_count >= 4 then
		raise exception using
			errcode = 'P0001',
			message = 'PUBLIC_BOOKING_ACTIVE_LIMIT',
			detail = 'A public booking patient may have at most 4 active future appointments.';
	end if;

	return new;
end;
$$;

drop trigger if exists appointments_public_booking_future_limit on public.appointments;
create trigger appointments_public_booking_future_limit
	before insert or update of business_id, patient_id, status, starts_at, source
	on public.appointments
	for each row
	execute function public.enforce_public_booking_future_appointment_limit();

revoke execute on function public.prevent_duplicate_patient_identity() from public, anon, authenticated;
revoke execute on function public.enforce_public_booking_future_appointment_limit() from public, anon, authenticated;

notify pgrst, 'reload schema';
