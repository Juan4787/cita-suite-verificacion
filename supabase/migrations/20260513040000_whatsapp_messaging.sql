create table if not exists messaging_accounts (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	provider text not null default 'mock' check (provider in ('mock','meta_cloud','bsp')),
	status text not null default 'pending' check (status in ('pending','active','paused','error')),
	phone_number text,
	phone_number_id text,
	waba_id text,
	display_name text,
	access_token_secret_name text,
	bot_enabled boolean not null default true,
	reminders_enabled boolean not null default true,
	last_error text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, id)
);

alter table if exists appointments
	add column if not exists whatsapp_opt_in_at timestamptz,
	add column if not exists whatsapp_opt_in_source text,
	add column if not exists whatsapp_opt_in_text text;

create unique index if not exists messaging_accounts_phone_number_id_uq
	on messaging_accounts (phone_number_id)
	where phone_number_id is not null;

create table if not exists message_templates (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	provider text not null default 'mock' check (provider in ('mock','meta_cloud','bsp')),
	provider_template_id text,
	name text not null,
	category text not null check (category in ('utility','marketing','authentication','service')),
	language text not null default 'es_AR',
	status text not null default 'draft' check (status in ('draft','pending','approved','rejected','paused')),
	body text not null,
	rejection_reason text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, name, language),
	unique (business_id, id)
);

create table if not exists message_dispatches (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	appointment_id uuid,
	patient_id uuid,
	messaging_account_id uuid,
	template_id uuid,
	provider text not null default 'mock' check (provider in ('mock','meta_cloud','bsp')),
	provider_message_id text,
	channel text not null default 'whatsapp' check (channel in ('whatsapp')),
	type text not null check (type in ('appointment_reminder_24h','bot_reply','manual_test')),
	to_phone_e164 text not null,
	status text not null default 'scheduled' check (
		status in ('scheduled','queued','sending','sent','delivered','read','failed','cancelled','skipped')
	),
	scheduled_for timestamptz,
	queued_at timestamptz,
	sending_at timestamptz,
	sent_at timestamptz,
	delivered_at timestamptz,
	read_at timestamptz,
	failed_at timestamptz,
	cancelled_at timestamptz,
	skipped_at timestamptz,
	attempts int not null default 0 check (attempts >= 0),
	max_attempts int not null default 3 check (max_attempts > 0),
	last_error_code text,
	last_error_message text,
	human_error_message text,
	template_variables jsonb not null default '[]'::jsonb,
	message_body text,
	raw_request jsonb,
	raw_response jsonb,
	metadata jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, id),
	foreign key (business_id, appointment_id)
		references appointments (business_id, id)
		on delete set null (appointment_id),
	foreign key (business_id, patient_id)
		references patients (business_id, id)
		on delete set null (patient_id),
	foreign key (business_id, messaging_account_id)
		references messaging_accounts (business_id, id)
		on delete set null (messaging_account_id),
	foreign key (business_id, template_id)
		references message_templates (business_id, id)
		on delete set null (template_id)
);

create unique index if not exists message_dispatches_provider_message_uq
	on message_dispatches (provider, provider_message_id)
	where provider_message_id is not null;

create unique index if not exists message_dispatches_appointment_type_active_uq
	on message_dispatches (business_id, appointment_id, type)
	where appointment_id is not null
		and status not in ('failed','cancelled','skipped');

create table if not exists inbound_messages (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	messaging_account_id uuid,
	provider text not null default 'mock' check (provider in ('mock','meta_cloud','bsp')),
	provider_message_id text not null,
	from_phone_e164 text not null,
	text text,
	requires_human boolean not null default false,
	raw_payload jsonb,
	received_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	unique (provider, provider_message_id),
	foreign key (business_id, messaging_account_id)
		references messaging_accounts (business_id, id)
		on delete set null
);

create table if not exists whatsapp_webhook_events (
	id uuid primary key default gen_random_uuid(),
	provider text not null default 'meta_cloud' check (provider in ('mock','meta_cloud','bsp')),
	business_id uuid references businesses(id) on delete cascade,
	messaging_account_id uuid,
	provider_event_id text,
	event_type text not null,
	payload jsonb not null,
	processed boolean not null default false,
	processed_at timestamptz,
	processing_error text,
	received_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	foreign key (business_id, messaging_account_id)
		references messaging_accounts (business_id, id)
		on delete set null
);

create unique index if not exists whatsapp_webhook_events_provider_event_uq
	on whatsapp_webhook_events (provider, provider_event_id)
	where provider_event_id is not null;

create index if not exists messaging_accounts_business_status_idx
	on messaging_accounts (business_id, status);
create index if not exists message_templates_business_status_idx
	on message_templates (business_id, name, status);
create index if not exists message_dispatches_business_status_scheduled_idx
	on message_dispatches (business_id, status, scheduled_for);
create index if not exists message_dispatches_appointment_idx
	on message_dispatches (business_id, appointment_id, created_at desc);
create index if not exists inbound_messages_business_received_idx
	on inbound_messages (business_id, received_at desc);
create index if not exists whatsapp_webhook_events_business_received_idx
	on whatsapp_webhook_events (business_id, received_at desc);

create or replace function public.claim_queued_message_dispatches(
	claim_limit int default 20,
	claim_now timestamptz default now()
)
returns setof message_dispatches
language sql
security definer
set search_path = public
as $$
	with claimed as (
		select id
		from message_dispatches
		where status = 'queued'
			and attempts < max_attempts
			and (scheduled_for is null or scheduled_for <= claim_now)
		order by scheduled_for nulls first, created_at
		for update skip locked
		limit greatest(claim_limit, 1)
	),
	updated as (
		update message_dispatches md
		set
			status = 'sending',
			attempts = md.attempts + 1,
			sending_at = claim_now,
			updated_at = claim_now
		from claimed
		where md.id = claimed.id
		returning md.*
	)
	select * from updated;
$$;

revoke all on function public.claim_queued_message_dispatches(int, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_queued_message_dispatches(int, timestamptz) to service_role;

alter table messaging_accounts enable row level security;
alter table message_templates enable row level security;
alter table message_dispatches enable row level security;
alter table inbound_messages enable row level security;
alter table whatsapp_webhook_events enable row level security;

do $$
begin
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messaging_accounts' and policyname = 'messaging_accounts_select') then
		create policy messaging_accounts_select on messaging_accounts
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messaging_accounts_write') then
		create policy messaging_accounts_write on messaging_accounts
			for all to authenticated
			using (public.user_can_manage_business(business_id))
			with check (public.user_can_manage_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_templates' and policyname = 'message_templates_select') then
		create policy message_templates_select on message_templates
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_templates_write') then
		create policy message_templates_write on message_templates
			for all to authenticated
			using (public.user_can_manage_business(business_id))
			with check (public.user_can_manage_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_dispatches' and policyname = 'message_dispatches_select') then
		create policy message_dispatches_select on message_dispatches
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_dispatches_update') then
		create policy message_dispatches_update on message_dispatches
			for update to authenticated
			using (public.user_can_operate_business(business_id))
			with check (public.user_can_operate_business(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inbound_messages' and policyname = 'inbound_messages_select') then
		create policy inbound_messages_select on inbound_messages
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;

	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_webhook_events' and policyname = 'whatsapp_webhook_events_select') then
		create policy whatsapp_webhook_events_select on whatsapp_webhook_events
			for select to authenticated
			using (
				business_id is not null
				and public.user_can_manage_business(business_id)
			);
	end if;
end $$;
