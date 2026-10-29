#!/usr/bin/env bash
# Señas: the automatic cancellation against reception, a reschedule and turning the policy
# off, with two real connections (campaign plan, sections 4.5 and 4.6). Every writer of a
# deposit holds its appointment first; the job never waits. No scenario may deadlock.
set -euo pipefail
database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing deposit concurrency outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac
slug='e2e-deposit-expiry-race'
business_id='d5000000-0000-4000-8000-000000000001'
owner_id='d5000000-0000-4000-8000-000000000002'
reception_id='d5000000-0000-4000-8000-000000000003'
professional_id='d5000000-0000-4000-8000-000000000004'
service_id='d5000000-0000-4000-8000-000000000005'
tmpdir=$(mktemp -d)
holder_pid=''
# psql prints a boolean as t or f: it is restored as a quoted literal, never as a bare word.
previous_switch=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select enabled from private.deposit_automation;")
case "$previous_switch" in t|f) ;; *) echo "Unexpected deposit automation switch: '$previous_switch'." >&2; exit 1 ;; esac
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n "$holder_pid" ]]; then kill "$holder_pid" 2>/dev/null || true; wait "$holder_pid" 2>/dev/null || true; fi
 if ! psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
update private.deposit_automation set enabled='$previous_switch'::boolean;
delete from public.businesses where id='$business_id' and slug='$slug';
delete from auth.users where id in('$owner_id','$reception_id') and email like 'deposit-race-%@example.test';
SQL
 then status=1; fi
 rm -r -- "$tmpdir"
 exit "$status"
}
trap cleanup EXIT

psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email) values('$owner_id','deposit-race-owner@example.test'),('$reception_id','deposit-race-reception@example.test');
insert into public.businesses(id,name,slug,industry,timezone) values('$business_id','Synthetic deposit race','$slug','other','America/Argentina/Cordoba');
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='$business_id';
insert into public.business_users(business_id,user_id,role,status,accepted_at) values
 ('$business_id','$owner_id','owner','active',now()),('$business_id','$reception_id','reception','active',now());
insert into public.professionals(id,business_id,name) values('$professional_id','$business_id','Synthetic deposit professional');
insert into public.services(id,business_id,name,duration_minutes) values('$service_id','$business_id','Synthetic consultation',60);
insert into public.professional_services(business_id,professional_id,service_id) values('$business_id','$professional_id','$service_id');
insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,request_days,deadline_hours,min_payment_hours,applies_to_manual)
 values('$business_id',true,true,'fixed',40000,7,48,24,true);
update private.deposit_automation set enabled=true;
SQL

deadlocks() { psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select deadlocks from pg_stat_database where datname=current_database();"; }
deadlocks_before=$(deadlocks)
now_expr="date_trunc('hour',now())+interval '100 days'"

# A fresh pending deposit, already due at the simulated time, on an appointment that
# starts after it: exactly what the job cancels if nobody intervenes.
prepare() {
 local label=$1 hours=$2 status=${3:-reserved}
 psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
with patient as (
 insert into public.patients(owner_id,business_id,full_name) values('$owner_id','$business_id','Synthetic deposit $label') returning id
), appointment as (
 insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 select '$business_id',patient.id,'$service_id','$professional_id',$now_expr+interval '$hours hours',$now_expr+interval '$hours hours'+interval '1 hour',
  $now_expr+interval '$hours hours',$now_expr+interval '$hours hours'+interval '1 hour','reserved','manual','Synthetic consultation','Synthetic deposit professional',60
 from patient returning id
)
select id from appointment;
SQL
}
make_due() {
 psql "$database_url" -X -v ON_ERROR_STOP=1 -q -c "update public.appointment_deposits set due_at=$now_expr-interval '1 hour',auto_cancel=true where appointment_id='$1';"
}
reception_sql() {
 local appointment=$1 action=$2
 cat <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub','$reception_id',false);
select set_config('request.jwt.claim.role','authenticated',false);
select status from public.set_appointment_deposit('$business_id','$appointment','$action',
 (select revision from public.appointment_deposits where appointment_id='$appointment'));
SQL
}
wait_for_marker() {
 local file=$1 marker=$2
 for attempt in {1..200}; do
  if grep -q "^$marker\$" "$file"; then return 0; fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then break; fi
  sleep 0.025
 done
 cat "$file" >&2; return 1
}
# The holder keeps its transaction open until another backend waits for one of its locks,
# or for a short fixed time when the other side must not wait at all.
hold_open() {
 local application=$1 must_block=$2
 if [[ "$must_block" == true ]]; then
  cat <<SQL
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='$application'
   and a.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'DEPOSIT_RACE_OTHER_SIDE_DID_NOT_WAIT';
end;
\$\$;
SQL
 else
  echo "select pg_sleep(1.5);"
 fi
}

# 1. Reception records the deposit while the job runs: the job skips that turn without
# waiting, and the turn ends confirmed, never cancelled.
appointment=$(prepare reception_first 47); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(reception_sql "$appointment" paid)
\echo DEPOSIT_RECORDED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" DEPOSIT_RECORDED_UNCOMMITTED
job=$(PGAPPNAME=cita-deposit-job psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "set statement_timeout='1s'; select private.expire_unpaid_deposits($now_expr,100);")
# The race only counts if reception's transaction was still open when the job finished.
if ! kill -0 "$holder_pid" 2>/dev/null; then echo 'Reception committed before the job ran: no overlap.' >&2; exit 1; fi
wait "$holder_pid"; holder_pid=''
result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select d.status||'/'||a.status from public.appointment_deposits d join public.appointments a on a.id=d.appointment_id where a.id='$appointment';")
if [[ "$job" != 0 || "$result" != paid/confirmed ]]; then cat "$tmpdir/holder.log" >&2; echo "Reception first failed: job=$job result=$result" >&2; exit 1; fi
echo 'PASS: the job skipped the turn reception held, without waiting; the turn ended confirmed.'

# 2. The job cancels first: reception waits for it and gets a closed turn, not a silent
# success over a cancelled appointment.
appointment=$(prepare job_first 49); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
select private.expire_unpaid_deposits($now_expr,100);
\echo JOB_CANCELLED_UNCOMMITTED
$(hold_open cita-deposit-reception true)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" JOB_CANCELLED_UNCOMMITTED
set +e
PGAPPNAME=cita-deposit-reception psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/reception.log" 2>&1 <<SQL
set statement_timeout='15s';
$(reception_sql "$appointment" paid)
SQL
reception_status=$?
wait "$holder_pid"; holder_status=$?; holder_pid=''
set -e
result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select d.status||'/'||a.status from public.appointment_deposits d join public.appointments a on a.id=d.appointment_id where a.id='$appointment';")
if [[ "$holder_status" -ne 0 || "$reception_status" -eq 0 || "$result" != expired/cancelled ]] || ! grep -q DEPOSIT_APPOINTMENT_CLOSED "$tmpdir/reception.log"; then
 cat "$tmpdir/holder.log" "$tmpdir/reception.log" >&2; echo "Job first failed: result=$result" >&2; exit 1
fi
echo 'PASS: reception waited for the cancellation and got a closed turn.'

# 3. A reschedule in progress: the job skips the turn, and the deposit is recomputed for
# the new time instead of being cancelled for the old one.
appointment=$(prepare moving 51); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
update public.appointments set starts_at=$now_expr+interval '30 days',ends_at=$now_expr+interval '30 days 1 hour',
 blocking_starts_at=$now_expr+interval '30 days',blocking_ends_at=$now_expr+interval '30 days 1 hour' where id='$appointment';
\echo RESCHEDULED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" RESCHEDULED_UNCOMMITTED
job=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "set statement_timeout='1s'; select private.expire_unpaid_deposits($now_expr,100);")
if ! kill -0 "$holder_pid" 2>/dev/null; then echo 'The reschedule committed before the job ran: no overlap.' >&2; exit 1; fi
wait "$holder_pid"; holder_pid=''
result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select d.status||'/'||a.status||'/'||(d.due_at=a.starts_at-make_interval(hours=>d.deadline_hours))::text from public.appointment_deposits d join public.appointments a on a.id=d.appointment_id where a.id='$appointment';")
if [[ "$job" != 0 || "$result" != pending/reserved/true ]]; then cat "$tmpdir/holder.log" >&2; echo "Reschedule failed: job=$job result=$result" >&2; exit 1; fi
echo 'PASS: the job skipped a turn being moved; its deposit follows the new time.'

# 4. Turning the policy off while reception records one deposit: the policy waits for the
# turn reception holds, then waives every other pending deposit. Both succeed.
appointment=$(prepare policy_race 53)
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(reception_sql "$appointment" paid)
\echo DEPOSIT_RECORDED_UNCOMMITTED
$(hold_open cita-deposit-policy true)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" DEPOSIT_RECORDED_UNCOMMITTED
PGAPPNAME=cita-deposit-policy psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/policy.log" 2>&1 <<SQL
set statement_timeout='15s';
set role authenticated;
select set_config('request.jwt.claim.sub','$owner_id',false);
select set_config('request.jwt.claim.role','authenticated',false);
select public.save_deposit_policy('$business_id','{"enabled":false,"auto_cancel_enabled":false,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":48,"min_payment_hours":24,"transfer_details":"","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb,
 (select revision from public.deposit_policies where business_id='$business_id'));
SQL
wait "$holder_pid"; holder_pid=''
result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select (select status from public.appointment_deposits where appointment_id='$appointment')||'/'||(select count(*) from public.appointment_deposits where business_id='$business_id' and status='pending')::text;")
if [[ "$result" != paid/0 ]]; then cat "$tmpdir/holder.log" "$tmpdir/policy.log" >&2; echo "Policy race failed: $result" >&2; exit 1; fi
echo 'PASS: turning the policy off waited for the turn reception held and waived the rest.'

deadlocks_after=$(deadlocks)
if [[ "$deadlocks_after" != "$deadlocks_before" ]]; then echo "Deadlocks observed: $deadlocks_before -> $deadlocks_after" >&2; exit 1; fi
echo "PASS: no deadlock in any deposit race ($deadlocks_after)."
