-- Reseteo ATÓMICO de avisos push al reprogramar: hasta ahora la app limpiaba los
-- flags 24h/2h en un paso best-effort posterior al update del turno; si ese paso
-- fallaba, el paciente perdía el recordatorio del horario nuevo (el job no reenvía
-- si sent_at quedó marcado). Con este trigger la limpieza viaja en la MISMA
-- transacción que el cambio de horario, para cualquier camino presente o futuro
-- que toque starts_at. No revive suscripciones revocadas (endpoint muerto).
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
	return new;
end;
$$;

drop trigger if exists appointments_reset_push_reminders on appointments;
create trigger appointments_reset_push_reminders
	after update of starts_at on appointments
	for each row
	when (new.starts_at is distinct from old.starts_at)
	execute function public.reset_push_reminders_on_reschedule();
