-- Una membresía operativa debe estar aceptada. Sin esta invariancia el RPC de
-- contexto podía mostrar el consultorio mientras RLS ocultaba sus datos.

update public.business_users
set
	accepted_at = coalesce(accepted_at, created_at, now()),
	updated_at = coalesce(updated_at, created_at, now())
where coalesce(status, 'active') = 'active'
	and accepted_at is null;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'business_users_active_requires_accepted_at'
	) then
		alter table public.business_users
			add constraint business_users_active_requires_accepted_at
			check (status <> 'active' or accepted_at is not null);
	end if;
end $$;

create or replace function public.list_user_business_contexts()
returns table (
	business jsonb,
	role text,
	assistance jsonb,
	subscription jsonb
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
	with direct_memberships as (
		select
			bu.business_id,
			bu.role::text as role,
			null::jsonb as assistance,
			bu.created_at as direct_created_at,
			null::timestamptz as assistance_expires_at,
			0 as source_priority
		from public.business_users bu
		where bu.user_id = auth.uid()
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
	),
	assisted_memberships as (
		select
			aag.business_id,
			'admin'::text as role,
			jsonb_build_object(
				'grantId', aag.id,
				'requestedByUserId', aag.requested_by_user_id,
				'supportUserId', aag.support_user_id,
				'startsAt', aag.starts_at,
				'expiresAt', aag.expires_at
			) as assistance,
			null::timestamptz as direct_created_at,
			aag.expires_at as assistance_expires_at,
			1 as source_priority
		from public.account_assistance_grants aag
		join public.account_assistance_support_users support
			on support.user_id = aag.support_user_id
			and support.enabled = true
		where aag.support_user_id = auth.uid()
			and aag.status = 'active'
			and aag.revoked_at is null
			and aag.expires_at > now()
			and public.business_allows_operation(aag.business_id)
			and not exists (
				select 1
				from direct_memberships direct
				where direct.business_id = aag.business_id
			)
	),
	memberships as (
		select * from direct_memberships
		union all
		select * from assisted_memberships
	)
	select
		jsonb_build_object(
			'id', b.id,
			'name', b.name,
			'slug', b.slug,
			'industry', b.industry,
			'phone', b.phone,
			'email', b.email,
			'address', b.address,
			'address_instructions', b.address_instructions,
			'maps_url', b.maps_url,
			'logo_url', b.logo_url,
			'timezone', b.timezone,
			'public_booking_enabled', b.public_booking_enabled,
			'whatsapp_enabled', b.whatsapp_enabled,
			'allow_same_day_booking', b.allow_same_day_booking,
			'min_booking_notice_minutes', b.min_booking_notice_minutes,
			'max_booking_days_ahead', b.max_booking_days_ahead,
			'cancellation_policy', b.cancellation_policy,
			'is_active', b.is_active,
			'created_at', b.created_at,
			'updated_at', b.updated_at
		) as business,
		memberships.role,
		memberships.assistance,
		case when bs.id is null then null else to_jsonb(bs) end as subscription
	from memberships
	join public.businesses b on b.id = memberships.business_id
	left join public.business_subscriptions bs on bs.business_id = memberships.business_id
	order by
		memberships.source_priority,
		memberships.direct_created_at asc nulls last,
		memberships.assistance_expires_at desc nulls last;
$$;

revoke execute on function public.list_user_business_contexts() from public, anon;
grant execute on function public.list_user_business_contexts() to authenticated;

create or replace function public.add_business_user_by_email(
	target_business_id uuid,
	target_email text,
	target_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_target_user_id uuid;
	v_membership_id uuid;
	v_actor uuid := auth.uid();
begin
	if not public.user_can_manage_business(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = lower(trim(target_email))
	limit 1;

	if v_target_user_id is null then
		raise exception 'USER_NOT_FOUND';
	end if;

	insert into business_users (
		business_id,
		user_id,
		role,
		status,
		accepted_at,
		created_by,
		updated_by
	)
	values (
		target_business_id,
		v_target_user_id,
		target_role,
		'active',
		now(),
		v_actor,
		v_actor
	)
	on conflict (business_id, user_id)
	do update set
		role = excluded.role,
		status = 'active',
		accepted_at = coalesce(business_users.accepted_at, now()),
		disabled_at = null,
		disabled_reason = null,
		updated_by = v_actor,
		updated_at = now()
	returning id into v_membership_id;

	return v_membership_id;
end;
$$;

revoke execute on function public.add_business_user_by_email(uuid, text, text) from public, anon;
grant execute on function public.add_business_user_by_email(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
