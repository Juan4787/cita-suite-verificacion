-- Una interacción real con la notificación es una prueba positiva de entrega.
-- Se registra por separado de:
--
-- - displayed_at: el navegador aceptó showNotification();
-- - user_confirmed_at: la persona tocó "Sí, me llegó" dentro de Cita Suite.
--
-- El clic sólo confirma cobertura para el refuerzo manual. No participa del claim
-- de avisos de 24 h/2 h ni de los avisos de reprogramación: esos envíos continúan
-- para toda suscripción vigente, aun sin confirmación ni interacción.

alter table public.push_delivery_attempts
	add column if not exists clicked_at timestamptz;

comment on column public.push_delivery_attempts.clicked_at is
	'Instante en que la persona activó la notificación desde la interfaz del sistema.';

comment on column public.push_subscriptions.verified_at is
	'Prueba positiva de visibilidad para este turno y dispositivo: confirmación explícita o clic real en una notificación.';

create or replace function public.record_push_notification_click(
	target_appointment_id uuid,
	target_delivery_id uuid,
	target_receipt_token_hash text,
	click_time timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	target_subscription_id uuid;
begin
	if click_time is null
		or target_receipt_token_hash is null
		or target_receipt_token_hash !~ '^[0-9a-f]{64}$'
	then
		return false;
	end if;

	-- El hash liga el clic al secreto aleatorio incluido únicamente en el payload
	-- Web Push cifrado. appointment_id impide reutilizarlo para otro turno.
	update public.push_delivery_attempts delivery
	set received_at = coalesce(delivery.received_at, click_time),
		displayed_at = coalesce(delivery.displayed_at, click_time),
		clicked_at = coalesce(delivery.clicked_at, click_time),
		user_reported_missing_at = null,
		updated_at = greatest(delivery.updated_at, click_time)
	where delivery.id = target_delivery_id
		and delivery.appointment_id = target_appointment_id
		and delivery.receipt_token_hash = target_receipt_token_hash
	returning delivery.subscription_id into target_subscription_id;

	if target_subscription_id is null then
		return false;
	end if;

	-- Un clic antiguo no resucita un endpoint que el proveedor ya revocó. Si la
	-- suscripción continúa vigente, el clic es cobertura suficiente para evitar el
	-- refuerzo manual de recepción.
	update public.push_subscriptions subscription
	set verified_at = coalesce(subscription.verified_at, click_time),
		updated_at = greatest(subscription.updated_at, click_time)
	where subscription.id = target_subscription_id
		and subscription.appointment_id = target_appointment_id
		and subscription.revoked_at is null;

	return true;
end;
$$;

revoke all on function public.record_push_notification_click(uuid, uuid, text, timestamptz)
	from public, anon, authenticated;
grant execute on function public.record_push_notification_click(uuid, uuid, text, timestamptz)
	to service_role;

comment on function public.record_push_notification_click(uuid, uuid, text, timestamptz) is
	'Registra de forma idempotente un clic autenticado por el secreto de la entrega y verifica su suscripción vigente.';

-- La respuesta manual y un clic pueden llegar casi al mismo tiempo desde pestañas
-- distintas. Resolver ambos cambios dentro de la base evita que un "No la recibí"
-- iniciado antes termine borrando una interacción objetiva registrada después.
create or replace function public.record_push_test_feedback(
	target_appointment_id uuid,
	target_delivery_id uuid,
	feedback_visible boolean,
	feedback_time timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	target_subscription_id uuid;
	delivery_clicked_at timestamptz;
begin
	if feedback_visible is null or feedback_time is null then
		return false;
	end if;

	select delivery.subscription_id, delivery.clicked_at
	into target_subscription_id, delivery_clicked_at
	from public.push_delivery_attempts delivery
	where delivery.id = target_delivery_id
		and delivery.appointment_id = target_appointment_id
		and delivery.kind = 'test'
		and delivery.accepted_at is not null
		and delivery.failed_at is null
		and delivery.superseded_at is null
	for update;

	if target_subscription_id is null then
		return false;
	end if;

	if feedback_visible then
		update public.push_delivery_attempts delivery
		set user_confirmed_at = feedback_time,
			user_reported_missing_at = null,
			updated_at = greatest(delivery.updated_at, feedback_time)
		where delivery.id = target_delivery_id;

		update public.push_subscriptions subscription
		set verified_at = feedback_time,
			revoked_at = null,
			failed_count = 0,
			updated_at = greatest(subscription.updated_at, feedback_time)
		where subscription.id = target_subscription_id
			and subscription.appointment_id = target_appointment_id;
	elsif delivery_clicked_at is null then
		update public.push_delivery_attempts delivery
		set user_confirmed_at = null,
			user_reported_missing_at = feedback_time,
			updated_at = greatest(delivery.updated_at, feedback_time)
		where delivery.id = target_delivery_id;

		-- No recibir una prueba no demuestra que el endpoint haya vencido. Sólo se
		-- quita la cobertura para el refuerzo manual; la suscripción sigue vigente y
		-- los avisos automáticos continúan intentando entregarse.
		update public.push_subscriptions subscription
		set verified_at = null,
			updated_at = greatest(subscription.updated_at, feedback_time)
		where subscription.id = target_subscription_id
			and subscription.appointment_id = target_appointment_id;
	end if;

	-- Si ya hubo clic en esta misma entrega, esa interacción objetiva prevalece
	-- sobre una respuesta negativa tardía y se conserva la cobertura.
	if delivery_clicked_at is not null then
		update public.push_subscriptions subscription
		set verified_at = coalesce(subscription.verified_at, delivery_clicked_at),
			updated_at = greatest(subscription.updated_at, delivery_clicked_at)
		where subscription.id = target_subscription_id
			and subscription.appointment_id = target_appointment_id
			and subscription.revoked_at is null;
	end if;

	return true;
end;
$$;

revoke all on function public.record_push_test_feedback(uuid, uuid, boolean, timestamptz)
	from public, anon, authenticated;
grant execute on function public.record_push_test_feedback(uuid, uuid, boolean, timestamptz)
	to service_role;

comment on function public.record_push_test_feedback(uuid, uuid, boolean, timestamptz) is
	'Guarda la respuesta a la prueba sin permitir que una respuesta negativa tardía borre un clic real.';
