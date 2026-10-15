-- Isolated transaction; never run against a database with real patient data.
begin;
select extensions.plan(1);

do $$
declare
  owner_id uuid := gen_random_uuid(); foreign_owner uuid := gen_random_uuid(); reception_id uuid := gen_random_uuid();
  biz uuid; other_biz uuid; svc uuid; foreign_svc uuid; prof uuid; foreign_prof uuid; integration uuid; another_integration uuid;
  integration_rev bigint; availability_rev bigint; created record; replay record; native record; error_text text;
  start_at timestamptz := date_trunc('day',now())+interval '15 days 10 hours';
  before_patients integer; before_appointments integer; after_count integer;
  scale_prof uuid; scale_patient uuid; snapshot jsonb;
  definition jsonb := '[{"id":"insurance","label":"Obra social y plan","kind":"text","required":true,"maxLength":120},{"id":"medication","label":"Medicación informada","kind":"textarea","required":false,"maxLength":1000},{"id":"recent_labs","label":"Estudios recientes","kind":"boolean","required":false}]';
  answers jsonb := '{"insurance":" Particular ","medication":"Dato declarado por el paciente","recent_labs":false}';
  request_key text := 'ab000000-0000-4000-8000-000000000001';
begin
  insert into auth.users(id,email) values(owner_id,'booking-owner@example.test'),(foreign_owner,'booking-foreign@example.test'),(reception_id,'booking-reception@example.test');
  insert into public.businesses(name,slug,industry,timezone) values('Consultorio prueba integración','booking-foundation-'||gen_random_uuid(),'other','UTC') returning id into biz;
  insert into public.businesses(name,slug,industry,timezone) values('Otro consultorio','booking-foreign-'||gen_random_uuid(),'other','UTC') returning id into other_biz;
  insert into public.business_users(business_id,user_id,role,status,accepted_at) values(biz,owner_id,'owner','active',now()),(biz,reception_id,'reception','active',now()),(other_biz,foreign_owner,'owner','active',now());
  update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null where business_id in (biz,other_biz);
  insert into public.services(business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes) values(biz,'Consulta prueba',30,0,0) returning id into svc;
  insert into public.services(business_id,name,duration_minutes) values(other_biz,'Consulta ajena',30) returning id into foreign_svc;
  insert into public.professionals(business_id,name) values(biz,'Profesional prueba') returning id into prof;
  insert into public.professionals(business_id,name) values(other_biz,'Profesional ajeno') returning id into foreign_prof;
  insert into public.professional_services(business_id,professional_id,service_id) values(biz,prof,svc),(other_biz,foreign_prof,foreign_svc);
  insert into public.booking_integrations(business_id,name,theme,allowed_origins,allowed_service_ids,allowed_professional_ids,allowed_modalities,video_instructions,intake_schema)
    values(biz,'Integración de prueba','natalia',array['https://example.test'],array[svc],array[prof],array['in_person','video'],'El consultorio coordinará el acceso.',definition) returning id,revision into integration,integration_rev;
  if (select is_active from public.booking_integrations where id=integration) then raise exception 'FAIL_DEFAULT_MUST_BE_DISABLED'; end if;
  select booking_availability_revision into availability_rev from public.businesses where id=biz;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Ana Prueba','3425048209','+5493425048209',null,svc,array[prof],start_at,null,'valid','in_person',answers,request_key);
    raise exception 'FAIL_DISABLED_INTEGRATION_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_INTEGRATION_UNAVAILABLE' then raise; end if; end;
  update public.booking_integrations set is_active=true where id=integration returning revision into integration_rev;
  select * into created from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Ana Prueba','3425048209','+5493425048209',null,svc,array[prof],start_at,null,'valid','in_person',answers,request_key);
  if created.id is null or created.idempotent_replay or not created.patient_created then raise exception 'FAIL_ATOMIC_CREATION'; end if;
  if not exists(select 1 from public.appointment_booking_contexts c join public.appointment_intake_responses r using(appointment_id) where c.appointment_id=created.id and c.business_id=biz and c.integration_id=integration and c.theme_snapshot='natalia' and c.modality='in_person' and r.patient_id=created.patient_id and r.answers->>'insurance'='Particular' and r.answers->'recent_labs'='false'::jsonb and r.schema_snapshot=definition) then raise exception 'FAIL_CONTEXT_OR_INTAKE_MISSING'; end if;
  if exists(select 1 from public.patients where id=created.patient_id and (medication is not null or insurance is not null)) then raise exception 'FAIL_PUBLIC_INTAKE_OVERWROTE_CLINICAL_PROFILE'; end if;
  select * into replay from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Ana Prueba','3425048209','+5493425048209',null,svc,array[prof],start_at,null,'valid','in_person',answers,request_key);
  if replay.id<>created.id or not replay.idempotent_replay then raise exception 'FAIL_RETRY_DUPLICATED_APPOINTMENT'; end if;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Ana Prueba','3425048209','+5493425048209',null,svc,array[prof],start_at,null,'valid','in_person',answers||'{"recent_labs":true}',request_key);
    raise exception 'FAIL_REUSED_KEY_CHANGED_INTAKE';
  exception when others then if sqlerrm<>'APPOINTMENT_IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Ana Prueba','3425048209','+5493425048209',null,svc,array[prof],start_at,null,'valid','video',answers,request_key);
    raise exception 'FAIL_REUSED_KEY_CHANGED_MODALITY';
  exception when others then if sqlerrm<>'APPOINTMENT_IDEMPOTENCY_CONFLICT' then raise; end if; end;
  select count(*) into before_patients from public.patients where business_id=biz;
  select count(*) into before_appointments from public.appointments where business_id=biz;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Otra Persona','3425048210','+5493425048210',null,svc,array[prof],start_at,null,'valid','video',answers,gen_random_uuid()::text);
    raise exception 'FAIL_VIRTUAL_AND_PHYSICAL_OVERLAP';
  exception when exclusion_violation then null; end;
  if (select count(*) from public.patients where business_id=biz)<>before_patients or (select count(*) from public.appointments where business_id=biz)<>before_appointments then raise exception 'FAIL_LOSING_RESERVATION_LEFT_ORPHANS'; end if;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Otra Persona','3425048210','+5493425048210',null,foreign_svc,array[prof],start_at+interval '2 hours',null,'valid','video',answers,gen_random_uuid()::text);
    raise exception 'FAIL_FOREIGN_SERVICE_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_INTEGRATION_SCOPE_INVALID' then raise; end if; end;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Otra Persona','3425048210','+5493425048210',null,svc,array[foreign_prof],start_at+interval '2 hours',null,'valid','video',answers,gen_random_uuid()::text);
    raise exception 'FAIL_FOREIGN_PROFESSIONAL_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_INTEGRATION_SCOPE_INVALID' then raise; end if; end;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Otra Persona','3425048210','+5493425048210',null,svc,array[prof],start_at+interval '2 hours',null,'valid','video','{}',gen_random_uuid()::text);
    raise exception 'FAIL_MISSING_REQUIRED_INTAKE_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_INTAKE_REQUIRED' then raise; end if; end;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Otra Persona','3425048210','+5493425048210',null,svc,array[prof],start_at+interval '2 hours',null,'valid','video',answers||'{"undeclared":"x"}',gen_random_uuid()::text);
    raise exception 'FAIL_UNDECLARED_INTAKE_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_INTAKE_ANSWERS_INVALID' then raise; end if; end;
  if (select count(*) from public.patients where business_id=biz)<>before_patients then raise exception 'FAIL_INVALID_INTAKE_CREATED_PATIENT'; end if;
  update public.services set duration_minutes=45 where id=svc;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Otra Persona','3425048210','+5493425048210',null,svc,array[prof],start_at+interval '2 hours',null,'valid','video',answers,gen_random_uuid()::text);
    raise exception 'FAIL_STALE_SCHEDULE_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_AVAILABILITY_CHANGED' then raise; end if; end;
  select booking_availability_revision into availability_rev from public.businesses where id=biz;
  select * into replay from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Paciente Virtual','3425048211','+5493425048211',null,svc,array[prof],start_at+interval '2 hours',null,'valid','video','{"insurance":"Particular"}',gen_random_uuid()::text);
  if not exists(select 1 from public.appointment_booking_contexts where appointment_id=replay.id and modality='video' and video_instructions_snapshot='El consultorio coordinará el acceso.') then raise exception 'FAIL_VIRTUAL_CONTEXT_MISSING'; end if;
  if exists(select 1 from public.appointment_intake_responses response where response.appointment_id=replay.id and response.answers ? 'recent_labs') then raise exception 'FAIL_MISSING_BOOLEAN_BECAME_FALSE'; end if;
  select * into native from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Paciente Nativo','3425048212','+5493425048212',null,svc,array[prof],start_at+interval '4 hours','Comentario privado declarado','valid','in_person','{"insurance":"Particular"}',gen_random_uuid()::text,false,'public_page');
  if not exists(select 1 from public.appointment_booking_contexts where appointment_id=native.id and theme_snapshot='cita-suite' and integration_id=integration and entry_point='public_page') then raise exception 'FAIL_NATIVE_DEFAULT_DIVERGED'; end if;
  if (select internal_note from public.appointments where id=native.id) is not null or not exists(select 1 from public.appointment_intake_responses where appointment_id=native.id and free_comment='Comentario privado declarado') then raise exception 'FAIL_PUBLIC_COMMENT_LEAKS_TO_OPERATIONAL_NOTES'; end if;
  update public.booking_integrations set modality_windows=jsonb_build_array(jsonb_build_object('modality','video','weekday',extract(dow from start_at)::integer,'startTime','11:00','endTime','13:00')) where id=integration returning revision into integration_rev;
  select count(*) into before_patients from public.patients where business_id=biz;
  begin
    perform * from public.create_integrated_public_appointment(integration,integration_rev,availability_rev,'Fuera de modalidad','3425048213','+5493425048213',null,svc,array[prof],start_at+interval '5 hours',null,'valid','video','{"insurance":"Particular"}',gen_random_uuid()::text);
    raise exception 'FAIL_MODALITY_WINDOW_NOT_ATOMIC';
  exception when others then if sqlerrm<>'BOOKING_MODALITY_UNAVAILABLE' then raise; end if; end;
  if (select count(*) from public.patients where business_id=biz)<>before_patients then raise exception 'FAIL_REJECTED_MODALITY_LEFT_PATIENT'; end if;
  -- Exercise the scalar JSON result beyond PostgREST's ordinary 1,000-row cap.
  insert into public.professionals(business_id,name) values(biz,'Profesional carga sintética') returning id into scale_prof;
  insert into public.professional_services(business_id,professional_id,service_id) values(biz,scale_prof,svc);
  insert into public.patients(business_id,full_name) values(biz,'Paciente carga sintética') returning id into scale_patient;
  insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
    select biz,scale_patient,svc,scale_prof,start_at+n*interval '1 hour',start_at+n*interval '1 hour'+interval '45 minutes',start_at+n*interval '1 hour',start_at+n*interval '1 hour'+interval '45 minutes','confirmed','manual','Consulta prueba','Profesional carga sintética',45 from generate_series(0,1004) n;
  snapshot:=public.get_integrated_public_availability_snapshot(biz,svc,array[scale_prof],start_at,start_at+interval '50 days');
  if jsonb_array_length(snapshot->'blocks')<>1005 then raise exception 'FAIL_AVAILABILITY_TRUNCATED'; end if;
  if snapshot::text like '%Paciente carga sintética%' or snapshot::text like '%Comentario privado declarado%' then raise exception 'FAIL_AVAILABILITY_CONTAINS_PATIENT_DATA'; end if;
  snapshot:=public.get_integrated_public_availability_snapshot(other_biz,svc,array[prof],start_at,start_at+interval '1 day');
  if jsonb_array_length(snapshot->'blocks')<>0 or jsonb_array_length(snapshot->'services')<>0 or jsonb_array_length(snapshot->'professionals')<>0 then raise exception 'FAIL_SNAPSHOT_CROSSED_BUSINESS'; end if;
  update public.booking_integrations set theme='cita-suite',is_active=false,intake_schema='[]' where id=integration;
  select * into replay from public.create_integrated_public_appointment(integration,2,availability_rev,'Ana Prueba','3425048209','+5493425048209',null,svc,array[prof],start_at,null,'valid','in_person',answers,request_key,true);
  if replay.id<>created.id or not replay.idempotent_replay then raise exception 'FAIL_COMMITTED_RETRY_BROKEN_BY_CONFIG_CHANGE'; end if;
  if (select theme_snapshot from public.appointment_booking_contexts where appointment_id=created.id)<>'natalia' then raise exception 'FAIL_HISTORICAL_THEME_MUTATED'; end if;
  begin
    update public.booking_integrations set business_id=other_biz where id=integration;
    raise exception 'FAIL_INTEGRATION_REASSIGNED_TO_OTHER_TENANT';
  exception when others then if sqlerrm<>'BOOKING_INTEGRATION_IDENTITY_IMMUTABLE' then raise; end if; end;
  begin
    insert into public.booking_integrations(business_id,name,allowed_origins) values(biz,'Origen inválido',array['https://example.test/path']);
    raise exception 'FAIL_ORIGIN_PATH_ACCEPTED';
  exception when others then if sqlerrm<>'BOOKING_INTEGRATION_ORIGIN_INVALID' then raise; end if; end;
  begin
    insert into public.booking_integrations(business_id,name,allowed_service_ids) values(biz,'Ámbito inválido',array[foreign_svc]);
    raise exception 'FAIL_FOREIGN_CONFIGURATION_SCOPE';
  exception when others then if sqlerrm<>'BOOKING_INTEGRATION_SCOPE_INVALID' then raise; end if; end;
  if has_table_privilege('anon','public.booking_integrations','SELECT') or has_table_privilege('anon','public.appointment_intake_responses','SELECT') or has_function_privilege('anon','public.create_integrated_public_appointment(uuid,bigint,bigint,text,text,text,text,uuid,uuid[],timestamptz,text,text,text,jsonb,text,boolean,text)','EXECUTE') or has_table_privilege('authenticated','public.appointment_booking_contexts','INSERT') or has_table_privilege('service_role','public.appointment_intake_responses','UPDATE') then raise exception 'FAIL_CLIENT_OR_MUTATION_PRIVILEGES'; end if;
  perform set_config('request.jwt.claim.sub',reception_id::text,true);
  set local role authenticated;
  select count(*) into after_count from public.appointment_intake_responses;
  if after_count<>0 then raise exception 'FAIL_RECEPTION_READ_CLINICAL_INTAKE'; end if;
  select count(*) into after_count from public.appointment_booking_contexts where appointment_id=created.id;
  if after_count<>1 then raise exception 'FAIL_RECEPTION_CANNOT_READ_BASIC_CONTEXT'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',foreign_owner::text,true);
  set local role authenticated;
  select count(*) into after_count from public.appointment_intake_responses;
  if after_count<>0 then raise exception 'FAIL_FOREIGN_OWNER_READ_INTAKE'; end if;
  select count(*) into after_count from public.appointment_booking_contexts;
  if after_count<>0 then raise exception 'FAIL_FOREIGN_OWNER_READ_CONTEXT'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  select count(*) into after_count from public.appointment_intake_responses where appointment_id=created.id;
  if after_count<>1 then raise exception 'FAIL_OWNER_CANNOT_READ_INTAKE'; end if;
  reset role;
  for after_count in 1..120 loop
    if not public.consume_booking_integration_read_limit(repeat('a',64)) then raise exception 'FAIL_READ_LIMIT_PREMATURE'; end if;
  end loop;
  if public.consume_booking_integration_read_limit(repeat('a',64)) then raise exception 'FAIL_READ_LIMIT_NOT_ENFORCED'; end if;
  raise notice 'PASS: dormant default, atomic context and intake, stable retries, changed payload rejection, cross-modality exclusion, rollback, tenant scope, required answers, missing-vs-false, schedule revision, config evolution, immutable identity, origins, client privileges, clinical RLS and bounded reads.';
end $$;

select extensions.pass('booking integration transaction and isolation contracts hold');
select * from extensions.finish();
rollback;
