-- Plan de señas y avisos, 12.16: Natalia es médica y no había un rubro que lo dijera. Agrega
-- «medicine» a los rubros permitidos (la app lo agrega en BUSINESS_INDUSTRIES). No cambia el rubro de
-- ningún consultorio: la dueña lo elige en Configuración → Negocio.
begin;
alter table public.businesses drop constraint businesses_industry_check;
alter table public.businesses add constraint businesses_industry_check
	check (industry = any (array['odontology', 'aesthetics', 'kinesiology', 'medicine', 'nutrition', 'therapy', 'other']::text[]));
commit;
