begin;
alter table public.businesses add column public_contact_enabled boolean not null default false;
alter table public.businesses add column whatsapp_contact_enabled boolean not null default false;
alter table public.businesses add column whatsapp_phone text check(whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{5,14}$');
alter table public.businesses add column whatsapp_message text check(length(whatsapp_message)<=180);
alter table public.services add column patient_instructions text check(length(patient_instructions)<=2000);
alter table public.services add column public_reminder_description text check(length(public_reminder_description)<=180);
alter table public.appointments add column patient_instructions_snapshot text;
alter table public.appointments add column public_reminder_description_snapshot text;
create function private.snapshot_patient_instructions() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then select patient_instructions,public_reminder_description into new.patient_instructions_snapshot,new.public_reminder_description_snapshot from public.services where id=new.service_id and business_id=new.business_id;
 elsif current_setting('cita.care_override',true) is distinct from 'true' then new.patient_instructions_snapshot:=old.patient_instructions_snapshot;new.public_reminder_description_snapshot:=old.public_reminder_description_snapshot;end if;
 return new;
end $$;
create trigger zz_patient_instructions before insert or update on public.appointments for each row execute function private.snapshot_patient_instructions();
create function public.save_service_patient_instructions(p_business_id uuid,p_service_id uuid,p_instructions text,p_public_description text,p_expected_updated_at timestamptz) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id) then raise exception 'CARE_ACCESS_DENIED';end if;
 if not exists(select 1 from public.services where id=p_service_id and business_id=p_business_id and updated_at is not distinct from p_expected_updated_at for update) then raise exception 'CARE_CONFIGURATION_CHANGED';end if;
 update public.services set updated_at=clock_timestamp(),patient_instructions=nullif(trim(p_instructions),''),public_reminder_description=nullif(trim(p_public_description),'') where id=p_service_id and business_id=p_business_id;
 if not found then raise exception 'CARE_SERVICE_INVALID';end if;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id) values(p_business_id,auth.uid(),'service.patient_instructions_saved','service',p_service_id);
end $$;
create function public.save_public_practice_settings(p_business_id uuid,p_settings jsonb,p_expected_updated_at timestamptz) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id) or jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text)>4096 then raise exception 'CARE_ACCESS_DENIED';end if;
 if coalesce((p_settings->>'whatsapp_contact_enabled')::boolean,false) and coalesce(p_settings->>'whatsapp_phone','') !~ '^\+[1-9][0-9]{5,14}$' then raise exception 'CARE_PHONE_INVALID';end if;
 if not exists(select 1 from public.businesses where id=p_business_id and updated_at is not distinct from p_expected_updated_at for update) then raise exception 'CARE_CONFIGURATION_CHANGED';end if;
 update public.businesses set updated_at=clock_timestamp(),patient_documents_enabled=coalesce((p_settings->>'patient_documents_enabled')::boolean,false),public_contact_enabled=coalesce((p_settings->>'public_contact_enabled')::boolean,false),whatsapp_contact_enabled=coalesce((p_settings->>'whatsapp_contact_enabled')::boolean,false),whatsapp_phone=nullif(p_settings->>'whatsapp_phone',''),whatsapp_message=nullif(trim(p_settings->>'whatsapp_message'),'') where id=p_business_id;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id) values(p_business_id,auth.uid(),'business.public_practice_settings_saved','business',p_business_id);
end $$;
create function public.get_public_practice_contact(p_key text) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare integration public.booking_integrations%rowtype;business public.businesses%rowtype;
begin
 select * into integration from public.booking_integrations where public_key=p_key;
 if not found then raise exception 'PUBLIC_CONTACT_UNAVAILABLE';end if;
 select * into business from public.businesses where id=integration.business_id and is_active and public_contact_enabled;
 if not found then raise exception 'PUBLIC_CONTACT_UNAVAILABLE';end if;
 return jsonb_build_object('allowed_origins',integration.allowed_origins,'contact',jsonb_build_object('phone',business.phone,'address',business.address,'whatsapp_phone',case when business.whatsapp_contact_enabled then business.whatsapp_phone end,'whatsapp_message',case when business.whatsapp_contact_enabled then business.whatsapp_message end));
end $$;
revoke all on function private.snapshot_patient_instructions() from public,anon,authenticated,service_role;
revoke all on function public.save_service_patient_instructions(uuid,uuid,text,text,timestamptz),public.save_public_practice_settings(uuid,jsonb,timestamptz),public.get_public_practice_contact(text) from public,anon,authenticated,service_role;
grant execute on function public.save_service_patient_instructions(uuid,uuid,text,text,timestamptz),public.save_public_practice_settings(uuid,jsonb,timestamptz) to authenticated;
grant execute on function public.get_public_practice_contact(text) to service_role;
create or replace function public.get_public_booking_information(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.appointments%rowtype; s jsonb; initial public.appointment_intake_responses%rowtype; latest public.appointment_intake_submissions%rowtype;
begin
 a:=private.booking_information_appointment(p_token);
 select schema_snapshot into s from public.appointment_patient_information_contexts where appointment_id=a.id;
 select * into initial from public.appointment_intake_responses where appointment_id=a.id and patient_id=a.patient_id;
 select * into latest from public.appointment_intake_submissions where appointment_id=a.id and patient_id=a.patient_id order by sequence_no desc limit 1;
 return jsonb_build_object('documents_enabled',coalesce((select patient_documents_enabled from public.businesses where id=a.business_id),false),'theme',coalesce((select theme_snapshot from public.appointment_booking_contexts where appointment_id=a.id),'cita-suite'),'schema',s,'schema_hash',encode(extensions.digest(s::text,'sha256'),'hex'),'answers',coalesce(latest.answers,initial.answers,'{}'),'comment',coalesce(latest.free_comment,initial.free_comment,''),'version',coalesce(latest.id::text,'initial'));
end $$;
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
 return jsonb_build_object('services',services,'modalities',i.allowed_modalities,'contact',jsonb_build_object('phone',b.phone,'address',b.address,'whatsapp_phone',case when b.whatsapp_contact_enabled then b.whatsapp_phone end,'whatsapp_message',case when b.whatsapp_contact_enabled then b.whatsapp_message end));
end $$;
alter table public.appointments add constraint care_snapshot_lengths check(length(patient_instructions_snapshot)<=2000 and length(public_reminder_description_snapshot)<=180);
create function public.save_appointment_patient_instructions(p_business_id uuid,p_appointment_id uuid,p_expected_updated_at timestamptz,p_instructions text,p_public_description text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not public.business_allows_operation(p_business_id) or not public.patient_document_in_appointment_scope(p_business_id,p_appointment_id,auth.uid()) then raise exception 'CARE_ACCESS_DENIED';end if;
 perform 1 from public.appointments where business_id=p_business_id and id=p_appointment_id and updated_at is not distinct from p_expected_updated_at for update;
 if not found then raise exception 'CARE_CONFIGURATION_CHANGED';end if;
 perform set_config('cita.care_override','true',true);
 update public.appointments set patient_instructions_snapshot=nullif(trim(p_instructions),''),public_reminder_description_snapshot=nullif(trim(p_public_description),''),updated_at=clock_timestamp(),updated_by_user_id=auth.uid() where business_id=p_business_id and id=p_appointment_id;
 perform set_config('cita.care_override','false',true);
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id) values(p_business_id,auth.uid(),'appointment.patient_instructions_saved','appointment',p_appointment_id);
end $$;
revoke all on function public.save_appointment_patient_instructions(uuid,uuid,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_appointment_patient_instructions(uuid,uuid,timestamptz,text,text) to authenticated;

commit;
