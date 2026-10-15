-- min_booking_notice_minutes existía desde el inicio (default 1440) pero NUNCA se
-- aplicó en la disponibilidad: el comportamiento vivo siempre fue "sin anticipación
-- mínima". A partir de ahora el motor de disponibilidad pública SÍ lo aplica, así que
-- antes de eso se normalizan a 0 las filas que quedaron con el default nunca usado,
-- para no cambiar de golpe el comportamiento de negocios ya operativos. El valor se
-- configura desde Configuración → Negocio.
update businesses
set min_booking_notice_minutes = 0
where min_booking_notice_minutes = 1440;

alter table businesses alter column min_booking_notice_minutes set default 0;

do $$
begin
	if not exists (
		select 1 from pg_constraint where conname = 'businesses_min_booking_notice_minutes_check'
	) then
		alter table businesses
			add constraint businesses_min_booking_notice_minutes_check
			check (min_booking_notice_minutes >= 0 and min_booking_notice_minutes <= 10080);
	end if;
end $$;
