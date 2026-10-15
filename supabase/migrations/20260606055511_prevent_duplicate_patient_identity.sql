-- Prevent new duplicate patients inside the same business by DNI or normalized
-- full name. Existing duplicates are not merged here because patient records can
-- carry clinical history and must not be altered without an explicit merge flow.

create or replace function public.normalized_patient_name(value text)
returns text
language sql
immutable
set search_path = public
as $$
	select nullif(regexp_replace(lower(trim(coalesce(value, ''))), '\s+', ' ', 'g'), '');
$$;

create index if not exists patients_business_normalized_name_idx
	on patients (business_id, public.normalized_patient_name(full_name));

create index if not exists patients_business_normalized_dni_idx
	on patients (business_id, nullif(trim(coalesce(dni, '')), ''));

create or replace function public.prevent_duplicate_patient_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_name text := public.normalized_patient_name(new.full_name);
	v_dni text := nullif(trim(coalesce(new.dni, '')), '');
begin
	if v_name is null then
		raise exception 'PATIENT_NAME_REQUIRED';
	end if;

	new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
	new.dni := v_dni;

	perform pg_advisory_xact_lock(hashtext('patients:name:' || new.business_id::text || ':' || v_name));
	if v_dni is not null then
		perform pg_advisory_xact_lock(hashtext('patients:dni:' || new.business_id::text || ':' || v_dni));
	end if;

	if v_dni is not null and exists (
		select 1
		from patients p
		where p.business_id = new.business_id
			and p.id is distinct from new.id
			and nullif(trim(coalesce(p.dni, '')), '') = v_dni
	) then
		raise exception 'PATIENT_DNI_ALREADY_EXISTS';
	end if;

	if exists (
		select 1
		from patients p
		where p.business_id = new.business_id
			and p.id is distinct from new.id
			and public.normalized_patient_name(p.full_name) = v_name
	) then
		raise exception 'PATIENT_NAME_ALREADY_EXISTS';
	end if;

	return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_patient_identity on patients;
create trigger trg_prevent_duplicate_patient_identity
	before insert or update of business_id, full_name, dni
	on patients
	for each row
	execute function public.prevent_duplicate_patient_identity();

revoke execute on function public.prevent_duplicate_patient_identity() from public, anon;
revoke execute on function public.normalized_patient_name(text) from public, anon;
grant execute on function public.normalized_patient_name(text) to authenticated, service_role;

notify pgrst, 'reload schema';
