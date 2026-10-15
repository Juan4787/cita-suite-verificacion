-- Solicitudes automaticas de resenas de Google.
--
-- La programacion es durable y pertenece al turno actual. El envio se reclama
-- con lease, vuelve a validar horario/paciente/configuracion y serializa el
-- limite de 180 dias por consultorio + paciente.

begin;

create table if not exists public.google_review_settings (
	business_id uuid primary key references public.businesses (id) on delete cascade,
	enabled boolean not null default false,
	review_url text,
	notification_title text not null default '✨ Esperamos que hayas tenido una buena experiencia con nosotros.',
	notification_body text not null default 'Si querés, compartí tu opinión en Google. Puede ayudar a otros que estén buscando dónde atenderse.',
	notification_action_label text not null default 'Compartir mi opinión',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (review_url is null or (review_url ~ '^https://' and char_length(review_url) <= 2048)),
	check (not enabled or nullif(trim(review_url), '') is not null),
	check (char_length(trim(notification_title)) between 1 and 120),
	check (char_length(trim(notification_body)) between 1 and 500),
	check (char_length(trim(notification_action_label)) between 1 and 60)
);

comment on table public.google_review_settings is
	'Configuracion editable de la solicitud automatica de resena de cada consultorio.';

alter table public.google_review_settings enable row level security;

drop policy if exists google_review_settings_select
	on public.google_review_settings;
create policy google_review_settings_select
	on public.google_review_settings
	for select
	to authenticated
	using (public.user_can_manage_business(business_id));

drop policy if exists google_review_settings_insert
	on public.google_review_settings;
create policy google_review_settings_insert
	on public.google_review_settings
	for insert
	to authenticated
	with check (public.user_can_manage_business(business_id));

drop policy if exists google_review_settings_update
	on public.google_review_settings;
create policy google_review_settings_update
	on public.google_review_settings
	for update
	to authenticated
	using (public.user_can_manage_business(business_id))
	with check (public.user_can_manage_business(business_id));

revoke all on table public.google_review_settings from anon, authenticated;
grant select, insert, update on table public.google_review_settings to authenticated;
grant all on table public.google_review_settings to service_role;

create table if not exists public.google_review_requests (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null,
	patient_id uuid not null,
	appointment_id uuid not null,
	appointment_ends_at timestamptz not null,
	scheduled_for timestamptz not null,
	status text not null default 'pending' check (
		status in ('pending', 'claimed', 'sent', 'clicked', 'superseded', 'cancelled', 'skipped', 'failed')
	),
	status_reason text,
	claim_token uuid,
	claimed_at timestamptz,
	claim_expires_at timestamptz,
	attempt_count integer not null default 0 check (attempt_count >= 0),
	next_attempt_at timestamptz,
	prepared_at timestamptz,
	push_subscription_id uuid references public.push_subscriptions (id) on delete set null,
	push_delivery_id uuid references public.push_delivery_attempts (id) on delete set null,
	push_service_status integer check (
		push_service_status is null or push_service_status between 100 and 599
	),
	last_error_kind text,
	click_token_hash text,
	review_url_snapshot text,
	notification_title_snapshot text,
	notification_body_snapshot text,
	notification_action_label_snapshot text,
	sent_at timestamptz,
	clicked_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (business_id, appointment_id)
		references public.appointments (business_id, id)
		on delete cascade,
	foreign key (business_id, patient_id)
		references public.patients (business_id, id)
		on delete cascade,
	check (scheduled_for = appointment_ends_at + interval '2 hours'),
	check (click_token_hash is null or click_token_hash ~ '^[0-9a-f]{64}$'),
	check (review_url_snapshot is null or review_url_snapshot ~ '^https://'),
	check (
		(status = 'claimed' and claim_token is not null and claimed_at is not null and claim_expires_at is not null)
		or status <> 'claimed'
	),
	check (sent_at is null or status in ('sent', 'clicked', 'superseded')),
	check (clicked_at is null or sent_at is not null or status in ('claimed', 'clicked'))
);

comment on table public.google_review_requests is
	'Una solicitud logica por horario vigente del turno; conserva envio y apertura sin afirmar que se publico una resena.';
comment on column public.google_review_requests.appointment_ends_at is
	'Instantanea usada para invalidar de forma segura una programacion despues de reprogramar.';
comment on column public.google_review_requests.click_token_hash is
	'SHA-256 del token aleatorio de /r; el secreto nunca se persiste en claro.';

create unique index if not exists google_review_requests_current_appointment_uq
	on public.google_review_requests (appointment_id)
	where status in ('pending', 'claimed');
create unique index if not exists google_review_requests_click_token_uq
	on public.google_review_requests (click_token_hash)
	where click_token_hash is not null;
create index if not exists google_review_requests_due_idx
	on public.google_review_requests (scheduled_for, next_attempt_at, created_at)
	where status = 'pending';
create index if not exists google_review_requests_patient_sent_idx
	on public.google_review_requests (business_id, patient_id, sent_at desc)
	where sent_at is not null;

alter table public.google_review_requests enable row level security;
revoke all on table public.google_review_requests from anon, authenticated;
grant all on table public.google_review_requests to service_role;

create table if not exists public.google_review_patient_delivery_state (
	business_id uuid not null,
	patient_id uuid not null,
	last_sent_at timestamptz,
	active_request_id uuid,
	claim_expires_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	primary key (business_id, patient_id),
	foreign key (business_id, patient_id)
		references public.patients (business_id, id)
		on delete cascade
);

comment on table public.google_review_patient_delivery_state is
	'Candado atomico y ultima solicitud enviada para aplicar 180 dias exactos por consultorio + paciente.';

alter table public.google_review_patient_delivery_state enable row level security;
revoke all on table public.google_review_patient_delivery_state from anon, authenticated;
grant all on table public.google_review_patient_delivery_state to service_role;

alter table public.push_delivery_attempts
	drop constraint if exists push_delivery_attempts_kind_check;
alter table public.push_delivery_attempts
	add constraint push_delivery_attempts_kind_check
	check (kind in ('test', '24h', '2h', 'reschedule', 'review'));

create or replace function private.invalidate_current_google_review_request(
	p_appointment_id uuid,
	p_status text,
	p_reason text,
	p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_count integer := 0;
begin
	with invalidated as (
		update public.google_review_requests request
		set
			status = p_status,
			status_reason = p_reason,
			claim_token = null,
			claimed_at = null,
			claim_expires_at = null,
			updated_at = p_now
		where request.appointment_id = p_appointment_id
			and request.status in ('pending', 'claimed')
		returning request.id, request.business_id, request.patient_id
	), released as (
		update public.google_review_patient_delivery_state state
		set
			active_request_id = null,
			claim_expires_at = null,
			updated_at = p_now
		from invalidated
		where state.business_id = invalidated.business_id
			and state.patient_id = invalidated.patient_id
			and state.active_request_id = invalidated.id
		returning state.business_id
	)
	select count(*)::integer into v_count from invalidated;

	return v_count;
end;
$$;

revoke all on function private.invalidate_current_google_review_request(
	uuid, text, text, timestamptz
) from public, anon, authenticated;

create or replace function private.schedule_google_review_request(
	p_business_id uuid,
	p_patient_id uuid,
	p_appointment_id uuid,
	p_starts_at timestamptz,
	p_ends_at timestamptz,
	p_status text,
	p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
	if p_status not in ('reserved', 'confirmed', 'reschedule_requested')
		or p_starts_at < p_now
		or not exists (
			select 1
			from public.google_review_settings settings
			where settings.business_id = p_business_id
				and settings.enabled = true
				and nullif(trim(settings.review_url), '') is not null
		)
	then
		return false;
	end if;

	insert into public.google_review_requests (
		business_id,
		patient_id,
		appointment_id,
		appointment_ends_at,
		scheduled_for,
		status,
		created_at,
		updated_at
	)
	values (
		p_business_id,
		p_patient_id,
		p_appointment_id,
		p_ends_at,
		p_ends_at + interval '2 hours',
		'pending',
		p_now,
		p_now
	)
	on conflict (appointment_id) where status in ('pending', 'claimed')
	do nothing;

	return found;
end;
$$;

revoke all on function private.schedule_google_review_request(
	uuid, uuid, uuid, timestamptz, timestamptz, text, timestamptz
) from public, anon, authenticated;

create or replace function private.sync_google_review_request_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_schedule_changed boolean := false;
begin
	if tg_op = 'INSERT' then
		perform private.schedule_google_review_request(
			new.business_id,
			new.patient_id,
			new.id,
			new.starts_at,
			new.ends_at,
			new.status,
			v_now
		);
		return new;
	end if;

	if new.status = 'cancelled' then
		perform private.invalidate_current_google_review_request(
			new.id,
			'cancelled',
			'appointment_cancelled',
			v_now
		);
		return new;
	end if;

	v_schedule_changed :=
		new.starts_at is distinct from old.starts_at
		or new.ends_at is distinct from old.ends_at
		or new.patient_id is distinct from old.patient_id;

	if v_schedule_changed then
		perform private.invalidate_current_google_review_request(
			new.id,
			'superseded',
			case
				when new.patient_id is distinct from old.patient_id then 'patient_reassigned'
				else 'appointment_rescheduled'
			end,
			v_now
		);
		perform private.schedule_google_review_request(
			new.business_id,
			new.patient_id,
			new.id,
			new.starts_at,
			new.ends_at,
			new.status,
			v_now
		);
	elsif old.status not in ('reserved', 'confirmed', 'reschedule_requested')
		and new.status in ('reserved', 'confirmed', 'reschedule_requested')
	then
		perform private.schedule_google_review_request(
			new.business_id,
			new.patient_id,
			new.id,
			new.starts_at,
			new.ends_at,
			new.status,
			v_now
		);
	end if;

	return new;
end;
$$;

drop trigger if exists appointments_sync_google_review_request
	on public.appointments;
create trigger appointments_sync_google_review_request
	after insert or update of starts_at, ends_at, patient_id, status
	on public.appointments
	for each row
	execute function private.sync_google_review_request_from_appointment();

revoke all on function private.sync_google_review_request_from_appointment()
	from public, anon, authenticated;

create or replace function private.sync_google_review_requests_from_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_now timestamptz := statement_timestamp();
	v_appointment record;
begin
	if new.enabled = false or nullif(trim(new.review_url), '') is null then
		with invalidated as (
			update public.google_review_requests request
			set
				status = 'cancelled',
				status_reason = 'setting_disabled',
				claim_token = null,
				claimed_at = null,
				claim_expires_at = null,
				updated_at = v_now
			where request.business_id = new.business_id
				and request.status in ('pending', 'claimed')
			returning request.id, request.business_id, request.patient_id
		)
		update public.google_review_patient_delivery_state state
		set
			active_request_id = null,
			claim_expires_at = null,
			updated_at = v_now
		from invalidated
		where state.business_id = invalidated.business_id
			and state.patient_id = invalidated.patient_id
			and state.active_request_id = invalidated.id;
		return new;
	end if;

	-- Al activar, solo se preparan turnos que siguen activos ahora. No se envian
	-- solicitudes retroactivas por consultas que ya habian terminado.
	for v_appointment in
		select
			appointment.id,
			appointment.patient_id,
			appointment.starts_at,
			appointment.ends_at,
			appointment.status
		from public.appointments appointment
		where appointment.business_id = new.business_id
			and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
			and appointment.starts_at >= v_now
	loop
		perform private.schedule_google_review_request(
			new.business_id,
			v_appointment.patient_id,
			v_appointment.id,
			v_appointment.starts_at,
			v_appointment.ends_at,
			v_appointment.status,
			v_now
		);
	end loop;

	return new;
end;
$$;

drop trigger if exists google_review_settings_sync_requests
	on public.google_review_settings;
create trigger google_review_settings_sync_requests
	after insert or update of enabled, review_url
	on public.google_review_settings
	for each row
	execute function private.sync_google_review_requests_from_settings();

revoke all on function private.sync_google_review_requests_from_settings()
	from public, anon, authenticated;

create or replace function public.claim_due_google_review_requests(
	claim_now timestamptz,
	claim_limit integer default 20
)
returns table (
	request_id uuid,
	claim_token uuid,
	business_id uuid,
	patient_id uuid,
	appointment_id uuid,
	appointment_ends_at timestamptz,
	scheduled_for timestamptz,
	subscription_id uuid,
	endpoint text,
	p256dh text,
	auth text,
	confirmation_token text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_candidate record;
	v_context record;
	v_target record;
	v_state public.google_review_patient_delivery_state%rowtype;
	v_claim_token uuid;
	v_claimed integer := 0;
begin
	if claim_now is null then
		raise exception 'GOOGLE_REVIEW_CLAIM_TIME_REQUIRED';
	end if;

	for v_candidate in
		select request.id
		from public.google_review_requests request
		where request.status = 'pending'
			and request.scheduled_for <= claim_now
			and (request.next_attempt_at is null or request.next_attempt_at <= claim_now)
		order by request.scheduled_for, request.created_at, request.id
		limit greatest(claim_limit, 1) * 4
		for update skip locked
	loop
		exit when v_claimed >= greatest(claim_limit, 1);

		select
			request.id,
			request.business_id,
			request.patient_id,
			request.appointment_id,
			request.appointment_ends_at,
			request.scheduled_for,
			appointment.ends_at as current_ends_at,
			appointment.patient_id as current_patient_id,
			appointment.status as appointment_status,
			appointment.confirmation_token,
			settings.enabled as setting_enabled,
			settings.review_url
		into v_context
		from public.google_review_requests request
		join public.appointments appointment
			on appointment.business_id = request.business_id
			and appointment.id = request.appointment_id
		left join public.google_review_settings settings
			on settings.business_id = request.business_id
		where request.id = v_candidate.id;

		if not found then
			continue;
		end if;

		if v_context.appointment_status = 'cancelled' then
			update public.google_review_requests request
			set status = 'cancelled', status_reason = 'appointment_cancelled', updated_at = claim_now
			where request.id = v_candidate.id;
			continue;
		end if;

		if v_context.appointment_status not in ('reserved', 'confirmed', 'reschedule_requested')
			or v_context.current_patient_id is distinct from v_context.patient_id
			or v_context.current_ends_at is distinct from v_context.appointment_ends_at
		then
			update public.google_review_requests request
			set status = 'superseded', status_reason = 'appointment_changed', updated_at = claim_now
			where request.id = v_candidate.id;
			continue;
		end if;

		if v_context.setting_enabled is distinct from true
			or nullif(trim(v_context.review_url), '') is null
		then
			update public.google_review_requests request
			set status = 'cancelled', status_reason = 'setting_unavailable', updated_at = claim_now
			where request.id = v_candidate.id;
			continue;
		end if;

		select
			subscription.id,
			device.endpoint,
			device.p256dh,
			device.auth
		into v_target
		from public.push_subscriptions subscription
		join public.push_devices device on device.id = subscription.device_id
		where subscription.business_id = v_context.business_id
			and subscription.appointment_id = v_context.appointment_id
			and subscription.detached_at is null
			and device.provider_gone_at is null
		order by device.last_seen_at desc, subscription.updated_at desc, subscription.id
		limit 1;

		if not found then
			update public.google_review_requests request
			set status = 'skipped', status_reason = 'notifications_unavailable', updated_at = claim_now
			where request.id = v_candidate.id;
			continue;
		end if;

		insert into public.google_review_patient_delivery_state (
			business_id,
			patient_id,
			created_at,
			updated_at
		)
		values (
			v_context.business_id,
			v_context.patient_id,
			claim_now,
			claim_now
		)
		on conflict on constraint google_review_patient_delivery_state_pkey do nothing;

		select state.*
		into v_state
		from public.google_review_patient_delivery_state state
		where state.business_id = v_context.business_id
			and state.patient_id = v_context.patient_id
		for update;

		if v_state.last_sent_at is not null
			and v_state.last_sent_at > claim_now - interval '180 days'
		then
			update public.google_review_requests request
			set status = 'skipped', status_reason = 'patient_cooldown', updated_at = claim_now
			where request.id = v_candidate.id;
			continue;
		end if;

		if v_state.active_request_id is not null
			and v_state.active_request_id <> v_context.id
			and v_state.claim_expires_at is not null
			and v_state.claim_expires_at > claim_now
		then
			continue;
		end if;

		v_claim_token := gen_random_uuid();

		update public.google_review_patient_delivery_state state
		set
			active_request_id = v_context.id,
			claim_expires_at = claim_now + interval '10 minutes',
			updated_at = claim_now
		where state.business_id = v_context.business_id
			and state.patient_id = v_context.patient_id;

		update public.google_review_requests request
		set
			status = 'claimed',
			status_reason = null,
			claim_token = v_claim_token,
			claimed_at = claim_now,
			claim_expires_at = claim_now + interval '10 minutes',
			attempt_count = request.attempt_count + 1,
			push_subscription_id = v_target.id,
			updated_at = claim_now
		where request.id = v_context.id;

		v_claimed := v_claimed + 1;
		request_id := v_context.id;
		claim_token := v_claim_token;
		business_id := v_context.business_id;
		patient_id := v_context.patient_id;
		appointment_id := v_context.appointment_id;
		appointment_ends_at := v_context.appointment_ends_at;
		scheduled_for := v_context.scheduled_for;
		subscription_id := v_target.id;
		endpoint := v_target.endpoint;
		p256dh := v_target.p256dh;
		auth := v_target.auth;
		confirmation_token := v_context.confirmation_token;
		return next;
	end loop;
end;
$$;

revoke all on function public.claim_due_google_review_requests(timestamptz, integer)
	from public, anon, authenticated;
grant execute on function public.claim_due_google_review_requests(timestamptz, integer)
	to service_role;

create or replace function public.prepare_google_review_request_delivery(
	target_request_id uuid,
	target_claim_token uuid,
	target_subscription_id uuid,
	target_click_token_hash text,
	prepare_time timestamptz default now()
)
returns table (
	review_url text,
	notification_title text,
	notification_body text,
	notification_action_label text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_request public.google_review_requests%rowtype;
	v_context record;
begin
	if target_click_token_hash is null
		or target_click_token_hash !~ '^[0-9a-f]{64}$'
		or prepare_time is null
	then
		return;
	end if;

	select request.*
	into v_request
	from public.google_review_requests request
	where request.id = target_request_id
	for update;

	if not found
		or v_request.status <> 'claimed'
		or v_request.claim_token is distinct from target_claim_token
		or v_request.claim_expires_at <= prepare_time
	then
		return;
	end if;

	select
		appointment.patient_id,
		appointment.ends_at,
		appointment.status,
		settings.enabled,
		settings.review_url,
		settings.notification_title,
		settings.notification_body,
		settings.notification_action_label,
		subscription.detached_at,
		device.provider_gone_at
	into v_context
	from public.appointments appointment
	join public.google_review_settings settings
		on settings.business_id = appointment.business_id
	join public.push_subscriptions subscription
		on subscription.id = target_subscription_id
		and subscription.business_id = appointment.business_id
		and subscription.appointment_id = appointment.id
	join public.push_devices device on device.id = subscription.device_id
	where appointment.business_id = v_request.business_id
		and appointment.id = v_request.appointment_id;

	if not found
		or v_context.patient_id is distinct from v_request.patient_id
		or v_context.ends_at is distinct from v_request.appointment_ends_at
		or v_context.status not in ('reserved', 'confirmed', 'reschedule_requested')
		or v_context.enabled is distinct from true
		or nullif(trim(v_context.review_url), '') is null
		or v_context.detached_at is not null
		or v_context.provider_gone_at is not null
	then
		perform private.invalidate_current_google_review_request(
			v_request.appointment_id,
			'superseded',
			'delivery_revalidation_failed',
			prepare_time
		);
		return;
	end if;

	update public.google_review_requests request
	set
		prepared_at = prepare_time,
		push_subscription_id = target_subscription_id,
		click_token_hash = target_click_token_hash,
		review_url_snapshot = trim(v_context.review_url),
		notification_title_snapshot = trim(v_context.notification_title),
		notification_body_snapshot = trim(v_context.notification_body),
		notification_action_label_snapshot = trim(v_context.notification_action_label),
		updated_at = prepare_time
	where request.id = v_request.id;

	return query
	select
		trim(v_context.review_url),
		trim(v_context.notification_title),
		trim(v_context.notification_body),
		trim(v_context.notification_action_label);
end;
$$;

revoke all on function public.prepare_google_review_request_delivery(
	uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.prepare_google_review_request_delivery(
	uuid, uuid, uuid, text, timestamptz
) to service_role;

create or replace function public.complete_google_review_request(
	target_request_id uuid,
	target_claim_token uuid,
	target_push_delivery_id uuid,
	target_push_service_status integer,
	complete_time timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_request public.google_review_requests%rowtype;
begin
	select request.*
	into v_request
	from public.google_review_requests request
	where request.id = target_request_id
	for update;

	if not found
		or v_request.status not in ('claimed', 'clicked')
		or v_request.claim_token is distinct from target_claim_token
		or v_request.prepared_at is null
	then
		return false;
	end if;

	update public.google_review_requests request
	set
		status = case when request.clicked_at is null then 'sent' else 'clicked' end,
		status_reason = null,
		push_delivery_id = target_push_delivery_id,
		push_service_status = target_push_service_status,
		sent_at = coalesce(request.sent_at, complete_time),
		claim_token = null,
		claimed_at = null,
		claim_expires_at = null,
		last_error_kind = null,
		updated_at = complete_time
	where request.id = v_request.id;

	insert into public.google_review_patient_delivery_state (
		business_id,
		patient_id,
		last_sent_at,
		active_request_id,
		claim_expires_at,
		created_at,
		updated_at
	)
	values (
		v_request.business_id,
		v_request.patient_id,
		complete_time,
		null,
		null,
		complete_time,
		complete_time
	)
	on conflict (business_id, patient_id) do update
	set
		last_sent_at = greatest(
			public.google_review_patient_delivery_state.last_sent_at,
			excluded.last_sent_at
		),
		active_request_id = null,
		claim_expires_at = null,
		updated_at = excluded.updated_at;

	return true;
end;
$$;

revoke all on function public.complete_google_review_request(
	uuid, uuid, uuid, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_google_review_request(
	uuid, uuid, uuid, integer, timestamptz
) to service_role;

create or replace function public.release_google_review_request(
	target_request_id uuid,
	target_claim_token uuid,
	target_error_kind text,
	release_time timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_request public.google_review_requests%rowtype;
	v_retry boolean;
begin
	select request.*
	into v_request
	from public.google_review_requests request
	where request.id = target_request_id
	for update;

	if not found
		or v_request.status <> 'claimed'
		or v_request.claim_token is distinct from target_claim_token
	then
		return false;
	end if;

	v_retry := v_request.attempt_count < 6;

	update public.google_review_requests request
	set
		status = case when v_retry then 'pending' else 'failed' end,
		status_reason = case when v_retry then 'retry_scheduled' else 'delivery_failed' end,
		claim_token = null,
		claimed_at = null,
		claim_expires_at = null,
		next_attempt_at = case
			when v_retry then release_time + make_interval(mins => least(60, 10 * v_request.attempt_count))
			else null
		end,
		last_error_kind = left(coalesce(target_error_kind, 'unknown'), 80),
		updated_at = release_time
	where request.id = v_request.id;

	update public.google_review_patient_delivery_state state
	set
		active_request_id = null,
		claim_expires_at = null,
		updated_at = release_time
	where state.business_id = v_request.business_id
		and state.patient_id = v_request.patient_id
		and state.active_request_id = v_request.id;

	return true;
end;
$$;

revoke all on function public.release_google_review_request(
	uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.release_google_review_request(
	uuid, uuid, text, timestamptz
) to service_role;

create or replace function public.record_google_review_click(
	target_click_token_hash text,
	click_time timestamptz default now()
)
returns table (review_url text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_url text;
begin
	if target_click_token_hash is null
		or target_click_token_hash !~ '^[0-9a-f]{64}$'
		or click_time is null
	then
		return;
	end if;

	update public.google_review_requests request
	set
		clicked_at = coalesce(request.clicked_at, click_time),
		status = case
			when request.status in ('claimed', 'sent') then 'clicked'
			else request.status
		end,
		updated_at = greatest(request.updated_at, click_time)
	where request.click_token_hash = target_click_token_hash
		and request.review_url_snapshot is not null
	returning request.review_url_snapshot into v_url;

	if v_url is null then
		return;
	end if;

	return query select v_url;
end;
$$;

revoke all on function public.record_google_review_click(text, timestamptz)
	from public, anon, authenticated;
grant execute on function public.record_google_review_click(text, timestamptz)
	to service_role;

notify pgrst, 'reload schema';

commit;
