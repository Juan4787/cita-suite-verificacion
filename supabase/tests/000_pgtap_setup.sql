-- Supabase CLI delegates `supabase test db` to pg_prove. Keep pgTAP out of
-- production migrations while making the local SQL contract suite executable
-- through the official runner after every clean database reset.

create extension if not exists pgtap with schema extensions;

select extensions.plan(1);
select extensions.pass('pgTAP test harness is available');
select * from extensions.finish();
