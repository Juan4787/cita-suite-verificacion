-- The owner, and an active account assistance acting as an administrator of the
-- practice (user_business_role), read and save the practice's settings and its Google
-- review settings under row level security, as the settings pages do with the user's
-- own client; the review link is still checked, and the assistance loses both when the
-- grant expires. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(5);

create temporary table assistance_fixture(label text primary key, id uuid not null);
grant select on assistance_fixture to authenticated;

do $$
declare b uuid:=gen_random_uuid(); u_owner uuid:=gen_random_uuid(); u_support uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) select id,'assistance-settings-'||id||'@example.test' from unnest(array[u_owner,u_support,u_stranger]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b,'Ayuda',b::text,'other','America/Argentina/Buenos_Aires');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,u_owner,'owner','active',now());
 insert into public.account_assistance_support_users(user_id,email) values(u_support,'assistance-settings-support-'||u_support||'@example.test');
 insert into public.account_assistance_grants(business_id,requested_by_user_id,support_user_id,expires_at) values(b,u_owner,u_support,now()+interval '1 hour');
 insert into assistance_fixture values('business',b),('owner',u_owner),('support',u_support),('stranger',u_stranger);
end $$;

-- Why a review settings save was refused, printed after the checks as diagnostics.
create temporary table review_refusals(actor text, message text);

-- Whether the actor sees the practice, whether a settings save returns its row, and
-- whether it saves the review settings the way their page does (an upsert).
create function pg_temp.settings_access(p_actor text) returns text language plpgsql as $$
declare v_business uuid:=(select id from assistance_fixture where label='business'); v_reads boolean; v_saved uuid; v_review uuid; v_refusal text;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from assistance_fixture where label=p_actor),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 v_reads:=exists(select 1 from public.businesses where id=v_business);
 update public.businesses set public_booking_enabled=false where id=v_business returning id into v_saved;
 begin
  insert into public.google_review_settings(business_id, enabled, review_url)
  values(v_business, true, 'https://g.page/r/assistance-settings/review')
  on conflict (business_id) do update set enabled = excluded.enabled, review_url = excluded.review_url
  returning business_id into v_review;
 exception when insufficient_privilege then
  v_refusal:=sqlerrm;
  v_review:=null;
 end;
 execute 'reset role';
 if v_refusal is not null then insert into review_refusals values(p_actor, v_refusal); end if;
 return case when v_reads then 'reads' else 'hidden' end||' '||case when v_saved is not null then 'saves' else 'cannot save' end
  ||' '||case when v_review is not null then 'saves reviews' else 'cannot save reviews' end;
end $$;

-- Whether the actor's save of a review link outside Google is rejected by its check.
create function pg_temp.foreign_review_link(p_actor text) returns text language plpgsql as $$
declare v_business uuid:=(select id from assistance_fixture where label='business'); v_saved uuid; v_result text;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from assistance_fixture where label=p_actor),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 begin
  update public.google_review_settings set review_url='https://example.test/not-google'
  where business_id=v_business returning business_id into v_saved;
  v_result:=case when v_saved is null then 'no row' else 'saved' end;
 exception
  when check_violation then v_result:='rejected';
  when insufficient_privilege then v_result:='refused: '||sqlerrm;
 end;
 execute 'reset role';
 return v_result;
end $$;

-- 1. The owner reads and saves the practice settings and its review settings.
select extensions.is(pg_temp.settings_access('owner'), 'reads saves saves reviews',
 'the owner reads and saves its practice settings and review settings');

-- 2. The review link is still checked for the owner: a link outside Google is rejected.
select extensions.is(pg_temp.foreign_review_link('owner'), 'rejected',
 'a review link outside Google is rejected when the owner saves it');

-- 3. The active assistance reads the practice it may change and saves its settings.
select extensions.is(pg_temp.settings_access('support'), 'reads saves saves reviews',
 'an active assistance reads and saves its practice settings under its own rules');

-- 4. Someone without membership or assistance does neither.
select extensions.is(pg_temp.settings_access('stranger'), 'hidden cannot save cannot save reviews',
 'a user without membership or assistance neither reads nor saves the practice');

-- 5. Once the grant expires, the assistance does neither.
update public.account_assistance_grants set expires_at=now()-interval '1 minute', starts_at=now()-interval '2 hours'
 where business_id=(select id from assistance_fixture where label='business');
select extensions.is(pg_temp.settings_access('support'), 'hidden cannot save cannot save reviews',
 'an expired assistance neither reads nor saves the practice');

select extensions.diag(actor || ' review settings refused: ' || message) from review_refusals;

select * from extensions.finish();
rollback;
