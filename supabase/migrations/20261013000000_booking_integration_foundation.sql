-- Additive, dormant foundation: no clinic or active integration is provisioned.
begin;

create schema if not exists private;

create or replace function private.booking_intake_schema_valid(p_schema jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare f jsonb; opt jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(p_schema) is distinct from 'array' or octet_length(p_schema::text) > 16384 then return false; end if;
  if jsonb_array_length(p_schema) > 24 then return false; end if;
  for f in select value from jsonb_array_elements(p_schema) loop
    if jsonb_typeof(f) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(f) k where k not in ('id','label','kind','required','help','maxLength','options')) then return false; end if;
    if not coalesce(f->>'id' ~ '^[a-z][a-z0-9_]{0,47}$',false) or f->>'id' in ('constructor','prototype') or f->>'id' = any(ids) then return false; end if;
    ids := array_append(ids,f->>'id');
    if jsonb_typeof(f->'label') is distinct from 'string' or length(trim(f->>'label')) = 0 or length(f->>'label') > 120 then return false; end if;
    if not coalesce(f->>'kind' in ('text','textarea','boolean','choice'),false) or jsonb_typeof(f->'required') is distinct from 'boolean' then return false; end if;
    if f ? 'help' and (jsonb_typeof(f->'help') is distinct from 'string' or length(f->>'help') > 300) then return false; end if;
    if f->>'kind' in ('text','textarea') then
      if not coalesce(f->>'maxLength' ~ '^[0-9]+$',false) then return false; end if;
      if (f->>'maxLength')::numeric < 1 or (f->>'maxLength')::numeric > 2000 then return false; end if;
    elsif f ? 'maxLength' then return false;
    end if;
    if f->>'kind' = 'choice' then
      if jsonb_typeof(f->'options') is distinct from 'array' then return false; end if;
      if jsonb_array_length(f->'options') < 1 or jsonb_array_length(f->'options') > 20 then return false; end if;
      for opt in select value from jsonb_array_elements(f->'options') loop
        if jsonb_typeof(opt) is distinct from 'string' or length(trim(opt #>> '{}')) = 0 or length(opt #>> '{}') > 120 then return false; end if;
      end loop;
      if (select count(distinct value) from jsonb_array_elements(f->'options')) <> jsonb_array_length(f->'options') then return false; end if;
    elsif f ? 'options' then return false;
    end if;
  end loop;
  return true;
end $$;

create or replace function private.normalize_booking_intake(p_schema jsonb,p_answers jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare f jsonb; answer jsonb; result jsonb := '{}'; normalized_value text;
begin
  if not private.booking_intake_schema_valid(p_schema) then raise exception 'BOOKING_INTAKE_SCHEMA_INVALID'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text) > 16384 then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
  if exists (select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(p_schema) schema_field where schema_field->>'id'=k)) then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
  for f in select value from jsonb_array_elements(p_schema) loop
    answer := p_answers->(f->>'id');
    if answer is null or answer = '""'::jsonb then
      if (f->>'required')::boolean then raise exception 'BOOKING_INTAKE_REQUIRED'; end if;
      continue;
    end if;
    if f->>'kind' = 'boolean' then
      if jsonb_typeof(answer) is distinct from 'boolean' then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
      result := result || jsonb_build_object(f->>'id',answer);
    else
      if jsonb_typeof(answer) is distinct from 'string' then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
      normalized_value := trim(answer #>> '{}');
      if normalized_value = '' then
        if (f->>'required')::boolean then raise exception 'BOOKING_INTAKE_REQUIRED'; end if;
        continue;
      end if;
      if f->>'kind' = 'choice' then
        if not ((f->'options') @> jsonb_build_array(normalized_value)) then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
      elsif length(normalized_value) > (f->>'maxLength')::integer then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID';
      end if;
      result := result || jsonb_build_object(f->>'id',normalized_value);
    end if;
  end loop;
  return result;
end $$;

create or replace function private.booking_modality_windows_valid(p_windows jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare w jsonb;
begin
  if jsonb_typeof(p_windows) is distinct from 'array' or octet_length(p_windows::text)>65536 then return false; end if;
  if jsonb_array_length(p_windows)>224 then return false; end if;
  for w in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(w) is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(w) k where k not in ('modality','professionalId','weekday','startTime','endTime')) then return false; end if;
    if not coalesce(w->>'modality' in ('in_person','video'),false) or not coalesce(w->>'weekday' ~ '^[0-6]$',false) or jsonb_typeof(w->'weekday') is distinct from 'number' then return false; end if;
    if not coalesce(w->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$',false) or not coalesce(w->>'endTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$',false) or w->>'startTime'>=w->>'endTime' then return false; end if;
    if w ? 'professionalId' and not coalesce(w->>'professionalId' ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) then return false; end if;
  end loop;
  return true;
end $$;

create table public.booking_integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  public_key text not null unique default encode(extensions.gen_random_bytes(16),'hex') check(public_key ~ '^[a-f0-9]{32}$'),
  name text not null check(length(trim(name)) between 1 and 120),
  is_active boolean not null default false,
  is_default boolean not null default false,
  contract_version integer not null default 1 check(contract_version=1),
  revision bigint not null default 1 check(revision>0),
  theme text not null default 'cita-suite' check(theme in ('cita-suite','natalia')),
  allowed_origins text[] not null default '{}',
  allowed_service_ids uuid[] not null default '{}',
  allowed_professional_ids uuid[] not null default '{}',
  allowed_modalities text[] not null default array['in_person'] check(cardinality(allowed_modalities) between 1 and 2 and allowed_modalities <@ array['in_person','video']),
  video_instructions text check(length(video_instructions)<=1000),
  modality_windows jsonb not null default '[]' check(private.booking_modality_windows_valid(modality_windows)),
  intake_schema jsonb not null default '[]' check(private.booking_intake_schema_valid(intake_schema)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,id),
  check(cardinality(allowed_origins)<=20),
  check(cardinality(allowed_service_ids)<=500),
  check(cardinality(allowed_professional_ids)<=100),
  check(not is_active or cardinality(allowed_origins)>0),
  check(not ('video'=any(allowed_modalities)) or coalesce(length(trim(video_instructions))>0,false))
);
create unique index booking_integrations_one_default_idx on public.booking_integrations(business_id) where is_default;
create index booking_integrations_business_idx on public.booking_integrations(business_id,id);

create or replace function private.validate_booking_integration()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare origin text;
begin
  if tg_op='UPDATE' and (new.business_id is distinct from old.business_id or new.id is distinct from old.id or new.public_key is distinct from old.public_key) then raise exception 'BOOKING_INTEGRATION_IDENTITY_IMMUTABLE'; end if;
  if array_position(new.allowed_origins,null) is not null or array_position(new.allowed_service_ids,null) is not null or array_position(new.allowed_professional_ids,null) is not null or array_position(new.allowed_modalities,null) is not null then raise exception 'BOOKING_INTEGRATION_CONFIGURATION_INVALID'; end if;
  if cardinality(new.allowed_origins)<>(select count(distinct v) from unnest(new.allowed_origins) v) or cardinality(new.allowed_modalities)<>(select count(distinct v) from unnest(new.allowed_modalities) v) then raise exception 'BOOKING_INTEGRATION_CONFIGURATION_INVALID'; end if;
  foreach origin in array new.allowed_origins loop
    if origin !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$' and origin !~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$' then raise exception 'BOOKING_INTEGRATION_ORIGIN_INVALID'; end if;
  end loop;
  if exists(select 1 from unnest(new.allowed_service_ids) as requested(service_id) where not exists(select 1 from public.services s where s.business_id=new.business_id and s.id=requested.service_id)) or exists(select 1 from unnest(new.allowed_professional_ids) as requested(professional_id) where not exists(select 1 from public.professionals p where p.business_id=new.business_id and p.id=requested.professional_id)) then raise exception 'BOOKING_INTEGRATION_SCOPE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(new.modality_windows) as requested(item) where not (requested.item->>'modality'=any(new.allowed_modalities)) or (requested.item ? 'professionalId' and not exists(select 1 from public.professionals p where p.business_id=new.business_id and p.id=(requested.item->>'professionalId')::uuid))) then raise exception 'BOOKING_INTEGRATION_SCOPE_INVALID'; end if;
  new.revision := case when tg_op='UPDATE' then old.revision+1 else 1 end;
  new.updated_at := now();
  return new;
end $$;
create trigger booking_integrations_validate before insert or update on public.booking_integrations for each row execute function private.validate_booking_integration();

-- A shared revision serializes schedule edits against the final reservation.
-- The public availability calculator remains the existing Cita Suite calculator.
alter table public.businesses add column booking_availability_revision bigint not null default 1 check(booking_availability_revision>0);
create or replace function private.advance_booking_availability_revision()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_table_name='businesses' then
    if row(new.timezone,new.public_booking_enabled,new.is_active,new.min_booking_notice_minutes,new.max_booking_days_ahead) is distinct from row(old.timezone,old.public_booking_enabled,old.is_active,old.min_booking_notice_minutes,old.max_booking_days_ahead) then
      new.booking_availability_revision := old.booking_availability_revision+1;
    end if;
    return new;
  end if;
  if tg_op='UPDATE' and old.business_id is distinct from new.business_id then raise exception 'BOOKING_SCHEDULE_BUSINESS_IMMUTABLE'; end if;
  update public.businesses set booking_availability_revision=booking_availability_revision+1 where id=case when tg_op='DELETE' then old.business_id else new.business_id end;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger businesses_booking_revision before update on public.businesses for each row execute function private.advance_booking_availability_revision();
do $$ declare t text; begin
  foreach t in array array['services','professionals','professional_services','availability_rules','availability_exceptions'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.advance_booking_availability_revision()',t||'_booking_revision',t);
  end loop;
end $$;

create table public.appointment_booking_contexts (
  appointment_id uuid primary key,
  business_id uuid not null,
  integration_id uuid not null,
  integration_revision bigint not null,
  contract_version integer not null check(contract_version=1),
  theme_snapshot text not null check(theme_snapshot in ('cita-suite','natalia')),
  entry_point text not null check(entry_point in ('embedded','public_page')),
  modality text not null check(modality in ('in_person','video')),
  video_instructions_snapshot text,
  context_fingerprint text not null check(context_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(business_id,appointment_id),
  foreign key(business_id,appointment_id) references public.appointments(business_id,id) on delete cascade,
  foreign key(business_id,integration_id) references public.booking_integrations(business_id,id) on delete restrict
);
create index appointment_booking_contexts_business_idx on public.appointment_booking_contexts(business_id,appointment_id);
create index appointment_booking_contexts_integration_idx on public.appointment_booking_contexts(business_id,integration_id);

-- Responses are historical patient declarations, never automatic clinical updates.
-- They are excluded from token views, host messages, calendars, and notifications.
create table public.appointment_intake_responses (
  appointment_id uuid primary key,
  business_id uuid not null,
  patient_id uuid not null,
  schema_snapshot jsonb not null check(private.booking_intake_schema_valid(schema_snapshot)),
  free_comment text check(length(free_comment)<=2000),
  answers jsonb not null check(jsonb_typeof(answers)='object' and octet_length(answers::text)<=16384),
  created_at timestamptz not null default now(),
  foreign key(business_id,appointment_id) references public.appointment_booking_contexts(business_id,appointment_id) on delete cascade,
  foreign key(business_id,patient_id) references public.patients(business_id,id) on delete restrict
);
create index appointment_intake_responses_patient_idx on public.appointment_intake_responses(business_id,patient_id);

alter table public.booking_integrations enable row level security;
alter table public.appointment_booking_contexts enable row level security;
alter table public.appointment_intake_responses enable row level security;
create policy booking_integrations_owner_read on public.booking_integrations for select to authenticated using(public.user_can_manage_business(business_id));
create policy appointment_booking_contexts_read on public.appointment_booking_contexts for select to authenticated using(public.user_can_read_appointment(business_id,appointment_id));
create policy appointment_intake_responses_clinical_read on public.appointment_intake_responses for select to authenticated using(public.user_can_read_clinical_patient(business_id,patient_id));
revoke all on public.booking_integrations,public.appointment_booking_contexts,public.appointment_intake_responses from public,anon,authenticated,service_role;
grant select on public.booking_integrations,public.appointment_booking_contexts,public.appointment_intake_responses to authenticated;
grant select,insert,update on public.booking_integrations to service_role;
grant select on public.appointment_booking_contexts,public.appointment_intake_responses to service_role;

create or replace function public.create_integrated_public_appointment(
  p_integration_id uuid,p_integration_revision bigint,p_expected_availability_revision bigint,
  p_patient_name text,p_patient_phone_raw text,p_patient_phone_e164 text,p_patient_email text,
  p_service_id uuid,p_professional_ids uuid[],p_starts_at timestamptz,p_internal_note text,
  p_phone_communication_status text,p_modality text,p_intake_answers jsonb,p_idempotency_key text,
  p_replay_only boolean default false,p_entry_point text default 'embedded'
) returns table(id uuid,patient_id uuid,confirmation_token text,starts_at timestamptz,ends_at timestamptz,service_name_snapshot text,professional_name_snapshot text,patient_created boolean,idempotent_replay boolean,patient_resolution_strategy text)
language plpgsql security definer set search_path = pg_catalog as $$
declare integration public.booking_integrations%rowtype; prior public.appointments%rowtype; context public.appointment_booking_contexts%rowtype; intake public.appointment_intake_responses%rowtype; business public.businesses%rowtype; answers jsonb; fingerprint text; created record; schema jsonb; blocking record; selected_professional uuid;
begin
  if not coalesce(p_entry_point in ('embedded','public_page'),false) then raise exception 'BOOKING_INTEGRATION_CONFIGURATION_INVALID'; end if;
  if coalesce(p_idempotency_key,'') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'APPOINTMENT_IDEMPOTENCY_KEY_INVALID'; end if;
  select * into integration from public.booking_integrations i where i.id=p_integration_id for share;
  if not found then raise exception 'BOOKING_INTEGRATION_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('appointment-create:'||integration.business_id::text||':'||lower(p_idempotency_key),0));
  select * into prior from public.appointments a where a.business_id=integration.business_id and a.creation_request_key=lower(p_idempotency_key);
  if found then
    select * into context from public.appointment_booking_contexts c where c.business_id=integration.business_id and c.appointment_id=prior.id;
    if not found or context.integration_id<>p_integration_id then raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT'; end if;
    select * into intake from public.appointment_intake_responses r where r.business_id=integration.business_id and r.appointment_id=prior.id;
    schema := coalesce(intake.schema_snapshot,'[]'::jsonb);
  elsif coalesce(p_replay_only,false) then return;
  else
    if not integration.is_active then raise exception 'BOOKING_INTEGRATION_UNAVAILABLE'; end if;
    if p_integration_revision is distinct from integration.revision then raise exception 'BOOKING_INTEGRATION_CHANGED'; end if;
    if not coalesce(p_modality=any(integration.allowed_modalities),false) then raise exception 'BOOKING_MODALITY_UNAVAILABLE'; end if;
    if cardinality(integration.allowed_service_ids)>0 and not coalesce(p_service_id=any(integration.allowed_service_ids),false) then raise exception 'BOOKING_INTEGRATION_SCOPE_INVALID'; end if;
    if coalesce(cardinality(p_professional_ids),0) not between 1 and 16 or (cardinality(integration.allowed_professional_ids)>0 and not coalesce(p_professional_ids<@integration.allowed_professional_ids,false)) then raise exception 'BOOKING_INTEGRATION_SCOPE_INVALID'; end if;
    select * into business from public.businesses b where b.id=integration.business_id for share;
    if not found or not business.is_active or not business.public_booking_enabled then raise exception 'PUBLIC_BOOKING_UNAVAILABLE'; end if;
    if p_expected_availability_revision is distinct from business.booking_availability_revision then raise exception 'BOOKING_AVAILABILITY_CHANGED'; end if;
    perform 1 from public.business_subscriptions s where s.business_id=integration.business_id for share;
    if not coalesce(public.business_allows_operation(integration.business_id),false) then raise exception 'PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE'; end if;
    schema := integration.intake_schema;
  end if;
  answers := private.normalize_booking_intake(schema,coalesce(p_intake_answers,'{}'::jsonb));
  fingerprint := encode(extensions.digest(jsonb_build_object('integration',p_integration_id,'revision',p_integration_revision,'entry_point',p_entry_point,'modality',p_modality,'comment',nullif(trim(coalesce(p_internal_note,'')),''),'answers',answers)::text,'sha256'),'hex');
  if prior.id is not null and context.context_fingerprint is distinct from fingerprint then raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT'; end if;
  select * into created from public.create_appointment_with_patient_identity(
    integration.business_id,'public',null,p_patient_name,p_patient_phone_raw,p_patient_phone_e164,p_patient_email,
    false,null,p_service_id,p_professional_ids,p_starts_at,null,null,false,'public_booking',p_phone_communication_status,false,lower(p_idempotency_key),coalesce(p_replay_only,false)
  );
  if created.id is null then return; end if;
  if not created.idempotent_replay then
    select a.blocking_starts_at,a.blocking_ends_at into blocking from public.appointments a where a.id=created.id and a.business_id=integration.business_id;
    foreach selected_professional in array p_professional_ids loop
      if exists(select 1 from jsonb_array_elements(integration.modality_windows) as configured(item) where configured.item->>'modality'=p_modality and (not (configured.item ? 'professionalId') or (configured.item->>'professionalId')::uuid=selected_professional)) and not exists(
        select 1 from jsonb_array_elements(integration.modality_windows) as configured(item)
        where configured.item->>'modality'=p_modality and (not (configured.item ? 'professionalId') or (configured.item->>'professionalId')::uuid=selected_professional)
          and (configured.item->>'weekday')::integer=extract(dow from (p_starts_at at time zone business.timezone))::integer
          and blocking.blocking_starts_at>=(((p_starts_at at time zone business.timezone)::date+(configured.item->>'startTime')::time) at time zone business.timezone)
          and blocking.blocking_ends_at<=(((p_starts_at at time zone business.timezone)::date+(configured.item->>'endTime')::time) at time zone business.timezone)
      ) then raise exception 'BOOKING_MODALITY_UNAVAILABLE'; end if;
    end loop;
    insert into public.appointment_booking_contexts(appointment_id,business_id,integration_id,integration_revision,contract_version,theme_snapshot,entry_point,modality,video_instructions_snapshot,context_fingerprint)
    values(created.id,integration.business_id,integration.id,integration.revision,1,case when p_entry_point='public_page' then 'cita-suite' else integration.theme end,p_entry_point,p_modality,case when p_modality='video' then integration.video_instructions else null end,fingerprint);
    if jsonb_array_length(schema)>0 or nullif(trim(coalesce(p_internal_note,'')),'') is not null then
      insert into public.appointment_intake_responses(appointment_id,business_id,patient_id,schema_snapshot,answers,free_comment) values(created.id,integration.business_id,created.patient_id,schema,answers,nullif(trim(coalesce(p_internal_note,'')),''));
    end if;
  end if;
  return query select created.id,created.patient_id,created.confirmation_token,created.starts_at,created.ends_at,created.service_name_snapshot,created.professional_name_snapshot,created.patient_created,created.idempotent_replay,created.patient_resolution_strategy;
end $$;

revoke all on function public.create_integrated_public_appointment(uuid,bigint,bigint,text,text,text,text,uuid,uuid[],timestamptz,text,text,text,jsonb,text,boolean,text) from public,anon,authenticated;
grant execute on function public.create_integrated_public_appointment(uuid,bigint,bigint,text,text,text,text,uuid,uuid[],timestamptz,text,text,text,jsonb,text,boolean,text) to service_role;
revoke all on function private.booking_intake_schema_valid(jsonb),private.booking_modality_windows_valid(jsonb),private.normalize_booking_intake(jsonb,jsonb),private.validate_booking_integration(),private.advance_booking_availability_revision() from public,anon,authenticated,service_role;
-- CHECK constraints are evaluated by the inserting role. Their pure validator has no data access.
grant usage on schema private to authenticated,service_role;
grant execute on function private.booking_intake_schema_valid(jsonb),private.booking_modality_windows_valid(jsonb) to authenticated,service_role;


-- Fixed minute buckets bound public read abuse without logging personal data.
create table private.booking_integration_read_limits (
  subject_hash text not null check(subject_hash ~ '^[a-f0-9]{64}$'),
  bucket bigint not null,
  used integer not null check(used between 1 and 121),
  primary key(subject_hash,bucket)
);
create index booking_integration_read_limits_bucket_idx on private.booking_integration_read_limits(bucket);
revoke all on private.booking_integration_read_limits from public,anon,authenticated,service_role;
create or replace function public.consume_booking_integration_read_limit(p_subject_hash text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare current_bucket bigint := floor(extract(epoch from clock_timestamp())/60)::bigint; count_used integer;
begin
  if not coalesce(p_subject_hash ~ '^[a-f0-9]{64}$',false) then raise exception 'BOOKING_RATE_LIMIT_INVALID'; end if;
  delete from private.booking_integration_read_limits where ctid in (
    select ctid from private.booking_integration_read_limits where bucket<current_bucket-5 order by bucket limit 100
  );
  insert into private.booking_integration_read_limits as limits(subject_hash,bucket,used) values(p_subject_hash,current_bucket,1)
  on conflict(subject_hash,bucket) do update set used=least(limits.used+1,121) returning used into count_used;
  return count_used<=120;
end $$;
revoke all on function public.consume_booking_integration_read_limit(text) from public,anon,authenticated;
grant execute on function public.consume_booking_integration_read_limit(text) to service_role;


-- One statement returns one JSON document: PostgREST's row cap cannot silently
-- truncate blocking appointments, and related rows share the same MVCC snapshot.
create or replace function public.get_integrated_public_availability_snapshot(
  p_business_id uuid,p_service_id uuid,p_professional_ids uuid[],p_range_start timestamptz,p_range_end timestamptz
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if coalesce(cardinality(p_professional_ids),0) not between 1 and 16 or p_range_start is null or p_range_end is null or p_range_end<=p_range_start or p_range_end-p_range_start>interval '92 days' then raise exception 'BOOKING_AVAILABILITY_RANGE_INVALID'; end if;
  return jsonb_build_object(
    'services',coalesce((select jsonb_agg(to_jsonb(row)) from (select s.id,s.business_id,s.name,s.description,s.duration_minutes,s.buffer_before_minutes,s.buffer_after_minutes,s.price_label,s.is_public,s.is_active,s.sort_order from public.services s where s.business_id=p_business_id and s.id=p_service_id and s.is_active and s.is_public) row),'[]'::jsonb),
    'professionals',coalesce((select jsonb_agg(to_jsonb(row)) from (select p.id,p.name,p.specialty,p.avatar_url,p.is_public,p.is_active,p.sort_order from public.professionals p where p.business_id=p_business_id and p.id=any(p_professional_ids) and p.is_active and p.is_public and length(trim(p.name))>0) row),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(row)) from (select a.service_id,a.professional_id from public.professional_services a where a.business_id=p_business_id and a.service_id=p_service_id and a.professional_id=any(p_professional_ids)) row),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(to_jsonb(row)) from (select r.id,r.professional_id,r.weekday,r.start_time,r.end_time,r.slot_interval_minutes,r.break_minutes,r.is_active from public.availability_rules r where r.business_id=p_business_id and r.professional_id=any(p_professional_ids) and r.is_active) row),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(to_jsonb(row)) from (select e.id,e.professional_id,e.starts_at,e.ends_at,e.type from public.availability_exceptions e where e.business_id=p_business_id and (e.professional_id is null or e.professional_id=any(p_professional_ids)) and e.starts_at<p_range_end and e.ends_at>p_range_start) row),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(to_jsonb(row)) from (select a.id,a.appointment_id,a.professional_id,a.starts_at,a.ends_at,a.base_blocking_starts_at,a.base_blocking_ends_at,a.blocking_starts_at,a.blocking_ends_at from public.appointment_professionals a where a.business_id=p_business_id and a.professional_id=any(p_professional_ids) and a.status in ('reserved','confirmed','reschedule_requested') and a.blocking_starts_at<p_range_end and a.blocking_ends_at>p_range_start) row),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_integrated_public_availability_snapshot(uuid,uuid,uuid[],timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_integrated_public_availability_snapshot(uuid,uuid,uuid[],timestamptz,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;
