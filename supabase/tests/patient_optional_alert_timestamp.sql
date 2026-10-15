begin;
select extensions.plan(1);
do $$
declare biz uuid; patient uuid; baseline timestamptz := '2020-01-01T00:00:00Z';
begin
  insert into public.businesses(name,slug,industry) values('Prueba timestamp opcional','optional-alert-'||gen_random_uuid(),'other') returning id into biz;
  insert into public.patients(business_id,full_name,updated_at) values(biz,'Paciente sintético',baseline) returning id into patient;
  update public.patients set last_entry_at=now() where id=patient;
  if (select updated_at from public.patients where id=patient)<>baseline then raise exception 'FAIL_ACTIVITY_CHANGED_PROFILE_TIMESTAMP'; end if;
  update public.patients set notes='Cambio demográfico probado' where id=patient;
  if (select updated_at from public.patients where id=patient)<=baseline then raise exception 'FAIL_PROFILE_TIMESTAMP_NOT_ADVANCED'; end if;
  alter table public.patients add column if not exists has_clinical_alert boolean default false;
  update public.patients set updated_at=baseline where id=patient;
  update public.patients set has_clinical_alert=true where id=patient;
  if (select updated_at from public.patients where id=patient)<=baseline then raise exception 'FAIL_OPTIONAL_ALERT_TIMESTAMP_NOT_ADVANCED'; end if;
end $$;
select extensions.pass('patient timestamp works with and without the optional clinical alert column');
select * from extensions.finish();
rollback;
