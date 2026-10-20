-- The weekly agenda shows how many appointments of each state a practice has on each
-- day of a week. The page read every appointment of the week to count them in the
-- Worker, building a date formatter twice per appointment and day; a failed read was
-- shown as an empty week, and the PostgREST row limit would have cut a busy week
-- short without saying so. The database counts them instead: at most seven days by
-- four states, under the actor's own read rules (security invoker, so the policies
-- of appointments and allocations apply as for any read).
begin;

create function public.agenda_week_counts(p_business_id uuid,p_from timestamptz,p_to timestamptz,p_time_zone text,
 p_professional_id uuid default null)
returns table(local_date date,status text,appointments bigint)
language plpgsql stable security invoker set search_path=pg_catalog,pg_temp as $$
begin
 -- A week and its edges, never an unbounded scan. An unknown time zone fails in
 -- AT TIME ZONE itself.
 if p_business_id is null or p_from is null or p_to is null or p_to<p_from or p_to-p_from>interval '8 days'
  or p_time_zone is null then
  raise exception 'AGENDA_WEEK_INVALID';
 end if;
 return query
 select (a.starts_at at time zone p_time_zone)::date,a.status,count(*)
 from public.appointments a
 where a.business_id=p_business_id and a.starts_at>=p_from and a.starts_at<=p_to
  and (p_professional_id is null or exists(select 1 from public.appointment_professionals allocation
   where allocation.business_id=a.business_id and allocation.appointment_id=a.id and allocation.professional_id=p_professional_id))
 group by 1,2;
end $$;

revoke all on function public.agenda_week_counts(uuid,timestamptz,timestamptz,text,uuid) from public,anon;
grant execute on function public.agenda_week_counts(uuid,timestamptz,timestamptz,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
