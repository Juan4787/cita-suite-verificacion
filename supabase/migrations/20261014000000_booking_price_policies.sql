begin;
-- Monthly pricing is resolved by appointment date; no scheduled rewriting of fees.
create table public.service_price_policies (
 id uuid primary key default gen_random_uuid(), business_id uuid not null,
 service_id uuid not null, professional_id uuid, revision bigint not null default 1 check(revision>0),
 base_amount bigint not null check(base_amount between 0 and 1000000000000),
 currency text not null default 'ARS' check(currency='ARS'),
 base_month date not null check(extract(day from base_month)=1),
 first_adjustment_month date not null check(extract(day from first_adjustment_month)=1 and first_adjustment_month>base_month),
 monthly_percentage numeric(8,4) not null check(monthly_percentage between 0 and 1000),
 rounding_unit integer not null default 1 check(rounding_unit between 1 and 1000),
 updated_at timestamptz not null default now(),
 unique(business_id,id), unique nulls not distinct(business_id,service_id,professional_id),
 foreign key(business_id,service_id) references public.services(business_id,id) on delete cascade,
 foreign key(business_id,professional_id) references public.professionals(business_id,id) on delete cascade
);
create index service_price_policy_professional on public.service_price_policies(business_id,professional_id);
create table public.service_price_monthly_adjustments (
 business_id uuid not null, policy_id uuid not null, month date not null check(extract(day from month)=1),
 kind text not null check(kind in ('default','override')),
 percentage numeric(8,4) not null check(percentage between 0 and 1000),
 primary key(policy_id,month,kind),
 foreign key(business_id,policy_id) references public.service_price_policies(business_id,id) on delete cascade
);
create index service_price_adjustment_month_lookup on public.service_price_monthly_adjustments(policy_id,kind,month desc);
create index service_price_adjustment_tenant on public.service_price_monthly_adjustments(business_id,policy_id);
create table public.service_price_policy_versions (
 business_id uuid not null, policy_id uuid not null, revision bigint not null,
 configuration jsonb not null, created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), primary key(policy_id,revision),
 foreign key(business_id,policy_id) references public.service_price_policies(business_id,id) on delete cascade
);
create index service_price_version_tenant on public.service_price_policy_versions(business_id,policy_id);
create function public.user_can_configure_price(p_business_id uuid,p_professional_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(public.user_can_manage_business(p_business_id),false) or exists(select 1 from public.professional_users pu join public.business_users bu on bu.business_id=pu.business_id and bu.user_id=pu.user_id where pu.business_id=p_business_id and pu.professional_id=p_professional_id and pu.user_id=auth.uid() and bu.role='professional' and bu.status='active');
$$;
revoke all on function public.user_can_configure_price(uuid,uuid) from public,anon;
grant execute on function public.user_can_configure_price(uuid,uuid) to authenticated,service_role;
alter table public.service_price_policies enable row level security;
alter table public.service_price_monthly_adjustments enable row level security;
alter table public.service_price_policy_versions enable row level security;
create policy price_policy_read on public.service_price_policies for select to authenticated using(
 public.user_can_configure_price(business_id,professional_id) or
 (professional_id is null and exists(
  select 1 from public.professional_services ps
  join public.professional_users pu on pu.business_id=ps.business_id and pu.professional_id=ps.professional_id
  join public.business_users bu on bu.business_id=pu.business_id and bu.user_id=pu.user_id
  where ps.business_id=service_price_policies.business_id and ps.service_id=service_price_policies.service_id
   and pu.user_id=auth.uid() and bu.role='professional' and bu.status='active'
 ))
);
create policy price_adjustment_read on public.service_price_monthly_adjustments for select to authenticated using(exists(select 1 from public.service_price_policies p where p.id=policy_id and p.business_id=service_price_monthly_adjustments.business_id));
create policy price_version_read on public.service_price_policy_versions for select to authenticated using(exists(select 1 from public.service_price_policies p where p.id=policy_id and p.business_id=service_price_policy_versions.business_id));
revoke all on public.service_price_policies,public.service_price_monthly_adjustments,public.service_price_policy_versions from public,anon,authenticated,service_role;
grant select on public.service_price_policies,public.service_price_monthly_adjustments,public.service_price_policy_versions to authenticated,service_role;
create trigger price_policy_booking_revision after insert or update or delete on public.service_price_policies for each row execute function private.advance_booking_availability_revision();
create trigger price_adjustment_booking_revision after insert or update or delete on public.service_price_monthly_adjustments for each row execute function private.advance_booking_availability_revision();

create function public.save_service_price_policy(p_business_id uuid,p_service_id uuid,p_professional_id uuid,p_expected_revision bigint,p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare existing public.service_price_policies%rowtype; saved public.service_price_policies%rowtype; item jsonb; month_value date;
begin
 if not coalesce(public.user_can_configure_price(p_business_id,p_professional_id),false) or not coalesce(public.business_allows_operation(p_business_id),false) then raise exception 'PRICE_ACCESS_DENIED'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 if not exists(select 1 from public.services where business_id=p_business_id and id=p_service_id) or (p_professional_id is not null and not exists(select 1 from public.professional_services where business_id=p_business_id and service_id=p_service_id and professional_id=p_professional_id)) then raise exception 'PRICE_SCOPE_INVALID'; end if;
 if jsonb_typeof(p_configuration) is distinct from 'object' or octet_length(p_configuration::text)>32000 or jsonb_typeof(p_configuration->'adjustments') is distinct from 'array' or jsonb_array_length(p_configuration->'adjustments')>120 then raise exception 'PRICE_CONFIGURATION_INVALID'; end if;
 if (p_configuration->>'base_month')::date>date_trunc('month',statement_timestamp() at time zone (select timezone from public.businesses where id=p_business_id))::date then raise exception 'PRICE_CONFIGURATION_INVALID';end if;
 if trunc((p_configuration->>'base_amount')::numeric) is distinct from (p_configuration->>'base_amount')::numeric or trunc((p_configuration->>'rounding_unit')::numeric) is distinct from (p_configuration->>'rounding_unit')::numeric or round((p_configuration->>'monthly_percentage')::numeric,4) is distinct from (p_configuration->>'monthly_percentage')::numeric then raise exception 'PRICE_CONFIGURATION_INVALID';end if;
 select * into existing from public.service_price_policies where business_id=p_business_id and service_id=p_service_id and professional_id is not distinct from p_professional_id for update;
 if coalesce(existing.revision,0) is distinct from p_expected_revision then raise exception 'PRICE_POLICY_CHANGED'; end if;
 insert into public.service_price_policies(business_id,service_id,professional_id,revision,base_amount,currency,base_month,first_adjustment_month,monthly_percentage,rounding_unit)
 values(p_business_id,p_service_id,p_professional_id,coalesce(existing.revision,0)+1,(p_configuration->>'base_amount')::bigint,p_configuration->>'currency',(p_configuration->>'base_month')::date,(p_configuration->>'first_adjustment_month')::date,(p_configuration->>'monthly_percentage')::numeric,(p_configuration->>'rounding_unit')::integer)
 on conflict(business_id,service_id,professional_id) do update set revision=excluded.revision,base_amount=excluded.base_amount,currency=excluded.currency,base_month=excluded.base_month,first_adjustment_month=excluded.first_adjustment_month,monthly_percentage=excluded.monthly_percentage,rounding_unit=excluded.rounding_unit,updated_at=clock_timestamp() returning * into saved;
 delete from public.service_price_monthly_adjustments where policy_id=saved.id;
 for item in select value from jsonb_array_elements(p_configuration->'adjustments') loop
  month_value:=(item->>'month')::date;
  if round((item->>'percentage')::numeric,4) is distinct from (item->>'percentage')::numeric or month_value<=saved.base_month then raise exception 'PRICE_CONFIGURATION_INVALID'; end if;
  insert into public.service_price_monthly_adjustments(business_id,policy_id,month,kind,percentage) values(p_business_id,saved.id,month_value,item->>'kind',(item->>'percentage')::numeric);
 end loop;
 insert into public.service_price_policy_versions(business_id,policy_id,revision,configuration,created_by) values(p_business_id,saved.id,saved.revision,p_configuration,auth.uid());
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata) values(p_business_id,auth.uid(),'service.price_policy_saved','service',p_service_id,jsonb_build_object('policy_id',saved.id,'revision',saved.revision));
 return jsonb_build_object('id',saved.id,'revision',saved.revision);
end $$;

create function private.calculate_policy_monthly_amount(policy public.service_price_policies,p_date date) returns bigint language plpgsql stable security definer set search_path=pg_catalog as $$
declare selected_month date;months integer;fee numeric;cursor_month date;monthly numeric;
begin
 selected_month:=date_trunc('month',p_date)::date;
 if selected_month<policy.base_month then raise exception 'PRICE_DATE_INVALID'; end if;
 months:=(extract(year from selected_month)-extract(year from policy.base_month))::integer*12+(extract(month from selected_month)-extract(month from policy.base_month))::integer;
 if months>600 then raise exception 'PRICE_DATE_INVALID'; end if;
 fee:=policy.base_amount; cursor_month:=policy.base_month;
 while cursor_month<selected_month loop
  cursor_month:=(cursor_month+interval '1 month')::date;
  monthly:=case when cursor_month<policy.first_adjustment_month then 0 else policy.monthly_percentage end;
  if cursor_month>=policy.first_adjustment_month then
   select coalesce((select a.percentage from public.service_price_monthly_adjustments a where a.policy_id=policy.id and a.kind='default' and a.month<=cursor_month order by a.month desc limit 1),monthly) into monthly;
  end if;
  select coalesce((select a.percentage from public.service_price_monthly_adjustments a where a.policy_id=policy.id and a.kind='override' and a.month=cursor_month),monthly) into monthly;
  -- Keep exact decimal precision throughout the series. No rounded quote feeds the next month.
  fee:=trim_scale(fee*(1+monthly*0.01));
  if fee>1000000000000 then raise exception 'PRICE_AMOUNT_INVALID'; end if;
 end loop;
 -- div/mod avoid a floating point or non-terminating division at the half-unit boundary.
 return ((div(fee,policy.rounding_unit)+case when mod(fee,policy.rounding_unit)*2>=policy.rounding_unit then 1 else 0 end)*policy.rounding_unit)::bigint;
end $$;
create function private.resolve_service_price(p_business_id uuid,p_service_id uuid,p_professional_ids uuid[],p_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare policy public.service_price_policies%rowtype;fee bigint;current_fee bigint;today date;quote jsonb;binding jsonb;
begin
 if p_date is null then raise exception 'PRICE_DATE_INVALID';end if;
 select array_agg(distinct id order by id) into p_professional_ids from unnest(p_professional_ids) id;
 select * into policy from public.service_price_policies p where p.business_id=p_business_id and p.service_id=p_service_id and (p.professional_id is null or (cardinality(p_professional_ids)=1 and p.professional_id=p_professional_ids[1])) order by (p.professional_id is not null) desc limit 1;
 if not found then return null;end if;
 select (statement_timestamp() at time zone timezone)::date into today from public.businesses where id=p_business_id;
 fee:=private.calculate_policy_monthly_amount(policy,p_date);current_fee:=private.calculate_policy_monthly_amount(policy,today);
 binding:=jsonb_build_object('policy_id',policy.id,'revision',policy.revision,'service_id',p_service_id,'professional_ids',to_jsonb(p_professional_ids),'date',p_date,'amount',fee,'currency',policy.currency);
 quote:=binding||jsonb_build_object('base_amount',policy.base_amount,'current_amount',current_fee,'month',date_trunc('month',p_date)::date,'adjusted',fee<>current_fee);
 return quote||jsonb_build_object('hash',encode(extensions.digest(binding::text,'sha256'),'hex'));
end $$;
revoke all on function private.calculate_policy_monthly_amount(public.service_price_policies,date) from public,anon,authenticated,service_role;

create function public.get_public_service_price_quote(p_business_id uuid,p_service_id uuid,p_professional_ids uuid[],p_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not exists(select 1 from public.businesses b where b.id=p_business_id and b.is_active and b.public_booking_enabled) or not public.business_allows_operation(p_business_id) or not exists(select 1 from public.services s where s.business_id=p_business_id and s.id=p_service_id and s.is_active and s.is_public) or coalesce(cardinality(p_professional_ids),0) not between 1 and 16 or exists(select 1 from unnest(p_professional_ids) pid where not exists(select 1 from public.professional_services ps join public.professionals p on p.id=ps.professional_id and p.business_id=ps.business_id where ps.business_id=p_business_id and ps.service_id=p_service_id and ps.professional_id=pid and p.is_active and p.is_public)) then raise exception 'PRICE_SCOPE_INVALID'; end if;
 return private.resolve_service_price(p_business_id,p_service_id,p_professional_ids,p_date);
end $$;

alter table public.appointments add column price_quote_snapshot jsonb;
create function private.snapshot_appointment_price() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare quote jsonb; ids uuid[];
begin
 if tg_op='UPDATE' then
  if old.price_quote_snapshot is not null and (new.service_id<>old.service_id or new.professional_id<>old.professional_id) then raise exception 'APPOINTMENT_PRICE_REVIEW_REQUIRED'; end if;
  new.price_quote_snapshot:=old.price_quote_snapshot; return new;
 end if;
 perform 1 from public.businesses where id=new.business_id for share;
 ids:=coalesce(nullif(current_setting('cita.booking_professional_ids',true),'' )::uuid[],array[new.professional_id]);
 quote:=private.resolve_service_price(new.business_id,new.service_id,ids,(new.starts_at at time zone (select timezone from public.businesses where id=new.business_id))::date);
 if quote is not null and new.source='public_booking' and quote->>'hash' is distinct from current_setting('cita.booking_price_quote_hash',true) then raise exception 'PRICE_QUOTE_CHANGED'; end if;
 new.price_quote_snapshot:=quote; return new;
end $$;
create trigger zz_appointment_price before insert or update on public.appointments for each row execute function private.snapshot_appointment_price();
revoke all on function private.resolve_service_price(uuid,uuid,uuid[],date),private.snapshot_appointment_price() from public,anon,authenticated,service_role;
revoke all on function public.save_service_price_policy(uuid,uuid,uuid,bigint,jsonb),public.get_public_service_price_quote(uuid,uuid,uuid[],date) from public,anon,authenticated,service_role;
grant execute on function public.save_service_price_policy(uuid,uuid,uuid,bigint,jsonb) to authenticated;
grant execute on function public.get_public_service_price_quote(uuid,uuid,uuid[],date) to service_role;

create or replace function public.create_public_booking_with_information(p_input jsonb,p_replay_only boolean default false)
returns table(id uuid,patient_id uuid,confirmation_token text,starts_at timestamptz,ends_at timestamptz,service_name_snapshot text,professional_name_snapshot text,patient_created boolean,idempotent_replay boolean,patient_resolution_strategy text)
language plpgsql security definer set search_path=pg_catalog as $$
declare biz uuid:=(p_input->>'business_id')::uuid; professionals uuid[]; integration uuid:=(p_input->>'integration_id')::uuid;
 s jsonb; info jsonb; normalized jsonb; fingerprint text; request_key text:=lower(p_input->>'request_key'); previous public.appointments%rowtype; context public.appointment_patient_information_contexts%rowtype;
 created record; legacy_answers jsonb:='{}'; field jsonb; submission_id uuid; changes jsonb; comment text:=nullif(trim(p_input->>'comment'),'');
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>65536 or not coalesce(request_key ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) or length(coalesce(comment,''))>2000 then raise exception 'BOOKING_FORM_INVALID'; end if;
 select array_agg(value::uuid) into professionals from jsonb_array_elements_text(p_input->'professional_ids');
 perform set_config('cita.booking_professional_ids',professionals::text,true);
 perform set_config('cita.booking_price_quote_hash',coalesce(p_input->>'price_quote_hash',''),true);
 perform pg_advisory_xact_lock(hashtextextended('appointment-create:'||biz::text||':'||request_key,0));
 select * into previous from public.appointments a where a.business_id=biz and a.creation_request_key=request_key;
 if found then
  select * into context from public.appointment_patient_information_contexts where appointment_id=previous.id;
  if not found then raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT'; end if;
  s:=context.schema_snapshot;
 elsif p_replay_only then return;
 else
  perform 1 from public.businesses where public.businesses.id=biz for share;
  info:=public.get_public_patient_booking_schema(biz,professionals,integration); s:=info->'schema';
  if info->>'hash' is distinct from p_input->>'schema_hash' then raise exception 'BOOKING_INFORMATION_CHANGED'; end if;
 end if;
 normalized:=private.normalize_patient_answers(s,coalesce(p_input->'answers','{}'));
 fingerprint:=encode(extensions.digest(jsonb_build_object('schema',p_input->>'schema_hash','answers',normalized,'comment',comment,'integration',integration)::text,'sha256'),'hex');
 if previous.id is not null and context.request_fingerprint is distinct from fingerprint then raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT'; end if;
 if integration is not null then
  for field in select value from jsonb_array_elements(case when previous.id is not null then (select schema_snapshot from public.appointment_intake_responses where appointment_id=previous.id) else (select intake_schema from public.booking_integrations where public.booking_integrations.id=integration) end) loop
   if normalized ? (field->>'id') then legacy_answers:=legacy_answers||jsonb_build_object(field->>'id',normalized->(field->>'id')); end if;
  end loop;
  select * into created from public.create_integrated_public_appointment(integration,(p_input->>'integration_revision')::bigint,(p_input->>'availability_revision')::bigint,
   p_input->>'patient_name',p_input->>'patient_phone_raw',p_input->>'patient_phone_e164',nullif(p_input->>'patient_email',''),(p_input->>'service_id')::uuid,professionals,(p_input->>'starts_at')::timestamptz,
   comment,p_input->>'phone_status',p_input->>'modality',legacy_answers,request_key,p_replay_only,coalesce(p_input->>'entry_point','embedded'));
 else
  select * into created from public.create_appointment_with_patient_identity(biz,'public',null,p_input->>'patient_name',p_input->>'patient_phone_raw',p_input->>'patient_phone_e164',nullif(p_input->>'patient_email',''),false,null,
   (p_input->>'service_id')::uuid,professionals,(p_input->>'starts_at')::timestamptz,null,null,false,'public_booking',p_input->>'phone_status',false,request_key,p_replay_only);
 end if;
 if created.id is null then return; end if;
 if not created.idempotent_replay then
  insert into public.appointment_patient_information_contexts(appointment_id,business_id,patient_id_snapshot,schema_snapshot,request_fingerprint) values(created.id,biz,created.patient_id,s,fingerprint);
  insert into public.appointment_intake_submissions(business_id,appointment_id,patient_id,request_key,schema_snapshot,answers,free_comment) values(biz,created.id,created.patient_id,request_key::uuid,s,normalized,comment) returning public.appointment_intake_submissions.id into submission_id;
  changes:=private.apply_booking_answers_to_patient(biz,created.patient_id,s,normalized);
  update public.appointment_intake_submissions set profile_changes=changes where public.appointment_intake_submissions.id=submission_id;
 end if;
 return query select created.id,created.patient_id,created.confirmation_token,created.starts_at,created.ends_at,created.service_name_snapshot,created.professional_name_snapshot,created.patient_created,created.idempotent_replay,created.patient_resolution_strategy;
end $$;

alter function public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean) rename to create_appointment_with_patient_identity_before_pricing;
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
	id uuid,
	patient_id uuid,
	confirmation_token text,
	starts_at timestamptz,
	ends_at timestamptz,
	service_name_snapshot text,
	professional_name_snapshot text,
	patient_created boolean,
	idempotent_replay boolean,
	patient_resolution_strategy text
)
language plpgsql security definer set search_path=pg_catalog as $$ begin
 perform set_config('cita.booking_professional_ids',coalesce(p_professional_ids,'{}'::uuid[])::text,true);
 return query select * from public.create_appointment_with_patient_identity_before_pricing(p_business_id,p_patient_mode,p_patient_id,p_patient_name,p_patient_phone_raw,p_patient_phone_e164,p_patient_email,p_update_existing_phone,p_owner_id,p_service_id,p_professional_ids,p_starts_at,p_internal_note,p_created_by_user_id,p_ignore_break,p_source,p_phone_communication_status,p_phone_warning_acknowledged,p_idempotency_key,p_replay_only);
end $$;
revoke all on function public.create_appointment_with_patient_identity_before_pricing(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean) to service_role;

create function public.get_public_service_price_labels(p_business_id uuid,p_service_ids uuid[],p_professional_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare today date;service record;professional record;quote jsonb;minimum numeric;maximum numeric;currency text;result jsonb:='[]';mixed boolean;missing boolean;
begin
 select (statement_timestamp() at time zone b.timezone)::date into today from public.businesses b where b.id=p_business_id and b.is_active and b.public_booking_enabled;
 if today is null or not public.business_allows_operation(p_business_id) then raise exception 'PRICE_SCOPE_INVALID';end if;
 for service in select s.id from public.services s where s.business_id=p_business_id and s.is_public and s.is_active and (coalesce(cardinality(p_service_ids),0)=0 or s.id=any(p_service_ids)) loop
  minimum:=null;maximum:=null;currency:=null;mixed:=false;missing:=false;
  for professional in select p.id from public.professionals p join public.professional_services ps on ps.professional_id=p.id and ps.business_id=p.business_id where p.business_id=p_business_id and ps.service_id=service.id and p.is_active and p.is_public and (coalesce(cardinality(p_professional_ids),0)=0 or p.id=any(p_professional_ids)) loop
   quote:=private.resolve_service_price(p_business_id,service.id,array[professional.id],today);
   if quote is null then missing:=true;end if;
   if quote is not null then
    if currency is not null and currency<>quote->>'currency' then mixed:=true;end if;
    currency:=quote->>'currency';minimum:=least(minimum,(quote->>'amount')::numeric);maximum:=greatest(maximum,(quote->>'amount')::numeric);
   end if;
  end loop;
  if minimum is not null then result:=result||jsonb_build_array(jsonb_build_object('id',service.id,'minimum',minimum,'maximum',maximum,'currency',currency,'mixed',mixed or missing));end if;
 end loop;
 return result;
end $$;
revoke all on function public.get_public_service_price_labels(uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.get_public_service_price_labels(uuid,uuid[],uuid[]) to service_role;

commit;
