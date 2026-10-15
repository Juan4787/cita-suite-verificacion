-- Separa el permiso/endpoint del dispositivo de su vinculo con cada turno.
--
-- Esta es una migracion expansiva y compatible con la version anterior de la
-- aplicacion: conserva temporalmente las columnas legadas de
-- push_subscriptions y las sincroniza con push_devices. El contrato viejo se
-- retirara solamente despues de que el codigo nuevo este desplegado.

begin;

create table if not exists public.push_devices (
	id uuid primary key default gen_random_uuid(),
	endpoint text not null unique,
	p256dh text not null,
	auth text not null,
	user_agent text,
	last_seen_at timestamptz not null default now(),
	last_test_confirmed_at timestamptz,
	last_notification_clicked_at timestamptz,
	verification_required_at timestamptz,
	provider_gone_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (char_length(endpoint) between 1 and 2048),
	check (char_length(p256dh) between 1 and 512),
	check (char_length(auth) between 1 and 512)
);

comment on table public.push_devices is
	'Endpoint Web Push del navegador. Su vigencia pertenece al dispositivo y nunca al ciclo de vida de un turno.';
comment on column public.push_devices.provider_gone_at is
	'Solo se completa cuando el proveedor Web Push responde explicitamente 404 o 410.';
comment on column public.push_devices.last_test_confirmed_at is
	'Ultima confirmacion explicita de la persona mediante Si, la recibi.';
comment on column public.push_devices.verification_required_at is
	'Razon tecnica durable que puede habilitar una nueva prueba; el mero paso del tiempo no la crea.';

create index if not exists push_devices_available_idx
	on public.push_devices (last_seen_at desc)
	where provider_gone_at is null;

alter table public.push_devices enable row level security;
revoke all on table public.push_devices from anon, authenticated;
grant all on table public.push_devices to service_role;

with latest_subscription as (
	select distinct on (subscription.endpoint)
		subscription.endpoint,
		subscription.p256dh,
		subscription.auth,
		subscription.user_agent,
		subscription.created_at,
		subscription.updated_at
	from public.push_subscriptions subscription
	order by subscription.endpoint, subscription.updated_at desc, subscription.id desc
),
signals as (
	select
		subscription.endpoint,
		max(subscription.verified_at) as last_verified_at,
		max(delivery.clicked_at) as last_clicked_at,
		max(delivery.failed_at) filter (where delivery.failure_kind = 'gone') as last_gone_at,
		max(subscription.updated_at) filter (where subscription.revoked_at is null) as last_live_at
	from public.push_subscriptions subscription
	left join public.push_delivery_attempts delivery
		on delivery.subscription_id = subscription.id
	group by subscription.endpoint
)
insert into public.push_devices (
	endpoint,
	p256dh,
	auth,
	user_agent,
	last_seen_at,
	last_test_confirmed_at,
	last_notification_clicked_at,
	verification_required_at,
	provider_gone_at,
	created_at,
	updated_at
)
select
	latest.endpoint,
	latest.p256dh,
	latest.auth,
	latest.user_agent,
	latest.updated_at,
	signals.last_verified_at,
	signals.last_clicked_at,
	case
		when greatest(signals.last_verified_at, signals.last_clicked_at) is null
			then latest.created_at
		else null
	end,
	case
		when signals.last_gone_at is not null
			and (signals.last_live_at is null or signals.last_live_at <= signals.last_gone_at)
			then signals.last_gone_at
		else null
	end,
	latest.created_at,
	latest.updated_at
from latest_subscription latest
join signals on signals.endpoint = latest.endpoint
on conflict (endpoint) do nothing;

alter table public.push_subscriptions
	add column if not exists device_id uuid references public.push_devices (id) on delete restrict,
	add column if not exists detached_at timestamptz,
	add column if not exists detached_reason text;

update public.push_subscriptions subscription
set device_id = device.id
from public.push_devices device
where device.endpoint = subscription.endpoint
	and subscription.device_id is null;

-- Si alguna reparacion historica reasigno el paciente, el vinculo viejo se
-- desacopla del turno. El dispositivo sigue sano y reutilizable en otros turnos.
with reassignments as (
	select
		subscription.id as subscription_id,
		min(log.created_at) as changed_at
	from public.push_subscriptions subscription
	join public.audit_logs log
		on log.entity_type = 'appointment'
		and log.entity_id = subscription.appointment_id
		and log.action = 'appointment.patient_reassigned'
		and log.created_at >= subscription.created_at
	group by subscription.id
)
update public.push_subscriptions subscription
set
	detached_at = reassignment.changed_at,
	detached_reason = 'patient_reassigned'
from reassignments reassignment
where reassignment.subscription_id = subscription.id
	and subscription.detached_at is null;

alter table public.push_subscriptions
	alter column device_id set not null;

create unique index if not exists push_subscriptions_appointment_device_uq
	on public.push_subscriptions (appointment_id, device_id);
create index if not exists push_subscriptions_attached_appointment_idx
	on public.push_subscriptions (appointment_id, updated_at desc)
	where detached_at is null;

comment on column public.push_subscriptions.device_id is
	'Dispositivo durable al que apunta este vinculo turno-dispositivo.';
comment on column public.push_subscriptions.detached_at is
	'Invalida solamente la asociacion con este turno; no revoca el permiso ni el endpoint del dispositivo.';

-- Compatibilidad temporal: las escrituras del backend anterior sobre las
-- columnas endpoint/keys crean o refrescan push_devices en la misma transaccion.
create or replace function private.sync_push_device_from_legacy_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_device public.push_devices%rowtype;
	v_now timestamptz := statement_timestamp();
	v_keys_changed boolean := false;
begin
	select device.*
	into v_device
	from public.push_devices device
	where device.endpoint = new.endpoint
	for update;

	if not found then
		insert into public.push_devices (
			endpoint,
			p256dh,
			auth,
			user_agent,
			last_seen_at,
			last_test_confirmed_at,
			verification_required_at,
			created_at,
			updated_at
		)
		values (
			new.endpoint,
			new.p256dh,
			new.auth,
			new.user_agent,
			v_now,
			new.verified_at,
			case when new.verified_at is null then v_now else null end,
			v_now,
			v_now
		)
		returning * into v_device;
	else
		v_keys_changed := v_device.p256dh is distinct from new.p256dh
			or v_device.auth is distinct from new.auth;

		update public.push_devices device
		set
			p256dh = new.p256dh,
			auth = new.auth,
			user_agent = coalesce(new.user_agent, device.user_agent),
			last_seen_at = v_now,
			last_test_confirmed_at = case
				when new.verified_at is not null
					then greatest(device.last_test_confirmed_at, new.verified_at)
				else device.last_test_confirmed_at
			end,
			verification_required_at = case
				when new.verified_at is not null then null
				when v_keys_changed then v_now
				else device.verification_required_at
			end,
			provider_gone_at = case when v_keys_changed then null else device.provider_gone_at end,
			updated_at = v_now
		where device.id = v_device.id
		returning * into v_device;
	end if;

	new.device_id := v_device.id;
	return new;
end;
$$;

drop trigger if exists push_subscriptions_sync_device_compat
	on public.push_subscriptions;
create trigger push_subscriptions_sync_device_compat
	before insert or update of endpoint, p256dh, auth, user_agent, verified_at
	on public.push_subscriptions
	for each row
	execute function private.sync_push_device_from_legacy_subscription();

revoke all on function private.sync_push_device_from_legacy_subscription()
	from public, anon, authenticated;

create or replace function public.save_appointment_push_subscription(
	target_business_id uuid,
	target_appointment_id uuid,
	target_endpoint text,
	target_p256dh text,
	target_auth text,
	target_user_agent text,
	save_time timestamptz default now()
)
returns table (
	subscription_id uuid,
	device_id uuid,
	endpoint text,
	verification_confirmed_at timestamptz,
	test_suppressed boolean,
	provider_gone boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_device public.push_devices%rowtype;
	v_subscription_id uuid;
	v_keys_changed boolean := false;
	v_positive_at timestamptz;
	v_legacy_verified_at timestamptz;
	v_test_suppressed boolean := false;
begin
	if target_business_id is null
		or target_appointment_id is null
		or save_time is null
		or nullif(trim(target_endpoint), '') is null
		or nullif(trim(target_p256dh), '') is null
		or nullif(trim(target_auth), '') is null
	then
		raise exception 'PUSH_SUBSCRIPTION_INVALID';
	end if;

	if not exists (
		select 1
		from public.appointments appointment
		where appointment.business_id = target_business_id
			and appointment.id = target_appointment_id
	) then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	select device.*
	into v_device
	from public.push_devices device
	where device.endpoint = target_endpoint
	for update;

	if not found then
		insert into public.push_devices (
			endpoint,
			p256dh,
			auth,
			user_agent,
			last_seen_at,
			verification_required_at,
			created_at,
			updated_at
		)
		values (
			target_endpoint,
			target_p256dh,
			target_auth,
			target_user_agent,
			save_time,
			save_time,
			save_time,
			save_time
		)
		returning * into v_device;
	else
		v_keys_changed := v_device.p256dh is distinct from target_p256dh
			or v_device.auth is distinct from target_auth;

		update public.push_devices device
		set
			p256dh = target_p256dh,
			auth = target_auth,
			user_agent = coalesce(target_user_agent, device.user_agent),
			last_seen_at = save_time,
			verification_required_at = case
				when v_keys_changed then save_time
				else device.verification_required_at
			end,
			provider_gone_at = case when v_keys_changed then null else device.provider_gone_at end,
			updated_at = save_time
		where device.id = v_device.id
		returning * into v_device;
	end if;

	v_positive_at := greatest(
		v_device.last_test_confirmed_at,
		v_device.last_notification_clicked_at
	);
	v_legacy_verified_at := case
		when v_positive_at is not null
			and (
				v_device.verification_required_at is null
				or v_positive_at >= v_device.verification_required_at
			)
			then v_positive_at
		else null
	end;
	v_test_suppressed :=
		v_positive_at is not null
		and (
			v_device.verification_required_at is null
			or v_positive_at >= v_device.verification_required_at
			or v_device.last_test_confirmed_at >= save_time - interval '48 hours'
		);

	insert into public.push_subscriptions (
		business_id,
		appointment_id,
		device_id,
		endpoint,
		p256dh,
		auth,
		user_agent,
		failed_count,
		revoked_at,
		verified_at,
		detached_at,
		detached_reason,
		updated_at
	)
	values (
		target_business_id,
		target_appointment_id,
		v_device.id,
		target_endpoint,
		target_p256dh,
		target_auth,
		target_user_agent,
		0,
		null,
		v_legacy_verified_at,
		null,
		null,
		save_time
	)
	on conflict on constraint push_subscriptions_appointment_id_endpoint_key do update
	set
		business_id = excluded.business_id,
		device_id = excluded.device_id,
		p256dh = excluded.p256dh,
		auth = excluded.auth,
		user_agent = excluded.user_agent,
		failed_count = 0,
		revoked_at = null,
		verified_at = excluded.verified_at,
		detached_at = null,
		detached_reason = null,
		updated_at = excluded.updated_at
	returning id into v_subscription_id;

	return query
	select
		v_subscription_id,
		v_device.id,
		v_device.endpoint,
		case when v_test_suppressed then v_positive_at else null end,
		v_test_suppressed,
		v_device.provider_gone_at is not null;
end;
$$;

revoke all on function public.save_appointment_push_subscription(
	uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_appointment_push_subscription(
	uuid, uuid, text, text, text, text, timestamptz
) to service_role;

create or replace function public.mark_push_device_gone(
	target_endpoint text,
	gone_time timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_count integer := 0;
begin
	if nullif(trim(target_endpoint), '') is null or gone_time is null then
		return 0;
	end if;

	update public.push_devices device
	set
		provider_gone_at = coalesce(device.provider_gone_at, gone_time),
		updated_at = greatest(device.updated_at, gone_time)
	where device.endpoint = target_endpoint
		and device.provider_gone_at is null;
	get diagnostics v_count = row_count;
	return v_count;
end;
$$;

revoke all on function public.mark_push_device_gone(text, timestamptz)
	from public, anon, authenticated;
grant execute on function public.mark_push_device_gone(text, timestamptz)
	to service_role;

create or replace function public.claim_due_push_reminders(
	claim_now timestamptz,
	claim_limit integer default 50
) returns table (
	subscription_id uuid,
	appointment_id uuid,
	business_id uuid,
	endpoint text,
	p256dh text,
	auth text,
	reminder_kind text
)
language plpgsql
security definer
set search_path = public
as $$
begin
	return query
	with due as (
		select subscription.id
		from public.push_subscriptions subscription
		join public.push_devices device on device.id = subscription.device_id
		join public.appointments appointment on appointment.id = subscription.appointment_id
		where subscription.detached_at is null
			and device.provider_gone_at is null
			and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
			and appointment.starts_at > claim_now + interval '2 hours'
			and appointment.starts_at <= claim_now + interval '24 hours'
			and subscription.push_24h_sent_at is null
			and (
				subscription.push_24h_claimed_at is null
				or subscription.push_24h_claimed_at < claim_now - interval '10 minutes'
			)
		order by subscription.id
		limit greatest(claim_limit, 1)
		for update of subscription skip locked
	)
	update public.push_subscriptions subscription
	set push_24h_claimed_at = claim_now, updated_at = claim_now
	from due, public.push_devices device
	where subscription.id = due.id
		and device.id = subscription.device_id
	returning
		subscription.id,
		subscription.appointment_id,
		subscription.business_id,
		device.endpoint,
		device.p256dh,
		device.auth,
		'24h'::text;

	return query
	with due as (
		select subscription.id
		from public.push_subscriptions subscription
		join public.push_devices device on device.id = subscription.device_id
		join public.appointments appointment on appointment.id = subscription.appointment_id
		where subscription.detached_at is null
			and device.provider_gone_at is null
			and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
			and appointment.starts_at > claim_now
			and appointment.starts_at <= claim_now + interval '2 hours'
			and subscription.push_2h_sent_at is null
			and (
				subscription.push_2h_claimed_at is null
				or subscription.push_2h_claimed_at < claim_now - interval '10 minutes'
			)
		order by subscription.id
		limit greatest(claim_limit, 1)
		for update of subscription skip locked
	)
	update public.push_subscriptions subscription
	set push_2h_claimed_at = claim_now, updated_at = claim_now
	from due, public.push_devices device
	where subscription.id = due.id
		and device.id = subscription.device_id
	returning
		subscription.id,
		subscription.appointment_id,
		subscription.business_id,
		device.endpoint,
		device.p256dh,
		device.auth,
		'2h'::text;
end;
$$;

revoke all on function public.claim_due_push_reminders(timestamptz, integer)
	from public, anon, authenticated;
grant execute on function public.claim_due_push_reminders(timestamptz, integer)
	to service_role;

create or replace function public.reset_push_reminders_on_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update public.push_subscriptions subscription
	set
		push_24h_claimed_at = null,
		push_24h_sent_at = null,
		push_2h_claimed_at = null,
		push_2h_sent_at = null,
		updated_at = now()
	where subscription.appointment_id = new.id
		and subscription.detached_at is null;

	update public.push_delivery_attempts delivery
	set superseded_at = now(), updated_at = now()
	where delivery.appointment_id = new.id
		and delivery.kind <> 'test'
		and delivery.superseded_at is null;

	return new;
end;
$$;

create or replace function private.validate_push_delivery_attempt_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_subscription record;
begin
	select
		subscription.business_id,
		subscription.appointment_id,
		subscription.detached_at,
		device.provider_gone_at
	into v_subscription
	from public.push_subscriptions subscription
	join public.push_devices device on device.id = subscription.device_id
	where subscription.id = new.subscription_id
	for key share of subscription, device;

	if not found then
		raise exception 'PUSH_SUBSCRIPTION_NOT_FOUND';
	end if;
	if v_subscription.business_id is distinct from new.business_id
		or v_subscription.appointment_id is distinct from new.appointment_id
	then
		raise exception 'PUSH_SUBSCRIPTION_MISMATCH';
	end if;
	if v_subscription.detached_at is not null then
		raise exception 'PUSH_SUBSCRIPTION_DETACHED';
	end if;
	if v_subscription.provider_gone_at is not null then
		raise exception 'PUSH_DEVICE_GONE';
	end if;
	return new;
end;
$$;

revoke all on function private.validate_push_delivery_attempt_identity()
	from public, anon, authenticated;

-- Los clics son una señal del dispositivo. Se conserva verified_at durante la
-- etapa compatible para que el backend anterior siga viendo la misma cobertura.
create or replace function public.record_push_notification_click(
	target_appointment_id uuid,
	target_delivery_id uuid,
	target_receipt_token_hash text,
	click_time timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	target_subscription_id uuid;
	target_device_id uuid;
begin
	if click_time is null
		or target_receipt_token_hash is null
		or target_receipt_token_hash !~ '^[0-9a-f]{64}$'
	then
		return false;
	end if;

	update public.push_delivery_attempts delivery
	set
		received_at = coalesce(delivery.received_at, click_time),
		displayed_at = coalesce(delivery.displayed_at, click_time),
		clicked_at = coalesce(delivery.clicked_at, click_time),
		user_reported_missing_at = null,
		updated_at = greatest(delivery.updated_at, click_time)
	where delivery.id = target_delivery_id
		and delivery.appointment_id = target_appointment_id
		and delivery.receipt_token_hash = target_receipt_token_hash
	returning delivery.subscription_id into target_subscription_id;

	if target_subscription_id is null then
		return false;
	end if;

	select subscription.device_id
	into target_device_id
	from public.push_subscriptions subscription
	where subscription.id = target_subscription_id
		and subscription.appointment_id = target_appointment_id
		and subscription.detached_at is null;

	if target_device_id is null then
		return false;
	end if;

	update public.push_devices device
	set
		last_notification_clicked_at = greatest(device.last_notification_clicked_at, click_time),
		verification_required_at = case
			when device.verification_required_at is null
				or click_time >= device.verification_required_at
				then null
			else device.verification_required_at
		end,
		updated_at = greatest(device.updated_at, click_time)
	where device.id = target_device_id
		and device.provider_gone_at is null;

	update public.push_subscriptions subscription
	set
		verified_at = coalesce(subscription.verified_at, click_time),
		updated_at = greatest(subscription.updated_at, click_time)
	where subscription.id = target_subscription_id
		and subscription.detached_at is null;

	return true;
end;
$$;

revoke all on function public.record_push_notification_click(uuid, uuid, text, timestamptz)
	from public, anon, authenticated;
grant execute on function public.record_push_notification_click(uuid, uuid, text, timestamptz)
	to service_role;

create or replace function public.record_push_test_feedback(
	target_appointment_id uuid,
	target_delivery_id uuid,
	feedback_visible boolean,
	feedback_time timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	target_subscription_id uuid;
	target_device_id uuid;
	delivery_clicked_at timestamptz;
begin
	if feedback_visible is null or feedback_time is null then
		return false;
	end if;

	select delivery.subscription_id, delivery.clicked_at
	into target_subscription_id, delivery_clicked_at
	from public.push_delivery_attempts delivery
	where delivery.id = target_delivery_id
		and delivery.appointment_id = target_appointment_id
		and delivery.kind = 'test'
		and delivery.accepted_at is not null
		and delivery.failed_at is null
		and delivery.superseded_at is null
	for update;

	if target_subscription_id is null then
		return false;
	end if;

	select subscription.device_id
	into target_device_id
	from public.push_subscriptions subscription
	where subscription.id = target_subscription_id
		and subscription.appointment_id = target_appointment_id
		and subscription.detached_at is null
	for update;

	if target_device_id is null then
		return false;
	end if;

	if feedback_visible then
		update public.push_delivery_attempts delivery
		set
			user_confirmed_at = feedback_time,
			user_reported_missing_at = null,
			updated_at = greatest(delivery.updated_at, feedback_time)
		where delivery.id = target_delivery_id;

		update public.push_devices device
		set
			last_test_confirmed_at = greatest(device.last_test_confirmed_at, feedback_time),
			verification_required_at = null,
			updated_at = greatest(device.updated_at, feedback_time)
		where device.id = target_device_id;

		update public.push_subscriptions subscription
		set
			verified_at = feedback_time,
			revoked_at = null,
			failed_count = 0,
			updated_at = greatest(subscription.updated_at, feedback_time)
		where subscription.id = target_subscription_id;
	elsif delivery_clicked_at is null then
		update public.push_delivery_attempts delivery
		set
			user_confirmed_at = null,
			user_reported_missing_at = feedback_time,
			updated_at = greatest(delivery.updated_at, feedback_time)
		where delivery.id = target_delivery_id;

		update public.push_devices device
		set
			verification_required_at = greatest(device.verification_required_at, feedback_time),
			updated_at = greatest(device.updated_at, feedback_time)
		where device.id = target_device_id;

		update public.push_subscriptions subscription
		set
			verified_at = null,
			updated_at = greatest(subscription.updated_at, feedback_time)
		where subscription.id = target_subscription_id;
	end if;

	if delivery_clicked_at is not null then
		update public.push_devices device
		set
			last_notification_clicked_at = greatest(
				device.last_notification_clicked_at,
				delivery_clicked_at
			),
			verification_required_at = case
				when device.verification_required_at is null
					or delivery_clicked_at >= device.verification_required_at
					then null
				else device.verification_required_at
			end,
			updated_at = greatest(device.updated_at, delivery_clicked_at)
		where device.id = target_device_id;

		update public.push_subscriptions subscription
		set
			verified_at = coalesce(subscription.verified_at, delivery_clicked_at),
			updated_at = greatest(subscription.updated_at, delivery_clicked_at)
		where subscription.id = target_subscription_id;
	end if;

	return true;
end;
$$;

revoke all on function public.record_push_test_feedback(uuid, uuid, boolean, timestamptz)
	from public, anon, authenticated;
grant execute on function public.record_push_test_feedback(uuid, uuid, boolean, timestamptz)
	to service_role;

notify pgrst, 'reload schema';

commit;
