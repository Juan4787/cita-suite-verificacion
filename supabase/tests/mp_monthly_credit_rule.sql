-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/mp_monthly_credit_rule.sql
--
-- Regla de acreditación de los cobros automáticos de Mercado Pago (20261118010000,
-- docs/plans/cobros-mercadopago-20261118.md): un mes calendario sobre el mayor entre el
-- vencimiento y ahora más 3 días, con 10 días de gracia. Las operaciones manuales y el pago
-- registrado a mano por el panel maestro conservan 30 días fijos y 48 horas de gracia.

begin;

select extensions.plan(1);

do $$
declare
	v_now timestamptz := now();
	v_new uuid;
	v_expired uuid;
	v_near uuid;
	v_manual uuid;
	v_short uuid;
	r record;
	s business_subscriptions%rowtype;
	month_secs constant integer := 30 * 24 * 60 * 60;
	create_business constant text := 'insert into public.businesses (name, slug, industry) values ($1, $2, ''odontology'') returning id';
begin
	execute create_business into v_new using 'Prueba MP mes nuevo', 'test-mp-mes-nuevo-' || gen_random_uuid()::text;
	execute create_business into v_expired using 'Prueba MP mes vencido', 'test-mp-mes-vencido-' || gen_random_uuid()::text;
	execute create_business into v_near using 'Prueba MP mes por vencer', 'test-mp-mes-por-vencer-' || gen_random_uuid()::text;
	execute create_business into v_manual using 'Prueba MP pago manual', 'test-mp-pago-manual-' || gen_random_uuid()::text;
	execute create_business into v_short using 'Prueba MP corto', 'test-mp-corto-' || gen_random_uuid()::text;

	-- a. Primer cobro de un consultorio sin acceso: ahora + 3 días + 1 mes, gracia de 10 días.
	select * into r from public.grant_business_access(v_new, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Primer cobro.', null, null, 'test:mp-mes:a:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_new;
	if r.applied is not true or s.paid_until is distinct from v_now + interval '3 days' + interval '1 month' then
		raise exception 'TEST_A_FIRST_CHARGE_EXPECTED_NOW_PLUS_3_DAYS_PLUS_1_MONTH (got %)', s.paid_until;
	end if;
	if s.grace_until is distinct from s.paid_until + interval '10 days'
		or s.restricted_until is distinct from s.paid_until + interval '10 days' + interval '30 days' then
		raise exception 'TEST_A_GRACE_EXPECTED_10_DAYS';
	end if;
	if r.status_after is distinct from 'active' or s.access_source is distinct from 'mercado_pago' then
		raise exception 'TEST_A_EXPECTED_ACTIVE_FROM_MERCADO_PAGO';
	end if;

	-- b. Cobro siguiente con el acceso vigente: suma exactamente un mes al vencimiento, sin margen nuevo.
	select * into r from public.grant_business_access(v_new, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Segundo cobro.', null, null, 'test:mp-mes:b:' || gen_random_uuid()::text);
	if r.paid_until_after is distinct from r.paid_until_before + interval '1 month' then
		raise exception 'TEST_B_RENEWAL_EXPECTED_EXACTLY_ONE_MONTH';
	end if;

	-- c. Cobro con el acceso vencido (reintento exitoso tras la gracia): ahora + 3 días + 1 mes.
	perform public.grant_business_access(v_expired, 'grant_access', month_secs, 'month', false, null,
		'manual', 'Mes manual.', null, 'test@example.test', 'test:mp-mes:c0:' || gen_random_uuid()::text);
	update business_subscriptions set paid_until = v_now - interval '5 days', grace_until = v_now - interval '3 days',
		restricted_until = v_now + interval '27 days' where business_id = v_expired;
	select * into r from public.grant_business_access(v_expired, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Cobro tras vencer.', null, null, 'test:mp-mes:c:' || gen_random_uuid()::text);
	if r.paid_until_after is distinct from v_now + interval '3 days' + interval '1 month' or r.status_after is distinct from 'active' then
		raise exception 'TEST_C_EXPIRED_EXPECTED_NOW_PLUS_3_DAYS_PLUS_1_MONTH';
	end if;

	-- d. Acceso manual que vence en una hora: la base es ahora + 3 días, no el vencimiento.
	perform public.grant_business_access(v_near, 'grant_access', month_secs, 'month', false, null,
		'manual', 'Mes manual.', null, 'test@example.test', 'test:mp-mes:d0:' || gen_random_uuid()::text);
	update business_subscriptions set paid_until = v_now + interval '1 hour' where business_id = v_near;
	select * into r from public.grant_business_access(v_near, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Cobro cerca del vencimiento.', null, null, 'test:mp-mes:d:' || gen_random_uuid()::text);
	if r.paid_until_after is distinct from v_now + interval '3 days' + interval '1 month' then
		raise exception 'TEST_D_NEAR_EXPIRY_EXPECTED_NOW_PLUS_3_DAYS_PLUS_1_MONTH';
	end if;

	-- e. Pago registrado a mano por el panel maestro (con administrador): 30 días fijos y 48 horas.
	select * into r from public.grant_business_access(v_manual, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Pago registrado a mano.', gen_random_uuid(), 'maestro@example.test', 'test:mp-mes:e:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_manual;
	if s.paid_until is distinct from v_now + interval '30 days' or s.grace_until is distinct from s.paid_until + interval '48 hours' then
		raise exception 'TEST_E_MANUAL_PAYMENT_EXPECTED_30_DAYS_AND_48_HOURS';
	end if;

	-- f. Un mes manual sigue siendo 30 días fijos con 48 horas de gracia.
	select * into r from public.grant_business_access(v_manual, 'grant_access', month_secs, 'month', false, null,
		'manual', 'Mes manual.', null, 'test@example.test', 'test:mp-mes:f:' || gen_random_uuid()::text);
	if r.paid_until_after is distinct from r.paid_until_before + interval '30 days' then
		raise exception 'TEST_F_MANUAL_MONTH_EXPECTED_30_DAYS';
	end if;

	-- g. Un cobro automático de un día no es mensual: segundos fijos y sin gracia, como antes.
	select * into r from public.grant_business_access(v_short, 'payment_registered', 86400, 'day', false, 1,
		'mercado_pago', 'Cobro de un día.', null, null, 'test:mp-mes:g:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_short;
	if s.paid_until is distinct from v_now + interval '1 day' or s.grace_until is distinct from s.paid_until then
		raise exception 'TEST_G_SHORT_AUTOMATIC_GRANT_EXPECTED_ONE_DAY_WITHOUT_GRACE';
	end if;

	raise notice 'PASS: Mercado Pago monthly credit rule and manual semantics.';
end;
$$;

select extensions.pass('Mercado Pago monthly credit rule');
select * from extensions.finish();

rollback;
