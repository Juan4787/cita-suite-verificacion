begin;
-- Compatible correction: preserve the function OID, privileges and trigger
-- dependencies. Existing child/business locks keep their order. No data rewrite.
create or replace function private.advance_availability_configuration() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare old_business uuid; new_business uuid; affected uuid;
begin
  if tg_table_name='businesses' then
    old_business:=old.id; new_business:=new.id;
  else
    if tg_op<>'INSERT' then old_business:=old.business_id; end if;
    if tg_op<>'DELETE' then new_business:=new.business_id; end if;
  end if;
  -- Deterministic order also covers a privileged transfer between businesses.
  for affected in select distinct id from unnest(array[old_business,new_business]) id where id is not null order by id loop
    -- Match existing configuration writers: business first, then its revision.
    -- Otherwise a business edit and a service edit could invert these locks.
    -- FK checks on child inserts already hold KEY SHARE on this business.
    -- NO KEY UPDATE serializes configuration writers while remaining compatible
    -- with those FK locks; upgrading both insert transactions to UPDATE deadlocks.
    -- This function never changes the business key.
    perform 1 from public.businesses where id=affected for no key update;
    update private.availability_configuration_versions set revision=revision+1 where business_id=affected;
  end loop;
  return null;
end $$;
commit;
