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

slug='e2e-public-booking-concurrency'
tmpdir=$(mktemp -d)

cleanup() {
	psql "$database_url" -v ON_ERROR_STOP=1 -qAtc \
		"delete from public.businesses where slug = '$slug';" >/dev/null 2>&1 || true
	rm -rf "$tmpdir"
}
trap cleanup EXIT

psql "$database_url" -v ON_ERROR_STOP=1 -q <<'SQL'
delete from public.businesses where slug = 'e2e-public-booking-concurrency';

insert into public.businesses (name, slug, industry, timezone)
values ('E2E concurrencia reserva publica', 'e2e-public-booking-concurrency', 'odontology', 'America/Argentina/Buenos_Aires');

insert into public.services (business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes)
select id, 'Consulta E2E concurrencia', 30, 0, 0
from public.businesses
where slug = 'e2e-public-booking-concurrency';

insert into public.professionals (business_id, name)
select id, 'Profesional E2E concurrencia'
from public.businesses
where slug = 'e2e-public-booking-concurrency';

insert into public.patients (business_id, full_name, phone_e164)
select id, 'Ana Concurrencia', '+5493510000198'
from public.businesses
where slug = 'e2e-public-booking-concurrency';

insert into public.professional_services (business_id, professional_id, service_id)
select b.id, p.id, s.id
from public.businesses b
join public.professionals p on p.business_id = b.id
join public.services s on s.business_id = b.id
where b.slug = 'e2e-public-booking-concurrency';

insert into public.appointments (
	business_id, patient_id, service_id, professional_id,
	starts_at, ends_at, blocking_starts_at, blocking_ends_at,
	status, source, service_name_snapshot, professional_name_snapshot,
	duration_minutes_snapshot
)
select
	b.id, patient.id, service.id, professional.id,
	statement_timestamp() + make_interval(days => series.day),
	statement_timestamp() + make_interval(days => series.day, mins => 30),
	statement_timestamp() + make_interval(days => series.day),
	statement_timestamp() + make_interval(days => series.day, mins => 30),
	'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
from public.businesses b
join public.patients patient on patient.business_id = b.id
join public.services service on service.business_id = b.id
join public.professionals professional on professional.business_id = b.id
cross join generate_series(1, 3) as series(day)
where b.slug = 'e2e-public-booking-concurrency'
	and patient.phone_e164 = '+5493510000198';
SQL

insert_sql() {
	local day="$1"
	cat <<SQL
begin;
insert into public.appointments (
	business_id, patient_id, service_id, professional_id,
	starts_at, ends_at, blocking_starts_at, blocking_ends_at,
	status, source, service_name_snapshot, professional_name_snapshot,
	duration_minutes_snapshot
)
select
	b.id, patient.id, service.id, professional.id,
	statement_timestamp() + interval '$day days',
	statement_timestamp() + interval '$day days 30 minutes',
	statement_timestamp() + interval '$day days',
	statement_timestamp() + interval '$day days 30 minutes',
	'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
from public.businesses b
join public.patients patient on patient.business_id = b.id
join public.services service on service.business_id = b.id
join public.professionals professional on professional.business_id = b.id
where b.slug = 'e2e-public-booking-concurrency'
	and patient.phone_e164 = '+5493510000198';
select pg_sleep(1);
commit;
SQL
}

set +e
psql "$database_url" -v ON_ERROR_STOP=1 -q -c "$(insert_sql 10)" >"$tmpdir/a.log" 2>&1 &
pid_a=$!
psql "$database_url" -v ON_ERROR_STOP=1 -q -c "$(insert_sql 11)" >"$tmpdir/b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e

if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
	echo "Expected exactly one concurrent insert to succeed." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

if ! cat "$tmpdir/a.log" "$tmpdir/b.log" | grep -q 'PUBLIC_BOOKING_ACTIVE_LIMIT'; then
	echo "Rejected insert did not report PUBLIC_BOOKING_ACTIVE_LIMIT." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

active_count=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select count(*)
	from public.appointments appointment
	join public.businesses business on business.id = appointment.business_id
	join public.patients patient
		on patient.business_id = appointment.business_id
		and patient.id = appointment.patient_id
	where business.slug = '$slug'
		and patient.phone_e164 = '+5493510000198'
		and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
		and appointment.starts_at > statement_timestamp();
")

if [[ "$active_count" != '4' ]]; then
	echo "Expected final active future count 4, got $active_count." >&2
	exit 1
fi

echo 'PASS: two simultaneous requests for the same patient_id produced exactly one success and one 4/4 rejection.'
