-- Appointment identity and diagnostic provenance cannot be rewritten through a
-- generic table update. Only the privileged atomic creator and audited repair
-- RPC open a transaction-local, narrowly scoped write path.

begin;

create or replace function private.protect_appointment_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_write_mode text := coalesce(
		current_setting('cita_suite.appointment_identity_write', true),
		''
	);
begin
	if new.patient_id is distinct from old.patient_id
		and v_write_mode <> 'repair'
	then
		raise exception 'APPOINTMENT_IDENTITY_FIELDS_IMMUTABLE';
	end if;

	if (
		new.patient_name_at_booking is distinct from old.patient_name_at_booking
		or new.patient_phone_raw_at_booking is distinct from old.patient_phone_raw_at_booking
		or new.patient_phone_e164_at_booking is distinct from old.patient_phone_e164_at_booking
		or new.patient_resolution_strategy is distinct from old.patient_resolution_strategy
		or new.public_booking_contact_key is distinct from old.public_booking_contact_key
	)
		and v_write_mode not in ('create', 'repair')
	then
		raise exception 'APPOINTMENT_IDENTITY_FIELDS_IMMUTABLE';
	end if;

	if (
		new.creation_request_key is distinct from old.creation_request_key
		or new.creation_request_fingerprint is distinct from old.creation_request_fingerprint
	)
		and v_write_mode <> 'create'
	then
		raise exception 'APPOINTMENT_CREATION_PROVENANCE_IMMUTABLE';
	end if;

	if new.confirmation_token is distinct from old.confirmation_token
		and v_write_mode <> 'repair'
	then
		raise exception 'APPOINTMENT_CONFIRMATION_TOKEN_IMMUTABLE';
	end if;

	return new;
end;
$$;

drop trigger if exists appointments_protect_identity_fields on public.appointments;
create trigger appointments_protect_identity_fields
	before update of
		patient_id,
		patient_name_at_booking,
		patient_phone_raw_at_booking,
		patient_phone_e164_at_booking,
		patient_resolution_strategy,
		public_booking_contact_key,
		creation_request_key,
		creation_request_fingerprint,
		confirmation_token
	on public.appointments
	for each row
	execute function private.protect_appointment_identity_fields();

revoke all on function private.protect_appointment_identity_fields()
	from public, anon, authenticated;

commit;
