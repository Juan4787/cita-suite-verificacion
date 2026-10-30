-- Appointment deposits (señas): señas y avisos campaign, stage B. Plan approved on 29 October
-- 2026, sections 4.1 to 4.6, adjustment 1 and revision 2. Additive: no appointment column or
-- status changes, and no applied migration is edited.
--
-- A deposit is the appointment's own fact, in its own table, so recording one never runs the
-- appointment's trigger chain; only the status change it causes does, as today's confirmation.
-- Locking rule: every write on a deposit holds its appointment first (FOR NO KEY UPDATE, which
-- stays compatible with the KEY SHARE taken by foreign keys of child inserts; stage 4 found a
-- 40P01 with FOR UPDATE there). The automatic cancellation locks appointments only, skips the
-- busy ones and re-reads everything under each lock before deciding.
begin;

create table public.deposit_policies (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 enabled boolean not null default false,
 auto_cancel_enabled boolean not null default false,
 amount_mode text not null default 'fixed' check (amount_mode in ('fixed','percentage')),
 fixed_amount bigint check (fixed_amount between 1 and 1000000000000),
 percentage numeric(5,2) check (percentage > 0 and percentage <= 100),
 request_days integer not null default 7 check (request_days between 1 and 60),
 deadline_hours integer not null default 48 check (deadline_hours between 1 and 720),
 min_payment_hours integer not null default 24 check (min_payment_hours between 0 and 168),
 transfer_details text check (char_length(transfer_details) <= 500),
 applies_to_manual boolean not null default true,
 revision bigint not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 updated_by uuid,
 constraint deposit_policies_amount check (
  not enabled or (amount_mode='fixed' and fixed_amount is not null) or (amount_mode='percentage' and percentage is not null))
);

-- Services that never ask for a deposit; with none, every service does.
create table public.deposit_service_exclusions (
 business_id uuid not null,
 service_id uuid not null,
 primary key (business_id, service_id),
 foreign key (business_id, service_id) references public.services(business_id, id) on delete cascade
);

-- business_id goes before appointment_id on purpose. The type generator (postgres-meta) compares the
-- foreign key's columns in declaration order with the unique constraint's columns in table order:
-- in any other order it types the appointment→deposit relation as a list, while PostgREST, which
-- sorts both, returns an object. clinical_entry_costs follows the same order.
create table public.appointment_deposits (
 business_id uuid not null,
 appointment_id uuid primary key,
 status text not null default 'pending' check (status in ('pending','paid','waived','expired')),
 amount bigint not null check (amount between 1 and 1000000000000),
 currency text not null default 'ARS' check (currency='ARS'),
 percentage numeric(5,2),
 reference_amount bigint,
 -- Snapshot of the policy the person was told when booking; later policy changes never apply.
 request_days integer not null,
 deadline_hours integer not null,
 min_payment_hours integer not null,
 policy_revision bigint not null,
 request_from timestamptz not null,
 due_at timestamptz not null,
 auto_cancel boolean not null,
 waived_reason text check (waived_reason in ('staff','policy_disabled')),
 note text check (char_length(note) <= 300),
 recorded_by uuid,
 recorded_at timestamptz,
 reminder_opened_at timestamptz,
 reminder_opened_by uuid,
 expired_at timestamptz,
 revision bigint not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (business_id, appointment_id) references public.appointments(business_id, id) on delete cascade,
 -- Unique on the foreign key's own columns, in the table's column order (see above): PostgREST and
 -- the generated types then read the appointment→deposit relation as one-to-one (an object).
 constraint appointment_deposits_tenant_appointment unique (business_id, appointment_id),
 constraint appointment_deposits_waived check ((status='waived') = (waived_reason is not null)),
 constraint appointment_deposits_expired check ((status='expired') = (expired_at is not null))
);
create index appointment_deposits_due on public.appointment_deposits(due_at) where status='pending' and auto_cancel;
create index appointment_deposits_business_status on public.appointment_deposits(business_id, status, due_at);

-- One row: the operator's global switch (off until a practice is ready, and the first step of
-- any rollback) and the heartbeat the deposits page shows.
create table private.deposit_automation (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false,
 last_run_started_at timestamptz,
 last_run_finished_at timestamptz,
 last_run_processed integer,
 last_run_cancelled integer
);
insert into private.deposit_automation(singleton) values (true);

alter table public.deposit_policies enable row level security;
alter table public.deposit_service_exclusions enable row level security;
alter table public.appointment_deposits enable row level security;
revoke all on public.deposit_policies, public.deposit_service_exclusions, public.appointment_deposits
 from public, anon, authenticated, service_role;
revoke all on private.deposit_automation from public, anon, authenticated, service_role;
-- Reads only: every write goes through the functions below.
grant select on public.deposit_policies, public.deposit_service_exclusions, public.appointment_deposits
 to authenticated, service_role;
create policy deposit_policies_member_select on public.deposit_policies for select to authenticated
 using (public.user_business_role(business_id) is not null);
create policy deposit_service_exclusions_member_select on public.deposit_service_exclusions for select to authenticated
 using (public.user_business_role(business_id) is not null);
-- A deposit is visible exactly when its appointment is, with the appointments' own rule evaluated
-- once per statement (20261020030000): the practices whose agenda the actor reads, as an
-- InitPlan, and the appointments a professional reads through an allocation, hashed once. A
-- correlated subquery on appointments would run that rule again for every deposit.
create policy appointment_deposits_appointment_select on public.appointment_deposits for select to authenticated
 using (
  business_id=any((select public.user_appointment_reader_business_ids())::uuid[])
  or (business_id,appointment_id) in (select allocated.business_id,allocated.appointment_id from public.user_allocated_appointment_ids() allocated)
 );

-- The single date rule: requested from the local midnight `request_days` before the turn's
-- local day, due `deadline_hours` before it starts, and cancellable only if the person had at
-- least `min_payment_hours` to pay between `p_from` (booking or reschedule) and the due date.
create function private.deposit_schedule(p_starts_at timestamptz, p_from timestamptz, p_timezone text,
 p_request_days integer, p_deadline_hours integer, p_min_payment_hours integer,
 out request_from timestamptz, out due_at timestamptz, out auto_cancel boolean)
language sql stable set search_path=pg_catalog,pg_temp as $$
 select ((p_starts_at at time zone p_timezone)::date - p_request_days)::timestamp at time zone p_timezone,
  p_starts_at - make_interval(hours => p_deadline_hours),
  (p_starts_at - make_interval(hours => p_deadline_hours)) - p_from >= make_interval(hours => p_min_payment_hours)
$$;

-- Fixed amount, or a percentage of the fee quoted for the turn rounded with that fee's own
-- rounding unit. A percentage without a quote falls back to the fixed amount, if any.
create function private.deposit_amount(p_policy public.deposit_policies, p_business_id uuid, p_quote jsonb,
 out amount bigint, out percentage numeric, out reference_amount bigint)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v_quote_amount bigint; v_unit integer;
begin
 if p_policy.amount_mode='fixed' then amount:=p_policy.fixed_amount; return; end if;
 if jsonb_typeof(p_quote->'amount')='number' then v_quote_amount:=(p_quote->>'amount')::numeric::bigint; end if;
 if v_quote_amount is null or v_quote_amount<=0 then amount:=p_policy.fixed_amount; return; end if;
 if coalesce(p_quote->>'policy_id','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select spp.rounding_unit into v_unit from public.service_price_policies spp
  where spp.business_id=p_business_id and spp.id=(p_quote->>'policy_id')::uuid;
 end if;
 v_unit:=coalesce(v_unit,1);
 amount:=(round((v_quote_amount*p_policy.percentage/100)/v_unit)*v_unit)::bigint;
 if amount<1 then amount:=p_policy.fixed_amount; return; end if;
 percentage:=p_policy.percentage;
 reference_amount:=v_quote_amount;
end $$;

-- What a booking for this service and time asks: used by the booking page before booking and
-- by the trigger that creates the deposit, so both always agree. `auto_cancel` also carries the
-- practice's switch at that moment: a person never told about automatic cancellation is never
-- cancelled automatically, even if the practice turns it on later.
create function private.deposit_terms(p_business_id uuid, p_service_id uuid, p_source text, p_starts_at timestamptz,
 p_from timestamptz, p_quote jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare v_policy public.deposit_policies; v_timezone text; v_amount record; v_schedule record;
begin
 if not coalesce((select da.enabled from private.deposit_automation da where da.singleton),false) then
  return jsonb_build_object('required',false); end if;
 select * into v_policy from public.deposit_policies dp where dp.business_id=p_business_id;
 if not found or not v_policy.enabled
  or (p_source is distinct from 'public_booking' and not v_policy.applies_to_manual)
  or exists(select 1 from public.deposit_service_exclusions e where e.business_id=p_business_id and e.service_id=p_service_id) then
  return jsonb_build_object('required',false); end if;
 select * into v_amount from private.deposit_amount(v_policy,p_business_id,p_quote);
 if v_amount.amount is null then return jsonb_build_object('required',false); end if;
 select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
 select * into v_schedule from private.deposit_schedule(p_starts_at,p_from,v_timezone,
  v_policy.request_days,v_policy.deadline_hours,v_policy.min_payment_hours);
 return jsonb_build_object('required',true,'amount',v_amount.amount,'currency','ARS','percentage',v_amount.percentage,
  'reference_amount',v_amount.reference_amount,'request_from',v_schedule.request_from,'due_at',v_schedule.due_at,
  'auto_cancel',v_schedule.auto_cancel and v_policy.auto_cancel_enabled,'transfer_details',v_policy.transfer_details,
  'policy_revision',v_policy.revision,'request_days',v_policy.request_days,'deadline_hours',v_policy.deadline_hours,
  'min_payment_hours',v_policy.min_payment_hours);
end $$;

-- Every creation path (manual, public, integrated, with information) inserts the appointment;
-- the deposit is created in that same transaction. After the insert, the fee is already in the
-- row: zz_appointment_price runs before it, and all BEFORE triggers run before any AFTER one.
create function private.create_appointment_deposit() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v jsonb; v_expected jsonb; v_raw_expected text;
begin
 if new.status<>'reserved' then return null; end if;
 -- Serialize with save_deposit_policy before reading the snapshot. If disabling wins,
 -- this waits and the following statement sees its committed policy; if booking wins,
 -- disabling waits and then sees this new deposit among those it must waive. The new
 -- appointment is not visible to other transactions yet, so this cannot invert the
 -- policy→existing-appointment lock order used by disabling.
 perform 1 from public.deposit_policies dp where dp.business_id=new.business_id for share;
 v:=private.deposit_terms(new.business_id,new.service_id,new.source,new.starts_at,new.created_at,new.price_quote_snapshot);
 -- PostgREST exposes request headers as transaction-scoped JSON. The application sends
 -- only the amount/deadline/automatic-cancellation conditions the person saw. Compare
 -- under the policy lock for every public creation path, with no new RPC signature.
 -- Missing/unknown conditions keep the explicitly disclosed fallback; removing the
 -- requirement or relaxing automatic cancellation never blocks the booking.
 if new.source='public_booking' then
  begin
   v_raw_expected:=nullif(current_setting('request.headers',true),'')::jsonb->>'x-cita-deposit-terms';
   if v_raw_expected is not null then
    v_expected:=v_raw_expected::jsonb;
    if v_expected='"unknown"'::jsonb then null;
    elsif v_expected='"none"'::jsonb then
     if (v->>'required')::boolean is true then raise exception 'DEPOSIT_TERMS_CHANGED'; end if;
    elsif jsonb_typeof(v_expected)='object' then
     if jsonb_typeof(v_expected->'amount') is distinct from 'number'
      or jsonb_typeof(v_expected->'dueAt') is distinct from 'string'
      or jsonb_typeof(v_expected->'autoCancel') is distinct from 'boolean'
      or (v_expected->>'amount')::numeric not between 1 and 1000000000000
      or (v_expected->>'amount')::numeric<>trunc((v_expected->>'amount')::numeric) then
      raise exception 'DEPOSIT_TERMS_CHANGED'; end if;
     if (v->>'required')::boolean is true and (
      (v_expected->>'amount')::numeric is distinct from (v->>'amount')::numeric
      or (v_expected->>'dueAt')::timestamptz is distinct from (v->>'due_at')::timestamptz
      or ((v_expected->>'autoCancel')::boolean is false and (v->>'auto_cancel')::boolean is true)) then
      raise exception 'DEPOSIT_TERMS_CHANGED'; end if;
    else raise exception 'DEPOSIT_TERMS_CHANGED';
    end if;
   end if;
  exception when others then raise exception 'DEPOSIT_TERMS_CHANGED';
  end;
 end if;
 if (v->>'required')::boolean is not true then return null; end if;
 insert into public.appointment_deposits(appointment_id,business_id,amount,percentage,reference_amount,request_days,deadline_hours,
  min_payment_hours,policy_revision,request_from,due_at,auto_cancel)
 values(new.id,new.business_id,(v->>'amount')::bigint,(v->>'percentage')::numeric,(v->>'reference_amount')::bigint,
  (v->>'request_days')::integer,(v->>'deadline_hours')::integer,(v->>'min_payment_hours')::integer,(v->>'policy_revision')::bigint,
  (v->>'request_from')::timestamptz,(v->>'due_at')::timestamptz,(v->>'auto_cancel')::boolean);
 return null;
end $$;
create trigger appointments_create_deposit after insert on public.appointments
 for each row execute function private.create_appointment_deposit();

-- A moved turn keeps a received deposit as it is; a pending one gets its dates again from its
-- own snapshot, measured from the moment it moves. It still cancels itself only if the person
-- was told so and has the minimum time to pay.
create function private.reschedule_appointment_deposit() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare d public.appointment_deposits; v_timezone text; s record;
begin
 if new.starts_at is not distinct from old.starts_at then return null; end if;
 select * into d from public.appointment_deposits ad
 where ad.appointment_id=new.id and ad.business_id=new.business_id and ad.status='pending' for update;
 if not found then return null; end if;
 select b.timezone into v_timezone from public.businesses b where b.id=new.business_id;
 select * into s from private.deposit_schedule(new.starts_at,now(),v_timezone,d.request_days,d.deadline_hours,d.min_payment_hours);
 update public.appointment_deposits set request_from=s.request_from,due_at=s.due_at,auto_cancel=d.auto_cancel and s.auto_cancel,
  revision=d.revision+1,updated_at=now()
 where appointment_id=d.appointment_id;
 return null;
end $$;
create trigger appointments_reschedule_deposit after update of starts_at on public.appointments
 for each row execute function private.reschedule_appointment_deposit();

-- For a practice that asks for deposits, Confirmado means the deposit is settled: no path (the
-- person's link, the practice's generic button, a direct write) confirms with it pending.
create function private.enforce_deposit_before_confirmation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.status='confirmed' and old.status is distinct from 'confirmed'
  and exists(select 1 from public.appointment_deposits ad where ad.appointment_id=new.id and ad.business_id=new.business_id and ad.status='pending') then
  raise exception 'APPOINTMENT_DEPOSIT_PENDING';
 end if;
 return new;
end $$;
create trigger appointments_deposit_confirmation before update of status on public.appointments
 for each row execute function private.enforce_deposit_before_confirmation();

-- The staff member acting on a practice's deposits: owner, administrator or reception of an
-- operating practice. Their membership row is shared-locked, so a revocation waits for the
-- change or applies before it.
create function private.deposit_actor(p_business_id uuid, p_allowed text[]) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_role text; v_assistance uuid;
begin
 if v_actor is null then return null; end if;
 -- Read the role from the locked row, not before waiting for it. A concurrent role
 -- change/revocation must win before this operation or wait until it finishes.
 select bu.role into v_role from public.business_users bu
 where bu.business_id=p_business_id and bu.user_id=v_actor
  and coalesce(bu.status,'active')='active' and bu.accepted_at is not null and bu.disabled_at is null for share;
 -- Account assistance is an independent grant; preserve its admin capability and
 -- lock both the grant and the support identity, as the existing team authority does.
 select grants.id into v_assistance
 from public.account_assistance_support_users support
 join public.account_assistance_grants grants on grants.support_user_id=support.user_id
 where support.user_id=v_actor and support.enabled and grants.business_id=p_business_id
  and grants.status='active' and grants.revoked_at is null and grants.expires_at>now()
 for share of support,grants;
 if v_assistance is not null and v_role is distinct from 'owner' then v_role:='admin'; end if;
 if v_role is null or not (v_role=any(p_allowed)) then return null; end if;
 perform 1 from public.business_subscriptions bs where bs.business_id=p_business_id for share;
 if public.business_allows_operation(p_business_id) is not true then return null; end if;
 return v_role;
end $$;

-- Received, waived or undone. Received and waived confirm a reserved turn in the same
-- transaction; undo returns it to Reservado and, past the minimum payment window, the turn no
-- longer cancels itself. Repeating the current state succeeds without a second audit entry.
create function public.set_appointment_deposit(p_business_id uuid, p_appointment_id uuid, p_action text,
 p_expected_revision bigint, p_note text default null)
returns table(status text, revision bigint, appointment_status text)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare a public.appointments; d public.appointment_deposits; v_now timestamptz:=now(); v_audit text;
begin
 if p_action is null or p_action not in ('paid','waived','pending') or p_expected_revision is null then
  raise exception 'DEPOSIT_ACTION_INVALID'; end if;
 if p_note is not null and char_length(p_note)>300 then raise exception 'DEPOSIT_NOTE_INVALID'; end if;
 if private.deposit_actor(p_business_id,array['owner','admin','reception']) is null then raise exception 'DEPOSIT_FORBIDDEN'; end if;
 select * into a from public.appointments ap where ap.business_id=p_business_id and ap.id=p_appointment_id for no key update;
 if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
 select * into d from public.appointment_deposits ad where ad.business_id=p_business_id and ad.appointment_id=p_appointment_id for update;
 if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
 -- Plan 4.5: only a turn in an active status changes its deposit. Since 20260824030000 that is
 -- every status but cancelled; the list is explicit so that a status added later stays closed.
 if a.status not in ('reserved','confirmed','reschedule_requested') or d.status='expired' then
  raise exception 'DEPOSIT_APPOINTMENT_CLOSED'; end if;
 if d.status=p_action then return query select d.status,d.revision,a.status; return; end if;
 if d.revision is distinct from p_expected_revision then raise exception 'DEPOSIT_CHANGED'; end if;
 if p_action in ('paid','waived') then
  if d.status<>'pending' then raise exception 'DEPOSIT_CHANGED'; end if;
  update public.appointment_deposits ad set status=p_action,waived_reason=case when p_action='waived' then 'staff' end,
   recorded_by=auth.uid(),recorded_at=v_now,note=nullif(btrim(p_note),''),revision=d.revision+1,updated_at=v_now
  where ad.appointment_id=d.appointment_id returning * into d;
  if a.status='reserved' then
   update public.appointments ap set status='confirmed',confirmed_at=v_now,updated_by_user_id=auth.uid(),updated_at=v_now
   where ap.id=a.id and ap.business_id=a.business_id returning * into a;
  end if;
  v_audit:='appointment.deposit_'||p_action;
 else
  if d.waived_reason='policy_disabled' then raise exception 'DEPOSIT_ACTION_INVALID'; end if;
  if a.status='confirmed' then
   update public.appointments ap set status='reserved',confirmed_at=null,updated_by_user_id=auth.uid(),updated_at=v_now
   where ap.id=a.id and ap.business_id=a.business_id returning * into a;
  end if;
  update public.appointment_deposits ad set status='pending',waived_reason=null,recorded_by=null,recorded_at=null,note=null,
   auto_cancel=d.auto_cancel and (d.due_at-v_now>=make_interval(hours=>d.min_payment_hours)),revision=d.revision+1,updated_at=v_now
  where ad.appointment_id=d.appointment_id returning * into d;
  v_audit:='appointment.deposit_reopened';
 end if;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(p_business_id,auth.uid(),v_audit,'appointment',p_appointment_id,
  jsonb_build_object('deposit_status',d.status,'appointment_status',a.status,'amount',d.amount));
 return query select d.status,d.revision,a.status;
end $$;

-- Who opened the WhatsApp asking for the deposit, and when. Not a revision of the deposit: it
-- must not turn another person's pending «Confirmar seña» into a conflict. Opening it again needs an
-- explicit p_reopen, decided under the turn's lock: two people never send it twice without knowing
-- (plan, section 4.8), not even when they click at the same time.
create function public.open_appointment_deposit_reminder(p_business_id uuid, p_appointment_id uuid, p_reopen boolean default false)
returns table(previously_opened_at timestamptz, opened_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.appointments; d public.appointment_deposits; v_now timestamptz:=now();
begin
 if private.deposit_actor(p_business_id,array['owner','admin','reception']) is null then raise exception 'DEPOSIT_FORBIDDEN'; end if;
 select * into a from public.appointments ap where ap.business_id=p_business_id and ap.id=p_appointment_id for no key update;
 if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
 select * into d from public.appointment_deposits ad where ad.business_id=p_business_id and ad.appointment_id=p_appointment_id for update;
 if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
 if a.status not in ('reserved','confirmed','reschedule_requested') or d.status='expired' then raise exception 'DEPOSIT_APPOINTMENT_CLOSED'; end if;
 if d.status<>'pending' then raise exception 'DEPOSIT_NOT_PENDING'; end if;
 if d.reminder_opened_at is not null and p_reopen is not true then raise exception 'DEPOSIT_REMINDER_ALREADY_OPENED'; end if;
 update public.appointment_deposits ad set reminder_opened_at=v_now,reminder_opened_by=auth.uid(),updated_at=v_now
 where ad.appointment_id=d.appointment_id;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(p_business_id,auth.uid(),'appointment.deposit_reminder_opened','appointment',p_appointment_id,null);
 return query select d.reminder_opened_at,v_now;
end $$;

-- The practice's policy. Turning it off waives every pending deposit (locking their turns in
-- identifier order first) and never confirms a turn: without a deposit policy the practice works
-- as usual. Changes apply to new bookings only; existing deposits keep their snapshot.
create function public.save_deposit_policy(p_business_id uuid, p_settings jsonb, p_expected_revision bigint) returns bigint
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
#variable_conflict use_column
declare v_current public.deposit_policies; v_new public.deposit_policies; v_excluded uuid[]; v_now timestamptz:=now();
 v_locked uuid[]; v_waived integer:=0; v_fixed numeric; v_percentage numeric;
begin
 if private.deposit_actor(p_business_id,array['owner','admin']) is null then raise exception 'DEPOSIT_POLICY_FORBIDDEN'; end if;
 -- Every key is required with its JSON type and no other key is accepted: a missing or mistyped
 -- value is an error, never a default (an unchecked box that is simply absent must not become
 -- «yes»). The expected revision is required as well.
 if p_expected_revision is null or jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text)>8192 then
  raise exception 'DEPOSIT_POLICY_INVALID'; end if;
 -- Its own statement, because the order of evaluation inside one condition is not guaranteed
 -- and the keys of a non-object would raise a different error. Array constructors, not '{...}'
 -- literals: in a literal an unquoted null is the SQL NULL, and `= any` over a NULL element is
 -- NULL, which a negated condition would silently let through.
 if exists(select 1 from (values ('enabled',array['boolean']),('auto_cancel_enabled',array['boolean']),('amount_mode',array['string']),
    ('fixed_amount',array['number','null']),('percentage',array['number','null']),('request_days',array['number']),
    ('deadline_hours',array['number']),('min_payment_hours',array['number']),('transfer_details',array['string','null']),
    ('applies_to_manual',array['boolean']),('excluded_service_ids',array['array'])) k(name,types)
   where (coalesce(jsonb_typeof(p_settings->k.name),'missing')=any(k.types)) is not true)
  or (select count(*) from jsonb_object_keys(p_settings))<>11 then
  raise exception 'DEPOSIT_POLICY_INVALID'; end if;
 select * into v_current from public.deposit_policies dp where dp.business_id=p_business_id for update;
 if coalesce(v_current.revision,0)<>p_expected_revision then raise exception 'DEPOSIT_POLICY_CHANGED'; end if;
 begin
  v_new.business_id:=p_business_id;
  v_new.enabled:=(p_settings->>'enabled')::boolean;
  v_new.auto_cancel_enabled:=(p_settings->>'auto_cancel_enabled')::boolean;
  v_new.amount_mode:=p_settings->>'amount_mode';
  -- Parsed as written: assigning to bigint or numeric(5,2) would round silently.
  v_fixed:=(p_settings->>'fixed_amount')::numeric;
  v_percentage:=(p_settings->>'percentage')::numeric;
  -- An integer column rejects 7.5 instead of rounding it.
  v_new.request_days:=(p_settings->>'request_days')::integer;
  v_new.deadline_hours:=(p_settings->>'deadline_hours')::integer;
  v_new.min_payment_hours:=(p_settings->>'min_payment_hours')::integer;
  v_new.transfer_details:=nullif(btrim(p_settings->>'transfer_details'),'');
  v_new.applies_to_manual:=(p_settings->>'applies_to_manual')::boolean;
  select coalesce(array_agg(distinct value::uuid),'{}') into v_excluded from jsonb_array_elements_text(p_settings->'excluded_service_ids');
 exception when others then raise exception 'DEPOSIT_POLICY_INVALID';
 end;
 if v_new.amount_mode not in ('fixed','percentage')
  or (v_fixed is not null and (v_fixed<>trunc(v_fixed) or v_fixed not between 1 and 1000000000000))
  or (v_percentage is not null and (v_percentage<=0 or v_percentage>100 or v_percentage<>round(v_percentage,2)))
  or v_new.request_days not between 1 and 60 or v_new.deadline_hours not between 1 and 720 or v_new.min_payment_hours not between 0 and 168
  or char_length(coalesce(v_new.transfer_details,''))>500
  or (v_new.enabled and ((v_new.amount_mode='fixed' and v_fixed is null) or (v_new.amount_mode='percentage' and v_percentage is null)))
  or exists(select 1 from unnest(v_excluded) e(service_id) where not exists(
   select 1 from public.services s where s.business_id=p_business_id and s.id=e.service_id)) then
  raise exception 'DEPOSIT_POLICY_INVALID';
 end if;
 v_new.fixed_amount:=v_fixed::bigint;
 v_new.percentage:=v_percentage;
 insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,percentage,request_days,deadline_hours,
  min_payment_hours,transfer_details,applies_to_manual,revision,updated_at,updated_by)
 values(p_business_id,v_new.enabled,v_new.auto_cancel_enabled,v_new.amount_mode,v_new.fixed_amount,v_new.percentage,v_new.request_days,
  v_new.deadline_hours,v_new.min_payment_hours,v_new.transfer_details,v_new.applies_to_manual,coalesce(v_current.revision,0)+1,v_now,auth.uid())
 on conflict (business_id) do update set enabled=excluded.enabled,auto_cancel_enabled=excluded.auto_cancel_enabled,amount_mode=excluded.amount_mode,
  fixed_amount=excluded.fixed_amount,percentage=excluded.percentage,request_days=excluded.request_days,deadline_hours=excluded.deadline_hours,
  min_payment_hours=excluded.min_payment_hours,transfer_details=excluded.transfer_details,applies_to_manual=excluded.applies_to_manual,
  revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by
 where deposit_policies.revision=coalesce(v_current.revision,0);
 if not found then raise exception 'DEPOSIT_POLICY_CHANGED'; end if;
 delete from public.deposit_service_exclusions e where e.business_id=p_business_id;
 insert into public.deposit_service_exclusions(business_id,service_id) select p_business_id,service_id from unnest(v_excluded) service_id;
 if not v_new.enabled then
  select coalesce(array_agg(locked.id),'{}') into v_locked from (
   select a.id from public.appointments a
   join public.appointment_deposits ad on ad.appointment_id=a.id and ad.business_id=a.business_id
   where a.business_id=p_business_id and ad.status='pending'
   order by a.id
   for no key update of a
  ) locked;
  -- A deposit recorded while this waited is no longer pending: the status is re-read here.
  update public.appointment_deposits ad set status='waived',waived_reason='policy_disabled',revision=ad.revision+1,updated_at=v_now
  where ad.business_id=p_business_id and ad.appointment_id=any(v_locked) and ad.status='pending';
  get diagnostics v_waived=row_count;
 end if;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(p_business_id,auth.uid(),'business.deposit_policy_saved','business',p_business_id,
  jsonb_build_object('enabled',v_new.enabled,'auto_cancel_enabled',v_new.auto_cancel_enabled,'amount_mode',v_new.amount_mode,
   'revision',coalesce(v_current.revision,0)+1,'waived_pending',v_waived));
 return coalesce(v_current.revision,0)+1;
end $$;

-- What the booking page shows before booking, for every slot of the chosen day in one call (the
-- page never reloads to choose a time): the rule the booking trigger applies, asked by the server
-- with the quote it holds. Without the transfer details, which the person sees on the turn's page
-- once booked.
create function public.get_deposit_terms_for_slots(p_business_id uuid, p_service_id uuid, p_starts_at timestamptz[],
 p_source text, p_price_quote jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_starts_at is null or cardinality(p_starts_at)>200 or array_position(p_starts_at,null) is not null then
  raise exception 'DEPOSIT_TERMS_INVALID'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('starts_at',slot.starts_at,'required',(terms->>'required')::boolean,
   'amount',terms->'amount','due_at',terms->'due_at','auto_cancel',terms->'auto_cancel') order by slot.starts_at),'[]'::jsonb)
  from unnest(p_starts_at) slot(starts_at)
  cross join lateral private.deposit_terms(p_business_id,p_service_id,p_source,slot.starts_at,now(),p_price_quote) terms);
end $$;

-- The deposits page shows when the automatic cancellation last ran; no practice data.
create function public.get_deposit_automation_status() returns table(enabled boolean, last_run_finished_at timestamptz)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select da.enabled,da.last_run_finished_at from private.deposit_automation da where da.singleton
$$;

-- One turn, decided under its lock with everything re-read: a list built by an earlier
-- statement can hold a deposit recorded after it started.
create function private.expire_deposit_if_still_due(p_appointment_id uuid, p_now timestamptz) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.appointments; d public.appointment_deposits; p public.deposit_policies; v_timezone text;
begin
 select * into a from public.appointments ap where ap.id=p_appointment_id for no key update;
 if not found then return false; end if;
 select * into d from public.appointment_deposits ad where ad.appointment_id=a.id and ad.business_id=a.business_id;
 if not found then return false; end if;
 select * into p from public.deposit_policies dp where dp.business_id=a.business_id;
 if not found or d.status<>'pending' or not d.auto_cancel or d.due_at>p_now or d.due_at<=p_now-interval '24 hours'
  or a.status<>'reserved' or a.starts_at<=p_now or not p.enabled or not p.auto_cancel_enabled
  or not coalesce((select da.enabled from private.deposit_automation da where da.singleton),false)
  or not exists(select 1 from public.businesses b where b.id=a.business_id and b.is_active)
  or public.business_allows_operation(a.business_id) is not true then
  return false;
 end if;
 select b.timezone into v_timezone from public.businesses b where b.id=a.business_id;
 update public.appointment_deposits ad set status='expired',expired_at=p_now,revision=d.revision+1,updated_at=p_now
 where ad.appointment_id=d.appointment_id;
 update public.appointments ap set status='cancelled',cancelled_at=p_now,cancelled_by_user_id=null,
  cancelled_reason='Seña no registrada antes del '||to_char(d.due_at at time zone v_timezone,'DD/MM/YYYY HH24:MI'),
  updated_by_user_id=null,updated_at=p_now
 where ap.id=a.id and ap.business_id=a.business_id;
 insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
 values(a.business_id,null,'appointment.deposit_expired','appointment',a.id,
  jsonb_build_object('due_at',d.due_at,'amount',d.amount,'from_status',a.status,'to_status','cancelled'));
 return true;
end $$;

-- The automatic cancellation (pg_cron, every five minutes). It locks appointments only, skips
-- the ones in use (they are evaluated again five minutes later) and never waits. A deposit due
-- more than 24 h ago is never cancelled here: after any outage it waits for a person.
create function private.expire_unpaid_deposits(p_now timestamptz default now(), p_limit integer default 100) returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_enabled boolean; v_ids uuid[]:='{}'; v_id uuid; v_cancelled integer:=0;
begin
 update private.deposit_automation set last_run_started_at=clock_timestamp() where singleton returning enabled into v_enabled;
 if coalesce(v_enabled,false) then
  select coalesce(array_agg(candidate.id order by candidate.due_at,candidate.id),'{}') into v_ids from (
   select a.id,ad.due_at from public.appointments a
   join public.appointment_deposits ad on ad.appointment_id=a.id and ad.business_id=a.business_id
   join public.deposit_policies dp on dp.business_id=a.business_id
   where ad.status='pending' and ad.auto_cancel and ad.due_at<=p_now and ad.due_at>p_now-interval '24 hours'
    and a.status='reserved' and a.starts_at>p_now and dp.enabled and dp.auto_cancel_enabled
   order by ad.due_at,a.id
   limit greatest(1,least(coalesce(p_limit,100),500))
   for no key update of a skip locked
  ) candidate;
  foreach v_id in array v_ids loop
   if private.expire_deposit_if_still_due(v_id,p_now) then v_cancelled:=v_cancelled+1; end if;
  end loop;
 end if;
 update private.deposit_automation set last_run_finished_at=clock_timestamp(),last_run_processed=cardinality(v_ids),
  last_run_cancelled=v_cancelled where singleton;
 return v_cancelled;
end $$;

revoke all on function private.deposit_schedule(timestamptz,timestamptz,text,integer,integer,integer),
 private.deposit_amount(public.deposit_policies,uuid,jsonb),
 private.deposit_terms(uuid,uuid,text,timestamptz,timestamptz,jsonb),
 private.create_appointment_deposit(),private.reschedule_appointment_deposit(),private.enforce_deposit_before_confirmation(),
 private.deposit_actor(uuid,text[]),private.expire_deposit_if_still_due(uuid,timestamptz),private.expire_unpaid_deposits(timestamptz,integer)
 from public,anon,authenticated,service_role;
revoke all on function public.set_appointment_deposit(uuid,uuid,text,bigint,text),public.open_appointment_deposit_reminder(uuid,uuid,boolean),
 public.save_deposit_policy(uuid,jsonb,bigint),public.get_deposit_terms_for_slots(uuid,uuid,timestamptz[],text,jsonb),
 public.get_deposit_automation_status() from public,anon,authenticated,service_role;
grant execute on function public.set_appointment_deposit(uuid,uuid,text,bigint,text),public.open_appointment_deposit_reminder(uuid,uuid,boolean),
 public.save_deposit_policy(uuid,jsonb,bigint),public.get_deposit_automation_status() to authenticated;
grant execute on function public.get_deposit_terms_for_slots(uuid,uuid,timestamptz[],text,jsonb),public.get_deposit_automation_status() to service_role;

-- pg_cron keeps one history row per run and never deletes them (Supabase Cron quickstart);
-- with jobs every five minutes the table would only grow. Fourteen days are kept.
do $$
declare v_job_id bigint;
begin
 if to_regnamespace('cron') is null then raise exception 'DEPOSIT_CRON_UNAVAILABLE'; end if;
 for v_job_id in select jobid from cron.job where jobname in ('cita-suite-deposit-expiry','cita-suite-cron-history-retention') loop
  perform cron.unschedule(v_job_id);
 end loop;
 perform cron.schedule('cita-suite-deposit-expiry','*/5 * * * *','select private.expire_unpaid_deposits()');
 perform cron.schedule('cita-suite-cron-history-retention','37 5 * * *',
  'delete from cron.job_run_details where end_time < now() - interval ''14 days''');
end;
$$;

notify pgrst, 'reload schema';
commit;
