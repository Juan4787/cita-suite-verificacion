#!/usr/bin/env bash
set -euo pipefail
verification_database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$verification_database_url" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Refusing patient registration races outside disposable loopback PostgreSQL.' >&2; exit 2 ;; esac
fixture_owner='a6910000-0000-4000-8000-000000000001'
fixture_slug='e2e-patient-registration-races'
verification_tmp=$(mktemp -d)
writer_pid=''
cleanup(){
 local status=$?
 trap - EXIT
 if [[ -n "$writer_pid" ]]; then kill "$writer_pid" 2>/dev/null || true; wait "$writer_pid" 2>/dev/null || true; fi
 if ! psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
delete from public.businesses where slug='$fixture_slug';
delete from auth.users where id='$fixture_owner';
SQL
 then status=1; fi
 rm -r -- "$verification_tmp"
 exit "$status"
}
trap cleanup EXIT
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values('$fixture_owner','patient-registration-races@example.test');
insert into public.businesses(name,slug,industry,timezone) values('Synthetic patient registration races','$fixture_slug','other','UTC');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=(select id from public.businesses where slug='$fixture_slug');
insert into public.business_users(business_id,user_id,role,status,accepted_at) select id,'$fixture_owner','professional','active',now() from public.businesses where slug='$fixture_slug';
SQL
fixture_business=$(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "select id from public.businesses where slug='$fixture_slug'")
[[ "$fixture_business" =~ ^[a-f0-9-]{36}$ ]]
fixture_professional='a6910000-0000-4000-8000-000000000002'
fixture_patient='a6910000-0000-4000-8000-000000000003'
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into public.professionals(id,business_id,name) values('$fixture_professional','$fixture_business','Synthetic registration professional');
insert into public.professional_users(business_id,professional_id,user_id) values('$fixture_business','$fixture_professional','$fixture_owner');
SQL
# A changes the live authority. Observe B blocked on that row, then commit A.
# B must evaluate the changed role instead of relying on the route preflight.
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt >"$verification_tmp/role-writer.log" 2>&1 <<SQL &
set statement_timeout='20s';
begin;
update public.business_users set role='readonly' where business_id='$fixture_business' and user_id='$fixture_owner';
\echo ROLE_UNCOMMITTED
do \$\$ begin
 for attempt in 1..400 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='cita-patient-revoked-register' and wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'PATIENT_RACE_REVOKED_REGISTRATION_DID_NOT_BLOCK';
end \$\$;
commit;
SQL
writer_pid=$!
ready=false
for attempt in {1..400}; do
 if grep -q '^ROLE_UNCOMMITTED$' "$verification_tmp/role-writer.log"; then ready=true; break; fi
 if ! kill -0 "$writer_pid" 2>/dev/null; then break; fi
 sleep 0.025
done
if [[ "$ready" != true ]]; then cat "$verification_tmp/role-writer.log" >&2; exit 1; fi
PGAPPNAME=cita-patient-revoked-register psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set statement_timeout='20s';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$fixture_owner',true);
do \$\$ begin
 begin
  perform public.register_patient_safely('$fixture_business','$fixture_patient','Synthetic concurrent registration',null,null,null,null);
  raise exception 'PATIENT_RACE_REVOKED_REGISTRATION_WAS_ALLOWED';
 exception when raise_exception then
  if sqlerrm<>'PATIENT_CREATE_DENIED' then raise; end if;
 end;
end \$\$;
commit;
SQL
wait "$writer_pid" || { cat "$verification_tmp/role-writer.log" >&2; exit 1; }
writer_pid=''
[[ "$(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "select count(*) from public.patients where business_id='$fixture_business'")" == 0 ]]
echo 'PASS: registration observes a real pending membership revocation, then denies without patient or link.'
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
update public.business_users set role='professional' where business_id='$fixture_business' and user_id='$fixture_owner';
SQL
# A changes the live authority. Observe B blocked on that row, then commit A.
# B must evaluate the changed role instead of relying on the route preflight.
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt >"$verification_tmp/role-writer.log" 2>&1 <<SQL &
set statement_timeout='20s';
begin;
delete from public.professional_users where business_id='$fixture_business' and user_id='$fixture_owner';
\echo ROLE_UNCOMMITTED
do \$\$ begin
 for attempt in 1..400 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='cita-patient-unassigned-register' and wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'PATIENT_RACE_REVOKED_REGISTRATION_DID_NOT_BLOCK';
end \$\$;
commit;
SQL
writer_pid=$!
ready=false
for attempt in {1..400}; do
 if grep -q '^ROLE_UNCOMMITTED$' "$verification_tmp/role-writer.log"; then ready=true; break; fi
 if ! kill -0 "$writer_pid" 2>/dev/null; then break; fi
 sleep 0.025
done
if [[ "$ready" != true ]]; then cat "$verification_tmp/role-writer.log" >&2; exit 1; fi
PGAPPNAME=cita-patient-unassigned-register psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set statement_timeout='20s';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$fixture_owner',true);
do \$\$ begin
 begin
  perform public.register_patient_safely('$fixture_business','$fixture_patient','Synthetic concurrent registration',null,null,null,null);
  raise exception 'PATIENT_RACE_REVOKED_REGISTRATION_WAS_ALLOWED';
 exception when raise_exception then
  if sqlerrm<>'PROFESSIONAL_LINK_REQUIRED' then raise; end if;
 end;
end \$\$;
commit;
SQL
wait "$writer_pid" || { cat "$verification_tmp/role-writer.log" >&2; exit 1; }
writer_pid=''
[[ "$(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "select count(*) from public.patients where business_id='$fixture_business'")" == 0 ]]
echo 'PASS: registration observes a real pending professional assignment removal, then denies without patient or link.'
