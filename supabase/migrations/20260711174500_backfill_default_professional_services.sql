-- La pantalla de profesional deja de reparar datos durante una lectura.
-- Completar una sola vez las asignaciones históricas de los dos servicios
-- predeterminados que ya existen en cada consultorio con profesionales.
insert into public.professional_services (business_id, professional_id, service_id)
select
	professional.business_id,
	professional.id,
	service.id
from public.professionals professional
join public.services service
	on service.business_id = professional.business_id
	and lower(trim(service.name)) in ('consulta', 'otro servicio')
on conflict (business_id, professional_id, service_id) do nothing;
