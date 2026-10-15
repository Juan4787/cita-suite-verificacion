-- Flujo comercial por venta directa:
-- 1) el vendedor habilita el email en allowed_emails;
-- 2) la persona se registra;
-- 3) el sistema crea un negocio owner bloqueado para operar pero pagable;
-- 4) Mercado Pago activa el acceso solo tras webhook/confirmación server-to-server.
--
-- El filtro anti-spam sigue siendo allowed_emails. No se abre registro libre.

create or replace function public.ensure_business_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into business_subscriptions (
		business_id,
		commercial_access_enabled,
		is_permanent,
		subscription_status,
		access_starts_at,
		restricted_until,
		access_source,
		access_note,
		expiration_notice_enabled
	)
	values (
		new.id,
		true,
		false,
		'restricted',
		now(),
		now() + interval '30 days',
		'internal',
		'Cuenta pendiente de activación de suscripción.',
		false
	)
	on conflict (business_id) do nothing;

	return new;
end;
$$;

update business_subscriptions
set
	commercial_access_enabled = true,
	restricted_until = coalesce(restricted_until, now() + interval '30 days'),
	subscription_status = public.compute_business_subscription_status(
		true,
		is_permanent,
		paid_until,
		grace_until,
		coalesce(restricted_until, now() + interval '30 days'),
		archived_at
	),
	access_note = 'Cuenta pendiente de activación de suscripción.',
	updated_at = now()
where commercial_access_enabled = false
	and is_permanent = false
	and paid_until is null
	and grace_until is null
	and archived_at is null
	and access_source = 'internal'
	and access_note = 'Suscripción pendiente de configuración explícita desde panel maestro.';

create or replace function public.ensure_user_default_business(
	p_name text default null,
	p_industry text default 'odontology'
)
returns table(business_id uuid, role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_user_id uuid := auth.uid();
	v_email text;
	v_business_id uuid;
	v_role text;
	v_invite business_user_invites%rowtype;
	v_name text;
	v_base_slug text;
	v_slug text;
	v_counter integer := 1;
begin
	perform p_name, p_industry;

	if v_user_id is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select bu.business_id, bu.role
	into v_business_id, v_role
	from business_users bu
	where bu.user_id = v_user_id
		and coalesce(bu.status, 'active') = 'active'
	order by bu.created_at asc
	limit 1;

	if v_business_id is not null then
		update business_users
		set
			accepted_at = coalesce(accepted_at, now()),
			updated_at = now()
		where business_id = v_business_id
			and user_id = v_user_id;

		business_id := v_business_id;
		role := v_role;
		return next;
		return;
	end if;

	select lower(u.email)
	into v_email
	from auth.users u
	where u.id = v_user_id;

	select *
	into v_invite
	from business_user_invites bui
	where lower(bui.email) = v_email
		and bui.status = 'pending'
	order by bui.created_at asc
	limit 1
	for update;

	if found then
		insert into business_users (
			business_id,
			user_id,
			role,
			status,
			accepted_at,
			created_by,
			updated_by
		)
		values (
			v_invite.business_id,
			v_user_id,
			v_invite.role,
			'active',
			now(),
			v_invite.invited_by,
			v_user_id
		)
		on conflict on constraint business_users_business_id_user_id_key
		do update set
			role = excluded.role,
			status = 'active',
			accepted_at = coalesce(business_users.accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = v_user_id,
			updated_at = now();

		if v_invite.role = 'professional' and v_invite.professional_id is not null then
			delete from professional_users pu
			where pu.business_id = v_invite.business_id
				and (
					(pu.user_id = v_user_id and pu.professional_id <> v_invite.professional_id)
					or (pu.professional_id = v_invite.professional_id and pu.user_id <> v_user_id)
				);

			insert into professional_users (business_id, professional_id, user_id)
			values (v_invite.business_id, v_invite.professional_id, v_user_id)
			on conflict on constraint professional_users_business_id_professional_id_user_id_key do nothing;
		else
			delete from professional_users pu
			where pu.business_id = v_invite.business_id
				and pu.user_id = v_user_id;
		end if;

		update business_user_invites
		set
			status = 'accepted',
			accepted_user_id = v_user_id,
			accepted_at = now(),
			updated_at = now()
		where id = v_invite.id;

		business_id := v_invite.business_id;
		role := v_invite.role;
		return next;
		return;
	end if;

	if not exists (
		select 1
		from allowed_emails ae
		where lower(ae.email) = v_email
			and ae.enabled = true
	) then
		raise exception 'DEFAULT_BUSINESS_CREATION_DISABLED';
	end if;

	v_name := nullif(trim(coalesce(p_name, '')), '');
	if v_name is null then
		v_name := 'Consultorio';
	end if;

	v_base_slug := public.slugify_business_slug(coalesce(split_part(v_email, '@', 1), v_name));
	if v_base_slug is null or v_base_slug = '' then
		v_base_slug := 'consultorio';
	end if;

	v_slug := v_base_slug || '-' || replace(left(v_user_id::text, 8), '-', '');
	while exists (select 1 from businesses b where b.slug = v_slug) loop
		v_counter := v_counter + 1;
		v_slug := v_base_slug || '-' || replace(left(v_user_id::text, 8), '-', '') || '-' || v_counter::text;
	end loop;

	insert into businesses (name, slug, industry, email)
	values (
		v_name,
		v_slug,
		case
			when p_industry in ('odontology','aesthetics','kinesiology','nutrition','therapy','other')
				then p_industry
			else 'odontology'
		end,
		v_email
	)
	returning id into v_business_id;

	insert into business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_user_id, 'owner', 'active', now());

	business_id := v_business_id;
	role := 'owner';
	return next;
end;
$$;

revoke execute on function public.ensure_business_subscription() from public, anon, authenticated;
revoke execute on function public.ensure_user_default_business(text, text) from public, anon;
grant execute on function public.ensure_user_default_business(text, text) to authenticated;

notify pgrst, 'reload schema';
