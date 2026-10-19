-- The manual patient task includes its professional link. Authenticated SQL owns
-- both effects; never insert first and attempt service-role HTTP compensation.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create function public.register_patient_safely(p_business_id uuid,p_patient_id uuid,p_full_name text,p_dni text,p_phone text,p_phone_raw text,p_phone_e164 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_actor uuid:=auth.uid();v_role text;v_support uuid;v_professional uuid;v_patient uuid;v_duplicate boolean:=false;v_link uuid;
 v_name text:=regexp_replace(trim(coalesce(p_full_name,'')),'\s+',' ','g');v_dni text:=nullif(trim(coalesce(p_dni,'')),'');
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
 select bu.role into v_role from public.business_users bu
 where bu.business_id=p_business_id and bu.user_id=v_actor and bu.status='active' and bu.accepted_at is not null and bu.disabled_at is null for share;
 select g.id into v_support from public.account_assistance_support_users s join public.account_assistance_grants g on g.support_user_id=s.user_id
 where s.user_id=v_actor and s.enabled and g.business_id=p_business_id and g.status='active' and g.revoked_at is null and g.expires_at>now() for share of s,g;
 if v_support is not null and v_role is distinct from 'owner' then v_role:='admin'; end if;
 if coalesce(v_role,'') not in ('owner','admin','reception','professional') then raise exception 'PATIENT_CREATE_DENIED'; end if;
 perform 1 from public.business_subscriptions bs where bs.business_id=p_business_id for share;
 if not coalesce(public.business_allows_operation(p_business_id),false) then raise exception 'BUSINESS_ACCESS_RESTRICTED'; end if;
 if p_patient_id is null or length(v_name) not between 1 and 500 or length(coalesce(p_dni,''))>100 or length(coalesce(p_phone,''))>100 or length(coalesce(p_phone_raw,''))>200 or length(coalesce(p_phone_e164,''))>100 then raise exception 'PATIENT_INPUT_INVALID'; end if;
 if v_role='professional' then
  select pu.professional_id into v_professional from public.professional_users pu where pu.business_id=p_business_id and pu.user_id=v_actor order by pu.created_at,pu.id limit 1 for share;
  if v_professional is null then raise exception 'PROFESSIONAL_LINK_REQUIRED'; end if;
 end if;
 -- Match the existing identity trigger's lock. Names and phones stay non-unique.
 if v_dni is not null then
  perform pg_advisory_xact_lock(hashtextextended('patients:dni:'||p_business_id::text||':'||v_dni,0));
  select p.id into v_patient from public.patients p where p.business_id=p_business_id and p.dni=v_dni for no key update;
  v_duplicate:=v_patient is not null;
 end if;
 if v_patient is null then
  insert into public.patients(id,business_id,owner_id,full_name,dni,phone,phone_raw,phone_e164)
  values(p_patient_id,p_business_id,v_actor,v_name,v_dni,nullif(trim(p_phone),''),p_phone_raw,p_phone_e164);
  v_patient:=p_patient_id;
 end if;
 if v_professional is not null then
  select l.id into v_link from public.professional_patient_links l where l.business_id=p_business_id and l.professional_id=v_professional and l.patient_id=v_patient
   order by l.is_active desc,l.created_at,l.id limit 1 for update;
  if v_link is null then
   insert into public.professional_patient_links(business_id,professional_id,patient_id,source,created_by)
   values(p_business_id,v_professional,v_patient,'manual',v_actor);
  else
   update public.professional_patient_links set is_active=true,source='manual',disabled_by=null,disabled_at=null,disabled_reason=null,updated_at=clock_timestamp() where id=v_link;
  end if;
 end if;
 return jsonb_build_object('patientId',v_patient,'duplicate',v_duplicate);
end $$;
revoke all on function public.register_patient_safely(uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.register_patient_safely(uuid,uuid,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
