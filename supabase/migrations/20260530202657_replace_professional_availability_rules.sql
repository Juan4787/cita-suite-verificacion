create or replace function public.replace_professional_availability_rules(
	p_business_id uuid,
	p_professional_id uuid,
	p_weekdays int[],
	p_ranges jsonb,
	p_slot_interval_minutes int
)
returns setof public.availability_rules
language plpgsql
security invoker
set search_path = public
as $$
begin
	if p_business_id is null or p_professional_id is null then
		raise exception 'INVALID_PROFESSIONAL';
	end if;

	if p_weekdays is null or array_length(p_weekdays, 1) is null then
		raise exception 'NO_WEEKDAYS';
	end if;

	if exists (
		select 1
		from unnest(p_weekdays) as weekday
		where weekday < 0 or weekday > 6
	) then
		raise exception 'INVALID_WEEKDAY';
	end if;

	if p_slot_interval_minutes is null or p_slot_interval_minutes < 5 or p_slot_interval_minutes > 120 then
		raise exception 'INVALID_SLOT_INTERVAL';
	end if;

	if coalesce(jsonb_typeof(p_ranges), '') <> 'array' or jsonb_array_length(p_ranges) = 0 then
		raise exception 'NO_RANGES';
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
		where range_row.start_time is null
			or range_row.end_time is null
			or range_row.start_time >= range_row.end_time
	) then
		raise exception 'INVALID_RANGE';
	end if;

	if exists (
		with parsed_ranges as (
			select
				range_row.start_time,
				range_row.end_time,
				lag(range_row.end_time) over (order by range_row.start_time, range_row.end_time) as previous_end
			from jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
		)
		select 1
		from parsed_ranges
		where previous_end is not null
			and start_time < previous_end
	) then
		raise exception 'OVERLAPPING_RANGES';
	end if;

	delete from public.availability_rules
	where business_id = p_business_id
		and professional_id = p_professional_id
		and weekday in (select distinct weekday from unnest(p_weekdays) as weekdays(weekday));

	return query
	insert into public.availability_rules (
		business_id,
		professional_id,
		weekday,
		start_time,
		end_time,
		slot_interval_minutes,
		is_active
	)
	select
		p_business_id,
		p_professional_id,
		weekdays.weekday,
		range_row.start_time,
		range_row.end_time,
		p_slot_interval_minutes,
		true
	from (select distinct weekday from unnest(p_weekdays) as weekdays(weekday)) as weekdays
	cross join jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
	returning *;
end;
$$;

grant execute on function public.replace_professional_availability_rules(uuid, uuid, int[], jsonb, int)
	to authenticated, service_role;

notify pgrst, 'reload schema';
