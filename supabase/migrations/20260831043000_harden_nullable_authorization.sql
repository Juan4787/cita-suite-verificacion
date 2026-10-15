-- Endurece todas las decisiones de autorización contra el valor NULL.
--
-- Antecedente comprobado en producción (2026-08-31):
-- `user_business_role()` devuelve NULL para un usuario sin membresía. En
-- PL/pgSQL, `IF role NOT IN (...)` con role=NULL no entra en el rechazo;
-- combinado con un consultorio comercialmente activo podía dejar pasar una
-- función SECURITY DEFINER. El caso más grave fue list_business_users(), que
-- expuso miembros de otro consultorio. El mismo patrón estaba presente en
-- varias mutaciones administrativas y clínicas.
--
-- La membresía ausente sigue representándose como NULL en user_business_role
-- (contrato usado por la aplicación). Se corrigen las funciones consumidoras,
-- sin cambiar ese contrato, y se valida que no quede ningún guard nullable.

create or replace function public.user_can_manage_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(public.user_business_role(target_business_id) in ('owner', 'admin'), false);
$$;

create or replace function public.user_can_operate_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(
		public.user_business_role(target_business_id) in ('owner', 'admin', 'reception')
		and public.business_allows_operation(target_business_id),
		false
	);
$$;

create or replace function public.user_can_configure_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(
		public.user_business_role(target_business_id) in ('owner', 'admin')
		and public.business_allows_operation(target_business_id),
		false
	);
$$;

create or replace function public.user_can_manage_users(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(
		public.business_allows_operation(target_business_id)
		and public.user_business_role(target_business_id) in ('owner', 'admin'),
		false
	);
$$;

create or replace function public.user_can_view_costs(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(
		public.business_allows_operation(target_business_id)
		and public.user_business_role(target_business_id) in ('owner', 'admin'),
		false
	);
$$;

create or replace function public.user_can_read_clinical_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(
		exists (
			select 1
			from patients p
			where p.business_id = target_business_id
				and p.id = target_patient_id
		)
		and public.business_allows_operation(target_business_id)
		and (
			public.user_business_role(target_business_id) in ('owner','admin')
			or (
				public.user_business_role(target_business_id) = 'professional'
				and public.user_has_active_professional_patient_link(target_business_id, target_patient_id)
			)
		),
		false
	);
$$;

do $$
declare
	row record;
	original_definition text;
	patched_definition text;
begin
	-- Reescribe las funciones ya existentes en forma reproducible. Se usa la
	-- definición del catálogo para no duplicar cuerpos largos y para cubrir la
	-- versión efectiva de cada función en una base nueva y en la remota.
	for row in
		select p.oid
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public'
			and p.prokind = 'f'
			and (
				p.prosrc ~* 'v_actor_role[[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'v_role[[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'public[.]user_business_role[(]p_business_id[)][[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'public[.]user_business_role[(]target_business_id[)][[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'public[.]user_business_role[(]v_target[.]business_id[)][[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'private[.]clinical_file_actor_business_role[(]p_business_id,[[:space:]]+v_actor[)][[:space:]]+not[[:space:]]+in'
			)
	loop
		original_definition := pg_get_functiondef(row.oid);
		patched_definition := original_definition;
		patched_definition := regexp_replace(patched_definition, 'v_actor_role[[:space:]]+not[[:space:]]+in', 'coalesce(v_actor_role, '''') not in', 'gi');
		patched_definition := regexp_replace(patched_definition, 'v_role[[:space:]]+not[[:space:]]+in', 'coalesce(v_role, '''') not in', 'gi');
		patched_definition := regexp_replace(patched_definition, 'public[.]user_business_role[(]p_business_id[)][[:space:]]+not[[:space:]]+in', 'coalesce(public.user_business_role(p_business_id), '''') not in', 'gi');
		patched_definition := regexp_replace(patched_definition, 'public[.]user_business_role[(]target_business_id[)][[:space:]]+not[[:space:]]+in', 'coalesce(public.user_business_role(target_business_id), '''') not in', 'gi');
		patched_definition := regexp_replace(patched_definition, 'public[.]user_business_role[(]v_target[.]business_id[)][[:space:]]+not[[:space:]]+in', 'coalesce(public.user_business_role(v_target.business_id), '''') not in', 'gi');
		patched_definition := regexp_replace(patched_definition, 'private[.]clinical_file_actor_business_role[(]p_business_id,[[:space:]]+v_actor[)][[:space:]]+not[[:space:]]+in', 'coalesce(private.clinical_file_actor_business_role(p_business_id, v_actor), '''') not in', 'gi');
		if patched_definition = original_definition then
			raise exception 'No se pudo endurecer la función con guard nullable (oid=%)', row.oid;
		end if;
		execute patched_definition;
	end loop;
end;
$$;

do $$
begin
	if exists (
		select 1
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public'
			and p.prokind = 'f'
			and (
				p.prosrc ~* 'v_actor_role[[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'v_role[[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'public[.]user_business_role[(]p_business_id[)][[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'public[.]user_business_role[(]target_business_id[)][[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'public[.]user_business_role[(]v_target[.]business_id[)][[:space:]]+not[[:space:]]+in'
				or p.prosrc ~* 'private[.]clinical_file_actor_business_role[(]p_business_id,[[:space:]]+v_actor[)][[:space:]]+not[[:space:]]+in'
			)
	) then
		raise exception 'Quedó al menos un guard de autorización nullable sin corregir';
	end if;
end;
$$;

notify pgrst, 'reload schema';
