-- Separate manual commercial onboarding from self-service Mercado Pago signup.
--
-- Before this migration, any enabled email without a pending invite could create
-- an automatic restricted business on first app access. That broke the manual
-- sales flow because the real consultorio may be created later by the master
-- user. The explicit onboarding_mode below keeps the anti-spam allowlist while
-- making the business creation path intentional.

alter table public.allowed_emails
	add column if not exists onboarding_mode text not null default 'manual';

update public.allowed_emails
set onboarding_mode = 'manual'
where onboarding_mode is null
	or onboarding_mode not in ('manual', 'self_service');

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'allowed_emails_onboarding_mode_chk'
	) then
		alter table public.allowed_emails
			add constraint allowed_emails_onboarding_mode_chk
			check (onboarding_mode in ('manual', 'self_service'));
	end if;
end $$;

create index if not exists allowed_emails_enabled_onboarding_idx
	on public.allowed_emails (enabled, onboarding_mode, email);

comment on column public.allowed_emails.onboarding_mode is
	'manual: master creates/invites the consultorio; self_service: the user may auto-create a restricted business and activate it with Mercado Pago.';

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
	v_onboarding_mode text;
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
		update business_users bu
		set
			accepted_at = coalesce(bu.accepted_at, now()),
			updated_at = now()
		where bu.business_id = v_business_id
			and bu.user_id = v_user_id;

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

		update business_user_invites bui
		set
			status = 'accepted',
			accepted_user_id = v_user_id,
			accepted_at = now(),
			updated_at = now()
		where bui.id = v_invite.id;

		business_id := v_invite.business_id;
		role := v_invite.role;
		return next;
		return;
	end if;

	select ae.onboarding_mode
	into v_onboarding_mode
	from allowed_emails ae
	where lower(ae.email) = v_email
		and ae.enabled = true
	limit 1;

	if not found then
		raise exception 'DEFAULT_BUSINESS_CREATION_DISABLED';
	end if;

	if v_onboarding_mode <> 'self_service' then
		raise exception 'DEFAULT_BUSINESS_PENDING_MANUAL_SETUP';
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

revoke execute on function public.ensure_user_default_business(text, text) from public, anon;
grant execute on function public.ensure_user_default_business(text, text) to authenticated;

notify pgrst, 'reload schema';
