-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/manual_access_then_mp_payment.sql
--
-- Transactional integration test: verifies that the first Mercado Pago charge
-- preserves a future manual grant and appends 30 days exactly once.

begin;

select extensions.plan(1);

do $$
declare
	v_business_id uuid;
	v_manual record;
	v_payment record;
	v_duplicate record;
	v_manual_key text := 'test:manual:' || gen_random_uuid()::text;
	v_payment_key text := 'test:mp:' || gen_random_uuid()::text;
begin
	insert into public.businesses (name, slug, industry)
	values ('Test crédito manual y MP', 'test-manual-mp-' || gen_random_uuid()::text, 'odontology')
	returning id into v_business_id;

	select * into v_manual
	from public.grant_business_access(
		v_business_id,
		'grant_access',
		30 * 24 * 60 * 60,
		'month',
		false,
		null,
		'manual',
		'Un mes manual de prueba.',
		null,
		'test@example.test',
		v_manual_key
	);

	select * into v_payment
	from public.grant_business_access(
		v_business_id,
		'payment_registered',
		30 * 24 * 60 * 60,
		'month',
		false,
		50000,
		'mercado_pago',
		'Pago de prueba.',
		null,
		null,
		v_payment_key
	);

	if v_manual.applied is not true or v_payment.applied is not true then
		raise exception 'TEST_EXPECTED_BOTH_GRANTS_APPLIED';
	end if;
	if v_payment.paid_until_before is distinct from v_manual.paid_until_after then
		raise exception 'TEST_MANUAL_EXPIRATION_WAS_NOT_PRESERVED';
	end if;
	if v_payment.paid_until_after is distinct from v_manual.paid_until_after + interval '30 days' then
		raise exception 'TEST_MP_PAYMENT_DID_NOT_APPEND_EXACTLY_30_DAYS';
	end if;

	select * into v_duplicate
	from public.grant_business_access(
		v_business_id,
		'payment_registered',
		30 * 24 * 60 * 60,
		'month',
		false,
		50000,
		'mercado_pago',
		'Pago de prueba repetido.',
		null,
		null,
		v_payment_key
	);

	if v_duplicate.applied is not false then
		raise exception 'TEST_DUPLICATE_PAYMENT_WAS_APPLIED_TWICE';
	end if;
	if v_duplicate.paid_until_after is distinct from v_payment.paid_until_after then
		raise exception 'TEST_DUPLICATE_PAYMENT_CHANGED_EXPIRATION';
	end if;

	raise notice 'PASS: manual month is preserved and one approved MP payment appends exactly 30 days once.';
end;
$$;

select extensions.pass('manual access and Mercado Pago payment contract');
select * from extensions.finish();

rollback;
