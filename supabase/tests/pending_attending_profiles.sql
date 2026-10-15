-- Run after 20260731235900_pending_attending_profiles.sql.
-- Transactional regression: no fixture survives the rollback.

begin;

select extensions.plan(1);

do $$
declare
	v_owner_id uuid := gen_random_uuid();
	v_admin_id uuid := gen_random_uuid();
	v_business_id uuid;
	v_professional_id uuid;
	v_invite_id uuid;
	v_membership_id uuid;
begin
	insert into auth.users (id, email)
	values
		(v_owner_id, 'pending-profile-owner-' || gen_random_uuid()::text || '@example.test'),
		(v_admin_id, 'pending-profile-admin-' || gen_random_uuid()::text || '@example.test');

	insert into public.businesses (name, slug, industry)
	values (
		'Prueba perfil profesional pendiente',
		'pending-profile-' || gen_random_uuid()::text,
		'odontology'
	)
	returning id into v_business_id;

	insert into public.business_subscriptions (
		business_id,
		commercial_access_enabled,
		is_permanent,
		subscription_status
	)
	values (v_business_id, true, true, 'active')
	on conflict (business_id) do update
	set
		commercial_access_enabled = true,
		is_permanent = true,
		subscription_status = 'active',
		access_starts_at = now(),
		paid_until = null,
		grace_until = null,
		restricted_until = null,
		archived_at = null;

	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_owner_id, 'owner', 'active', now());

	insert into public.professionals (business_id, name, is_active, is_public)
	values (v_business_id, 'Administrador que atiende', true, true)
	returning id into v_professional_id;

	insert into public.business_user_invites (
		business_id,
		email,
		role,
		professional_id,
		status,
		invited_by
	)
	select
		v_business_id,
		user_row.email,
		'admin',
		v_professional_id,
		'pending',
		v_owner_id
	from auth.users user_row
	where user_row.id = v_admin_id
	returning id into v_invite_id;

	if exists (
		select 1
		from public.professionals
		where id = v_professional_id and is_public
	) then
		raise exception 'TEST_PENDING_PROFILE_REMAINED_PUBLIC';
	end if;

	-- Reproduce el orden de ensure_user_default_business: membresía primero,
	-- invitación aceptada después. El trigger debe crear el vínculo y publicar.
	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_admin_id, 'admin', 'active', now())
	returning id into v_membership_id;

	update public.business_user_invites
	set
		status = 'accepted',
		accepted_user_id = v_admin_id,
		accepted_at = now(),
		updated_at = now()
	where id = v_invite_id;

	if not exists (
		select 1
		from public.professional_users
		where business_id = v_business_id
			and professional_id = v_professional_id
			and user_id = v_admin_id
	) then
		raise exception 'TEST_ACCEPTED_ADMIN_PROFILE_NOT_LINKED';
	end if;
	if not exists (
		select 1
		from public.professionals
		where id = v_professional_id and is_active and is_public
	) then
		raise exception 'TEST_ACCEPTED_ADMIN_PROFILE_NOT_PUBLISHED';
	end if;

	perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
	perform public.update_business_role_access(v_membership_id, 'professional');
	perform public.update_business_role_access(v_membership_id, 'admin');
	if not exists (
		select 1
		from public.professional_users
		where business_id = v_business_id
			and professional_id = v_professional_id
			and user_id = v_admin_id
	) then
		raise exception 'TEST_PROFILE_LOST_BETWEEN_ATTENDING_ROLES';
	end if;

	perform public.update_business_role_access(v_membership_id, 'reception');
	if exists (
		select 1
		from public.professional_users
		where business_id = v_business_id and user_id = v_admin_id
	) then
		raise exception 'TEST_UNSUPPORTED_ROLE_KEPT_PROFILE_LINK';
	end if;

	raise notice 'PASS: pending admin profile hides, links, publishes, and survives attending-role changes.';
end;
$$;

select extensions.pass('pending attending profiles contract');
select * from extensions.finish();

rollback;
