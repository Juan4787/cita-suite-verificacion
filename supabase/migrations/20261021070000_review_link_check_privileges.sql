-- A check constraint runs with the privileges of whoever writes the row. The checks on
-- the Google review link (20260824023000) call private.is_google_review_url, which only
-- the owner of the function could execute: neither the owner of a practice nor an
-- account assistance nor the backend could ever save the review settings, and
-- production holds no row (.verification/expression-privileges-production-20261021.json).
-- The function is an immutable validator that reads nothing, so the roles that may write
-- these tables may evaluate it. It stays in the private schema, outside the Data API.
begin;
grant execute on function private.is_google_review_url(text) to authenticated, service_role;
commit;
