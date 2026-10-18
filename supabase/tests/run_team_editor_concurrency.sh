#!/usr/bin/env bash
set -euo pipefail
verification_database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$verification_database_url" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Refusing team races outside disposable loopback PostgreSQL.' >&2; exit 2 ;; esac
fixture_owner='a6900000-0000-4000-8000-000000000001'
fixture_slug='e2e-team-editor-races'
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
insert into auth.users(id,email) values('$fixture_owner','team-editor-races@example.test');
insert into public.businesses(name,slug,industry,timezone) values('Synthetic team races','$fixture_slug','other','UTC');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=(select id from public.businesses where slug='$fixture_slug');
insert into public.business_users(business_id,user_id,role,status,accepted_at) select id,'$fixture_owner','owner','active',now() from public.businesses where slug='$fixture_slug';
SQL
fixture_business=$(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "select id from public.businesses where slug='$fixture_slug'")
[[ "$fixture_business" =~ ^[a-f0-9-]{36}$ ]]
fixture_professional='a6900000-0000-4000-8000-000000000002'
fixture_patient='a6900000-0000-4000-8000-000000000003'
fixture_entry='a6900000-0000-4000-8000-000000000004'
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into public.professionals(id,business_id,name) values('$fixture_professional','$fixture_business','Synthetic concurrent author');
insert into public.patients(id,business_id,owner_id,full_name) values('$fixture_patient','$fixture_business','$fixture_owner','Synthetic team race patient');
SQL
# A inserts a real clinical author reference, holding the trigger's actual KEY
# SHARE. B must fail immediately, without cleanup or waiting for a lock upgrade.
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt >"$verification_tmp/clinical-writer.log" 2>&1 <<SQL &
set statement_timeout='20s';
begin;
insert into public.clinical_entries(id,business_id,patient_id,owner_id,created_by_user_id,created_by_professional_id,entry_type,description)
 values('$fixture_entry','$fixture_business','$fixture_patient','$fixture_owner','$fixture_owner','$fixture_professional','Consulta','Synthetic concurrent history');
\echo HISTORY_UNCOMMITTED
DO \$\$
begin
 for attempt in 1..400 loop
  if exists(select 1 from pg_locks where locktype='advisory' and classid=0 and objid=76130691 and granted and pid<>pg_backend_pid()) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'TEAM_RACE_DELETE_DID_NOT_SIGNAL';
end \$\$;
commit;
SQL
writer_pid=$!
ready=false
for attempt in {1..400}; do
 if grep -q '^HISTORY_UNCOMMITTED$' "$verification_tmp/clinical-writer.log"; then ready=true; break; fi
 if ! kill -0 "$writer_pid" 2>/dev/null; then break; fi
 sleep 0.025
done
if [[ "$ready" != true ]]; then cat "$verification_tmp/clinical-writer.log" >&2; exit 1; fi
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set statement_timeout='20s';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$fixture_owner',true);
do \$\$ begin
 begin
  perform public.delete_professional_safely('$fixture_business','$fixture_professional');
  raise exception 'TEAM_RACE_DELETE_WAS_NOT_REJECTED';
 exception when lock_not_available then null;
 end;
end \$\$;
select pg_advisory_xact_lock(76130691);
do \$\$ begin
 for attempt in 1..400 loop
  if exists(select 1 from public.clinical_entries where id='$fixture_entry') then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'TEAM_RACE_HISTORY_DID_NOT_COMMIT';
end \$\$;
do \$\$ begin
 begin
  perform public.delete_professional_safely('$fixture_business','$fixture_professional');
  raise exception 'TEAM_RACE_COMMITTED_HISTORY_WAS_NOT_PROTECTED';
 exception when raise_exception then
  if sqlerrm<>'TEAM_PROFESSIONAL_HAS_HISTORY' then raise; end if;
 end;
end \$\$;
commit;
SQL
wait "$writer_pid" || { cat "$verification_tmp/clinical-writer.log" >&2; exit 1; }
writer_pid=''
[[ "$(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "select (select count(*) from public.professionals where id='$fixture_professional')||'|'||(select count(*) from public.clinical_entries where id='$fixture_entry')")" == '1|1' ]]
echo 'PASS: an actual uncommitted clinical author reference prevents deletion immediately; committed history and professional survive without deadlock or partial cleanup.'

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
  if exists(select 1 from pg_stat_activity where application_name='cita-team-revoked-delete' and wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'TEAM_RACE_REVOKED_DELETE_DID_NOT_BLOCK';
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
PGAPPNAME=cita-team-revoked-delete psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set statement_timeout='20s';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','$fixture_owner',true);
do \$\$ begin
 begin
  perform public.delete_professional_safely('$fixture_business','$fixture_professional');
  raise exception 'TEAM_RACE_REVOKED_DELETE_WAS_ALLOWED';
 exception when raise_exception then
  if sqlerrm<>'TEAM_ACCESS_DENIED' then raise; end if;
 end;
end \$\$;
commit;
SQL
wait "$writer_pid" || { cat "$verification_tmp/role-writer.log" >&2; exit 1; }
writer_pid=''
[[ "$(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "select count(*) from public.professionals where id='$fixture_professional'")" == 1 ]]
echo 'PASS: after observed blocking, role revocation rejects team deletion and preserves all history.'
