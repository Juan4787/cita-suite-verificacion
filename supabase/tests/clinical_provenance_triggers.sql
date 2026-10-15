-- Contrato de procedencia clínica en una reconstrucción limpia.
-- Verifica que un turno crea el vínculo profesional y que una consulta
-- autenticada conserva el actor y el vínculo sin permitir una mutación de
-- turno fuera del rol profesional.

begin;

select extensions.plan(1);

do $$
declare
	v_owner uuid := '81000000-0000-4000-8000-000000000001';
	v_professional_user uuid := '81000000-0000-4000-8000-000000000002';
	v_business uuid := '82000000-0000-4000-8000-000000000001';
	v_patient uuid := '83000000-0000-4000-8000-000000000001';
	v_professional uuid := '84000000-0000-4000-8000-000000000001';
	v_service uuid := '85000000-0000-4000-8000-000000000001';
	v_appointment uuid;
	v_entry uuid;
	v_result jsonb;
	v_error text;
	v_rows integer;
begin
	insert into auth.users (id, email)
	values
		(v_owner, 'provenance-owner@example.test'),
		(v_professional_user, 'provenance-professional@example.test');

	insert into public.businesses (id, name, slug, industry, timezone)
	values (v_business, 'Consultorio procedencia', 'provenance-' || gen_random_uuid(), 'odontology', 'UTC');
	update public.business_subscriptions
	set commercial_access_enabled = true, is_permanent = true, subscription_status = 'active',
		paid_until = null, grace_until = null, restricted_until = null, archived_at = null
	where business_id = v_business;

	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values
		(v_business, v_owner, 'owner', 'active', statement_timestamp()),
		(v_business, v_professional_user, 'professional', 'active', statement_timestamp());
	insert into public.professionals (id, business_id, name, is_active, is_public)
	values (v_professional, v_business, 'Profesional procedencia', true, true);
	insert into public.professional_users (business_id, professional_id, user_id)
	values (v_business, v_professional, v_professional_user);
	insert into public.services (id, business_id, name, duration_minutes, is_active, is_public)
	values (v_service, v_business, 'Consulta procedencia', 30, true, true);
	insert into public.professional_services (business_id, professional_id, service_id)
	values (v_business, v_professional, v_service);
	insert into public.patients (id, owner_id, business_id, full_name)
	values (v_patient, v_owner, v_business, 'Paciente procedencia');

	perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
	select created.id
	into v_appointment
	from public.create_appointment_with_patient_identity(
		v_business, 'existing', v_patient, null, null, null, null, false, v_owner,
		v_service, array[v_professional], statement_timestamp() + interval '2 days',
		null, v_owner, false, 'manual', 'unknown', false,
		'81000000-0000-4000-8000-000000000001'
	) created;
	if v_appointment is null then raise exception 'TEST_APPOINTMENT_NOT_CREATED'; end if;
	if not exists (
		select 1 from public.professional_patient_links
		where business_id = v_business and professional_id = v_professional
			and patient_id = v_patient and is_active = true and source = 'appointment'
	) then
		raise exception 'TEST_APPOINTMENT_DID_NOT_CREATE_ACTIVE_LINK';
	end if;

	perform set_config(
		'request.jwt.claims',
		jsonb_build_object('sub', v_professional_user, 'role', 'authenticated')::text,
		true
	);
	set local role authenticated;
	select public.create_clinical_entry_with_result_safely(
		v_business, v_patient, 'Consulta', 'Entrada de procedencia', statement_timestamp(), null, null, null
	)
	into v_result;
	select (v_result ->> 'id')::uuid into v_entry;
	if v_entry is null then raise exception 'TEST_CLINICAL_ENTRY_NOT_CREATED'; end if;
	reset role;

	if not exists (
		select 1 from public.clinical_entries
		where id = v_entry and owner_id = v_professional_user
			and created_by_user_id = v_professional_user
			and created_by_professional_id = v_professional
	) then
		raise exception 'TEST_CLINICAL_ENTRY_ACTOR_NOT_NORMALIZED';
	end if;
	if not exists (
		select 1 from public.professional_patient_links
		where business_id = v_business and professional_id = v_professional
			and patient_id = v_patient and is_active = true and source = 'clinical_entry'
	) then
		raise exception 'TEST_CLINICAL_ENTRY_DID_NOT_REFRESH_LINK';
	end if;

	perform set_config(
		'request.jwt.claims',
		jsonb_build_object('sub', v_professional_user, 'role', 'authenticated')::text,
		true
	);
	set local role authenticated;
	begin
		update public.appointments set status = 'confirmed' where id = v_appointment;
		get diagnostics v_rows = row_count;
		if v_rows > 0 then
			raise exception 'TEST_PROFESSIONAL_DIRECT_APPOINTMENT_UPDATE_ALLOWED';
		end if;
	exception when others then
		v_error := sqlerrm;
		if v_error not in ('APPOINTMENT_ACCESS_DENIED', 'TEST_PROFESSIONAL_DIRECT_APPOINTMENT_UPDATE_ALLOWED') then
			raise exception 'TEST_WRONG_PROFESSIONAL_UPDATE_ERROR_%', v_error;
		end if;
		if v_error = 'TEST_PROFESSIONAL_DIRECT_APPOINTMENT_UPDATE_ALLOWED' then
			raise;
		end if;
	end;
	reset role;

	perform set_config('request.jwt.claims', '{}', true);
	if exists (select 1 from public.appointments where id = v_appointment and status <> 'reserved') then
		raise exception 'TEST_PROFESSIONAL_UPDATE_MUTATED_APPOINTMENT';
	end if;
end;
$$;

select extensions.pass('clinical provenance triggers, actor normalization and role guard');
select * from extensions.finish();

rollback;
