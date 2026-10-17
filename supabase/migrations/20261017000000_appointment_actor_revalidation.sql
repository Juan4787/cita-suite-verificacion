-- The server has already authenticated the actor, but its preflight precedes
-- the atomic RPC. Revalidate manual creation/recovery before exposing any row.
-- No signature, return contract, patient identity or pricing logic changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function public.create_appointment_with_patient_identity(
 p_business_id uuid,
 p_patient_mode text,
 p_patient_id uuid,
 p_patient_name text,
 p_patient_phone_raw text,
 p_patient_phone_e164 text,
 p_patient_email text,
 p_update_existing_phone boolean,
 p_owner_id uuid,
 p_service_id uuid,
 p_professional_ids uuid[],
 p_starts_at timestamptz,
 p_internal_note text,
 p_created_by_user_id uuid,
 p_ignore_break boolean,
 p_source text,
 p_phone_communication_status text,
 p_phone_warning_acknowledged boolean,
 p_idempotency_key text,
 p_replay_only boolean default false
)
returns table (
 id uuid, patient_id uuid, confirmation_token text, starts_at timestamptz, ends_at timestamptz,
 service_name_snapshot text, professional_name_snapshot text, patient_created boolean,
 idempotent_replay boolean, patient_resolution_strategy text
)
language plpgsql security definer set search_path=pg_catalog,pg_temp
as $function$
declare
 actor public.business_users%rowtype;
begin
 if coalesce(nullif(btrim(p_source),''),'manual') in('manual','admin') then
  -- FOR SHARE serializes a concurrent role/revocation UPDATE with creation.
  -- The application cannot supply another actor: this entry point remains
  -- service-role only, and the route supplies the verified identity.
  select * into actor from public.business_users bu
  where bu.business_id=p_business_id and bu.user_id=p_created_by_user_id
  for share;
  if not found or actor.role not in('owner','admin','reception') or actor.status is distinct from 'active'
   or actor.accepted_at is null or actor.disabled_at is not null then
   raise exception 'APPOINTMENT_CREATOR_INVALID';
  end if;
 end if;
 perform set_config('cita.booking_professional_ids',coalesce(p_professional_ids,'{}'::uuid[])::text,true);
 return query select * from public.create_appointment_with_patient_identity_before_pricing(
  p_business_id,p_patient_mode,p_patient_id,p_patient_name,p_patient_phone_raw,p_patient_phone_e164,p_patient_email,
  p_update_existing_phone,p_owner_id,p_service_id,p_professional_ids,p_starts_at,p_internal_note,p_created_by_user_id,
  p_ignore_break,p_source,p_phone_communication_status,p_phone_warning_acknowledged,p_idempotency_key,p_replay_only
 );
end;
$function$;
revoke all on function public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
