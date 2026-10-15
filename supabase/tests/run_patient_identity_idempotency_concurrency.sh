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

slug='e2e-patient-idempotency-concurrency'
owner_id='a4100000-0000-4000-8000-000000000001'
request_key='a4200000-0000-4000-8000-000000000001'
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
values ('$owner_id', 'patient-idempotency@example.test');

insert into public.businesses (name, slug, industry, timezone)
values ('E2E identidad idempotente', '$slug', 'odontology', 'UTC');

insert into public.business_users (business_id, user_id, role, status, accepted_at)
select id, '$owner_id', 'owner', 'active', statement_timestamp()
from public.businesses
where slug = '$slug';

insert into public.services (business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes)
select id, 'Consulta idempotente', 30, 0, 0
from public.businesses
where slug = '$slug';

insert into public.professionals (business_id, name)
select id, 'Profesional idempotente'
from public.businesses
where slug = '$slug';

insert into public.professional_services (business_id, professional_id, service_id)
select business.id, professional.id, service.id
from public.businesses business
join public.professionals professional on professional.business_id = business.id
join public.services service on service.business_id = business.id
where business.slug = '$slug';
SQL

run_request() {
	psql "$database_url" -v ON_ERROR_STOP=1 -qAt <<SQL
begin;
select created.id, created.patient_id, created.patient_created, created.idempotent_replay
from public.create_appointment_with_patient_identity(
	(select id from public.businesses where slug = '$slug'),
	'new',
	null,
	'Paciente Idempotente',
	'351 555 0198',
	'+5493515550198',
	null,
	false,
	'$owner_id',
	(select service.id from public.services service join public.businesses business on business.id = service.business_id where business.slug = '$slug'),
	array[(select professional.id from public.professionals professional join public.businesses business on business.id = professional.business_id where business.slug = '$slug')],
	'2099-01-15 10:00:00+00'::timestamptz,
	null,
	'$owner_id',
	false,
	'manual',
	'valid',
	false,
	'$request_key'
) created;
select pg_sleep(1);
commit;
SQL
}

set +e
run_request >"$tmpdir/a.log" 2>&1 &
pid_a=$!
run_request >"$tmpdir/b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e

if [[ "$status_a" -ne 0 || "$status_b" -ne 0 ]]; then
	echo "Both identical concurrent requests must succeed as one creation plus one replay." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

counts=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select
		count(distinct appointment.id),
		count(distinct patient.id),
		count(distinct audit.id)
	from public.businesses business
	join public.appointments appointment on appointment.business_id = business.id
	join public.patients patient
		on patient.business_id = appointment.business_id
		and patient.id = appointment.patient_id
	left join public.audit_logs audit
		on audit.business_id = appointment.business_id
		and audit.entity_id = appointment.id
		and audit.action = 'appointment.created'
	where business.slug = '$slug'
		and appointment.creation_request_key = '$request_key'
		and patient.full_name = 'Paciente Idempotente';
")

if [[ "$counts" != '1|1|1' ]]; then
	echo "Expected one appointment, one patient and one creation audit; got $counts." >&2
	exit 1
fi

echo 'PASS: two identical simultaneous creations produced one patient, one appointment and one idempotent replay.'
