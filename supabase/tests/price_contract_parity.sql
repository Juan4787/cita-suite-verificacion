-- Same input/expected JSON as price-parity.test.ts. Real numeric arithmetic,
-- private production calculator, synthetic rows, whole transaction rolled back.
begin;
select extensions.plan(jsonb_array_length(current_setting('cita.test_price_vectors')::jsonb));
create function pg_temp.price_vector_results(v jsonb) returns jsonb language plpgsql as $$
declare
  business uuid:=gen_random_uuid(); service uuid:=gen_random_uuid();
  policy public.service_price_policies%rowtype; adjustment jsonb;
  quoted_month date; amount bigint; result jsonb:='[]';
begin
  insert into public.businesses(id,name,slug,industry)
    values(business,'Synthetic price parity',business::text,'other');
  insert into public.services(id,business_id,name,duration_minutes)
    values(service,business,'Synthetic price parity',30);
  insert into public.service_price_policies(business_id,service_id,base_amount,base_month,first_adjustment_month,monthly_percentage,rounding_unit)
    values(business,service,(v->>'base')::bigint,((v->>'baseMonth')||'-01')::date,
      ((v->>'firstMonth')||'-01')::date,(v->>'monthly')::numeric,(v->>'rounding')::integer)
    returning * into policy;
  for adjustment in select value from jsonb_array_elements(v->'adjustments') loop
    insert into public.service_price_monthly_adjustments(business_id,policy_id,month,kind,percentage)
      values(business,policy.id,(adjustment->>'month')::date,adjustment->>'kind',(adjustment->>'percentage')::numeric);
  end loop;
  for offset_index in 0..(v->>'count')::integer-1 loop
    quoted_month:=(((v->>'startMonth')||'-01')::date+make_interval(months=>offset_index))::date;
    amount:=private.calculate_policy_monthly_amount(policy,quoted_month);
    result:=result||jsonb_build_array(jsonb_build_object('month',to_char(quoted_month,'YYYY-MM'),'amount',amount));
  end loop;
  return result;
end $$;
select case when v->>'error' is not null then
  extensions.throws_ok(format('select pg_temp.price_vector_results(%L::jsonb)',v::text),'P0001',v->>'error',v->>'name')
else extensions.is(pg_temp.price_vector_results(v),v->'expected',v->>'name') end
from jsonb_array_elements(current_setting('cita.test_price_vectors')::jsonb) v;
select * from extensions.finish();
rollback;
