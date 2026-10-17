#!/usr/bin/env bash
set -euo pipefail
database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing quota races outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac
actor='6b000000-0000-4000-8000-000000000001'
other_actor='6b000000-0000-4000-8000-000000000006'
a='6b000000-0000-4000-8000-000000000002'
b='6b000000-0000-4000-8000-000000000003'
pa='6b000000-0000-4000-8000-000000000004'
pb='6b000000-0000-4000-8000-000000000005'
tmpdir=$(mktemp -d)
holder_pid=''
original_max=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc 'select max_bytes from public.clinical_storage_budget where singleton')
if [[ ! "$original_max" =~ ^[0-9]+$ ]]; then echo 'No trustworthy original budget.' >&2; exit 1; fi

clear_fixture() {
 psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
begin;
select private.clinical_budget_lock();
update public.clinical_storage_budget set max_bytes=$original_max where singleton;
update public.clinical_upload_slots set expires_at=clock_timestamp()-interval '1 second' where business_id in('$a','$b');
select private.release_expired_clinical_reservations();
delete from public.clinical_upload_slots where business_id in('$a','$b');
delete from public.patient_radiographs where business_id in('$a','$b');
delete from public.businesses where id in('$a','$b');
delete from auth.users where id in('$actor','$other_actor');
commit;
SQL
}
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n "$holder_pid" ]]; then kill "$holder_pid" 2>/dev/null || true; wait "$holder_pid" 2>/dev/null || true; fi
 if ! clear_fixture > /dev/null; then status=1; fi
 rm -r -- "$tmpdir"
 exit "$status"
}
trap cleanup EXIT

run_case() {
 local scope="$1" second_business="$b" second_patient="$pb" second_actor="$other_actor"
 clear_fixture > /dev/null
 psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values('$actor','clinical-budget-race@example.test'),('$other_actor','clinical-budget-race-other@example.test');
insert into public.businesses(id,name,slug,industry) values('$a','Synthetic budget race A','$a','other'),('$b','Synthetic budget race B','$b','other');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in('$a','$b');
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 values('$a','$actor','owner','active',now()),('$b','$other_actor','owner','active',now());
insert into public.patients(id,business_id,owner_id,full_name)
 values('$pa','$a','$actor','Synthetic budget A'),('$pb','$b','$other_actor','Synthetic budget B');
SQL
 if [[ "$scope" == 'global' ]]; then
  psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc 'update public.clinical_storage_budget set max_bytes=5000000 where singleton'
 else
  second_business="$a"; second_patient="$pa"; second_actor="$actor"
  psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "update public.clinical_business_storage_budget set max_bytes=5000000 where business_id='$a'"
 fi

 psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
set statement_timeout='15s';
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select radiograph_id from public.begin_patient_radiograph_upload('$actor','$a','$pa',gen_random_uuid(),'race-a.pdf','application/pdf',100,repeat('a',64));
reset role;
\echo BUDGET_RESERVED_UNCOMMITTED
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity s where s.application_name='cita-budget-race-second'
   and s.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(s.pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'SECOND_UPLOAD_DID_NOT_WAIT_FOR_BUDGET';
end;
\$\$;
commit;
SQL
 holder_pid=$!
 local ready=false
 for attempt in {1..200}; do
  if grep -q '^BUDGET_RESERVED_UNCOMMITTED$' "$tmpdir/holder.log"; then ready=true; break; fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then break; fi
  sleep 0.025
 done
 if [[ "$ready" != true ]]; then cat "$tmpdir/holder.log" >&2; return 1; fi
 set +e
 PGAPPNAME=cita-budget-race-second psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/second.log" 2>&1 <<SQL
set statement_timeout='15s';
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select radiograph_id from public.begin_patient_radiograph_upload('$second_actor','$second_business','$second_patient',gen_random_uuid(),'race-b.pdf','application/pdf',100,repeat('b',64));
commit;
SQL
 local second_status=$?
 wait "$holder_pid"
 local holder_status=$?
 holder_pid=''
 set -e
 if [[ "$holder_status" -ne 0 || "$second_status" -eq 0 ]] || ! grep -q 'CLINICAL_STORAGE_QUOTA' "$tmpdir/second.log"; then
  cat "$tmpdir/holder.log" "$tmpdir/second.log" >&2
  echo "Failed actual $scope quota serialization." >&2; return 1
 fi
 local result
 result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select
  (select reserved_bytes from public.clinical_storage_budget where singleton),
  (select sum(reserved_bytes) from public.clinical_business_storage_budget where business_id in('$a','$b')),
  (select count(*) from public.patient_radiographs where business_id in('$a','$b'))")
 if [[ "$result" != '5000000|5000000|1' ]]; then echo "Unexpected final $scope budget: $result" >&2; return 1; fi
 echo "PASS: $scope budget serialized real competing uploads, rejected the second and preserved exact ledgers."
}
run_case global
run_case clinic
