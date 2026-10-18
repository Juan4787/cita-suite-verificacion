-- Team commands are authenticated, actor-scoped transactions. No administrative
-- HTTP cleanup, partial service assignment or frontend dependency preflight is
-- an authority for these effects. Existing tables, identifiers and RPCs survive.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function private.lock_team_manager_authority(p_business_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_actor uuid := auth.uid(); v_role text; v_assistance uuid;
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
 select bu.role into v_role from public.business_users bu
 where bu.business_id=p_business_id and bu.user_id=v_actor and bu.status='active'
  and bu.accepted_at is not null and bu.disabled_at is null for share;
 select grants.id into v_assistance
 from public.account_assistance_support_users support
 join public.account_assistance_grants grants on grants.support_user_id=support.user_id
 where support.user_id=v_actor and support.enabled=true and grants.business_id=p_business_id
  and grants.status='active' and grants.revoked_at is null and grants.expires_at>now()
 for share of support, grants;
 if v_assistance is not null and v_role is distinct from 'owner' then v_role:='admin'; end if;
 if coalesce(v_role,'') not in ('owner','admin') then raise exception 'TEAM_ACCESS_DENIED'; end if;
 perform 1 from public.business_subscriptions where business_id=p_business_id for share;
 if not coalesce(public.business_allows_operation(p_business_id),false) then
  raise exception 'BUSINESS_ACCESS_RESTRICTED';
 end if;
end $$;
revoke all on function private.lock_team_manager_authority(uuid) from public, anon, authenticated, service_role;

create function public.create_professional_service_safely(
 p_business_id uuid,p_professional_id uuid,p_service_id uuid,p_name text,p_duration_minutes integer,p_price_label text
) returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.lock_team_manager_authority(p_business_id);
 if p_service_id is null or coalesce(length(trim(p_name)),0)=0
  or p_duration_minutes is null or p_duration_minutes not between 5 and 480 then
  raise exception 'TEAM_SERVICE_INVALID';
 end if;
 perform 1 from public.businesses where id=p_business_id for no key update;
 -- Insertion does not update the target. KEY SHARE also serializes deletion.
 perform 1 from public.professionals where id=p_professional_id and business_id=p_business_id for key share;
 if not found then raise exception 'TEAM_PROFESSIONAL_NOT_FOUND'; end if;
 if exists(select 1 from public.services where id=p_service_id) then
  if exists(select 1 from public.services s join public.professional_services ps on ps.business_id=s.business_id and ps.service_id=s.id
   where s.id=p_service_id and s.business_id=p_business_id and ps.professional_id=p_professional_id
    and s.name=trim(p_name) and s.duration_minutes=p_duration_minutes and s.price_label is not distinct from nullif(trim(p_price_label),'')) then
   return p_service_id;
  end if;
  raise exception 'TEAM_SERVICE_REQUEST_CONFLICT';
 end if;
 insert into public.services(id,business_id,name,duration_minutes,price_label,description,buffer_before_minutes,buffer_after_minutes,is_public,is_active)
 values(p_service_id,p_business_id,trim(p_name),p_duration_minutes,nullif(trim(p_price_label),''),null,0,0,true,true);
 insert into public.professional_services(business_id,professional_id,service_id)
 values(p_business_id,p_professional_id,p_service_id);
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(p_business_id,auth.uid(),'service.created_from_professional','service',p_service_id,jsonb_build_object('professional_id',p_professional_id));
 return p_service_id;
end $$;
revoke all on function public.create_professional_service_safely(uuid,uuid,uuid,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.create_professional_service_safely(uuid,uuid,uuid,text,integer,text) to authenticated;

create function public.get_professional_dependency_counts(p_business_id uuid,p_professional_id uuid)
returns table(appointment_count bigint,clinical_entry_count bigint,follow_up_count bigint)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.lock_team_manager_authority(p_business_id);
 if not exists(select 1 from public.professionals where id=p_professional_id and business_id=p_business_id) then raise exception 'TEAM_PROFESSIONAL_NOT_FOUND'; end if;
 return query select
  (select count(*) from (select a.id from public.appointments a where a.business_id=p_business_id and a.professional_id=p_professional_id
   union select ap.appointment_id from public.appointment_professionals ap where ap.business_id=p_business_id and ap.professional_id=p_professional_id) appointments),
  (select count(*) from public.clinical_entries ce where ce.business_id=p_business_id and ce.created_by_professional_id=p_professional_id),
  (select count(*) from public.follow_ups fu where fu.business_id=p_business_id and fu.assigned_professional_id=p_professional_id);
end $$;
revoke all on function public.get_professional_dependency_counts(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_professional_dependency_counts(uuid,uuid) to authenticated;

create function public.delete_professional_safely(p_business_id uuid,p_professional_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.lock_team_manager_authority(p_business_id);
 perform 1 from public.businesses where id=p_business_id for no key update;
 -- Never wait while holding the business lock for a child transaction's FK
 -- KEY SHARE. It may itself be waiting to advance the business revision.
 -- Fail before any cleanup instead of creating that lock inversion.
 perform 1 from public.professionals where id=p_professional_id and business_id=p_business_id for update nowait;
 if not found then raise exception 'TEAM_PROFESSIONAL_NOT_FOUND'; end if;
 if exists(select 1 from public.appointments where business_id=p_business_id and professional_id=p_professional_id)
  or exists(select 1 from public.appointment_professionals where business_id=p_business_id and professional_id=p_professional_id)
  or exists(select 1 from public.clinical_entries where business_id=p_business_id and created_by_professional_id=p_professional_id)
  or exists(select 1 from public.follow_ups where business_id=p_business_id and assigned_professional_id=p_professional_id) then
  raise exception 'TEAM_PROFESSIONAL_HAS_HISTORY';
 end if;
 perform set_config('cita.schedule_replace','true',true);
 update public.patient_profile_change_events set changed_by_professional_id=null where business_id=p_business_id and changed_by_professional_id=p_professional_id;
 delete from public.business_user_invites where business_id=p_business_id and professional_id=p_professional_id;
 -- All remaining current configuration has FK cascades. Clinical authorship
 -- is historical and deliberately has no delete cascade.
 delete from public.professionals where business_id=p_business_id and id=p_professional_id;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id)
 values(p_business_id,auth.uid(),'professional.deleted','professional',p_professional_id);
end $$;
revoke all on function public.delete_professional_safely(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_professional_safely(uuid,uuid) to authenticated;

-- Preserve OID/ACL and the historical-author contract.
CREATE OR REPLACE FUNCTION public.set_clinical_entry_actor_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, pg_temp
AS $function$
declare
	v_role text;
	v_professional_id uuid;
begin
	if tg_op = 'INSERT' then
		if auth.uid() is not null then
			v_role := public.user_business_role(new.business_id);
			new.owner_id := auth.uid();
			new.created_by_user_id := auth.uid();

			if v_role = 'professional' then
				v_professional_id := public.current_user_professional_id(new.business_id);
				if v_professional_id is null then
					raise exception 'PROFESSIONAL_LINK_REQUIRED';
				end if;
				new.created_at := now();
				new.created_by_professional_id := v_professional_id;
			else
				if v_role in ('owner', 'admin') and new.created_at > now() + interval '5 minutes' then
					raise exception 'INVALID_CLINICAL_ENTRY_DATE';
				end if;
				new.created_by_professional_id := null;
			end if;
		end if;
		new.created_at := coalesce(new.created_at, now());
		new.locked_after := coalesce(new.locked_after, new.created_at + interval '24 hours');
	end if;

	if tg_op = 'UPDATE' and auth.uid() is not null then
		if new.created_by_user_id is distinct from old.created_by_user_id
			or new.created_by_professional_id is distinct from old.created_by_professional_id
			or new.owner_id is distinct from old.owner_id then
			raise exception using errcode = '42501', message = 'CLINICAL_PROVENANCE_IMMUTABLE';
		end if;
		new.updated_by_user_id := auth.uid();
	end if;

	-- This is a historical author reference, not a live FK: deleting an old
	-- professional must not erase provenance or prevent content corrections.
	-- A newly assigned reference must still belong to the same clinic.
	if new.created_by_professional_id is not null then
		if tg_op = 'INSERT' then
			if not exists (select 1 from public.professionals p where p.id = new.created_by_professional_id and p.business_id = new.business_id for key share) then
				raise exception using errcode = '23503', message = 'CLINICAL_AUTHOR_TENANT_MISMATCH';
			end if;
		elsif new.created_by_professional_id is distinct from old.created_by_professional_id
			or new.business_id is distinct from old.business_id then
			if not exists (select 1 from public.professionals p where p.id = new.created_by_professional_id and p.business_id = new.business_id for key share) then
				raise exception using errcode = '23503', message = 'CLINICAL_AUTHOR_TENANT_MISMATCH';
			end if;
		end if;
	end if;
	return new;
end;
$function$;


notify pgrst,'reload schema';
commit;
