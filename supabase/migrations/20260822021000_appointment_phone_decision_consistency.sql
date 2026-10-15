-- La advertencia aceptada y el estado del teléfono forman una sola decisión.
-- Evita estados parciales incluso si una escritura futura no pasa por la aplicación.
begin;

alter table public.appointments
	drop constraint if exists appointments_phone_warning_decision_consistency_check;

alter table public.appointments
	add constraint appointments_phone_warning_decision_consistency_check
	check (
		(
			phone_communication_status_at_booking in ('missing', 'invalid')
			and phone_warning_acknowledged_at is not null
		)
		or
		(
			phone_communication_status_at_booking in ('unknown', 'valid')
			and phone_warning_acknowledged_at is null
		)
	);

commit;
