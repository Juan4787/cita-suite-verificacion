begin;

-- The application revokes INSERT/UPDATE/DELETE table privileges and performs
-- every lifecycle transition through the audited service-role RPCs. Remove
-- legacy RLS mutation policies as defense in depth so a future grant cannot
-- accidentally reactivate the discontinued direct-write path.
drop policy if exists patient_radiographs_role_scoped_insert on public.patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_update on public.patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_delete on public.patient_radiographs;

do $$
begin
	if exists (
		select 1
		from pg_catalog.pg_policy policy
		where policy.polrelid = 'public.patient_radiographs'::regclass
			and policy.polcmd <> 'r'
	) then
		raise exception 'CLINICAL_DIRECT_MUTATION_POLICY_REMAINS';
	end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
