#!/usr/bin/env bash
set -euo pipefail

# Two practices with the same name created at the same time both get the address of their name, a
# different one each (migration 20261110010000). Without the lock on the address, both would pick
# the same free one and the second would fail on the unique address.

database_url="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:55422/postgres}"
case "$database_url" in
	postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
	*)
		echo "Refusing to run concurrency test outside local PostgreSQL." >&2
		exit 2
		;;
esac

suffix="$(date +%s)$$"
name="Concurrencia enlace $suffix"
base="concurrencia-enlace-$suffix"
tmpdir=$(mktemp -d)

cleanup() {
	psql "$database_url" -v ON_ERROR_STOP=1 -qAtc \
		"delete from public.businesses where name = '$name';" >/dev/null 2>&1 || true
	rm -rf "$tmpdir"
}
trap cleanup EXIT

# Each transaction holds its new practice for a second before committing, so the other one runs
# while the first address is taken but not yet committed.
create_sql() {
	cat <<SQL
begin;
insert into public.businesses (name, slug, industry, slug_follows_name)
values ('$name', 'provisional-$1-$suffix', 'other', true);
select pg_sleep(1);
commit;
SQL
}

set +e
psql "$database_url" -v ON_ERROR_STOP=1 -q -c "$(create_sql a)" >"$tmpdir/a.log" 2>&1 &
pid_a=$!
psql "$database_url" -v ON_ERROR_STOP=1 -q -c "$(create_sql b)" >"$tmpdir/b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
status_a=$?
wait "$pid_b"
status_b=$?
set -e

if [[ "$status_a" -ne 0 || "$status_b" -ne 0 ]]; then
	echo "Expected both simultaneous practices to be created." >&2
	cat "$tmpdir/a.log" "$tmpdir/b.log" >&2
	exit 1
fi

addresses=$(psql "$database_url" -v ON_ERROR_STOP=1 -qAtc "
	select string_agg(slug, ' ' order by slug)
	from public.businesses
	where name = '$name';
")

if [[ "$addresses" != "$base $base-2" ]]; then
	echo "Expected the addresses '$base $base-2', got '$addresses'." >&2
	exit 1
fi

echo 'PASS: two simultaneous practices with the same name got different addresses of their name.'
