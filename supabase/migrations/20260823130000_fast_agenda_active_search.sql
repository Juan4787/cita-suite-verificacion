begin;

-- La búsqueda parte de próximos turnos activos ya ordenados y recién entonces
-- valida el nombre o teléfono del paciente. Evita recorrer el padrón completo.
create index if not exists appointments_business_active_starts_patient_idx
	on public.appointments (business_id, starts_at, patient_id)
	where status in ('reserved', 'confirmed', 'reschedule_requested');

create or replace function public.search_upcoming_active_appointments(
	p_business_id uuid,
	p_query text,
	p_limit integer default 60
)
returns jsonb
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
	v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 60);
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

	-- Conserva la semántica de las políticas de lectura vigentes: una cuenta sin
	-- operación comercial habilitada no recibe turnos clínicos.
	if not public.business_allows_operation(p_business_id) or v_query = '' then
		return '[]'::jsonb;
	end if;

	v_query_like := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

	select coalesce(jsonb_agg(candidate.payload order by candidate.starts_at, candidate.id), '[]'::jsonb)
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
				'internal_note', appointment.internal_note,
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
			and (
				patient.search_name_normalized like v_query_like || '%' escape '\'
				or (
					position(' ' in v_query) = 0
					and patient.search_name_normalized like '% ' || v_query_like || '%' escape '\'
				)
				or (
					length(v_digits) >= 2
					and patient.search_phone_digits like '%' || v_digits || '%'
				)
			)
		order by appointment.starts_at asc, appointment.id asc
		limit v_limit
	) candidate;

	return v_results;
end;
$$;

revoke all on function public.search_upcoming_active_appointments(uuid, text, integer)
	from public, anon;
grant execute on function public.search_upcoming_active_appointments(uuid, text, integer)
	to authenticated;

notify pgrst, 'reload schema';

commit;
