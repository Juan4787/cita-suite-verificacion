-- Integracion verificable con Google Calendar para el calendario del paciente.
--
-- Principios:
-- - los secretos OAuth y la telemetria son service-role only;
-- - un evento confirmado por la API se distingue de un simple click;
-- - una reprogramacion encola la actualizacion en la MISMA transaccion del turno;
-- - los trabajos son idempotentes y se reclaman con SKIP LOCKED;
-- - el horario solo queda "vigente" cuando Google confirma la misma sequence.

alter table public.appointments
	drop constraint if exists appointments_calendar_action_status_check;

alter table public.appointments
	add constraint appointments_calendar_action_status_check
	check (calendar_action_status in (
		'not_offered',
		'offered',
		'clicked_google',
		'clicked_ics',
		'downloaded_ics',
		'clicked_outlook',
		'clicked_phone_calendar',
		'synced_google'
	));

-- Una suscripcion Web Push solo constituye cobertura despues de que la persona
-- confirma la notificacion de prueba. Aceptacion del proveedor != aviso visible.
alter table public.push_subscriptions
	add column if not exists verified_at timestamptz;

update public.push_subscriptions subscription
set verified_at = confirmation.last_confirmed_at,
	updated_at = greatest(subscription.updated_at, confirmation.last_confirmed_at)
from (
	select subscription_id, max(user_confirmed_at) as last_confirmed_at
	from public.push_delivery_attempts
	where kind = 'test'
		and user_confirmed_at is not null
	group by subscription_id
) confirmation
where subscription.id = confirmation.subscription_id
	and subscription.verified_at is null;

comment on column public.push_subscriptions.verified_at is
	'Confirmacion explicita de que una notificacion de prueba fue visible en este turno y dispositivo.';

create index if not exists idx_push_subscriptions_verified_appointment
	on public.push_subscriptions (appointment_id)
	where verified_at is not null and revoked_at is null;

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
		select ps.id
		from public.push_subscriptions ps
		join public.appointments a on a.id = ps.appointment_id
		where ps.revoked_at is null
			and ps.verified_at is not null
			and a.status in ('reserved', 'confirmed')
			and a.starts_at > claim_now + interval '2 hours'
			and a.starts_at <= claim_now + interval '24 hours'
			and ps.push_24h_sent_at is null
			and (ps.push_24h_claimed_at is null or ps.push_24h_claimed_at < claim_now - interval '10 minutes')
		order by ps.id
		limit claim_limit
		for update of ps skip locked
	)
	update public.push_subscriptions ps
	set push_24h_claimed_at = claim_now, updated_at = claim_now
	from due
	where ps.id = due.id
	returning ps.id, ps.appointment_id, ps.business_id, ps.endpoint, ps.p256dh, ps.auth, '24h'::text;

	return query
	with due as (
		select ps.id
		from public.push_subscriptions ps
		join public.appointments a on a.id = ps.appointment_id
		where ps.revoked_at is null
			and ps.verified_at is not null
			and a.status in ('reserved', 'confirmed')
			and a.starts_at > claim_now
			and a.starts_at <= claim_now + interval '2 hours'
			and ps.push_2h_sent_at is null
			and (ps.push_2h_claimed_at is null or ps.push_2h_claimed_at < claim_now - interval '10 minutes')
		order by ps.id
		limit claim_limit
		for update of ps skip locked
	)
	update public.push_subscriptions ps
	set push_2h_claimed_at = claim_now, updated_at = claim_now
	from due
	where ps.id = due.id
	returning ps.id, ps.appointment_id, ps.business_id, ps.endpoint, ps.p256dh, ps.auth, '2h'::text;
end;
$$;

revoke all on function public.claim_due_push_reminders(timestamptz, integer)
	from public, anon, authenticated;
grant execute on function public.claim_due_push_reminders(timestamptz, integer)
	to service_role;

create table if not exists public.google_calendar_connections (
	id uuid primary key default gen_random_uuid(),
	oauth_client_key text not null,
	google_subject text not null,
	refresh_token_ciphertext text,
	granted_scopes text[] not null default '{}'::text[],
	revoked_at timestamptz,
	last_refresh_at timestamptz,
	last_error_code text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (oauth_client_key, google_subject),
	check (length(oauth_client_key) between 32 and 128),
	check (length(google_subject) between 1 and 255),
	check (refresh_token_ciphertext is null or length(refresh_token_ciphertext) between 20 and 4096)
);

comment on table public.google_calendar_connections is
	'Autorizaciones Google Calendar reutilizables por cuenta. El refresh token siempre se cifra en la aplicacion antes de persistirlo.';
comment on column public.google_calendar_connections.oauth_client_key is
	'SHA-256 del client_id: separa sujetos de distintos proyectos OAuth sin guardar otra credencial.';
comment on column public.google_calendar_connections.google_subject is
	'SHA-256 contextual del identificador estable de Google; el subject original no se persiste.';

create table if not exists public.google_calendar_oauth_attempts (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	appointment_id uuid not null,
	state_hash text not null unique,
	code_verifier_ciphertext text not null,
	force_consent boolean not null default false,
	expires_at timestamptz not null,
	consumed_at timestamptz,
	created_at timestamptz not null default now(),
	foreign key (business_id, appointment_id)
		references public.appointments (business_id, id)
		on delete cascade,
	check (length(state_hash) = 64),
	check (length(code_verifier_ciphertext) between 20 and 4096),
	check (expires_at > created_at)
);

comment on table public.google_calendar_oauth_attempts is
	'Estados OAuth de un solo uso. No guarda el token publico del turno ni el state en claro.';

create index if not exists idx_google_calendar_oauth_attempts_expiry
	on public.google_calendar_oauth_attempts (expires_at);

create table if not exists public.appointment_google_calendar_events (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	appointment_id uuid not null unique,
	connection_id uuid not null references public.google_calendar_connections (id) on delete cascade,
	calendar_id text not null default 'primary',
	event_id text,
	sync_status text not null default 'pending_create'
		check (sync_status in (
			'pending_create',
			'active',
			'pending_update',
			'pending_delete',
			'deleted',
			'detached',
			'needs_reconnect',
			'failed'
		)),
	synced_sequence integer not null default -1,
	claimed_at timestamptz,
	attempt_count integer not null default 0 check (attempt_count >= 0),
	next_attempt_at timestamptz not null default now(),
	last_attempt_at timestamptz,
	last_synced_at timestamptz,
	last_error_code text,
	last_error_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (business_id, appointment_id)
		references public.appointments (business_id, id)
		on delete cascade,
	check (length(calendar_id) between 1 and 1024),
	check (event_id is null or length(event_id) between 5 and 1024)
);

comment on table public.appointment_google_calendar_events is
	'Vinculo verificable turno-evento Google y cola durable para crear, actualizar o borrar el evento.';
comment on column public.appointment_google_calendar_events.synced_sequence is
	'Version del turno confirmada por Google. Solo active + sequence actual constituye cobertura.';

create unique index if not exists idx_google_calendar_event_remote_unique
	on public.appointment_google_calendar_events (connection_id, calendar_id, event_id)
	where event_id is not null;
create index if not exists idx_google_calendar_event_jobs
	on public.appointment_google_calendar_events (next_attempt_at, created_at)
	where sync_status in ('pending_create', 'pending_update', 'pending_delete');
create index if not exists idx_google_calendar_event_connection
	on public.appointment_google_calendar_events (connection_id);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_attempts enable row level security;
alter table public.appointment_google_calendar_events enable row level security;

revoke all on table public.google_calendar_connections from anon, authenticated;
revoke all on table public.google_calendar_oauth_attempts from anon, authenticated;
revoke all on table public.appointment_google_calendar_events from anon, authenticated;

grant select, insert, update, delete on table public.google_calendar_connections to service_role;
grant select, insert, update, delete on table public.google_calendar_oauth_attempts to service_role;
grant select, insert, update, delete on table public.appointment_google_calendar_events to service_role;

-- Consume el state una sola vez, incluso ante callbacks concurrentes.
create or replace function public.consume_google_calendar_oauth_attempt(
	p_state_hash text,
	p_now timestamptz default now()
) returns table (
	attempt_id uuid,
	business_id uuid,
	appointment_id uuid,
	code_verifier_ciphertext text,
	force_consent boolean
)
language sql
security definer
set search_path = public
as $$
	update public.google_calendar_oauth_attempts attempt
	set consumed_at = p_now
	where attempt.state_hash = p_state_hash
		and attempt.consumed_at is null
		and attempt.expires_at > p_now
	returning attempt.id, attempt.business_id, attempt.appointment_id,
		attempt.code_verifier_ciphertext, attempt.force_consent;
$$;

-- Guarda/reutiliza la autorizacion y deja un unico evento pendiente por turno.
create or replace function public.authorize_google_calendar_event(
	p_appointment_id uuid,
	p_oauth_client_key text,
	p_google_subject text,
	p_refresh_token_ciphertext text,
	p_granted_scopes text[],
	p_now timestamptz default now()
) returns table (
	connection_row_id uuid,
	event_row_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
	appointment_row public.appointments%rowtype;
	connection_row public.google_calendar_connections%rowtype;
	existing_event public.appointment_google_calendar_events%rowtype;
	target_event_id uuid;
begin
	select * into appointment_row
	from public.appointments
	where id = p_appointment_id
	for update;

	if not found then
		raise exception 'GOOGLE_CALENDAR_APPOINTMENT_NOT_FOUND';
	end if;
	if not (
		'https://www.googleapis.com/auth/calendar.events.owned'
		= any(coalesce(p_granted_scopes, '{}'::text[]))
	) then
		raise exception 'GOOGLE_CALENDAR_SCOPE_MISSING';
	end if;
	if appointment_row.status not in ('reserved', 'confirmed', 'reschedule_requested')
		or appointment_row.starts_at <= p_now then
		raise exception 'GOOGLE_CALENDAR_APPOINTMENT_NOT_ACTIVE';
	end if;

	insert into public.google_calendar_connections as connection (
		oauth_client_key,
		google_subject,
		refresh_token_ciphertext,
		granted_scopes,
		revoked_at,
		last_error_code,
		updated_at
	) values (
		p_oauth_client_key,
		p_google_subject,
		p_refresh_token_ciphertext,
		coalesce(p_granted_scopes, '{}'::text[]),
		null,
		null,
		p_now
	)
	on conflict (oauth_client_key, google_subject) do update
	set refresh_token_ciphertext = coalesce(
			excluded.refresh_token_ciphertext,
			connection.refresh_token_ciphertext
		),
		granted_scopes = case
			when cardinality(excluded.granted_scopes) > 0 then excluded.granted_scopes
			else connection.granted_scopes
		end,
		revoked_at = case
			when excluded.refresh_token_ciphertext is not null then null
			else connection.revoked_at
		end,
		last_error_code = case
			when excluded.refresh_token_ciphertext is not null then null
			else connection.last_error_code
		end,
		updated_at = excluded.updated_at
	returning connection.* into connection_row;

	if connection_row.refresh_token_ciphertext is null or connection_row.revoked_at is not null then
		raise exception 'GOOGLE_CALENDAR_REAUTH_REQUIRED';
	end if;

	select * into existing_event
	from public.appointment_google_calendar_events
	where appointment_id = p_appointment_id
	for update;

	if found
		and existing_event.connection_id <> connection_row.id
		and existing_event.sync_status in ('active', 'pending_update', 'pending_delete') then
		raise exception 'GOOGLE_CALENDAR_ALREADY_CONNECTED';
	end if;

	insert into public.appointment_google_calendar_events as event_link (
		business_id,
		appointment_id,
		connection_id,
		calendar_id,
		event_id,
		sync_status,
		synced_sequence,
		claimed_at,
		attempt_count,
		next_attempt_at,
		last_error_code,
		last_error_at,
		updated_at
	) values (
		appointment_row.business_id,
		appointment_row.id,
		connection_row.id,
		'primary',
		null,
		'pending_create',
		-1,
		null,
		0,
		p_now,
		null,
		null,
		p_now
	)
	on conflict (appointment_id) do update
	set connection_id = excluded.connection_id,
		event_id = case
			when event_link.connection_id = excluded.connection_id then event_link.event_id
			else null
		end,
		sync_status = case
			when event_link.connection_id = excluded.connection_id
				and event_link.event_id is not null then 'pending_update'
			else 'pending_create'
		end,
		synced_sequence = case
			when event_link.connection_id = excluded.connection_id then event_link.synced_sequence
			else -1
		end,
		claimed_at = null,
		attempt_count = 0,
		next_attempt_at = p_now,
		last_error_code = null,
		last_error_at = null,
		updated_at = p_now
	returning event_link.id into target_event_id;

	return query select connection_row.id, target_event_id;
end;
$$;

-- Reclamo atomico de trabajos. Un claim abandonado vence a los 10 minutos.
create or replace function public.claim_google_calendar_sync_jobs(
	claim_now timestamptz,
	claim_limit integer default 20
) returns table (event_row_id uuid)
language sql
security definer
set search_path = public
as $$
	with due as (
		select event_link.id
		from public.appointment_google_calendar_events event_link
		where event_link.sync_status in ('pending_create', 'pending_update', 'pending_delete')
			and event_link.next_attempt_at <= claim_now
			and (
				event_link.claimed_at is null
				or event_link.claimed_at < claim_now - interval '10 minutes'
			)
		order by event_link.next_attempt_at, event_link.created_at
		limit greatest(1, least(coalesce(claim_limit, 20), 100))
		for update skip locked
	)
	update public.appointment_google_calendar_events event_link
	set claimed_at = claim_now,
		last_attempt_at = claim_now,
		updated_at = claim_now
	from due
	where event_link.id = due.id
	returning event_link.id;
$$;

-- Confirma create/update sin perder una reprogramacion que haya ocurrido durante
-- la llamada a Google: si sequence ya cambio, vuelve inmediatamente a pending_update.
create or replace function public.complete_google_calendar_event_sync(
	p_event_row_id uuid,
	p_google_event_id text,
	p_synced_sequence integer,
	p_now timestamptz default now()
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
	event_row public.appointment_google_calendar_events%rowtype;
	appointment_row public.appointments%rowtype;
	final_status text;
begin
	select * into event_row
	from public.appointment_google_calendar_events
	where id = p_event_row_id
	for update;
	if not found then raise exception 'GOOGLE_CALENDAR_EVENT_LINK_NOT_FOUND'; end if;

	select * into appointment_row
	from public.appointments
	where id = event_row.appointment_id
	for update;
	if not found then raise exception 'GOOGLE_CALENDAR_APPOINTMENT_NOT_FOUND'; end if;

	final_status := case
		when event_row.sync_status = 'pending_delete' then 'pending_delete'
		when appointment_row.status = 'cancelled' then 'pending_delete'
		when appointment_row.calendar_sequence <> p_synced_sequence then 'pending_update'
		when appointment_row.status in ('reserved', 'confirmed', 'reschedule_requested') then 'active'
		else 'detached'
	end;

	update public.appointment_google_calendar_events
	set event_id = p_google_event_id,
		synced_sequence = p_synced_sequence,
		sync_status = final_status,
		claimed_at = null,
		attempt_count = 0,
		next_attempt_at = case when final_status in ('pending_update', 'pending_delete') then p_now else next_attempt_at end,
		last_synced_at = p_now,
		last_error_code = null,
		last_error_at = null,
		updated_at = p_now
	where id = event_row.id;

	if final_status = 'active' then
		update public.appointments
		set calendar_action_status = 'synced_google',
			calendar_provider = 'google',
			calendar_action_at = p_now,
			calendar_action_count = calendar_action_count
				+ case when calendar_action_status = 'synced_google' then 0 else 1 end,
			calendar_update_required_at = null,
			updated_at = greatest(updated_at, p_now)
		where id = appointment_row.id;
	end if;

	return final_status;
end;
$$;

create or replace function public.complete_google_calendar_event_delete(
	p_event_row_id uuid,
	p_now timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	event_row public.appointment_google_calendar_events%rowtype;
	deleted_connection_id uuid;
begin
	select * into event_row
	from public.appointment_google_calendar_events
	where id = p_event_row_id
	for update;
	if not found then raise exception 'GOOGLE_CALENDAR_EVENT_LINK_NOT_FOUND'; end if;

	update public.appointments
	set calendar_action_status = case
			when calendar_action_status = 'synced_google' then 'offered'
			else calendar_action_status
		end,
		calendar_provider = case
			when calendar_action_status = 'synced_google' then null
			else calendar_provider
		end,
		calendar_update_required_at = null,
		updated_at = greatest(updated_at, p_now)
	where id = event_row.appointment_id;

	delete from public.appointment_google_calendar_events
	where id = event_row.id;

	-- Si ya no queda ningún turno vinculado, la autorización deja de ser
	-- necesaria. La app conserva el token en memoria solo para revocarlo ante
	-- Google después de confirmar esta transacción.
	delete from public.google_calendar_connections connection
	where connection.id = event_row.connection_id
		and not exists (
			select 1
			from public.appointment_google_calendar_events remaining
			where remaining.connection_id = connection.id
		)
	returning connection.id into deleted_connection_id;

	return deleted_connection_id;
end;
$$;

-- Registra fallos categorizados. Nunca persiste cuerpos de error de Google.
create or replace function public.fail_google_calendar_event_sync(
	p_event_row_id uuid,
	p_failure_category text,
	p_error_code text,
	p_next_attempt_at timestamptz,
	p_now timestamptz default now()
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
	event_row public.appointment_google_calendar_events%rowtype;
	final_status text;
begin
	if p_failure_category not in ('transient', 'authorization', 'missing', 'permanent') then
		raise exception 'GOOGLE_CALENDAR_FAILURE_CATEGORY_INVALID';
	end if;

	select * into event_row
	from public.appointment_google_calendar_events
	where id = p_event_row_id
	for update;
	if not found then raise exception 'GOOGLE_CALENDAR_EVENT_LINK_NOT_FOUND'; end if;

	final_status := case p_failure_category
		when 'transient' then event_row.sync_status
		when 'authorization' then 'needs_reconnect'
		when 'missing' then 'deleted'
		else 'failed'
	end;

	update public.appointment_google_calendar_events
	set sync_status = final_status,
		event_id = case when p_failure_category = 'missing' then null else event_id end,
		claimed_at = null,
		attempt_count = attempt_count + 1,
		next_attempt_at = case
			when p_failure_category = 'transient' then p_next_attempt_at
			else next_attempt_at
		end,
		last_error_code = left(coalesce(p_error_code, 'unknown'), 80),
		last_error_at = p_now,
		updated_at = p_now
	where id = event_row.id;

	if p_failure_category = 'authorization' then
		update public.google_calendar_connections
		set refresh_token_ciphertext = null,
			revoked_at = p_now,
			last_error_code = left(coalesce(p_error_code, 'authorization'), 80),
			updated_at = p_now
		where id = event_row.connection_id;
	end if;

	if p_failure_category in ('authorization', 'missing', 'permanent') then
		update public.appointments
		set calendar_action_status = case
				when calendar_action_status = 'synced_google' then 'offered'
				else calendar_action_status
			end,
			calendar_provider = case
				when calendar_action_status = 'synced_google' then null
				else calendar_provider
			end,
			calendar_update_required_at = case
				when status in ('reserved', 'confirmed', 'reschedule_requested') then p_now
				else calendar_update_required_at
			end,
			updated_at = greatest(updated_at, p_now)
		where id = event_row.appointment_id;
	end if;

	return final_status;
end;
$$;

create or replace function public.request_google_calendar_event_deletion(
	p_appointment_id uuid,
	p_now timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	target_id uuid;
begin
	update public.appointment_google_calendar_events
	set sync_status = 'pending_delete',
		next_attempt_at = p_now,
		last_error_code = null,
		last_error_at = null,
		updated_at = p_now
	where appointment_id = p_appointment_id
	returning id into target_id;

	if target_id is null then raise exception 'GOOGLE_CALENDAR_EVENT_LINK_NOT_FOUND'; end if;
	return target_id;
end;
$$;

-- El estado remoto queda obsoleto dentro de la misma transaccion del turno.
create or replace function public.queue_google_calendar_sync_on_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	queued_count integer := 0;
begin
	if new.status = 'cancelled' and old.status is distinct from new.status then
		update public.appointment_google_calendar_events
		set sync_status = 'pending_delete',
			next_attempt_at = now(),
			last_error_code = null,
			last_error_at = null,
			updated_at = now()
		where appointment_id = new.id
			and sync_status not in ('deleted', 'detached');
		get diagnostics queued_count = row_count;
	elsif new.status in ('reserved', 'confirmed', 'reschedule_requested')
		and (
			new.starts_at is distinct from old.starts_at
			or new.ends_at is distinct from old.ends_at
			or new.calendar_sequence is distinct from old.calendar_sequence
		) then
		update public.appointment_google_calendar_events
		set sync_status = case when event_id is null then 'pending_create' else 'pending_update' end,
			next_attempt_at = now(),
			last_error_code = null,
			last_error_at = null,
			updated_at = now()
		where appointment_id = new.id
			and sync_status not in ('deleted', 'detached', 'pending_delete');
		get diagnostics queued_count = row_count;

		-- Hace visible el estado obsoleto en la misma transaccion, incluso si el
		-- horario se cambia por un camino futuro que no use el helper de la app.
		if queued_count > 0 then
			update public.appointments
			set calendar_update_required_at = coalesce(calendar_update_required_at, now())
			where id = new.id;
		end if;
	end if;
	return new;
end;
$$;

drop trigger if exists appointments_queue_google_calendar_sync on public.appointments;
create trigger appointments_queue_google_calendar_sync
	after update of starts_at, ends_at, status, calendar_sequence on public.appointments
	for each row
	execute function public.queue_google_calendar_sync_on_appointment_change();

-- Ninguna funcion privilegiada queda disponible para clientes publicos.
revoke all on function public.consume_google_calendar_oauth_attempt(text, timestamptz) from public, anon, authenticated;
revoke all on function public.authorize_google_calendar_event(uuid, text, text, text, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.claim_google_calendar_sync_jobs(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_event_sync(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_google_calendar_event_delete(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_google_calendar_event_sync(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.request_google_calendar_event_deletion(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.queue_google_calendar_sync_on_appointment_change() from public, anon, authenticated;

grant execute on function public.consume_google_calendar_oauth_attempt(text, timestamptz) to service_role;
grant execute on function public.authorize_google_calendar_event(uuid, text, text, text, text[], timestamptz) to service_role;
grant execute on function public.claim_google_calendar_sync_jobs(timestamptz, integer) to service_role;
grant execute on function public.complete_google_calendar_event_sync(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.complete_google_calendar_event_delete(uuid, timestamptz) to service_role;
grant execute on function public.fail_google_calendar_event_sync(uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.request_google_calendar_event_deletion(uuid, timestamptz) to service_role;
