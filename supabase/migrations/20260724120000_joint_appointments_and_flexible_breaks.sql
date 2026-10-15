-- Turnos conjuntos y descanso flexible entre consultas.
--
-- Compatibilidad:
-- - appointments sigue siendo la única fila clínica/administrativa del turno.
-- - professional_id sigue siendo el profesional principal.
-- - appointment_professionals contiene todas las agendas ocupadas, incluida la
--   principal, y se completa automáticamente para los turnos individuales.
-- - los turnos existentes conservan exactamente sus rangos de bloqueo previos.

alter table public.availability_rules
	add column if not exists break_minutes integer;

-- El valor anterior se mostraba en la interfaz como "descanso entre
-- consultas". Se conserva como descanso real para que ningún profesional
-- pierda silenciosamente su configuración al migrar.
update public.availability_rules
set break_minutes = slot_interval_minutes
where break_minutes is null;

alter table public.availability_rules
	alter column break_minutes set default 15,
	alter column break_minutes set not null;

alter table public.availability_rules
	drop constraint if exists availability_rules_break_minutes_check;
alter table public.availability_rules
	add constraint availability_rules_break_minutes_check
	check (break_minutes >= 0);

comment on column public.availability_rules.break_minutes is
	'Descanso entero en minutos posterior a cada turno. Cero permite atención inmediata.';
comment on column public.availability_rules.slot_interval_minutes is
	'Separación de la grilla de posibles horas de inicio; no representa el descanso.';

alter table public.appointments
	add column if not exists ignore_break boolean not null default false,
	add column if not exists break_minutes_snapshot integer not null default 0;

alter table public.appointments
	drop constraint if exists appointments_break_minutes_snapshot_check;
alter table public.appointments
	add constraint appointments_break_minutes_snapshot_check
	check (break_minutes_snapshot >= 0);

alter table public.appointments
	drop constraint if exists appointments_ignore_break_source_check;
alter table public.appointments
	add constraint appointments_ignore_break_source_check
	check (
		not ignore_break
		or source in ('manual', 'admin')
		or updated_by_user_id is not null
	);

comment on column public.appointments.ignore_break is
	'Excepción manual autorizada al crear o reprogramar: no aplica el descanso profesional, pero conserva los buffers del servicio y nunca permite una superposición real.';
comment on column public.appointments.break_minutes_snapshot is
	'Descanso del profesional principal conservado al crear o reprogramar el turno.';

create table if not exists public.appointment_professionals (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null,
	appointment_id uuid not null,
	professional_id uuid not null,
	position integer not null,
	is_primary boolean not null default false,
	professional_name_snapshot text not null,
	starts_at timestamptz not null,
	ends_at timestamptz not null,
	base_blocking_starts_at timestamptz not null,
	base_blocking_ends_at timestamptz not null,
	blocking_starts_at timestamptz not null,
	blocking_ends_at timestamptz not null,
	break_minutes_snapshot integer not null default 0,
	ignore_break boolean not null default false,
	status text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, appointment_id, professional_id),
	unique (business_id, appointment_id, position),
	foreign key (business_id, appointment_id)
		references public.appointments (business_id, id)
		on delete cascade,
	foreign key (business_id, professional_id)
		references public.professionals (business_id, id)
		on delete no action
		deferrable initially deferred,
	check (position >= 0),
	check (starts_at < ends_at),
	check (base_blocking_starts_at < base_blocking_ends_at),
	check (blocking_starts_at < blocking_ends_at),
	check (break_minutes_snapshot >= 0),
	check (status in ('reserved','confirmed','cancelled','reschedule_requested','attended','no_show'))
);

-- La restricción diferida mantiene protegido el historial si alguien intenta
-- borrar sólo un profesional, pero deja que el borrado completo de un negocio
-- elimine primero sus turnos y asignaciones dentro de la misma transacción.
alter table public.appointment_professionals
	drop constraint if exists appointment_professionals_business_id_professional_id_fkey;
alter table public.appointment_professionals
	add constraint appointment_professionals_business_id_professional_id_fkey
	foreign key (business_id, professional_id)
	references public.professionals (business_id, id)
	on delete no action
	deferrable initially deferred;

create unique index if not exists appointment_professionals_one_primary_uq
	on public.appointment_professionals (business_id, appointment_id)
	where is_primary;

create index if not exists appointment_professionals_appointment_idx
	on public.appointment_professionals (business_id, appointment_id, position);

create index if not exists appointment_professionals_professional_starts_idx
	on public.appointment_professionals (business_id, professional_id, starts_at desc);

create index if not exists appointment_professionals_professional_blocking_idx
	on public.appointment_professionals (
		business_id,
		professional_id,
		blocking_starts_at,
		blocking_ends_at
	);

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'appointment_professionals_no_service_overlap'
			and conrelid = 'public.appointment_professionals'::regclass
	) then
		alter table public.appointment_professionals
			add constraint appointment_professionals_no_service_overlap
			exclude using gist (
				business_id with =,
				professional_id with =,
				tstzrange(base_blocking_starts_at, base_blocking_ends_at, '[)') with &&
			)
			where (status in ('reserved','confirmed','reschedule_requested'));
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'appointment_professionals_no_break_overlap'
			and conrelid = 'public.appointment_professionals'::regclass
	) then
		alter table public.appointment_professionals
			add constraint appointment_professionals_no_break_overlap
			exclude using gist (
				business_id with =,
				professional_id with =,
				tstzrange(blocking_starts_at, blocking_ends_at, '[)') with &&
			)
			where (
				status in ('reserved','confirmed','reschedule_requested')
				and ignore_break = false
			);
	end if;
end
$$;

-- Los turnos previos entran después de crear las restricciones. Se conserva
-- descanso cero para no modificar ni invalidar reservas históricas aceptadas
-- por el sistema anterior.
insert into public.appointment_professionals (
	business_id,
	appointment_id,
	professional_id,
	position,
	is_primary,
	professional_name_snapshot,
	starts_at,
	ends_at,
	base_blocking_starts_at,
	base_blocking_ends_at,
	blocking_starts_at,
	blocking_ends_at,
	break_minutes_snapshot,
	ignore_break,
	status,
	created_at,
	updated_at
)
select
	appointment.business_id,
	appointment.id,
	appointment.professional_id,
	0,
	true,
	appointment.professional_name_snapshot,
	appointment.starts_at,
	appointment.ends_at,
	appointment.blocking_starts_at,
	appointment.blocking_ends_at,
	appointment.blocking_starts_at,
	appointment.blocking_ends_at,
	0,
	appointment.ignore_break,
	appointment.status,
	appointment.created_at,
	appointment.updated_at
from public.appointments appointment
on conflict (business_id, appointment_id, professional_id) do nothing;

-- El deploy ejecuta cada migración dentro de una única transacción. Forzamos
-- ahora la FK diferida para procesar los eventos del backfill antes de crear
-- triggers o volver a alterar esta tabla más abajo.
set constraints appointment_professionals_business_id_professional_id_fkey immediate;
set constraints appointment_professionals_business_id_professional_id_fkey deferred;

create or replace function public.professional_break_minutes_at(
	target_business_id uuid,
	target_professional_id uuid,
	target_starts_at timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
	select coalesce(max(rule.break_minutes), 0)::integer
	from public.businesses business
	join public.availability_rules rule
		on rule.business_id = business.id
		and rule.professional_id = target_professional_id
		and rule.is_active = true
	where business.id = target_business_id
		and rule.weekday = extract(
			dow from (target_starts_at at time zone business.timezone)
		)::integer
		and (target_starts_at at time zone business.timezone)::time >= rule.start_time
		and (target_starts_at at time zone business.timezone)::time < rule.end_time;
$$;

revoke execute on function public.professional_break_minutes_at(uuid, uuid, timestamptz)
	from public, anon, authenticated;
grant execute on function public.professional_break_minutes_at(uuid, uuid, timestamptz)
	to service_role;

create or replace function public.set_appointment_snapshots_and_blocking_range()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_service record;
	v_professional record;
	v_break_minutes integer := 0;
begin
	if tg_op = 'INSERT'
		or new.service_id is distinct from old.service_id
		or new.professional_id is distinct from old.professional_id
		or new.starts_at is distinct from old.starts_at
		or new.ends_at is distinct from old.ends_at
		or new.ignore_break is distinct from old.ignore_break
	then
		select name, duration_minutes, buffer_before_minutes, buffer_after_minutes
		into v_service
		from public.services
		where business_id = new.business_id
			and id = new.service_id
			and is_active = true;

		if not found then
			raise exception 'SERVICE_NOT_FOUND';
		end if;

		select name
		into v_professional
		from public.professionals
		where business_id = new.business_id
			and id = new.professional_id
			and is_active = true;

		if not found then
			raise exception 'PROFESSIONAL_NOT_FOUND';
		end if;

		if not exists (
			select 1
			from public.professional_services assignment
			where assignment.business_id = new.business_id
				and assignment.professional_id = new.professional_id
				and assignment.service_id = new.service_id
		) then
			raise exception 'PROFESSIONAL_SERVICE_NOT_ASSIGNED';
		end if;

		if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
			new.service_name_snapshot := v_service.name;
		end if;
		if tg_op = 'INSERT' or new.professional_id is distinct from old.professional_id then
			new.professional_name_snapshot := v_professional.name;
		end if;

		v_break_minutes := case
			when new.ignore_break then 0
			else public.professional_break_minutes_at(
				new.business_id,
				new.professional_id,
				new.starts_at
			)
		end;

		new.duration_minutes_snapshot := v_service.duration_minutes;
		new.buffer_before_minutes_snapshot := v_service.buffer_before_minutes;
		new.buffer_after_minutes_snapshot := v_service.buffer_after_minutes;
		new.break_minutes_snapshot := v_break_minutes;
		new.blocking_starts_at :=
			new.starts_at - make_interval(mins => v_service.buffer_before_minutes);
		new.blocking_ends_at :=
			new.ends_at + make_interval(mins => v_service.buffer_after_minutes);
	end if;

	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists appointments_snapshots_and_blocking_range on public.appointments;
create trigger appointments_snapshots_and_blocking_range
	before insert or update of
		service_id,
		professional_id,
		starts_at,
		ends_at,
		ignore_break
	on public.appointments
	for each row
	execute function public.set_appointment_snapshots_and_blocking_range();

create or replace function public.prepare_appointment_professional()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_appointment record;
	v_professional_name text;
	v_break_minutes integer := 0;
begin
	select
		appointment.business_id,
		appointment.service_id,
		appointment.starts_at,
		appointment.ends_at,
		appointment.blocking_starts_at,
		appointment.blocking_ends_at,
		appointment.ignore_break,
		appointment.status
	into v_appointment
	from public.appointments appointment
	where appointment.business_id = new.business_id
		and appointment.id = new.appointment_id;

	if not found then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	select professional.name
	into v_professional_name
	from public.professionals professional
	where professional.business_id = new.business_id
		and professional.id = new.professional_id
		and professional.is_active = true;

	if not found then
		raise exception 'TEAM_PROFESSIONAL_NOT_AVAILABLE';
	end if;

	if not exists (
		select 1
		from public.professional_services assignment
		where assignment.business_id = new.business_id
			and assignment.professional_id = new.professional_id
			and assignment.service_id = v_appointment.service_id
	) then
		raise exception 'TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED';
	end if;

	v_break_minutes := case
		when v_appointment.ignore_break then 0
		else public.professional_break_minutes_at(
			new.business_id,
			new.professional_id,
			v_appointment.starts_at
		)
	end;

	new.professional_name_snapshot := v_professional_name;
	new.starts_at := v_appointment.starts_at;
	new.ends_at := v_appointment.ends_at;
	new.base_blocking_starts_at := v_appointment.blocking_starts_at;
	new.base_blocking_ends_at := v_appointment.blocking_ends_at;
	new.blocking_starts_at := v_appointment.blocking_starts_at;
	new.blocking_ends_at :=
		v_appointment.blocking_ends_at + make_interval(mins => v_break_minutes);
	new.break_minutes_snapshot := v_break_minutes;
	new.ignore_break := v_appointment.ignore_break;
	new.status := v_appointment.status;
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists appointment_professionals_prepare on public.appointment_professionals;
create trigger appointment_professionals_prepare
	before insert
	on public.appointment_professionals
	for each row
	execute function public.prepare_appointment_professional();

create or replace function public.sync_appointment_professionals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_break_minutes integer;
begin
	if tg_op = 'INSERT' then
		insert into public.appointment_professionals (
			business_id,
			appointment_id,
			professional_id,
			position,
			is_primary,
			professional_name_snapshot,
			starts_at,
			ends_at,
			base_blocking_starts_at,
			base_blocking_ends_at,
			blocking_starts_at,
			blocking_ends_at,
			break_minutes_snapshot,
			ignore_break,
			status
		)
		values (
			new.business_id,
			new.id,
			new.professional_id,
			0,
			true,
			new.professional_name_snapshot,
			new.starts_at,
			new.ends_at,
			new.blocking_starts_at,
			new.blocking_ends_at,
			new.blocking_starts_at,
			new.blocking_ends_at,
			new.break_minutes_snapshot,
			new.ignore_break,
			new.status
		);
		return new;
	end if;

	if new.professional_id is distinct from old.professional_id then
		delete from public.appointment_professionals allocation
		where allocation.business_id = new.business_id
			and allocation.appointment_id = new.id
			and allocation.is_primary = true;

		if exists (
			select 1
			from public.appointment_professionals allocation
			where allocation.business_id = new.business_id
				and allocation.appointment_id = new.id
				and allocation.professional_id = new.professional_id
		) then
			update public.appointment_professionals allocation
			set position = 0, is_primary = true
			where allocation.business_id = new.business_id
				and allocation.appointment_id = new.id
				and allocation.professional_id = new.professional_id;
		else
			insert into public.appointment_professionals (
				business_id,
				appointment_id,
				professional_id,
				position,
				is_primary,
				professional_name_snapshot,
				starts_at,
				ends_at,
				base_blocking_starts_at,
				base_blocking_ends_at,
				blocking_starts_at,
				blocking_ends_at,
				break_minutes_snapshot,
				ignore_break,
				status
			)
			values (
				new.business_id,
				new.id,
				new.professional_id,
				0,
				true,
				new.professional_name_snapshot,
				new.starts_at,
				new.ends_at,
				new.blocking_starts_at,
				new.blocking_ends_at,
				new.blocking_starts_at,
				new.blocking_ends_at,
				new.break_minutes_snapshot,
				new.ignore_break,
				new.status
			);
		end if;
	end if;

	if new.service_id is distinct from old.service_id
		or new.professional_id is distinct from old.professional_id
		or new.starts_at is distinct from old.starts_at
		or new.ends_at is distinct from old.ends_at
		or new.ignore_break is distinct from old.ignore_break
	then
		if exists (
			select 1
			from public.appointment_professionals allocation
			left join public.professionals professional
				on professional.business_id = allocation.business_id
				and professional.id = allocation.professional_id
				and professional.is_active = true
			left join public.professional_services assignment
				on assignment.business_id = allocation.business_id
				and assignment.professional_id = allocation.professional_id
				and assignment.service_id = new.service_id
			where allocation.business_id = new.business_id
				and allocation.appointment_id = new.id
				and (professional.id is null or assignment.id is null)
		) then
			raise exception 'TEAM_MUST_BE_RECALCULATED';
		end if;

		update public.appointment_professionals allocation
		set
			starts_at = new.starts_at,
			ends_at = new.ends_at,
			base_blocking_starts_at = new.blocking_starts_at,
			base_blocking_ends_at = new.blocking_ends_at,
			break_minutes_snapshot = case
				when new.ignore_break then 0
				else public.professional_break_minutes_at(
					new.business_id,
					allocation.professional_id,
					new.starts_at
				)
			end,
			blocking_starts_at = new.blocking_starts_at,
			blocking_ends_at = new.blocking_ends_at + make_interval(
				mins => case
					when new.ignore_break then 0
					else public.professional_break_minutes_at(
						new.business_id,
						allocation.professional_id,
						new.starts_at
					)
				end
			),
			ignore_break = new.ignore_break,
			status = new.status,
			updated_at = now()
		where allocation.business_id = new.business_id
			and allocation.appointment_id = new.id;
	elsif new.status is distinct from old.status then
		update public.appointment_professionals allocation
		set status = new.status, updated_at = now()
		where allocation.business_id = new.business_id
			and allocation.appointment_id = new.id;
	end if;

	return new;
end;
$$;

drop trigger if exists appointments_sync_professionals on public.appointments;
create trigger appointments_sync_professionals
	after insert or update of
		service_id,
		professional_id,
		starts_at,
		ends_at,
		ignore_break,
		status
	on public.appointments
	for each row
	execute function public.sync_appointment_professionals();

create or replace function public.create_joint_appointment(
	p_business_id uuid,
	p_patient_id uuid,
	p_service_id uuid,
	p_professional_ids uuid[],
	p_starts_at timestamptz,
	p_internal_note text default null,
	p_created_by_user_id uuid default null,
	p_ignore_break boolean default false
)
returns table (
	id uuid,
	confirmation_token text,
	starts_at timestamptz,
	ends_at timestamptz,
	service_name_snapshot text,
	professional_name_snapshot text
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_service record;
	v_patient record;
	v_appointment public.appointments%rowtype;
	v_distinct_count integer;
	v_lock_professional_id uuid;
begin
	if p_business_id is null or p_patient_id is null or p_service_id is null or p_starts_at is null then
		raise exception 'JOINT_APPOINTMENT_REQUIRED_FIELDS';
	end if;

	select count(distinct professional_id)::integer
	into v_distinct_count
	from unnest(coalesce(p_professional_ids, array[]::uuid[])) professional_id;

	if coalesce(array_length(p_professional_ids, 1), 0) < 2 or v_distinct_count < 2 then
		raise exception 'JOINT_APPOINTMENT_REQUIRES_TWO_PROFESSIONALS';
	end if;
	if v_distinct_count <> array_length(p_professional_ids, 1) then
		raise exception 'JOINT_APPOINTMENT_DUPLICATE_PROFESSIONAL';
	end if;
	if exists (select 1 from unnest(p_professional_ids) professional_id where professional_id is null) then
		raise exception 'JOINT_APPOINTMENT_INVALID_PROFESSIONAL';
	end if;

	select service.duration_minutes
	into v_service
	from public.services service
	where service.business_id = p_business_id
		and service.id = p_service_id
		and service.is_active = true;
	if not found then
		raise exception 'SERVICE_NOT_FOUND';
	end if;

	select patient.id, patient.blocked
	into v_patient
	from public.patients patient
	where patient.business_id = p_business_id
		and patient.id = p_patient_id;
	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
	if v_patient.blocked then
		raise exception 'PATIENT_BLOCKED';
	end if;

	if exists (
		select 1
		from unnest(p_professional_ids) required_professional_id
		left join public.professionals professional
			on professional.business_id = p_business_id
			and professional.id = required_professional_id
			and professional.is_active = true
		left join public.professional_services assignment
			on assignment.business_id = p_business_id
			and assignment.professional_id = required_professional_id
			and assignment.service_id = p_service_id
		where professional.id is null or assignment.id is null
	) then
		raise exception 'TEAM_PROFESSIONAL_SERVICE_NOT_ASSIGNED';
	end if;

	-- Todas las creaciones conjuntas toman los bloqueos en el mismo orden. Esto
	-- evita que dos equipos simultáneos con integrantes compartidos se esperen
	-- en orden inverso; la exclusión temporal sigue siendo la autoridad final.
	for v_lock_professional_id in
		select professional_id
		from unnest(p_professional_ids) professional_id
		order by professional_id::text
	loop
		perform pg_advisory_xact_lock(
			hashtextextended(p_business_id::text || ':' || v_lock_professional_id::text, 0)
		);
	end loop;

	insert into public.appointments (
		business_id,
		patient_id,
		service_id,
		professional_id,
		starts_at,
		ends_at,
		blocking_starts_at,
		blocking_ends_at,
		status,
		source,
		reminder_due_at,
		internal_note,
		created_by_user_id,
		updated_by_user_id,
		service_name_snapshot,
		professional_name_snapshot,
		duration_minutes_snapshot,
		ignore_break
	)
	values (
		p_business_id,
		p_patient_id,
		p_service_id,
		p_professional_ids[1],
		p_starts_at,
		p_starts_at + make_interval(mins => v_service.duration_minutes),
		p_starts_at,
		p_starts_at + make_interval(mins => v_service.duration_minutes),
		'reserved',
		'manual',
		null,
		nullif(trim(coalesce(p_internal_note, '')), ''),
		p_created_by_user_id,
		p_created_by_user_id,
		'Pendiente',
		'Pendiente',
		v_service.duration_minutes,
		coalesce(p_ignore_break, false)
	)
	returning * into v_appointment;

	insert into public.appointment_professionals (
		business_id,
		appointment_id,
		professional_id,
		position,
		is_primary,
		professional_name_snapshot,
		starts_at,
		ends_at,
		base_blocking_starts_at,
		base_blocking_ends_at,
		blocking_starts_at,
		blocking_ends_at,
		break_minutes_snapshot,
		ignore_break,
		status
	)
	select
		p_business_id,
		v_appointment.id,
		team.professional_id,
		(team.ordinality - 1)::integer,
		false,
		'Pendiente',
		v_appointment.starts_at,
		v_appointment.ends_at,
		v_appointment.blocking_starts_at,
		v_appointment.blocking_ends_at,
		v_appointment.blocking_starts_at,
		v_appointment.blocking_ends_at,
		0,
		v_appointment.ignore_break,
		v_appointment.status
	from unnest(p_professional_ids) with ordinality team(professional_id, ordinality)
	where team.ordinality > 1;

	update public.appointments appointment
	set professional_name_snapshot = team_names.names
	from (
		select
			allocation.appointment_id,
			string_agg(allocation.professional_name_snapshot, ', ' order by allocation.position) as names
		from public.appointment_professionals allocation
		where allocation.business_id = p_business_id
			and allocation.appointment_id = v_appointment.id
		group by allocation.appointment_id
	) team_names
	where appointment.business_id = p_business_id
		and appointment.id = team_names.appointment_id;

	insert into public.audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		metadata
	)
	values (
		p_business_id,
		p_created_by_user_id,
		'appointment.created',
		'appointment',
		v_appointment.id,
		jsonb_build_object(
			'source', 'manual',
			'patient_id', p_patient_id,
			'service_id', p_service_id,
			'professional_ids', to_jsonb(p_professional_ids),
			'starts_at', p_starts_at,
			'is_joint', true,
			'ignore_break', coalesce(p_ignore_break, false)
		)
	);

	return query
	select
		appointment.id,
		appointment.confirmation_token,
		appointment.starts_at,
		appointment.ends_at,
		appointment.service_name_snapshot,
		appointment.professional_name_snapshot
	from public.appointments appointment
	where appointment.business_id = p_business_id
		and appointment.id = v_appointment.id;
end;
$$;

revoke execute on function public.create_joint_appointment(
	uuid, uuid, uuid, uuid[], timestamptz, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_joint_appointment(
	uuid, uuid, uuid, uuid[], timestamptz, text, uuid, boolean
) to service_role;

-- Algunas bases existentes conservan esta función con un segundo parámetro
-- llamado target_professional_id. PostgreSQL no permite renombrar parámetros
-- mediante CREATE OR REPLACE. Las dos políticas son sus únicas dependencias:
-- se recrean abajo con la semántica nueva basada en appointment_id.
drop policy if exists appointment_professionals_select on public.appointment_professionals;
drop policy if exists appointments_select on public.appointments;
drop function if exists public.user_can_read_appointment(uuid, uuid);

create function public.user_can_read_appointment(
	target_business_id uuid,
	target_appointment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select case
		when public.user_business_role(target_business_id) in ('owner','admin','reception','readonly')
			then public.business_allows_operation(target_business_id)
		when public.user_business_role(target_business_id) = 'professional'
			then public.business_allows_operation(target_business_id)
				and exists (
					select 1
					from public.appointment_professionals allocation
					join public.professional_users professional_user
						on professional_user.business_id = allocation.business_id
						and professional_user.professional_id = allocation.professional_id
					where allocation.business_id = target_business_id
						and allocation.appointment_id = target_appointment_id
						and professional_user.user_id = auth.uid()
				)
		else false
	end;
$$;

revoke execute on function public.user_can_read_appointment(uuid, uuid)
	from public, anon;
grant execute on function public.user_can_read_appointment(uuid, uuid)
	to authenticated;

alter table public.appointment_professionals enable row level security;

drop policy if exists appointment_professionals_select on public.appointment_professionals;
create policy appointment_professionals_select
	on public.appointment_professionals
	for select
	to authenticated
	using (public.user_can_read_appointment(business_id, appointment_id));

drop policy if exists appointments_select on public.appointments;
create policy appointments_select
	on public.appointments
	for select
	to authenticated
	using (public.user_can_read_appointment(business_id, id));

revoke all on table public.appointment_professionals from anon, authenticated;
grant select on table public.appointment_professionals to authenticated;
grant all on table public.appointment_professionals to service_role;

create or replace function public.professional_update_appointment_status(
	target_business_id uuid,
	target_appointment_id uuid,
	target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_appointment record;
	v_now timestamptz := now();
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if not public.business_allows_operation(target_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	if target_status not in ('attended','no_show') then
		raise exception 'INVALID_PROFESSIONAL_STATUS';
	end if;

	select appointment.id, appointment.starts_at, appointment.ends_at, appointment.status
	into v_appointment
	from public.appointments appointment
	where appointment.business_id = target_business_id
		and appointment.id = target_appointment_id
	for update;

	if not found then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	if not exists (
		select 1
		from public.appointment_professionals allocation
		join public.professional_users professional_user
			on professional_user.business_id = allocation.business_id
			and professional_user.professional_id = allocation.professional_id
		where allocation.business_id = target_business_id
			and allocation.appointment_id = target_appointment_id
			and professional_user.user_id = auth.uid()
	) then
		raise exception 'APPOINTMENT_ACCESS_DENIED';
	end if;

	if v_appointment.status in ('cancelled','attended','no_show') then
		raise exception 'APPOINTMENT_TERMINAL_STATUS';
	end if;

	if target_status = 'attended' and v_appointment.starts_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_ATTEND_IN_FUTURE';
	end if;

	if target_status = 'no_show' and v_appointment.ends_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END';
	end if;

	update public.appointments
	set
		status = target_status,
		attended_at = case when target_status = 'attended' then v_now else attended_at end,
		no_show_at = case when target_status = 'no_show' then v_now else no_show_at end,
		updated_by_user_id = auth.uid(),
		updated_at = v_now
	where business_id = target_business_id
		and id = target_appointment_id;

	insert into public.audit_logs (business_id, user_id, action, entity_type, entity_id, metadata)
	values (
		target_business_id,
		auth.uid(),
		case when target_status = 'attended' then 'appointment.attended' else 'appointment.no_show' end,
		'appointment',
		target_appointment_id,
		jsonb_build_object('via', 'professional_panel', 'from_status', v_appointment.status)
	);
end;
$$;

grant execute on function public.professional_update_appointment_status(uuid, uuid, text)
	to authenticated;

notify pgrst, 'reload schema';
