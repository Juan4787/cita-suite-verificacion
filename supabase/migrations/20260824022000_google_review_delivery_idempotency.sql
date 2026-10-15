-- Endurece la frontera entre la cola durable y Web Push. Una solicitud de
-- reseña identifica su intento vigente y, si el proveedor ya lo aceptó, el
-- worker puede completar el estado sin volver a enviarlo.

begin;

alter table public.push_delivery_attempts
	add column if not exists google_review_request_id uuid
		references public.google_review_requests (id) on delete set null;

alter table public.push_delivery_attempts
	drop constraint if exists push_delivery_attempts_review_identity_check;
alter table public.push_delivery_attempts
	add constraint push_delivery_attempts_review_identity_check
	check (google_review_request_id is null or kind = 'review');

create unique index if not exists push_delivery_attempts_live_review_request_uq
	on public.push_delivery_attempts (google_review_request_id)
	where google_review_request_id is not null and failed_at is null;

create index if not exists google_review_requests_expired_claim_idx
	on public.google_review_requests (claim_expires_at, id)
	where status = 'claimed';

comment on column public.push_delivery_attempts.google_review_request_id is
	'Identidad idempotente de la solicitud de resena. Un intento aceptado se reconcilia y nunca se reenvia.';

create or replace function public.recover_expired_google_review_request_claims(
	recover_time timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_count integer := 0;
begin
	if recover_time is null then
		return 0;
	end if;

	with recovered as (
		update public.google_review_requests request
		set
			status = 'pending',
			status_reason = 'claim_expired',
			claim_token = null,
			claimed_at = null,
			claim_expires_at = null,
			next_attempt_at = recover_time,
			updated_at = recover_time
		where request.status = 'claimed'
			and request.claim_expires_at <= recover_time
		returning request.id, request.business_id, request.patient_id
	), released as (
		update public.google_review_patient_delivery_state state
		set
			active_request_id = null,
			claim_expires_at = null,
			updated_at = recover_time
		from recovered
		where state.business_id = recovered.business_id
			and state.patient_id = recovered.patient_id
			and state.active_request_id = recovered.id
		returning state.business_id
	)
	select count(*)::integer into v_count from recovered;

	return v_count;
end;
$$;

revoke all on function public.recover_expired_google_review_request_claims(timestamptz)
	from public, anon, authenticated;
grant execute on function public.recover_expired_google_review_request_claims(timestamptz)
	to service_role;

create or replace function public.complete_google_review_request(
	target_request_id uuid,
	target_claim_token uuid,
	target_push_delivery_id uuid,
	target_push_service_status integer,
	complete_time timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_request public.google_review_requests%rowtype;
begin
	if target_push_delivery_id is null or complete_time is null then
		return false;
	end if;

	select request.*
	into v_request
	from public.google_review_requests request
	where request.id = target_request_id
	for update;

	if not found
		or v_request.status not in ('claimed', 'clicked')
		or v_request.claim_token is distinct from target_claim_token
		or v_request.prepared_at is null
		or not exists (
			select 1
			from public.push_delivery_attempts delivery
			where delivery.id = target_push_delivery_id
				and delivery.google_review_request_id = v_request.id
				and delivery.business_id = v_request.business_id
				and delivery.appointment_id = v_request.appointment_id
				and delivery.kind = 'review'
				and delivery.accepted_at is not null
				and delivery.failed_at is null
				and delivery.superseded_at is null
		)
	then
		return false;
	end if;

	update public.google_review_requests request
	set
		status = case when request.clicked_at is null then 'sent' else 'clicked' end,
		status_reason = null,
		push_delivery_id = target_push_delivery_id,
		push_service_status = target_push_service_status,
		sent_at = coalesce(request.sent_at, complete_time),
		claim_token = null,
		claimed_at = null,
		claim_expires_at = null,
		last_error_kind = null,
		updated_at = complete_time
	where request.id = v_request.id;

	insert into public.google_review_patient_delivery_state (
		business_id,
		patient_id,
		last_sent_at,
		active_request_id,
		claim_expires_at,
		created_at,
		updated_at
	)
	values (
		v_request.business_id,
		v_request.patient_id,
		complete_time,
		null,
		null,
		complete_time,
		complete_time
	)
	on conflict (business_id, patient_id) do update
	set
		last_sent_at = greatest(
			public.google_review_patient_delivery_state.last_sent_at,
			excluded.last_sent_at
		),
		active_request_id = null,
		claim_expires_at = null,
		updated_at = excluded.updated_at;

	return true;
end;
$$;

revoke all on function public.complete_google_review_request(
	uuid, uuid, uuid, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_google_review_request(
	uuid, uuid, uuid, integer, timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
