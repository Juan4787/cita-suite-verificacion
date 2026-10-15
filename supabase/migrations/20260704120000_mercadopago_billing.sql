-- Mercado Pago billing: vínculo negocio↔suscripción MP y caja negra de webhooks.
--
-- mp_subscriptions: una fila por preapproval de MP. Es el mapeo autoritativo
-- preapproval_id ↔ business_id (external_reference viaja además en MP como
-- respaldo). No es fuente de verdad del acceso: eso sigue siendo
-- business_subscriptions + access_grants.
--
-- mp_webhook_events: log de auditoría de cada notificación recibida (válida o
-- no) con el resultado de su procesamiento. Sirve para depurar sin adivinar y
-- para avisar de reembolsos/contracargos (requires_attention).

create table if not exists mp_subscriptions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	preapproval_id text not null unique,
	-- Estados conocidos de MP: pending | authorized | paused | cancelled.
	-- Sin check para no romper el upsert si MP agrega estados nuevos.
	status text not null default 'pending',
	payer_email text,
	transaction_amount numeric(12, 2),
	currency_id text,
	next_charge_at timestamptz,
	last_synced_at timestamptz not null default now(),
	raw jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists mp_subscriptions_business_idx
	on mp_subscriptions (business_id);

create table if not exists mp_webhook_events (
	id uuid primary key default gen_random_uuid(),
	received_at timestamptz not null default now(),
	topic text,
	action text,
	resource_id text,
	request_id text,
	live_mode boolean,
	signature_valid boolean not null default false,
	processing_status text not null default 'received' check (
		processing_status in ('received', 'processed', 'skipped', 'rejected', 'error')
	),
	processing_detail text,
	business_id uuid references businesses(id) on delete set null,
	credited_grant_id uuid references access_grants(id) on delete set null,
	requires_attention boolean not null default false,
	raw jsonb
);

create index if not exists mp_webhook_events_received_idx
	on mp_webhook_events (received_at desc);
create index if not exists mp_webhook_events_resource_idx
	on mp_webhook_events (resource_id);
create index if not exists mp_webhook_events_attention_idx
	on mp_webhook_events (received_at desc)
	where requires_attention;

-- Solo service_role: RLS habilitado sin políticas (mismo patrón que
-- whatsapp_webhook_events). El panel maestro lee vía cliente admin.
alter table mp_subscriptions enable row level security;
alter table mp_webhook_events enable row level security;

-- grant_business_access v3: reglas específicas para pagos automáticos de
-- Mercado Pago (operation = 'payment_registered' + source = 'mercado_pago'):
--
--   1. Gracia de 5 días en lugar de 48 h: MP reintenta cobros fallidos durante
--      varios días; con 48 h el negocio quedaría restricted mientras MP
--      todavía está reintentando el cobro.
--   2. El override manual siempre gana: un pago automático NO re-habilita un
--      negocio con commercial_access_enabled = false ni desarchiva uno
--      archivado; solo acredita tiempo. Cuando el admin re-habilite, el tiempo
--      acreditado ya está ahí.
--
-- Las operaciones manuales del panel se comportan exactamente igual que antes.

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
	v_is_mp_auto boolean := v_source = 'mercado_pago' and p_operation = 'payment_registered';
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
		v_new_paid_until := greatest(coalesce(v_sub.paid_until, v_now), v_now) + make_interval(secs => v_duration_seconds);
		v_new_grace_until := case
			when v_is_mp_auto then v_new_paid_until + interval '5 days'
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
		access_source = v_source,
		access_note = coalesce(v_note, access_note),
		updated_by = p_admin_id
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
