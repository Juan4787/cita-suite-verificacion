#!/usr/bin/env bash
set -euo pipefail
database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing archive concurrency outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac
slug='e2e-patient-archive-actor-race'
owner_id='a6500000-0000-4000-8000-000000000001'
actor_id='a6500000-0000-4000-8000-000000000002'
business_id='a6500000-0000-4000-8000-000000000003'
patient_id='a6500000-0000-4000-8000-000000000004'
professional_id='a6500000-0000-4000-8000-000000000005'
tmpdir=$(mktemp -d)
change_pid=''
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n "$change_pid" ]]; then kill "$change_pid" 2>/dev/null || true; wait "$change_pid" 2>/dev/null || true; fi
 if ! psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
delete from public.businesses where id='$business_id' and slug='$slug';
delete from public.account_assistance_support_users where user_id='$actor_id';
delete from auth.users where id in('$owner_id','$actor_id') and email like 'archive-race-%@example.test';
SQL
 then status=1; fi
 rm -r -- "$tmpdir"
 exit "$status"
}
trap cleanup EXIT
psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values
 ('$owner_id','archive-race-owner@example.test'),('$actor_id','archive-race-actor@example.test');
insert into public.businesses(id,name,slug,industry,timezone)
 values('$business_id','Synthetic archive concurrency','$slug','other','UTC');
insert into public.business_users(business_id,user_id,role,status,accepted_at) values
 ('$business_id','$owner_id','owner','active',now()),('$business_id','$actor_id','professional','active',now());
insert into public.professionals(id,business_id,name) values('$professional_id','$business_id','Synthetic archive professional');
insert into public.patients(id,business_id,owner_id,full_name)
 values('$patient_id','$business_id','$owner_id','Synthetic archive race patient');
insert into public.professional_patient_links(business_id,professional_id,patient_id)
 values('$business_id','$professional_id','$patient_id');
insert into public.account_assistance_support_users(user_id,email,enabled)
 values('$actor_id','archive-race-actor@example.test',true);
SQL

for scenario in role assignment link commercial admin_role assistance support; do
 psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='$business_id';
update public.business_users set role='professional',status='active',accepted_at=now(),disabled_at=null
 where business_id='$business_id' and user_id='$actor_id';
insert into public.professional_users(business_id,professional_id,user_id)
 values('$business_id','$professional_id','$actor_id') on conflict do nothing;
update public.professional_patient_links set is_active=true,archived_at=null,archived_by=null
 where business_id='$business_id' and professional_id='$professional_id' and patient_id='$patient_id';
update public.patients set archived_at=null where id='$patient_id' and business_id='$business_id';
update public.account_assistance_support_users set enabled=true where user_id='$actor_id';
delete from public.account_assistance_grants where business_id='$business_id' and support_user_id='$actor_id';
SQL
 case "$scenario" in
  role|admin_role)
   if [[ "$scenario" == admin_role ]]; then
    psql "$database_url" -X -v ON_ERROR_STOP=1 -q -c "update public.business_users set role='admin' where business_id='$business_id' and user_id='$actor_id';"
   fi
   mutation="select public.update_business_role_access((select id from public.business_users where business_id='$business_id' and user_id='$actor_id'),'readonly');"
   expected='PATIENT_ARCHIVE_DENIED' ;;
  assignment)
   mutation="delete from public.professional_users where business_id='$business_id' and user_id='$actor_id';"
   expected='PROFESSIONAL_LINK_REQUIRED' ;;
  link)
   mutation="update public.professional_patient_links set is_active=false where business_id='$business_id' and professional_id='$professional_id' and patient_id='$patient_id';"
   expected='PROFESSIONAL_PATIENT_LINK_REQUIRED' ;;
  commercial)
   mutation="update public.business_subscriptions set commercial_access_enabled=false where business_id='$business_id';"
   expected='BUSINESS_ACCESS_RESTRICTED' ;;
  assistance|support)
   psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
update public.business_users set role='readonly' where business_id='$business_id' and user_id='$actor_id';
insert into public.account_assistance_grants(business_id,requested_by_user_id,support_user_id,expires_at)
 values('$business_id','$owner_id','$actor_id',now()+interval '1 hour');
SQL
   if [[ "$scenario" == assistance ]]; then
    mutation="update public.account_assistance_grants set status='revoked',revoked_at=now() where business_id='$business_id' and support_user_id='$actor_id';"
   else
    mutation="update public.account_assistance_support_users set enabled=false where user_id='$actor_id';"
   fi
   expected='PATIENT_ARCHIVE_DENIED' ;;
 esac

 # A waits for evidence that B is blocked by its actual uncommitted mutation.
 # Only these two connections participate; there is no retry of the operation.
 psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/change.log" 2>&1 <<SQL &
set statement_timeout='15s';
begin;
select set_config('request.jwt.claim.sub','$owner_id',true);
$mutation
\echo ARCHIVE_AUTHORITY_CHANGED_UNCOMMITTED
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='cita-archive-race'
   and a.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'ARCHIVE_DID_NOT_WAIT_FOR_AUTHORITY_CHANGE';
end;
\$\$;
commit;
SQL
 change_pid=$!
 ready=false
 for attempt in {1..200}; do
  if grep -q '^ARCHIVE_AUTHORITY_CHANGED_UNCOMMITTED$' "$tmpdir/change.log"; then ready=true; break; fi
  if ! kill -0 "$change_pid" 2>/dev/null; then break; fi
  sleep 0.025
 done
 if [[ "$ready" != true ]]; then cat "$tmpdir/change.log" >&2; exit 1; fi
 set +e
 PGAPPNAME=cita-archive-race psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/archive.log" 2>&1 <<SQL
set statement_timeout='15s';
set role authenticated;
select set_config('request.jwt.claim.sub','$actor_id',false);
select public.set_patient_archive_state_safely('$business_id','$patient_id',true);
SQL
 archive_status=$?
 wait "$change_pid"
 change_status=$?
 change_pid=''
 set -e
 if [[ "$change_status" -ne 0 || "$archive_status" -eq 0 ]] || ! grep -q "$expected" "$tmpdir/archive.log"; then
  cat "$tmpdir/change.log" "$tmpdir/archive.log" >&2
  echo "Archive authority race failed: $scenario" >&2; exit 1
 fi
 result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "
 select p.archived_at is null and l.archived_at is null and l.archived_by is null
 from public.patients p join public.professional_patient_links l on l.patient_id=p.id and l.business_id=p.business_id
 where p.id='$patient_id' and p.business_id='$business_id' and l.professional_id='$professional_id';")
 if [[ "$result" != t ]]; then echo "Denied archive changed synthetic patient: $scenario" >&2; exit 1; fi
 echo "PASS: $scenario waited for the concurrent change, denied the stale actor and preserved global/personal archive."
done
