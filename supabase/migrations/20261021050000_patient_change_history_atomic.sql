-- A patient's visible change history is written in the same transaction as the change
-- it describes. Before, the application inserted it afterwards with the service role and
-- only logged a failure, so a saved change could lose its history line.
--
-- The wording (field labels, summary, the author's display name) belongs to the
-- application; the database records it only together with the change, and checks that
-- the professional profile named as author is the actor's own. The previous signature is
-- kept for the deploy transition, since a running application still calls it; drop it
-- once every deployed version calls this one.
create or replace function public.update_patient_with_clinical_profile_safely(
	p_actor_id uuid,
	p_business_id uuid,
	p_patient_id uuid,
	p_full_name text,
	p_dni text,
	p_phone text,
	p_phone_raw text,
	p_phone_e164 text,
	p_email text,
	p_birth_date date,
	p_address text,
	p_insurance text,
	p_insurance_plan text,
	p_changed_fields text[],
	p_change_summary text,
	p_changed_by_professional_id uuid,
	p_changed_by_name text,
	p_update_clinical_profile boolean default false,
	p_allergies text default null,
	p_medication text default null,
	p_background text default null,
	p_expected_patient_updated_at timestamptz default null,
	p_expected_clinical_profile_updated_at timestamptz default null
)
returns table(
	patient_id uuid,
	patient_updated_at timestamptz,
	clinical_profile_id uuid,
	clinical_profile_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
	v_actor uuid := coalesce(p_actor_id, auth.uid());
	v_saved record;
begin
	if p_changed_by_professional_id is not null and not exists (
		select 1
		from public.professional_users pu
		where pu.business_id = p_business_id
			and pu.professional_id = p_changed_by_professional_id
			and pu.user_id = v_actor
	) then
		raise exception 'PATIENT_UPDATE_DENIED';
	end if;
	if coalesce(cardinality(p_changed_fields), 0) > 0 and (
		nullif(trim(coalesce(p_change_summary, '')), '') is null
		or nullif(trim(coalesce(p_changed_by_name, '')), '') is null
	) then
		raise exception 'PATIENT_CHANGE_HISTORY_INVALID';
	end if;

	-- The previous signature keeps every check, lock and write of the update itself.
	select *
	into v_saved
	from public.update_patient_with_clinical_profile_safely(
		p_actor_id, p_business_id, p_patient_id, p_full_name, p_dni, p_phone, p_phone_raw,
		p_phone_e164, p_email, p_birth_date, p_address, p_insurance, p_insurance_plan,
		p_update_clinical_profile, p_allergies, p_medication, p_background,
		p_expected_patient_updated_at, p_expected_clinical_profile_updated_at
	);

	if coalesce(cardinality(p_changed_fields), 0) > 0 then
		insert into public.patient_profile_change_events (
			business_id,
			patient_id,
			changed_by_user_id,
			changed_by_professional_id,
			changed_by_name,
			changed_fields,
			summary
		)
		values (
			p_business_id,
			p_patient_id,
			v_actor,
			p_changed_by_professional_id,
			p_changed_by_name,
			to_jsonb(p_changed_fields),
			p_change_summary
		);
	end if;

	return query
	select v_saved.patient_id, v_saved.patient_updated_at, v_saved.clinical_profile_id, v_saved.clinical_profile_updated_at;
end;
$$;

revoke all on function public.update_patient_with_clinical_profile_safely(
	uuid, uuid, uuid, text, text, text, text, text, text, date, text, text, text,
	text[], text, uuid, text, boolean, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_patient_with_clinical_profile_safely(
	uuid, uuid, uuid, text, text, text, text, text, text, date, text, text, text,
	text[], text, uuid, text, boolean, text, text, text, timestamptz, timestamptz
) to service_role;

notify pgrst, 'reload schema';
