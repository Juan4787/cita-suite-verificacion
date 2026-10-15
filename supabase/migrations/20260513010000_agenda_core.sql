create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function public.normalize_phone_e164(value text)
returns text
language sql
immutable
set search_path = public
as $$
	with cleaned as (
		select regexp_replace(coalesce(value, ''), '\D', '', 'g') as digits
	)
	select case
		when digits = '' then null
		when left(digits, 2) = '00' then '+' || substring(digits from 3)
		when left(digits, 3) = '549' then '+' || digits
		when left(digits, 2) = '54' then '+549' || substring(digits from 3)
		when length(digits) = 10 then '+549' || digits
		else '+' || digits
	end
	from cleaned;
$$;

alter table if exists patients
	add column if not exists phone_raw text,
	add column if not exists phone_e164 text,
	add column if not exists notes text,
	add column if not exists blocked boolean not null default false,
	add column if not exists spam_score int not null default 0;

update patients
set phone_raw = coalesce(phone_raw, phone)
where phone is not null;

with normalized_patients as (
	select
		p.id,
		p.business_id,
		public.normalize_phone_e164(p.phone) as normalized_phone,
		p.created_at
	from patients p
	where p.business_id is not null
		and p.phone is not null
),
ranked_patients as (
	select
		np.id,
		np.normalized_phone,
		row_number() over (
			partition by np.business_id, np.normalized_phone
			order by np.created_at asc nulls last, np.id asc
		) as phone_rank
	from normalized_patients np
	where np.normalized_phone is not null
)
update patients p
set phone_e164 = case
	when rp.phone_rank = 1 then rp.normalized_phone
	else null
end
from ranked_patients rp
where p.id = rp.id;

create unique index if not exists patients_business_phone_e164_uq
	on patients (business_id, phone_e164)
	where business_id is not null and phone_e164 is not null;

do $$
begin
	if not exists (
		select 1 from pg_constraint where conname = 'patients_business_id_id_uq'
	) then
		alter table patients add constraint patients_business_id_id_uq unique (business_id, id);
	end if;
end $$;

create table if not exists professionals (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	name text not null,
	specialty text,
	phone text,
	email text,
	avatar_url text,
	is_public boolean not null default true,
	is_active boolean not null default true,
	sort_order int not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, id)
);

create table if not exists professional_users (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	professional_id uuid not null,
	user_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	unique (business_id, professional_id, user_id),
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete cascade
);

create table if not exists services (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	name text not null,
	description text,
	duration_minutes int not null check (duration_minutes > 0),
	buffer_before_minutes int not null default 0 check (buffer_before_minutes >= 0),
	buffer_after_minutes int not null default 0 check (buffer_after_minutes >= 0),
	price_label text,
	is_public boolean not null default true,
	is_active boolean not null default true,
	sort_order int not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, id)
);

create table if not exists professional_services (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	professional_id uuid not null,
	service_id uuid not null,
	created_at timestamptz not null default now(),
	unique (business_id, professional_id, service_id),
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete cascade,
	foreign key (business_id, service_id)
		references services (business_id, id)
		on delete cascade
);

create table if not exists availability_rules (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	professional_id uuid not null,
	weekday int not null check (weekday between 0 and 6),
	start_time time not null,
	end_time time not null,
	slot_interval_minutes int not null default 15 check (slot_interval_minutes > 0),
	is_active boolean not null default true,
	created_at timestamptz not null default now(),
	check (start_time < end_time),
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete cascade
);

create table if not exists availability_exceptions (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	professional_id uuid,
	starts_at timestamptz not null,
	ends_at timestamptz not null,
	type text not null check (type in ('blocked','extra_available')),
	reason text,
	created_at timestamptz not null default now(),
	check (starts_at < ends_at),
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete cascade
);

create table if not exists appointments (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	patient_id uuid not null,
	service_id uuid not null,
	professional_id uuid not null,
	starts_at timestamptz not null,
	ends_at timestamptz not null,
	blocking_starts_at timestamptz not null,
	blocking_ends_at timestamptz not null,
	status text not null default 'reserved' check (
		status in ('reserved','confirmed','cancelled','reschedule_requested','attended','no_show')
	),
	source text not null default 'manual' check (
		source in ('public_booking','manual','whatsapp_bot','admin')
	),
	confirmation_token text unique not null default encode(gen_random_bytes(32), 'hex'),
	reminder_due_at timestamptz,
	confirmed_at timestamptz,
	cancelled_at timestamptz,
	cancelled_reason text,
	reschedule_requested_at timestamptz,
	attended_at timestamptz,
	no_show_at timestamptz,
	internal_note text,
	service_name_snapshot text not null,
	professional_name_snapshot text not null,
	duration_minutes_snapshot int not null check (duration_minutes_snapshot > 0),
	buffer_before_minutes_snapshot int not null default 0 check (buffer_before_minutes_snapshot >= 0),
	buffer_after_minutes_snapshot int not null default 0 check (buffer_after_minutes_snapshot >= 0),
	created_by_user_id uuid references auth.users(id),
	updated_by_user_id uuid references auth.users(id),
	cancelled_by_user_id uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	check (starts_at < ends_at),
	check (blocking_starts_at < blocking_ends_at),
	unique (business_id, id),
	foreign key (business_id, patient_id)
		references patients (business_id, id)
		on delete restrict,
	foreign key (business_id, service_id)
		references services (business_id, id)
		on delete restrict,
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete restrict
);

create table if not exists audit_logs (
	id uuid primary key default gen_random_uuid(),
	business_id uuid references businesses(id) on delete cascade,
	user_id uuid references auth.users(id),
	action text not null,
	entity_type text not null,
	entity_id uuid,
	metadata jsonb,
	created_at timestamptz not null default now()
);

create index if not exists professionals_business_active_sort_idx
	on professionals (business_id, is_active, sort_order, name);
create index if not exists professional_users_user_idx
	on professional_users (user_id, business_id);
create index if not exists services_business_active_sort_idx
	on services (business_id, is_active, sort_order, name);
create index if not exists professional_services_service_idx
	on professional_services (business_id, service_id, professional_id);
create index if not exists availability_rules_professional_weekday_idx
	on availability_rules (business_id, professional_id, weekday, is_active);
create index if not exists availability_exceptions_business_range_idx
	on availability_exceptions (business_id, starts_at, ends_at);
create index if not exists appointments_business_starts_idx
	on appointments (business_id, starts_at desc);
create index if not exists appointments_professional_starts_idx
	on appointments (business_id, professional_id, starts_at desc);
create index if not exists appointments_patient_starts_idx
	on appointments (business_id, patient_id, starts_at desc);
create index if not exists audit_logs_business_created_idx
	on audit_logs (business_id, created_at desc);

create or replace function public.user_is_professional_for(target_professional_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
		select 1
		from professional_users pu
		where pu.professional_id = target_professional_id
			and pu.user_id = auth.uid()
	);
$$;

create or replace function public.user_can_read_professional_schedule(
	target_business_id uuid,
	target_professional_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select coalesce(public.user_business_role(target_business_id), '') in ('owner','admin','reception','readonly')
		or exists (
			select 1
			from professional_users pu
			where pu.business_id = target_business_id
				and pu.professional_id = target_professional_id
				and pu.user_id = auth.uid()
		);
$$;

create or replace function public.set_appointment_snapshots_and_blocking_range()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_service record;
	v_professional record;
begin
	if tg_op = 'INSERT'
		or new.service_id is distinct from old.service_id
		or new.professional_id is distinct from old.professional_id
		or new.starts_at is distinct from old.starts_at
		or new.ends_at is distinct from old.ends_at
	then
		select name, duration_minutes, buffer_before_minutes, buffer_after_minutes
		into v_service
		from services
		where business_id = new.business_id
			and id = new.service_id;

		if not found then
			raise exception 'SERVICE_NOT_FOUND';
		end if;

		select name
		into v_professional
		from professionals
		where business_id = new.business_id
			and id = new.professional_id;

		if not found then
			raise exception 'PROFESSIONAL_NOT_FOUND';
		end if;

		if not exists (
			select 1
			from professional_services ps
			where ps.business_id = new.business_id
				and ps.professional_id = new.professional_id
				and ps.service_id = new.service_id
		) then
			raise exception 'PROFESSIONAL_SERVICE_NOT_ASSIGNED';
		end if;

		new.service_name_snapshot := v_service.name;
		new.professional_name_snapshot := v_professional.name;
		new.duration_minutes_snapshot := v_service.duration_minutes;
		new.buffer_before_minutes_snapshot := v_service.buffer_before_minutes;
		new.buffer_after_minutes_snapshot := v_service.buffer_after_minutes;
		new.blocking_starts_at := new.starts_at - make_interval(mins => v_service.buffer_before_minutes);
		new.blocking_ends_at := new.ends_at + make_interval(mins => v_service.buffer_after_minutes);
	end if;

	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists appointments_snapshots_and_blocking_range on appointments;
create trigger appointments_snapshots_and_blocking_range
	before insert or update of service_id, professional_id, starts_at, ends_at
	on appointments
	for each row
	execute function public.set_appointment_snapshots_and_blocking_range();

do $$
begin
	if not exists (
		select 1 from pg_constraint where conname = 'appointments_no_overlapping_active'
	) then
		alter table appointments
			add constraint appointments_no_overlapping_active
			exclude using gist (
				business_id with =,
				professional_id with =,
				tstzrange(blocking_starts_at, blocking_ends_at, '[)') with &&
			)
			where (status in ('reserved','confirmed','reschedule_requested'));
	end if;
end $$;

grant execute on function public.normalize_phone_e164(text) to authenticated, anon;
grant execute on function public.user_is_professional_for(uuid) to authenticated;
grant execute on function public.user_can_read_professional_schedule(uuid, uuid) to authenticated;

alter table professionals enable row level security;
alter table professional_users enable row level security;
alter table services enable row level security;
alter table professional_services enable row level security;
alter table availability_rules enable row level security;
alter table availability_exceptions enable row level security;
alter table appointments enable row level security;
alter table audit_logs enable row level security;

do $$
begin
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professionals' and policyname = 'professionals_select') then
		create policy professionals_select on professionals
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professionals' and policyname = 'professionals_insert') then
		create policy professionals_insert on professionals
			for insert to authenticated
			with check (public.user_can_operate_business(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professionals' and policyname = 'professionals_update') then
		create policy professionals_update on professionals
			for update to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professional_users' and policyname = 'professional_users_select') then
		create policy professional_users_select on professional_users
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professional_users' and policyname = 'professional_users_write') then
		create policy professional_users_write on professional_users
			for all to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'services' and policyname = 'services_select') then
		create policy services_select on services
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'services' and policyname = 'services_insert') then
		create policy services_insert on services
			for insert to authenticated
			with check (public.user_can_operate_business(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'services' and policyname = 'services_update') then
		create policy services_update on services
			for update to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professional_services' and policyname = 'professional_services_select') then
		create policy professional_services_select on professional_services
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'professional_services' and policyname = 'professional_services_write') then
		create policy professional_services_write on professional_services
			for all to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'availability_rules' and policyname = 'availability_rules_select') then
		create policy availability_rules_select on availability_rules
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'availability_rules' and policyname = 'availability_rules_write') then
		create policy availability_rules_write on availability_rules
			for all to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'availability_exceptions' and policyname = 'availability_exceptions_select') then
		create policy availability_exceptions_select on availability_exceptions
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'availability_exceptions' and policyname = 'availability_exceptions_write') then
		create policy availability_exceptions_write on availability_exceptions
			for all to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'appointments' and policyname = 'appointments_select') then
		create policy appointments_select on appointments
			for select to authenticated
			using (public.user_can_read_professional_schedule(business_id, professional_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'appointments' and policyname = 'appointments_insert') then
		create policy appointments_insert on appointments
			for insert to authenticated
			with check (public.user_can_operate_business(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'appointments' and policyname = 'appointments_update') then
		create policy appointments_update on appointments
			for update to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_select') then
		create policy audit_logs_select on audit_logs
			for select to authenticated
			using (public.user_can_manage_business(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_insert') then
		create policy audit_logs_insert on audit_logs
			for insert to authenticated
			with check (public.user_has_business_access(business_id));
	end if;
end $$;
