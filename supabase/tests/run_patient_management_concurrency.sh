#!/usr/bin/env bash
# Two controlled connections; remote owned disposable PostgreSQL only.
set -Eeuo pipefail
database_url="${SUPABASE_TEST_DB_URL:?An explicit disposable PostgreSQL URL is required.}"
case "$database_url" in
 postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
 *) echo 'Refusing patient management races outside disposable loopback PostgreSQL.' >&2; exit 2 ;;
esac
business_id='e3100000-0000-4000-8000-000000000001'
owner_id='e3100000-0000-4000-8000-000000000002'
professional_id='e3100000-0000-4000-8000-000000000003'
service_id='e3100000-0000-4000-8000-000000000004'
slug='e2e-patient-management-race'
task_directory=$(mktemp -d)
holder_pid=''
# Direct client processes keep background $! equal to the actual client PID.
# A function wrapper inherits ERR inside redirected descriptors and can attempt
# to append a diagnostic log to itself; preserve the original caller's stderr.
export PGOPTIONS='-c lock_timeout=7000 -c statement_timeout=12000'
psql_command=(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt)
previous_uploads=$("${psql_command[@]}" -c 'select uploads_enabled from public.clinical_storage_budget where singleton;')
previous_deposit=$("${psql_command[@]}" -c 'select enabled from private.deposit_automation where singleton;')
previous_runtime=$("${psql_command[@]}" -c "select reschedule_enabled||'|'||email_producer_enabled from private.appointment_management_runtime where singleton;")
[[ "$previous_deposit" =~ ^[tf]$ && "$previous_runtime" =~ ^(true|false)\|(true|false)$ ]]
cleanup() {
 local status=$?
 trap - EXIT
 echo "Patient management cleanup begins, status $status." >&2
 if [[ -n "$holder_pid" ]]; then kill "$holder_pid" 2>/dev/null || true; wait "$holder_pid" 2>/dev/null || true; fi
 if ! "${psql_command[@]}" <<SQL
begin;
select private.clinical_budget_lock();
update public.clinical_storage_budget set uploads_enabled='$previous_uploads'::boolean where singleton;
update private.deposit_automation set enabled='$previous_deposit'::boolean;
update private.appointment_management_runtime set reschedule_enabled='${previous_runtime%|*}'::boolean,email_producer_enabled='${previous_runtime#*|}'::boolean;
drop schema if exists patient_management_race cascade;
update public.clinical_upload_slots s set expires_at=clock_timestamp()-interval '1 second'
 from public.businesses b where s.business_id=b.id and b.id='$business_id' and b.slug='$slug';
select private.release_expired_clinical_reservations();
delete from public.clinical_upload_slots s using public.businesses b where s.business_id=b.id and b.id='$business_id' and b.slug='$slug';
delete from public.patient_radiographs f using public.businesses b where f.business_id=b.id and b.id='$business_id' and b.slug='$slug';
delete from public.push_delivery_attempts d using public.businesses b where d.business_id=b.id and b.id='$business_id' and b.slug='$slug';
delete from public.push_subscriptions s using public.businesses b where s.business_id=b.id and b.id='$business_id' and b.slug='$slug';
delete from public.push_devices d where d.endpoint like 'https://fcm.googleapis.com/management-race/$business_id/%'
 and not exists(select 1 from public.push_subscriptions s where s.device_id=d.id);
delete from public.appointments a using public.businesses b where a.business_id=b.id and b.id='$business_id' and b.slug='$slug';
delete from public.google_calendar_connections c where c.oauth_client_key=repeat('c',64)
 and c.google_subject like 'calendar-race/$business_id/%'
 and not exists(select 1 from public.appointment_google_calendar_events e where e.connection_id=c.id);
delete from public.businesses where id='$business_id' and slug='$slug';
delete from auth.users where id='$owner_id' and email='patient-management-race@example.test';
commit;
SQL
 then status=1; fi
 rm -r -- "$task_directory"
 echo "Patient management cleanup finished, status $status." >&2
 exit "$status"
}
trap cleanup EXIT
on_error() {
 local status=$? line=$1
 echo "Patient management race failed at line $line, status $status." >&2
 for log in "$task_directory"/*.log; do [[ ! -f "$log" ]] || cat "$log" >&2; done
}
trap 'on_error $LINENO' ERR
"${psql_command[@]}" <<SQL
create schema patient_management_race;
create table patient_management_race.requests(label text primary key,appointment_id uuid,token text,operation_id uuid,
 revision text,target timestamptz,availability_revision bigint,terms jsonb,deposit_revision bigint);
create table patient_management_race.signals(label text primary key);
insert into auth.users(id,email) values('$owner_id','patient-management-race@example.test');
insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
 values('$business_id','Synthetic management race','$slug','other','UTC',true,365);
update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
 paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='$business_id';
insert into public.business_users(business_id,user_id,role,status,accepted_at) values('$business_id','$owner_id','owner','active',now());
insert into public.professionals(id,business_id,name,is_public) values('$professional_id','$business_id','Synthetic management professional',true);
insert into public.services(id,business_id,name,duration_minutes,is_public) values('$service_id','$business_id','Synthetic management service',60,true);
insert into public.professional_services(business_id,professional_id,service_id) values('$business_id','$professional_id','$service_id');
insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details)
 values('$business_id',true,true,'fixed',40000,'Synthetic transfer');
update private.deposit_automation set enabled=true;
update private.appointment_management_runtime set reschedule_enabled=true,email_producer_enabled=true;
select public.operator_set_business_email_sender('$business_id','management-race.cita-suite.com.ar','verified');
SQL
"${psql_command[@]}" <<'SQL'
create function patient_management_race.prepare(p_label text,p_due boolean default false,p_target timestamptz default null) returns void language plpgsql as $$
declare a uuid; patient uuid; starts timestamptz; b uuid:='e3100000-0000-4000-8000-000000000001'; begin
 starts:=date_trunc('hour',now())+make_interval(days=>20+(select count(*)::integer from patient_management_race.requests));
 insert into public.patients(owner_id,business_id,full_name) values('e3100000-0000-4000-8000-000000000002',b,'Synthetic management '||p_label) returning id into patient;
 insert into public.appointments(business_id,patient_id,professional_id,service_id,starts_at,ends_at,status,source,
 service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(b,patient,'e3100000-0000-4000-8000-000000000003','e3100000-0000-4000-8000-000000000004',starts,starts+interval '1 hour',
 'reserved','manual','Synthetic service','Synthetic professional',60) returning id into a;
 update public.appointment_management_states set terms_acknowledged=true,require_deposit_on_reschedule=true,
  previous_deposit_disposition='forfeit',accepted_at=now(),accepted_policy_revision=1 where appointment_id=a;
 if p_due then update public.appointment_deposits set due_at=clock_timestamp()-interval '1 hour',auto_cancel=true,revision=revision+1 where appointment_id=a; end if;
 insert into patient_management_race.requests
 select p_label,a,public.issue_appointment_management_capability(b,a,1),gen_random_uuid(),private.appointment_semantic_revision(b,a),
  coalesce(p_target,starts+interval '6 hours'),(select booking_availability_revision from public.businesses where id=b),
  private.appointment_reschedule_financial_terms(b,a,coalesce(p_target,starts+interval '6 hours'),clock_timestamp()),
  (select revision from public.appointment_deposits where appointment_id=a);
end $$;
create function patient_management_race.act(p_label text,p_action text default 'reschedule',p_new_operation boolean default false) returns jsonb language plpgsql as $$
declare r patient_management_race.requests; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 return public.apply_patient_appointment_management(r.token,false,case when p_new_operation then gen_random_uuid() else r.operation_id end,
  r.revision,p_action,case when p_action='reschedule' then r.target end,
  case when p_action='reschedule' then r.availability_revision end,case when p_action='reschedule' then r.terms end);
end $$;
create function patient_management_race.pay(p_label text) returns void language plpgsql as $$
declare r patient_management_race.requests; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 perform set_config('request.jwt.claim.sub','e3100000-0000-4000-8000-000000000002',true);
 perform public.set_appointment_deposit('e3100000-0000-4000-8000-000000000001',r.appointment_id,'paid',r.deposit_revision,null);
 perform set_config('request.jwt.claim.sub','',true);
end $$;
create function patient_management_race.staff_act(p_label text,p_action text default 'reschedule',p_new_operation boolean default false,
 p_replay_only boolean default false) returns jsonb language plpgsql as $$
declare r patient_management_race.requests; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 return public.apply_staff_appointment_management('e3100000-0000-4000-8000-000000000001','e3100000-0000-4000-8000-000000000002',
  r.appointment_id,case when p_new_operation then gen_random_uuid() else r.operation_id end,r.revision,p_action,
  case when p_action='reschedule' then r.target end,false,case when p_action='reschedule' then r.availability_revision end,null,p_replay_only);
end $$;
create function patient_management_race.assert_state(p_label text,p_status text,p_deposit text,p_moved boolean,p_moves integer) returns void language plpgsql as $$
declare r patient_management_race.requests; a public.appointments; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 select * into strict a from public.appointments where id=r.appointment_id;
 if a.status is distinct from p_status or (select status from public.appointment_deposits where appointment_id=a.id) is distinct from p_deposit
  or (a.starts_at=r.target) is distinct from p_moved
  or (select count(*) from private.appointment_email_events where appointment_id=a.id and purpose='reschedule_receipt')<>p_moves
 then raise exception 'PATIENT_RACE_PARTIAL_STATE_%',p_label; end if;
end $$;
SQL
deadlocks_before=$("${psql_command[@]}" -c 'select deadlocks from pg_stat_database where datname=current_database();')
wait_marker() {
 for attempt in {1..240}; do
  if rg_marker=$(sed -n '/^PATIENT_HOLDER_READY$/p' "$task_directory/holder.log"); [[ -n "$rg_marker" ]]; then return; fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then break; fi
  sleep 0.025
 done
 cat "$task_directory/holder.log" >&2; return 1
}
hold_until_waiter() {
 cat <<SQL
do \$\$ begin
 for attempt in 1..240 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity a where a.application_name='patient-management-other' and a.wait_event_type='Lock'
   and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'PATIENT_RACE_OTHER_SIDE_DID_NOT_WAIT';
end \$\$;
SQL
}
race() {
 local name=$1 first=$2 second=$3 expected_error=${4:-} after_wait=${5:-}
 echo "Patient management race: $name" >&2
 : >"$task_directory/holder.log"
 : >"$task_directory/other.log"
 "${psql_command[@]}" >"$task_directory/holder.log" 2>&1 <<SQL &
set statement_timeout='12s';
begin;
$first
\echo PATIENT_HOLDER_READY
$(hold_until_waiter)
$after_wait
commit;
SQL
 holder_pid=$!
 wait_marker
 local status=0
 PGAPPNAME=patient-management-other "${psql_command[@]}" >"$task_directory/other.log" 2>&1 <<SQL || status=$?
set statement_timeout='12s';
$second
SQL
 wait "$holder_pid"; holder_pid=''
 if [[ -n "$expected_error" ]]; then
  if [[ "$status" == 0 ]] || ! grep -Fq "$expected_error" "$task_directory/other.log"; then cat "$task_directory/other.log" >&2; return 1; fi
 elif [[ "$status" != 0 ]]; then cat "$task_directory/other.log" >&2; return 1;
 fi
 echo "PASS: $name (overlap verified by PostgreSQL lock wait)."
}

"${psql_command[@]}" -c "select patient_management_race.prepare('duplicate');"
race duplicate "select patient_management_race.act('duplicate');" "select patient_management_race.act('duplicate');"
"${psql_command[@]}" -c "select patient_management_race.assert_state('duplicate','reserved','pending',true,1);"

"${psql_command[@]}" -c "select patient_management_race.prepare('move_cancel');"
race move_before_cancel "select patient_management_race.act('move_cancel');" "select patient_management_race.act('move_cancel','cancel',true);" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('move_cancel','reserved','pending',true,1);"
"${psql_command[@]}" -c "select patient_management_race.prepare('cancel_move');"
race cancel_before_move "select patient_management_race.act('cancel_move','cancel');" "select patient_management_race.act('cancel_move','reschedule',true);" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('cancel_move','cancelled','pending',false,0);"

"${psql_command[@]}" -c "select patient_management_race.prepare('pay_move');"
race pay_before_move "select patient_management_race.pay('pay_move');" "select patient_management_race.act('pay_move');" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('pay_move','confirmed','paid',false,0);"
"${psql_command[@]}" -c "select patient_management_race.prepare('move_pay');"
race move_before_stale_pay "select patient_management_race.act('move_pay');" "select patient_management_race.pay('move_pay');" DEPOSIT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('move_pay','reserved','pending',true,1);"

"${psql_command[@]}" -c "select patient_management_race.prepare('expiry_move',true);"
race expiry_before_move "select private.expire_unpaid_deposits(clock_timestamp(),100);" "select patient_management_race.act('expiry_move');" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('expiry_move','cancelled','expired',false,0);"

"${psql_command[@]}" -c "select patient_management_race.prepare('config_move');"
race configuration_before_move "update public.services set duration_minutes=90 where id='$service_id';" "select patient_management_race.act('config_move');" APPOINTMENT_AVAILABILITY_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('config_move','reserved','pending',false,0);"
"${psql_command[@]}" -c "update public.services set duration_minutes=60 where id='$service_id'; select patient_management_race.prepare('move_config');"
race move_before_configuration "select patient_management_race.act('move_config');" "update public.services set duration_minutes=90 where id='$service_id';"
"${psql_command[@]}" -c "select patient_management_race.assert_state('move_config','reserved','pending',true,1); update public.services set duration_minutes=60 where id='$service_id';"

"${psql_command[@]}" -c "select patient_management_race.prepare('slot_a',false,date_trunc('hour',now())+interval '120 days'); select patient_management_race.prepare('slot_b',false,date_trunc('hour',now())+interval '120 days');"
race overlapping_target "select patient_management_race.act('slot_a');" "select patient_management_race.act('slot_b');" 'exclusion constraint'
"${psql_command[@]}" -c "select patient_management_race.assert_state('slot_a','reserved','pending',true,1); select patient_management_race.assert_state('slot_b','reserved','pending',false,0);"

# A switch change still serializes, independently from heartbeat-only writes.
"${psql_command[@]}" -c "select patient_management_race.prepare('pause_move');"
race financial_pause_before_move "update private.deposit_automation set enabled=false;" "select patient_management_race.act('pause_move');" APPOINTMENT_RESCHEDULE_UNAVAILABLE
"${psql_command[@]}" -c "select patient_management_race.assert_state('pause_move','reserved','pending',false,0); update private.deposit_automation set enabled=true; select patient_management_race.prepare('move_pause');"
race move_before_financial_pause "select patient_management_race.act('move_pause');" "update private.deposit_automation set enabled=false;"
"${psql_command[@]}" -c "select patient_management_race.assert_state('move_pause','reserved','pending',true,1); update private.deposit_automation set enabled=true;"

# Inverse expiry order: the worker must SKIP the held appointment instead of
# waiting. A separate signal after the worker exits proves overlap without a
# timing-only sleep or a permanently open third connection.
echo 'Patient management inverse expiry: prepare.' >&2
"${psql_command[@]}" -c "select patient_management_race.prepare('move_expiry',true);"
echo 'Patient management inverse expiry: start holder.' >&2
"${psql_command[@]}" >"$task_directory/holder.log" 2>&1 <<'SQL' &
set statement_timeout='12s';
begin;
select patient_management_race.act('move_expiry');
\echo PATIENT_HOLDER_READY
do $$ begin
 for attempt in 1..240 loop
  if exists(select 1 from patient_management_race.signals where label='expiry_finished') then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'PATIENT_RACE_EXPIRY_DID_NOT_FINISH';
end $$;
commit;
SQL
holder_pid=$!
echo 'Patient management inverse expiry: await holder marker.' >&2
wait_marker
echo 'Patient management inverse expiry: worker begins while holder is open.' >&2
"${psql_command[@]}" >"$task_directory/other.log" 2>&1 <<'SQL'
set statement_timeout='1s';
select private.expire_unpaid_deposits(clock_timestamp(),100);
SQL
echo 'Patient management inverse expiry: worker returned.' >&2
kill -0 "$holder_pid"
"${psql_command[@]}" -c "insert into patient_management_race.signals values('expiry_finished');"
echo 'Patient management inverse expiry: signal committed; await holder.' >&2
wait "$holder_pid"; holder_pid=''
echo 'Patient management inverse expiry: holder returned; assert state.' >&2
"${psql_command[@]}" -c "select patient_management_race.assert_state('move_expiry','reserved','pending',true,1);"
echo 'PASS: expiry skips the appointment held by a completed uncommitted patient move.'

# The competing configuration commits only AFTER the command is observed
# waiting on its actual row lock and its commercial expiry has passed.
# This is a real overlap, not a sleep used to guess which command ran first.
"${psql_command[@]}" -c "select patient_management_race.prepare('access_clock');"
race access_expires_while_waiting \
 "update public.business_subscriptions set is_permanent=false,paid_until=clock_timestamp()+interval '1 second',grace_until=null where business_id='$business_id';" \
 "select patient_management_race.act('access_clock');" \
 APPOINTMENT_RESCHEDULE_UNAVAILABLE \
 "select pg_sleep(greatest(extract(epoch from ((select paid_until from public.business_subscriptions where business_id='$business_id')-clock_timestamp())),0)+0.025);"
"${psql_command[@]}" -c "select patient_management_race.assert_state('access_clock','reserved','pending',false,0); update public.business_subscriptions set is_permanent=true,paid_until=null where business_id='$business_id';"

# The same controlled fixture/locks now exercise the distinct operator command.
# A committed receipt is recovered before mutable preflight; a different request
# must keep its observed revision even if both moves would retain Reserved.
"${psql_command[@]}" -c "select patient_management_race.prepare('staff_duplicate');"
race staff_receipt_after_inflight_move "select patient_management_race.staff_act('staff_duplicate');" "select patient_management_race.staff_act('staff_duplicate','reschedule',false,true);"
"${psql_command[@]}" -c "select patient_management_race.assert_state('staff_duplicate','reserved','pending',true,1); do \$\$ begin if (select count(*) from private.appointment_management_operations where appointment_id=(select appointment_id from patient_management_race.requests where label='staff_duplicate'))<>1 then raise exception 'STAFF_DUPLICATE_RECEIPT'; end if; end \$\$;"

"${psql_command[@]}" -c "select patient_management_race.prepare('staff_stale');"
race staff_move_before_other_staff_move "select patient_management_race.staff_act('staff_stale');" "select patient_management_race.staff_act('staff_stale','reschedule',true);" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('staff_stale','reserved','pending',true,1);"

"${psql_command[@]}" -c "select patient_management_race.prepare('pay_staff');"
race payment_before_staff_move "select patient_management_race.pay('pay_staff');" "select patient_management_race.staff_act('pay_staff');" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('pay_staff','confirmed','paid',false,0);"
"${psql_command[@]}" -c "select patient_management_race.prepare('staff_pay');"
race staff_move_before_stale_payment "select patient_management_race.staff_act('staff_pay');" "select patient_management_race.pay('staff_pay');" DEPOSIT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('staff_pay','reserved','pending',true,1);"

"${psql_command[@]}" -c "select patient_management_race.prepare('staff_patient');"
race staff_move_before_patient_cancel "select patient_management_race.staff_act('staff_patient');" "select patient_management_race.act('staff_patient','cancel',true);" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('staff_patient','reserved','pending',true,1);"
"${psql_command[@]}" -c "select patient_management_race.prepare('patient_staff');"
race patient_cancel_before_staff_move "select patient_management_race.act('patient_staff','cancel');" "select patient_management_race.staff_act('patient_staff','reschedule',true);" APPOINTMENT_MANAGEMENT_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('patient_staff','cancelled','pending',false,0);"

"${psql_command[@]}" -c "select patient_management_race.prepare('config_staff');"
race configuration_before_staff_move "update public.services set duration_minutes=90 where id='$service_id';" "select patient_management_race.staff_act('config_staff');" APPOINTMENT_AVAILABILITY_CHANGED
"${psql_command[@]}" -c "select patient_management_race.assert_state('config_staff','reserved','pending',false,0); update public.services set duration_minutes=60 where id='$service_id'; select patient_management_race.prepare('staff_config');"
race staff_move_before_configuration "select patient_management_race.staff_act('staff_config');" "update public.services set duration_minutes=90 where id='$service_id';"
"${psql_command[@]}" -c "select patient_management_race.assert_state('staff_config','reserved','pending',true,1); update public.services set duration_minutes=60 where id='$service_id';"
# Contact edits hold only the patient. Observe the command waiting at its
# existing activity write AFTER the parent was taken, then commit the edit.
# A final authority check must roll back every local command effect.
"${psql_command[@]}" <<'SQL'
create table patient_management_race.contact_snapshots(label text primary key,value jsonb not null);
create function patient_management_race.domain_state(p_label text) returns jsonb language sql as $$
 select jsonb_build_object('appointment',to_jsonb(a),
  'management',(select to_jsonb(m) from public.appointment_management_states m where m.appointment_id=a.id),
  'deposit',(select to_jsonb(d) from public.appointment_deposits d where d.appointment_id=a.id),
  'requirements',(select jsonb_agg(to_jsonb(r) order by r.ordinal) from public.appointment_deposit_requirements r where r.appointment_id=a.id),
  'money_events',(select jsonb_agg(to_jsonb(e) order by e.ordinal) from public.appointment_deposit_events e where e.appointment_id=a.id),
  'releases',(select count(*) from public.appointment_slot_releases where appointment_id=a.id),
  'audit',(select count(*) from public.audit_logs where entity_id=a.id),
  'email_events',(select count(*) from private.appointment_email_events where appointment_id=a.id),
  'receipts',(select count(*) from private.appointment_management_operations where appointment_id=a.id))
 from public.appointments a join patient_management_race.requests q on q.appointment_id=a.id where q.label=p_label
$$;
create function patient_management_race.assert_corrected_contact(p_label text) returns void language plpgsql as $$
declare r patient_management_race.requests; patient public.patients; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 select p.* into strict patient from public.patients p join public.appointments a on a.patient_id=p.id where a.id=r.appointment_id;
 if patient.email is distinct from 'race-corrected@example.test' or patient.email_contact_revision<>2
  or (select count(*) from private.patient_email_contact_events where patient_id=patient.id and contact_revision=2)<>1
  or private.appointment_management_access_at(r.token,false,clock_timestamp()) is not null then
  raise exception 'CONTACT_RACE_PARTIAL_REVOCATION_%',p_label; end if;
end $$;
SQL
for contact_action in cancel reschedule; do
 contact_label="contact_before_$contact_action"
 "${psql_command[@]}" -c "select patient_management_race.prepare('$contact_label'); insert into patient_management_race.contact_snapshots select '$contact_label',patient_management_race.domain_state('$contact_label');"
 race "email_correction_before_patient_$contact_action" \
  "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='$contact_label');" \
  "select patient_management_race.act('$contact_label','$contact_action');" APPOINTMENT_LINK_UNAVAILABLE
 "${psql_command[@]}" -c "select patient_management_race.assert_corrected_contact('$contact_label'); do \$\$ begin if patient_management_race.domain_state('$contact_label') is distinct from (select value from patient_management_race.contact_snapshots where label='$contact_label') then raise exception 'CONTACT_RACE_LEFT_PARTIAL_AGENDA_MONEY_EFFECTS'; end if; end \$\$;"
done
"${psql_command[@]}" -c "select patient_management_race.prepare('move_before_contact');"
race patient_move_before_email_correction \
 "select patient_management_race.act('move_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='move_before_contact');"
"${psql_command[@]}" -c "select patient_management_race.assert_corrected_contact('move_before_contact'); select patient_management_race.assert_state('move_before_contact','reserved','pending',true,1);"
# Auxiliary clinical writes share the same contact authority and keep their
# own profile/submission contract; these are real row waits, in both orders.
"${psql_command[@]}" <<'SQL'
create function patient_management_race.prepare_information(p_label text) returns void language plpgsql as $$
declare r patient_management_race.requests; a public.appointments; begin
 perform patient_management_race.prepare(p_label);
 select * into strict r from patient_management_race.requests where label=p_label;
 select * into strict a from public.appointments where id=r.appointment_id;
 insert into public.appointment_patient_information_contexts(business_id,appointment_id,patient_id_snapshot,schema_snapshot)
 values(a.business_id,a.id,a.patient_id,'[{"id":"coverage","label":"Cobertura","kind":"text","required":false,"maxLength":100,"patientField":"insurance"}]');
end $$;
create function patient_management_race.submit_information(p_label text) returns uuid language plpgsql as $$
declare r patient_management_race.requests; info jsonb; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 info:=public.get_public_booking_information(r.token,false);
 return public.submit_public_booking_information(r.token,r.operation_id,info->>'schema_hash',info->>'version',
  jsonb_build_object('coverage',p_label),null,false);
end $$;
SQL
"${psql_command[@]}" -c "select patient_management_race.prepare_information('contact_before_information'); insert into patient_management_race.contact_snapshots select 'contact_before_information',patient_management_race.domain_state('contact_before_information');"
race contact_correction_before_clinical_information \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_information');" \
 "select patient_management_race.submit_information('contact_before_information');" BOOKING_INFORMATION_UNAVAILABLE
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('contact_before_information');
do $$ declare a public.appointments; begin
 select ap.* into strict a from public.appointments ap join patient_management_race.requests r on r.appointment_id=ap.id where r.label='contact_before_information';
 if exists(select 1 from public.appointment_intake_submissions where appointment_id=a.id)
  or (select insurance from public.patients where id=a.patient_id) is not null
  or patient_management_race.domain_state('contact_before_information') is distinct from
   (select value from patient_management_race.contact_snapshots where label='contact_before_information') then
  raise exception 'CONTACT_CLINICAL_INFORMATION_PARTIAL_EFFECTS'; end if;
end $$;
SQL
"${psql_command[@]}" -c "select patient_management_race.prepare_information('information_before_contact');"
race clinical_information_before_contact_correction \
 "select patient_management_race.submit_information('information_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='information_before_contact');"
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('information_before_contact');
do $$ declare a public.appointments; begin
 select ap.* into strict a from public.appointments ap join patient_management_race.requests r on r.appointment_id=ap.id where r.label='information_before_contact';
 if (select count(*) from public.appointment_intake_submissions where appointment_id=a.id)<>1
  or (select insurance from public.patients where id=a.patient_id) is distinct from 'information_before_contact' then
  raise exception 'AUTHORIZED_CLINICAL_INFORMATION_NOT_PRESERVED'; end if;
end $$;
SQL

# Two actual appointments of one patient must serialize BEFORE child FK key
# shares. A pauses after its INSERT; B then waits on A. With the old late
# patient lock, B also holds KEY SHARE and A's later UPDATE deadlocks.
"${psql_command[@]}" <<'SQL'
select patient_management_race.prepare_information('shared_patient_a');
do $$ declare a public.appointments; second_id uuid; b uuid:='e3100000-0000-4000-8000-000000000001'; begin
 select ap.* into strict a from public.appointments ap join patient_management_race.requests r on r.appointment_id=ap.id where r.label='shared_patient_a';
 insert into public.appointments(business_id,patient_id,professional_id,service_id,starts_at,ends_at,status,source,
  service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(b,a.patient_id,a.professional_id,a.service_id,a.starts_at+interval '1 day',a.ends_at+interval '1 day','reserved','manual',
  a.service_name_snapshot,a.professional_name_snapshot,a.duration_minutes_snapshot) returning id into second_id;
 insert into public.appointment_patient_information_contexts(business_id,appointment_id,patient_id_snapshot,schema_snapshot)
  select b,second_id,a.patient_id,schema_snapshot from public.appointment_patient_information_contexts where appointment_id=a.id;
 insert into patient_management_race.requests(label,appointment_id,token,operation_id)
  values('shared_patient_b',second_id,public.issue_appointment_management_capability(b,second_id,1),gen_random_uuid());
 insert into patient_management_race.contact_snapshots select 'shared_patient_a',patient_management_race.domain_state('shared_patient_a');
 insert into patient_management_race.contact_snapshots select 'shared_patient_b',patient_management_race.domain_state('shared_patient_b');
end $$;
create function patient_management_race.pause_first_information_after_fk() returns trigger language plpgsql as $$
begin
 if new.appointment_id=(select appointment_id from patient_management_race.requests where label='shared_patient_a') then
  perform pg_advisory_xact_lock(34123,950);
  for attempt in 1..240 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity a where a.application_name='patient-management-other' and a.wait_event_type='Lock'
    and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return new; end if;
   perform pg_sleep(0.025);
  end loop;
  raise exception 'CLINICAL_INFORMATION_COMPETITOR_DID_NOT_WAIT';
 end if;
 return new;
end $$;
create trigger zz_information_after_fk after insert on public.appointment_intake_submissions
 for each row execute function patient_management_race.pause_first_information_after_fk();
SQL
PGAPPNAME=clinical-information-first "${psql_command[@]}" >"$task_directory/holder.log" 2>&1 -c "select patient_management_race.submit_information('shared_patient_a');" &
holder_pid=$!
"${psql_command[@]}" <<'SQL'
do $$ begin
 for attempt in 1..240 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_locks where locktype='advisory' and classid=34123 and objid=950 and granted) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'CLINICAL_INFORMATION_FIRST_DID_NOT_REACH_CHILD_INSERT';
end $$;
SQL
PGAPPNAME=patient-management-other "${psql_command[@]}" >"$task_directory/other.log" 2>&1 -c "select patient_management_race.submit_information('shared_patient_b');"
wait "$holder_pid"; holder_pid=''
"${psql_command[@]}" <<'SQL'
drop trigger zz_information_after_fk on public.appointment_intake_submissions;
do $$ declare a public.appointments; begin
 select ap.* into strict a from public.appointments ap join patient_management_race.requests r on r.appointment_id=ap.id where r.label='shared_patient_a';
 if (select count(*) from public.appointment_intake_submissions where patient_id=a.patient_id)<>2
  or (select insurance from public.patients where id=a.patient_id) is distinct from 'shared_patient_b'
  or exists(select 1 from patient_management_race.contact_snapshots s where s.label in ('shared_patient_a','shared_patient_b')
   and s.value is distinct from patient_management_race.domain_state(s.label)) then
  raise exception 'SHARED_PATIENT_CLINICAL_INFORMATION_PARTIAL_STATE'; end if;
end $$;
SQL
echo 'PASS: two appointments of the same patient serialize before child FK insertion; both persist without deadlock.'

# Completion after provider verification still decides authority in SQL, not
# in a preceding HTTP read. Contact changes serialize at the actual patient row.
"${psql_command[@]}" <<'SQL'
update public.clinical_storage_budget set uploads_enabled=true where singleton;
update public.clinical_business_storage_budget set uploads_enabled=true where business_id='e3100000-0000-4000-8000-000000000001';
update public.businesses set patient_documents_enabled=true where id='e3100000-0000-4000-8000-000000000001';
create table patient_management_race.document_requests(label text primary key,file_id uuid not null);
create function patient_management_race.prepare_document(p_label text) returns void language plpgsql as $$
declare r patient_management_race.requests; file public.patient_radiographs; begin
 perform patient_management_race.prepare_information(p_label);
 select * into strict r from patient_management_race.requests where label=p_label;
 perform set_config('request.jwt.claim.role','service_role',true);
 file:=public.begin_public_patient_document_upload(r.token,r.operation_id,'synthetic.pdf','application/pdf',100,repeat('a',64),null,false);
 insert into patient_management_race.document_requests values(p_label,file.id);
end $$;
create function patient_management_race.complete_document(p_label text) returns uuid language plpgsql as $$
declare r patient_management_race.requests; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 perform set_config('request.jwt.claim.role','service_role',true);
 return public.complete_public_patient_document_upload(r.token,(select file_id from patient_management_race.document_requests where label=p_label),100,'application/pdf',false);
end $$;
select patient_management_race.prepare_document('contact_before_document');
SQL
race contact_correction_before_document_completion \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_document');" \
 "select patient_management_race.complete_document('contact_before_document');" BOOKING_INFORMATION_UNAVAILABLE
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('contact_before_document');
do $$ declare f uuid:=(select file_id from patient_management_race.document_requests where label='contact_before_document'); begin
 if (select status from public.patient_radiographs where id=f) is distinct from 'uploading'
  or exists(select 1 from public.audit_logs where entity_id=f and action='clinical_document.patient_upload_completed')
  or not exists(select 1 from public.clinical_upload_slots where file_id=f and expires_at>clock_timestamp()) then
  raise exception 'CONTACT_DOCUMENT_COMPLETION_PARTIAL_STATE'; end if;
end $$;
select patient_management_race.prepare_document('document_before_contact');
SQL
race document_completion_before_contact_correction \
 "select patient_management_race.complete_document('document_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='document_before_contact');"
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('document_before_contact');
do $$ declare f uuid:=(select file_id from patient_management_race.document_requests where label='document_before_contact'); begin
 if (select status from public.patient_radiographs where id=f) is distinct from 'ready'
  or (select count(*) from public.audit_logs where entity_id=f and action='clinical_document.patient_upload_completed')<>1 then
  raise exception 'AUTHORIZED_DOCUMENT_COMPLETION_NOT_PRESERVED'; end if;
end $$;
SQL

# New enrollment/test/feedback share only the management authority gate;
# an independently verified device receipt remains a different contract.
"${psql_command[@]}" <<'SQL'
create table patient_management_race.push_requests(label text primary key,subscription_id uuid not null,delivery_id uuid);
create function patient_management_race.enroll_push(p_label text) returns uuid language plpgsql as $$
declare r patient_management_race.requests; result uuid; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 select subscription_id into result from public.save_patient_appointment_push_subscription(r.token,false,
  'https://fcm.googleapis.com/management-race/e3100000-0000-4000-8000-000000000001/'||p_label,'synthetic-key','synthetic-auth','Synthetic race browser');
 return result;
end $$;
create function patient_management_race.prepare_push(p_label text,p_with_test boolean default false) returns void language plpgsql as $$
declare r patient_management_race.requests; subscription uuid; delivery uuid; begin
 perform patient_management_race.prepare(p_label);
 select * into strict r from patient_management_race.requests where label=p_label;
 subscription:=patient_management_race.enroll_push(p_label);
 if p_with_test then
  select delivery_id into delivery from public.begin_patient_push_test(r.token,false,subscription,repeat('a',64),repeat('b',64));
  update public.push_delivery_attempts set accepted_at=clock_timestamp(),push_service_status=201 where id=delivery;
 end if;
 insert into patient_management_race.push_requests values(p_label,subscription,delivery);
end $$;
create function patient_management_race.push_feedback(p_label text) returns boolean language plpgsql as $$
declare r patient_management_race.requests; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 return public.record_patient_push_test_feedback(r.token,false,(select delivery_id from patient_management_race.push_requests where label=p_label),true);
end $$;
select patient_management_race.prepare('contact_before_push');
insert into patient_management_race.contact_snapshots select 'contact_before_push',patient_management_race.domain_state('contact_before_push');
SQL
race contact_correction_before_push_enrollment \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_push');" \
 "select patient_management_race.enroll_push('contact_before_push');" APPOINTMENT_LINK_UNAVAILABLE
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('contact_before_push');
do $$ begin
 if exists(select 1 from public.push_devices where endpoint='https://fcm.googleapis.com/management-race/e3100000-0000-4000-8000-000000000001/contact_before_push')
  or patient_management_race.domain_state('contact_before_push') is distinct from
   (select value from patient_management_race.contact_snapshots where label='contact_before_push') then
  raise exception 'CONTACT_PUSH_ENROLLMENT_PARTIAL_EFFECTS'; end if;
end $$;
select patient_management_race.prepare('push_before_contact');
SQL
race push_enrollment_before_contact_correction \
 "select patient_management_race.enroll_push('push_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='push_before_contact');"
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('push_before_contact');
do $$ declare a uuid:=(select appointment_id from patient_management_race.requests where label='push_before_contact'); begin
 if (select count(*) from public.push_subscriptions where appointment_id=a and detached_at is null)<>1
  or (select count(*) from public.audit_logs where entity_id=a and action='appointment.push_subscribed')<>1 then
  raise exception 'AUTHORIZED_PUSH_ENROLLMENT_NOT_PRESERVED'; end if;
end $$;
select patient_management_race.prepare_push('parallel_push_test');
SQL
race two_tabs_prepare_one_push_test \
 "select * from public.begin_patient_push_test((select token from patient_management_race.requests where label='parallel_push_test'),false,(select subscription_id from patient_management_race.push_requests where label='parallel_push_test'),repeat('a',64),repeat('b',64));" \
 "select * from public.begin_patient_push_test((select token from patient_management_race.requests where label='parallel_push_test'),false,(select subscription_id from patient_management_race.push_requests where label='parallel_push_test'),repeat('c',64),repeat('d',64));"
"${psql_command[@]}" <<'SQL'
do $$ declare a uuid:=(select appointment_id from patient_management_race.requests where label='parallel_push_test'); begin
 if (select count(*) from public.push_delivery_attempts where appointment_id=a)<>1
  or (select receipt_token_hash from public.push_delivery_attempts where appointment_id=a) is distinct from repeat('a',64)
  or exists(select 1 from public.push_delivery_attempts where appointment_id=a and accepted_at is not null) then
  raise exception 'PARALLEL_PUSH_TEST_DUPLICATE_OR_FALSE_ACCEPTANCE'; end if;
end $$;
select patient_management_race.prepare_push('contact_before_feedback',true);
SQL
race contact_correction_before_push_feedback \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_feedback');" \
 "select patient_management_race.push_feedback('contact_before_feedback');" APPOINTMENT_LINK_UNAVAILABLE
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('contact_before_feedback');
do $$ begin
 if exists(select 1 from public.push_delivery_attempts where id=(select delivery_id from patient_management_race.push_requests where label='contact_before_feedback') and user_confirmed_at is not null)
  or exists(select 1 from public.push_devices d join public.push_subscriptions s on s.device_id=d.id
   where s.id=(select subscription_id from patient_management_race.push_requests where label='contact_before_feedback') and d.last_test_confirmed_at is not null) then
  raise exception 'CONTACT_PUSH_FEEDBACK_PARTIAL_EFFECTS'; end if;
end $$;
select patient_management_race.prepare_push('feedback_before_contact',true);
SQL
race push_feedback_before_contact_correction \
 "select patient_management_race.push_feedback('feedback_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='feedback_before_contact');"
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('feedback_before_contact');
do $$ begin
 if not exists(select 1 from public.push_delivery_attempts where id=(select delivery_id from patient_management_race.push_requests where label='feedback_before_contact') and user_confirmed_at is not null)
  or not exists(select 1 from public.push_devices d join public.push_subscriptions s on s.device_id=d.id
   where s.id=(select subscription_id from patient_management_race.push_requests where label='feedback_before_contact') and d.last_test_confirmed_at is not null) then
  raise exception 'AUTHORIZED_PUSH_FEEDBACK_NOT_PRESERVED'; end if;
end $$;
SQL

# FK progress while enrollment holds its parent/device before association
# upsert. This attacks both unnecessary UPDATE locks, using the real generic
# delivery trigger and real foreign keys, not an assumed multi-table lock order.
"${psql_command[@]}" <<'SQL'
select patient_management_race.prepare_push('push_fk_progress');
create function patient_management_race.pause_push_after_device_update() returns trigger language plpgsql as $$
begin
 if new.endpoint='https://fcm.googleapis.com/management-race/e3100000-0000-4000-8000-000000000001/push_fk_progress'
  and current_setting('application_name')='push-enrollment-holder' then
  perform pg_advisory_xact_lock(34123,951);
  for attempt in 1..240 loop
   if exists(select 1 from patient_management_race.signals where label='push_child_finished') then return new; end if;
   perform pg_sleep(0.025);
  end loop;
  raise exception 'PUSH_DELIVERY_FK_DID_NOT_FINISH';
 end if;
 return new;
end $$;
create trigger zz_pause_push_device after update on public.push_devices for each row
 execute function patient_management_race.pause_push_after_device_update();
SQL
for lock_probe in compatible parent_update device_update; do
 "${psql_command[@]}" -c "delete from patient_management_race.signals where label='push_child_finished';"
 before_lock=''
 case "$lock_probe" in
  parent_update) before_lock="select 1 from public.appointments where id=(select appointment_id from patient_management_race.requests where label='push_fk_progress') for update;" ;;
  device_update) before_lock="select 1 from public.appointments where id=(select appointment_id from patient_management_race.requests where label='push_fk_progress') for no key update; select 1 from public.push_devices where endpoint='https://fcm.googleapis.com/management-race/e3100000-0000-4000-8000-000000000001/push_fk_progress' for update;" ;;
 esac
 PGAPPNAME=push-enrollment-holder "${psql_command[@]}" >"$task_directory/holder.log" 2>&1 <<SQL &
begin;
$before_lock
select patient_management_race.enroll_push('push_fk_progress');
commit;
SQL
 holder_pid=$!
 "${psql_command[@]}" <<'SQL'
do $$ begin
 for attempt in 1..240 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_locks where locktype='advisory' and classid=34123 and objid=951 and granted) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'PUSH_ENROLLMENT_DID_NOT_REACH_DEVICE_UPDATE';
end $$;
SQL
 child_status=0
 "${psql_command[@]}" >"$task_directory/other.log" 2>&1 <<'SQL' || child_status=$?
set lock_timeout='300ms';
set statement_timeout='1s';
insert into public.push_delivery_attempts(business_id,appointment_id,subscription_id,kind,receipt_token_hash,expires_at)
 select 'e3100000-0000-4000-8000-000000000001',r.appointment_id,p.subscription_id,'24h',repeat('f',64),clock_timestamp()+interval '5 minutes'
 from patient_management_race.requests r join patient_management_race.push_requests p using(label) where r.label='push_fk_progress';
SQL
 if [[ "$lock_probe" == compatible ]]; then
  [[ "$child_status" == 0 ]]
 else
  [[ "$child_status" != 0 ]]
  grep -Fq 'lock timeout' "$task_directory/other.log"
  if [[ "$lock_probe" == parent_update ]]; then
   grep -Fq 'relation "appointments"' "$task_directory/other.log"
  else
   grep -Fq 'relation "push_devices"' "$task_directory/other.log"
  fi
 fi
 kill -0 "$holder_pid"
 "${psql_command[@]}" -c "insert into patient_management_race.signals values('push_child_finished');"
 wait "$holder_pid"; holder_pid=''
 echo "PASS: push FK lock probe $lock_probe (actual compatible command progresses; stronger counterexamples block)."
done
"${psql_command[@]}" <<'SQL'
drop trigger zz_pause_push_device on public.push_devices;
do $$ declare a uuid:=(select appointment_id from patient_management_race.requests where label='push_fk_progress'); begin
 if (select count(*) from public.push_delivery_attempts where appointment_id=a and kind='24h')<>1
  or (select count(*) from public.push_subscriptions where appointment_id=a and detached_at is null)<>1 then
  raise exception 'PUSH_DELIVERY_FK_PARTIAL_STATE'; end if;
end $$;
SQL
echo 'PASS: actual delivery child foreign keys finish while enrollment holds parent/device before association upsert.'

# OAuth decisions must remain bound across the external-exchange gap.
"${psql_command[@]}" <<'SQL'
create table patient_management_race.calendar_requests(label text primary key,attempt_id uuid not null,state_hash text not null);
create function patient_management_race.prepare_calendar(p_label text) returns void language plpgsql as $$
declare r patient_management_race.requests; state text; attempt uuid; begin
 perform patient_management_race.prepare(p_label);
 select * into strict r from patient_management_race.requests where label=p_label;
 state:=encode(extensions.digest('calendar-race/'||r.appointment_id,'sha256'),'hex');
 attempt:=public.begin_patient_google_calendar_authorization(r.token,false,state,repeat('v',32),repeat('e',40),false);
 insert into patient_management_race.calendar_requests values(p_label,attempt,state);
end $$;
create function patient_management_race.consume_calendar(p_label text) returns uuid language sql as $$
 select result.attempt_id from patient_management_race.requests r join patient_management_race.calendar_requests c using(label),
 lateral public.consume_patient_google_calendar_authorization(c.state_hash,r.token,false) result where label=p_label
$$;
create function patient_management_race.authorize_calendar(p_label text,p_other_attempt boolean default false) returns uuid language sql as $$
 select event_row_id from patient_management_race.requests r join patient_management_race.calendar_requests c using(label),
 lateral public.authorize_patient_google_calendar_event(r.token,false,
  case when p_other_attempt then (select attempt_id from patient_management_race.calendar_requests where label=p_label||'_other') else c.attempt_id end,
  repeat('c',64),'calendar-race/e3100000-0000-4000-8000-000000000001/'||p_label||case when p_other_attempt then '/other' else '' end,
  repeat('r',40),array['https://www.googleapis.com/auth/calendar.events.owned']) result where label=p_label
$$;
create function patient_management_race.assert_calendar(p_label text,p_consumed boolean,p_authorized boolean) returns void language plpgsql as $$
declare r patient_management_race.requests; attempt public.google_calendar_oauth_attempts; begin
 select * into strict r from patient_management_race.requests where label=p_label;
 select * into strict attempt from public.google_calendar_oauth_attempts where id=(select attempt_id from patient_management_race.calendar_requests where label=p_label);
 if (attempt.consumed_at is not null) is distinct from p_consumed or (attempt.authorized_at is not null) is distinct from p_authorized
  or (select count(*) from public.appointment_google_calendar_events where appointment_id=r.appointment_id)<>p_authorized::int
  or (select count(*) from public.audit_logs where entity_id=r.appointment_id and action='appointment.google_calendar_authorized')<>p_authorized::int
  or exists(select 1 from public.appointments a where a.id=r.appointment_id and (a.status<>'reserved' or a.starts_at=r.target))
  then raise exception 'CALENDAR_AUTHORIZATION_PARTIAL_STATE_%',p_label; end if;
end $$;
select patient_management_race.prepare_calendar('contact_before_oauth_consume');
SQL
race contact_correction_before_oauth_consume \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_oauth_consume');" \
 "select patient_management_race.consume_calendar('contact_before_oauth_consume');" APPOINTMENT_LINK_UNAVAILABLE
"${psql_command[@]}" -c "select patient_management_race.assert_calendar('contact_before_oauth_consume',false,false); select patient_management_race.prepare_calendar('oauth_consume_before_contact');"
race oauth_consume_before_contact_correction \
 "select patient_management_race.consume_calendar('oauth_consume_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='oauth_consume_before_contact');"
"${psql_command[@]}" -c "select patient_management_race.assert_calendar('oauth_consume_before_contact',true,false); select patient_management_race.prepare_calendar('contact_before_oauth_grant'); select patient_management_race.consume_calendar('contact_before_oauth_grant');"
race contact_correction_before_oauth_final_grant \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_oauth_grant');" \
 "select patient_management_race.authorize_calendar('contact_before_oauth_grant');" APPOINTMENT_LINK_UNAVAILABLE
"${psql_command[@]}" -c "select patient_management_race.assert_calendar('contact_before_oauth_grant',true,false); select patient_management_race.prepare_calendar('oauth_grant_before_contact'); select patient_management_race.consume_calendar('oauth_grant_before_contact');"
race oauth_final_grant_before_contact_correction \
 "select patient_management_race.authorize_calendar('oauth_grant_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='oauth_grant_before_contact');"
"${psql_command[@]}" -c "select patient_management_race.assert_calendar('oauth_grant_before_contact',true,true); select patient_management_race.prepare_calendar('oauth_duplicate_grant'); select patient_management_race.consume_calendar('oauth_duplicate_grant');"
race same_nonce_finalized_concurrently \
 "select patient_management_race.authorize_calendar('oauth_duplicate_grant');" \
 "select patient_management_race.authorize_calendar('oauth_duplicate_grant');" GOOGLE_CALENDAR_OAUTH_ALREADY_AUTHORIZED
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_calendar('oauth_duplicate_grant',true,true);
select patient_management_race.prepare_calendar('oauth_competing_accounts');
select patient_management_race.consume_calendar('oauth_competing_accounts');
do $$ declare r patient_management_race.requests; state text:=repeat('e',64); id uuid; begin
 select * into strict r from patient_management_race.requests where label='oauth_competing_accounts';
 id:=public.begin_patient_google_calendar_authorization(r.token,false,state,repeat('v',32),repeat('e',40),false);
 insert into patient_management_race.calendar_requests values('oauth_competing_accounts_other',id,state);
 perform public.consume_patient_google_calendar_authorization(state,r.token,false);
end $$;
SQL
race competing_accounts_before_event_creation \
 "select patient_management_race.authorize_calendar('oauth_competing_accounts');" \
 "select patient_management_race.authorize_calendar('oauth_competing_accounts',true);" GOOGLE_CALENDAR_ALREADY_CONNECTED
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_calendar('oauth_competing_accounts',true,true);
do $$ begin
 if exists(select 1 from public.google_calendar_connections where google_subject='calendar-race/e3100000-0000-4000-8000-000000000001/oauth_competing_accounts/other')
 then raise exception 'COMPETING_OAUTH_ACCOUNT_LEFT_CONNECTION'; end if;
end $$;
SQL

# Completion is an appointment writer through telemetry/activity triggers. It
# must not retain the child while waiting for its parent against a new grant.
"${psql_command[@]}" <<'SQL'
select patient_management_race.prepare_calendar('oauth_during_worker_completion');
select patient_management_race.consume_calendar('oauth_during_worker_completion');
select patient_management_race.authorize_calendar('oauth_during_worker_completion');
do $$ declare r patient_management_race.requests; state text:=repeat('f',64); id uuid; begin
 select * into strict r from patient_management_race.requests where label='oauth_during_worker_completion';
 id:=public.begin_patient_google_calendar_authorization(r.token,false,state,repeat('v',32),repeat('e',40),false);
 update patient_management_race.calendar_requests set attempt_id=id,state_hash=state where label=r.label;
 perform public.consume_patient_google_calendar_authorization(state,r.token,false);
end $$;
SQL
race oauth_final_grant_against_actual_sync_completion \
 "select private.lock_patient_push_management(r.token,false,true) from patient_management_race.requests r where r.label='oauth_during_worker_completion';" \
 "select public.complete_google_calendar_event_sync(e.id,'synthetic-current-event',a.calendar_sequence,clock_timestamp()) from public.appointment_google_calendar_events e join public.appointments a on a.id=e.appointment_id join patient_management_race.requests r on r.appointment_id=a.id where r.label='oauth_during_worker_completion';" \
 "" "select patient_management_race.authorize_calendar('oauth_during_worker_completion');"
"${psql_command[@]}" <<'SQL'
do $$ declare r patient_management_race.requests; begin
 select * into strict r from patient_management_race.requests where label='oauth_during_worker_completion';
 if (select count(*) from public.audit_logs where entity_id=r.appointment_id and action='appointment.google_calendar_authorized')<>2
  or not exists(select 1 from public.appointment_google_calendar_events where appointment_id=r.appointment_id and sync_status='active'
   and event_id='synthetic-current-event') then raise exception 'CALENDAR_GRANT_SYNC_COMPLETION_PARTIAL_STATE'; end if;
end $$;
SQL

# Opposite JSON result order must not become opposite transaction lock order.
"${psql_command[@]}" <<'SQL'
select patient_management_race.prepare_calendar('batch_completion_left');
select patient_management_race.consume_calendar('batch_completion_left');
select patient_management_race.authorize_calendar('batch_completion_left');
select patient_management_race.prepare_calendar('batch_completion_right');
select patient_management_race.consume_calendar('batch_completion_right');
select patient_management_race.authorize_calendar('batch_completion_right');
update public.appointment_google_calendar_events set claim_token='e3100000-0000-4000-8000-000000000099',claimed_at=clock_timestamp()
 where appointment_id in(select appointment_id from patient_management_race.requests where label in ('batch_completion_left','batch_completion_right'));
create table patient_management_race.calendar_batch_results(label text primary key,result jsonb not null);
create function patient_management_race.complete_calendar_batch(p_reverse boolean) returns jsonb language sql as $$
 select public.complete_google_calendar_sync_batch('e3100000-0000-4000-8000-000000000099',clock_timestamp(),
  jsonb_agg(jsonb_build_object('event_row_id',e.id,'outcome','synced','google_event_id','synthetic-'||r.label,'synced_sequence',a.calendar_sequence)
   order by case when p_reverse then r.label end desc,case when not p_reverse then r.label end),false)
 from patient_management_race.requests r join public.appointments a on a.id=r.appointment_id
 join public.appointment_google_calendar_events e on e.appointment_id=a.id
 where r.label in ('batch_completion_left','batch_completion_right')
$$;
create function patient_management_race.pause_calendar_first_result() returns trigger language plpgsql as $$
begin
 if current_setting('application_name')='calendar-batch-holder' and new.sync_status='active'
  and new.appointment_id=(select appointment_id from patient_management_race.requests where label='batch_completion_right') then
  perform pg_advisory_xact_lock(34123,952);
  for attempt in 1..240 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity a where a.application_name='patient-management-other' and a.wait_event_type='Lock'
    and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return new; end if;
   perform pg_sleep(0.025);
  end loop;
  raise exception 'CALENDAR_BATCH_COMPETITOR_DID_NOT_WAIT';
 end if;
 return new;
end $$;
create trigger zz_pause_calendar_batch after update on public.appointment_google_calendar_events for each row
 execute function patient_management_race.pause_calendar_first_result();
SQL
PGAPPNAME=calendar-batch-holder "${psql_command[@]}" >"$task_directory/holder.log" 2>&1 -c "insert into patient_management_race.calendar_batch_results select 'holder',patient_management_race.complete_calendar_batch(true);" &
holder_pid=$!
"${psql_command[@]}" <<'SQL'
do $$ begin
 for attempt in 1..240 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_locks where locktype='advisory' and classid=34123 and objid=952 and granted) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'CALENDAR_BATCH_HOLDER_DID_NOT_REACH_FIRST_RESULT';
end $$;
SQL
PGAPPNAME=patient-management-other "${psql_command[@]}" >"$task_directory/other.log" 2>&1 -c "insert into patient_management_race.calendar_batch_results select 'other',patient_management_race.complete_calendar_batch(false);"
wait "$holder_pid"; holder_pid=''
"${psql_command[@]}" <<'SQL'
drop trigger zz_pause_calendar_batch on public.appointment_google_calendar_events;
do $$ begin
 if (select count(*) from public.appointment_google_calendar_events e join patient_management_race.requests r on r.appointment_id=e.appointment_id
  where r.label in ('batch_completion_left','batch_completion_right') and e.sync_status='active' and e.event_id='synthetic-'||r.label and e.claim_token is null)<>2
  or (select count(*) from patient_management_race.calendar_batch_results b,lateral jsonb_array_elements(b.result->'results') item
    where b.label='holder' and item->>'status'='active')<>2
  or (select count(*) from patient_management_race.calendar_batch_results b,lateral jsonb_array_elements(b.result->'results') item
    where b.label='other' and item->>'status'='stale')<>2 then
   raise exception 'REVERSED_CALENDAR_BATCH_PARTIAL_OR_DUPLICATE_EFFECT'; end if;
end $$;
SQL
echo 'PASS: two real batches with opposite result order serialize before the first child effect; duplicate results stay stale.'

# A child-only claim and a grant must decide under the actual event row lock,
# including a claimant that starts after the parent gate has been acquired.
"${psql_command[@]}" <<'SQL'
create function patient_management_race.prepare_calendar_reauthorization(p_label text) returns void language plpgsql as $$
declare r patient_management_race.requests; state text; id uuid; begin
 perform patient_management_race.prepare_calendar(p_label);
 perform patient_management_race.consume_calendar(p_label);
 perform patient_management_race.authorize_calendar(p_label);
 select * into strict r from patient_management_race.requests where label=p_label;
 state:=encode(extensions.digest('reauthorization/'||r.appointment_id,'sha256'),'hex');
 id:=public.begin_patient_google_calendar_authorization(r.token,false,state,repeat('v',32),repeat('e',40),false);
 perform public.consume_patient_google_calendar_authorization(state,r.token,false);
 update patient_management_race.calendar_requests set attempt_id=id,state_hash=state where label=p_label;
end $$;
select patient_management_race.prepare_calendar_reauthorization('target_claim_before_grant');
SQL
race target_claim_before_reauthorization \
 "select public.claim_google_calendar_event_sync(e.id,'e3100000-0000-4000-8000-000000000097') from public.appointment_google_calendar_events e join patient_management_race.requests r on r.appointment_id=e.appointment_id where r.label='target_claim_before_grant';" \
 "select patient_management_race.authorize_calendar('target_claim_before_grant');" GOOGLE_CALENDAR_SYNC_IN_PROGRESS
"${psql_command[@]}" <<'SQL'
do $$ begin
 if not exists(select 1 from public.appointment_google_calendar_events e join patient_management_race.requests r on r.appointment_id=e.appointment_id
  where r.label='target_claim_before_grant' and e.claimed_at is not null and e.claim_token='e3100000-0000-4000-8000-000000000097')
  or not exists(select 1 from public.google_calendar_oauth_attempts a join patient_management_race.calendar_requests r on r.attempt_id=a.id
   where r.label='target_claim_before_grant' and a.authorized_at is null) then
  raise exception 'REAUTHORIZATION_RETIRED_LIVE_TARGET_CLAIM'; end if;
end $$;
select patient_management_race.prepare_calendar_reauthorization('grant_before_target_claim');
create function patient_management_race.pause_calendar_grant_with_event_lock() returns trigger language plpgsql as $$
begin
 if current_setting('application_name')='calendar-grant-holder' and new.action='appointment.google_calendar_authorized'
  and new.entity_id=(select appointment_id from patient_management_race.requests where label='grant_before_target_claim') then
  perform pg_advisory_xact_lock(34123,953);
  for attempt in 1..240 loop
   if exists(select 1 from patient_management_race.signals where label='calendar_target_claim_skipped') then return new; end if;
   perform pg_sleep(0.025);
  end loop;
  raise exception 'CALENDAR_TARGET_CLAIM_DID_NOT_FINISH_SKIPPED';
 end if;
 return new;
end $$;
create trigger zz_pause_calendar_grant after insert on public.audit_logs for each row
 execute function patient_management_race.pause_calendar_grant_with_event_lock();
SQL
PGAPPNAME=calendar-grant-holder "${psql_command[@]}" >"$task_directory/holder.log" 2>&1 -c "select patient_management_race.authorize_calendar('grant_before_target_claim');" &
holder_pid=$!
"${psql_command[@]}" <<'SQL'
do $$ begin
 for attempt in 1..240 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_locks where locktype='advisory' and classid=34123 and objid=953 and granted) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'CALENDAR_GRANT_DID_NOT_REACH_OWNED_EVENT_EFFECT';
end $$;
do $$ declare id uuid; begin
 select e.id into strict id from public.appointment_google_calendar_events e join patient_management_race.requests r on r.appointment_id=e.appointment_id where r.label='grant_before_target_claim';
 if public.claim_google_calendar_event_sync(id,gen_random_uuid()) is not null then raise exception 'CALENDAR_TARGET_CLAIM_BYPASSED_GRANT_EVENT_LOCK'; end if;
 insert into patient_management_race.signals values('calendar_target_claim_skipped');
end $$;
SQL
wait "$holder_pid"; holder_pid=''
"${psql_command[@]}" <<'SQL'
drop trigger zz_pause_calendar_grant on public.audit_logs;
do $$ declare target_event uuid; owner uuid:=gen_random_uuid(); result jsonb; begin
 select e.id into strict target_event from public.appointment_google_calendar_events e join patient_management_race.requests r on r.appointment_id=e.appointment_id where r.label='grant_before_target_claim';
 result:=public.claim_google_calendar_event_sync(target_event,owner);
 if result->>'event_row_id' is distinct from target_event::text
  or not exists(select 1 from public.appointment_google_calendar_events where id=target_event and claim_token=owner) then
  raise exception 'CALENDAR_TARGET_CLAIM_NOT_AVAILABLE_AFTER_COMMITTED_GRANT'; end if;
end $$;
SQL
echo 'PASS: a target claimant skips the grant-held event and can own it after commit; a grant cannot retire an existing lease.'

# Observations write patient activity; lock its final mode before any effect.
"${psql_command[@]}" <<'SQL'
create function patient_management_race.observe_calendar(p_label text) returns boolean language sql as $$
 select public.record_patient_calendar_action(token,false,'clicked_ics',null) from patient_management_race.requests where label=p_label
$$;
select patient_management_race.prepare('contact_before_calendar_observation');
insert into patient_management_race.contact_snapshots select 'contact_before_calendar_observation',patient_management_race.domain_state('contact_before_calendar_observation');
SQL
race contact_correction_before_calendar_observation \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='contact_before_calendar_observation');" \
 "select patient_management_race.observe_calendar('contact_before_calendar_observation');" APPOINTMENT_LINK_UNAVAILABLE
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('contact_before_calendar_observation');
do $$ begin
 if patient_management_race.domain_state('contact_before_calendar_observation') is distinct from
  (select value from patient_management_race.contact_snapshots where label='contact_before_calendar_observation') then
  raise exception 'REVOKED_OBSERVATION_LEFT_PARTIAL_TELEMETRY'; end if;
end $$;
select patient_management_race.prepare('calendar_observation_before_contact');
SQL
race calendar_observation_before_contact_correction \
 "select patient_management_race.observe_calendar('calendar_observation_before_contact');" \
 "update public.patients set email='race-corrected@example.test' where id=(select a.patient_id from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='calendar_observation_before_contact');"
"${psql_command[@]}" <<'SQL'
select patient_management_race.assert_corrected_contact('calendar_observation_before_contact');
do $$ begin
 if not exists(select 1 from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id
  where r.label='calendar_observation_before_contact' and a.calendar_action_count=1 and a.calendar_action_status='clicked_ics')
  or (select count(*) from public.audit_logs l join patient_management_race.requests r on r.appointment_id=l.entity_id
   where r.label='calendar_observation_before_contact' and l.action='appointment.calendar_action')<>1 then
  raise exception 'COMMITTED_OBSERVATION_LOST_BEFORE_CONTACT_REVOCATION'; end if;
end $$;
select patient_management_race.prepare('shared_patient_calendar_left');
do $$ declare first public.appointments; other uuid; begin
 select a.* into strict first from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id where r.label='shared_patient_calendar_left';
 insert into public.appointments(business_id,patient_id,professional_id,service_id,starts_at,ends_at,status,source,
  service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(first.business_id,first.patient_id,first.professional_id,first.service_id,first.starts_at+interval '2 hours',first.ends_at+interval '2 hours',
  'reserved','manual','Synthetic shared calendar','Synthetic shared professional',60) returning id into other;
 insert into patient_management_race.requests(label,appointment_id,token)
 values('shared_patient_calendar_right',other,public.issue_appointment_management_capability(first.business_id,other,1));
end $$;
create function patient_management_race.pause_calendar_before_activity() returns trigger language plpgsql as $$
begin
 if current_setting('application_name')='calendar-observation-holder' and new.calendar_action_status='clicked_ics'
  and new.id=(select appointment_id from patient_management_race.requests where label='shared_patient_calendar_left') then
  perform pg_advisory_xact_lock(34123,954);
  for attempt in 1..240 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity a where a.application_name='patient-management-other' and a.wait_event_type='Lock'
    and pg_backend_pid()=any(pg_blocking_pids(a.pid))) then return new; end if;
   perform pg_sleep(0.025);
  end loop;
  raise exception 'SHARED_PATIENT_OBSERVATION_DID_NOT_SERIALIZE';
 end if;
 return new;
end $$;
create trigger zz_pause_calendar_observation before update on public.appointments for each row
 execute function patient_management_race.pause_calendar_before_activity();
SQL
PGAPPNAME=calendar-observation-holder "${psql_command[@]}" >"$task_directory/holder.log" 2>&1 -c "select patient_management_race.observe_calendar('shared_patient_calendar_left');" &
holder_pid=$!
"${psql_command[@]}" <<'SQL'
do $$ begin
 for attempt in 1..240 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_locks where locktype='advisory' and classid=34123 and objid=954 and granted) then return; end if;
  perform pg_sleep(0.025);
 end loop;
 raise exception 'CALENDAR_OBSERVATION_HOLDER_DID_NOT_REACH_PREWRITE';
end $$;
SQL
PGAPPNAME=patient-management-other "${psql_command[@]}" >"$task_directory/other.log" 2>&1 -c "select patient_management_race.observe_calendar('shared_patient_calendar_right');"
wait "$holder_pid"; holder_pid=''
"${psql_command[@]}" <<'SQL'
drop trigger zz_pause_calendar_observation on public.appointments;
do $$ begin
 if (select count(*) from public.appointments a join patient_management_race.requests r on r.appointment_id=a.id
  where r.label in ('shared_patient_calendar_left','shared_patient_calendar_right') and a.calendar_action_count=1 and a.calendar_action_status='clicked_ics')<>2
  or (select count(*) from public.audit_logs l join patient_management_race.requests r on r.appointment_id=l.entity_id
   where r.label in ('shared_patient_calendar_left','shared_patient_calendar_right') and l.action='appointment.calendar_action')<>2 then
  raise exception 'SHARED_PATIENT_CALENDAR_OBSERVATION_PARTIAL_EFFECT'; end if;
end $$;
SQL
echo 'PASS: two different appointments of the same patient serialize before activity, preserving both observations without lock upgrades.'

deadlocks_after=$("${psql_command[@]}" -c 'select deadlocks from pg_stat_database where datname=current_database();')
[[ "$deadlocks_before" == "$deadlocks_after" ]]
echo 'PASS: forty-eight controlled management/contact/clinical/OAuth races plus two FK lock counterexamples; no PostgreSQL deadlock.'
