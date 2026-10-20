-- Reading an appointment depends on the actor's role in its practice and, for a
-- professional, on an allocation to one of their professional profiles. The rule,
-- user_can_read_appointment, was evaluated row by row by the policies of
-- appointments, appointment_professionals and appointment_booking_contexts and by
-- the internal availability window, about 0.6 ms each: a practice's week of about
-- 230 appointments took 132 ms in the capacity scenario of CI and 425 ms on the
-- hosted staging project. Same rules, evaluated once per statement: the practices
-- where the actor reads every appointment, and the pairs of practice and
-- appointment a professional reads through an allocation.
-- user_can_read_appointment stays as the single-row check it is elsewhere.
begin;

-- Practices whose appointments the actor reads in full: owner, admin (account
-- assistance included), reception and readonly while the practice operates. The
-- role and the state are the same functions as before.
create function public.user_appointment_reader_business_ids() returns uuid[]
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce(array_agg(candidate.business_id),'{}') from (
  select bu.business_id from public.business_users bu
  where bu.user_id=auth.uid() and coalesce(bu.status,'active')='active' and bu.accepted_at is not null
  union
  select aag.business_id from public.account_assistance_grants aag
  where aag.support_user_id=auth.uid() and aag.status='active' and aag.revoked_at is null and aag.expires_at>now()
 ) candidate
 where public.user_business_role(candidate.business_id) in ('owner','admin','reception','readonly')
  and public.business_allows_operation(candidate.business_id)
$$;

-- Appointments a professional reads: every allocation of their professional profiles
-- in the practices where their role is professional and the practice operates.
create function public.user_allocated_appointment_ids() returns table(business_id uuid, appointment_id uuid)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with professional_business as (
  select bu.business_id from public.business_users bu
  where bu.user_id=auth.uid() and coalesce(bu.status,'active')='active' and bu.accepted_at is not null
   and public.user_business_role(bu.business_id)='professional' and public.business_allows_operation(bu.business_id)
 )
 select distinct allocation.business_id,allocation.appointment_id
 from public.appointment_professionals allocation
 join public.professional_users pu on pu.business_id=allocation.business_id and pu.professional_id=allocation.professional_id
 where pu.user_id=auth.uid() and allocation.business_id in (select pb.business_id from professional_business pb)
$$;

revoke all on function public.user_appointment_reader_business_ids(),public.user_allocated_appointment_ids() from public,anon;
grant execute on function public.user_appointment_reader_business_ids(),public.user_allocated_appointment_ids() to authenticated,service_role;

-- The scalar subquery is an InitPlan, evaluated once per statement (the cast keeps
-- ANY on the array instead of its subquery form); the pairs are a non-correlated
-- subquery that PostgreSQL hashes once.
drop policy appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
using (
 business_id=any((select public.user_appointment_reader_business_ids())::uuid[])
 or (business_id,id) in (select allocated.business_id,allocated.appointment_id from public.user_allocated_appointment_ids() allocated)
);

drop policy appointment_professionals_select on public.appointment_professionals;
create policy appointment_professionals_select on public.appointment_professionals for select to authenticated
using (
 business_id=any((select public.user_appointment_reader_business_ids())::uuid[])
 or (business_id,appointment_id) in (select allocated.business_id,allocated.appointment_id from public.user_allocated_appointment_ids() allocated)
);

drop policy appointment_booking_contexts_read on public.appointment_booking_contexts;
create policy appointment_booking_contexts_read on public.appointment_booking_contexts for select to authenticated
using (
 business_id=any((select public.user_appointment_reader_business_ids())::uuid[])
 or (business_id,appointment_id) in (select allocated.business_id,allocated.appointment_id from public.user_allocated_appointment_ids() allocated)
);

-- The internal window keeps the same rule for the allocations it returns: an
-- internal professional reads only the allocations of appointments they can read.
-- Only that condition changes; the rest is the definition of 20261017030000.
create or replace function public.get_availability_window(p_business_id uuid,p_public boolean,p_service_id uuid,
  p_professional_ids uuid[],p_from_date date,p_to_date date,p_configuration_revision bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare business public.businesses%rowtype; revision bigint; range_start timestamptz; range_end timestamptz; result jsonb;
begin
  business:=private.require_availability_business(p_business_id,p_public);
  if p_from_date is null or p_to_date is null or not isfinite(p_from_date) or not isfinite(p_to_date)
    or p_to_date<p_from_date or p_to_date-p_from_date>14
    or coalesce(cardinality(p_professional_ids),0) not between 1 and 16
    or (select count(distinct id) from unnest(p_professional_ids) id)<>cardinality(p_professional_ids) then
    raise exception 'AVAILABILITY_WINDOW_INVALID';
  end if;
  select v.revision into revision from private.availability_configuration_versions v where v.business_id=p_business_id;
  if revision is null then raise exception 'AVAILABILITY_CONFIGURATION_MISSING'; end if;
  if p_configuration_revision is distinct from revision then raise exception 'AVAILABILITY_CONFIGURATION_CHANGED'; end if;
  if (p_public and (p_service_id is null or not exists(select 1 from public.services s
    where s.business_id=p_business_id and s.id=p_service_id and s.is_active and s.is_public)))
    or exists(select 1 from unnest(p_professional_ids) requested(professional_id) where not exists(
      select 1 from public.professionals p where p.business_id=p_business_id and p.id=requested.professional_id and p.is_active
        and (not p_public or (p.is_public and length(trim(p.name))>0 and exists(
          select 1 from public.professional_services a where a.business_id=p_business_id and a.professional_id=p.id and a.service_id=p_service_id))))) then
    raise exception 'AVAILABILITY_SCOPE_INVALID';
  end if;
  -- Date subtraction counts natural days even when daylight-saving time makes
  -- a midnight-to-midnight interval shorter or longer than 24 hours.
  range_start:=p_from_date::timestamp at time zone business.timezone;
  range_end:=(p_to_date+1)::timestamp at time zone business.timezone;
  result:=jsonb_build_object('schema_version',2,'complete',true,'business_id',business.id,
    'scope',case when p_public then 'public' else 'internal' end,'configuration_revision',revision,
    'from_date',p_from_date,'to_date',p_to_date,'professional_ids',p_professional_ids,'generated_at',statement_timestamp(),
    'exceptions',coalesce((select jsonb_agg(to_jsonb(row) order by row.starts_at,row.id) from (
      select e.id,e.professional_id,e.starts_at,e.ends_at,e.type,
        array(select es.service_id from public.availability_exception_services es where es.business_id=e.business_id and es.exception_id=e.id order by es.service_id) as allowed_service_ids
      from public.availability_exceptions e where e.business_id=p_business_id
        and (e.professional_id is null or e.professional_id=any(p_professional_ids))
        and e.starts_at<range_end and e.ends_at>range_start) row),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(to_jsonb(row) order by row.professional_id,row.blocking_starts_at,row.id) from (
      select a.id,a.appointment_id,a.professional_id,a.starts_at,a.ends_at,a.base_blocking_starts_at,a.base_blocking_ends_at,a.blocking_starts_at,a.blocking_ends_at
      from public.appointment_professionals a where a.business_id=p_business_id and a.professional_id=any(p_professional_ids)
        and a.status in ('reserved','confirmed','reschedule_requested') and a.blocking_starts_at<range_end and a.blocking_ends_at>range_start
        -- Match the appointment_professionals_select policy. The function owner
        -- must not turn an internal professional into a reader of every
        -- colleague's allocations merely by bypassing table RLS.
        and (p_public or coalesce(auth.role(),'')='service_role'
          or a.business_id=any((select public.user_appointment_reader_business_ids())::uuid[])
          or (a.business_id,a.appointment_id) in (select allocated.business_id,allocated.appointment_id
            from public.user_allocated_appointment_ids() allocated))) row),'[]'::jsonb));
  if octet_length(result::text)>5000000 then raise exception 'AVAILABILITY_RESPONSE_LIMIT'; end if;
  return result||jsonb_build_object('counts',jsonb_build_object(
    'exceptions',jsonb_array_length(result->'exceptions'),'blocks',jsonb_array_length(result->'blocks')));
end $$;

notify pgrst,'reload schema';
commit;
