#!/usr/bin/env bash
set -euo pipefail

database_url="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:55422/postgres}"
case "$database_url" in
	postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
	*)
		echo "Refusing to run patient export lock test outside local PostgreSQL." >&2
		exit 2
		;;
esac

owner_id='7e000000-0000-4000-8000-000000000001'
admin_id='7e000000-0000-4000-8000-000000000002'
business_id='7f000000-0000-4000-8000-000000000001'
slug='e2e-patient-export-global-lock'
tmpdir=$(mktemp -d)

clear_fixture() {
	psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL >/dev/null 2>&1 || true
delete from public.businesses where id = '$business_id';
delete from auth.users where id in ('$owner_id', '$admin_id');
SQL
}

cleanup() {
	clear_fixture
	if [[ -d "$tmpdir" ]]; then
		rm -r -- "$tmpdir"
	fi
}
trap cleanup EXIT

clear_fixture

psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email)
values
	('$owner_id', 'patient-export-lock-owner@example.test'),
	('$admin_id', 'patient-export-lock-admin@example.test');

insert into public.businesses (id, name, slug, industry, timezone)
values (
	'$business_id',
	'Prueba lock exportacion',
	'$slug',
	'odontology',
	'America/Argentina/Buenos_Aires'
);

update public.business_subscriptions
set
	commercial_access_enabled = true,
	is_permanent = true,
	subscription_status = 'active',
	paid_until = null,
	grace_until = null,
	restricted_until = null,
	archived_at = null
where business_id = '$business_id';

insert into public.business_users (business_id, user_id, role, status, accepted_at)
values
	('$business_id', '$owner_id', 'owner', 'active', statement_timestamp()),
	('$business_id', '$admin_id', 'admin', 'active', statement_timestamp());

insert into public.patients (owner_id, business_id, full_name)
values ('$owner_id', '$business_id', 'Paciente lock global');
SQL

start_global() {
	local actor_id="$1"
	local request_key="$2"
	psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
begin;
set local role service_role;
select public.begin_patient_export(
	'$actor_id',
	'$business_id',
	'all_patients',
	null,
	'$request_key'
);
select pg_sleep(1);
commit;
SQL
}

set +e
start_global "$owner_id" '7e100000-0000-4000-8000-000000000001' >"$tmpdir/owner.log" 2>&1 &
owner_pid=$!
start_global "$admin_id" '7e100000-0000-4000-8000-000000000002' >"$tmpdir/admin.log" 2>&1 &
admin_pid=$!
wait "$owner_pid"
owner_status=$?
wait "$admin_pid"
admin_status=$?
set -e

if [[ "$owner_status" -ne 0 || "$admin_status" -ne 0 ]]; then
	echo 'Both concurrent calls must return a controlled JSON result.' >&2
	cat "$tmpdir/owner.log" "$tmpdir/admin.log" >&2
	exit 1
fi

combined=$(cat "$tmpdir/owner.log" "$tmpdir/admin.log")
successes=$(grep -c '"ok": true' <<<"$combined" || true)
blocked=$(grep -c '"error_code": "EXPORT_IN_PROGRESS"' <<<"$combined" || true)
if [[ "$successes" -ne 1 || "$blocked" -ne 1 ]]; then
	echo "Expected one global session and one EXPORT_IN_PROGRESS response." >&2
	cat "$tmpdir/owner.log" "$tmpdir/admin.log" >&2
	exit 1
fi

state=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "
	select
		count(distinct session.id) || '|' || count(distinct audit.id)
	from public.patient_export_sessions session
	left join public.audit_logs audit
		on audit.entity_id = session.id
		and audit.action = 'patient_export_requested'
	where session.business_id = '$business_id'
		and session.scope = 'all_patients'
		and session.status in ('requested', 'streaming');
")

if [[ "$state" != '1|1' ]]; then
	echo "Expected one active global session and one requested audit, got: $state" >&2
	exit 1
fi

echo 'PASS: simultaneous global starts produced one session and one controlled conflict.'
