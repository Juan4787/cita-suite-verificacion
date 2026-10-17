#!/usr/bin/env bash
set -euo pipefail
database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing availability concurrency outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac
slug='e2e-availability-window-snapshot'
owner_id='a6100000-0000-4000-8000-000000000001'
tmpdir=$(mktemp -d)
writer_pid=''
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n "$writer_pid" ]]; then kill "$writer_pid" 2>/dev/null || true; wait "$writer_pid" 2>/dev/null || true; fi
 if ! psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
delete from public.businesses where slug='$slug';
delete from auth.users where id='$owner_id';
SQL
 then status=1; fi
 rm -r -- "$tmpdir"
 exit "$status"
}
trap cleanup EXIT
psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values('$owner_id','availability-snapshot-owner@example.test');
insert into public.businesses(name,slug,industry,timezone) values('Synthetic snapshot race','$slug','other','UTC');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null
 where business_id=(select id from public.businesses where slug='$slug');
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 select id,'$owner_id','owner','active',now() from public.businesses where slug='$slug';
insert into public.patients(business_id,owner_id,full_name)
 select id,'$owner_id','Synthetic snapshot patient' from public.businesses where slug='$slug';
insert into public.services(business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes)
 select id,'Synthetic snapshot service',30,15,10 from public.businesses where slug='$slug';
insert into public.professionals(business_id,name)
 select id,'Synthetic snapshot professional' from public.businesses where slug='$slug';
insert into public.professional_services(business_id,professional_id,service_id)
 select b.id,p.id,s.id from public.businesses b join public.professionals p on p.business_id=b.id
 join public.services s on s.business_id=b.id where b.slug='$slug';
insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
 select b.id,p.id,weekday,'09:00','19:00',30,15 from public.businesses b
 join public.professionals p on p.business_id=b.id cross join generate_series(0,6) weekday where b.slug='$slug';
SQL
IFS='|' read -r business_id professional_id service_id revision < <(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "
 select b.id,p.id,s.id,v.revision from public.businesses b join public.professionals p on p.business_id=b.id
 join public.services s on s.business_id=b.id join private.availability_configuration_versions v on v.business_id=b.id where b.slug='$slug';")
[[ "$business_id" =~ ^[a-f0-9-]{36}$ && "$professional_id" =~ ^[a-f0-9-]{36}$ && "$service_id" =~ ^[a-f0-9-]{36}$ && "$revision" =~ ^[0-9]+$ ]]

# A holds the gate until B demonstrably waits in a statement that already has
# its MVCC snapshot. A then commits both occupancy and a catalog change.
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/writer.log" 2>&1 <<SQL &
set statement_timeout='15s';
begin;
select pg_advisory_xact_lock(76130418);
\echo GATE_HELD
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='cita-availability-snapshot-read'
   and a.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'SNAPSHOT_READER_DID_NOT_WAIT';
end;
\$\$;
select set_config('request.jwt.claim.role','service_role',true);
select created.id from public.patients p,
 lateral public.create_appointment_with_patient_identity(
  '$business_id','existing',p.id,null,null,null,null,false,'$owner_id','$service_id',array['$professional_id'::uuid],
  '2099-01-15 10:00:00+00'::timestamptz,null,'$owner_id',false,'manual','unknown',false,
  'a6200000-0000-4000-8000-000000000001',false
 ) created where p.business_id='$business_id';
update public.professionals set name='Synthetic changed professional' where id='$professional_id';
commit;
SQL
writer_pid=$!
ready=false
for attempt in {1..200}; do
 if grep -q '^GATE_HELD$' "$tmpdir/writer.log"; then ready=true; break; fi
 if ! kill -0 "$writer_pid" 2>/dev/null; then break; fi
 sleep 0.025
done
if [[ "$ready" != true ]]; then cat "$tmpdir/writer.log" >&2; exit 1; fi

PGAPPNAME=cita-availability-snapshot-read psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/reader.log" 2>&1 <<SQL
set statement_timeout='15s';
set role service_role;
select set_config('request.jwt.claim.role','service_role',false);
with gate as materialized(select length(pg_advisory_xact_lock_shared(76130418)::text) as offset_days),
 snapshot as materialized(select public.get_availability_window('$business_id',false,null,
  array['$professional_id'::uuid],'2099-01-15'::date+gate.offset_days,'2099-01-15'::date+gate.offset_days,$revision) as body from gate)
select jsonb_array_length(body->'blocks'),body->>'configuration_revision' from snapshot;
SQL
wait "$writer_pid"
writer_pid=''
if ! grep -qFx "0|$revision" "$tmpdir/reader.log"; then
 cat "$tmpdir/writer.log" "$tmpdir/reader.log" >&2
 echo 'Reader mixed a new occupancy/configuration with its old statement snapshot.' >&2; exit 1
fi
result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
select set_config('request.jwt.claim.role','service_role',false);
select jsonb_array_length(body->'blocks'),(body->>'configuration_revision')::bigint>$revision from
 (select public.get_availability_window('$business_id',false,null,array['$professional_id'::uuid],
  '2099-01-15','2099-01-15',(select revision from private.availability_configuration_versions where business_id='$business_id')) as body) snapshot;
SQL
)
if ! grep -qFx '1|t' <<<"$result"; then echo 'Next statement did not observe the committed new state.' >&2; exit 1; fi
echo 'PASS: real two-connection blocking preserved one old SQL snapshot; the next statement observed new configuration and occupancy.'
