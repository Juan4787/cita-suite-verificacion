begin;

-- Precarga privada y acotada para que el buscador de Agenda pueda filtrar en
-- memoria mientras la busqueda autoritativa termina. No se persiste en el
-- navegador y no se muestra nada hasta que el usuario escribe.
create or replace function public.list_upcoming_active_appointments_snapshot(
	p_business_id uuid,
	p_limit integer default 400
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_limit integer := least(greatest(coalesce(p_limit, 400), 1), 400);
	v_results jsonb;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if p_business_id is null or not public.user_has_business_access(p_business_id) then
		raise exception 'AGENDA_SEARCH_DENIED';
	end if;

	v_role := public.user_business_role(p_business_id);
	if coalesce(v_role, '') not in ('owner', 'admin', 'reception', 'readonly') then
		raise exception 'AGENDA_SEARCH_DENIED';
	end if;

	if not public.business_allows_operation(p_business_id) then
		return '[]'::jsonb;
	end if;

	select coalesce(
		jsonb_agg(candidate.payload order by candidate.starts_at, candidate.id),
		'[]'::jsonb
	)
	into v_results
	from (
		select
			appointment.id,
			appointment.starts_at,
			jsonb_build_object(
				'id', appointment.id,
				'patient_id', appointment.patient_id,
				'service_id', appointment.service_id,
				'professional_id', appointment.professional_id,
				'starts_at', appointment.starts_at,
				'ends_at', appointment.ends_at,
				'status', appointment.status,
				'source', appointment.source,
				'service_name_snapshot', appointment.service_name_snapshot,
				'professional_name_snapshot', appointment.professional_name_snapshot,
				'patients', jsonb_build_object(
					'full_name', patient.full_name,
					'phone_e164', patient.phone_e164
				)
			) as payload
		from public.appointments appointment
		join public.patients patient
			on patient.business_id = appointment.business_id
			and patient.id = appointment.patient_id
		where appointment.business_id = p_business_id
			and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
			and appointment.starts_at >= statement_timestamp()
		order by appointment.starts_at asc, appointment.id asc
		limit v_limit
	) candidate;

	return v_results;
end;
$$;

revoke all on function public.list_upcoming_active_appointments_snapshot(uuid, integer)
	from public, anon;
grant execute on function public.list_upcoming_active_appointments_snapshot(uuid, integer)
	to authenticated;

notify pgrst, 'reload schema';

commit;
