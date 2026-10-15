-- Snapshot compacto para el asistente interno de agenda.
-- No contiene pacientes ni datos clínicos: sólo reglas y rangos necesarios
-- para calcular disponibilidad en el navegador y revalidarla en el servidor.

create or replace function public.get_availability_snapshot(
	p_business_id uuid,
	p_from timestamptz,
	p_to timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if p_business_id is null
		or p_from is null
		or p_to is null
		or p_to <= p_from
		or p_to > p_from + interval '31 days'
	then
		raise exception using
			errcode = '22023',
			message = 'invalid availability snapshot range';
	end if;

	if coalesce(auth.role(), '') <> 'service_role'
		and not public.user_has_business_access(p_business_id)
	then
		raise exception using
			errcode = '42501',
			message = 'insufficient business access';
	end if;

	return jsonb_build_object(
		'generated_at', now(),
		'services', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', service.id,
					'business_id', service.business_id,
					'name', service.name,
					'duration_minutes', service.duration_minutes,
					'buffer_before_minutes', service.buffer_before_minutes,
					'buffer_after_minutes', service.buffer_after_minutes,
					'is_public', service.is_public,
					'is_active', service.is_active,
					'sort_order', service.sort_order
				)
				order by service.sort_order, service.name, service.id
			)
			from public.services service
			where service.business_id = p_business_id
				and service.is_active
		), '[]'::jsonb),
		'professionals', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', professional.id,
					'name', professional.name,
					'specialty', professional.specialty,
					'is_public', professional.is_public,
					'is_active', professional.is_active,
					'sort_order', professional.sort_order
				)
				order by professional.sort_order, professional.name, professional.id
			)
			from public.professionals professional
			where professional.business_id = p_business_id
				and professional.is_active
		), '[]'::jsonb),
		'assignments', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'service_id', assignment.service_id,
					'professional_id', assignment.professional_id
				)
				order by assignment.service_id, assignment.professional_id
			)
			from public.professional_services assignment
			join public.services service
				on service.business_id = assignment.business_id
				and service.id = assignment.service_id
				and service.is_active
			join public.professionals professional
				on professional.business_id = assignment.business_id
				and professional.id = assignment.professional_id
				and professional.is_active
			where assignment.business_id = p_business_id
		), '[]'::jsonb),
		'rules', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', rule.id,
					'professional_id', rule.professional_id,
					'weekday', rule.weekday,
					'start_time', rule.start_time,
					'end_time', rule.end_time,
					'slot_interval_minutes', rule.slot_interval_minutes,
					'break_minutes', rule.break_minutes,
					'is_active', rule.is_active
				)
				order by rule.professional_id, rule.weekday, rule.start_time, rule.id
			)
			from public.availability_rules rule
			join public.professionals professional
				on professional.business_id = rule.business_id
				and professional.id = rule.professional_id
				and professional.is_active
			where rule.business_id = p_business_id
				and rule.is_active
		), '[]'::jsonb),
		'exceptions', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', exception.id,
					'professional_id', exception.professional_id,
					'starts_at', exception.starts_at,
					'ends_at', exception.ends_at,
					'type', exception.type
				)
				order by exception.starts_at, exception.id
			)
			from public.availability_exceptions exception
			where exception.business_id = p_business_id
				and exception.starts_at < p_to
				and exception.ends_at > p_from
		), '[]'::jsonb),
		'blocks', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', allocation.id,
					'professional_id', allocation.professional_id,
					'base_blocking_starts_at', allocation.base_blocking_starts_at,
					'base_blocking_ends_at', allocation.base_blocking_ends_at,
					'blocking_starts_at', allocation.blocking_starts_at,
					'blocking_ends_at', allocation.blocking_ends_at
				)
				order by allocation.professional_id, allocation.starts_at, allocation.id
			)
			from public.appointment_professionals allocation
			where allocation.business_id = p_business_id
				and allocation.status in ('reserved', 'confirmed', 'reschedule_requested')
				and allocation.blocking_starts_at < p_to
				and allocation.blocking_ends_at > p_from
		), '[]'::jsonb)
	);
end;
$$;

revoke execute on function public.get_availability_snapshot(uuid, timestamptz, timestamptz)
	from public, anon;
grant execute on function public.get_availability_snapshot(uuid, timestamptz, timestamptz)
	to authenticated, service_role;

comment on function public.get_availability_snapshot(uuid, timestamptz, timestamptz) is
	'Snapshot interno, compacto y sin datos de pacientes para calcular disponibilidad. Respeta RLS mediante security invoker.';
