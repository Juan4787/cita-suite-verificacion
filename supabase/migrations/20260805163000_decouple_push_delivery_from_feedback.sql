-- La respuesta a la prueba y la entrega de recordatorios resuelven problemas
-- distintos:
--
-- - verified_at significa que la persona confirmó "Sí, la recibí" y decide la
--   cobertura manual; un navegador web no puede comprobar el bloqueo global que
--   Android aplica después del handoff, por lo que displayed_at queda como
--   telemetría y no reemplaza esa confirmación;
-- - una suscripción Web Push vigente ya tiene todo lo necesario para intentar los
--   avisos de 24 h/2 h, aunque la persona no responda la pregunta.
--
-- Esta versión elimina verified_at únicamente del claim de entrega. Conserva la
-- revocación, las ventanas, los locks y la idempotencia existentes.

create or replace function public.claim_due_push_reminders(
	claim_now timestamptz,
	claim_limit integer default 50
) returns table (
	subscription_id uuid,
	appointment_id uuid,
	business_id uuid,
	endpoint text,
	p256dh text,
	auth text,
	reminder_kind text
)
language plpgsql
security definer
set search_path = public
as $$
begin
	return query
	with due as (
		select ps.id
		from public.push_subscriptions ps
		join public.appointments a on a.id = ps.appointment_id
		where ps.revoked_at is null
			and a.status in ('reserved', 'confirmed')
			and a.starts_at > claim_now + interval '2 hours'
			and a.starts_at <= claim_now + interval '24 hours'
			and ps.push_24h_sent_at is null
			and (ps.push_24h_claimed_at is null or ps.push_24h_claimed_at < claim_now - interval '10 minutes')
		order by ps.id
		limit claim_limit
		for update of ps skip locked
	)
	update public.push_subscriptions ps
	set push_24h_claimed_at = claim_now, updated_at = claim_now
	from due
	where ps.id = due.id
	returning ps.id, ps.appointment_id, ps.business_id, ps.endpoint, ps.p256dh, ps.auth, '24h'::text;

	return query
	with due as (
		select ps.id
		from public.push_subscriptions ps
		join public.appointments a on a.id = ps.appointment_id
		where ps.revoked_at is null
			and a.status in ('reserved', 'confirmed')
			and a.starts_at > claim_now
			and a.starts_at <= claim_now + interval '2 hours'
			and ps.push_2h_sent_at is null
			and (ps.push_2h_claimed_at is null or ps.push_2h_claimed_at < claim_now - interval '10 minutes')
		order by ps.id
		limit claim_limit
		for update of ps skip locked
	)
	update public.push_subscriptions ps
	set push_2h_claimed_at = claim_now, updated_at = claim_now
	from due
	where ps.id = due.id
	returning ps.id, ps.appointment_id, ps.business_id, ps.endpoint, ps.p256dh, ps.auth, '2h'::text;
end;
$$;

revoke all on function public.claim_due_push_reminders(timestamptz, integer)
	from public, anon, authenticated;
grant execute on function public.claim_due_push_reminders(timestamptz, integer)
	to service_role;

comment on function public.claim_due_push_reminders(timestamptz, integer) is
	'Reclama avisos 24h/2h para toda suscripción vigente; la confirmación de prueba sólo determina cobertura manual.';
