-- Keep the role-management audit helper present in the migration chain. The
-- parameter names and dedicated result/reason columns are part of the current
-- database contract, so this remains idempotent on environments that already
-- received the helper through an earlier manual repair.

create or replace function public.audit_security_event(
	p_business_id uuid,
	p_user_id uuid,
	p_action text,
	p_entity_type text,
	p_entity_id uuid,
	p_result text,
	p_reason_code text,
	p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		reason_code,
		metadata
	)
	values (
		p_business_id,
		p_user_id,
		p_action,
		p_entity_type,
		p_entity_id,
		case when p_result in ('success', 'blocked', 'error') then p_result else 'error' end,
		nullif(trim(coalesce(p_reason_code, '')), ''),
		coalesce(p_metadata, '{}'::jsonb)
	);
end;
$$;

revoke execute on function public.audit_security_event(uuid, uuid, text, text, uuid, text, text, jsonb)
	from public, anon, authenticated;

notify pgrst, 'reload schema';
