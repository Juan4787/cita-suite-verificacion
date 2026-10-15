-- A person may belong to only one consultorio. Enforce that rule where an
-- email becomes an access association, including invitations for users who
-- have not created their Auth account yet.
--
-- Existing historical cross-business rows are deliberately preserved. This
-- migration prevents new associations without silently deleting access.

create index if not exists business_user_invites_pending_normalized_email_idx
	on public.business_user_invites (lower(trim(email)))
	where status = 'pending';

create or replace function public.assert_email_available_for_business(
	target_business_id uuid,
	target_email text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_email text := lower(trim(coalesce(target_email, '')));
begin
	if v_email = '' then
		return;
	end if;

	-- Serialize checks from both tables. Without this, two simultaneous
	-- invitations for the same email could both pass before either commits.
	perform pg_advisory_xact_lock(
		hashtextextended('business-email-association:' || v_email, 0)
	);

	if exists (
		select 1
		from public.business_user_invites invite
		where invite.business_id <> target_business_id
			and invite.status = 'pending'
			and lower(trim(invite.email)) = v_email
	) then
		raise exception 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS';
	end if;

	if exists (
		select 1
		from public.business_users membership
		join auth.users account on account.id = membership.user_id
		where membership.business_id <> target_business_id
			and coalesce(membership.status, 'active') = 'active'
			and lower(trim(coalesce(account.email, ''))) = v_email
	) then
		raise exception 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS';
	end if;
end;
$$;

create or replace function public.prevent_cross_business_invite_email_association()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
	if new.status = 'pending' then
		new.email := lower(trim(new.email));
		perform public.assert_email_available_for_business(new.business_id, new.email);
	end if;
	return new;
end;
$$;

create or replace function public.prevent_cross_business_user_email_association()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_email text;
begin
	if coalesce(new.status, 'active') <> 'active' then
		return new;
	end if;

	select lower(trim(coalesce(account.email, '')))
	into v_email
	from auth.users account
	where account.id = new.user_id;

	if coalesce(v_email, '') <> '' then
		perform public.assert_email_available_for_business(new.business_id, v_email);
	end if;

	return new;
end;
$$;

drop trigger if exists trg_prevent_cross_business_invite_email_association
	on public.business_user_invites;
create trigger trg_prevent_cross_business_invite_email_association
	before insert or update of business_id, email, status
	on public.business_user_invites
	for each row
	execute function public.prevent_cross_business_invite_email_association();

drop trigger if exists trg_prevent_cross_business_user_email_association
	on public.business_users;
create trigger trg_prevent_cross_business_user_email_association
	before insert or update of business_id, user_id, status
	on public.business_users
	for each row
	execute function public.prevent_cross_business_user_email_association();

revoke execute on function public.assert_email_available_for_business(uuid, text)
	from public, anon, authenticated;
revoke execute on function public.prevent_cross_business_invite_email_association()
	from public, anon, authenticated;
revoke execute on function public.prevent_cross_business_user_email_association()
	from public, anon, authenticated;

notify pgrst, 'reload schema';
