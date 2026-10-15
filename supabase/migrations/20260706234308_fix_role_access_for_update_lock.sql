-- Fix remote lint error:
-- "FOR UPDATE cannot be applied to the nullable side of an outer join".
-- Lock only the business_users row; the lateral professional lookup is read-only.

create or replace function public.upsert_business_role_access(
	target_business_id uuid,
	target_email text,
	target_role text,
	target_professional_id uuid default null
)
returns table(status text, membership_id uuid, invite_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor uuid := auth.uid();
	v_actor_role text;
	v_email text := lower(trim(coalesce(target_email, '')));
	v_target_user_id uuid;
	v_membership_id uuid;
	v_invite_id uuid;
	v_existing_role text;
	v_existing_professional_id uuid;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	v_actor_role := public.user_business_role(target_business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if v_email = '' or position('@' in v_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;
	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;
	if v_actor_role = 'admin' and target_role in ('owner','admin') then
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if target_role = 'professional' and target_professional_id is null then
		raise exception 'PROFESSIONAL_REQUIRED';
	end if;
	if target_professional_id is not null and not exists (
		select 1
		from professionals p
		where p.business_id = target_business_id
			and p.id = target_professional_id
	) then
		raise exception 'PROFESSIONAL_NOT_FOUND';
	end if;

	insert into allowed_emails (email, enabled, created_by, updated_by, disabled_at, disabled_reason, updated_at)
	values (v_email, true, v_actor, v_actor, null, null, now())
	on conflict (email) do update
	set
		enabled = true,
		disabled_at = null,
		disabled_reason = null,
		updated_by = v_actor,
		updated_at = now();

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = v_email
	limit 1;

	if target_role = 'professional' and exists (
		select 1
		from professional_users pu
		where pu.business_id = target_business_id
			and pu.professional_id = target_professional_id
			and (
				v_target_user_id is null
				or pu.user_id <> v_target_user_id
			)
	) then
		raise exception 'PROFESSIONAL_ALREADY_LINKED_TO_USER';
	end if;

	if v_target_user_id is not null then
		select bu.id, bu.role, pu.professional_id
		into v_membership_id, v_existing_role, v_existing_professional_id
		from business_users bu
		left join lateral (
			select professional_link.professional_id
			from professional_users professional_link
			where professional_link.business_id = bu.business_id
				and professional_link.user_id = bu.user_id
			order by professional_link.created_at asc
			limit 1
		) pu on true
		where bu.business_id = target_business_id
			and bu.user_id = v_target_user_id
		for update of bu;

		if v_actor_role = 'admin' and v_existing_role in ('owner','admin') then
			raise exception 'ADMIN_OWNER_ACTION_DENIED';
		end if;
		if v_existing_role = 'owner' and target_role <> 'owner'
			and public.count_active_business_owners(target_business_id) <= 1
		then
			raise exception 'LAST_OWNER_BLOCKED';
		end if;

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
			target_business_id,
			v_target_user_id,
			target_role,
			'active',
			now(),
			v_actor,
			v_actor
		)
		on conflict on constraint business_users_business_id_user_id_key
		do update set
			role = excluded.role,
			status = 'active',
			accepted_at = coalesce(business_users.accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = v_actor,
			updated_at = now()
		returning id into v_membership_id;

		if target_role = 'professional' then
			delete from professional_users pu
			where pu.business_id = target_business_id
				and (
					(pu.user_id = v_target_user_id and pu.professional_id <> target_professional_id)
					or (pu.professional_id = target_professional_id and pu.user_id <> v_target_user_id)
				);

			insert into professional_users (business_id, professional_id, user_id)
			values (target_business_id, target_professional_id, v_target_user_id)
			on conflict on constraint professional_users_business_id_professional_id_user_id_key do nothing;
		else
			delete from professional_users pu
			where pu.business_id = target_business_id
				and pu.user_id = v_target_user_id;
		end if;

		update business_user_invites bui
		set
			status = 'accepted',
			accepted_user_id = v_target_user_id,
			accepted_at = now(),
			updated_at = now()
		where bui.business_id = target_business_id
			and lower(bui.email) = v_email
			and bui.status = 'pending';

		status := case
			when v_existing_role = target_role
				and (target_role <> 'professional' or v_existing_professional_id = target_professional_id)
				then 'already_active'
			else 'active'
		end;
		membership_id := v_membership_id;
		invite_id := null;
		user_id := v_target_user_id;
		return next;
		return;
	end if;

	select bui.id, bui.role, bui.professional_id
	into v_invite_id, v_existing_role, v_existing_professional_id
	from business_user_invites bui
	where bui.business_id = target_business_id
		and lower(bui.email) = v_email
		and bui.status = 'pending'
	for update;

	if v_invite_id is not null then
		update business_user_invites bui
		set
			role = target_role,
			professional_id = target_professional_id,
			invited_by = v_actor,
			updated_at = now()
		where bui.id = v_invite_id;
	else
		insert into business_user_invites (
			business_id,
			email,
			role,
			professional_id,
			invited_by
		)
		values (
			target_business_id,
			v_email,
			target_role,
			target_professional_id,
			v_actor
		)
		returning id into v_invite_id;
	end if;

	status := case
		when v_existing_role = target_role
			and (target_role <> 'professional' or v_existing_professional_id = target_professional_id)
			then 'already_pending'
		else 'pending'
	end;
	membership_id := null;
	invite_id := v_invite_id;
	user_id := null;
	return next;
end;
$$;

revoke execute on function public.upsert_business_role_access(uuid, text, text, uuid) from public, anon;
grant execute on function public.upsert_business_role_access(uuid, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
