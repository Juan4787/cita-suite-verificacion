create table if not exists public_booking_attempts (
	id uuid primary key default gen_random_uuid(),
	business_id uuid references businesses(id) on delete cascade,
	phone_e164 text,
	ip_hash text,
	action text not null check (
		action in ('booking_create','token_confirm','token_cancel','token_reschedule')
	),
	success boolean not null default false,
	error_code text,
	user_agent text,
	metadata jsonb,
	created_at timestamptz not null default now()
);

create index if not exists public_booking_attempts_business_created_idx
	on public_booking_attempts (business_id, created_at desc);

create index if not exists public_booking_attempts_ip_created_idx
	on public_booking_attempts (ip_hash, created_at desc)
	where ip_hash is not null;

create index if not exists public_booking_attempts_phone_created_idx
	on public_booking_attempts (business_id, phone_e164, created_at desc)
	where phone_e164 is not null;

alter table public_booking_attempts enable row level security;

do $$
begin
	if not exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'public_booking_attempts'
			and policyname = 'public_booking_attempts_admin_select'
	) then
		create policy public_booking_attempts_admin_select
			on public_booking_attempts
			for select
			to authenticated
			using (
				business_id is not null
				and public.user_can_manage_business(business_id)
			);
	end if;
end $$;
