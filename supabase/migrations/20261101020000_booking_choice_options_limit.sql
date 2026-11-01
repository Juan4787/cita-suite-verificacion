-- Plan de señas y avisos, 12.16: una pregunta de opciones admite hasta 40 (antes 20). La lista de
-- obras sociales de un consultorio supera 20: la de Natalia tiene 24. El mismo límite está en
-- BOOKING_CHOICE_OPTIONS_MAX (packages/shared/src/booking-integration.ts). Es la definición de
-- 20261013000000_booking_integration_foundation.sql con ese único cambio; reemplazarla conserva
-- su dueño y sus permisos, y las restricciones que la usan siguen valiendo para las filas existentes.
begin;
create or replace function private.booking_intake_schema_valid(p_schema jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare f jsonb; opt jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(p_schema) is distinct from 'array' or octet_length(p_schema::text) > 16384 then return false; end if;
  if jsonb_array_length(p_schema) > 24 then return false; end if;
  for f in select value from jsonb_array_elements(p_schema) loop
    if jsonb_typeof(f) is distinct from 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(f) k where k not in ('id','label','kind','required','help','maxLength','options')) then return false; end if;
    if not coalesce(f->>'id' ~ '^[a-z][a-z0-9_]{0,47}$',false) or f->>'id' in ('constructor','prototype') or f->>'id' = any(ids) then return false; end if;
    ids := array_append(ids,f->>'id');
    if jsonb_typeof(f->'label') is distinct from 'string' or length(trim(f->>'label')) = 0 or length(f->>'label') > 120 then return false; end if;
    if not coalesce(f->>'kind' in ('text','textarea','boolean','choice'),false) or jsonb_typeof(f->'required') is distinct from 'boolean' then return false; end if;
    if f ? 'help' and (jsonb_typeof(f->'help') is distinct from 'string' or length(f->>'help') > 300) then return false; end if;
    if f->>'kind' in ('text','textarea') then
      if not coalesce(f->>'maxLength' ~ '^[0-9]+$',false) then return false; end if;
      if (f->>'maxLength')::numeric < 1 or (f->>'maxLength')::numeric > 2000 then return false; end if;
    elsif f ? 'maxLength' then return false;
    end if;
    if f->>'kind' = 'choice' then
      if jsonb_typeof(f->'options') is distinct from 'array' then return false; end if;
      if jsonb_array_length(f->'options') < 1 or jsonb_array_length(f->'options') > 40 then return false; end if;
      for opt in select value from jsonb_array_elements(f->'options') loop
        if jsonb_typeof(opt) is distinct from 'string' or length(trim(opt #>> '{}')) = 0 or length(opt #>> '{}') > 120 then return false; end if;
      end loop;
      if (select count(distinct value) from jsonb_array_elements(f->'options')) <> jsonb_array_length(f->'options') then return false; end if;
    elsif f ? 'options' then return false;
    end if;
  end loop;
  return true;
end $$;
commit;
