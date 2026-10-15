-- Impide que /r/{token} pueda transformarse en un redireccionador abierto.
-- Se admiten los formatos de reseña y enlaces cortos que entrega Google.

begin;

create or replace function private.is_google_review_url(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
	select
		char_length(trim(value)) between 1 and 2048
		and (
			trim(value) ~* '^https://g\.page/r/[A-Za-z0-9_-]+/review/?(?:\?[^#[:space:]]*)?$'
			or trim(value) ~* '^https://maps\.app\.goo\.gl/[A-Za-z0-9_-]+/?(?:\?[^#[:space:]]*)?$'
			or trim(value) ~* '^https://goo\.gl/maps/[A-Za-z0-9_-]+/?(?:\?[^#[:space:]]*)?$'
			or trim(value) ~* '^https://(?:www\.)?(?:maps\.|search\.)?google\.(?:com|com\.[A-Za-z]{2}|[A-Za-z]{2,3})/(?:local/writereview/?|maps(?:/[^?#[:space:]]*)?)(?:\?[^#[:space:]]*)?$'
		);
$$;

revoke all on function private.is_google_review_url(text)
	from public, anon, authenticated;

alter table public.google_review_settings
	drop constraint if exists google_review_settings_review_url_check;
alter table public.google_review_settings
	add constraint google_review_settings_review_url_check
	check (review_url is null or private.is_google_review_url(review_url));

alter table public.google_review_requests
	drop constraint if exists google_review_requests_review_url_snapshot_check;
alter table public.google_review_requests
	add constraint google_review_requests_review_url_snapshot_check
	check (
		review_url_snapshot is null
		or private.is_google_review_url(review_url_snapshot)
	);

commit;
