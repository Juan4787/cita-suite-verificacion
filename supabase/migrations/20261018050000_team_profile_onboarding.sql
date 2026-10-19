-- Whole Equipo user tasks: profession, services, schedule and access are one
-- transaction. No service-role HTTP rollback or success with missing defaults.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function private.assign_team_default_services(p_business_id uuid,p_professional_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_name text; v_service uuid;
begin
 -- Caller owns the business configuration lock and has verified the authority.
 for v_name in select unnest(array['Consulta','Otro servicio']) loop
  select s.id into v_service from public.services s where s.business_id=p_business_id and lower(trim(s.name))=lower(v_name) order by s.created_at,s.id limit 1;
  if v_service is null then
   insert into public.services(business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,is_active,is_public)
   values(p_business_id,v_name,30,0,0,true,true) returning id into v_service;
  else
   update public.services set is_active=true,is_public=true,updated_at=clock_timestamp()
   where business_id=p_business_id and id=v_service and (not is_active or not is_public);
  end if;
  insert into public.professional_services(business_id,professional_id,service_id)
  values(p_business_id,p_professional_id,v_service) on conflict do nothing;
 end loop;
end $$;
revoke all on function private.assign_team_default_services(uuid,uuid) from public,anon,authenticated,service_role;

create function public.create_team_member_profile(p_business_id uuid,p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_professional uuid; v_email text; v_role text; v_service uuid; v_item jsonb; v_ids uuid[]; v_revision bigint; v_status text; v_exception jsonb;
begin
 perform private.lock_team_manager_authority(p_business_id);
 if jsonb_typeof(p_configuration) is distinct from 'object' or octet_length(p_configuration::text)>200000 then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
 if jsonb_typeof(p_configuration->'professionalId') is distinct from 'string' or jsonb_typeof(p_configuration->'email') is distinct from 'string' or jsonb_typeof(p_configuration->'role') is distinct from 'string' or jsonb_typeof(p_configuration->'name') is distinct from 'string' then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
 v_email:=lower(trim(p_configuration->>'email'));v_role:=p_configuration->>'role';
 if coalesce(v_role,'') not in ('owner','admin','professional') then raise exception 'PROFESSIONAL_ROLE_NOT_SUPPORTED'; end if;
 if coalesce(length(trim(p_configuration->>'name')),0) not between 1 and 160 then raise exception 'SCHEDULE_PROFILE_INVALID'; end if;
 -- Take the existing schedule commands' strongest business lock at entry,
 -- before any child FK locks; do not upgrade it after inserting children.
 perform 1 from public.businesses where id=p_business_id for update;
 v_professional:=(p_configuration->>'professionalId')::uuid;
 if v_professional is null then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
 insert into public.professionals(id,business_id,name,specialty,email,is_active,is_public)
 values(v_professional,p_business_id,trim(p_configuration->>'name'),nullif(trim(p_configuration->>'specialty'),''),v_email,true,false);
 perform private.assign_team_default_services(p_business_id,v_professional);
 if jsonb_typeof(p_configuration->'serviceIds') is distinct from 'array' or jsonb_array_length(p_configuration->'serviceIds')>500
  or jsonb_typeof(p_configuration->'newServices') is distinct from 'array' or jsonb_array_length(p_configuration->'newServices')>500 or jsonb_array_length(p_configuration->'serviceIds')+jsonb_array_length(p_configuration->'newServices')>500 then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
 for v_item in select value from jsonb_array_elements(p_configuration->'serviceIds') loop
  v_service:=(v_item#>>'{}')::uuid;
  if v_service is null or not exists(select 1 from public.services where business_id=p_business_id and id=v_service) then raise exception 'INVALID_SERVICE_ASSIGNMENT'; end if;
  insert into public.professional_services(business_id,professional_id,service_id) values(p_business_id,v_professional,v_service) on conflict do nothing;
 end loop;
 for v_item in select value from jsonb_array_elements(p_configuration->'newServices') loop
  if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'name') is distinct from 'string' or coalesce(length(trim(v_item->>'name')),0)=0 then raise exception 'NEW_SERVICE_NAME_REQUIRED'; end if;
  if jsonb_typeof(v_item->'duration_minutes') is distinct from 'number' or (v_item->>'duration_minutes')::numeric<>trunc((v_item->>'duration_minutes')::numeric)
   or (v_item->>'duration_minutes')::numeric not between 5 and 480 then raise exception 'NEW_SERVICE_DURATION_INVALID'; end if;
  insert into public.services(business_id,name,duration_minutes,price_label,description,buffer_before_minutes,buffer_after_minutes,is_active,is_public)
  values(p_business_id,trim(v_item->>'name'),(v_item->>'duration_minutes')::numeric::integer,nullif(trim(v_item->>'price_label'),''),null,0,0,true,true) returning id into v_service;
  insert into public.professional_services(business_id,professional_id,service_id) values(p_business_id,v_professional,v_service);
 end loop;
 select booking_availability_revision into v_revision from public.businesses where id=p_business_id;
 perform public.replace_professional_schedule_blocks(p_business_id,v_professional,v_revision,p_configuration->'blocks');
 v_exception:=p_configuration->'exception';
 if v_exception is not null and jsonb_typeof(v_exception)<>'null' then
  if jsonb_typeof(v_exception) is distinct from 'object' or coalesce(v_exception->>'appliesTo','') not in ('business','professional') then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
  select booking_availability_revision into v_revision from public.businesses where id=p_business_id;
  perform public.create_availability_exception_batch(p_business_id,v_revision,gen_random_uuid(),jsonb_build_array(jsonb_build_object(
   'professional_id',case when v_exception->>'appliesTo'='business' then null else v_professional end,
   'type',v_exception->>'type','starts_at',v_exception->>'startsAt','ends_at',v_exception->>'endsAt','reason',v_exception->>'reason','service_ids','[]'::jsonb)),false);
 end if;
 select access.status into v_status from public.upsert_business_role_access(p_business_id,v_email,v_role,v_professional) access;
 if coalesce(v_status,'') not in ('active','pending','already_active','already_pending') then raise exception 'TEAM_CONFIGURATION_INVALID'; end if;
 update public.professionals set is_public=v_status in ('active','already_active'),updated_at=clock_timestamp() where business_id=p_business_id and id=v_professional;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(p_business_id,auth.uid(),'professional.created','professional',v_professional,jsonb_build_object(
  'name',trim(p_configuration->>'name'),'email',v_email,
  'schedule_blocks',(select jsonb_agg(jsonb_build_object('weekdays',block->'weekdays','ranges',block->'ranges',
   'slotIntervalMinutes',block->'slot_interval_minutes','breakMinutes',block->'break_minutes','serviceScope',block->'service_scope','allowedServiceIds',block->'service_ids')) from jsonb_array_elements(p_configuration->'blocks') block),
  'service_ids',(select coalesce(jsonb_agg(ps.service_id order by ps.service_id),'[]'::jsonb) from public.professional_services ps where ps.business_id=p_business_id and ps.professional_id=v_professional)));
 return jsonb_build_object('status',v_status,'professionalId',v_professional);
end $$;
revoke all on function public.create_team_member_profile(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_team_member_profile(uuid,jsonb) to authenticated;

create function public.make_team_member_attending(p_business_id uuid,p_access_id uuid,p_name text)
returns uuid language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text;v_user uuid;v_profile uuid;v_actor_role text;v_email text;v_pending boolean:=false;
begin
 perform private.lock_team_manager_authority(p_business_id);
 if coalesce(length(trim(p_name)),0) not between 1 and 160 then raise exception 'SCHEDULE_PROFILE_INVALID'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 select bu.role,bu.user_id,u.email into v_role,v_user,v_email from public.business_users bu join auth.users u on u.id=bu.user_id
 where bu.business_id=p_business_id and bu.id=p_access_id and bu.status='active' and bu.accepted_at is not null and bu.disabled_at is null for update of bu nowait;
 if found then
  if exists(select 1 from public.professional_users where business_id=p_business_id and user_id=v_user) then raise exception 'TEAM_PROFILE_ALREADY_EXISTS'; end if;
 else
  select bi.role,bi.professional_id,bi.email into v_role,v_profile,v_email from public.business_user_invites bi
  where bi.business_id=p_business_id and bi.id=p_access_id and bi.status='pending' for update nowait;
  if not found then raise exception 'BUSINESS_USER_NOT_FOUND'; end if;
  if v_profile is not null then raise exception 'TEAM_PROFILE_ALREADY_EXISTS'; end if;
  v_pending:=true;
 end if;
 if coalesce(v_role,'') not in ('owner','admin') then raise exception 'PROFESSIONAL_ROLE_NOT_SUPPORTED'; end if;
 v_actor_role:=public.user_business_role(p_business_id);
 if v_actor_role='admin' and v_role='owner' and not public.user_has_active_account_assistance(p_business_id) then raise exception 'ADMIN_OWNER_ACTION_DENIED'; end if;
 insert into public.professionals(business_id,name,is_active,is_public)
 values(p_business_id,trim(p_name),true,not v_pending) returning id into v_profile;
 if v_pending then
  update public.business_user_invites set professional_id=v_profile,updated_at=clock_timestamp() where business_id=p_business_id and id=p_access_id;
 else
  insert into public.professional_users(business_id,professional_id,user_id) values(p_business_id,v_profile,v_user);
 end if;
 perform private.assign_team_default_services(p_business_id,v_profile);
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata) values(p_business_id,auth.uid(),'professional.created_attending','professional',v_profile,jsonb_build_object('user_id',v_user,'email',v_email,'account_status',case when v_pending then 'pending' else 'active' end,'role',v_role,'name',trim(p_name)));
 return v_profile;
end $$;
revoke all on function public.make_team_member_attending(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.make_team_member_attending(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
