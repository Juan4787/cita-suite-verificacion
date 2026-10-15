create or replace function public.user_can_read_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(public.user_business_role(target_business_id), '') in ('owner','admin','reception','readonly')
		or exists (
			select 1
			from appointments a
			where a.business_id = target_business_id
				and a.patient_id = target_patient_id
				and public.user_can_read_professional_schedule(a.business_id, a.professional_id)
		);
$$;

create or replace function public.professional_update_appointment_status(
	target_business_id uuid,
	target_appointment_id uuid,
	target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_appointment record;
	v_now timestamptz := now();
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if target_status not in ('attended','no_show') then
		raise exception 'INVALID_PROFESSIONAL_STATUS';
	end if;

	select id, professional_id, starts_at, ends_at, status
	into v_appointment
	from appointments
	where business_id = target_business_id
		and id = target_appointment_id
	for update;

	if not found then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	if not exists (
		select 1
		from professional_users pu
		where pu.business_id = target_business_id
			and pu.professional_id = v_appointment.professional_id
			and pu.user_id = auth.uid()
	) then
		raise exception 'APPOINTMENT_ACCESS_DENIED';
	end if;

	if v_appointment.status in ('cancelled','attended','no_show') then
		raise exception 'APPOINTMENT_TERMINAL_STATUS';
	end if;

	if target_status = 'attended' and v_appointment.starts_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_ATTEND_IN_FUTURE';
	end if;

	if target_status = 'no_show' and v_appointment.ends_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END';
	end if;

	update appointments
	set
		status = target_status,
		attended_at = case when target_status = 'attended' then v_now else attended_at end,
		no_show_at = case when target_status = 'no_show' then v_now else no_show_at end,
		updated_by_user_id = auth.uid(),
		updated_at = v_now
	where business_id = target_business_id
		and id = target_appointment_id;

	insert into audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id,
		auth.uid(),
		case when target_status = 'attended' then 'appointment.attended' else 'appointment.no_show' end,
		'appointment',
		target_appointment_id,
		jsonb_build_object('via', 'professional_panel', 'from_status', v_appointment.status)
	);
end;
$$;

grant execute on function public.user_can_read_patient(uuid, uuid) to authenticated;
grant execute on function public.professional_update_appointment_status(uuid, uuid, text) to authenticated;

do $$
begin
	if to_regclass('public.patients') is not null then
		drop policy if exists patients_business_member_select on patients;
		if not exists (
			select 1
			from pg_policies
			where schemaname = 'public'
				and tablename = 'patients'
				and policyname = 'patients_role_scoped_select'
		) then
			create policy patients_role_scoped_select
				on patients
				for select
				to authenticated
				using (
					business_id is not null
					and public.user_can_read_patient(business_id, id)
				);
		end if;
	end if;

	if to_regclass('public.clinical_entries') is not null then
		drop policy if exists clinical_entries_business_member_select on clinical_entries;
		if not exists (
			select 1
			from pg_policies
			where schemaname = 'public'
				and tablename = 'clinical_entries'
				and policyname = 'clinical_entries_role_scoped_select'
		) then
			create policy clinical_entries_role_scoped_select
				on clinical_entries
				for select
				to authenticated
				using (
					business_id is not null
					and public.user_can_read_patient(business_id, patient_id)
				);
		end if;
	end if;

	if to_regclass('public.patient_radiographs') is not null then
		drop policy if exists patient_radiographs_business_member_select on patient_radiographs;
		if not exists (
			select 1
			from pg_policies
			where schemaname = 'public'
				and tablename = 'patient_radiographs'
				and policyname = 'patient_radiographs_role_scoped_select'
		) then
			create policy patient_radiographs_role_scoped_select
				on patient_radiographs
				for select
				to authenticated
				using (
					business_id is not null
					and public.user_can_read_patient(business_id, patient_id)
				);
		end if;
	end if;

	if to_regclass('public.audit_logs') is not null then
		if not exists (
			select 1
			from pg_policies
			where schemaname = 'public'
				and tablename = 'audit_logs'
				and policyname = 'audit_logs_appointment_schedule_select'
		) then
			create policy audit_logs_appointment_schedule_select
				on audit_logs
				for select
				to authenticated
				using (
					business_id is not null
					and entity_type = 'appointment'
					and exists (
						select 1
						from appointments a
						where a.business_id = audit_logs.business_id
							and a.id = audit_logs.entity_id
							and public.user_can_read_professional_schedule(a.business_id, a.professional_id)
					)
				);
		end if;
	end if;
end $$;
