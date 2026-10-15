begin;

-- Revisión monotónica por consultorio para reutilizar listados de pacientes
-- únicamente cuando la base confirma que no hubo cambios.
create table if not exists public.business_data_revisions (
	business_id uuid primary key references public.businesses(id) on delete cascade,
	patients_revision bigint not null default 0 check (patients_revision >= 0),
	realtime_topic_token uuid not null default gen_random_uuid() unique,
	updated_at timestamptz not null default now()
);

comment on table public.business_data_revisions is
	'Revisiones monotónicas para invalidar cachés privadas por consultorio.';
comment on column public.business_data_revisions.realtime_topic_token is
	'Tópico opaco: autoriza únicamente la recepción de eventos sin datos personales.';

alter table public.business_data_revisions enable row level security;
revoke all on table public.business_data_revisions from public, anon, authenticated;
grant select, insert, update, delete on table public.business_data_revisions to service_role;

insert into public.business_data_revisions (business_id)
select id
from public.businesses
on conflict (business_id) do nothing;

-- Verificación compacta: una sola llamada autenticada devuelve únicamente la
-- revisión y la identidad de caché necesaria para ese usuario/consultorio.
create or replace function public.get_patient_data_revision(p_business_id uuid)
returns table (
	business_id uuid,
	patients_revision bigint,
	realtime_topic text,
	viewer_role text,
	can_create_patient boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
	v_role text;
begin
	if auth.uid() is null
		or p_business_id is null
		or not public.user_has_business_access(p_business_id)
	then
		raise exception using
			errcode = '42501',
			message = 'PATIENT_REVISION_FORBIDDEN';
	end if;

	v_role := public.user_business_role(p_business_id);
	if v_role not in ('owner', 'admin', 'reception', 'professional', 'readonly') then
		raise exception using
			errcode = '42501',
			message = 'PATIENT_REVISION_FORBIDDEN';
	end if;

	insert into public.business_data_revisions (business_id)
	values (p_business_id)
	on conflict on constraint business_data_revisions_pkey do nothing;

	return query
	select
		revisions.business_id,
		revisions.patients_revision,
		'business-data:' || revisions.realtime_topic_token::text,
		v_role,
		public.business_allows_operation(p_business_id)
	from public.business_data_revisions revisions
	where revisions.business_id = p_business_id;
end;
$$;

revoke all on function public.get_patient_data_revision(uuid) from public, anon;
grant execute on function public.get_patient_data_revision(uuid) to authenticated;

-- El esquema no está expuesto por PostgREST. La función se usa solamente desde
-- la política de autorización de Realtime.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.can_receive_business_data_revision_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
	select exists (
		select 1
		from public.business_data_revisions revisions
		where 'business-data:' || revisions.realtime_topic_token::text = p_topic
	);
$$;

revoke all on function private.can_receive_business_data_revision_topic(text) from public;
grant execute on function private.can_receive_business_data_revision_topic(text)
	to anon, authenticated, service_role;

drop policy if exists "business data revisions are receivable by opaque topic" on realtime.messages;
create policy "business data revisions are receivable by opaque topic"
on realtime.messages
for select
to anon, authenticated
using (
	realtime.messages.extension = 'broadcast'
	and (select private.can_receive_business_data_revision_topic((select realtime.topic())))
);

create or replace function private.bump_patients_revision()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
	v_business_ids uuid[];
	v_business_id uuid;
	v_revision bigint;
	v_topic text;
begin
	if tg_op = 'INSERT' then
		v_business_ids := array[new.business_id];
	elsif tg_op = 'DELETE' then
		v_business_ids := array[old.business_id];
	elsif new.business_id is distinct from old.business_id then
		v_business_ids := array[old.business_id, new.business_id];
	else
		v_business_ids := array[new.business_id];
	end if;

	foreach v_business_id in array v_business_ids loop
		-- Durante un borrado en cascada el consultorio padre ya no es visible. No
		-- hay consumidores que invalidar y tampoco se debe recrear su revisión.
		continue when v_business_id is null or not exists (
			select 1 from public.businesses where id = v_business_id
		);

		insert into public.business_data_revisions as revisions (
			business_id,
			patients_revision,
			updated_at
		)
		values (v_business_id, 1, now())
		on conflict (business_id) do update
		set patients_revision = revisions.patients_revision + 1,
			updated_at = now()
		returning
			revisions.patients_revision,
			'business-data:' || revisions.realtime_topic_token::text
		into v_revision, v_topic;

		-- El mensaje no incluye nombre, teléfono, DNI, identificador del paciente ni
		-- ningún otro dato clínico. Si Realtime no está disponible, la revisión sigue
		-- siendo autoritativa y el cliente la verifica por HTTP.
		begin
			execute 'select realtime.send($1, $2, $3, $4)'
			using
				jsonb_build_object('resource', 'patients', 'revision', v_revision::text),
				'data_revision',
				v_topic,
				true;
		exception
			-- Realtime acelera la invalidación, pero nunca puede bloquear el alta,
			-- edición o archivo de un paciente si el canal está degradado.
			when others then
				null;
		end;
	end loop;

	return null;
end;
$$;

revoke all on function private.bump_patients_revision() from public;

drop trigger if exists trg_patients_bump_data_revision on public.patients;
create trigger trg_patients_bump_data_revision
after insert or update or delete on public.patients
for each row execute function private.bump_patients_revision();

drop trigger if exists trg_professional_patient_links_bump_data_revision
	on public.professional_patient_links;
create trigger trg_professional_patient_links_bump_data_revision
after insert or update or delete on public.professional_patient_links
for each row execute function private.bump_patients_revision();

-- La asignación de una cuenta profesional también define qué lista puede ver.
drop trigger if exists trg_professional_users_bump_patient_data_revision
	on public.professional_users;
create trigger trg_professional_users_bump_patient_data_revision
after insert or update or delete on public.professional_users
for each row execute function private.bump_patients_revision();

-- Los cambios de rol, membresía o asistencia pueden ampliar o reducir el
-- conjunto de pacientes visible aunque ninguna fila de patients cambie.
drop trigger if exists trg_business_users_bump_patient_data_revision
	on public.business_users;
create trigger trg_business_users_bump_patient_data_revision
after insert or update or delete on public.business_users
for each row execute function private.bump_patients_revision();

drop trigger if exists trg_account_assistance_grants_bump_patient_data_revision
	on public.account_assistance_grants;
create trigger trg_account_assistance_grants_bump_patient_data_revision
after insert or update or delete on public.account_assistance_grants
for each row execute function private.bump_patients_revision();

-- El estado comercial no cambia los nombres visibles, pero sí las acciones
-- habilitadas junto al listado y forma parte de su identidad de caché.
drop trigger if exists trg_business_subscriptions_bump_patient_data_revision
	on public.business_subscriptions;
create trigger trg_business_subscriptions_bump_patient_data_revision
after insert or update or delete on public.business_subscriptions
for each row execute function private.bump_patients_revision();

notify pgrst, 'reload schema';

commit;
