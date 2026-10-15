-- Un profesional no debe conservar ni siquiera la relación interna con un
-- paciente después de que el vínculo fue archivado. Las rutas de la aplicación
-- usan el cliente de servicio y ya aplican el mismo alcance; esta política
-- cierra el acceso directo por PostgREST para que una sesión autenticada no
-- pueda enumerar pacientes revocados.

drop policy if exists professional_patient_links_select on public.professional_patient_links;

create policy professional_patient_links_select
	on public.professional_patient_links
	for select
	to authenticated
	using (
		coalesce(public.user_business_role(business_id), '') in ('owner', 'admin')
		or (
			coalesce(public.user_business_role(business_id), '') = 'professional'
			and public.business_allows_operation(business_id)
			and is_active = true
			and exists (
				select 1
				from public.professional_users pu
				where pu.business_id = professional_patient_links.business_id
					and pu.professional_id = professional_patient_links.professional_id
					and pu.user_id = auth.uid()
			)
		)
	);

notify pgrst, 'reload schema';
