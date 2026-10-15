-- Performance de la reserva pública (y de la agenda interna): el cálculo de
-- disponibilidad consulta `appointments` filtrando por el RANGO DE BLOQUEO
-- (blocking_starts_at / blocking_ends_at), no por starts_at. Los índices
-- existentes son sobre starts_at, así que esa consulta no tenía índice por el
-- rango real y, con muchos turnos, leía de más en cada escaneo de slots.
--
-- Patrón de la query (lib/server/availability.ts):
--   business_id = X
--   and blocking_starts_at < rangeEnd
--   and blocking_ends_at   > rangeStart
--
-- El índice (business_id, blocking_starts_at, blocking_ends_at) permite un
-- range-scan acotado a la ventana en lugar de escanear todos los turnos del
-- negocio/profesional. No cambia ningún comportamiento.

create index if not exists appointments_business_blocking_range_idx
	on public.appointments (business_id, blocking_starts_at, blocking_ends_at);
