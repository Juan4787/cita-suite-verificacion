-- Supabase stops granting the Data API roles on new tables and sequences of the
-- public schema of existing projects on 30 October 2026, as it already does for the
-- projects created since 30 May; existing tables keep their grants. Production and
-- staging follow the same rule from this migration on, whatever the date, and so does
-- every rebuild: what a migration creates is reachable only through the grants it
-- writes. The campaign's migrations already revoke everything and grant exactly what
-- each role needs.
begin;

alter default privileges for role postgres in schema public
 revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
 revoke all on functions from anon, authenticated, service_role;

-- The public anon key, which the browser holds for Realtime and Auth, reaches data
-- only through the server and the SECURITY DEFINER functions granted to it. No table,
-- view or sequence was ever granted to it on purpose: production still holds the
-- automatic grants of its creation, protected only by row level security.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- TRUNCATE reached the service role only through those automatic grants. Nothing
-- uses it, the Data API cannot issue it, and a rebuilt project never had it.
revoke truncate on all tables in schema public from service_role;

commit;
