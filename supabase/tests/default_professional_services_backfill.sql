-- Run after the migration. Read-only assertion.
select extensions.plan(1);

do $$
declare
	v_missing integer;
begin
	select count(*)::integer
	into v_missing
	from public.professionals professional
	join public.services service
		on service.business_id = professional.business_id
		and lower(trim(service.name)) in ('consulta', 'otro servicio')
	left join public.professional_services assignment
		on assignment.business_id = professional.business_id
		and assignment.professional_id = professional.id
		and assignment.service_id = service.id
	where assignment.service_id is null;

	if v_missing <> 0 then
		raise exception 'TEST_MISSING_DEFAULT_PROFESSIONAL_SERVICES_%', v_missing;
	end if;
	raise notice 'PASS: every professional has every existing default service assigned.';
end;
$$;

select extensions.pass('default professional services backfill');
select * from extensions.finish();
