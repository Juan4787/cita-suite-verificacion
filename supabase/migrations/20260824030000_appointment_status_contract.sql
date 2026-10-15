-- Retira del dominio del turno los estados que pretendían afirmar presencia
-- física. El paso natural del tiempo no escribe ningún estado nuevo.

begin;

-- Históricos: se conserva solamente la confirmación real que ya existía. Si
-- nunca se confirmó, el turno vuelve al estado neutral reservado. La fecha hace
-- que un turno pasado deje de estar activo sin inferir qué ocurrió físicamente.
update public.appointments appointment
set
	status = case when appointment.confirmed_at is null then 'reserved' else 'confirmed' end,
	updated_at = statement_timestamp()
where appointment.status in ('attended', 'no_show');

update public.appointment_professionals allocation
set
	status = appointment.status,
	updated_at = statement_timestamp()
from public.appointments appointment
where appointment.id = allocation.appointment_id
	and allocation.status in ('attended', 'no_show');

-- Esos valores tampoco deben reaparecer en el historial visible. Se mantiene la
-- existencia de una actualización, pero se elimina la afirmación de presencia y
-- cualquier transición que la contuviera.
update public.audit_logs log
set
	action = case
		when log.action in ('appointment.attended', 'appointment.no_show')
			then 'appointment.updated'
		else log.action
	end,
	metadata = case
		when log.metadata is null then null
		else log.metadata - 'from_status' - 'to_status'
	end
where log.action in ('appointment.attended', 'appointment.no_show')
	or log.metadata ->> 'from_status' in ('attended', 'no_show')
	or log.metadata ->> 'to_status' in ('attended', 'no_show');

alter table public.appointments
	drop constraint if exists appointments_status_check;
alter table public.appointments
	add constraint appointments_status_check
	check (status in ('reserved', 'confirmed', 'cancelled', 'reschedule_requested'));

alter table public.appointment_professionals
	drop constraint if exists appointment_professionals_status_check;
alter table public.appointment_professionals
	add constraint appointment_professionals_status_check
	check (status in ('reserved', 'confirmed', 'cancelled', 'reschedule_requested'));

drop function if exists public.professional_update_appointment_status(uuid, uuid, text);

alter table public.appointments
	drop column if exists attended_at,
	drop column if exists no_show_at;

notify pgrst, 'reload schema';

commit;
