#!/usr/bin/env bash
set -euo pipefail

database_url="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:55422/postgres}"
case "$database_url" in
	postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
	*)
		echo "Refusing to run concurrency test outside local PostgreSQL." >&2
		exit 2
		;;
esac

business_id='f2000000-0000-4000-8000-000000000001'
patient_id='f3000000-0000-4000-8000-000000000001'
actor_id='f1000000-0000-4000-8000-000000000001'
slug='e2e-clinical-upload-concurrency'
tmpdir=$(mktemp -d)

clear_fixture() {
	psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL >/dev/null
begin;
select private.clinical_budget_lock();
with released as (
 delete from public.clinical_upload_slots
 where file_id in (select id from public.patient_radiographs where business_id='$business_id')
 returning reserved_bytes
)
update public.clinical_storage_budget
set reserved_bytes=reserved_bytes-(select coalesce(sum(reserved_bytes),0) from released),updated_at=clock_timestamp()
where singleton;
delete from public.patient_radiographs where business_id = '$business_id';
delete from public.businesses where id = '$business_id';
delete from auth.users where id = '$actor_id';
commit;
SQL
}

cleanup() {
	local status="$?"
	if ! clear_fixture; then status=1; fi
	rm -rf "$tmpdir"
	exit "$status"
}
trap cleanup EXIT

clear_fixture

psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email)
values ('$actor_id', 'e2e-clinical-upload-concurrency@example.test');

insert into public.businesses (id, name, slug, industry, timezone)
values (
	'$business_id',
	'E2E concurrencia de cargas clínicas',
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
values ('$business_id', '$actor_id', 'owner', 'active', now());

insert into public.patients (id, owner_id, business_id, full_name, dni, phone)
values (
	'$patient_id',
	'$actor_id',
	'$business_id',
	'Paciente concurrencia clínica',
	'30999001',
	'1130999001'
);

insert into public.patient_radiographs (
	id, owner_id, business_id, patient_id, status, storage_provider,
	storage_bucket, storage_path, thumbnail_path, integrity_status,
	uploaded_by, client_request_id, original_filename, mime_type,
	bytes, sha256, created_by
)
values
	(
		'f4000000-0000-4000-8000-000000000001', '$actor_id', '$business_id', '$patient_id',
		'uploading', 'supabase_storage', 'patient-clinical-files',
		'$business_id/$patient_id/f4000000-0000-4000-8000-000000000001/original.jpg',
		'$business_id/$patient_id/f4000000-0000-4000-8000-000000000001/thumbnail.webp',
		'unchecked', '$actor_id', 'f5000000-0000-4000-8000-000000000001',
		'pendiente-1.jpg', 'image/jpeg', 1024, repeat('a', 64), '$actor_id'
	),
	(
		'f4000000-0000-4000-8000-000000000002', '$actor_id', '$business_id', '$patient_id',
		'uploading', 'supabase_storage', 'patient-clinical-files',
		'$business_id/$patient_id/f4000000-0000-4000-8000-000000000002/original.jpg',
		'$business_id/$patient_id/f4000000-0000-4000-8000-000000000002/thumbnail.webp',
		'unchecked', '$actor_id', 'f5000000-0000-4000-8000-000000000002',
		'pendiente-2.jpg', 'image/jpeg', 1024, repeat('b', 64), '$actor_id'
	);
SQL

begin_upload_sql() {
	local request_id="$1"
	local filename="$2"
	local checksum_character="$3"
	cat <<SQL
begin;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select radiograph_id
from public.begin_patient_radiograph_upload(
	'$actor_id',
	'$business_id',
	'$patient_id',
	'$request_id',
	'$filename',
	'image/jpeg',
	1024,
	repeat('$checksum_character', 64),
	(statement_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date,
	null
);
select pg_sleep(1);
commit;
SQL
}

set +e
psql "$database_url" -v ON_ERROR_STOP=1 -q -c \
	"$(begin_upload_sql 'f5000000-0000-4000-8000-000000000003' 'concurrente-a.jpg' 'c')" \
	>"$tmpdir/a.log" 2>&1 &
pid_a=$!
psql "$database_url" -v ON_ERROR_STOP=1 -q -c \
	"$(begin_upload_sql 'f5000000-0000-4000-8000-000000000004' 'concurrente-b.jpg' 'd')" \
	>"$tmpdir/b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e

if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
	echo "Expected exactly one concurrent clinical upload to start." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

if ! cat "$tmpdir/a.log" "$tmpdir/b.log" | grep -q 'RADIOGRAPH_PENDING_LIMIT'; then
	echo "Rejected upload did not report RADIOGRAPH_PENDING_LIMIT." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

pending_count=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select count(*)
	from public.patient_radiographs
	where business_id = '$business_id'
		and uploaded_by = '$actor_id'
		and status = 'uploading';
")

if [[ "$pending_count" != '3' ]]; then
	echo "Expected exactly three pending clinical uploads, got $pending_count." >&2
	exit 1
fi

echo 'PASS: two concurrent upload starts respected the atomic maximum of three pending files.'
