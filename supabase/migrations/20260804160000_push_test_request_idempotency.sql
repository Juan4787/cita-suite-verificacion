-- Una misma acción visible puede generar varios eventos de foco/visibilidad al
-- volver de Ajustes. La clave opaca del cliente identifica la prueba lógica y
-- garantiza en base de datos que sólo se entregue una vez.

alter table public.push_delivery_attempts
	add column if not exists request_key_hash text;

alter table public.push_delivery_attempts
	drop constraint if exists push_delivery_attempts_request_key_hash_format;

alter table public.push_delivery_attempts
	add constraint push_delivery_attempts_request_key_hash_format
	check (request_key_hash is null or request_key_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists push_delivery_attempts_test_request_key_unique
	on public.push_delivery_attempts (subscription_id, request_key_hash)
	where kind = 'test' and request_key_hash is not null;

comment on column public.push_delivery_attempts.request_key_hash is
	'SHA-256 de la clave opaca de una prueba lógica; evita reenvíos por eventos repetidos del cliente.';
