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

suffix="$(date +%s)-$$"
slug_a="e2e-email-association-a-$suffix"
slug_b="e2e-email-association-b-$suffix"
email="e2e-email-association-$suffix@example.test"
tmpdir=$(mktemp -d)

cleanup() {
	psql "$database_url" -v ON_ERROR_STOP=1 -qAtc \
		"delete from public.businesses where slug in ('$slug_a', '$slug_b');" >/dev/null 2>&1 || true
	rm -rf "$tmpdir"
}
trap cleanup EXIT

psql "$database_url" -v ON_ERROR_STOP=1 -q <<SQL
insert into public.businesses (name, slug, industry)
values
	('E2E concurrencia email A', '$slug_a', 'odontology'),
	('E2E concurrencia email B', '$slug_b', 'odontology');
SQL

invite_sql() {
	local slug="$1"
	cat <<SQL
begin;
insert into public.business_user_invites (business_id, email, role, status)
select id, '$email', 'reception', 'pending'
from public.businesses
where slug = '$slug';
select pg_sleep(1);
commit;
SQL
}

set +e
psql "$database_url" -v ON_ERROR_STOP=1 -q -c "$(invite_sql "$slug_a")" >"$tmpdir/a.log" 2>&1 &
pid_a=$!
psql "$database_url" -v ON_ERROR_STOP=1 -q -c "$(invite_sql "$slug_b")" >"$tmpdir/b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e

if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
	echo "Expected exactly one concurrent invitation to succeed." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

if ! cat "$tmpdir/a.log" "$tmpdir/b.log" | grep -q 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS'; then
	echo "Rejected invitation did not report the email association rule." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

pending_count=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select count(*)
	from public.business_user_invites invite
	join public.businesses business on business.id = invite.business_id
	where business.slug in ('$slug_a', '$slug_b')
		and invite.email = '$email'
		and invite.status = 'pending';
")

if [[ "$pending_count" != '1' ]]; then
	echo "Expected exactly one pending invitation, got $pending_count." >&2
	exit 1
fi

echo 'PASS: two simultaneous invitations for one email produced exactly one association.'
