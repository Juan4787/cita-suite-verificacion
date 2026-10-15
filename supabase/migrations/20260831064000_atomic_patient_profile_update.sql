-- La ficha demográfica y el perfil clínico forman una sola edición desde la
-- perspectiva del profesional. Una RPC transaccional evita que una falla en
-- la segunda escritura deje guardada sólo la primera.

create or replace function public.update_patient_with_clinical_profile_safely(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_full_name text,
	p_dni text,
	p_phone text,
	p_phone_raw text,
	p_phone_e164 text,
	p_email text,
	p_birth_date date,
	p_address text,
	p_insurance text,
	p_insurance_plan text,
	p_update_clinical_profile boolean default false,
	p_allergies text default null,
	p_medication text default null,
	p_background text default null,
	p_expected_patient_updated_at timestamptz default null,
	p_expected_clinical_profile_updated_at timestamptz default null
)
returns table(
	patient_id uuid,
	patient_updated_at timestamptz,
	clinical_profile_id uuid,
	clinical_profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
	v_actor uuid := coalesce(p_actor_id, auth.uid());
	v_role text;
	v_full_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
	v_patient public.patients%rowtype;
	v_profile public.patient_clinical_profiles%rowtype;
	v_patient_id uuid;
	v_patient_updated_at timestamptz;
	v_profile_id uuid;
	v_profile_updated_at timestamptz;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	-- La ruta llama esta función con service_role y explicita al usuario que
	-- inició la sesión. Un caller autenticado no puede suplantar a otro actor.
	if coalesce(auth.role(), '') <> 'service_role'
		and auth.uid() is distinct from v_actor
	then
		raise exception 'PATIENT_UPDATE_DENIED';
	end if;
	if p_business_id is null or p_patient_id is null then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	select bu.role
	into v_role
	from public.business_users bu
	where bu.business_id = p_business_id
		and bu.user_id = v_actor
		and coalesce(bu.status, 'active') = 'active'
		and bu.accepted_at is not null
	order by case bu.role
		when 'owner' then 1
		when 'admin' then 2
		when 'reception' then 3
		when 'professional' then 4
		else 5
	end
	limit 1;

	if coalesce(v_role, '') not in ('owner', 'admin', 'reception', 'professional') then
		raise exception 'PATIENT_UPDATE_DENIED';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;
	if v_role = 'professional'
		and not exists (
			select 1
			from public.professional_patient_links ppl
			join public.professional_users pu
				on pu.business_id = ppl.business_id
				and pu.professional_id = ppl.professional_id
			where ppl.business_id = p_business_id
				and ppl.patient_id = p_patient_id
				and ppl.is_active = true
				and pu.user_id = v_actor
		)
	then
		raise exception 'PATIENT_ACCESS_DENIED';
	end if;
	if v_full_name = '' then
		raise exception 'PATIENT_NAME_REQUIRED';
	end if;

	-- Bloquea la ficha una sola vez. Todas las ediciones que usan esta RPC se
	-- serializan por paciente y el token evita sobrescribir una versión ajena.
	select *
	into v_patient
	from public.patients p
	where p.business_id = p_business_id
		and p.id = p_patient_id
	for update;
	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
	if p_expected_patient_updated_at is not null
		and v_patient.updated_at is distinct from p_expected_patient_updated_at
	then
		raise exception 'PATIENT_UPDATE_CONFLICT';
	end if;

	if coalesce(p_update_clinical_profile, false) then
		select *
		into v_profile
		from public.patient_clinical_profiles profile
		where profile.business_id = p_business_id
			and profile.patient_id = p_patient_id
		for update;
		if p_expected_clinical_profile_updated_at is not null
			and (v_profile.id is null or v_profile.updated_at is distinct from p_expected_clinical_profile_updated_at)
		then
			raise exception 'PATIENT_UPDATE_CONFLICT';
		end if;
	end if;

	update public.patients p
	set
		full_name = v_full_name,
		dni = nullif(trim(coalesce(p_dni, '')), ''),
		phone = nullif(trim(coalesce(p_phone, '')), ''),
		phone_raw = nullif(trim(coalesce(p_phone_raw, '')), ''),
		phone_e164 = nullif(trim(coalesce(p_phone_e164, '')), ''),
		email = nullif(trim(coalesce(p_email, '')), ''),
		birth_date = p_birth_date,
		address = nullif(trim(coalesce(p_address, '')), ''),
		insurance = nullif(trim(coalesce(p_insurance, '')), ''),
		insurance_plan = nullif(trim(coalesce(p_insurance_plan, '')), ''),
		updated_at = clock_timestamp()
	where p.business_id = p_business_id
		and p.id = p_patient_id
	returning p.id, p.updated_at
	into v_patient_id, v_patient_updated_at;
	if v_patient_id is null then
		raise exception 'PATIENT_UPDATE_CONFLICT';
	end if;

	if coalesce(p_update_clinical_profile, false) then
		if v_profile.id is null then
			begin
				insert into public.patient_clinical_profiles (
					business_id,
					patient_id,
					allergies,
					medication,
					background,
					updated_by,
					created_by
				)
				values (
					p_business_id,
					p_patient_id,
					nullif(trim(coalesce(p_allergies, '')), ''),
					nullif(trim(coalesce(p_medication, '')), ''),
					nullif(trim(coalesce(p_background, '')), ''),
					v_actor,
					v_actor
				)
				returning id, updated_at
				into v_profile_id, v_profile_updated_at;
			exception
				when unique_violation then
					raise exception 'PATIENT_UPDATE_CONFLICT';
			end;
		else
			update public.patient_clinical_profiles profile
			set
				allergies = nullif(trim(coalesce(p_allergies, '')), ''),
				medication = nullif(trim(coalesce(p_medication, '')), ''),
				background = nullif(trim(coalesce(p_background, '')), ''),
				updated_by = v_actor,
				updated_at = clock_timestamp()
			where profile.id = v_profile.id
				and profile.business_id = p_business_id
				and profile.patient_id = p_patient_id
				and profile.updated_at = v_profile.updated_at
			returning profile.id, profile.updated_at
			into v_profile_id, v_profile_updated_at;
			if v_profile_id is null then
				raise exception 'PATIENT_UPDATE_CONFLICT';
			end if;
		end if;
	end if;

	return query
	select v_patient_id, v_patient_updated_at, v_profile_id, v_profile_updated_at;
end;
$$;

revoke all on function public.update_patient_with_clinical_profile_safely(
	uuid, uuid, uuid, text, text, text, text, text, text, date, text, text, text,
	boolean, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_patient_with_clinical_profile_safely(
	uuid, uuid, uuid, text, text, text, text, text, text, date, text, text, text,
	boolean, text, text, text, timestamptz, timestamptz
) to service_role;

notify pgrst, 'reload schema';
