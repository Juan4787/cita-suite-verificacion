-- Creating a practice from the master panel writes the owner's access email, the
-- practice, its owner membership or invitation and its initial access. The panel wrote
-- them in separate requests and answered a failure by deleting the practice, without
-- checking that the delete worked: an error or a lost response could leave a practice
-- without owner or without access, or an email enabled for no practice, and a retry then
-- created a second practice. One transaction now writes all of them or none. The rules
-- stay where they are: one practice per email (assert_email_available_for_business,
-- through the triggers of business_users and business_user_invites) and the access
-- transitions of grant_business_access.
begin;

create or replace function public.create_business_with_owner(
	p_name text,
	p_slug_base text,
	p_owner_email text,
	p_duration_seconds integer,
	p_duration_unit text,
	p_is_permanent boolean,
	p_note text,
	p_access_note text,
	p_admin_id uuid,
	p_admin_email text,
	p_idempotency_key text
)
returns table (business_id uuid, owner_linked boolean)
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
	v_name text := nullif(btrim(coalesce(p_name, '')), '');
	v_email text := lower(btrim(coalesce(p_owner_email, '')));
	v_base text := nullif(btrim(coalesce(p_slug_base, '')), '');
	v_note text := nullif(btrim(coalesce(p_note, '')), '');
	v_owner_id uuid;
	v_business_id uuid;
	v_email_id uuid;
	v_slug text;
	v_attempt integer;
begin
	if v_name is null or v_base is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
		or p_admin_id is null or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
		raise exception 'BUSINESS_CREATION_INVALID' using errcode = '22023';
	end if;

	-- The same lock the association triggers take, so the owner lookup and the email row
	-- below cannot interleave with another creation or invitation for this email.
	perform pg_advisory_xact_lock(hashtextextended('business-email-association:' || v_email, 0));

	select account.id into v_owner_id
	from auth.users account
	where lower(btrim(coalesce(account.email, ''))) = v_email
	order by account.created_at
	limit 1;

	update public.allowed_emails
	set enabled = true,
		onboarding_mode = 'manual',
		disabled_at = null,
		disabled_reason = null,
		updated_by = p_admin_id,
		note = coalesce(v_note, 'Owner de consultorio creado desde panel maestro.')
	where email = v_email
	returning id into v_email_id;
	if v_email_id is null then
		insert into public.allowed_emails (email, enabled, onboarding_mode, note, updated_by, created_by)
		values (v_email, true, 'manual', coalesce(v_note, 'Owner de consultorio creado desde panel maestro.'), p_admin_id, p_admin_id);
	end if;

	-- A slug shaped like an id would be read as one by the booking link.
	v_attempt := case when v_base ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 1 else 0 end;
	loop
		v_slug := case when v_attempt = 0 then left(v_base, 80)
			else left(v_base, 73) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6) end;
		insert into public.businesses (name, slug, industry, email)
		values (v_name, v_slug, 'odontology', v_email)
		on conflict (slug) do nothing
		returning id into v_business_id;
		exit when v_business_id is not null;
		v_attempt := v_attempt + 1;
		if v_attempt > 20 then
			raise exception 'BUSINESS_SLUG_UNAVAILABLE';
		end if;
	end loop;

	if v_owner_id is not null then
		insert into public.business_users (business_id, user_id, role, status, accepted_at, created_by, updated_by)
		values (v_business_id, v_owner_id, 'owner', 'active', now(), p_admin_id, p_admin_id);
	else
		insert into public.business_user_invites (business_id, email, role, status, invited_by)
		values (v_business_id, v_email, 'owner', 'pending', p_admin_id);
	end if;

	perform 1
	from public.grant_business_access(
		v_business_id,
		case when coalesce(p_is_permanent, false) then 'set_permanent' else 'grant_access' end,
		p_duration_seconds,
		p_duration_unit,
		coalesce(p_is_permanent, false),
		null,
		'internal',
		p_access_note,
		p_admin_id,
		p_admin_email,
		p_idempotency_key
	);

	business_id := v_business_id;
	owner_linked := v_owner_id is not null;
	return next;
end;
$$;

revoke all on function public.create_business_with_owner(text, text, text, integer, text, boolean, text, text, uuid, text, text)
	from public, anon, authenticated;
grant execute on function public.create_business_with_owner(text, text, text, integer, text, boolean, text, text, uuid, text, text)
	to service_role;

notify pgrst, 'reload schema';
commit;
