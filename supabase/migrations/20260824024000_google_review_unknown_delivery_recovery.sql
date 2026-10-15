-- Resuelve el unico intervalo ambiguo de Web Push: el worker pudo caer luego de
-- crear el intento, pero antes de registrar si el proveedor lo acepto.
--
-- Si existe aceptacion durable, el request vuelve a la cola para reconciliar esa
-- misma entrega. Si el resultado es imposible de conocer, se prioriza no duplicar:
-- no se reenvia y se aplica el cooldown conservador del paciente.

begin;

create or replace function public.recover_expired_google_review_request_claims(
	recover_time timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_request record;
	v_delivery_id uuid;
	v_delivery_accepted_at timestamptz;
	v_unknown_outcome boolean;
	v_count integer := 0;
begin
	if recover_time is null then
		return 0;
	end if;

	for v_request in
		select
			request.id,
			request.business_id,
			request.patient_id
		from public.google_review_requests request
		where request.status = 'claimed'
			and request.claim_expires_at <= recover_time
		order by request.claim_expires_at, request.id
		for update skip locked
	loop
		v_delivery_id := null;
		v_delivery_accepted_at := null;

		select delivery.id, delivery.accepted_at
		into v_delivery_id, v_delivery_accepted_at
		from public.push_delivery_attempts delivery
		where delivery.google_review_request_id = v_request.id
			and delivery.failed_at is null
			and delivery.superseded_at is null
		order by delivery.created_at desc, delivery.id
		limit 1
		for update;

		v_unknown_outcome := v_delivery_id is not null
			and v_delivery_accepted_at is null;

		if v_unknown_outcome then
			update public.push_delivery_attempts delivery
			set
				failed_at = recover_time,
				failure_kind = 'transient',
				updated_at = recover_time
			where delivery.id = v_delivery_id
				and delivery.failed_at is null;

			update public.google_review_requests request
			set
				status = 'failed',
				status_reason = 'delivery_outcome_unknown',
				claim_token = null,
				claimed_at = null,
				claim_expires_at = null,
				next_attempt_at = null,
				last_error_kind = 'transient',
				updated_at = recover_time
			where request.id = v_request.id;
		else
			-- Sin intento, se puede reintentar. Con un intento aceptado, el worker
			-- lo detecta y completa ese mismo delivery sin volver a llamar al proveedor.
			update public.google_review_requests request
			set
				status = 'pending',
				status_reason = 'claim_expired',
				claim_token = null,
				claimed_at = null,
				claim_expires_at = null,
				next_attempt_at = recover_time,
				updated_at = recover_time
			where request.id = v_request.id;
		end if;

		update public.google_review_patient_delivery_state state
		set
			-- Ante una entrega incierta, reservar los 180 dias es la unica forma de
			-- garantizar que una aceptacion no registrada no produzca otra solicitud.
			last_sent_at = case
				when v_unknown_outcome
					then greatest(state.last_sent_at, recover_time)
				else state.last_sent_at
			end,
			active_request_id = null,
			claim_expires_at = null,
			updated_at = recover_time
		where state.business_id = v_request.business_id
			and state.patient_id = v_request.patient_id
			and state.active_request_id = v_request.id;

		v_count := v_count + 1;
	end loop;

	return v_count;
end;
$$;

revoke all on function public.recover_expired_google_review_request_claims(timestamptz)
	from public, anon, authenticated;
grant execute on function public.recover_expired_google_review_request_claims(timestamptz)
	to service_role;

notify pgrst, 'reload schema';

commit;
