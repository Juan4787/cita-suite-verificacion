-- Recepción (y readonly) deben poder LEER la agenda de los profesionales.
--
-- Bug: en la base remota, user_can_read_professional_schedule() quedó con una
-- versión que solo permite owner/admin o al profesional dueño de la agenda;
-- reception/readonly caen en `else false`. Como la policy de SELECT de
-- availability_rules (y la rama por profesional de availability_exceptions)
-- usa esta función, el cálculo de slots de recepción recibe 0 reglas en
-- silencio y todos los días aparecen "sin horarios disponibles" al crear o
-- reprogramar turnos, mientras que al dueño le funcionan los mismos días.
--
-- Fix: redefinir la función agregando reception/readonly, manteniendo la
-- estructura vigente en la remota (gate comercial business_allows_operation y
-- restricción del rol professional a su propia agenda). La escritura no
-- cambia: sigue gobernada por user_can_configure_business (owner/admin).

create or replace function public.user_can_read_professional_schedule(
	target_business_id uuid,
	target_professional_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select case
		when public.user_business_role(target_business_id) in ('owner','admin','reception','readonly')
			then public.business_allows_operation(target_business_id)
		when public.user_business_role(target_business_id) = 'professional'
			then public.business_allows_operation(target_business_id)
				and exists (
					select 1
					from professional_users pu
					where pu.business_id = target_business_id
						and pu.professional_id = target_professional_id
						and pu.user_id = auth.uid()
				)
		else false
	end;
$$;

grant execute on function public.user_can_read_professional_schedule(uuid, uuid) to authenticated;
