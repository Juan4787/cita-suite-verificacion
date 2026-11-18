-- Correcciones de los cobros automáticos con Mercado Pago, tras la auditoría y la prueba de punta a
-- punta del 18 de noviembre de 2026 (docs/plans/cobros-mercadopago-20261118.md).
--
-- 1. grant_business_access v5. Un cobro automático de Mercado Pago (source mercado_pago, sin
--    administrador, unidad 'month') suma un mes calendario en lugar de 30 días fijos: Mercado Pago
--    debita el mismo día de cada mes y con 30 días el acceso vencía antes del débito en 5 de cada 12
--    meses (hallazgo A3). La base es el mayor entre el vencimiento actual y ahora más 3 días, así el
--    vencimiento cae después del próximo débito, aunque el cobro se acredite con horas de demora, sin
--    acumular el margen. La gracia de esos cobros pasa de 5 a 10 días, la ventana en que Mercado Pago
--    reintenta un cobro rechazado (A2). Las operaciones manuales, y un pago registrado a mano por el
--    panel maestro, conservan exactamente su semántica: segundos fijos y gracia de 48 horas.
-- 2. Los avisos que piden atención se pueden marcar como resueltos (M2), y «una sola vez» cuenta
--    sólo los no resueltos (M1, en la app).
-- 3. La retención conserva los avisos con atención mientras sigan sin resolver; los resueltos se
--    podan a los 180 días, como el resto.
-- 4. Cada suscripción guarda su último cobro, para avisar cuando Mercado Pago no pudo cobrar (M6).

begin;

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
set search_path = public
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
		'payment_cancelled'
	) then
		raise exception 'invalid operation';
	end if;

	if v_source not in ('manual','mercado_pago','promo','internal') then
		raise exception 'invalid source';
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
		v_insert_is_permanent or p_operation in ('grant_access','extend_access','payment_registered','reactivate_business'),
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
			when v_is_mp_auto then access_note
			else coalesce(v_note, access_note)
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

-- 2. Resolución de los avisos que piden atención.
alter table public.mp_webhook_events
	add column resolved_at timestamptz,
	add column resolved_by uuid;

create index mp_webhook_events_open_attention_idx
	on public.mp_webhook_events (received_at desc)
	where requires_attention and resolved_at is null;

-- 3. La retención conserva lo que todavía pide atención y no fue resuelto.
create or replace function private.prune_webhook_events() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_mp integer; v_whatsapp integer;
begin
 delete from public.mp_webhook_events where id in (
  select e.id from public.mp_webhook_events e
  where e.received_at<clock_timestamp()-interval '180 days' and not (e.requires_attention and e.resolved_at is null)
  order by e.received_at limit 20000);
 get diagnostics v_mp=row_count;
 delete from public.whatsapp_webhook_events where id in (
  select e.id from public.whatsapp_webhook_events e
  where e.received_at<clock_timestamp()-interval '180 days' order by e.received_at limit 20000);
 get diagnostics v_whatsapp=row_count;
 return v_mp+v_whatsapp;
end $$;

revoke all on function private.prune_webhook_events() from public,anon,authenticated,service_role;

-- 4. El último cobro de cada suscripción.
alter table public.mp_subscriptions
	add column last_charge_id text,
	add column last_charge_status text,
	add column last_charge_detail text,
	add column last_charge_at timestamptz;

notify pgrst, 'reload schema';

commit;
