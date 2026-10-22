// The real-device Web Push check, the same on staging and production: one synthetic practice per run,
// `<environment>-device-<run>`, with an appointment three hours ahead, so its 24 h reminder is due on
// the next push run. The person opens the management link on the phone and enables notifications;
// the report reads the delivery stages the service worker acknowledged. Only the run's rows are
// touched, and endpoints are capabilities: only their host is reported.

/** The run's synthetic practice. */
export const devicePractice = (environment, run) => {
	if (!['staging', 'production'].includes(environment) || !/^[a-f0-9]{12}$/.test(run ?? ''))
		throw new Error('A device run needs its environment and an identifier of 12 hexadecimal characters.');
	return `${environment}-device-${run}`;
};

/** The practice, its synthetic owner and patient, and the appointment whose reminder is due next. */
export const deviceSeedSql = (slug, name) => `begin;
do $$
declare
 v_owner uuid:=gen_random_uuid(); v_business uuid; v_service uuid; v_professional uuid; v_patient uuid;
 v_starts timestamptz:=date_trunc('minute',now())+interval '3 hours';
begin
 insert into auth.users(id,email) values(v_owner,'${slug}@example.test');
 insert into public.businesses(name,slug,industry,timezone)
 values('${name}','${slug}','odontology','America/Argentina/Buenos_Aires') returning id into v_business;
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=v_business;
 insert into public.services(business_id,name,duration_minutes) values(v_business,'Consulta',30) returning id into v_service;
 insert into public.professionals(business_id,name) values(v_business,'Profesional sintético') returning id into v_professional;
 insert into public.professional_services(business_id,professional_id,service_id) values(v_business,v_professional,v_service);
 insert into public.patients(owner_id,business_id,full_name) values(v_owner,v_business,'Paciente sintético') returning id into v_patient;
 insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(v_business,v_patient,v_service,v_professional,v_starts,v_starts+interval '30 minutes',v_starts,v_starts+interval '30 minutes',
  'reserved','manual','Consulta','Profesional sintético',30);
end $$;
commit;`;

/** The run's appointment, subscriptions and delivery attempts, without any endpoint beyond its host. */
export const deviceReportSql = (run, slug) => `select json_build_object(
 'run','${run}','reportedAt',now(),
 'appointmentStartsAt',(select a.starts_at from public.appointments a join public.businesses b on b.id=a.business_id where b.slug='${slug}'),
 'subscriptions',coalesce((select json_agg(json_build_object('pushHost',split_part(d.endpoint,'/',3),'createdAt',s.created_at,
   'sent24h',s.push_24h_sent_at,'sent2h',s.push_2h_sent_at,'failures24h',s.push_24h_failures,'detachedAt',s.detached_at,'goneAt',d.provider_gone_at) order by s.created_at)
  from public.push_subscriptions s join public.push_devices d on d.id=s.device_id join public.businesses b on b.id=s.business_id where b.slug='${slug}'),'[]'::json),
 'attempts',coalesce((select json_agg(json_build_object('kind',a.kind,'createdAt',a.created_at,'status',a.push_service_status,'acceptedAt',a.accepted_at,
   'receivedAt',a.received_at,'displayedAt',a.displayed_at,'confirmedAt',a.user_confirmed_at,'failure',a.failure_kind) order by a.created_at)
  from public.push_delivery_attempts a join public.businesses b on b.id=a.business_id where b.slug='${slug}'),'[]'::json)
)`;

/** Removes the run's practice, its devices without other subscriptions and its synthetic owner. */
export const deviceCleanupSql = (slug) => `begin;
create temporary table run_devices on commit drop as
 select distinct s.device_id from public.push_subscriptions s join public.businesses b on b.id=s.business_id where b.slug='${slug}';
delete from public.businesses where slug='${slug}';
delete from public.push_devices d using run_devices r
 where d.id=r.device_id and not exists(select 1 from public.push_subscriptions s where s.device_id=d.id);
delete from auth.users where email='${slug}@example.test';
commit;`;

/** The REST read of the run's management token, made only on the local machine. */
export const deviceLinkQuery = (api, slug) =>
	`${api}/rest/v1/appointments?select=confirmation_token,businesses!inner(slug)&businesses.slug=eq.${slug}`;
