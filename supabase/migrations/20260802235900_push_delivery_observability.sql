-- Observabilidad real para Web Push.
--
-- `push_subscriptions.*_sent_at` significa que el servicio push acepto el mensaje;
-- no demuestra que el navegador lo recibio ni que intento mostrarlo. Esta tabla
-- registra esas etapas por separado y permite una prueba inmediata al activar.

create table if not exists public.push_delivery_attempts (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	appointment_id uuid not null,
	subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
	kind text not null check (kind in ('test', '24h', '2h', 'reschedule')),
	receipt_token_hash text not null,
	push_service_status integer check (
		push_service_status is null or push_service_status between 100 and 599
	),
	accepted_at timestamptz,
	received_at timestamptz,
	displayed_at timestamptz,
	user_confirmed_at timestamptz,
	user_reported_missing_at timestamptz,
	superseded_at timestamptz,
	failed_at timestamptz,
	failure_kind text check (
		failure_kind is null or failure_kind in ('gone', 'rejected', 'transient')
	),
	expires_at timestamptz not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (business_id, appointment_id)
		references public.appointments (business_id, id)
		on delete cascade,
	check (user_confirmed_at is null or user_reported_missing_at is null)
);

comment on table public.push_delivery_attempts is
	'Etapas tecnicas de cada Web Push: aceptado por el proveedor, recibido por el service worker, mostrado y confirmado por la persona.';
comment on column public.push_delivery_attempts.receipt_token_hash is
	'SHA-256 de un secreto aleatorio incluido solamente dentro del payload cifrado del push.';

create index if not exists idx_push_delivery_attempts_subscription_created
	on public.push_delivery_attempts (subscription_id, created_at desc);
create index if not exists idx_push_delivery_attempts_appointment_created
	on public.push_delivery_attempts (appointment_id, created_at desc);
create index if not exists idx_push_delivery_attempts_created
	on public.push_delivery_attempts (created_at);

alter table public.push_delivery_attempts enable row level security;
-- Sin policies: contiene telemetria tecnica privada y solo la opera service_role.
revoke all on table public.push_delivery_attempts from anon;
revoke all on table public.push_delivery_attempts from authenticated;

-- Una reprogramación invalida también la telemetría del horario anterior. El
-- trigger existente ya reiniciaba atómicamente los flags 24h/2h; se amplía en la
-- misma función para distinguir un aviso obsoleto de uno realmente pendiente.
create or replace function public.reset_push_reminders_on_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update push_subscriptions
	set push_24h_claimed_at = null,
		push_24h_sent_at = null,
		push_2h_claimed_at = null,
		push_2h_sent_at = null,
		updated_at = now()
	where appointment_id = new.id
		and revoked_at is null;

	update push_delivery_attempts
	set superseded_at = now(),
		updated_at = now()
	where appointment_id = new.id
		and kind <> 'test'
		and superseded_at is null;

	return new;
end;
$$;
