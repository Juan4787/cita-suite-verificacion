-- Persiste la decisión de comunicación tomada antes de crear un turno manual.
begin;

alter table public.appointments
	add column if not exists phone_communication_status_at_booking text not null default 'unknown',
	add column if not exists phone_warning_acknowledged_at timestamptz;

alter table public.appointments
	drop constraint if exists appointments_phone_communication_status_at_booking_check;

alter table public.appointments
	add constraint appointments_phone_communication_status_at_booking_check
	check (phone_communication_status_at_booking in ('unknown', 'valid', 'missing', 'invalid'));

create or replace function public.create_joint_appointment_with_phone_decision(
	p_business_id uuid,
	p_patient_id uuid,
	p_service_id uuid,
	p_professional_ids uuid[],
	p_starts_at timestamptz,
	p_internal_note text,
	p_created_by_user_id uuid,
	p_ignore_break boolean,
	p_source text,
	p_phone_communication_status text,
	p_phone_warning_acknowledged boolean
)
returns table (
	id uuid,
	confirmation_token text,
	starts_at timestamptz,
	ends_at timestamptz,
	service_name_snapshot text,
	professional_name_snapshot text
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_created record;
	v_status text := lower(trim(coalesce(p_phone_communication_status, '')));
	v_acknowledged boolean := coalesce(p_phone_warning_acknowledged, false);
begin
	if v_status not in ('unknown', 'valid', 'missing', 'invalid') then
		raise exception 'PHONE_COMMUNICATION_STATUS_INVALID';
	end if;
	if v_status in ('missing', 'invalid') and not v_acknowledged then
		raise exception 'PHONE_WARNING_ACKNOWLEDGEMENT_REQUIRED';
	end if;
	if v_status in ('unknown', 'valid') and v_acknowledged then
		raise exception 'PHONE_WARNING_ACKNOWLEDGEMENT_UNEXPECTED';
	end if;

	select created.*
	into v_created
	from public.create_joint_appointment_with_source(
		p_business_id,
		p_patient_id,
		p_service_id,
		p_professional_ids,
		p_starts_at,
		p_internal_note,
		p_created_by_user_id,
		p_ignore_break,
		p_source
	) created;

	if v_created.id is null then
		raise exception 'JOINT_APPOINTMENT_NOT_CREATED';
	end if;

	update public.appointments appointment
	set
		phone_communication_status_at_booking = v_status,
		phone_warning_acknowledged_at = case when v_acknowledged then statement_timestamp() else null end
	where appointment.business_id = p_business_id
		and appointment.id = v_created.id;

	update public.audit_logs audit
	set metadata = coalesce(audit.metadata, '{}'::jsonb) || jsonb_build_object(
		'phone_communication_status_at_booking', v_status,
		'phone_warning_acknowledged', v_acknowledged
	)
	where audit.business_id = p_business_id
		and audit.entity_type = 'appointment'
		and audit.entity_id = v_created.id
		and audit.action in ('appointment.created', 'appointment.public_created');

	return query
	select
		appointment.id,
		appointment.confirmation_token,
		appointment.starts_at,
		appointment.ends_at,
		appointment.service_name_snapshot,
		appointment.professional_name_snapshot
	from public.appointments appointment
	where appointment.business_id = p_business_id
		and appointment.id = v_created.id;
end;
$$;

revoke execute on function public.create_joint_appointment_with_phone_decision(
	uuid, uuid, uuid, uuid[], timestamptz, text, uuid, boolean, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_joint_appointment_with_phone_decision(
	uuid, uuid, uuid, uuid[], timestamptz, text, uuid, boolean, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
