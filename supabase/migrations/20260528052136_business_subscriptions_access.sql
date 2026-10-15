create extension if not exists pgcrypto;

alter table allowed_emails
	add column if not exists note text,
	add column if not exists disabled_at timestamptz,
	add column if not exists disabled_reason text,
	add column if not exists created_by uuid references auth.users(id),
	add column if not exists updated_by uuid references auth.users(id),
	add column if not exists updated_at timestamptz not null default now();

create table if not exists business_subscriptions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	commercial_access_enabled boolean not null default true,
	is_permanent boolean not null default false,
	subscription_status text not null default 'active' check (
		subscription_status in ('active','grace','restricted','archived')
	),
	access_starts_at timestamptz not null default now(),
	paid_until timestamptz,
	grace_until timestamptz,
	restricted_until timestamptz,
	archived_at timestamptz,
	last_payment_at timestamptz,
	last_payment_amount numeric(12, 2),
	last_grant_duration_seconds integer,
	expiration_notice_enabled boolean not null default false,
	access_source text not null default 'internal' check (
		access_source in ('manual','mercado_pago','promo','internal')
	),
	access_note text,
	updated_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id),
	check (
		is_permanent = false
		or (
			paid_until is null
			and grace_until is null
			and restricted_until is null
		)
	)
);

create table if not exists access_grants (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	operation text not null check (
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
			'sessions_revoked'
		)
	),
	duration_unit text check (
		duration_unit is null or duration_unit in ('hour','day','month','permanent','manual')
	),
	duration_seconds integer,
	is_permanent_grant boolean not null default false,
	amount numeric(12, 2),
	source text not null default 'manual' check (
		source in ('manual','mercado_pago','promo','internal')
	),
	note text,
	admin_id uuid,
	admin_email text,
	idempotency_key text not null unique,
	paid_until_before timestamptz,
	paid_until_after timestamptz,
	grace_until_before timestamptz,
	grace_until_after timestamptz,
	restricted_until_before timestamptz,
	restricted_until_after timestamptz,
	is_permanent_before boolean,
	is_permanent_after boolean,
	enabled_before boolean,
	enabled_after boolean,
	status_before text,
	status_after text,
	created_at timestamptz not null default now()
);

create index if not exists business_subscriptions_status_idx
	on business_subscriptions (subscription_status, commercial_access_enabled);

create index if not exists access_grants_business_created_idx
	on access_grants (business_id, created_at desc);

create or replace function public.prevent_access_grants_mutation()
returns trigger
language plpgsql
as $$
begin
	raise exception 'access_grants is append-only';
end;
$$;

drop trigger if exists trg_access_grants_no_update on access_grants;
create trigger trg_access_grants_no_update
	before update on access_grants
	for each row
	execute function public.prevent_access_grants_mutation();

drop trigger if exists trg_access_grants_no_delete on access_grants;
create trigger trg_access_grants_no_delete
	before delete on access_grants
	for each row
	execute function public.prevent_access_grants_mutation();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists trg_allowed_emails_updated_at on allowed_emails;
create trigger trg_allowed_emails_updated_at
	before update on allowed_emails
	for each row
	execute function public.touch_updated_at();

drop trigger if exists trg_business_subscriptions_updated_at on business_subscriptions;
create trigger trg_business_subscriptions_updated_at
	before update on business_subscriptions
	for each row
	execute function public.touch_updated_at();

insert into business_subscriptions (
	business_id,
	commercial_access_enabled,
	is_permanent,
	subscription_status,
	access_starts_at,
	access_source,
	access_note,
	expiration_notice_enabled
)
select
	b.id,
	true,
	true,
	'active',
	coalesce(b.created_at, now()),
	'internal',
	'Migración inicial: los negocios existentes quedan con acceso permanente.',
	false
from businesses b
on conflict (business_id) do nothing;

create or replace function public.ensure_business_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into business_subscriptions (
		business_id,
		commercial_access_enabled,
		is_permanent,
		subscription_status,
		access_starts_at,
		access_source,
		access_note,
		expiration_notice_enabled
	)
	values (
		new.id,
		true,
		true,
		'active',
		now(),
		'internal',
		'Acceso permanente creado automáticamente para compatibilidad inicial.',
		false
	)
	on conflict (business_id) do nothing;

	return new;
end;
$$;

drop trigger if exists trg_businesses_ensure_subscription on businesses;
create trigger trg_businesses_ensure_subscription
	after insert on businesses
	for each row
	execute function public.ensure_business_subscription();

create or replace function public.compute_business_subscription_status(
	p_commercial_access_enabled boolean,
	p_is_permanent boolean,
	p_paid_until timestamptz,
	p_grace_until timestamptz,
	p_restricted_until timestamptz,
	p_archived_at timestamptz
)
returns text
language sql
stable
set search_path = public
as $$
	select case
		when p_archived_at is not null then 'archived'
		when coalesce(p_commercial_access_enabled, false) = false then 'restricted'
		when coalesce(p_is_permanent, false) = true then 'active'
		when p_paid_until is not null and now() <= p_paid_until then 'active'
		when p_grace_until is not null and now() <= p_grace_until then 'grace'
		when p_restricted_until is not null and now() <= p_restricted_until then 'restricted'
		else 'archived'
	end;
$$;

create or replace function public.business_allows_operation(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce((
		select
			bs.archived_at is null
			and bs.commercial_access_enabled = true
			and (
				bs.is_permanent = true
				or (bs.paid_until is not null and now() <= bs.paid_until)
				or (bs.grace_until is not null and now() <= bs.grace_until)
			)
		from business_subscriptions bs
		where bs.business_id = target_business_id
	), true);
$$;

create or replace function public.user_can_operate_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner','admin','reception')
		and public.business_allows_operation(target_business_id);
$$;

create or replace function public.professional_update_appointment_status(
	target_business_id uuid,
	target_appointment_id uuid,
	target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_appointment record;
	v_now timestamptz := now();
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if not public.business_allows_operation(target_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	if target_status not in ('attended','no_show') then
		raise exception 'INVALID_PROFESSIONAL_STATUS';
	end if;

	select id, professional_id, starts_at, ends_at, status
	into v_appointment
	from appointments
	where business_id = target_business_id
		and id = target_appointment_id
	for update;

	if not found then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	if not exists (
		select 1
		from professional_users pu
		where pu.business_id = target_business_id
			and pu.professional_id = v_appointment.professional_id
			and pu.user_id = auth.uid()
	) then
		raise exception 'APPOINTMENT_ACCESS_DENIED';
	end if;

	if v_appointment.status in ('cancelled','attended','no_show') then
		raise exception 'APPOINTMENT_TERMINAL_STATUS';
	end if;

	if target_status = 'attended' and v_appointment.starts_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_ATTEND_IN_FUTURE';
	end if;

	if target_status = 'no_show' and v_appointment.ends_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END';
	end if;

	update appointments
	set
		status = target_status,
		attended_at = case when target_status = 'attended' then v_now else attended_at end,
		no_show_at = case when target_status = 'no_show' then v_now else no_show_at end,
		updated_by_user_id = auth.uid(),
		updated_at = v_now
	where business_id = target_business_id
		and id = target_appointment_id;

	insert into audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id,
		auth.uid(),
		case when target_status = 'attended' then 'appointment.attended' else 'appointment.no_show' end,
		'appointment',
		target_appointment_id,
		jsonb_build_object('via', 'professional_panel', 'from_status', v_appointment.status)
	);
end;
$$;

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

	insert into business_subscriptions (business_id, is_permanent, subscription_status, access_note)
	values (
		p_business_id,
		coalesce(p_is_permanent, false)
			or p_operation in ('set_permanent','disable_business_access','enable_business_access','archive_business','payment_cancelled'),
		'active',
		'Fila creada automáticamente por grant_business_access.'
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

		v_new_paid_until := greatest(coalesce(v_sub.paid_until, v_now), v_now) + make_interval(secs => v_duration_seconds);
		v_new_grace_until := v_new_paid_until + interval '48 hours';
		v_new_restricted_until := v_new_grace_until + interval '30 days';
		v_new_archived_at := null;
		v_new_enabled := true;
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
			v_new_paid_until := v_now + make_interval(secs => v_duration_seconds);
			v_new_grace_until := v_new_paid_until + interval '48 hours';
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
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and coalesce(v_duration_seconds, 0) >= 2592000 then true
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

revoke all on table business_subscriptions from anon, authenticated;
revoke all on table access_grants from anon, authenticated;
grant select on table business_subscriptions to authenticated;
grant select on table access_grants to authenticated;
revoke execute on function public.grant_business_access(uuid, text, integer, text, boolean, numeric, text, text, uuid, text, text)
	from public, anon, authenticated;
grant execute on function public.business_allows_operation(uuid) to authenticated;
grant execute on function public.user_can_operate_business(uuid) to authenticated;

grant execute on function public.grant_business_access(uuid, text, integer, text, boolean, numeric, text, text, uuid, text, text)
	to service_role;

alter table business_subscriptions enable row level security;
alter table access_grants enable row level security;

drop policy if exists "business admins can update businesses" on businesses;
create policy "business admins can update businesses"
	on businesses
	for update
	to authenticated
	using (
		public.user_can_manage_business(id)
		and public.business_allows_operation(id)
	)
	with check (
		public.user_can_manage_business(id)
		and public.business_allows_operation(id)
	);

drop policy if exists "business admins can insert memberships" on business_users;
create policy "business admins can insert memberships"
	on business_users
	for insert
	to authenticated
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists "business admins can update memberships" on business_users;
create policy "business admins can update memberships"
	on business_users
	for update
	to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	)
	with check (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

drop policy if exists "business admins can delete memberships" on business_users;
create policy "business admins can delete memberships"
	on business_users
	for delete
	to authenticated
	using (
		public.user_can_manage_business(business_id)
		and public.business_allows_operation(business_id)
	);

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'business_subscriptions'
			and policyname = 'business_subscriptions_members_read'
	) then
		create policy business_subscriptions_members_read
			on business_subscriptions
			for select
			to authenticated
			using (public.user_has_business_access(business_id));
	end if;

	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'access_grants'
			and policyname = 'access_grants_members_read'
	) then
		create policy access_grants_members_read
			on access_grants
			for select
			to authenticated
			using (public.user_can_manage_business(business_id));
	end if;
end $$;
