-- Evita que las actualizaciones de actividad del paciente (como activity_at o
-- last_entry_at generadas por turnos, entradas clínicas o radiografías) alteren
-- patients.updated_at, lo cual provocaba falsos conflictos de concurrencia en la
-- edición demográfica de la ficha.

create or replace function public.set_patients_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
	-- Si updated_at ya fue actualizado explícitamente (ej: por la RPC
	-- atómica update_patient_with_clinical_profile_safely con clock_timestamp()),
	-- respetamos ese nuevo valor.
	if new.updated_at is distinct from old.updated_at then
		return new;
	end if;

	-- Solo actualizar updated_at si cambiaron datos reales de la ficha o perfil
	-- demográfico del paciente. No tocarlo si únicamente mutaron campos internos de
	-- actividad o índices de búsqueda.
	if (
		new.full_name,
		new.dni,
		new.phone,
		new.phone_raw,
		new.phone_e164,
		new.email,
		new.birth_date,
		new.address,
		new.insurance,
		new.insurance_plan,
		new.custom_fields,
		new.archived_at,
		new.notes,
		new.has_clinical_alert,
		new.allergies,
		new.medication,
		new.background,
		new.blocked,
		new.spam_score,
		new.drive_folder_id
	) is distinct from (
		old.full_name,
		old.dni,
		old.phone,
		old.phone_raw,
		old.phone_e164,
		old.email,
		old.birth_date,
		old.address,
		old.insurance,
		old.insurance_plan,
		old.custom_fields,
		old.archived_at,
		old.notes,
		old.has_clinical_alert,
		old.allergies,
		old.medication,
		old.background,
		old.blocked,
		old.spam_score,
		old.drive_folder_id
	) then
		new.updated_at := clock_timestamp();
	end if;

	return new;
end;
$$;

drop trigger if exists set_patients_updated_at on public.patients;
create trigger set_patients_updated_at
	before update on public.patients
	for each row execute function public.set_patients_updated_at();

revoke all on function public.set_patients_updated_at() from public, anon, authenticated;
