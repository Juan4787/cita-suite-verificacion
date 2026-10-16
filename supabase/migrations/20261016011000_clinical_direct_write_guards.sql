-- Preserve clinical authorship and enforce existing clinical write roles at SQL.
-- Historical records and safe professional RPCs are preserved. Read policies
-- enforce the declared roles and retain authorized restricted historical read.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Access is determined by actual validity dates, not the last scheduler label.
-- This matches getBusinessAccessState even if maintenance has not run yet.
create or replace function public.business_allows_owner_restricted_read(target_business_id uuid)
returns boolean
language sql
security definer
set search_path='pg_catalog'
as $function$
 select coalesce((
  select bs.archived_at is null and bs.commercial_access_enabled=true and (
   bs.is_permanent=true
   or (bs.paid_until is not null and now()<=bs.paid_until)
   or (bs.grace_until is not null and now()<=bs.grace_until)
   or (bs.restricted_until is not null and now()<=bs.restricted_until)
  ) from public.business_subscriptions bs where bs.business_id=target_business_id
 ),public.business_allows_operation(target_business_id));
$function$;
revoke execute on function public.business_allows_owner_restricted_read(uuid) from public,anon;
grant execute on function public.business_allows_owner_restricted_read(uuid) to authenticated,service_role;

-- Direct table writes must not grant reception a capability denied by the
-- application and the clinical RPC. Professional writes remain on safe RPCs.
alter policy clinical_entries_business_operator_insert on public.clinical_entries
 with check (business_id is not null and public.user_can_operate_business(business_id)
  and public.user_business_role(business_id) in ('owner','admin')
  and exists (select 1 from public.patients p where p.id=clinical_entries.patient_id and p.business_id=clinical_entries.business_id));
alter policy clinical_entries_business_operator_update on public.clinical_entries
 using (business_id is not null and public.user_can_operate_business(business_id) and public.user_business_role(business_id) in ('owner','admin'))
 with check (business_id is not null and public.user_can_operate_business(business_id)
  and public.user_business_role(business_id) in ('owner','admin')
  and exists (select 1 from public.patients p where p.id=clinical_entries.patient_id and p.business_id=clinical_entries.business_id));
alter policy clinical_entries_business_operator_delete on public.clinical_entries
 using (business_id is not null and public.user_can_operate_business(business_id) and public.user_business_role(business_id) in ('owner','admin'));

-- The role offered in Equipo explicitly excludes clinical history for
-- reception. Preserve every other existing reader and its historical scope.
alter policy clinical_entries_role_scoped_select on public.clinical_entries
 using (business_id is not null and public.user_can_read_patient(business_id,patient_id)
  and coalesce(public.user_business_role(business_id),'') <> 'reception');

-- Historical read permissions do not grant write capability. Do not broaden
-- user_can_view_costs/user_can_read_clinical_patient, which write RPCs also use.
alter policy patient_clinical_profiles_select on public.patient_clinical_profiles
 using (public.user_can_read_clinical_patient(business_id,patient_id)
  or (public.user_business_role(business_id) in ('owner','admin') and public.user_can_read_basic_patient(business_id,patient_id)));
alter policy clinical_entry_costs_select on public.clinical_entry_costs
 using (public.user_business_role(business_id) in ('owner','admin') and public.business_allows_owner_restricted_read(business_id));

CREATE OR REPLACE FUNCTION public.set_clinical_entry_actor_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
	v_role text;
	v_professional_id uuid;
begin
	if tg_op = 'INSERT' then
		if auth.uid() is not null then
			v_role := public.user_business_role(new.business_id);
			new.owner_id := auth.uid();
			new.created_by_user_id := auth.uid();

			if v_role = 'professional' then
				v_professional_id := public.current_user_professional_id(new.business_id);
				if v_professional_id is null then
					raise exception 'PROFESSIONAL_LINK_REQUIRED';
				end if;
				new.created_at := now();
				new.created_by_professional_id := v_professional_id;
			else
				if v_role in ('owner', 'admin') and new.created_at > now() + interval '5 minutes' then
					raise exception 'INVALID_CLINICAL_ENTRY_DATE';
				end if;
				new.created_by_professional_id := null;
			end if;
		end if;
		new.created_at := coalesce(new.created_at, now());
		new.locked_after := coalesce(new.locked_after, new.created_at + interval '24 hours');
	end if;

	if tg_op = 'UPDATE' and auth.uid() is not null then
		if new.created_by_user_id is distinct from old.created_by_user_id
			or new.created_by_professional_id is distinct from old.created_by_professional_id
			or new.owner_id is distinct from old.owner_id then
			raise exception using errcode = '42501', message = 'CLINICAL_PROVENANCE_IMMUTABLE';
		end if;
		new.updated_by_user_id := auth.uid();
	end if;

	-- This is a historical author reference, not a live FK: deleting an old
	-- professional must not erase provenance or prevent content corrections.
	-- A newly assigned reference must still belong to the same clinic.
	if new.created_by_professional_id is not null then
		if tg_op = 'INSERT' then
			if not exists (select 1 from public.professionals p where p.id = new.created_by_professional_id and p.business_id = new.business_id) then
				raise exception using errcode = '23503', message = 'CLINICAL_AUTHOR_TENANT_MISMATCH';
			end if;
		elsif new.created_by_professional_id is distinct from old.created_by_professional_id
			or new.business_id is distinct from old.business_id then
			if not exists (select 1 from public.professionals p where p.id = new.created_by_professional_id and p.business_id = new.business_id) then
				raise exception using errcode = '23503', message = 'CLINICAL_AUTHOR_TENANT_MISMATCH';
			end if;
		end if;
	end if;
	return new;
end;
$function$;

revoke all on function public.set_clinical_entry_actor_fields() from public,anon,authenticated;
grant execute on function public.set_clinical_entry_actor_fields() to service_role;
notify pgrst,'reload schema';
commit;
