#!/usr/bin/env bash
set -euo pipefail

database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing to test role concurrency outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac

slug='e2e-appointment-actor-concurrency'
owner_id='a5100000-0000-4000-8000-000000000001'
actor_id='a5100000-0000-4000-8000-000000000002'
tmpdir=$(mktemp -d)
role_pid=''
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n "$role_pid" ]]; then kill "$role_pid" 2>/dev/null || true; wait "$role_pid" 2>/dev/null || true; fi
 if ! psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
delete from public.businesses where slug='$slug';
delete from auth.users where id in('$owner_id','$actor_id');
SQL
 then status=1; fi
 rm -r -- "$tmpdir"
 exit "$status"
}
trap cleanup EXIT

psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values
 ('$owner_id','appointment-actor-race-owner@example.test'),
 ('$actor_id','appointment-actor-race-admin@example.test');
insert into public.businesses(name,slug,industry,timezone)
 values('Synthetic actor race','$slug','other','UTC');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null
 where business_id=(select id from public.businesses where slug='$slug');
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 select id,'$owner_id','owner','active',now() from public.businesses where slug='$slug';
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 select id,'$actor_id','admin','active',now() from public.businesses where slug='$slug';
insert into public.patients(business_id,owner_id,full_name)
 select id,'$owner_id','Synthetic actor race patient' from public.businesses where slug='$slug';
insert into public.services(business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes)
 select id,'Synthetic actor race service',30,0,0 from public.businesses where slug='$slug';
insert into public.professionals(business_id,name)
 select id,'Synthetic actor race professional' from public.businesses where slug='$slug';
insert into public.professional_services(business_id,professional_id,service_id)
 select b.id,p.id,s.id from public.businesses b
 join public.professionals p on p.business_id=b.id join public.services s on s.business_id=b.id where b.slug='$slug';
SQL

# Connection A changes the role, then waits until connection B actually waits
# on A's lock. No third monitoring connection and no timing-only assertion.
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/role.log" 2>&1 <<SQL &
set statement_timeout='15s';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$owner_id',true);
select public.update_business_role_access(
 (select id from public.business_users where business_id=(select id from public.businesses where slug='$slug') and user_id='$actor_id'),
 'readonly');
reset role;
\echo ROLE_CHANGED_UNCOMMITTED
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='cita-actor-race-create'
   and a.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then
   return;
  end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'CREATION_DID_NOT_WAIT_FOR_ROLE_CHANGE';
end;
\$\$;
commit;
SQL
role_pid=$!

ready=false
for attempt in {1..200}; do
 if grep -q '^ROLE_CHANGED_UNCOMMITTED$' "$tmpdir/role.log"; then ready=true; break; fi
 if ! kill -0 "$role_pid" 2>/dev/null; then break; fi
 sleep 0.025
done
if [[ "$ready" != true ]]; then cat "$tmpdir/role.log" >&2; exit 1; fi

set +e
PGAPPNAME=cita-actor-race-create psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/create.log" 2>&1 <<SQL
set statement_timeout='15s';
set role service_role;
select created.id from public.businesses b
 join public.patients p on p.business_id=b.id
 join public.services s on s.business_id=b.id
 join public.professionals pro on pro.business_id=b.id,
 lateral public.create_appointment_with_patient_identity(
  b.id,'existing',p.id,null,null,null,null,false,'$actor_id',s.id,array[pro.id],
  '2099-01-15 10:00:00+00'::timestamptz,null,'$actor_id',false,'manual','unknown',false,
  'a5200000-0000-4000-8000-000000000001',false
 ) created where b.slug='$slug';
SQL
create_status=$?
wait "$role_pid"
role_status=$?
role_pid=''
set -e

if [[ "$role_status" -ne 0 || "$create_status" -eq 0 ]] || ! grep -q 'APPOINTMENT_CREATOR_INVALID' "$tmpdir/create.log"; then
 cat "$tmpdir/role.log" "$tmpdir/create.log" >&2
 echo 'Expected committed role change and denied atomic creation after waiting for it.' >&2
 exit 1
fi

result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "
 select bu.role,(select count(*) from public.appointments a where a.business_id=b.id)
 from public.businesses b join public.business_users bu on bu.business_id=b.id
 where b.slug='$slug' and bu.user_id='$actor_id';")
if [[ "$result" != 'readonly|0' ]]; then echo "Unexpected final synthetic state: $result" >&2; exit 1; fi
echo 'PASS: atomic creation waited for the concurrent role change, denied the downgraded actor and wrote no appointment.'
