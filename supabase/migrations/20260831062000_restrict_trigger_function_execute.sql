-- Las funciones de trigger no son una API pública. El privilegio EXECUTE que
-- PostgreSQL concede por defecto a `public` dejaba expuestos sus nombres y, en
-- el helper `user_is_professional_for`, permitía consultas innecesarias desde
-- sesiones anónimas. Los triggers siguen funcionando para las sesiones que
-- escriben desde la aplicación y para el backend con service_role.

do $$
declare
	function_signature text;
begin
	-- Algunas instalaciones históricas no tienen todos los triggers (por
	-- ejemplo, una base creada antes de la agenda conjunta). La cadena de
	-- migraciones debe poder construirse desde cero y también cerrar los objetos
	-- que sí existan, sin convertir la revocación en un fallo de despliegue.
	foreach function_signature in array array[
		'public.enforce_appointment_role_update()',
		'public.link_patient_to_professional_from_appointment()',
		'public.link_patient_to_professional_from_clinical_entry()',
		'public.prepare_appointment_professional()',
		'public.reset_push_reminders_on_reschedule()',
		'public.set_appointment_snapshots_and_blocking_range()',
		'public.set_clinical_entry_actor_fields()',
		'public.sync_appointment_professionals()',
		'public.user_is_professional_for(uuid)'
	] loop
		if to_regprocedure(function_signature) is not null then
			execute format(
				'revoke all on function %s from public, anon, authenticated',
				function_signature
			);
			execute format(
				'grant execute on function %s to authenticated, service_role',
				function_signature
			);
		end if;
	end loop;
end $$;
