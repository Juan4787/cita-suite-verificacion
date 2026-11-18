-- Acceso provisorio y precio fijo por consultorio (docs/plans/cobros-mercadopago-20261118.md,
-- decisiones de Juan del 18 de noviembre de 2026).
--
-- 1. Operación nueva «provisional_access» en el historial de accesos.
-- 2. business_subscriptions.mp_price_ars: el precio de Mercado Pago de cada consultorio. Lo fija el
--    primer cobro automático mensual y se conserva para siempre, también si el consultorio cancela y
--    vuelve a suscribirse: quien contrató a un precio lo conserva y un precio nuevo es sólo para quien
--    nunca contrató. El operador puede cargarlo antes, por ejemplo un precio simbólico para una prueba.
-- 3. grant_business_access v6:
--    - «provisional_access», sólo automático (Mercado Pago, sin administrador) y de un día como máximo:
--      lleva el vencimiento a ahora más la duración, sin gracia, mientras se procesa el primer cobro.
--      No se asienta si no daría nada: consultorio permanente, pausado o archivado, acceso que ya cubre
--      el período, o un provisorio anterior sin un cobro automático acreditado después;
--    - el primer cobro automático mensual fija mp_price_ars si estaba vacío.
--    El resto de las operaciones conserva exactamente su semántica de 20261118010000.

begin;

-- 1. Operación nueva.
alter table public.access_grants drop constraint access_grants_operation_check;
alter table public.access_grants add constraint access_grants_operation_check check (
	operation in (
		'grant_access',
		'extend_access',
		'reduce_access',
		'set_permanent',
		'unset_permanent',
		'disable_business_access',
		'enable_business_access',
		'archive_business',
		'reactivate_business',
		'manual_correction',
		'payment_registered',
		'payment_cancelled',
		'sessions_revoked',
		'provisional_access'
	)
);

-- 2. Precio propio de cada consultorio.
alter table public.business_subscriptions
	add column mp_price_ars numeric(12, 2) check (mp_price_ars is null or mp_price_ars > 0);

comment on column public.business_subscriptions.mp_price_ars is
	'Precio mensual de Mercado Pago del consultorio. Lo fija el primer cobro automático y se conserva aunque cambie el precio general (decisión del 18-nov-2026). Vacío: rige el precio general.';

-- 3. grant_business_access v6.
create or replace function public.grant_business_access(
	p_business_id uuid,
	p_operation text,
	p_duration_seconds integer,
	p_duration_unit text,
	p_is_permanent boolean,
	p_amount numeric,
	p_source text,
	p_note text,
	p_admin_id uuid,
	p_admin_email text,
	p_idempotency_key text
)
returns table (
	applied boolean,
	grant_id uuid,
	paid_until_before timestamptz,
	paid_until_after timestamptz,
	status_after text
)
language plpgsql
security definer
-- pg_temp al final, explícito: es la ruta que 20261016012000 dejó en toda función privilegiada y que
-- exige supabase/tests/security_definer_resolution.sql. Un create or replace con sólo «public» la perdería.
set search_path = public, pg_temp
as $$
declare
	v_now timestamptz := now();
	v_sub business_subscriptions%rowtype;
	v_new_paid_until timestamptz;
	v_new_grace_until timestamptz;
	v_new_restricted_until timestamptz;
	v_new_archived_at timestamptz;
	v_new_is_permanent boolean;
	v_new_enabled boolean;
	v_new_status text;
	v_grant_id uuid;
	v_existing access_grants%rowtype;
	v_source text := coalesce(nullif(trim(p_source), ''), 'manual');
	v_note text := nullif(trim(coalesce(p_note, '')), '');
	v_duration_seconds integer := p_duration_seconds;
	v_insert_is_permanent boolean := coalesce(p_is_permanent, false) or p_operation = 'set_permanent';
	v_has_post_paid_grace boolean;
	-- Automático = cobro sin humano presente (webhook, retorno, conciliación).
	-- El panel maestro siempre manda p_admin_id, así que sus operaciones
	-- conservan la semántica manual aunque el source sea mercado_pago.
	v_is_mp_auto boolean := v_source = 'mercado_pago'
		and p_operation = 'payment_registered'
		and p_admin_id is null;
	-- El cobro mensual de una suscripción: un mes calendario por cobro.
	v_is_mp_monthly boolean := v_source = 'mercado_pago'
		and p_operation = 'payment_registered'
		and p_admin_id is null
		and p_duration_unit = 'month';
	-- Acceso provisorio (20261118020000): sólo automático, mientras Mercado Pago procesa el primer cobro.
	v_is_provisional boolean := p_operation = 'provisional_access';
begin
	if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
		raise exception 'idempotency_key is required';
	end if;

	if p_operation not in (
		'grant_access',
		'extend_access',
		'reduce_access',
		'set_permanent',
		'unset_permanent',
		'disable_business_access',
		'enable_business_access',
		'archive_business',
		'reactivate_business',
		'manual_correction',
		'payment_registered',
		'payment_cancelled',
		'provisional_access'
	) then
		raise exception 'invalid operation';
	end if;

	if v_source not in ('manual','mercado_pago','promo','internal') then
		raise exception 'invalid source';
	end if;

	if v_is_provisional then
		if v_source <> 'mercado_pago' or p_admin_id is not null then
			raise exception 'provisional access is only granted automatically by Mercado Pago';
		end if;
		if coalesce(v_duration_seconds, 0) <= 0 or v_duration_seconds > 86400 then
			raise exception 'provisional access lasts at most one day';
		end if;
	end if;

	insert into business_subscriptions (
		business_id,
		commercial_access_enabled,
		is_permanent,
		subscription_status,
		access_note,
		expiration_notice_enabled
	)
	values (
		p_business_id,
		v_insert_is_permanent or p_operation in ('grant_access','extend_access','payment_registered','reactivate_business','provisional_access'),
		v_insert_is_permanent,
		case when v_insert_is_permanent then 'active' else 'restricted' end,
		'Fila creada automáticamente por grant_business_access; requiere una operación comercial explícita.',
		false
	)
	on conflict (business_id) do nothing;

	select *
	into v_sub
	from business_subscriptions
	where business_id = p_business_id
	for update;

	if not found then
		raise exception 'business subscription not found';
	end if;

	select *
	into v_existing
	from access_grants
	where idempotency_key = p_idempotency_key;

	if found then
		if v_existing.business_id is distinct from p_business_id
			or v_existing.operation is distinct from p_operation
			or coalesce(v_existing.duration_seconds, 0) is distinct from coalesce(v_duration_seconds, 0)
			or coalesce(v_existing.admin_email, '') is distinct from coalesce(p_admin_email, '') then
			raise exception 'idempotency key reused with different payload';
		end if;

		return query
		select false, v_existing.id, v_existing.paid_until_before, v_existing.paid_until_after, v_existing.status_after;
		return;
	end if;

	-- Un acceso provisorio que no daría nada no se asienta: consultorio permanente, pausado o archivado
	-- por el administrador, acceso que ya cubre el período, o un provisorio anterior sin un cobro
	-- automático acreditado después (así no se encadenan suscripciones canceladas antes de pagar).
	if v_is_provisional and (
		v_sub.is_permanent
		or not v_sub.commercial_access_enabled
		or v_sub.archived_at is not null
		or coalesce(v_sub.paid_until, '-infinity'::timestamptz) >= v_now + make_interval(secs => v_duration_seconds)
		or exists (
			select 1
			from access_grants earlier
			where earlier.business_id = p_business_id
				and earlier.operation = 'provisional_access'
				and not exists (
					select 1
					from access_grants paid
					where paid.business_id = p_business_id
						and paid.operation = 'payment_registered'
						and paid.source = 'mercado_pago'
						and paid.admin_id is null
						and paid.created_at > earlier.created_at
				)
		)
	) then
		return query
		select false, null::uuid, v_sub.paid_until, v_sub.paid_until, public.compute_business_subscription_status(
			v_sub.commercial_access_enabled, v_sub.is_permanent, v_sub.paid_until, v_sub.grace_until, v_sub.restricted_until, v_sub.archived_at);
		return;
	end if;

	v_new_paid_until := v_sub.paid_until;
	v_new_grace_until := v_sub.grace_until;
	v_new_restricted_until := v_sub.restricted_until;
	v_new_archived_at := v_sub.archived_at;
	v_new_is_permanent := v_sub.is_permanent;
	v_new_enabled := v_sub.commercial_access_enabled;

	if p_operation in ('grant_access','extend_access','payment_registered') then
		if coalesce(v_duration_seconds, 0) <= 0 then
			raise exception 'duration must be positive';
		end if;
		if v_sub.is_permanent then
			raise exception 'cannot add duration to permanent subscription';
		end if;

		v_has_post_paid_grace := v_duration_seconds > 86400;
		if v_is_mp_monthly then
			-- duration_seconds queda en el asiento como valor declarado (la idempotencia lo compara);
			-- el efecto real es paid_until_after - paid_until_before.
			v_new_paid_until := greatest(coalesce(v_sub.paid_until, v_now), v_now + interval '3 days') + interval '1 month';
		else
			v_new_paid_until := greatest(coalesce(v_sub.paid_until, v_now), v_now) + make_interval(secs => v_duration_seconds);
		end if;
		v_new_grace_until := case
			when v_is_mp_auto and v_has_post_paid_grace then v_new_paid_until + interval '10 days'
			when v_has_post_paid_grace then v_new_paid_until + interval '48 hours'
			else v_new_paid_until
		end;
		v_new_restricted_until := v_new_grace_until + interval '30 days';
		v_new_archived_at := case when v_is_mp_auto then v_sub.archived_at else null end;
		v_new_enabled := case when v_is_mp_auto then v_sub.commercial_access_enabled else true end;
	elsif v_is_provisional then
		-- No suma: lleva el vencimiento a ahora más la duración, sin gracia. El primer cobro parte de
		-- ahora más 3 días, así que el provisorio no se acumula con el mes pagado.
		v_new_paid_until := v_now + make_interval(secs => v_duration_seconds);
		v_new_grace_until := v_new_paid_until;
		v_new_restricted_until := greatest(coalesce(v_sub.restricted_until, v_new_grace_until), v_new_grace_until + interval '30 days');
	elsif p_operation in ('reduce_access','manual_correction') then
		if coalesce(v_duration_seconds, 0) <= 0 then
			raise exception 'duration must be positive';
		end if;
		if v_sub.is_permanent then
			raise exception 'cannot reduce permanent subscription';
		end if;

		v_new_paid_until := coalesce(v_sub.paid_until, v_now) - make_interval(secs => v_duration_seconds);
		if v_new_paid_until < v_now then
			v_new_paid_until := v_now;
		end if;
		v_new_grace_until := v_new_paid_until + interval '48 hours';
		v_new_restricted_until := v_new_grace_until + interval '30 days';
		v_new_archived_at := null;
	elsif p_operation = 'set_permanent' then
		v_new_is_permanent := true;
		v_new_enabled := true;
		v_new_paid_until := null;
		v_new_grace_until := null;
		v_new_restricted_until := null;
		v_new_archived_at := null;
		v_duration_seconds := null;
	elsif p_operation = 'unset_permanent' then
		if not v_sub.is_permanent then
			raise exception 'subscription is not permanent';
		end if;
		v_new_is_permanent := false;
		v_new_paid_until := v_now;
		v_new_grace_until := v_now + interval '48 hours';
		v_new_restricted_until := v_new_grace_until + interval '30 days';
		v_new_archived_at := null;
		v_duration_seconds := null;
	elsif p_operation = 'disable_business_access' then
		v_new_enabled := false;
		v_duration_seconds := null;
	elsif p_operation = 'enable_business_access' then
		v_new_enabled := true;
		v_duration_seconds := null;
	elsif p_operation = 'archive_business' then
		v_new_archived_at := v_now;
		v_new_enabled := false;
		v_duration_seconds := null;
	elsif p_operation = 'reactivate_business' then
		if coalesce(v_duration_seconds, 0) <= 0 and coalesce(p_is_permanent, false) = false then
			raise exception 'reactivation requires duration or permanent flag';
		end if;
		v_new_enabled := true;
		v_new_archived_at := null;
		if coalesce(p_is_permanent, false) then
			v_new_is_permanent := true;
			v_new_paid_until := null;
			v_new_grace_until := null;
			v_new_restricted_until := null;
			v_duration_seconds := null;
		else
			v_new_is_permanent := false;
			v_has_post_paid_grace := v_duration_seconds > 86400;
			v_new_paid_until := v_now + make_interval(secs => v_duration_seconds);
			v_new_grace_until := case
				when v_has_post_paid_grace then v_new_paid_until + interval '48 hours'
				else v_new_paid_until
			end;
			v_new_restricted_until := v_new_grace_until + interval '30 days';
		end if;
	elsif p_operation = 'payment_cancelled' then
		v_duration_seconds := null;
	end if;

	v_new_status := public.compute_business_subscription_status(
		v_new_enabled,
		v_new_is_permanent,
		v_new_paid_until,
		v_new_grace_until,
		v_new_restricted_until,
		v_new_archived_at
	);

	update business_subscriptions
	set
		commercial_access_enabled = v_new_enabled,
		is_permanent = v_new_is_permanent,
		subscription_status = v_new_status,
		paid_until = v_new_paid_until,
		grace_until = v_new_grace_until,
		restricted_until = v_new_restricted_until,
		archived_at = v_new_archived_at,
		last_payment_at = case
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') then v_now
			else last_payment_at
		end,
		last_payment_amount = case
			when p_operation = 'payment_cancelled' then last_payment_amount
			when p_amount is not null then p_amount
			else last_payment_amount
		end,
		last_grant_duration_seconds = case
			when v_is_provisional then last_grant_duration_seconds
			when v_duration_seconds is not null then v_duration_seconds
			else last_grant_duration_seconds
		end,
		expiration_notice_enabled = case
			when v_new_is_permanent then false
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and coalesce(v_duration_seconds, 0) > 86400 then true
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and expiration_notice_enabled then true
			else expiration_notice_enabled
		end,
		access_source = case
			when p_operation = 'payment_cancelled' then access_source
			else v_source
		end,
		access_note = case
			when p_operation = 'payment_cancelled' then access_note
			when v_is_mp_auto or v_is_provisional then access_note
			else coalesce(v_note, access_note)
		end,
		-- Precio fijo de quien contrató (decisión de Juan del 18-nov-2026): el primer cobro automático
		-- mensual fija el precio del consultorio, que se conserva aunque el precio general cambie.
		mp_price_ars = case
			when v_is_mp_monthly and p_amount > 0 then coalesce(mp_price_ars, p_amount)
			else mp_price_ars
		end,
		updated_by = case
			when p_operation = 'payment_cancelled' then updated_by
			else p_admin_id
		end
	where business_id = p_business_id;

	insert into access_grants (
		business_id,
		operation,
		duration_unit,
		duration_seconds,
		is_permanent_grant,
		amount,
		source,
		note,
		admin_id,
		admin_email,
		idempotency_key,
		paid_until_before,
		paid_until_after,
		grace_until_before,
		grace_until_after,
		restricted_until_before,
		restricted_until_after,
		is_permanent_before,
		is_permanent_after,
		enabled_before,
		enabled_after,
		status_before,
		status_after
	)
	values (
		p_business_id,
		p_operation,
		p_duration_unit,
		v_duration_seconds,
		coalesce(p_is_permanent, false) or p_operation = 'set_permanent',
		p_amount,
		v_source,
		v_note,
		p_admin_id,
		nullif(trim(coalesce(p_admin_email, '')), ''),
		p_idempotency_key,
		v_sub.paid_until,
		v_new_paid_until,
		v_sub.grace_until,
		v_new_grace_until,
		v_sub.restricted_until,
		v_new_restricted_until,
		v_sub.is_permanent,
		v_new_is_permanent,
		v_sub.commercial_access_enabled,
		v_new_enabled,
		v_sub.subscription_status,
		v_new_status
	)
	returning id into v_grant_id;

	return query
	select true, v_grant_id, v_sub.paid_until, v_new_paid_until, v_new_status;
end;
$$;

revoke execute on function public.grant_business_access(uuid, text, integer, text, boolean, numeric, text, text, uuid, text, text)
	from public, anon, authenticated;
grant execute on function public.grant_business_access(uuid, text, integer, text, boolean, numeric, text, text, uuid, text, text)
	to service_role;

notify pgrst, 'reload schema';

commit;
