-- Public patient declarations: configured per professional and committed with the reservation.
-- No file-upload capability is provisioned in this release.
begin;
create or replace function private.booking_patient_schema_valid(s jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb; ids text[]:='{}'; target text; targets text[]:='{}';
begin
 if jsonb_typeof(s) is distinct from 'array' or jsonb_array_length(s)>64 or octet_length(s::text)>16384 then return false; end if;
 for f in select value from jsonb_array_elements(s) loop
  if not private.booking_intake_schema_valid(jsonb_build_array(f-'patientField')) or f->>'id'=any(ids) then return false; end if;
  ids:=array_append(ids,f->>'id'); target:=f->>'patientField';
  if target is not null and target<>'custom' and (target=any(targets) or (target in ('age','birth_date') and f->>'kind'<>'text')) then return false; end if;
  if target is not null and target<>'custom' then targets:=array_append(targets,target); end if;
  if f ? 'patientField' and (not coalesce(target in ('insurance','insurance_plan','birth_date','age','medication','background','allergies','dni','address','custom'),false) or (target<>'custom' and f->>'kind'='boolean')) then return false; end if;
 end loop; return true;
end $$;
create or replace function private.normalize_patient_answers(s jsonb,a jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb; result jsonb:='{}';
begin
 if not private.booking_patient_schema_valid(s) or jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>16384 then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
 if exists(select 1 from jsonb_object_keys(a) k where not exists(select 1 from jsonb_array_elements(s) configured where configured->>'id'=k)) then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
 for f in select value from jsonb_array_elements(s) loop
  result:=result||private.normalize_booking_intake(jsonb_build_array(f-'patientField'),case when a ? (f->>'id') then jsonb_build_object(f->>'id',a->(f->>'id')) else '{}' end);
 end loop; return result;
end $$;
create table public.professional_booking_forms(
 business_id uuid not null,professional_id uuid primary key,revision bigint not null default 1,
 fields jsonb not null default '[]' check(private.booking_patient_schema_valid(fields) and jsonb_array_length(fields)<=24),
 updated_at timestamptz not null default now(),
 foreign key(business_id,professional_id) references public.professionals(business_id,id) on delete cascade
);
alter table public.professional_booking_forms enable row level security;
create policy professional_booking_forms_read on public.professional_booking_forms for select to authenticated using(
 public.user_can_manage_business(business_id) or exists(select 1 from public.professional_users pu where pu.business_id=professional_booking_forms.business_id and pu.professional_id=professional_booking_forms.professional_id and pu.user_id=auth.uid())
);
revoke all on public.professional_booking_forms from public,anon,authenticated,service_role;
grant select on public.professional_booking_forms to authenticated,service_role;
create or replace function public.save_professional_booking_form(p_business_id uuid,p_professional_id uuid,p_expected_revision bigint,p_fields jsonb)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare current_revision bigint; result bigint;
begin
 if not coalesce(public.business_allows_operation(p_business_id),false) or not coalesce(public.user_can_manage_business(p_business_id) or (
 public.user_business_role(p_business_id)='professional' and exists(select 1 from public.professional_users pu where pu.business_id=p_business_id and pu.professional_id=p_professional_id and pu.user_id=auth.uid())),false) then raise exception 'BOOKING_CONFIG_ACCESS_DENIED'; end if;
 if not private.booking_patient_schema_valid(p_fields) or jsonb_array_length(p_fields)>24 then raise exception 'BOOKING_INTAKE_SCHEMA_INVALID'; end if;
 if not exists(select 1 from public.professionals where id=p_professional_id and business_id=p_business_id) then raise exception 'BOOKING_INTEGRATION_SCOPE_INVALID'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 select revision into current_revision from public.professional_booking_forms where professional_id=p_professional_id for update;
 if coalesce(current_revision,0) is distinct from p_expected_revision then raise exception 'BOOKING_INTEGRATION_CHANGED'; end if;
 insert into public.professional_booking_forms(business_id,professional_id,fields) values(p_business_id,p_professional_id,p_fields)
 on conflict(professional_id) do update set fields=excluded.fields,revision=professional_booking_forms.revision+1,updated_at=clock_timestamp() returning revision into result;
 return result;
end $$;
create or replace function private.patient_booking_schema(p_business_id uuid,p_professionals uuid[],p_fallback jsonb default '[]')
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result jsonb:=p_fallback; row record; f jsonb; prior jsonb; index_found integer; target text; choices jsonb;
begin
 for row in select p.id,p.name,forms.fields from public.professionals p join public.professional_booking_forms forms on forms.professional_id=p.id and forms.business_id=p.business_id
  where p.business_id=p_business_id and p.id=any(p_professionals) and p.is_active and p.is_public order by p.id loop
  for f in select value from jsonb_array_elements(row.fields) loop
   target:=f->>'patientField';
   f:=jsonb_set(f,'{id}',to_jsonb(case when target is not null and target<>'custom' then 'profile_'||target else 'prof_'||md5(row.id::text||':'||(f->>'id')) end));
   select (ordinality-1)::integer,value into index_found,prior from jsonb_array_elements(result) with ordinality where value->>'id'=f->>'id';
   if found then
    if prior->>'patientField' is distinct from target then raise exception 'BOOKING_INTAKE_SCHEMA_INVALID'; end if;
    f:=jsonb_set(f,'{required}',to_jsonb((f->>'required')::boolean or (prior->>'required')::boolean));
    if f->>'kind'='choice' and prior->>'kind'='choice' then
     select coalesce(jsonb_agg(value),'[]') into choices from jsonb_array_elements(f->'options') where (prior->'options') @> jsonb_build_array(value);
     if jsonb_array_length(choices)=0 then raise exception 'BOOKING_PROFILE_OPTIONS_CONFLICT'; end if;
     f:=jsonb_set(f,'{options}',choices);
    elsif f->>'kind'<>prior->>'kind' then
     if f->>'kind'='choice' or prior->>'kind'='choice' then raise exception 'BOOKING_PROFILE_OPTIONS_CONFLICT'; end if;
     f:=(f-'options')||jsonb_build_object('kind','textarea','maxLength',least(coalesce((f->>'maxLength')::integer,2000),coalesce((prior->>'maxLength')::integer,2000)));
    elsif f->>'kind' in ('text','textarea') then
     f:=jsonb_set(f,'{maxLength}',to_jsonb(least((f->>'maxLength')::integer,(prior->>'maxLength')::integer)));
    end if;
    result:=jsonb_set(result,array[index_found::text],f);
   else result:=result||jsonb_build_array(f);
   end if;
  end loop;
 end loop;
 if not private.booking_patient_schema_valid(result) then raise exception 'BOOKING_INTAKE_SCHEMA_INVALID'; end if;
 return result;
end $$;
create or replace function public.get_public_patient_booking_schema(p_business_id uuid,p_professional_ids uuid[],p_integration_id uuid default null,p_request_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare fallback jsonb:='[]'; s jsonb;
begin
 if p_request_key is not null then
  select c.schema_snapshot into s from public.appointment_patient_information_contexts c join public.appointments a on a.id=c.appointment_id left join public.appointment_booking_contexts bc on bc.appointment_id=a.id where a.business_id=p_business_id and a.creation_request_key=lower(p_request_key) and bc.integration_id is not distinct from p_integration_id;
  if found then return jsonb_build_object('schema',s,'hash',encode(extensions.digest(s::text,'sha256'),'hex')); end if;
 end if;
 if p_integration_id is not null then select intake_schema into fallback from public.booking_integrations where id=p_integration_id and business_id=p_business_id; if not found then raise exception 'BOOKING_INTEGRATION_SCOPE_INVALID'; end if; end if;
 s:=private.patient_booking_schema(p_business_id,p_professional_ids,fallback);
 return jsonb_build_object('schema',s,'hash',encode(extensions.digest(s::text,'sha256'),'hex'));
end $$;
create table public.appointment_patient_information_contexts(
 appointment_id uuid primary key,business_id uuid not null,patient_id_snapshot uuid not null,
 schema_snapshot jsonb not null check(private.booking_patient_schema_valid(schema_snapshot)),
 request_fingerprint text check(request_fingerprint ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now(),
 unique(business_id,appointment_id),
 foreign key(business_id,appointment_id) references public.appointments(business_id,id) on delete cascade,
 foreign key(business_id,patient_id_snapshot) references public.patients(business_id,id) on delete restrict
);
-- Existing integrated reservations keep the questionnaire and original-patient declaration they already had.
insert into public.appointment_patient_information_contexts(appointment_id,business_id,patient_id_snapshot,schema_snapshot)
 select c.appointment_id,c.business_id,coalesce(r.patient_id,a.patient_id),coalesce(r.schema_snapshot,'[]') from public.appointment_booking_contexts c join public.appointments a on a.id=c.appointment_id left join public.appointment_intake_responses r on r.appointment_id=c.appointment_id;
alter table public.appointment_patient_information_contexts enable row level security;
create policy patient_information_contexts_clinical_read on public.appointment_patient_information_contexts for select to authenticated using(public.user_can_read_clinical_patient(business_id,patient_id_snapshot));
create table public.appointment_intake_submissions(
 id uuid primary key default gen_random_uuid(),sequence_no bigint generated always as identity unique,business_id uuid not null,appointment_id uuid not null,patient_id uuid not null,request_key uuid not null,
 schema_snapshot jsonb not null check(private.booking_patient_schema_valid(schema_snapshot)),
 answers jsonb not null check(jsonb_typeof(answers)='object' and octet_length(answers::text)<=16384),
 free_comment text check(length(free_comment)<=2000),profile_changes jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 unique(appointment_id,request_key),foreign key(business_id,appointment_id) references public.appointment_patient_information_contexts(business_id,appointment_id) on delete cascade,
 foreign key(business_id,patient_id) references public.patients(business_id,id) on delete restrict
);
create index intake_submissions_history_idx on public.appointment_intake_submissions(business_id,patient_id,created_at desc,id desc);
create index intake_submissions_latest_idx on public.appointment_intake_submissions(appointment_id,sequence_no desc);
alter table public.appointment_intake_submissions enable row level security;
create policy intake_submissions_clinical_read on public.appointment_intake_submissions for select to authenticated using(public.user_can_read_clinical_patient(business_id,patient_id));
revoke all on public.appointment_patient_information_contexts,public.appointment_intake_submissions from public,anon,authenticated,service_role;
grant select on public.appointment_patient_information_contexts,public.appointment_intake_submissions to authenticated,service_role;
create or replace function private.apply_booking_answers_to_patient(p_business_id uuid,p_patient_id uuid,s jsonb,answers jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare patient public.patients%rowtype; profile public.patient_clinical_profiles%rowtype; f jsonb; target text; answer_value text; mapped jsonb:='{}'; before_values jsonb:='{}'; after_values jsonb:='{}';
 custom jsonb; extra jsonb; has_clinical boolean:=false; reported_at timestamptz:=clock_timestamp(); date_value date; local_today date;
begin
 select * into patient from public.patients where id=p_patient_id and business_id=p_business_id for update;
 if not found then raise exception 'PATIENT_NOT_FOUND'; end if;
 select * into profile from public.patient_clinical_profiles where patient_id=p_patient_id and business_id=p_business_id for update;
 reported_at:=clock_timestamp();
 custom:=coalesce(profile.custom_fields,'{}'); if jsonb_typeof(custom)<>'object' then custom:=jsonb_build_object('previous_value',custom); end if;
 extra:=coalesce(custom->'booking_fields','{}'); local_today:=(statement_timestamp() at time zone (select timezone from public.businesses where id=p_business_id))::date;
 for f in select value from jsonb_array_elements(s) loop
  if not (answers ? (f->>'id')) or not (f ? 'patientField') then continue; end if;
  target:=f->>'patientField'; answer_value:=answers->>(f->>'id');
  if target='custom' then
   before_values:=before_values||jsonb_build_object(f->>'id',extra->(f->>'id'));
   extra:=jsonb_set(extra,array[f->>'id'],jsonb_build_object('label',f->>'label','value',answers->(f->>'id'),'reported_at',statement_timestamp())); after_values:=after_values||jsonb_build_object(f->>'id',extra->(f->>'id')); has_clinical:=true;
  elsif target='age' then
   if answer_value !~ '^[0-9]{1,3}$' or answer_value::integer>130 then raise exception 'BOOKING_PROFILE_DATA_INVALID'; end if;
   before_values:=before_values||jsonb_build_object(target,custom->'booking_age'); custom:=custom||jsonb_build_object('booking_age',jsonb_build_object('years',answer_value::integer,'as_of',local_today)); after_values:=after_values||jsonb_build_object(target,custom->'booking_age'); has_clinical:=true;
  elsif target='birth_date' then
   if answer_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'BOOKING_PROFILE_DATA_INVALID'; end if;
   begin date_value:=answer_value::date; exception when others then raise exception 'BOOKING_PROFILE_DATA_INVALID'; end;
   if date_value>local_today or date_value<local_today-interval '130 years' then raise exception 'BOOKING_PROFILE_DATA_INVALID'; end if;
   mapped:=mapped||jsonb_build_object(target,answer_value);
  else
   mapped:=mapped||jsonb_build_object(target,answer_value);
   if target in ('medication','background','allergies') then has_clinical:=true; end if;
  end if;
 end loop;
 if mapped ? 'birth_date' and after_values ? 'age' and extract(year from age(local_today,(mapped->>'birth_date')::date))::integer<>(custom->'booking_age'->>'years')::integer then raise exception 'BOOKING_PROFILE_DATA_INVALID'; end if;
 for target in select jsonb_object_keys(mapped) loop
  before_values:=before_values||jsonb_build_object(target,case when target in ('medication','background','allergies') then to_jsonb(profile)->target else to_jsonb(patient)->target end);
  after_values:=after_values||jsonb_build_object(target,mapped->target);
 end loop;
 update public.patients set insurance=case when mapped ? 'insurance' then mapped->>'insurance' else patient.insurance end,
  insurance_plan=case when mapped ? 'insurance_plan' then mapped->>'insurance_plan' else patient.insurance_plan end,
  birth_date=case when mapped ? 'birth_date' then (mapped->>'birth_date')::date else patient.birth_date end,
  dni=case when mapped ? 'dni' then mapped->>'dni' else patient.dni end,address=case when mapped ? 'address' then mapped->>'address' else patient.address end
  where id=patient.id and mapped ?| array['insurance','insurance_plan','birth_date','dni','address'];
 if has_clinical then
  custom:=custom||jsonb_build_object('booking_last_reported_at',reported_at);
  if extra<>'{}' then custom:=custom||jsonb_build_object('booking_fields',extra); end if;
  if octet_length(custom::text)>65536 then raise exception 'BOOKING_INFORMATION_LIMIT'; end if;
  insert into public.patient_clinical_profiles(business_id,patient_id,allergies,medication,background,custom_fields,created_by,updated_by,updated_at)
   values(p_business_id,p_patient_id,case when mapped ? 'allergies' then mapped->>'allergies' else profile.allergies end,case when mapped ? 'medication' then mapped->>'medication' else profile.medication end,case when mapped ? 'background' then mapped->>'background' else profile.background end,custom,null,null,reported_at)
  on conflict(business_id,patient_id) do update set allergies=excluded.allergies,medication=excluded.medication,background=excluded.background,custom_fields=excluded.custom_fields,updated_by=null,updated_at=reported_at;
 end if;
 return jsonb_build_object('before',before_values,'after',after_values,'source','patient_booking');
end $$;
create or replace function public.create_public_booking_with_information(p_input jsonb,p_replay_only boolean default false)
returns table(id uuid,patient_id uuid,confirmation_token text,starts_at timestamptz,ends_at timestamptz,service_name_snapshot text,professional_name_snapshot text,patient_created boolean,idempotent_replay boolean,patient_resolution_strategy text)
language plpgsql security definer set search_path=pg_catalog as $$
declare biz uuid:=(p_input->>'business_id')::uuid; professionals uuid[]; integration uuid:=(p_input->>'integration_id')::uuid;
 s jsonb; info jsonb; normalized jsonb; fingerprint text; request_key text:=lower(p_input->>'request_key'); previous public.appointments%rowtype; context public.appointment_patient_information_contexts%rowtype;
 created record; legacy_answers jsonb:='{}'; field jsonb; submission_id uuid; changes jsonb; comment text:=nullif(trim(p_input->>'comment'),'');
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>65536 or not coalesce(request_key ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) or length(coalesce(comment,''))>2000 then raise exception 'BOOKING_FORM_INVALID'; end if;
 select array_agg(value::uuid) into professionals from jsonb_array_elements_text(p_input->'professional_ids');
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
create or replace function private.booking_information_appointment(p_token text)
returns public.appointments language plpgsql security definer set search_path=pg_catalog as $$
declare a public.appointments%rowtype;
begin
 select ap.* into a from public.appointments ap join public.appointment_patient_information_contexts c on c.appointment_id=ap.id and c.business_id=ap.business_id join public.patients p on p.id=ap.patient_id join public.businesses b on b.id=ap.business_id
  where ap.confirmation_token=p_token and c.patient_id_snapshot=ap.patient_id and ap.status in ('reserved','confirmed','reschedule_requested') and ap.starts_at>statement_timestamp() and p.archived_at is null and b.is_active and public.business_allows_operation(ap.business_id);
 if not found then raise exception 'BOOKING_INFORMATION_UNAVAILABLE'; end if; return a;
end $$;
create or replace function public.get_public_booking_information(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.appointments%rowtype; s jsonb; initial public.appointment_intake_responses%rowtype; latest public.appointment_intake_submissions%rowtype;
begin
 a:=private.booking_information_appointment(p_token);
 select schema_snapshot into s from public.appointment_patient_information_contexts where appointment_id=a.id;
 select * into initial from public.appointment_intake_responses where appointment_id=a.id and patient_id=a.patient_id;
 select * into latest from public.appointment_intake_submissions where appointment_id=a.id and patient_id=a.patient_id order by sequence_no desc limit 1;
 return jsonb_build_object('theme',coalesce((select theme_snapshot from public.appointment_booking_contexts where appointment_id=a.id),'cita-suite'),'schema',s,'schema_hash',encode(extensions.digest(s::text,'sha256'),'hex'),'answers',coalesce(latest.answers,initial.answers,'{}'),'comment',coalesce(latest.free_comment,initial.free_comment,''),'version',coalesce(latest.id::text,'initial'));
end $$;
create or replace function public.submit_public_booking_information(p_token text,p_request_key uuid,p_schema_hash text,p_expected_version text,p_answers jsonb,p_comment text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare a public.appointments%rowtype; info jsonb; normalized jsonb; prior public.appointment_intake_submissions%rowtype; result uuid; changes jsonb;
begin
 a:=private.booking_information_appointment(p_token); perform 1 from public.appointments where id=a.id for update; a:=private.booking_information_appointment(p_token);
 info:=public.get_public_booking_information(p_token); normalized:=private.normalize_patient_answers(info->'schema',coalesce(p_answers,'{}'));
 if length(coalesce(p_comment,''))>2000 or p_request_key is null then raise exception 'BOOKING_INTAKE_ANSWERS_INVALID'; end if;
 select * into prior from public.appointment_intake_submissions where appointment_id=a.id and request_key=p_request_key;
 if found then
  if prior.answers is distinct from normalized or prior.free_comment is distinct from nullif(trim(coalesce(p_comment,'')),'') then raise exception 'BOOKING_INFORMATION_REQUEST_CONFLICT'; end if; return prior.id;
 end if;
 if info->>'schema_hash' is distinct from p_schema_hash or info->>'version' is distinct from p_expected_version then raise exception 'BOOKING_INFORMATION_CHANGED'; end if;
 if (select count(*) from public.appointment_intake_submissions where appointment_id=a.id)>=50 then raise exception 'BOOKING_INFORMATION_LIMIT'; end if;
 insert into public.appointment_intake_submissions(business_id,appointment_id,patient_id,request_key,schema_snapshot,answers,free_comment) values(a.business_id,a.id,a.patient_id,p_request_key,info->'schema',normalized,nullif(trim(coalesce(p_comment,'')),'')) returning id into result;
 changes:=private.apply_booking_answers_to_patient(a.business_id,a.patient_id,info->'schema',normalized); update public.appointment_intake_submissions set profile_changes=changes where id=result;
 return result;
end $$;
create or replace function public.save_booking_integration(p_business_id uuid,p_integration_id uuid,p_expected_revision bigint,p_config jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i public.booking_integrations%rowtype; services uuid[]; professionals uuid[]; origins text[]; modalities text[]; active boolean; default_profile boolean;
begin
  if not coalesce(public.user_can_manage_business(p_business_id),false) or not coalesce(public.business_allows_operation(p_business_id),false) then raise exception 'BOOKING_CONFIG_ACCESS_DENIED'; end if;
  if jsonb_typeof(p_config) is distinct from 'object' or octet_length(p_config::text)>65536 then raise exception 'BOOKING_INTEGRATION_CONFIGURATION_INVALID'; end if;
  perform 1 from public.businesses where id=p_business_id for update;
  if p_integration_id is not null then
    select * into i from public.booking_integrations where id=p_integration_id and business_id=p_business_id for update;
    if not found or i.revision is distinct from p_expected_revision then raise exception 'BOOKING_INTEGRATION_CHANGED'; end if;
  elsif (select count(*) from public.booking_integrations where business_id=p_business_id)>=20 then raise exception 'BOOKING_INFORMATION_LIMIT'; end if;
  select coalesce(array_agg(value::uuid),'{}') into services from jsonb_array_elements_text(p_config->'service_ids');
  select coalesce(array_agg(value::uuid),'{}') into professionals from jsonb_array_elements_text(p_config->'professional_ids');
  select coalesce(array_agg(value),'{}') into origins from jsonb_array_elements_text(p_config->'origins');
  select coalesce(array_agg(value),'{}') into modalities from jsonb_array_elements_text(p_config->'modalities');
  active:=coalesce((p_config->>'active')::boolean,false); default_profile:=coalesce((p_config->>'default')::boolean,false);
  if active then
    if cardinality(services)=0 or cardinality(professionals)=0 or cardinality(origins)=0
      or not exists(select 1 from public.businesses where id=p_business_id and is_active and public_booking_enabled)
      or exists(select 1 from unnest(professionals) x where not exists(select 1 from public.professionals p where p.id=x and p.business_id=p_business_id and p.is_active and p.is_public and exists(select 1 from public.availability_rules r where r.professional_id=p.id and r.is_active)))
      or exists(select 1 from unnest(services) x where not exists(select 1 from public.services s where s.id=x and s.business_id=p_business_id and s.is_active and s.is_public and exists(select 1 from public.professional_services ps where ps.service_id=s.id and ps.professional_id=any(professionals))))
      then raise exception 'BOOKING_CONFIG_INCOMPLETE'; end if;
  end if;
  if default_profile then update public.booking_integrations set is_default=false where business_id=p_business_id and is_default and id is distinct from p_integration_id; end if;
  if p_integration_id is null then
    insert into public.booking_integrations(business_id,name,theme,is_active,is_default,allowed_origins,allowed_service_ids,allowed_professional_ids,allowed_modalities,video_instructions,intake_schema,modality_windows)
      values(p_business_id,p_config->>'name',p_config->>'theme',active,default_profile,origins,services,professionals,modalities,nullif(trim(p_config->>'video_instructions'),''),p_config->'intake_schema',p_config->'modality_windows') returning * into i;
  else
    update public.booking_integrations set name=p_config->>'name',theme=p_config->>'theme',is_active=active,is_default=default_profile,
      allowed_origins=origins,allowed_service_ids=services,allowed_professional_ids=professionals,allowed_modalities=modalities,
      video_instructions=nullif(trim(p_config->>'video_instructions'),''),intake_schema=p_config->'intake_schema',modality_windows=p_config->'modality_windows'
      where id=i.id returning * into i;
  end if;
  return jsonb_build_object('id',i.id,'public_key',i.public_key,'revision',i.revision);
end $$;


revoke all on function private.booking_patient_schema_valid(jsonb),private.normalize_patient_answers(jsonb,jsonb),private.patient_booking_schema(uuid,uuid[],jsonb),private.apply_booking_answers_to_patient(uuid,uuid,jsonb,jsonb),private.booking_information_appointment(text) from public,anon,authenticated,service_role;
grant execute on function private.booking_patient_schema_valid(jsonb) to authenticated,service_role;
revoke all on function public.get_public_patient_booking_schema(uuid,uuid[],uuid,text),public.create_public_booking_with_information(jsonb,boolean),public.get_public_booking_information(text),public.submit_public_booking_information(text,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.get_public_patient_booking_schema(uuid,uuid[],uuid,text),public.create_public_booking_with_information(jsonb,boolean),public.get_public_booking_information(text),public.submit_public_booking_information(text,uuid,text,text,jsonb,text) to service_role;
revoke all on function public.save_booking_integration(uuid,uuid,bigint,jsonb),public.save_professional_booking_form(uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function public.save_booking_integration(uuid,uuid,bigint,jsonb),public.save_professional_booking_form(uuid,uuid,bigint,jsonb) to authenticated;
-- One MVCC snapshot, one scalar response: metadata is not truncated by a row cap.
create or replace function public.get_public_booking_catalogue(p_integration_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i public.booking_integrations%rowtype; b public.businesses%rowtype; services jsonb;
begin
 select * into i from public.booking_integrations where id=p_integration_id and is_active;
 if not found then raise exception 'BOOKING_INTEGRATION_UNAVAILABLE'; end if;
 select * into b from public.businesses where id=i.business_id and is_active and public_booking_enabled;
 if not found or not coalesce(public.business_allows_operation(i.business_id),false) then raise exception 'BOOKING_INTEGRATION_UNAVAILABLE'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'duration_minutes',s.duration_minutes,'price_label',s.price_label) order by s.sort_order,s.name,s.id),'[]') into services
 from public.services s where s.business_id=i.business_id and s.is_active and s.is_public and (cardinality(i.allowed_service_ids)=0 or s.id=any(i.allowed_service_ids)) and exists(
  select 1 from public.professional_services ps join public.professionals p on p.id=ps.professional_id and p.business_id=ps.business_id
  where ps.business_id=i.business_id and ps.service_id=s.id and p.is_active and p.is_public and (cardinality(i.allowed_professional_ids)=0 or p.id=any(i.allowed_professional_ids))
 );
 return jsonb_build_object('services',services,'modalities',i.allowed_modalities,'contact',jsonb_build_object('phone',b.phone,'address',b.address));
end $$;
revoke all on function public.get_public_booking_catalogue(uuid) from public,anon,authenticated;
grant execute on function public.get_public_booking_catalogue(uuid) to service_role;

commit;
