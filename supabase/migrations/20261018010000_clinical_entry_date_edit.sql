-- Compatible clinical editing contract: retain the old RPC and its authorization
-- and cost rules, while making the date field's actual effect explicit.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.update_clinical_entry_with_date_safely(
 p_business_id uuid,
 p_patient_id uuid,
 p_entry_id uuid,
 p_entry_type text,
 p_description text,
 p_created_at timestamptz,
 p_teeth text default null,
 p_internal_note text default null,
 p_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,pg_temp
as $function$
declare
 v_existing_created_at timestamptz;
begin
 -- This call locks the entry and retains every existing role, business,
 -- patient-link, authorship, lock-window and cost check in one authority.
 perform public.update_clinical_entry_safely(p_business_id,p_patient_id,p_entry_id,
  p_entry_type,p_description,p_teeth,p_internal_note,p_amount);
 if p_created_at is null then return; end if;
 if public.user_business_role(p_business_id) in ('owner','admin') then
  if not isfinite(p_created_at) or p_created_at>now()+interval '5 minutes' then
   raise exception 'INVALID_CLINICAL_ENTRY_DATE';
  end if;
  update public.clinical_entries set created_at=p_created_at
   where business_id=p_business_id and patient_id=p_patient_id and id=p_entry_id;
 else
  -- Professionals keep the real creation instant. Minute-only form precision
  -- must not erase seconds or extend the immutable editing deadline.
  select created_at into v_existing_created_at from public.clinical_entries
   where business_id=p_business_id and patient_id=p_patient_id and id=p_entry_id;
  if date_trunc('minute',p_created_at) is distinct from date_trunc('minute',v_existing_created_at) then
   raise exception 'CLINICAL_ENTRY_DATE_EDIT_DENIED';
  end if;
 end if;
end;
$function$;
revoke all on function public.update_clinical_entry_with_date_safely(uuid,uuid,uuid,text,text,timestamptz,text,text,numeric) from public,anon;
grant execute on function public.update_clinical_entry_with_date_safely(uuid,uuid,uuid,text,text,timestamptz,text,text,numeric) to authenticated;
comment on function public.update_clinical_entry_with_date_safely(uuid,uuid,uuid,text,text,timestamptz,text,text,numeric)
 is 'Compatible date-aware clinical edit; delegates existing authorization and preserves provenance and professional lock deadlines.';
notify pgrst,'reload schema';
commit;
