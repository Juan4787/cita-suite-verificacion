-- Separa el rol de acceso del perfil profesional.
-- Un owner/admin puede atender pacientes sin perder sus permisos administrativos.
-- Mientras la cuenta esté pendiente, el perfil existe y puede configurarse, pero
-- no se publica en las reservas online. La aceptación de la invitación vincula y
-- publica el perfil dentro de la misma transacción.

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'business_user_invites_professional_role_supported_chk'
	) then
		alter table public.business_user_invites
			add constraint business_user_invites_professional_role_supported_chk
			check (
				professional_id is null
				or role in ('owner', 'admin', 'professional')
			)
			not valid;
	end if;
end $$;

create or replace function public.enforce_pending_professional_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.is_public and exists (
		select 1
		from public.business_user_invites invite
		where invite.business_id = new.business_id
			and invite.professional_id = new.id
			and invite.status = 'pending'
	) then
		new.is_public := false;
	end if;

	return new;
end;
$$;

drop trigger if exists trg_enforce_pending_professional_visibility on public.professionals;
create trigger trg_enforce_pending_professional_visibility
	before insert or update of is_public
	on public.professionals
	for each row
	execute function public.enforce_pending_professional_visibility();

create or replace function public.sync_invited_professional_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.professional_id is null or new.role not in ('owner', 'admin', 'professional') then
		return new;
	end if;
	if not exists (
		select 1
		from public.professionals professional
		where professional.id = new.professional_id
			and professional.business_id = new.business_id
	) then
		raise exception 'INVITED_PROFESSIONAL_BUSINESS_MISMATCH';
	end if;

	if new.status = 'pending' then
		update public.professionals professional
		set
			is_public = false,
			updated_at = now()
		where professional.business_id = new.business_id
			and professional.id = new.professional_id
			and professional.is_public;
		return new;
	end if;

	if new.status = 'accepted' and new.accepted_user_id is not null then
		delete from public.professional_users link
		where link.business_id = new.business_id
			and (
				(link.user_id = new.accepted_user_id and link.professional_id <> new.professional_id)
				or (link.professional_id = new.professional_id and link.user_id <> new.accepted_user_id)
			);

		insert into public.professional_users (business_id, professional_id, user_id)
		values (new.business_id, new.professional_id, new.accepted_user_id)
	on conflict on constraint professional_users_business_id_professional_id_user_id_key do nothing;

		update public.professionals professional
		set
			is_public = true,
			updated_at = now()
		where professional.business_id = new.business_id
			and professional.id = new.professional_id
			and professional.is_active
			and not professional.is_public;
	end if;

	return new;
end;
$$;

drop trigger if exists trg_sync_invited_professional_account on public.business_user_invites;
create trigger trg_sync_invited_professional_account
	after insert or update of status, professional_id, accepted_user_id, role
	on public.business_user_invites
	for each row
	execute function public.sync_invited_professional_account();

-- Corrige invitaciones pendientes creadas con el comportamiento anterior.
update public.professionals professional
set
	is_public = false,
	updated_at = now()
where professional.is_public
	and exists (
		select 1
		from public.business_user_invites invite
		where invite.business_id = professional.business_id
			and invite.professional_id = professional.id
			and invite.status = 'pending'
			and invite.role in ('owner', 'admin', 'professional')
	);

-- Cambiar entre Profesional, Administrador y Dueño conserva el perfil. Sólo los
-- roles que no pueden atender pierden el vínculo profesional.
create or replace function public.update_business_role_access(
	target_access_id uuid,
	target_role text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_role text;
	v_target public.business_users%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_target
	from public.business_users
	where id = target_access_id
		and coalesce(status, 'active') = 'active'
	for update;

	if not found then
		raise exception 'BUSINESS_USER_NOT_FOUND';
	end if;

	v_actor_role := public.user_business_role(v_target.business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(v_target.business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;
	if v_actor_role = 'admin' and (v_target.role in ('owner','admin') or target_role in ('owner','admin')) then
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if v_target.role = 'owner' and target_role <> 'owner'
		and public.count_active_business_owners(v_target.business_id) <= 1
	then
		raise exception 'LAST_OWNER_BLOCKED';
	end if;
	if target_role = 'professional' and not exists (
		select 1
		from public.professional_users link
		where link.business_id = v_target.business_id
			and link.user_id = v_target.user_id
	) then
		raise exception 'PROFESSIONAL_REQUIRED';
	end if;

	update public.business_users
	set
		role = target_role,
		updated_by = v_actor,
		updated_at = now()
	where id = target_access_id;

	if target_role not in ('owner', 'admin', 'professional') then
		delete from public.professional_users link
		where link.business_id = v_target.business_id
			and link.user_id = v_target.user_id;
	end if;

	perform public.audit_security_event(
		v_target.business_id,
		v_actor,
		'business_user.role_changed',
		'business_user',
		target_access_id,
		'success',
		null,
		jsonb_build_object('from_role', v_target.role, 'to_role', target_role)
	);
end;
$$;

revoke execute on function public.update_business_role_access(uuid, text) from public, anon;
grant execute on function public.update_business_role_access(uuid, text) to authenticated;

-- La edición de perfiles, servicios y horarios es administrativa. Esto mantiene
-- bloqueado al rol Profesional incluso ante llamadas directas a PostgREST.
drop policy if exists professionals_insert on public.professionals;
create policy professionals_insert on public.professionals
	for insert to authenticated
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists professionals_update on public.professionals;
create policy professionals_update on public.professionals
	for update to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists professional_users_write on public.professional_users;
create policy professional_users_write on public.professional_users
	for all to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists services_insert on public.services;
create policy services_insert on public.services
	for insert to authenticated
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists services_update on public.services;
create policy services_update on public.services
	for update to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists professional_services_write on public.professional_services;
create policy professional_services_write on public.professional_services
	for all to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists availability_rules_write on public.availability_rules;
create policy availability_rules_write on public.availability_rules
	for all to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists availability_exceptions_write on public.availability_exceptions;
create policy availability_exceptions_write on public.availability_exceptions
	for all to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

revoke execute on function public.enforce_pending_professional_visibility() from public, anon, authenticated;
revoke execute on function public.sync_invited_professional_account() from public, anon, authenticated;

notify pgrst, 'reload schema';
