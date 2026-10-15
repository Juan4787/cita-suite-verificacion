-- The public capacity is keyed by full name. Ignore harmless formatting,
-- casing and Spanish vowel accents, while preserving ñ as a distinct letter.
-- This prevents Carlos Giménez / carlos gimenez from receiving separate caps
-- without merging genuinely different surnames such as Peña / Pena.

create or replace function public.normalized_patient_name(value text)
returns text
language sql
immutable
set search_path = public
as $$
	select nullif(
		regexp_replace(
			translate(
				lower(trim(coalesce(value, ''))),
				'áàâäãåéèêëíìîïóòôöõúùûüýÿ',
				'aaaaaaeeeeiiiiooooouuuuyy'
			),
			'\s+',
			' ',
			'g'
		),
		''
	);
$$;

-- Expression indexes store the old function result, so rebuilding is required
-- after changing the normalization function.
drop index if exists public.patients_business_normalized_name_idx;
create index patients_business_normalized_name_idx
	on public.patients (business_id, public.normalized_patient_name(full_name));

revoke execute on function public.normalized_patient_name(text) from public, anon;
grant execute on function public.normalized_patient_name(text) to authenticated, service_role;

notify pgrst, 'reload schema';
