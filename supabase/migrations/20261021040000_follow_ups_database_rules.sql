-- Follow-ups were locked to the server (20260831065000) because their old policies let
-- any member read or change any follow-up. Since then the server enforced the scope
-- with the service role, in separate steps: read the row, check the patient link,
-- then update. The rules move to the database, which owns permissions in this
-- campaign. Reads go under row level security, filtered before any limit. Each change
-- is one function that checks the actor, the patient link, the practice's operation
-- and the version in a single transaction. Read access follows the patients' rule: a
-- restricted practice keeps it for its owners and administrators only.
begin;

-- Practices where the actor reads every follow-up: owners and administrators (an
-- active assistance included) under the restricted read, reception while it operates.
create function public.user_follow_up_reader_business_ids() returns uuid[]
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(array_agg(candidate.business_id),'{}') from (
  select bu.business_id from public.business_users bu
  where bu.user_id=auth.uid() and coalesce(bu.status,'active')='active' and bu.accepted_at is not null
  union
  select aag.business_id from public.account_assistance_grants aag
  where aag.support_user_id=auth.uid() and aag.status='active' and aag.revoked_at is null and aag.expires_at>now()
 ) candidate
 where case public.user_business_role(candidate.business_id)
  when 'owner' then public.business_allows_owner_restricted_read(candidate.business_id)
  when 'admin' then public.business_allows_owner_restricted_read(candidate.business_id)
  when 'reception' then public.business_allows_operation(candidate.business_id)
  else false end
$$;

-- What a professional reads: follow-ups assigned to one of their profiles for a
-- patient that profile is still actively linked to, in a practice that operates.
create function public.user_follow_up_assignments() returns table(business_id uuid, professional_id uuid, patient_id uuid)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select link.business_id,link.professional_id,link.patient_id
 from public.professional_patient_links link
 join public.professional_users pu on pu.business_id=link.business_id and pu.professional_id=link.professional_id
 where pu.user_id=auth.uid() and link.is_active=true
  and public.user_business_role(link.business_id)='professional' and public.business_allows_operation(link.business_id)
$$;

revoke all on function public.user_follow_up_reader_business_ids(),public.user_follow_up_assignments() from public,anon;
grant execute on function public.user_follow_up_reader_business_ids(),public.user_follow_up_assignments() to authenticated,service_role;

-- The scalar subquery is an InitPlan, evaluated once per statement; the triples are a
-- non-correlated subquery that PostgreSQL hashes once.
create policy follow_ups_role_scoped_select on public.follow_ups for select to authenticated
using (
 business_id=any((select public.user_follow_up_reader_business_ids())::uuid[])
 or (business_id,assigned_professional_id,patient_id) in
  (select a.business_id,a.professional_id,a.patient_id from public.user_follow_up_assignments() a)
);
grant select on public.follow_ups to authenticated;

-- Whether a professional may receive a follow-up of the patient: an active profile
-- linked to the patient, or the attending profile of an owner or administrator.
create function private.follow_up_can_receive(p_business_id uuid, p_professional_id uuid, p_patient_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from public.professionals p where p.business_id=p_business_id and p.id=p_professional_id and p.is_active is distinct from false)
  and (exists(select 1 from public.professional_patient_links link where link.business_id=p_business_id
        and link.professional_id=p_professional_id and link.patient_id=p_patient_id and link.is_active=true)
   or exists(select 1 from public.professional_users pu join public.business_users bu on bu.business_id=pu.business_id and bu.user_id=pu.user_id
        where pu.business_id=p_business_id and pu.professional_id=p_professional_id and bu.status='active' and bu.role in ('owner','admin')))
$$;

-- The actor of a change: their role, the practice's local day and, for a professional,
-- the profile that acts (the first one, as the server resolved it). The membership row
-- is locked, so a revocation waits for the change or applies before it.
create function private.follow_up_actor(p_business_id uuid, out actor_role text, out today date, out acting_professional_id uuid)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 actor_role:=public.user_business_role(p_business_id);
 if actor_role is null or actor_role not in ('owner','admin','reception','professional') then raise exception 'FOLLOWUP_FORBIDDEN'; end if;
 perform 1 from public.business_users bu where bu.business_id=p_business_id and bu.user_id=auth.uid()
  and coalesce(bu.status,'active')='active' and bu.accepted_at is not null for share;
 if not public.business_allows_operation(p_business_id) then raise exception 'FOLLOWUP_ACCESS_EXPIRED'; end if;
 select (now() at time zone b.timezone)::date into today from public.businesses b where b.id=p_business_id;
 if actor_role='professional' then
  select pu.professional_id into acting_professional_id from public.professional_users pu
  where pu.business_id=p_business_id and pu.user_id=auth.uid() order by pu.created_at,pu.professional_id limit 1;
 end if;
end $$;

-- A pending follow-up the actor may change, locked, at the version the actor read.
create function private.follow_up_for_change(p_business_id uuid, p_follow_up_id uuid, p_expected_updated_at timestamptz,
 p_role text, p_acting_professional_id uuid) returns public.follow_ups
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_row public.follow_ups;
begin
 select * into v_row from public.follow_ups f where f.business_id=p_business_id and f.id=p_follow_up_id for update;
 if not found or v_row.status<>'pending' then raise exception 'FOLLOWUP_NOT_FOUND'; end if;
 if p_role='professional' then
  if p_acting_professional_id is null or v_row.assigned_professional_id is distinct from p_acting_professional_id then
   raise exception 'FOLLOWUP_FORBIDDEN';
  end if;
  perform 1 from public.professional_patient_links link where link.business_id=p_business_id
   and link.professional_id=p_acting_professional_id and link.patient_id=v_row.patient_id and link.is_active=true for share;
  if not found then raise exception 'FOLLOWUP_FORBIDDEN'; end if;
 end if;
 -- The client sends back the version it read; a second of tolerance absorbs the
 -- precision of its serialization, as before.
 if p_expected_updated_at is null or abs(extract(epoch from v_row.updated_at-p_expected_updated_at))>1 then
  raise exception 'FOLLOWUP_STATUS_CONFLICT';
 end if;
 return v_row;
end $$;

-- The professional a change assigns: a professional assigns their own profile, which
-- must be linked to the patient; the others choose one that may receive it.
create function private.follow_up_assignee(p_business_id uuid, p_patient_id uuid, p_role text, p_acting_professional_id uuid,
 p_assigned_professional_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_role='professional' then
  if p_acting_professional_id is null then raise exception 'FOLLOWUP_PROFESSIONAL_PROFILE_REQUIRED'; end if;
  perform 1 from public.professional_patient_links link where link.business_id=p_business_id
   and link.professional_id=p_acting_professional_id and link.patient_id=p_patient_id and link.is_active=true for share;
  if not found then raise exception 'FOLLOWUP_PATIENT_NOT_YOURS'; end if;
  return p_acting_professional_id;
 end if;
 if p_assigned_professional_id is null then raise exception 'FOLLOWUP_ASSIGN_REQUIRED'; end if;
 if not private.follow_up_can_receive(p_business_id,p_assigned_professional_id,p_patient_id) then
  raise exception 'FOLLOWUP_PROFESSIONAL_NOT_LINKED';
 end if;
 return p_assigned_professional_id;
end $$;

create function private.follow_up_message(p_message text) returns text
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
 if length(btrim(coalesce(p_message,'')))>500 then raise exception 'FOLLOWUP_MESSAGE_TOO_LONG'; end if;
 return nullif(btrim(coalesce(p_message,'')),'');
end $$;

revoke all on function private.follow_up_can_receive(uuid,uuid,uuid),private.follow_up_actor(uuid),
 private.follow_up_for_change(uuid,uuid,timestamptz,text,uuid),private.follow_up_assignee(uuid,uuid,text,uuid,uuid),
 private.follow_up_message(text) from public,anon,authenticated,service_role;

create function public.create_follow_up(p_business_id uuid, p_patient_id uuid, p_remind_on date, p_message text,
 p_assigned_professional_id uuid default null) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_actor record; v_message text; v_assignee uuid; v_id uuid;
begin
 select * into v_actor from private.follow_up_actor(p_business_id);
 if p_remind_on is null or p_remind_on<v_actor.today then raise exception 'FOLLOWUP_INVALID_DATE'; end if;
 v_message:=private.follow_up_message(p_message);
 perform 1 from public.patients p where p.business_id=p_business_id and p.id=p_patient_id and p.archived_at is null for share;
 if not found then raise exception 'FOLLOWUP_PATIENT_NOT_FOUND'; end if;
 v_assignee:=private.follow_up_assignee(p_business_id,p_patient_id,v_actor.actor_role,v_actor.acting_professional_id,p_assigned_professional_id);
 insert into public.follow_ups(business_id,patient_id,assigned_professional_id,remind_on,message,status,created_by)
 values(p_business_id,p_patient_id,v_assignee,p_remind_on,v_message,'pending',auth.uid()) returning id into v_id;
 return v_id;
end $$;

create function public.update_follow_up(p_business_id uuid, p_follow_up_id uuid, p_expected_updated_at timestamptz,
 p_remind_on date, p_message text, p_assigned_professional_id uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_actor record; v_row public.follow_ups; v_message text; v_assignee uuid;
begin
 select * into v_actor from private.follow_up_actor(p_business_id);
 v_row:=private.follow_up_for_change(p_business_id,p_follow_up_id,p_expected_updated_at,v_actor.actor_role,v_actor.acting_professional_id);
 if p_remind_on is null or p_remind_on<v_actor.today then raise exception 'FOLLOWUP_INVALID_DATE'; end if;
 v_message:=private.follow_up_message(p_message);
 v_assignee:=private.follow_up_assignee(p_business_id,v_row.patient_id,v_actor.actor_role,v_actor.acting_professional_id,p_assigned_professional_id);
 update public.follow_ups set remind_on=p_remind_on,message=v_message,assigned_professional_id=v_assignee
 where business_id=p_business_id and id=p_follow_up_id;
end $$;

create function public.complete_follow_up(p_business_id uuid, p_follow_up_id uuid, p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_actor record;
begin
 select * into v_actor from private.follow_up_actor(p_business_id);
 perform private.follow_up_for_change(p_business_id,p_follow_up_id,p_expected_updated_at,v_actor.actor_role,v_actor.acting_professional_id);
 update public.follow_ups set status='done',done_at=now() where business_id=p_business_id and id=p_follow_up_id;
end $$;

-- Snoozing always moves the follow-up to a later day, out of the ones running today.
create function public.snooze_follow_up(p_business_id uuid, p_follow_up_id uuid, p_expected_updated_at timestamptz,
 p_remind_on date) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_actor record;
begin
 select * into v_actor from private.follow_up_actor(p_business_id);
 perform private.follow_up_for_change(p_business_id,p_follow_up_id,p_expected_updated_at,v_actor.actor_role,v_actor.acting_professional_id);
 if p_remind_on is null or p_remind_on<=v_actor.today then raise exception 'FOLLOWUP_INVALID_DATE'; end if;
 update public.follow_ups set remind_on=p_remind_on where business_id=p_business_id and id=p_follow_up_id;
end $$;

-- Who may receive a follow-up of the patient, for the people who assign them: profiles
-- linked to the patient and the attending profiles of owners and administrators (a
-- profile that is both counts as linked). The server orders them for display.
create function public.list_follow_up_assignable_professionals(p_business_id uuid, p_patient_id uuid)
returns table(id uuid, name text, source text)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if public.user_business_role(p_business_id) is null or public.user_business_role(p_business_id) not in ('owner','admin','reception')
  or not public.business_allows_operation(p_business_id) then
  raise exception 'FOLLOWUP_FORBIDDEN';
 end if;
 return query
 select candidate.id,candidate.name,candidate.source from (
  select distinct on (p.id) p.id,p.name::text as name,
   case when link.professional_id is not null then 'patient_link' else 'owner_admin_attending' end as source,
   case when link.professional_id is not null then 0 else 1 end as source_order
  from public.professionals p
  left join public.professional_patient_links link on link.business_id=p.business_id and link.professional_id=p.id
   and link.patient_id=p_patient_id and link.is_active=true
  where p.business_id=p_business_id and p.is_active is distinct from false
   and (link.professional_id is not null or exists(select 1 from public.professional_users pu
    join public.business_users bu on bu.business_id=pu.business_id and bu.user_id=pu.user_id
    where pu.business_id=p.business_id and pu.professional_id=p.id and bu.status='active' and bu.role in ('owner','admin')))
  order by p.id,source_order
 ) candidate;
end $$;

revoke all on function public.create_follow_up(uuid,uuid,date,text,uuid),
 public.update_follow_up(uuid,uuid,timestamptz,date,text,uuid),public.complete_follow_up(uuid,uuid,timestamptz),
 public.snooze_follow_up(uuid,uuid,timestamptz,date),public.list_follow_up_assignable_professionals(uuid,uuid) from public,anon;
grant execute on function public.create_follow_up(uuid,uuid,date,text,uuid),
 public.update_follow_up(uuid,uuid,timestamptz,date,text,uuid),public.complete_follow_up(uuid,uuid,timestamptz),
 public.snooze_follow_up(uuid,uuid,timestamptz,date),public.list_follow_up_assignable_professionals(uuid,uuid) to authenticated;

commit;
