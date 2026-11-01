-- Plan de señas y avisos, 12.16 (20261101010000 y 20261101020000), with isolated synthetic data:
-- the «medicine» industry is accepted and an unknown one still refused; a choice question takes up
-- to 40 options (a practice's insurance list of 24 included) and refuses 41, in the validator, in an
-- integration and through the owner's own form command, whose answers still have to be an option.
begin;
select extensions.plan(1);
do $$
declare
 owner_id uuid:=gen_random_uuid();biz uuid;prof uuid;integration uuid;revision bigint;
 options24 jsonb:=(select jsonb_agg('Obra social '||n order by n) from generate_series(1,24)n);
 options40 jsonb:=(select jsonb_agg('Obra social '||n order by n) from generate_series(1,40)n);
 options41 jsonb:=(select jsonb_agg('Obra social '||n order by n) from generate_series(1,41)n);
 field24 jsonb;field41 jsonb;saved jsonb;
begin
 insert into auth.users(id,email) values(owner_id,'natalia-support-owner@example.test');
 insert into public.businesses(name,slug,industry,timezone) values('Consultorio sintético médico','med-'||gen_random_uuid(),'medicine','America/Argentina/Cordoba') returning id into biz;
 if (select industry from public.businesses where id=biz) is distinct from 'medicine' then raise exception 'FAIL_MEDICINE_INSERT';end if;
 update public.businesses set industry='other' where id=biz;
 update public.businesses set industry='medicine' where id=biz;
 begin
  update public.businesses set industry='veterinary' where id=biz;
  raise exception 'FAIL_UNKNOWN_INDUSTRY_ACCEPTED';
 exception when check_violation then null;
 end;

 field24:=jsonb_build_object('id','insurance_list','label','Obra social','kind','choice','required',true,'options',options24);
 field41:=jsonb_build_object('id','insurance_list','label','Obra social','kind','choice','required',true,'options',options41);
 if not private.booking_intake_schema_valid(jsonb_build_array(field24)) then raise exception 'FAIL_24_OPTIONS';end if;
 if not private.booking_intake_schema_valid(jsonb_build_array(field24||jsonb_build_object('options',options40))) then raise exception 'FAIL_40_OPTIONS';end if;
 if private.booking_intake_schema_valid(jsonb_build_array(field41)) then raise exception 'FAIL_41_OPTIONS_ACCEPTED';end if;
 if private.booking_intake_schema_valid(jsonb_build_array(field24||jsonb_build_object('options',options24||'["Obra social 1"]'::jsonb))) then raise exception 'FAIL_DUPLICATE_OPTION_ACCEPTED';end if;
 if not private.booking_patient_schema_valid(jsonb_build_array(field24||'{"patientField":"insurance"}'::jsonb)) then raise exception 'FAIL_24_PATIENT_FIELD';end if;

 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(biz,owner_id,'owner','active',now());
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null where business_id=biz;
 insert into public.professionals(business_id,name) values(biz,'Profesional sintética') returning id into prof;
 insert into public.booking_integrations(business_id,name,intake_schema) values(biz,'Web sintética',jsonb_build_array(field24)) returning id into integration;
 begin
  update public.booking_integrations set intake_schema=jsonb_build_array(field41) where id=integration;
  raise exception 'FAIL_41_OPTIONS_STORED';
 exception when check_violation then null;
 end;

 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  perform public.save_professional_booking_form(biz,prof,0,jsonb_build_array(field41||'{"patientField":"insurance"}'::jsonb));
  raise exception 'FAIL_41_OPTIONS_SAVED';
 exception when others then if sqlerrm<>'BOOKING_INTAKE_SCHEMA_INVALID' then raise; end if;
 end;
 perform public.save_professional_booking_form(biz,prof,0,jsonb_build_array(field24||'{"patientField":"insurance"}'::jsonb));
 select fields,f.revision into saved,revision from public.professional_booking_forms f where professional_id=prof;
 if jsonb_array_length(saved->0->'options')<>24 or saved->0->>'patientField'<>'insurance' or revision<>1 then raise exception 'FAIL_24_OPTIONS_FORM %',saved;end if;
 if private.normalize_patient_answers(saved,jsonb_build_object('insurance_list','Obra social 24'))->>'insurance_list'<>'Obra social 24' then raise exception 'FAIL_LAST_OPTION_ANSWER';end if;
 begin
  perform private.normalize_patient_answers(saved,jsonb_build_object('insurance_list','Obra social 25'));
  raise exception 'FAIL_UNLISTED_ANSWER_ACCEPTED';
 exception when others then if sqlerrm not like 'BOOKING_INTAKE_%' then raise; end if;
 end;
end $$;
select extensions.pass('The medicine industry and insurance lists of up to 40 options, refused above, in every path that stores them');
select * from extensions.finish();
rollback;
