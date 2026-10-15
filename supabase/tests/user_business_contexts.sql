-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/user_business_contexts.sql
-- Transactional regression test: leaves no rows behind.

begin;

select extensions.plan(1);

do $$
declare
	v_owner uuid := gen_random_uuid();
	v_support uuid := gen_random_uuid();
	v_outsider uuid := gen_random_uuid();
	v_direct_business uuid;
	v_assisted_business uuid;
	v_hidden_business uuid;
	v_count integer;
	v_role text;
	v_assistance jsonb;
	v_subscription jsonb;
begin
	insert into auth.users (id, email)
	values
		(v_owner, 'context-owner@example.test'),
		(v_support, 'context-support@example.test'),
		(v_outsider, 'context-outsider@example.test');

	insert into public.account_assistance_support_users (user_id, email, enabled)
	values (v_support, 'context-support@example.test', true);

	insert into public.businesses (name, slug, industry)
	values ('Context direct', 'context-direct-' || gen_random_uuid()::text, 'odontology')
	returning id into v_direct_business;
	insert into public.businesses (name, slug, industry)
	values ('Context assisted', 'context-assisted-' || gen_random_uuid()::text, 'odontology')
	returning id into v_assisted_business;
	insert into public.businesses (name, slug, industry)
	values ('Context hidden', 'context-hidden-' || gen_random_uuid()::text, 'odontology')
	returning id into v_hidden_business;

	update public.business_subscriptions
	set commercial_access_enabled = true,
		is_permanent = true,
		subscription_status = 'active',
		paid_until = null,
		grace_until = null,
		restricted_until = null,
		archived_at = null
	where business_id in (v_direct_business, v_assisted_business, v_hidden_business);

	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values
		(v_direct_business, v_owner, 'owner', 'active', now()),
		(v_assisted_business, v_outsider, 'owner', 'active', now());

	insert into public.account_assistance_grants (
		business_id, requested_by_user_id, support_user_id, status, starts_at, expires_at
	)
	values (
		v_assisted_business, v_outsider, v_support, 'active', now(), now() + interval '1 hour'
	);

	perform set_config('request.jwt.claim.sub', v_owner::text, true);
	select count(*)::integer, min(context.role), min(context.subscription::text)::jsonb
	into v_count, v_role, v_subscription
	from public.list_user_business_contexts() context;
	if v_count <> 1 or v_role <> 'owner' or v_subscription is null then
		raise exception 'TEST_DIRECT_CONTEXT_FAILED count=% role=% subscription=%', v_count, v_role, v_subscription;
	end if;

	perform set_config('request.jwt.claim.sub', v_support::text, true);
	select count(*)::integer, min(context.role), min(context.assistance::text)::jsonb
	into v_count, v_role, v_assistance
	from public.list_user_business_contexts() context;
	if v_count <> 1 or v_role <> 'admin' or v_assistance->>'supportUserId' <> v_support::text then
		raise exception 'TEST_ASSISTED_CONTEXT_FAILED count=% role=% assistance=%', v_count, v_role, v_assistance;
	end if;

	perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
	select count(*)::integer into v_count from public.list_user_business_contexts();
	if v_count <> 0 then
		raise exception 'TEST_CONTEXT_LEAKED_TO_OUTSIDER count=%', v_count;
	end if;

	raise notice 'PASS: direct, assisted and isolated business contexts are correct.';
end;
$$;

select extensions.pass('user business contexts contract');
select * from extensions.finish();

rollback;
