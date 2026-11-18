-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/mp_provisional_access_and_price.sql
--
-- Acceso provisorio y precio fijo por consultorio (20261118020000, docs/plans/cobros-mercadopago-20261118.md):
-- - «provisional_access» es sólo automático, de un día como máximo, no suma y no se asienta si no daría nada;
-- - no se encadena: otro provisorio exige un cobro automático acreditado después del anterior;
-- - el primer cobro automático mensual fija mp_price_ars, y un precio ya cargado no cambia.
-- Todo es sintético y se revierte.

begin;

select extensions.plan(1);

do $$
declare
	v_now timestamptz := now();
	v_new uuid;
	v_chain uuid;
	v_paused uuid;
	v_archived uuid;
	v_permanent uuid;
	v_preset uuid;
	v_manual uuid;
	-- El panel maestro pasa un administrador real: business_subscriptions.updated_by tiene clave foránea a auth.users.
	v_admin uuid := gen_random_uuid();
	r record;
	s business_subscriptions%rowtype;
	v_count integer;
	v_raised boolean;
	month_secs constant integer := 30 * 24 * 60 * 60;
	create_business constant text := 'insert into public.businesses (name, slug, industry) values ($1, $2, ''odontology'') returning id';
begin
	insert into auth.users (id, email) values (v_admin, 'mp-provisorio-maestro-' || v_admin || '@example.test');
	execute create_business into v_new using 'Prueba provisorio nuevo', 'test-mp-provisorio-nuevo-' || gen_random_uuid()::text;
	execute create_business into v_chain using 'Prueba provisorio cadena', 'test-mp-provisorio-cadena-' || gen_random_uuid()::text;
	execute create_business into v_paused using 'Prueba provisorio pausado', 'test-mp-provisorio-pausado-' || gen_random_uuid()::text;
	execute create_business into v_archived using 'Prueba provisorio archivado', 'test-mp-provisorio-archivado-' || gen_random_uuid()::text;
	execute create_business into v_permanent using 'Prueba provisorio permanente', 'test-mp-provisorio-permanente-' || gen_random_uuid()::text;
	execute create_business into v_preset using 'Prueba precio cargado', 'test-mp-precio-cargado-' || gen_random_uuid()::text;
	execute create_business into v_manual using 'Prueba precio manual', 'test-mp-precio-manual-' || gen_random_uuid()::text;

	-- a. Consultorio que nunca pagó: un día exacto, sin gracia, activo, sin tocar el último pago ni la nota.
	select * into r from public.grant_business_access(v_new, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-a');
	select * into s from business_subscriptions where business_id = v_new;
	if r.applied is not true or r.status_after is distinct from 'active'
		or s.paid_until is distinct from v_now + make_interval(secs => 86400) or s.grace_until is distinct from s.paid_until then
		raise exception 'TEST_A_PROVISIONAL_EXPECTED_ONE_DAY_WITHOUT_GRACE (got % / %)', s.paid_until, s.grace_until;
	end if;
	if s.last_payment_at is not null or s.access_source is distinct from 'mercado_pago'
		or s.access_note is distinct from 'Cuenta pendiente de activación de suscripción.' or s.mp_price_ars is not null then
		raise exception 'TEST_A_PROVISIONAL_MUST_NOT_LOOK_LIKE_A_PAYMENT';
	end if;

	-- b. La misma clave no se repite.
	select * into r from public.grant_business_access(v_new, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-a');
	select count(*) into v_count from access_grants where business_id = v_new and operation = 'provisional_access';
	if r.applied is not false or v_count <> 1 then
		raise exception 'TEST_B_SAME_KEY_EXPECTED_ONE_GRANT (got %)', v_count;
	end if;

	-- c. Otra suscripción sin un cobro en el medio: no se asienta nada.
	update business_subscriptions set paid_until = v_now - interval '1 hour', grace_until = v_now - interval '1 hour' where business_id = v_new;
	select * into r from public.grant_business_access(v_new, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-c');
	select count(*) into v_count from access_grants where business_id = v_new and operation = 'provisional_access';
	if r.applied is not false or r.grant_id is not null or v_count <> 1 then
		raise exception 'TEST_C_CHAINED_PROVISIONAL_EXPECTED_NO_GRANT (got %)', v_count;
	end if;
	if r.status_after is distinct from public.compute_business_subscription_status(true, false, v_now - interval '1 hour', v_now - interval '1 hour', s.restricted_until, null) then
		raise exception 'TEST_C_NO_OP_EXPECTED_CURRENT_STATUS (got %)', r.status_after;
	end if;

	-- d. El primer cobro automático no se acumula con el provisorio y fija el precio del consultorio.
	update business_subscriptions set paid_until = v_now + make_interval(secs => 86400), grace_until = v_now + make_interval(secs => 86400) where business_id = v_new;
	select * into r from public.grant_business_access(v_new, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Primer cobro.', null, null, 'test:mp-provisorio:d:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_new;
	if s.paid_until is distinct from v_now + interval '3 days' + interval '1 month' or s.mp_price_ars is distinct from 90000 then
		raise exception 'TEST_D_FIRST_CHARGE_EXPECTED_NO_STACKING_AND_LOCKED_PRICE (got % / %)', s.paid_until, s.mp_price_ars;
	end if;

	-- e. Un cobro posterior con otro monto no cambia el precio fijado.
	perform public.grant_business_access(v_new, 'payment_registered', month_secs, 'month', false, 120000,
		'mercado_pago', 'Segundo cobro.', null, null, 'test:mp-provisorio:e:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_new;
	if s.mp_price_ars is distinct from 90000 then
		raise exception 'TEST_E_LOCKED_PRICE_EXPECTED_TO_STAY (got %)', s.mp_price_ars;
	end if;

	-- f. Con acceso que ya cubre el día, un provisorio no se asienta.
	select * into r from public.grant_business_access(v_new, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-f');
	select count(*) into v_count from access_grants where business_id = v_new and operation = 'provisional_access';
	if r.applied is not false or v_count <> 1 then
		raise exception 'TEST_F_COVERED_ACCESS_EXPECTED_NO_GRANT';
	end if;

	-- g. Tras un ciclo pagado, otro provisorio vale una vez más, y no dos.
	--    Las filas de una transacción comparten la hora: el primer provisorio se fecha en el pasado.
	perform public.grant_business_access(v_chain, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-g1');
	alter table public.access_grants disable trigger user;
	update public.access_grants set created_at = v_now - interval '40 days' where idempotency_key = 'mp:provisional:test-g1';
	alter table public.access_grants enable trigger user;
	perform public.grant_business_access(v_chain, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Cobro del ciclo anterior.', null, null, 'test:mp-provisorio:g:' || gen_random_uuid()::text);
	update business_subscriptions set paid_until = v_now - interval '1 hour', grace_until = v_now - interval '1 hour' where business_id = v_chain;
	select * into r from public.grant_business_access(v_chain, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-g2');
	if r.applied is not true then
		raise exception 'TEST_G_PROVISIONAL_AFTER_PAID_CYCLE_EXPECTED';
	end if;
	update business_subscriptions set paid_until = v_now - interval '1 hour', grace_until = v_now - interval '1 hour' where business_id = v_chain;
	select * into r from public.grant_business_access(v_chain, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-g3');
	if r.applied is not false then
		raise exception 'TEST_G_SECOND_UNPAID_PROVISIONAL_EXPECTED_NO_GRANT';
	end if;

	-- h. Pausado o archivado por el administrador, o permanente: nada que dar.
	update business_subscriptions set commercial_access_enabled = false where business_id = v_paused;
	select * into r from public.grant_business_access(v_paused, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-h1');
	if r.applied is not false then raise exception 'TEST_H_PAUSED_EXPECTED_NO_GRANT'; end if;
	update business_subscriptions set archived_at = v_now where business_id = v_archived;
	select * into r from public.grant_business_access(v_archived, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-h2');
	if r.applied is not false then raise exception 'TEST_H_ARCHIVED_EXPECTED_NO_GRANT'; end if;
	update business_subscriptions set is_permanent = true, paid_until = null, grace_until = null, restricted_until = null where business_id = v_permanent;
	select * into r from public.grant_business_access(v_permanent, 'provisional_access', 86400, 'day', false, null,
		'mercado_pago', 'Acceso provisorio de prueba.', null, null, 'mp:provisional:test-h3');
	if r.applied is not false then raise exception 'TEST_H_PERMANENT_EXPECTED_NO_GRANT'; end if;
	select count(*) into v_count from access_grants where business_id in (v_paused, v_archived, v_permanent) and operation = 'provisional_access';
	if v_count <> 0 then raise exception 'TEST_H_EXPECTED_NO_ROWS (got %)', v_count; end if;

	-- i. Nunca manual, nunca de otra fuente, nunca más de un día.
	v_raised := false;
	begin
		perform public.grant_business_access(v_manual, 'provisional_access', 86400, 'day', false, null,
			'mercado_pago', 'Provisorio manual.', v_admin, 'maestro@example.test', 'mp:provisional:test-i1');
	exception when others then v_raised := true;
	end;
	if not v_raised then raise exception 'TEST_I_MANUAL_PROVISIONAL_EXPECTED_ERROR'; end if;
	v_raised := false;
	begin
		perform public.grant_business_access(v_manual, 'provisional_access', 86400, 'day', false, null,
			'manual', 'Provisorio de otra fuente.', null, null, 'mp:provisional:test-i2');
	exception when others then v_raised := true;
	end;
	if not v_raised then raise exception 'TEST_I_OTHER_SOURCE_EXPECTED_ERROR'; end if;
	v_raised := false;
	begin
		perform public.grant_business_access(v_manual, 'provisional_access', 86401, 'day', false, null,
			'mercado_pago', 'Provisorio largo.', null, null, 'mp:provisional:test-i3');
	exception when others then v_raised := true;
	end;
	if not v_raised then raise exception 'TEST_I_LONG_PROVISIONAL_EXPECTED_ERROR'; end if;

	-- j. Un precio cargado antes (prueba a precio simbólico) no lo cambia el primer cobro.
	update business_subscriptions set mp_price_ars = 100 where business_id = v_preset;
	perform public.grant_business_access(v_preset, 'payment_registered', month_secs, 'month', false, 100,
		'mercado_pago', 'Cobro simbólico.', null, null, 'test:mp-precio:j:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_preset;
	if s.mp_price_ars is distinct from 100 then raise exception 'TEST_J_PRESET_PRICE_EXPECTED_TO_STAY (got %)', s.mp_price_ars; end if;

	-- k. Un pago registrado a mano por el panel maestro no fija precio.
	perform public.grant_business_access(v_manual, 'payment_registered', month_secs, 'month', false, 90000,
		'mercado_pago', 'Pago registrado a mano.', v_admin, 'maestro@example.test', 'test:mp-precio:k:' || gen_random_uuid()::text);
	select * into s from business_subscriptions where business_id = v_manual;
	if s.mp_price_ars is not null then raise exception 'TEST_K_MANUAL_PAYMENT_MUST_NOT_LOCK_PRICE'; end if;

	-- l. El precio no admite cero ni negativos.
	v_raised := false;
	begin
		update business_subscriptions set mp_price_ars = 0 where business_id = v_manual;
	exception when check_violation then v_raised := true;
	end;
	if not v_raised then raise exception 'TEST_L_ZERO_PRICE_EXPECTED_CHECK_VIOLATION'; end if;

	raise notice 'PASS: Mercado Pago provisional access and locked price.';
end;
$$;

select extensions.pass('Mercado Pago provisional access and locked price');
select * from extensions.finish();

rollback;
