-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/role_access_audit.sql
--
-- Transactional regression test: role mutations complete and write their
-- security audit instead of rolling back on a missing helper.

begin;

select extensions.plan(1);

do $$
declare
	v_business_id uuid;
	v_owner_id uuid := gen_random_uuid();
	v_member_id uuid := gen_random_uuid();
	v_access_id uuid;
	v_count integer;
begin
	insert into auth.users (id, email)
	values
		(v_owner_id, 'role-audit-owner@example.test'),
		(v_member_id, 'role-audit-member@example.test');

	insert into public.businesses (name, slug, industry)
	values ('E2E auditoria de roles', 'e2e-role-audit-' || gen_random_uuid()::text, 'odontology')
	returning id into v_business_id;

	insert into public.business_subscriptions (
		business_id,
		commercial_access_enabled,
		is_permanent,
		subscription_status
	)
	values (v_business_id, true, true, 'active')
	on conflict (business_id) do update
	set commercial_access_enabled = true,
		is_permanent = true,
		subscription_status = 'active',
		access_starts_at = now(),
		paid_until = null,
		grace_until = null,
		restricted_until = null,
		archived_at = null;

	insert into public.business_users (
		business_id, user_id, role, status, accepted_at
	)
	values (v_business_id, v_owner_id, 'owner', 'active', now());

	insert into public.business_users (
		business_id, user_id, role, status, accepted_at
	)
	values (v_business_id, v_member_id, 'admin', 'active', now())
	returning id into v_access_id;

	perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

	perform public.update_business_role_access(v_access_id, 'reception');
	if not exists (
		select 1 from public.business_users
		where id = v_access_id and role = 'reception' and status = 'active'
	) then
		raise exception 'TEST_ROLE_UPDATE_DID_NOT_COMMIT';
	end if;

	perform public.remove_business_role_access(v_access_id);
	if not exists (
		select 1 from public.business_users
		where id = v_access_id and status = 'disabled'
	) then
		raise exception 'TEST_ROLE_REMOVAL_DID_NOT_COMMIT';
	end if;

	select count(*)::integer
	into v_count
	from public.audit_logs
	where business_id = v_business_id
		and user_id = v_owner_id
		and entity_id = v_access_id
		and action in ('business_user.role_changed', 'business_user.removed')
		and result = 'success';
	if v_count <> 2 then
		raise exception 'TEST_EXPECTED_2_ROLE_AUDITS_GOT_%', v_count;
	end if;

	raise notice 'PASS: role update and removal complete and each writes a security audit event.';
end;
$$;

select extensions.pass('role access audit contract');
select * from extensions.finish();

rollback;
