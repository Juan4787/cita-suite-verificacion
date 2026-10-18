-- Keep the existing signature, return type and global owner/admin behavior.
-- Professional archiving affects only the caller's active patient link, never
-- the patient's global archive or another professional's list.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.set_patient_archive_state_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_assistance uuid;
	v_professional uuid;
begin
	if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
	if p_archived is null then raise exception 'PATIENT_ARCHIVE_INVALID'; end if;

	-- Serialize role changes/revocation with the effect, not just the route's
	-- preflight. Do not lock the clinic itself or other actors' memberships.
	select bu.role into v_role
	from public.business_users bu
	where bu.business_id = p_business_id and bu.user_id = v_actor
		and coalesce(bu.status, 'active') = 'active'
		and bu.accepted_at is not null and bu.disabled_at is null
	for share;

	-- Assistance already has admin scope in user_business_role. Preserve it,
	-- including revocation of either the grant or the support account.
	select grants.id into v_assistance
	from public.account_assistance_support_users support
	join public.account_assistance_grants grants on grants.support_user_id = support.user_id
	where support.user_id = v_actor and support.enabled = true
		and grants.business_id = p_business_id and grants.status = 'active'
		and grants.revoked_at is null and grants.expires_at > now()
	for share of support, grants;
	if v_assistance is not null and v_role is distinct from 'owner' then v_role := 'admin'; end if;
	if coalesce(v_role, '') not in ('owner', 'admin', 'professional') then
		raise exception 'PATIENT_ARCHIVE_DENIED';
	end if;

	perform 1 from public.business_subscriptions bs where bs.business_id = p_business_id for share;
	if not coalesce(public.business_allows_operation(p_business_id), false) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	if v_role = 'professional' then
		select pu.professional_id into v_professional
		from public.professional_users pu
		where pu.business_id = p_business_id and pu.user_id = v_actor
		order by pu.created_at, pu.id limit 1 for share;
		if v_professional is null then raise exception 'PROFESSIONAL_LINK_REQUIRED'; end if;
		-- UPDATE rechecks is_active after waiting for a concurrent link change.
		update public.professional_patient_links links
		set archived_at = case when p_archived then coalesce(links.archived_at, now()) else null end,
			archived_by = case when p_archived then coalesce(links.archived_by, v_actor) else null end,
			updated_at = now()
		where links.business_id = p_business_id and links.patient_id = p_patient_id
			and links.professional_id = v_professional and links.is_active = true;
		if not found then raise exception 'PROFESSIONAL_PATIENT_LINK_REQUIRED'; end if;
		return;
	end if;

	update public.patients p
	set archived_at = case when p_archived then coalesce(p.archived_at, now()) else null end,
		updated_at = now()
	where p.business_id = p_business_id and p.id = p_patient_id;
	if not found then raise exception 'PATIENT_NOT_FOUND'; end if;
end;
$function$;
revoke execute on function public.set_patient_archive_state_safely(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_patient_archive_state_safely(uuid, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
