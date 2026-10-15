begin;
alter table public.availability_rules add column service_scope text not null default 'all' check(service_scope in ('all','restricted'));
alter table public.availability_rules add constraint availability_rule_tenant_key unique(business_id,id);
alter table public.availability_exceptions add constraint availability_exception_tenant_key unique(business_id,id);
alter table public.availability_exceptions drop constraint availability_exceptions_type_check;
alter table public.availability_exceptions add constraint availability_exceptions_type_check check(type in ('blocked','extra_available','restricted'));
create table public.availability_rule_services (
 business_id uuid not null,rule_id uuid not null,service_id uuid not null,primary key(rule_id,service_id),
 foreign key(business_id,rule_id) references public.availability_rules(business_id,id) on delete cascade,
 foreign key(business_id,service_id) references public.services(business_id,id) on delete cascade
);
create index availability_rule_services_tenant on public.availability_rule_services(business_id,service_id);
create table public.availability_exception_services (
 business_id uuid not null,exception_id uuid not null,service_id uuid not null,primary key(exception_id,service_id),
 foreign key(business_id,exception_id) references public.availability_exceptions(business_id,id) on delete cascade,
 foreign key(business_id,service_id) references public.services(business_id,id) on delete cascade
);
create index availability_exception_services_tenant on public.availability_exception_services(business_id,service_id);
create table public.availability_exception_batches (
 business_id uuid not null references public.businesses(id) on delete cascade,request_id uuid not null,
 fingerprint text not null,created_at timestamptz not null default now(),primary key(business_id,request_id)
);
alter table public.availability_rule_services enable row level security;
alter table public.availability_exception_services enable row level security;
alter table public.availability_exception_batches enable row level security;
create policy rule_services_read on public.availability_rule_services for select to authenticated using(exists(select 1 from public.business_users bu where bu.business_id=availability_rule_services.business_id and bu.user_id=auth.uid() and bu.status='active'));
create policy exception_services_read on public.availability_exception_services for select to authenticated using(exists(select 1 from public.business_users bu where bu.business_id=availability_exception_services.business_id and bu.user_id=auth.uid() and bu.status='active'));
revoke all on public.availability_rule_services,public.availability_exception_services,public.availability_exception_batches from public,anon,authenticated,service_role;
grant select on public.availability_rule_services,public.availability_exception_services to authenticated,service_role;
create trigger rule_service_booking_revision after insert or update or delete on public.availability_rule_services for each row execute function private.advance_booking_availability_revision();
create trigger exception_service_booking_revision after insert or update or delete on public.availability_exception_services for each row execute function private.advance_booking_availability_revision();

create function public.replace_professional_schedule_blocks(p_business_id uuid,p_professional_id uuid,p_expected_revision bigint,p_blocks jsonb)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare block jsonb; day_value jsonb; period jsonb; service_value jsonb; rule_id uuid; scope text;
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id) then raise exception 'SCHEDULE_ACCESS_DENIED'; end if;
 perform 1 from public.businesses where id=p_business_id and booking_availability_revision=p_expected_revision for update;
 if not found then raise exception 'SCHEDULE_CHANGED'; end if;
 if not exists(select 1 from public.professionals where business_id=p_business_id and id=p_professional_id) or jsonb_typeof(p_blocks) is distinct from 'array' or jsonb_array_length(p_blocks)>100 or octet_length(p_blocks::text)>64000 then raise exception 'SCHEDULE_INVALID'; end if;
 perform set_config('cita.schedule_replace','true',true);
 delete from public.availability_rules where business_id=p_business_id and professional_id=p_professional_id;
 for block in select value from jsonb_array_elements(p_blocks) loop
  scope:=coalesce(block->>'service_scope','all');
  if scope not in ('all','restricted') or jsonb_typeof(block->'weekdays') is distinct from 'array' or jsonb_typeof(block->'ranges') is distinct from 'array' or jsonb_array_length(block->'ranges') not between 1 and 10 or jsonb_array_length(block->'weekdays') not between 1 and 7 or (scope='restricted' and (jsonb_typeof(block->'service_ids') is distinct from 'array' or jsonb_array_length(block->'service_ids') not between 0 and 100)) then raise exception 'SCHEDULE_INVALID'; end if;
  for day_value in select value from jsonb_array_elements(block->'weekdays') loop
   for period in select value from jsonb_array_elements(block->'ranges') loop
    insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes,is_active,service_scope)
    values(p_business_id,p_professional_id,day_value::text::integer,(period->>'start')::time,(period->>'end')::time,(block->>'slot_interval_minutes')::integer,(block->>'break_minutes')::integer,true,scope) returning id into rule_id;
    if scope='restricted' then
     for service_value in select value from jsonb_array_elements(block->'service_ids') loop
      if not exists(select 1 from public.professional_services where business_id=p_business_id and professional_id=p_professional_id and service_id=(service_value#>>'{}')::uuid) then raise exception 'SCHEDULE_SERVICE_INVALID'; end if;
      insert into public.availability_rule_services(business_id,rule_id,service_id) values(p_business_id,rule_id,(service_value#>>'{}')::uuid);
     end loop;
    end if;
   end loop;
  end loop;
 end loop;
 if (select count(*) from public.availability_rules where business_id=p_business_id and professional_id=p_professional_id)>500 or exists(select 1 from public.availability_rules a join public.availability_rules b on b.business_id=a.business_id and b.professional_id=a.professional_id and b.weekday=a.weekday and b.id>a.id where a.business_id=p_business_id and a.professional_id=p_professional_id and a.start_time<b.end_time and a.end_time>b.start_time) then raise exception 'SCHEDULE_OVERLAP'; end if;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id) values(p_business_id,auth.uid(),'professional.schedule_saved','professional',p_professional_id);
end $$;

create function public.create_availability_exception_batch(p_business_id uuid,p_expected_revision bigint,p_request_id uuid,p_items jsonb,p_ack_existing boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare fingerprint text; previous text; item jsonb; exception_id uuid; service_value jsonb; target uuid;
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id) then raise exception 'SCHEDULE_ACCESS_DENIED'; end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 366 or octet_length(p_items::text)>200000 then raise exception 'SCHEDULE_INVALID'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 fingerprint:=encode(extensions.digest(p_items::text,'sha256'),'hex');
 select b.fingerprint into previous from public.availability_exception_batches b where b.business_id=p_business_id and b.request_id=p_request_id;
 if found then if previous<>fingerprint then raise exception 'SCHEDULE_REQUEST_CONFLICT'; end if;return jsonb_build_object('replayed',true);end if;
 if (select booking_availability_revision from public.businesses where id=p_business_id) is distinct from p_expected_revision then raise exception 'SCHEDULE_CHANGED'; end if;
 for item in select distinct value from jsonb_array_elements(p_items) loop
  target:=nullif(item->>'professional_id','')::uuid;
  if target is not null and not exists(select 1 from public.professionals where id=target and business_id=p_business_id) then raise exception 'SCHEDULE_SCOPE_INVALID'; end if;
  if length(coalesce(item->>'reason',''))>500 or (item->>'ends_at')::timestamptz-(item->>'starts_at')::timestamptz>interval '366 days' then raise exception 'SCHEDULE_INVALID'; end if;
  if item->>'type'='blocked' and not coalesce(p_ack_existing,false) and exists(select 1 from public.appointment_professionals ap where ap.business_id=p_business_id and (target is null or ap.professional_id=target) and ap.status in ('reserved','confirmed','reschedule_requested') and ap.starts_at<(item->>'ends_at')::timestamptz and ap.ends_at>(item->>'starts_at')::timestamptz) then raise exception 'SCHEDULE_EXISTING_APPOINTMENTS';end if;
  insert into public.availability_exceptions(business_id,professional_id,type,starts_at,ends_at,reason) values(p_business_id,target,item->>'type',(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,nullif(trim(item->>'reason'),'')) returning id into exception_id;
  if item->>'type'='restricted' then
   if jsonb_typeof(item->'service_ids') is distinct from 'array' or jsonb_array_length(item->'service_ids') not between 1 and 100 then raise exception 'SCHEDULE_SERVICE_INVALID'; end if;
   for service_value in select value from jsonb_array_elements(item->'service_ids') loop
    if target is not null and not exists(select 1 from public.professional_services where business_id=p_business_id and professional_id=target and service_id=(service_value#>>'{}')::uuid) then raise exception 'SCHEDULE_SERVICE_INVALID'; end if;
    insert into public.availability_exception_services(business_id,exception_id,service_id) values(p_business_id,exception_id,(service_value#>>'{}')::uuid);
   end loop;
  end if;
 end loop;
 insert into public.availability_exception_batches(business_id,request_id,fingerprint) values(p_business_id,p_request_id,fingerprint);
 insert into public.audit_logs(business_id,user_id,action,entity_type,metadata) values(p_business_id,auth.uid(),'availability.exception_batch_created','professional',jsonb_build_object('count',jsonb_array_length(p_items),'request_id',p_request_id));
 return jsonb_build_object('replayed',false);
end $$;

create function private.assert_service_schedule(p_business_id uuid,p_professional_id uuid,p_service_id uuid,p_start timestamptz,p_end timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare zone text; local_day date; restriction record; window_start timestamptz; window_end timestamptz;
begin
 select timezone into zone from public.businesses where id=p_business_id for share;
 if exists(select 1 from public.availability_exceptions e where e.business_id=p_business_id and (e.professional_id is null or e.professional_id=p_professional_id) and e.type='blocked' and e.starts_at<p_end and e.ends_at>p_start) then raise exception 'SCHEDULE_BLOCKED';end if;
 -- The previous local day is included for intervals crossing midnight.
 for local_day in select generate_series((p_start at time zone zone)::date-1,(p_end at time zone zone)::date,interval '1 day')::date loop
  for restriction in select r.* from public.availability_rules r where r.business_id=p_business_id and r.professional_id=p_professional_id and r.is_active and r.weekday=extract(dow from local_day)::integer and r.service_scope='restricted' loop
   window_start:=(local_day+restriction.start_time) at time zone zone;window_end:=(local_day+restriction.end_time) at time zone zone;
   if p_start<window_end and p_end>window_start and not exists(select 1 from public.availability_rule_services rs where rs.rule_id=restriction.id and rs.service_id=p_service_id) then raise exception 'SCHEDULE_SERVICE_UNAVAILABLE'; end if;
  end loop;
 end loop;
 if exists(select 1 from public.availability_exceptions e where e.business_id=p_business_id and (e.professional_id is null or e.professional_id=p_professional_id) and e.type='restricted' and e.starts_at<p_end and e.ends_at>p_start and not exists(select 1 from public.availability_exception_services es where es.exception_id=e.id and es.service_id=p_service_id)) then raise exception 'SCHEDULE_SERVICE_UNAVAILABLE'; end if;
end $$;
create function private.enforce_appointment_service_schedule() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare member record; start_time timestamptz; end_time timestamptz;
begin
 if tg_table_name='appointments' then
  if new.status in ('cancelled','attended','no_show') then return new;end if;
  if tg_op='UPDATE' and old.status in ('reserved','confirmed','reschedule_requested') and new.starts_at=old.starts_at and new.ends_at=old.ends_at and new.service_id=old.service_id and new.professional_id=old.professional_id then return new;end if;
  start_time:=new.starts_at-make_interval(mins=>new.buffer_before_minutes_snapshot);end_time:=new.ends_at+make_interval(mins=>new.buffer_after_minutes_snapshot);
  perform private.assert_service_schedule(new.business_id,new.professional_id,new.service_id,start_time,end_time);
  if tg_op='UPDATE' then for member in select professional_id from public.appointment_professionals where appointment_id=new.id and business_id=new.business_id loop perform private.assert_service_schedule(new.business_id,member.professional_id,new.service_id,start_time,end_time);end loop;end if;
 else
  if tg_op='UPDATE' and old.status in ('reserved','confirmed','reschedule_requested') and new.professional_id=old.professional_id and new.starts_at=old.starts_at and new.ends_at=old.ends_at and new.base_blocking_starts_at=old.base_blocking_starts_at and new.base_blocking_ends_at=old.base_blocking_ends_at then return new;end if;
  select a.* into member from public.appointments a where a.id=new.appointment_id and a.business_id=new.business_id;
  if member.status not in ('cancelled','attended','no_show') then perform private.assert_service_schedule(new.business_id,new.professional_id,member.service_id,member.starts_at-make_interval(mins=>member.buffer_before_minutes_snapshot),member.ends_at+make_interval(mins=>member.buffer_after_minutes_snapshot));end if;
 end if;
 return new;
end $$;
create trigger zz_service_schedule before insert or update on public.appointments for each row execute function private.enforce_appointment_service_schedule();
create trigger zz_team_service_schedule before insert or update on public.appointment_professionals for each row execute function private.enforce_appointment_service_schedule();
revoke all on function private.assert_service_schedule(uuid,uuid,uuid,timestamptz,timestamptz),private.enforce_appointment_service_schedule() from public,anon,authenticated,service_role;
revoke all on function public.replace_professional_schedule_blocks(uuid,uuid,bigint,jsonb),public.create_availability_exception_batch(uuid,bigint,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.replace_professional_schedule_blocks(uuid,uuid,bigint,jsonb),public.create_availability_exception_batch(uuid,bigint,uuid,jsonb,boolean) to authenticated;

create or replace function public.get_availability_snapshot(
	p_business_id uuid,
	p_from timestamptz,
	p_to timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if p_business_id is null
		or p_from is null
		or p_to is null
		or p_to <= p_from
		or p_to > p_from + interval '31 days'
	then
		raise exception using
			errcode = '22023',
			message = 'invalid availability snapshot range';
	end if;

	if coalesce(auth.role(), '') <> 'service_role'
		and not public.user_has_business_access(p_business_id)
	then
		raise exception using
			errcode = '42501',
			message = 'insufficient business access';
	end if;

	return jsonb_build_object(
		'generated_at', now(),
		'services', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', service.id,
					'business_id', service.business_id,
					'name', service.name,
					'duration_minutes', service.duration_minutes,
					'buffer_before_minutes', service.buffer_before_minutes,
					'buffer_after_minutes', service.buffer_after_minutes,
					'is_public', service.is_public,
					'is_active', service.is_active,
					'sort_order', service.sort_order
				)
				order by service.sort_order, service.name, service.id
			)
			from public.services service
			where service.business_id = p_business_id
				and service.is_active
		), '[]'::jsonb),
		'professionals', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', professional.id,
					'name', professional.name,
					'specialty', professional.specialty,
					'is_public', professional.is_public,
					'is_active', professional.is_active,
					'sort_order', professional.sort_order
				)
				order by professional.sort_order, professional.name, professional.id
			)
			from public.professionals professional
			where professional.business_id = p_business_id
				and professional.is_active
		), '[]'::jsonb),
		'assignments', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'service_id', assignment.service_id,
					'professional_id', assignment.professional_id
				)
				order by assignment.service_id, assignment.professional_id
			)
			from public.professional_services assignment
			join public.services service
				on service.business_id = assignment.business_id
				and service.id = assignment.service_id
				and service.is_active
			join public.professionals professional
				on professional.business_id = assignment.business_id
				and professional.id = assignment.professional_id
				and professional.is_active
			where assignment.business_id = p_business_id
		), '[]'::jsonb),
		'rules', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', rule.id,
					'professional_id', rule.professional_id,
					'weekday', rule.weekday,
					'start_time', rule.start_time,
					'end_time', rule.end_time,
					'slot_interval_minutes', rule.slot_interval_minutes,
					'break_minutes', rule.break_minutes,
					'is_active', rule.is_active, 'service_scope',rule.service_scope,'allowed_service_ids',coalesce((select jsonb_agg(rs.service_id order by rs.service_id) from public.availability_rule_services rs where rs.rule_id=rule.id),'[]'::jsonb)
				)
				order by rule.professional_id, rule.weekday, rule.start_time, rule.id
			)
			from public.availability_rules rule
			join public.professionals professional
				on professional.business_id = rule.business_id
				and professional.id = rule.professional_id
				and professional.is_active
			where rule.business_id = p_business_id
				and rule.is_active
		), '[]'::jsonb),
		'exceptions', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', exception.id,
					'professional_id', exception.professional_id,
					'starts_at', exception.starts_at,
					'ends_at', exception.ends_at,
					'type', exception.type,'allowed_service_ids',coalesce((select jsonb_agg(es.service_id order by es.service_id) from public.availability_exception_services es where es.exception_id=exception.id),'[]'::jsonb)
				)
				order by exception.starts_at, exception.id
			)
			from public.availability_exceptions exception
			where exception.business_id = p_business_id
				and exception.starts_at < p_to
				and exception.ends_at > p_from
		), '[]'::jsonb),
		'blocks', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'id', allocation.id,
					'professional_id', allocation.professional_id,
					'base_blocking_starts_at', allocation.base_blocking_starts_at,
					'base_blocking_ends_at', allocation.base_blocking_ends_at,
					'blocking_starts_at', allocation.blocking_starts_at,
					'blocking_ends_at', allocation.blocking_ends_at
				)
				order by allocation.professional_id, allocation.starts_at, allocation.id
			)
			from public.appointment_professionals allocation
			where allocation.business_id = p_business_id
				and allocation.status in ('reserved', 'confirmed', 'reschedule_requested')
				and allocation.blocking_starts_at < p_to
				and allocation.blocking_ends_at > p_from
		), '[]'::jsonb)
	);
end;
$$;
create or replace function public.get_integrated_public_availability_snapshot(
  p_business_id uuid,p_service_id uuid,p_professional_ids uuid[],p_range_start timestamptz,p_range_end timestamptz
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if coalesce(cardinality(p_professional_ids),0) not between 1 and 16 or p_range_start is null or p_range_end is null or p_range_end<=p_range_start or p_range_end-p_range_start>interval '92 days' then raise exception 'BOOKING_AVAILABILITY_RANGE_INVALID'; end if;
  return jsonb_build_object(
    'services',coalesce((select jsonb_agg(to_jsonb(row)) from (select s.id,s.business_id,s.name,s.description,s.duration_minutes,s.buffer_before_minutes,s.buffer_after_minutes,s.price_label,s.is_public,s.is_active,s.sort_order from public.services s where s.business_id=p_business_id and s.id=p_service_id and s.is_active and s.is_public) row),'[]'::jsonb),
    'professionals',coalesce((select jsonb_agg(to_jsonb(row)) from (select p.id,p.name,p.specialty,p.avatar_url,p.is_public,p.is_active,p.sort_order from public.professionals p where p.business_id=p_business_id and p.id=any(p_professional_ids) and p.is_active and p.is_public and length(trim(p.name))>0) row),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(row)) from (select a.service_id,a.professional_id from public.professional_services a where a.business_id=p_business_id and a.service_id=p_service_id and a.professional_id=any(p_professional_ids)) row),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(to_jsonb(row)) from (select r.id,r.professional_id,r.weekday,r.start_time,r.end_time,r.slot_interval_minutes,r.break_minutes,r.is_active,r.service_scope,array(select rs.service_id from public.availability_rule_services rs where rs.rule_id=r.id order by rs.service_id) as allowed_service_ids from public.availability_rules r where r.business_id=p_business_id and r.professional_id=any(p_professional_ids) and r.is_active) row),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(to_jsonb(row)) from (select e.id,e.professional_id,e.starts_at,e.ends_at,e.type,array(select es.service_id from public.availability_exception_services es where es.exception_id=e.id order by es.service_id) as allowed_service_ids from public.availability_exceptions e where e.business_id=p_business_id and (e.professional_id is null or e.professional_id=any(p_professional_ids)) and e.starts_at<p_range_end and e.ends_at>p_range_start) row),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(to_jsonb(row)) from (select a.id,a.appointment_id,a.professional_id,a.starts_at,a.ends_at,a.base_blocking_starts_at,a.base_blocking_ends_at,a.blocking_starts_at,a.blocking_ends_at from public.appointment_professionals a where a.business_id=p_business_id and a.professional_id=any(p_professional_ids) and a.status in ('reserved','confirmed','reschedule_requested') and a.blocking_starts_at<p_range_end and a.blocking_ends_at>p_range_start) row),'[]'::jsonb)
  );
end $$;
create function private.protect_restricted_schedule() returns trigger language plpgsql security definer set search_path=pg_catalog as $$ begin
 if old.service_scope='restricted' and current_setting('cita.schedule_replace',true) is distinct from 'true' and pg_trigger_depth()=1 then raise exception 'SCHEDULE_RESTRICTIONS_REVIEW_REQUIRED';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger protect_restricted_schedule before delete or update on public.availability_rules for each row execute function private.protect_restricted_schedule();
revoke all on function private.protect_restricted_schedule() from public,anon,authenticated,service_role;

-- The profile editor's combined save must either commit every requested section or none.
create function public.save_professional_editor(p_business_id uuid,p_professional_id uuid,p_expected_revision bigint,p_profile jsonb,p_service_ids uuid[],p_blocks jsonb,p_exception_request_id uuid,p_exception_items jsonb,p_ack_existing boolean default false)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare revision bigint;
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id) then raise exception 'SCHEDULE_ACCESS_DENIED';end if;
 select booking_availability_revision into revision from public.businesses where id=p_business_id for update;
 if revision is distinct from p_expected_revision then raise exception 'SCHEDULE_CHANGED';end if;
 perform 1 from public.professionals where id=p_professional_id and business_id=p_business_id for update;
 if not found then raise exception 'SCHEDULE_SCOPE_INVALID';end if;
 if p_profile is not null then
  if jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>4096 or coalesce(length(trim(p_profile->>'name')),0) not between 1 and 160 then raise exception 'SCHEDULE_PROFILE_INVALID';end if;
  update public.professionals set name=trim(p_profile->>'name'),specialty=nullif(trim(p_profile->>'specialty'),''),phone=nullif(trim(p_profile->>'phone'),''),email=nullif(lower(trim(p_profile->>'email')),''),is_public=(p_profile->>'is_public')::boolean,is_active=coalesce((p_profile->>'is_active')::boolean,is_active),updated_at=clock_timestamp() where id=p_professional_id and business_id=p_business_id;
 end if;
 if p_service_ids is not null then
  if cardinality(p_service_ids)>500 or exists(select 1 from unnest(p_service_ids) submitted(id) where submitted.id is null or not exists(select 1 from public.services where business_id=p_business_id and services.id=submitted.id)) then raise exception 'SCHEDULE_SCOPE_INVALID';end if;
  select array_agg(distinct id) into p_service_ids from (select unnest(p_service_ids) id union select id from public.services where business_id=p_business_id and lower(trim(name)) in ('consulta','otro servicio')) ids;
  delete from public.professional_services where business_id=p_business_id and professional_id=p_professional_id and not(service_id=any(coalesce(p_service_ids,'{}')));
  insert into public.professional_services(business_id,professional_id,service_id) select p_business_id,p_professional_id,unnest(p_service_ids) on conflict do nothing;
 end if;
 if p_blocks is not null then
  select booking_availability_revision into revision from public.businesses where id=p_business_id;
  perform public.replace_professional_schedule_blocks(p_business_id,p_professional_id,revision,p_blocks);
 end if;
 if p_exception_items is not null then
  select booking_availability_revision into revision from public.businesses where id=p_business_id;
  perform public.create_availability_exception_batch(p_business_id,revision,p_exception_request_id,p_exception_items,p_ack_existing);
 end if;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata) values(p_business_id,auth.uid(),'professional.editor_saved','professional',p_professional_id,jsonb_build_object('profile',p_profile is not null,'services',p_service_ids is not null,'schedule',p_blocks is not null,'exceptions',p_exception_items is not null));
end $$;
create function public.delete_professional_schedule_rule(p_business_id uuid,p_professional_id uuid,p_rule_id uuid,p_expected_revision bigint) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare revision bigint;
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id) then raise exception 'SCHEDULE_ACCESS_DENIED';end if;
 select booking_availability_revision into revision from public.businesses where id=p_business_id for update;
 if revision is distinct from p_expected_revision then raise exception 'SCHEDULE_CHANGED';end if;
 perform set_config('cita.schedule_replace','true',true);
 delete from public.availability_rules where business_id=p_business_id and professional_id=p_professional_id and id=p_rule_id;
 if not found then raise exception 'SCHEDULE_SCOPE_INVALID';end if;
end $$;
revoke all on function public.save_professional_editor(uuid,uuid,bigint,jsonb,uuid[],jsonb,uuid,jsonb,boolean),public.delete_professional_schedule_rule(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.save_professional_editor(uuid,uuid,bigint,jsonb,uuid[],jsonb,uuid,jsonb,boolean),public.delete_professional_schedule_rule(uuid,uuid,uuid,bigint) to authenticated;

commit;
