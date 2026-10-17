begin;
-- Catalog changes and occupancy have different lifecycles. An appointment in
-- another window must not invalidate every window of the public horizon.
create table private.availability_configuration_versions (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  revision bigint not null default 1 check(revision between 1 and 9007199254740991)
);
alter table private.availability_configuration_versions enable row level security;
revoke all on private.availability_configuration_versions from public,anon,authenticated,service_role;
insert into private.availability_configuration_versions(business_id) select id from public.businesses;

create function private.initialize_availability_configuration() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  insert into private.availability_configuration_versions(business_id) values(new.id);
  return new;
end $$;
create trigger initialize_availability_configuration after insert on public.businesses
  for each row execute function private.initialize_availability_configuration();

create function private.advance_availability_configuration() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare old_business uuid; new_business uuid; affected uuid;
begin
  if tg_table_name='businesses' then
    old_business:=old.id; new_business:=new.id;
  else
    if tg_op<>'INSERT' then old_business:=old.business_id; end if;
    if tg_op<>'DELETE' then new_business:=new.business_id; end if;
  end if;
  -- Deterministic order also covers a privileged transfer between businesses.
  for affected in select distinct id from unnest(array[old_business,new_business]) id where id is not null order by id loop
    -- Match existing configuration writers: business first, then its revision.
    -- Otherwise a business edit and a service edit could invert these locks.
    perform 1 from public.businesses where id=affected for update;
    update private.availability_configuration_versions set revision=revision+1 where business_id=affected;
  end loop;
  return null;
end $$;
create trigger business_availability_configuration after update of timezone,max_booking_days_ahead,
  min_booking_notice_minutes,is_active,public_booking_enabled on public.businesses
  for each row when ((old.timezone,old.max_booking_days_ahead,old.min_booking_notice_minutes,old.is_active,old.public_booking_enabled)
    is distinct from (new.timezone,new.max_booking_days_ahead,new.min_booking_notice_minutes,new.is_active,new.public_booking_enabled))
  execute function private.advance_availability_configuration();
do $$
declare table_name text;
begin
  foreach table_name in array array['services','professionals','professional_services','availability_rules','availability_rule_services'] loop
    execute format('create trigger availability_configuration_changed after insert or update or delete on public.%I for each row execute function private.advance_availability_configuration()',table_name);
  end loop;
end $$;

create function private.require_availability_business(p_business_id uuid,p_public boolean)
returns public.businesses language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare business public.businesses%rowtype;
begin
  if p_public is null then raise exception 'AVAILABILITY_SCOPE_INVALID'; end if;
  if p_public then
    if coalesce(auth.role(),'')<>'service_role' then raise exception 'AVAILABILITY_ACCESS_DENIED'; end if;
  elsif coalesce(auth.role(),'')<>'service_role'
    and not coalesce(public.user_has_business_access(p_business_id),false) then
    raise exception 'AVAILABILITY_ACCESS_DENIED';
  end if;
  select * into business from public.businesses where id=p_business_id;
  if not found then raise exception 'AVAILABILITY_SCOPE_INVALID'; end if;
  if p_public and (not business.is_active or not business.public_booking_enabled
    or not coalesce(public.business_allows_operation(p_business_id),false)) then
    raise exception 'AVAILABILITY_ACCESS_DENIED';
  end if;
  return business;
end $$;

-- STABLE retains one MVCC snapshot for all reads in each call, including the
-- revision. Configuration is loaded once, not once per temporal/professional
-- fragment. No patient identity or clinical information is returned.
create function public.get_availability_catalog(p_business_id uuid,p_public boolean)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare business public.businesses%rowtype; revision bigint; result jsonb;
begin
  business:=private.require_availability_business(p_business_id,p_public);
  select v.revision into revision from private.availability_configuration_versions v where v.business_id=p_business_id;
  if revision is null then raise exception 'AVAILABILITY_CONFIGURATION_MISSING'; end if;
  result:=jsonb_build_object(
    'schema_version',2,'business_id',business.id,'scope',case when p_public then 'public' else 'internal' end,
    'configuration_revision',revision,'generated_at',statement_timestamp(),
    'business',jsonb_build_object('timezone',business.timezone,'max_booking_days_ahead',business.max_booking_days_ahead,
      'min_booking_notice_minutes',business.min_booking_notice_minutes,'is_active',business.is_active,'public_booking_enabled',business.public_booking_enabled),
    'services',coalesce((select jsonb_agg(to_jsonb(row) order by row.sort_order,row.name,row.id) from (
      select s.id,s.business_id,s.name,s.description,s.duration_minutes,s.buffer_before_minutes,s.buffer_after_minutes,
        s.price_label,s.is_public,s.is_active,s.sort_order from public.services s
      where s.business_id=p_business_id and s.is_active and (not p_public or s.is_public)) row),'[]'::jsonb),
    'professionals',coalesce((select jsonb_agg(to_jsonb(row) order by row.sort_order,row.name,row.id) from (
      select p.id,p.name,p.specialty,p.avatar_url,p.is_public,p.is_active,p.sort_order from public.professionals p
      where p.business_id=p_business_id and p.is_active and (not p_public or (p.is_public and length(trim(p.name))>0))) row),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(row) order by row.service_id,row.professional_id) from (
      select a.service_id,a.professional_id from public.professional_services a
      join public.services s on s.business_id=a.business_id and s.id=a.service_id
      join public.professionals p on p.business_id=a.business_id and p.id=a.professional_id
      where a.business_id=p_business_id and s.is_active and p.is_active
        and (not p_public or (s.is_public and p.is_public and length(trim(p.name))>0))) row),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(to_jsonb(row) order by row.professional_id,row.weekday,row.start_time,row.id) from (
      select r.id,r.professional_id,r.weekday,r.start_time,r.end_time,r.slot_interval_minutes,r.break_minutes,r.is_active,r.service_scope,
        array(select rs.service_id from public.availability_rule_services rs where rs.business_id=r.business_id and rs.rule_id=r.id order by rs.service_id) as allowed_service_ids
      from public.availability_rules r join public.professionals p on p.business_id=r.business_id and p.id=r.professional_id
      where r.business_id=p_business_id and r.is_active and p.is_active
        and (not p_public or (p.is_public and length(trim(p.name))>0))) row),'[]'::jsonb)
  );
  if octet_length(result::text)>5000000 then raise exception 'AVAILABILITY_RESPONSE_LIMIT'; end if;
  return result;
end $$;

create function public.get_availability_window(p_business_id uuid,p_public boolean,p_service_id uuid,
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
        -- Match the existing appointment_professionals_select policy. The
        -- function owner must not turn an internal professional into a reader
        -- of every colleague's allocations merely by bypassing table RLS.
        and (p_public or coalesce(auth.role(),'')='service_role'
          or coalesce(public.user_can_read_appointment(a.business_id,a.appointment_id),false))) row),'[]'::jsonb));
  if octet_length(result::text)>5000000 then raise exception 'AVAILABILITY_RESPONSE_LIMIT'; end if;
  return result||jsonb_build_object('counts',jsonb_build_object(
    'exceptions',jsonb_array_length(result->'exceptions'),'blocks',jsonb_array_length(result->'blocks')));
end $$;

revoke all on function private.initialize_availability_configuration(),private.advance_availability_configuration(),
  private.require_availability_business(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_availability_catalog(uuid,boolean),
  public.get_availability_window(uuid,boolean,uuid,uuid[],date,date,bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_availability_catalog(uuid,boolean),
  public.get_availability_window(uuid,boolean,uuid,uuid[],date,date,bigint) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
