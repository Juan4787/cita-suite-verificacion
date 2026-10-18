#!/usr/bin/env bash
set -euo pipefail
verification_database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$verification_database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing configuration race outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac
fixture_slug='e2e-availability-configuration-locks'
fixture_owner='a6300000-0000-4000-8000-000000000001'
verification_tmp=$(mktemp -d)
writer_pid=''
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n "$writer_pid" ]]; then kill "$writer_pid" 2>/dev/null || true; wait "$writer_pid" 2>/dev/null || true; fi
 if ! psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
drop trigger if exists aaa_cita_configuration_test_gate on public.professionals;
drop function if exists private.cita_configuration_test_gate();
delete from public.businesses where slug='$fixture_slug';
delete from auth.users where id='$fixture_owner';
SQL
 then status=1; fi
 rm -r -- "$verification_tmp"
 exit "$status"
}
trap cleanup EXIT
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values('$fixture_owner','configuration-locks@example.test');
insert into public.businesses(name,slug,industry,timezone)
 values('Synthetic configuration locks','$fixture_slug','other','UTC');
insert into public.business_users(business_id,user_id,role,status,accepted_at)
 select id,'$fixture_owner','owner','active',now() from public.businesses where slug='$fixture_slug';
SQL
IFS='|' read -r fixture_business initial_revision < <(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "
select b.id,v.revision from public.businesses b join private.availability_configuration_versions v on v.business_id=b.id where b.slug='$fixture_slug';")
[[ "$fixture_business" =~ ^[a-f0-9-]{36}$ && "$initial_revision" =~ ^[0-9]+$ ]]

# AFTER-row gate is ordered after actual FK checks but before the revision
# trigger. B therefore holds the real parent KEY SHARE, not an imitation lock.
psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
create function private.cita_configuration_test_gate() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as \$\$
begin
 if new.business_id='$fixture_business'::uuid then perform pg_advisory_xact_lock_shared(76130419); end if;
 return new;
end \$\$;
create trigger aaa_cita_configuration_test_gate after insert on public.professionals
 for each row execute function private.cita_configuration_test_gate();
do \$\$
begin
 if exists(select 1 from pg_trigger where tgrelid='public.professionals'::regclass
  and tgname like 'RI_ConstraintTrigger_c_%'
  and not (tgname::text collate "C" < 'aaa_cita_configuration_test_gate'::text collate "C"))
  or not ('aaa_cita_configuration_test_gate'::text collate "C" < 'availability_configuration_changed'::text collate "C") then
  raise exception 'CONFIGURATION_RACE_GATE_ORDER_INVALID';
 end if;
end \$\$;
SQL

psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt >"$verification_tmp/writer.log" 2>&1 <<SQL &
\set VERBOSITY verbose
set statement_timeout='15s';
begin;
select pg_advisory_xact_lock(76130419);
\echo GATE_HELD
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='cita-configuration-second-insert'
   and a.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'SECOND_CONFIGURATION_INSERT_DID_NOT_REACH_GATE';
end \$\$;
insert into public.professionals(business_id,name) values('$fixture_business','Synthetic configuration first');
commit;
SQL
writer_pid=$!
ready=false
for attempt in {1..200}; do
 if grep -q '^GATE_HELD$' "$verification_tmp/writer.log"; then ready=true; break; fi
 if ! kill -0 "$writer_pid" 2>/dev/null; then break; fi
 sleep 0.025
done
if [[ "$ready" != true ]]; then cat "$verification_tmp/writer.log" >&2; exit 1; fi

set +e
PGAPPNAME=cita-configuration-second-insert psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAt >"$verification_tmp/second.log" 2>&1 <<SQL
\set VERBOSITY verbose
set statement_timeout='15s';
begin;
insert into public.professionals(business_id,name) values('$fixture_business','Synthetic configuration second');
commit;
SQL
second_status=$?
wait "$writer_pid"
writer_status=$?
set -e
writer_pid=''
if [[ "$second_status" != 0 || "$writer_status" != 0 ]]; then
 cat "$verification_tmp/writer.log" "$verification_tmp/second.log" >&2
 echo 'Configuration insert race failed; neither deadlock nor retry is accepted.' >&2
 exit 1
fi
IFS='|' read -r actual_count actual_revision < <(psql "$verification_database_url" -X -v ON_ERROR_STOP=1 -qAtc "
select (select count(*) from public.professionals where business_id='$fixture_business'),revision
 from private.availability_configuration_versions where business_id='$fixture_business';")
[[ "$actual_count" == 2 && "$actual_revision" == "$((initial_revision+2))" ]]
echo 'PASS: two real FK-backed professional inserts completed after observed blocking, preserved both rows and advanced configuration twice without deadlock or retry.'
