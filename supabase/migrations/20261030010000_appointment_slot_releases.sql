-- Stage C of the approved deposit/reminder campaign. A release is an appointment fact,
-- one row per professional. Every route and the deposit job share the same trigger.
begin;
create table public.appointment_slot_releases (
 business_id uuid not null,
 id uuid primary key default gen_random_uuid(),
 event_order bigint generated always as identity,
 event_id uuid not null,
 appointment_id uuid not null,
 professional_id uuid not null,
 service_id uuid not null,
 professional_name text not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 occupied_since timestamptz not null,
 released_at timestamptz not null,
 reason text not null check(reason in ('patient_cancelled','practice_cancelled','deposit_expired','rescheduled')),
 hidden_at timestamptz,
 hidden_by uuid,
 unique(business_id,id),
 unique(event_id,professional_id),
 foreign key(business_id,appointment_id) references public.appointments(business_id,id) on delete cascade,
 foreign key(business_id,professional_id) references public.professionals(business_id,id) on delete no action deferrable initially deferred,
 foreign key(business_id,service_id) references public.services(business_id,id) on delete no action deferrable initially deferred,
 check(starts_at<ends_at),
 check((hidden_at is null)=(hidden_by is null))
);
create index appointment_slot_releases_window on public.appointment_slot_releases(business_id,starts_at,id);
create index appointment_slot_releases_history on public.appointment_slot_releases(business_id,appointment_id,event_order desc);
create index appointment_slot_releases_latest on public.appointment_slot_releases(business_id,professional_id,starts_at,ends_at,event_order desc);
alter table public.appointment_slot_releases enable row level security;
revoke all on public.appointment_slot_releases from public,anon,authenticated,service_role;
grant select on public.appointment_slot_releases to authenticated,service_role;
create policy appointment_slot_releases_read on public.appointment_slot_releases for select to authenticated using (
 business_id=any((select public.user_appointment_reader_business_ids())::uuid[])
 or (business_id,appointment_id) in (select a.business_id,a.appointment_id from public.user_allocated_appointment_ids() a)
);

create function private.record_appointment_slot_release() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare since_at timestamptz; released timestamptz:=clock_timestamp(); event uuid:=gen_random_uuid(); why text;
begin
 if old.status not in ('reserved','confirmed','reschedule_requested') then return null; end if;
 if new.status='cancelled' and old.status is distinct from new.status then
  if exists(select 1 from public.appointment_deposits d where d.business_id=old.business_id and d.appointment_id=old.id
   and d.status='expired' and d.expired_at=new.cancelled_at) then why:='deposit_expired';
  elsif new.cancelled_by_user_id is not null then why:='practice_cancelled';
  else why:='patient_cancelled'; end if;
 elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then why:='rescheduled';
 else return null; end if;
 -- The appointment is already locked by its UPDATE. Child inserts use its real FK and
 -- remain compatible with FOR NO KEY UPDATE in the deposit operations.
 select r.released_at into since_at from public.appointment_slot_releases r
 where r.business_id=old.business_id and r.appointment_id=old.id order by r.event_order desc limit 1;
 since_at:=coalesce(since_at,old.created_at,released);
 -- OLD supplies time, never the synchronized allocation times. This trigger sorts before
 -- appointments_sync_professionals, retaining even the old professional on a combined edit.
 insert into public.appointment_slot_releases(business_id,event_id,appointment_id,professional_id,service_id,professional_name,
 starts_at,ends_at,occupied_since,released_at,reason)
 select old.business_id,event,old.id,a.professional_id,old.service_id,a.professional_name_snapshot,
 old.starts_at,old.ends_at,since_at,released,why
 from public.appointment_professionals a where a.business_id=old.business_id and a.appointment_id=old.id;
 return null;
end $$;
create trigger appointments_record_slot_release after update of starts_at,ends_at,status on public.appointments
 for each row execute function private.record_appointment_slot_release();

-- A bounded view, not another availability calculator. Existing exclusions still decide
-- whether a new booking succeeds. Any partial occupation hides the whole released interval.
create function public.get_appointment_slot_releases(p_business_id uuid,p_days integer default 14,p_limit integer default 51,p_offset integer default 0)
returns table(id uuid,appointment_id uuid,professional_id uuid,service_id uuid,professional_name text,
 starts_at timestamptz,ends_at timestamptz,released_at timestamptz,reason text)
language plpgsql stable security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if p_days is null or p_days not between 1 and 60 or p_limit is null or p_limit not between 1 and 51
 or p_offset is null or p_offset not between 0 and 50000 then raise exception 'SLOT_RELEASE_WINDOW_INVALID'; end if;
 return query
 select r.id,r.appointment_id,r.professional_id,r.service_id,r.professional_name,r.starts_at,r.ends_at,r.released_at,r.reason
 from public.appointment_slot_releases r
 join public.professionals p on p.business_id=r.business_id and p.id=r.professional_id and p.is_active
 where r.business_id=p_business_id and r.hidden_at is null
 and r.starts_at>statement_timestamp() and r.starts_at<=statement_timestamp()+make_interval(days=>p_days)
 and r.released_at-r.occupied_since>=interval '30 minutes'
 -- Dedupe before hiding: hiding the latest event must never reveal an older duplicate.
 and not exists(select 1 from public.appointment_slot_releases newer where newer.business_id=r.business_id
  and newer.professional_id=r.professional_id and newer.starts_at=r.starts_at and newer.ends_at=r.ends_at
  and newer.event_order>r.event_order)
 and not exists(select 1 from public.appointment_professionals a where a.business_id=r.business_id and a.professional_id=r.professional_id
  and a.status in ('reserved','confirmed','reschedule_requested') and a.blocking_starts_at<r.ends_at and a.blocking_ends_at>r.starts_at)
 and not exists(select 1 from public.availability_exceptions e where e.business_id=r.business_id and e.type='blocked'
  and (e.professional_id is null or e.professional_id=r.professional_id) and e.starts_at<r.ends_at and e.ends_at>r.starts_at)
 order by r.starts_at,r.id limit p_limit offset p_offset;
end $$;

create function public.hide_appointment_slot_release(p_business_id uuid,p_release_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare release public.appointment_slot_releases;
begin
 if private.deposit_actor(p_business_id,array['owner','admin','reception']) is null then raise exception 'SLOT_RELEASE_FORBIDDEN'; end if;
 select * into release from public.appointment_slot_releases r where r.business_id=p_business_id and r.id=p_release_id for no key update;
 if not found then raise exception 'SLOT_RELEASE_NOT_FOUND'; end if;
 if release.hidden_at is not null then return false; end if;
 update public.appointment_slot_releases r set hidden_at=statement_timestamp(),hidden_by=auth.uid() where r.business_id=p_business_id and r.id=p_release_id;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(p_business_id,auth.uid(),'appointment.slot_release_hidden','appointment',release.appointment_id,
 jsonb_build_object('release_id',release.id,'professional_id',release.professional_id));
 return true;
end $$;

revoke all on function private.record_appointment_slot_release() from public,anon,authenticated,service_role;
revoke all on function public.get_appointment_slot_releases(uuid,integer,integer,integer),public.hide_appointment_slot_release(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.get_appointment_slot_releases(uuid,integer,integer,integer),public.hide_appointment_slot_release(uuid,uuid) to authenticated;
commit;
