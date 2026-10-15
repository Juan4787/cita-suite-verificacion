-- La base remota conservaba estas defensas de procedencia y vinculación,
-- aunque la cadena limpia de migraciones no las reconstruía. Son necesarias
-- para que un turno o una consulta nueva no pierda el vínculo profesional del
-- paciente y para que una escritura directa no pueda falsificar al actor.

create or replace function public.create_or_restore_professional_patient_link(
	p_business_id uuid,
	p_professional_id uuid,
	p_patient_id uuid,
	p_source text,
	p_source_entity_id uuid default null,
	p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_link_id uuid;
	v_source text := coalesce(nullif(trim(p_source), ''), 'manual');
begin
	if v_source not in ('appointment', 'public_booking', 'clinical_entry', 'manual', 'import') then
		raise exception 'INVALID_LINK_SOURCE';
	end if;
	if p_business_id is null or p_professional_id is null or p_patient_id is null then
		raise exception 'INVALID_PROFESSIONAL_PATIENT_LINK';
	end if;
	if not exists (
		select 1 from public.professionals p
		where p.business_id = p_business_id and p.id = p_professional_id
	) then
		raise exception 'PROFESSIONAL_NOT_FOUND';
	end if;
	if not exists (
		select 1 from public.patients p
		where p.business_id = p_business_id and p.id = p_patient_id
	) then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	select id
	into v_link_id
	from public.professional_patient_links
	where business_id = p_business_id
		and professional_id = p_professional_id
		and patient_id = p_patient_id
		and is_active = true
	limit 1;
	if v_link_id is not null then
		update public.professional_patient_links
		set
			source = v_source,
			source_entity_id = coalesce(p_source_entity_id, source_entity_id),
			updated_at = now()
		where id = v_link_id;
		return v_link_id;
	end if;

	update public.professional_patient_links
	set
		is_active = true,
		disabled_by = null,
		disabled_at = null,
		disabled_reason = null,
		source = v_source,
		source_entity_id = p_source_entity_id,
		created_by = coalesce(p_created_by, auth.uid(), created_by),
		updated_at = now()
	where business_id = p_business_id
		and professional_id = p_professional_id
		and patient_id = p_patient_id
		and is_active = false
	returning id into v_link_id;
	if v_link_id is not null then
		return v_link_id;
	end if;

	insert into public.professional_patient_links (
		business_id,
		professional_id,
		patient_id,
		source,
		source_entity_id,
		created_by
	)
	values (
		p_business_id,
		p_professional_id,
		p_patient_id,
		v_source,
		p_source_entity_id,
		coalesce(p_created_by, auth.uid())
	)
	returning id into v_link_id;
	return v_link_id;
end;
$$;

create or replace function public.link_patient_to_professional_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
	if tg_op = 'INSERT'
		or new.professional_id is distinct from old.professional_id
		or new.patient_id is distinct from old.patient_id
	then
		perform public.create_or_restore_professional_patient_link(
			new.business_id,
			new.professional_id,
			new.patient_id,
			case when new.source = 'public_booking' then 'public_booking' else 'appointment' end,
			new.id,
			new.created_by_user_id
		);
	end if;
	return new;
end;
$$;

drop trigger if exists trg_appointments_professional_patient_link on public.appointments;
create trigger trg_appointments_professional_patient_link
	after insert or update of professional_id, patient_id
	on public.appointments
	for each row
	execute function public.link_patient_to_professional_from_appointment();

create or replace function public.set_clinical_entry_actor_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_role text;
	v_professional_id uuid;
begin
	if tg_op = 'INSERT' then
		if auth.uid() is not null then
			v_role := public.user_business_role(new.business_id);
			new.owner_id := auth.uid();
			new.created_by_user_id := auth.uid();

			if v_role = 'professional' then
				v_professional_id := public.current_user_professional_id(new.business_id);
				if v_professional_id is null then
					raise exception 'PROFESSIONAL_LINK_REQUIRED';
				end if;
				new.created_at := now();
				new.created_by_professional_id := v_professional_id;
			else
				if v_role in ('owner', 'admin') and new.created_at > now() + interval '5 minutes' then
					raise exception 'INVALID_CLINICAL_ENTRY_DATE';
				end if;
				new.created_by_professional_id := null;
			end if;
		end if;
		new.created_at := coalesce(new.created_at, now());
		new.locked_after := coalesce(new.locked_after, new.created_at + interval '24 hours');
	end if;

	if tg_op = 'UPDATE' and auth.uid() is not null then
		new.updated_by_user_id := auth.uid();
	end if;
	return new;
end;
$$;

drop trigger if exists trg_clinical_entries_actor_fields on public.clinical_entries;
create trigger trg_clinical_entries_actor_fields
	before insert or update
	on public.clinical_entries
	for each row
	execute function public.set_clinical_entry_actor_fields();

create or replace function public.link_patient_to_professional_from_clinical_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
	if new.created_by_professional_id is not null then
		perform public.create_or_restore_professional_patient_link(
			new.business_id,
			new.created_by_professional_id,
			new.patient_id,
			'clinical_entry',
			new.id,
			new.created_by_user_id
		);
	end if;
	return new;
end;
$$;

drop trigger if exists trg_clinical_entries_professional_patient_link on public.clinical_entries;
create trigger trg_clinical_entries_professional_patient_link
	after insert
	on public.clinical_entries
	for each row
	execute function public.link_patient_to_professional_from_clinical_entry();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists set_allowed_emails_updated_at on public.allowed_emails;
create trigger set_allowed_emails_updated_at
	before update on public.allowed_emails
	for each row execute function public.set_updated_at();

drop trigger if exists set_patients_updated_at on public.patients;
create trigger set_patients_updated_at
	before update on public.patients
	for each row execute function public.set_updated_at();

drop trigger if exists set_entries_updated_at on public.clinical_entries;
create trigger set_entries_updated_at
	before update on public.clinical_entries
	for each row execute function public.set_updated_at();

-- Las funciones sólo se invocan por triggers o por el backend confiable. El
-- cliente autenticado conserva el privilegio de modificar la tabla según RLS,
-- pero no puede convertir estas funciones en un RPC directo.
do $$
declare
	v_signature text;
begin
	foreach v_signature in array array[
		'public.create_or_restore_professional_patient_link(uuid, uuid, uuid, text, uuid, uuid)',
		'public.link_patient_to_professional_from_appointment()',
		'public.link_patient_to_professional_from_clinical_entry()',
		'public.set_clinical_entry_actor_fields()',
		'public.set_updated_at()'
	] loop
		execute format('revoke all on function %s from public, anon, authenticated', v_signature);
		execute format('grant execute on function %s to service_role', v_signature);
	end loop;
end;
$$;

notify pgrst, 'reload schema';
