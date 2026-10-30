#!/usr/bin/env bash
# Señas: the automatic cancellation against reception, a reschedule, child rows with real
# foreign keys and turning the policy off, with two real connections (campaign plan,
# sections 4.5, 4.6 and 5). Every writer of a deposit holds its appointment first; the job
# never waits. No scenario may deadlock.
set -Eeuo pipefail
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
drop schema if exists deposit_race cascade;
delete from public.businesses where id='$business_id' and slug='$slug';
delete from auth.users where id in('$owner_id','$reception_id') and email like 'deposit-race-%@example.test';
SQL
 then status=1; fi
 rm -r -- "$tmpdir"
 exit "$status"
}
trap cleanup EXIT
# The runner shows only the standard error of a failed script: say where it stopped and what each
# connection printed, including the holders whose own errors went to their logs.
on_error() {
 local status=$? line=$1 failed=$2
 echo "Deposit race failed at line $line with status $status: $failed" >&2
 for log in "$tmpdir"/*.log; do
  if [[ -f "$log" ]]; then echo "--- $(basename "$log")" >&2; cat "$log" >&2; fi
 done
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR
progress() { echo "Deposit race: $*" >&2; }

# The child table only carries a real composite foreign key to the appointment: inserting into
# it takes the same key-share lock as the deposit or the released slot, without the business
# rules of any other table.
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
create schema deposit_race;
create table deposit_race.child(business_id uuid not null, appointment_id uuid not null,
 foreign key (business_id, appointment_id) references public.appointments(business_id, id) on delete cascade);
SQL

deadlocks() { psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select deadlocks from pg_stat_database where datname=current_database();"; }
deadlocks_before=$(deadlocks)
now_expr="date_trunc('hour',now())+interval '100 days'"

# A fresh pending deposit on an appointment that starts at the simulated time plus the hours.
prepare() {
 local label=$1 hours=$2
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
# Already due at the simulated time: exactly what the job cancels if nobody intervenes.
make_due() {
 psql "$database_url" -X -v ON_ERROR_STOP=1 -q -c "update public.appointment_deposits set due_at=$now_expr-interval '1 hour',auto_cancel=true where appointment_id='$1';"
}
state_of() {
 psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select coalesce(d.status,'none')||'/'||a.status from public.appointments a left join public.appointment_deposits d on d.appointment_id=a.id where a.id='$1';"
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
disable_policy_sql() {
 cat <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub','$owner_id',false);
select set_config('request.jwt.claim.role','authenticated',false);
select public.save_deposit_policy('$business_id','{"enabled":false,"auto_cancel_enabled":false,"amount_mode":"fixed","fixed_amount":40000,"percentage":null,"request_days":7,"deadline_hours":48,"min_payment_hours":24,"transfer_details":"","applies_to_manual":true,"excluded_service_ids":[]}'::jsonb,
 (select revision from public.deposit_policies where business_id='$business_id'));
SQL
}
# Back on for the next scenario, as the practice would do from its settings.
enable_policy() {
 psql "$database_url" -X -v ON_ERROR_STOP=1 -q -c "update public.deposit_policies set enabled=true,auto_cancel_enabled=true,revision=revision+1,updated_at=now() where business_id='$business_id';"
}
child_insert_sql() { echo "insert into deposit_race.child(business_id,appointment_id) values('$business_id','$1');"; }
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
  # Back to the session's own role first: pg_stat_activity hides the waits of other roles'
  # sessions from an ordinary role such as authenticated, and the locks belong to the
  # transaction, not to the role, so nothing held is released.
  cat <<SQL
reset role;
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
# Waits until the other backend sits idle inside its open transaction: its statement ended
# but nothing it locked has been released. The other side renames itself only after its last
# statement, so the idle moments between its earlier statements never match.
wait_holding() {
 cat <<SQL
do \$\$
begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='$1' and a.state='idle in transaction') then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'DEPOSIT_RACE_OTHER_SIDE_NOT_HOLDING';
end;
\$\$;
SQL
}
# A short statement from a second connection that must neither wait nor fail while the holder
# is still open.
must_not_wait() {
 local description=$1 statement=$2
 if ! psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/second.log" 2>&1 <<SQL
set lock_timeout='1s';
set statement_timeout='5s';
$statement
SQL
 then cat "$tmpdir/holder.log" "$tmpdir/second.log" >&2; echo "$description waited or failed." >&2; exit 1; fi
 if ! kill -0 "$holder_pid" 2>/dev/null; then echo "$description: the holder committed first, no overlap." >&2; exit 1; fi
}

# 1. Reception records the deposit while the job runs: the job skips that turn without
# waiting, and the turn ends confirmed, never cancelled.
progress 'scenario 1'
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
result=$(state_of "$appointment")
if [[ "$job" != 0 || "$result" != paid/confirmed ]]; then cat "$tmpdir/holder.log" >&2; echo "Reception first failed: job=$job result=$result" >&2; exit 1; fi
echo 'PASS: the job skipped the turn reception held, without waiting; the turn ended confirmed.'

# 2. The job cancels first: reception waits for it and gets a closed turn, not a silent
# success over a cancelled appointment.
progress 'scenario 2'
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
# Expected to fail: captured with || so that neither errexit nor the error trap reacts.
reception_status=0
PGAPPNAME=cita-deposit-reception psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/reception.log" 2>&1 <<SQL || reception_status=$?
set statement_timeout='15s';
$(reception_sql "$appointment" paid)
SQL
holder_status=0
wait "$holder_pid" || holder_status=$?
holder_pid=''
result=$(state_of "$appointment")
if [[ "$holder_status" -ne 0 || "$reception_status" -eq 0 || "$result" != expired/cancelled ]] || ! grep -q DEPOSIT_APPOINTMENT_CLOSED "$tmpdir/reception.log"; then
 cat "$tmpdir/holder.log" "$tmpdir/reception.log" >&2; echo "Job first failed: result=$result" >&2; exit 1
fi
echo 'PASS: reception waited for the cancellation and got a closed turn.'

# 3. A reschedule in progress: the job skips the turn, and the deposit is recomputed for
# the new time instead of being cancelled for the old one.
progress 'scenario 3'
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

# 4. The job against a turn reception has already locked, with its deposit still free: the job
# skips the turn without taking the deposit, and reception locks the deposit while the job's
# transaction is still open, without waiting for it (plan, section 5).
progress 'scenario 4'
appointment=$(prepare reception_locked 55); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
select 'APPOINTMENT' from public.appointments where id='$appointment' for no key update;
\echo APPOINTMENT_LOCKED
$(wait_holding cita-deposit-job-done)
set local lock_timeout='1s';
select 'DEPOSIT' from public.appointment_deposits where appointment_id='$appointment' for update;
select case when exists(select 1 from pg_stat_activity where application_name='cita-deposit-job-done' and state='idle in transaction')
 then 'JOB_STILL_OPEN' else 'JOB_CLOSED' end;
$(reception_sql "$appointment" paid)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" APPOINTMENT_LOCKED
job=$(PGAPPNAME=cita-deposit-job-holder psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
begin;
set local statement_timeout='1s';
select private.expire_unpaid_deposits($now_expr,100);
set application_name='cita-deposit-job-done';
\! sleep 1.5
commit;
SQL
)
wait "$holder_pid"; holder_pid=''
result=$(state_of "$appointment")
if [[ "$job" != 0 || "$result" != paid/confirmed ]] || ! grep -q '^JOB_STILL_OPEN$' "$tmpdir/holder.log"; then
 cat "$tmpdir/holder.log" >&2; echo "Locked turn failed: job=$job result=$result" >&2; exit 1
fi
echo 'PASS: the job skipped a turn reception had locked and never took its deposit; reception did not wait.'

# 5. Child rows with real foreign keys against «Confirmar seña» and against the job, in both
# orders: the key-share lock of the child never waits for, nor blocks, the no-key-update lock.
progress 'scenario 5'
appointment=$(prepare child_vs_reception 57)
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(reception_sql "$appointment" paid)
\echo DEPOSIT_RECORDED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" DEPOSIT_RECORDED_UNCOMMITTED
must_not_wait 'A child insert during «Confirmar seña»' "$(child_insert_sql "$appointment")"
wait "$holder_pid"; holder_pid=''
[[ "$(state_of "$appointment")" == paid/confirmed ]] || { echo 'Child against reception: wrong final state.' >&2; exit 1; }

appointment=$(prepare reception_vs_child 59)
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(child_insert_sql "$appointment")
\echo CHILD_INSERTED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" CHILD_INSERTED_UNCOMMITTED
must_not_wait '«Confirmar seña» during a child insert' "$(reception_sql "$appointment" paid)"
wait "$holder_pid"; holder_pid=''
[[ "$(state_of "$appointment")" == paid/confirmed ]] || { echo 'Reception against child: wrong final state.' >&2; exit 1; }

appointment=$(prepare child_vs_job 61); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
select private.expire_unpaid_deposits($now_expr,100);
\echo JOB_CANCELLED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" JOB_CANCELLED_UNCOMMITTED
must_not_wait 'A child insert during the job' "$(child_insert_sql "$appointment")"
wait "$holder_pid"; holder_pid=''
[[ "$(state_of "$appointment")" == expired/cancelled ]] || { echo 'Child against job: wrong final state.' >&2; exit 1; }

appointment=$(prepare job_vs_child 63); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(child_insert_sql "$appointment")
\echo CHILD_INSERTED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" CHILD_INSERTED_UNCOMMITTED
must_not_wait 'The job during a child insert' "select private.expire_unpaid_deposits($now_expr,100);"
wait "$holder_pid"; holder_pid=''
if [[ "$(cat "$tmpdir/second.log")" != 1 || "$(state_of "$appointment")" != expired/cancelled ]]; then
 cat "$tmpdir/second.log" >&2; echo 'Job against child: the turn was not cancelled.' >&2; exit 1
fi
echo 'PASS: child rows with real foreign keys never waited for «Confirmar seña» or the job, nor made them wait.'

# 6. A reschedule against «Deshacer» (plan, section 5): never Confirmado with the deposit
# pending. Confirmado: the reschedule's own status condition no longer matches and it moves
# nothing. «Quiere reprogramar»: the condition still matches, and the database rule rejects
# the confirmation.
progress 'scenario 6'
appointment=$(prepare undo_vs_reschedule 65)
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >/dev/null <<SQL
$(reception_sql "$appointment" paid)
SQL
original=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select starts_at from public.appointments where id='$appointment';")
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(reception_sql "$appointment" pending)
\echo DEPOSIT_UNDONE_UNCOMMITTED
$(hold_open cita-deposit-reschedule true)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" DEPOSIT_UNDONE_UNCOMMITTED
moved=$(PGAPPNAME=cita-deposit-reschedule psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set statement_timeout='15s';
with moved as (
 update public.appointments set starts_at=$now_expr+interval '40 days',ends_at=$now_expr+interval '40 days 1 hour',
  blocking_starts_at=$now_expr+interval '40 days',blocking_ends_at=$now_expr+interval '40 days 1 hour',status='confirmed',reschedule_requested_at=null
 where business_id='$business_id' and id='$appointment' and status='confirmed' returning id
)
select count(*) from moved;
SQL
)
wait "$holder_pid"; holder_pid=''
result=$(state_of "$appointment")
now_starts=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select starts_at from public.appointments where id='$appointment';")
if [[ "$moved" != 0 || "$result" != pending/reserved || "$now_starts" != "$original" ]]; then
 cat "$tmpdir/holder.log" >&2; echo "Undo against a confirmed reschedule failed: moved=$moved result=$result" >&2; exit 1
fi

appointment=$(prepare undo_vs_requested 67)
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >/dev/null <<SQL
$(reception_sql "$appointment" paid)
reset role;
update public.appointments set status='reschedule_requested',reschedule_requested_at=now() where id='$appointment';
SQL
original=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select starts_at from public.appointments where id='$appointment';")
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(reception_sql "$appointment" pending)
\echo DEPOSIT_UNDONE_UNCOMMITTED
$(hold_open cita-deposit-reschedule true)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" DEPOSIT_UNDONE_UNCOMMITTED
reschedule_status=0
PGAPPNAME=cita-deposit-reschedule psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/second.log" 2>&1 <<SQL || reschedule_status=$?
set statement_timeout='15s';
update public.appointments set starts_at=$now_expr+interval '41 days',ends_at=$now_expr+interval '41 days 1 hour',
 blocking_starts_at=$now_expr+interval '41 days',blocking_ends_at=$now_expr+interval '41 days 1 hour',status='confirmed',
 confirmed_at=now(),reschedule_requested_at=null
where business_id='$business_id' and id='$appointment' and status='reschedule_requested';
SQL
holder_status=0
wait "$holder_pid" || holder_status=$?
holder_pid=''
result=$(state_of "$appointment")
now_starts=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select starts_at from public.appointments where id='$appointment';")
if [[ "$holder_status" -ne 0 || "$reschedule_status" -eq 0 || "$result" != pending/reschedule_requested || "$now_starts" != "$original" ]] \
 || ! grep -q APPOINTMENT_DEPOSIT_PENDING "$tmpdir/second.log"; then
 cat "$tmpdir/holder.log" "$tmpdir/second.log" >&2; echo "Undo against a requested reschedule failed: result=$result" >&2; exit 1
fi
echo 'PASS: a reschedule racing «Deshacer» never left a confirmed turn with a pending deposit.'

# 7. Turning the policy off while the job runs, in both orders. The policy first: the job skips
# every turn the policy locked, and they end waived, never cancelled. The job first: the policy
# waits for the turn the job holds and waives only what is still pending.
progress 'scenario 7'
appointment=$(prepare policy_holds 69); make_due "$appointment"
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
$(disable_policy_sql)
\echo POLICY_DISABLED_UNCOMMITTED
$(hold_open unused false)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" POLICY_DISABLED_UNCOMMITTED
must_not_wait 'The job while the policy is turned off' "select private.expire_unpaid_deposits($now_expr,100);"
wait "$holder_pid"; holder_pid=''
waived=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select status||'/'||coalesce(waived_reason,'') from public.appointment_deposits where appointment_id='$appointment';")
if [[ "$(cat "$tmpdir/second.log")" != 0 || "$waived" != waived/policy_disabled || "$(state_of "$appointment")" != waived/reserved ]]; then
 cat "$tmpdir/holder.log" "$tmpdir/second.log" >&2; echo "Policy before the job failed: $waived" >&2; exit 1
fi
enable_policy

appointment=$(prepare job_holds 71); make_due "$appointment"
other=$(prepare policy_waits_other 73)
psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/holder.log" 2>&1 <<SQL &
begin;
select private.expire_unpaid_deposits($now_expr,100);
\echo JOB_CANCELLED_UNCOMMITTED
$(hold_open cita-deposit-policy true)
commit;
SQL
holder_pid=$!
wait_for_marker "$tmpdir/holder.log" JOB_CANCELLED_UNCOMMITTED
PGAPPNAME=cita-deposit-policy psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt >"$tmpdir/policy.log" 2>&1 <<SQL
set statement_timeout='15s';
$(disable_policy_sql)
SQL
wait "$holder_pid"; holder_pid=''
if [[ "$(state_of "$appointment")" != expired/cancelled || "$(state_of "$other")" != waived/reserved ]]; then
 cat "$tmpdir/holder.log" "$tmpdir/policy.log" >&2; echo 'Job before the policy failed.' >&2; exit 1
fi
enable_policy
echo 'PASS: turning the policy off and the job never waited for each other in a cycle, and never both acted on one turn.'

# 8. Turning the policy off while reception records one deposit: the policy waits for the
# turn reception holds, then waives every other pending deposit. Both succeed.
progress 'scenario 8'
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
$(disable_policy_sql)
SQL
wait "$holder_pid"; holder_pid=''
result=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "select (select status from public.appointment_deposits where appointment_id='$appointment')||'/'||(select count(*) from public.appointment_deposits where business_id='$business_id' and status='pending')::text;")
if [[ "$result" != paid/0 ]]; then cat "$tmpdir/holder.log" "$tmpdir/policy.log" >&2; echo "Policy race failed: $result" >&2; exit 1; fi
echo 'PASS: turning the policy off waited for the turn reception held and waived the rest.'

deadlocks_after=$(deadlocks)
if [[ "$deadlocks_after" != "$deadlocks_before" ]]; then echo "Deadlocks observed: $deadlocks_before -> $deadlocks_after" >&2; exit 1; fi
echo "PASS: no deadlock in any deposit race ($deadlocks_after)."
