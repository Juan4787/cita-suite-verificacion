-- Production only: runs inside the publication transaction, before the pending migrations.
--
-- Production's catalog drifted from its own migration history: changes made outside the
-- migrations dropped policies the applied migrations create, added policies and functions no
-- migration declares, and renamed foreign keys. The pending migrations expect the state the
-- applied ones declare (a dry run on production failed on exactly these objects), and the tests
-- prove that state. This file returns the objects of Cita Suite to it. Objects of other products in
-- the project are not touched (clave-de-servicio.md). Every statement checks its object or restates
-- the migrations' own definition, so on a database built from the migrations the catalog ends the
-- same once the pending migrations apply.

-- 1. Policies the applied migrations create (20260513000000 to 20260528052136) and that were dropped
-- outside them. Some are replaced or dropped again by the pending migrations, as in staging.
do $reconcile$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='access_grants' and policyname='access_grants_members_read') then
    create policy access_grants_members_read on public.access_grants for select to authenticated
      using (public.user_can_manage_business(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_appointment_schedule_select') then
    create policy audit_logs_appointment_schedule_select on public.audit_logs for select to authenticated
      using (business_id is not null and entity_type = 'appointment' and exists (
        select 1 from public.appointments a where a.business_id = audit_logs.business_id and a.id = audit_logs.entity_id
          and public.user_can_read_professional_schedule(a.business_id, a.professional_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and policyname='audit_logs_insert') then
    create policy audit_logs_insert on public.audit_logs for insert to authenticated
      with check (public.user_has_business_access(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='business_subscriptions' and policyname='business_subscriptions_members_read') then
    create policy business_subscriptions_members_read on public.business_subscriptions for select to authenticated
      using (public.user_has_business_access(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='business_users' and policyname='business admins can delete memberships') then
    create policy "business admins can delete memberships" on public.business_users for delete to authenticated
      using (public.user_can_manage_business(business_id) and public.business_allows_operation(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='business_users' and policyname='business admins can insert memberships') then
    create policy "business admins can insert memberships" on public.business_users for insert to authenticated
      with check (public.user_can_manage_business(business_id) and public.business_allows_operation(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='business_users' and policyname='business admins can update memberships') then
    create policy "business admins can update memberships" on public.business_users for update to authenticated
      using (public.user_can_manage_business(business_id) and public.business_allows_operation(business_id))
      with check (public.user_can_manage_business(business_id) and public.business_allows_operation(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clinical_entries' and policyname='clinical_entries_business_operator_delete') then
    create policy clinical_entries_business_operator_delete on public.clinical_entries for delete to authenticated
      using (business_id is not null and public.user_can_operate_business(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clinical_entries' and policyname='clinical_entries_business_operator_insert') then
    create policy clinical_entries_business_operator_insert on public.clinical_entries for insert to authenticated
      with check (business_id is not null and public.user_can_operate_business(business_id) and exists (
        select 1 from public.patients p where p.id = clinical_entries.patient_id and p.business_id = clinical_entries.business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clinical_entries' and policyname='clinical_entries_business_operator_update') then
    create policy clinical_entries_business_operator_update on public.clinical_entries for update to authenticated
      using (business_id is not null and public.user_can_operate_business(business_id))
      with check (business_id is not null and public.user_can_operate_business(business_id) and exists (
        select 1 from public.patients p where p.id = clinical_entries.patient_id and p.business_id = clinical_entries.business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='message_dispatches' and policyname='message_dispatches_update') then
    create policy message_dispatches_update on public.message_dispatches for update to authenticated
      using (public.user_can_operate_business(business_id)) with check (public.user_can_operate_business(business_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='patients' and policyname='patients_business_admin_delete') then
    create policy patients_business_admin_delete on public.patients for delete to authenticated
      using (business_id is not null and public.user_can_manage_business(business_id));
  end if;
end
$reconcile$;

-- 2. Policies no migration declares, on tables of Cita Suite.
drop policy if exists access_grants_owner_read on public.access_grants;
drop policy if exists "master delete allowed_emails" on public.allowed_emails;
drop policy if exists "master insert allowed_emails" on public.allowed_emails;
drop policy if exists "master read allowed_emails" on public.allowed_emails;
drop policy if exists "master update allowed_emails" on public.allowed_emails;
drop policy if exists audit_logs_no_direct_insert on public.audit_logs;
drop policy if exists business_subscriptions_owner_read on public.business_subscriptions;
drop policy if exists business_user_invites_select on public.business_user_invites;
drop policy if exists business_users_no_direct_delete on public.business_users;
drop policy if exists business_users_no_direct_insert on public.business_users;
drop policy if exists business_users_no_direct_update on public.business_users;
drop policy if exists business_users_select on public.business_users;
drop policy if exists clinical_entries_role_scoped_insert on public.clinical_entries;
drop policy if exists clinical_entries_role_scoped_update on public.clinical_entries;
drop policy if exists clinical_entry_costs_delete on public.clinical_entry_costs;
drop policy if exists clinical_entry_costs_insert on public.clinical_entry_costs;
drop policy if exists clinical_entry_costs_update on public.clinical_entry_costs;
drop policy if exists message_dispatches_no_direct_update on public.message_dispatches;
drop policy if exists patient_clinical_profiles_insert on public.patient_clinical_profiles;
drop policy if exists patient_clinical_profiles_update on public.patient_clinical_profiles;
drop policy if exists patients_no_direct_delete on public.patients;
drop policy if exists professional_patient_links_write on public.professional_patient_links;

-- 3. The tenant foreign keys of professional_patient_links already became composite under other
-- names. 20261016010000 replaces them by the same definition under the original names.
do $reconcile$
begin
  if exists (select 1 from pg_constraint where conrelid='public.professional_patient_links'::regclass and conname='professional_patient_links_business_id_patient_id_fkey')
     and not exists (select 1 from pg_constraint where conrelid='public.professional_patient_links'::regclass and conname='professional_patient_links_patient_id_fkey') then
    alter table public.professional_patient_links rename constraint professional_patient_links_business_id_patient_id_fkey to professional_patient_links_patient_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conrelid='public.professional_patient_links'::regclass and conname='professional_patient_links_business_id_professional_id_fkey')
     and not exists (select 1 from pg_constraint where conrelid='public.professional_patient_links'::regclass and conname='professional_patient_links_professional_id_fkey') then
    alter table public.professional_patient_links rename constraint professional_patient_links_business_id_professional_id_fkey to professional_patient_links_professional_id_fkey;
  end if;
end
$reconcile$;

-- 4. Functions no migration declares that an authenticated user could call directly: earlier
-- membership, invitation and link operations, now alternative paths around the transactional
-- contracts. They stay, without execution for the API roles; the service role keeps it.
do $reconcile$
declare signature text;
begin
  foreach signature in array array[
    'public.accept_pending_business_invites_for_user(text,uuid)',
    'public.assign_business_role_to_email_safely(uuid,text,text,uuid,boolean)',
    'public.change_business_user_role_safely(uuid,text)',
    'public.disable_allowed_email_as_authenticated_master_safely(text,text)',
    'public.disable_allowed_email_safely(text,text)',
    'public.disable_business_user_safely(uuid,text)',
    'public.disable_professional_patient_link(uuid,text)',
    'public.link_patient_to_professional_safely(uuid,uuid,uuid,text)',
    'public.link_professional_user_safely(uuid,uuid,uuid)',
    'public.unlink_professional_user_safely(uuid,uuid)',
    'public.sync_patient_last_entry()'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', signature);
    end if;
  end loop;
end
$reconcile$;

-- 5. Function bodies changed outside the migrations, restored to the migrations' definitions:
-- the commercial check of operation, the team list of an appointment's history and the schedule
-- replacement. The list returned other columns, so it is replaced, not altered.
CREATE OR REPLACE FUNCTION public.business_allows_operation(target_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
	select case
		when exists (
			select 1
			from business_subscriptions bs
			where bs.business_id = target_business_id
		) then coalesce((
			select
				bs.archived_at is null
				and bs.commercial_access_enabled = true
				and (
					bs.is_permanent = true
					or (bs.paid_until is not null and now() <= bs.paid_until)
					or (bs.grace_until is not null and now() <= bs.grace_until)
				)
			from business_subscriptions bs
			where bs.business_id = target_business_id
		), false)
		else coalesce((
			select b.created_at < timestamp with time zone '2026-05-28 05:21:36+00'
			from businesses b
			where b.id = target_business_id
		), false)
	end;
$function$;
drop function if exists public.list_business_users(uuid);
CREATE OR REPLACE FUNCTION public.list_business_users(target_business_id uuid)
 RETURNS TABLE(id uuid, business_id uuid, user_id uuid, email text, role text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
begin
	if not public.user_has_business_access(target_business_id) then
		raise exception 'BUSINESS_ACCESS_DENIED';
	end if;

	return query
	select
		bu.id,
		bu.business_id,
		bu.user_id,
		au.email::text,
		bu.role,
		bu.created_at
	from business_users bu
	left join auth.users au on au.id = bu.user_id
	where bu.business_id = target_business_id
	order by
		case bu.role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end,
		au.email nulls last;
end;
$function$;
CREATE OR REPLACE FUNCTION public.replace_professional_availability_rules(p_business_id uuid, p_professional_id uuid, p_weekdays integer[], p_ranges jsonb, p_slot_interval_minutes integer)
 RETURNS SETOF availability_rules
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
	if p_business_id is null or p_professional_id is null then
		raise exception 'INVALID_PROFESSIONAL';
	end if;

	if p_weekdays is null or array_length(p_weekdays, 1) is null then
		raise exception 'NO_WEEKDAYS';
	end if;

	if exists (
		select 1
		from unnest(p_weekdays) as weekday
		where weekday < 0 or weekday > 6
	) then
		raise exception 'INVALID_WEEKDAY';
	end if;

	if p_slot_interval_minutes is null or p_slot_interval_minutes < 5 or p_slot_interval_minutes > 120 then
		raise exception 'INVALID_SLOT_INTERVAL';
	end if;

	if coalesce(jsonb_typeof(p_ranges), '') <> 'array' or jsonb_array_length(p_ranges) = 0 then
		raise exception 'NO_RANGES';
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
		where range_row.start_time is null
			or range_row.end_time is null
			or range_row.start_time >= range_row.end_time
	) then
		raise exception 'INVALID_RANGE';
	end if;

	if exists (
		with parsed_ranges as (
			select
				range_row.start_time,
				range_row.end_time,
				lag(range_row.end_time) over (order by range_row.start_time, range_row.end_time) as previous_end
			from jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
		)
		select 1
		from parsed_ranges
		where previous_end is not null
			and start_time < previous_end
	) then
		raise exception 'OVERLAPPING_RANGES';
	end if;

	delete from public.availability_rules
	where business_id = p_business_id
		and professional_id = p_professional_id
		and weekday in (select distinct weekday from unnest(p_weekdays) as weekdays(weekday));

	return query
	insert into public.availability_rules (
		business_id,
		professional_id,
		weekday,
		start_time,
		end_time,
		slot_interval_minutes,
		is_active
	)
	select
		p_business_id,
		p_professional_id,
		weekdays.weekday,
		range_row.start_time,
		range_row.end_time,
		p_slot_interval_minutes,
		true
	from (select distinct weekday from unnest(p_weekdays) as weekdays(weekday)) as weekdays
	cross join jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
	returning *;
end;
$function$;

-- 6. Read and write policies changed outside the migrations, restored to their definitions.
alter policy availability_exceptions_select on public.availability_exceptions using (user_has_business_access(business_id));
alter policy availability_rules_select on public.availability_rules using (user_has_business_access(business_id));
alter policy inbound_messages_select on public.inbound_messages using (user_has_business_access(business_id));
alter policy message_dispatches_select on public.message_dispatches using (user_has_business_access(business_id));
alter policy message_templates_select on public.message_templates using (user_has_business_access(business_id));
alter policy message_templates_write on public.message_templates using (user_can_manage_business(business_id)) with check (user_can_manage_business(business_id));
alter policy messaging_accounts_select on public.messaging_accounts using (user_has_business_access(business_id));
alter policy messaging_accounts_write on public.messaging_accounts using (user_can_manage_business(business_id)) with check (user_can_manage_business(business_id));
alter policy professional_services_select on public.professional_services using (user_has_business_access(business_id));
alter policy professional_users_select on public.professional_users using (user_has_business_access(business_id));
alter policy professionals_select on public.professionals using (user_has_business_access(business_id));
alter policy services_select on public.services using (user_has_business_access(business_id));
alter policy whatsapp_webhook_events_select on public.whatsapp_webhook_events using (((business_id IS NOT NULL) AND user_can_manage_business(business_id)));

-- 7. Columns whose nullability or default changed outside the migrations. A default of auth.uid()
-- breaks every insertion the server makes with its own key, where there is no user.
alter table public.clinical_entries alter column owner_id drop not null, alter column owner_id drop default;
alter table public.patients alter column owner_id drop not null, alter column owner_id drop default,
  alter column custom_fields drop not null, alter column custom_fields drop default;
alter table public.professional_patient_links alter column source set default 'manual';

-- 8. Constraints and indexes: the ones the migrations declare, as they declare them; none they
-- do not. Each one is rebuilt only when its definition differs.
alter table public.clinical_entries drop constraint if exists clinical_entries_business_professional_fk,
  drop constraint if exists clinical_entries_entry_type_check;
alter table public.audit_logs drop constraint if exists audit_logs_result_check;
drop index if exists public.patients_owner_dni_unique;
drop index if exists public.allowed_emails_email_lower_idx;
do $reconcile$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.allowed_emails'::regclass and conname='allowed_emails_email_key') then
    alter table public.allowed_emails add constraint allowed_emails_email_key unique (email);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.business_user_invites'::regclass and conname='business_user_invites_business_id_professional_id_fkey') then
    alter table public.business_user_invites add constraint business_user_invites_business_id_professional_id_fkey
      foreign key (business_id, professional_id) references public.professionals(business_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.business_user_invites'::regclass and conname='business_user_invites_check') then
    alter table public.business_user_invites add constraint business_user_invites_check check (role <> 'professional' or professional_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.clinical_entries'::regclass and conname='clinical_entries_owner_id_fkey') then
    -- Entries whose owner was removed while production had no such key keep their history: the
    -- reference becomes empty, as the key's rule (20261022000000) does for every later removal.
    update public.clinical_entries e set owner_id = null
      where e.owner_id is not null and not exists (select 1 from auth.users u where u.id = e.owner_id);
    alter table public.clinical_entries add constraint clinical_entries_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete set null;
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.business_user_invites'::regclass and conname='business_user_invites_status_check')
     is distinct from $def$CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text])))$def$ then
    alter table public.business_user_invites drop constraint if exists business_user_invites_status_check,
      add constraint business_user_invites_status_check check (status = any (array['pending'::text, 'accepted'::text, 'cancelled'::text]));
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.appointments'::regclass and conname='appointments_no_overlapping_active')
     is distinct from $def$EXCLUDE USING gist (business_id WITH =, professional_id WITH =, tstzrange(blocking_starts_at, blocking_ends_at, '[)'::text) WITH &&) WHERE ((status = ANY (ARRAY['reserved'::text, 'confirmed'::text, 'reschedule_requested'::text])))$def$ then
    alter table public.appointments drop constraint if exists appointments_no_overlapping_active,
      add constraint appointments_no_overlapping_active exclude using gist (business_id with =, professional_id with =,
        tstzrange(blocking_starts_at, blocking_ends_at, '[)') with &&) where (status = any (array['reserved'::text, 'confirmed'::text, 'reschedule_requested'::text]));
  end if;
  if (select pg_get_indexdef(oid) from pg_class where oid = to_regclass('public.business_user_invites_pending_email_uq'))
     is distinct from $def$CREATE UNIQUE INDEX business_user_invites_pending_email_uq ON public.business_user_invites USING btree (business_id, lower(email)) WHERE (status = 'pending'::text)$def$ then
    drop index if exists public.business_user_invites_pending_email_uq;
    create unique index business_user_invites_pending_email_uq on public.business_user_invites using btree (business_id, lower(email)) where (status = 'pending'::text);
  end if;
end
$reconcile$;
