-- Performance: conteos agregados y soporte de paginacion/cargas por paciente.
-- Ejecutar en Supabase SQL editor.

create or replace function public.patients_counts_by_owner(p_owner uuid)
returns table(total_count bigint, active_count bigint, archived_count bigint)
language sql
security invoker
set search_path = public
as $$
	select
		count(*)::bigint as total_count,
		count(*) filter (where archived_at is null)::bigint as active_count,
		count(*) filter (where archived_at is not null)::bigint as archived_count
	from patients
	where owner_id = p_owner;
$$;

grant execute on function public.patients_counts_by_owner(uuid) to authenticated;

create index if not exists patients_owner_archived_updated_idx
	on patients (owner_id, archived_at, updated_at desc);

do $$
begin
	if to_regclass('public.clinical_entries') is not null then
		execute '
			create index if not exists clinical_entries_patient_archived_created_id_idx
			on clinical_entries (patient_id, archived_at, created_at desc, id desc)
		';
	end if;
	if to_regclass('public.patient_radiographs') is not null then
		execute '
			create index if not exists patient_radiographs_patient_deleted_created_id_idx
			on patient_radiographs (patient_id, deleted_at, created_at desc, id desc)
		';
	end if;
end $$;
