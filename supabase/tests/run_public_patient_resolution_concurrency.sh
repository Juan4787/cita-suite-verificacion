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

slug='e2e-public-patient-resolution-concurrency'
owner_id='a4300000-0000-4000-8000-000000000001'
tmpdir=$(mktemp -d)

cleanup() {
	psql "$database_url" -v ON_ERROR_STOP=1 -qAt <<SQL >/dev/null 2>&1 || true
delete from public.businesses where slug = '$slug';
delete from auth.users where id = '$owner_id';
SQL
	rm -r -- "$tmpdir"
}
trap cleanup EXIT

psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL
delete from public.businesses where slug = '$slug';
delete from auth.users where id = '$owner_id';

insert into auth.users (id, email)
values ('$owner_id', 'public-patient-resolution@example.test');

insert into public.businesses (name, slug, industry, timezone)
values ('E2E resolución pública', '$slug', 'odontology', 'UTC');

insert into public.business_users (business_id, user_id, role, status, accepted_at)
select id, '$owner_id', 'owner', 'active', statement_timestamp()
from public.businesses
where slug = '$slug';

insert into public.services (business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes)
select id, 'Consulta pública concurrente', 30, 0, 0
from public.businesses
where slug = '$slug';

insert into public.professionals (business_id, name)
select id, 'Profesional público concurrente'
from public.businesses
where slug = '$slug';

insert into public.professional_services (business_id, professional_id, service_id)
select business.id, professional.id, service.id
from public.businesses business
join public.professionals professional on professional.business_id = business.id
join public.services service on service.business_id = business.id
where business.slug = '$slug';
SQL

run_public_request() {
	local request_key="$1"
	local patient_name="$2"
	local phone_raw="$3"
	local phone_e164="$4"
	local starts_at="$5"
	psql "$database_url" -v ON_ERROR_STOP=1 -qAt <<SQL
begin;
select created.id, created.patient_id, created.patient_created, created.patient_resolution_strategy
from public.create_appointment_with_patient_identity(
	(select id from public.businesses where slug = '$slug'),
	'public',
	null,
	'$patient_name',
	'$phone_raw',
	'$phone_e164',
	null,
	false,
	null,
	(select service.id from public.services service join public.businesses business on business.id = service.business_id where business.slug = '$slug'),
	array[(select professional.id from public.professionals professional join public.businesses business on business.id = professional.business_id where business.slug = '$slug')],
	'$starts_at'::timestamptz,
	null,
	null,
	false,
	'public_booking',
	'valid',
	false,
	'$request_key'
) created;
select pg_sleep(1);
commit;
SQL
}

run_pair() {
	local prefix="$1"
	shift
	set +e
	run_public_request "$1" "$2" "$3" "$4" "$5" >"$tmpdir/${prefix}-a.log" 2>&1 &
	local pid_a=$!
	run_public_request "$6" "$7" "$8" "$9" "${10}" >"$tmpdir/${prefix}-b.log" 2>&1 &
	local pid_b=$!
	wait "$pid_a"
	local status_a=$?
	wait "$pid_b"
	local status_b=$?
	set -e
	if [[ "$status_a" -ne 0 || "$status_b" -ne 0 ]]; then
		echo "Both concurrent public requests must succeed for phase $prefix." >&2
		cat "$tmpdir/${prefix}-a.log" "$tmpdir/${prefix}-b.log" >&2
		exit 1
	fi
}

run_pair same-contact \
	'a4400000-0000-4000-8000-000000000001' 'Ana Concurrente' '351 555 0600' '+5493515550600' '2099-02-10 10:00:00+00' \
	'a4400000-0000-4000-8000-000000000002' 'Ana Concurrente' '351 555 0600' '+5493515550600' '2099-02-10 11:00:00+00'

same_contact_counts=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select
		count(distinct patient.id),
		count(distinct appointment.id),
		count(distinct appointment.patient_resolution_strategy)
	from public.businesses business
	join public.patients patient on patient.business_id = business.id
	join public.appointments appointment
		on appointment.business_id = patient.business_id
		and appointment.patient_id = patient.id
	where business.slug = '$slug'
		and patient.phone_e164 = '+5493515550600'
		and public.normalized_patient_name(patient.full_name) = public.normalized_patient_name('Ana Concurrente');
")

if [[ "$same_contact_counts" != '1|2|2' ]]; then
	echo "Expected one patient, two appointments and new/exact strategies; got $same_contact_counts." >&2
	exit 1
fi

run_pair shared-phone \
	'a4400000-0000-4000-8000-000000000003' 'Juan Concurrente' '351 555 0700' '+5493515550700' '2099-02-11 10:00:00+00' \
	'a4400000-0000-4000-8000-000000000004' 'Carlos Concurrente' '351 555 0700' '+5493515550700' '2099-02-11 11:00:00+00'

shared_phone_counts=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select count(distinct patient.id), count(distinct appointment.id)
	from public.businesses business
	join public.patients patient on patient.business_id = business.id
	join public.appointments appointment
		on appointment.business_id = patient.business_id
		and appointment.patient_id = patient.id
	where business.slug = '$slug'
		and patient.phone_e164 = '+5493515550700';
")

if [[ "$shared_phone_counts" != '2|2' ]]; then
	echo "Expected two patients and two appointments for a shared phone; got $shared_phone_counts." >&2
	exit 1
fi

echo 'PASS: concurrent public resolution reuses one exact contact and separates different names sharing a phone.'
