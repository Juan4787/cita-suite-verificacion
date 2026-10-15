-- The public 4-active-future-bookings capacity is intentionally keyed by the
-- patient's normalized name, not by phone or patient row. Phone numbers are
-- mutable contact data: the same name must share one capacity even when public
-- bookings created separate patient rows with different numbers.

create or replace function public.get_public_booking_active_future_count_by_name(
	p_business_id uuid,
	p_patient_name text,
	p_now timestamptz default statement_timestamp()
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
	select count(*)::integer
	from public.appointments appointment
	join public.patients patient
		on patient.business_id = appointment.business_id
		and patient.id = appointment.patient_id
	where appointment.business_id = p_business_id
		and public.normalized_patient_name(patient.full_name)
			= public.normalized_patient_name(p_patient_name)
		and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
		and appointment.starts_at > p_now;
$$;

create or replace function public.enforce_public_booking_future_appointment_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_patient_name text;
	v_active_future_count integer;
begin
	if new.source <> 'public_booking'
		or new.status not in ('reserved', 'confirmed', 'reschedule_requested')
		or new.starts_at <= v_now
	then
		return new;
	end if;

	select public.normalized_patient_name(patient.full_name)
	into v_patient_name
	from public.patients patient
	where patient.business_id = new.business_id
		and patient.id = new.patient_id;

	if v_patient_name is null then
		raise exception 'PATIENT_NAME_REQUIRED';
	end if;

	-- Every patient row with the same normalized name takes the same
	-- transaction-level lock. This also serializes simultaneous bookings made
	-- with different phone numbers and different patient_ids.
	perform pg_advisory_xact_lock(
		hashtextextended(
			'public-booking-limit:name:' || new.business_id::text || ':' || v_patient_name,
			0
		)
	);

	select count(*)::integer
	into v_active_future_count
	from public.appointments appointment
	join public.patients patient
		on patient.business_id = appointment.business_id
		and patient.id = appointment.patient_id
	where appointment.business_id = new.business_id
		and public.normalized_patient_name(patient.full_name) = v_patient_name
		and appointment.id is distinct from new.id
		and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
		and appointment.starts_at > v_now;

	if v_active_future_count >= 4 then
		raise exception using
			errcode = 'P0001',
			message = 'PUBLIC_BOOKING_ACTIVE_LIMIT',
			detail = 'A normalized patient name may have at most 4 active future appointments.';
	end if;

	return new;
end;
$$;

revoke execute on function public.get_public_booking_active_future_count_by_name(uuid, text, timestamptz)
	from public, anon, authenticated;
grant execute on function public.get_public_booking_active_future_count_by_name(uuid, text, timestamptz)
	to service_role;

revoke execute on function public.enforce_public_booking_future_appointment_limit()
	from public, anon, authenticated;

notify pgrst, 'reload schema';
