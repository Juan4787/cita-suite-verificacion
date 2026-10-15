-- Calendario, dirección y recordatorios de turno.
-- Ver docs/plan-calendario-direccion-recordatorios.md
--
-- 1. Ubicación del consultorio (dirección visible ya existía en businesses.address).
-- 2. Tracking honesto de acciones de calendario por turno + versionado (SEQUENCE del ICS).
-- 3. Registro del recordatorio manual por WhatsApp (sección Recordatorios).
-- 4. Suscripciones Web Push por (turno, dispositivo) con claim atómico para el job de envío.

-- ---------------------------------------------------------------------------
-- 1. Ubicación del consultorio
-- ---------------------------------------------------------------------------

alter table public.businesses
	add column if not exists address_instructions text,
	add column if not exists maps_url text;

comment on column public.businesses.address_instructions is
	'Indicaciones extra para llegar (timbre, galería, piso). Visible para pacientes.';
comment on column public.businesses.maps_url is
	'Link manual de Google Maps. Si está vacío o es inválido se genera desde address.';

-- ---------------------------------------------------------------------------
-- 2. Tracking de calendario por turno
-- ---------------------------------------------------------------------------
-- calendar_action_status registra la última acción de calendario que la app pudo
-- observar. Nunca implica certeza de que el evento quedó guardado en el calendario
-- del paciente ("Sin calendario registrado", no "no agregó calendario").

alter table public.appointments
	add column if not exists calendar_action_status text not null default 'not_offered'
		check (calendar_action_status in (
			'not_offered',
			'offered',
			'clicked_google',
			'clicked_ics',
			'downloaded_ics',
			'clicked_outlook',
			'clicked_phone_calendar'
		)),
	add column if not exists calendar_provider text
		check (calendar_provider in ('google', 'ics', 'outlook', 'phone_calendar')),
	add column if not exists calendar_offered_at timestamptz,
	add column if not exists calendar_action_at timestamptz,
	add column if not exists calendar_action_count integer not null default 0,
	add column if not exists calendar_sequence integer not null default 0,
	add column if not exists calendar_update_required_at timestamptz,
	add column if not exists whatsapp_reminder_opened_at timestamptz,
	add column if not exists whatsapp_reminder_opened_by uuid,
	add column if not exists whatsapp_reminder_marked_sent_at timestamptz,
	add column if not exists whatsapp_reminder_marked_sent_by uuid;

comment on column public.appointments.calendar_sequence is
	'Versión del evento de calendario. Se incrementa en cada reprogramación; es el SEQUENCE del ICS.';
comment on column public.appointments.calendar_update_required_at is
	'Se setea al reprogramar un turno que ya tenía acción de calendario registrada.';

-- Índice parcial para la ventana de Recordatorios (turnos próximos por negocio).
create index if not exists idx_appointments_reminder_window
	on public.appointments (business_id, starts_at)
	where status in ('reserved', 'confirmed');

-- Transición atómica de acción de calendario: status + provider + timestamps +
-- contador + limpieza de "pendiente de actualizar", en un solo statement para que
-- dos clicks concurrentes no se pisen.
create or replace function public.record_calendar_action(
	p_appointment_id uuid,
	p_action text,
	p_provider text
) returns void
language sql
security definer
set search_path = public
as $$
	update public.appointments
	set
		calendar_action_status = p_action,
		calendar_provider = coalesce(p_provider, calendar_provider),
		calendar_action_at = now(),
		calendar_action_count = calendar_action_count + 1,
		calendar_update_required_at = null,
		updated_at = now()
	where id = p_appointment_id;
$$;

revoke all on function public.record_calendar_action(uuid, text, text) from public;
revoke all on function public.record_calendar_action(uuid, text, text) from anon;
revoke all on function public.record_calendar_action(uuid, text, text) from authenticated;
grant execute on function public.record_calendar_action(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Suscripciones Web Push
-- ---------------------------------------------------------------------------
-- Grano (appointment_id, endpoint): el mismo dispositivo puede pedir recordatorio
-- para varios turnos, y el estado de envío 24h/2h es por turno-dispositivo.
-- endpoint NO es unique global a propósito.

create table if not exists public.push_subscriptions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	appointment_id uuid not null references public.appointments (id) on delete cascade,
	endpoint text not null,
	p256dh text not null,
	auth text not null,
	user_agent text,
	push_24h_claimed_at timestamptz,
	push_24h_sent_at timestamptz,
	push_2h_claimed_at timestamptz,
	push_2h_sent_at timestamptz,
	failed_count integer not null default 0,
	revoked_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (appointment_id, endpoint)
);

-- La revocación por 410 del push service mata el endpoint para TODOS los turnos.
create index if not exists idx_push_subscriptions_endpoint
	on public.push_subscriptions (endpoint);
create index if not exists idx_push_subscriptions_appointment
	on public.push_subscriptions (appointment_id);

alter table public.push_subscriptions enable row level security;
-- Sin policies: solo el service role opera esta tabla (mismo criterio que message_dispatches).
revoke all on table public.push_subscriptions from anon;
revoke all on table public.push_subscriptions from authenticated;

-- Claim atómico de recordatorios push vencidos (espejo de claim_queued_message_dispatches).
-- claimed_at separado de sent_at: si el proceso muere entre claim y envío, el claim
-- vence a los 10 minutos y otro run lo retoma. sent_at solo se marca tras envío exitoso.
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

revoke all on function public.claim_due_push_reminders(timestamptz, integer) from public;
revoke all on function public.claim_due_push_reminders(timestamptz, integer) from anon;
revoke all on function public.claim_due_push_reminders(timestamptz, integer) from authenticated;
grant execute on function public.claim_due_push_reminders(timestamptz, integer) to service_role;
