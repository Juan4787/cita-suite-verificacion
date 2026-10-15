#!/usr/bin/env bash
set -euo pipefail

database_url="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:55422/postgres}"
case "$database_url" in
	postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
	*)
		echo "Refusing to run patient export consistency test outside local PostgreSQL." >&2
		exit 2
		;;
esac

actor_id='7a000000-0000-4000-8000-000000000001'
business_id='7b000000-0000-4000-8000-000000000001'
patient_id='7c000000-0000-4000-8000-000000000001'
request_key='7d000000-0000-4000-8000-000000000001'
slug='e2e-patient-export-consistency'

cleanup() {
	psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL >/dev/null 2>&1 || true
delete from public.businesses where id = '$business_id';
delete from auth.users where id = '$actor_id';
SQL
}
trap cleanup EXIT

cleanup

psql "$database_url" -X -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id, email)
values ('$actor_id', 'patient-export-consistency@example.test');

insert into public.businesses (id, name, slug, industry, timezone)
values (
	'$business_id',
	'Prueba consistencia exportacion',
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
values ('$business_id', '$actor_id', 'owner', 'active', statement_timestamp());

insert into public.patients (id, owner_id, business_id, full_name, dni, phone)
values (
	'$patient_id',
	'$actor_id',
	'$business_id',
	'Nombre original',
	'00112233',
	'1100112233'
);
SQL

export_id=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set role service_role;
select response ->> 'export_id'
from (
	select public.begin_patient_export(
		'$actor_id',
		'$business_id',
		'patient',
		'$patient_id',
		'$request_key'
	) as response
) started
where coalesce((response ->> 'ok')::boolean, false) = true;
SQL
)

if [[ ! "$export_id" =~ ^[0-9a-f-]{36}$ ]]; then
	echo "Patient export session did not start: $export_id" >&2
	exit 1
fi

# Dos transacciones independientes cambian y restauran el valor visible. Los
# conteos y el contenido final vuelven a coincidir, pero xmin debe impedir que
# una exportacion mezcle paginas tomadas antes y despues de esas escrituras.
psql "$database_url" -X -v ON_ERROR_STOP=1 -q -c \
	"update public.patients set full_name = 'Nombre transitorio' where id = '$patient_id';"
psql "$database_url" -X -v ON_ERROR_STOP=1 -q -c \
	"update public.patients set full_name = 'Nombre original' where id = '$patient_id';"

validation_code=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAt <<SQL
set role service_role;
select public.validate_patient_export(
	'$actor_id',
	'$export_id',
	(select expected_counts from public.patient_export_sessions where id = '$export_id')
) ->> 'error_code';
SQL
)

if [[ "$validation_code" != 'EXPORT_DATA_CHANGED' ]]; then
	echo "Expected EXPORT_DATA_CHANGED after committed update/revert, got: $validation_code" >&2
	exit 1
fi

state=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -qAtc "
	select session.status || '|' || session.failure_code || '|' || count(audit.id)
	from public.patient_export_sessions session
	left join public.audit_logs audit
		on audit.entity_id = session.id
		and audit.action = 'patient_export_failed'
		and audit.reason_code = 'data_changed'
	where session.id = '$export_id'
	group by session.status, session.failure_code;
")

if [[ "$state" != 'failed|data_changed|1' ]]; then
	echo "Expected one audited failed session after update/revert, got: $state" >&2
	exit 1
fi

echo 'PASS: a committed update and revert changed xmin and invalidated the patient export.'
