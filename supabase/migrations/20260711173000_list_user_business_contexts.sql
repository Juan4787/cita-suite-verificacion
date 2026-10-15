-- Contexto multi-tenant en un único viaje PostgREST.
-- Mantiene la misma precedencia que el servidor: membresías directas primero,
-- ayudas temporales después y nunca duplica un consultorio ya asociado.
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

notify pgrst, 'reload schema';
