-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/business_email_association_policy.sql
--
-- Transactional integration test: leaves no rows behind.

begin;

select extensions.plan(1);

do $$
declare
	v_business_a uuid;
	v_business_b uuid;
	v_business_c uuid;
	v_active_user_id uuid := gen_random_uuid();
	v_pending_user_id uuid := gen_random_uuid();
	v_error text;
begin
	insert into auth.users (id, email)
	values
		(v_active_user_id, 'active-business-email-policy@example.test'),
		(v_pending_user_id, 'pending-business-email-policy@example.test');

	insert into public.businesses (name, slug, industry)
	values ('E2E email policy A', 'e2e-email-policy-a-' || gen_random_uuid()::text, 'odontology')
	returning id into v_business_a;
	insert into public.businesses (name, slug, industry)
	values ('E2E email policy B', 'e2e-email-policy-b-' || gen_random_uuid()::text, 'odontology')
	returning id into v_business_b;
	insert into public.businesses (name, slug, industry)
	values ('E2E email policy C', 'e2e-email-policy-c-' || gen_random_uuid()::text, 'odontology')
	returning id into v_business_c;

	insert into public.business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_a, v_active_user_id, 'professional', 'active', now());

	-- An active membership blocks both a direct role and an invitation in a
	-- second consultorio, using the exact domain code consumed by the UI.
	begin
		insert into public.business_users (business_id, user_id, role, status, accepted_at)
		values (v_business_b, v_active_user_id, 'professional', 'active', now());
		raise exception 'TEST_EXPECTED_ACTIVE_MEMBERSHIP_CONFLICT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS' then
			raise exception 'TEST_WRONG_ACTIVE_MEMBERSHIP_ERROR_%', v_error;
		end if;
	end;

	begin
		insert into public.business_user_invites (business_id, email, role, status)
		values (v_business_b, 'active-business-email-policy@example.test', 'professional', 'pending');
		raise exception 'TEST_EXPECTED_ACTIVE_INVITE_CONFLICT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS' then
			raise exception 'TEST_WRONG_ACTIVE_INVITE_ERROR_%', v_error;
		end if;
	end;

	-- A pending invitation reserves the email as well. It prevents a later
	-- direct association after that person creates their Auth account.
	insert into public.business_user_invites (business_id, email, role, status)
	values (v_business_b, 'pending-business-email-policy@example.test', 'reception', 'pending');

	begin
		insert into public.business_users (business_id, user_id, role, status, accepted_at)
		values (v_business_c, v_pending_user_id, 'reception', 'active', now());
		raise exception 'TEST_EXPECTED_PENDING_MEMBERSHIP_CONFLICT';
	exception when others then
		v_error := sqlerrm;
		if v_error <> 'EMAIL_ALREADY_ASSOCIATED_WITH_OTHER_BUSINESS' then
			raise exception 'TEST_WRONG_PENDING_MEMBERSHIP_ERROR_%', v_error;
		end if;
	end;

	raise notice 'PASS: active memberships and pending invitations reserve an email for one consultorio.';
end;
$$;

select extensions.pass('business email association policy');
select * from extensions.finish();

rollback;
