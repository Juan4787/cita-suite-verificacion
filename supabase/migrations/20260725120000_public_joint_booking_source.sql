-- Permite crear turnos conjuntos desde el enlace público sin duplicar el
-- turno, las notificaciones ni el cupo público.
--
-- Se conserva create_joint_appointment(...) para compatibilidad con cualquier
-- versión anterior del frontend. El wrapper nuevo agrega el origen explícito y
-- sigue ejecutando toda la ocupación del equipo dentro de una sola transacción.

create or replace function public.create_joint_appointment_with_source(
	p_business_id uuid,
	p_patient_id uuid,
	p_service_id uuid,
	p_professional_ids uuid[],
	p_starts_at timestamptz,
	p_internal_note text,
	p_created_by_user_id uuid,
	p_ignore_break boolean,
	p_source text
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
begin
	if p_source not in ('manual', 'public_booking', 'whatsapp_bot', 'admin') then
		raise exception 'JOINT_APPOINTMENT_SOURCE_INVALID';
	end if;

	select created.*
	into v_created
	from public.create_joint_appointment(
		p_business_id,
		p_patient_id,
		p_service_id,
		p_professional_ids,
		p_starts_at,
		p_internal_note,
		p_created_by_user_id,
		p_ignore_break
	) created;

	if v_created.id is null then
		raise exception 'JOINT_APPOINTMENT_NOT_CREATED';
	end if;

	if p_source <> 'manual' then
		-- Este UPDATE ocurre en la misma transacción que el INSERT original. Para
		-- el origen público, el trigger de cupo se ejecuta aquí y mantiene la
		-- protección concurrente de cuatro turnos sobre una sola fila.
		update public.appointments appointment
		set source = p_source
		where appointment.business_id = p_business_id
			and appointment.id = v_created.id;

		update public.audit_logs audit
		set
			action = case
				when p_source = 'public_booking' then 'appointment.public_created'
				else audit.action
			end,
			metadata = jsonb_set(
				coalesce(audit.metadata, '{}'::jsonb),
				'{source}',
				to_jsonb(p_source),
				true
			)
		where audit.business_id = p_business_id
			and audit.entity_type = 'appointment'
			and audit.entity_id = v_created.id
			and audit.action = 'appointment.created';
	end if;

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

revoke execute on function public.create_joint_appointment_with_source(
	uuid, uuid, uuid, uuid[], timestamptz, text, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.create_joint_appointment_with_source(
	uuid, uuid, uuid, uuid[], timestamptz, text, uuid, boolean, text
) to service_role;

notify pgrst, 'reload schema';
