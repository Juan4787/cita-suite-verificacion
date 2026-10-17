begin;
-- Preserve the existing signature, exact compounding, ACL and historical
-- snapshots. Validate the final rounded amount too, including month zero.
create or replace function private.calculate_policy_monthly_amount(policy public.service_price_policies,p_date date)
returns bigint language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare selected_month date; months integer; fee numeric; cursor_month date; monthly numeric; quoted bigint;
begin
  selected_month:=date_trunc('month',p_date)::date;
  if p_date is null or selected_month<policy.base_month then raise exception 'PRICE_DATE_INVALID'; end if;
  months:=(extract(year from selected_month)-extract(year from policy.base_month))::integer*12
    +(extract(month from selected_month)-extract(month from policy.base_month))::integer;
  if months>600 then raise exception 'PRICE_DATE_INVALID'; end if;
  fee:=policy.base_amount; cursor_month:=policy.base_month;
  while cursor_month<selected_month loop
    cursor_month:=(cursor_month+interval '1 month')::date;
    monthly:=case when cursor_month<policy.first_adjustment_month then 0 else policy.monthly_percentage end;
    if cursor_month>=policy.first_adjustment_month then
      select coalesce((select a.percentage from public.service_price_monthly_adjustments a
        where a.policy_id=policy.id and a.kind='default' and a.month<=cursor_month
        order by a.month desc limit 1),monthly) into monthly;
    end if;
    select coalesce((select a.percentage from public.service_price_monthly_adjustments a
      where a.policy_id=policy.id and a.kind='override' and a.month=cursor_month),monthly) into monthly;
    fee:=trim_scale(fee*(1+monthly*0.01));
    if fee>1000000000000 then raise exception 'PRICE_AMOUNT_INVALID'; end if;
  end loop;
  quoted:=((div(fee,policy.rounding_unit)+case when mod(fee,policy.rounding_unit)*2>=policy.rounding_unit
    then 1 else 0 end)*policy.rounding_unit)::bigint;
  if quoted>1000000000000 then raise exception 'PRICE_AMOUNT_INVALID'; end if;
  return quoted;
end $$;
revoke all on function private.calculate_policy_monthly_amount(public.service_price_policies,date)
  from public,anon,authenticated,service_role;
commit;
