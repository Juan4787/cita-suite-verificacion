-- La reconstrucción limpia no debe perder la defensa que limita las
-- mutaciones directas de appointments según el rol. Las rutas productivas
-- escriben mediante el backend; este trigger queda como segunda barrera para
-- cualquier cliente autenticado que intente usar PostgREST directamente.

create or replace function public.enforce_appointment_role_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_role text;
begin
	if auth.uid() is null then
		return new;
	end if;

	v_role := public.user_business_role(new.business_id);

	if v_role in ('owner', 'admin') and public.business_allows_operation(new.business_id) then
		return new;
	end if;

	if v_role = 'reception' and public.business_allows_operation(new.business_id) then
		if new.status in ('attended', 'no_show') and new.status is distinct from old.status then
			perform public.audit_security_event(
				new.business_id,
				auth.uid(),
				'appointment.status_update',
				'appointment',
				new.id,
				'blocked',
				'CAPABILITY_DENIED',
				jsonb_build_object('target_status', new.status)
			);
			raise exception 'APPOINTMENT_ATTENDANCE_DENIED';
		end if;
		return new;
	end if;

	if v_role = 'professional'
		and public.business_allows_operation(new.business_id)
		and new.status in ('attended', 'no_show')
		and exists (
			select 1
			from public.professional_users pu
			where pu.business_id = new.business_id
				and pu.professional_id = new.professional_id
				and pu.user_id = auth.uid()
		)
	then
		return new;
	end if;

	perform public.audit_security_event(
		new.business_id,
		auth.uid(),
		'appointment.update',
		'appointment',
		new.id,
		'blocked',
		'SERVICE_ROLE_ACTION_DENIED',
		'{}'::jsonb
	);
	raise exception 'APPOINTMENT_ACCESS_DENIED';
end;
$$;

drop trigger if exists trg_appointments_role_update on public.appointments;
create trigger trg_appointments_role_update
	before update
	on public.appointments
	for each row
	execute function public.enforce_appointment_role_update();

revoke all on function public.enforce_appointment_role_update() from public, anon, authenticated;
grant execute on function public.enforce_appointment_role_update() to service_role;

notify pgrst, 'reload schema';
