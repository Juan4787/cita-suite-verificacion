-- Memberships, patients, professional links and assignments, appointment creation, exceptions,
-- professional and service creation and the audit trail change only through their transactional
-- RPCs or the server, which keep the rules: last owner and role assignment, the visible patient
-- history, the booking contracts. Their direct Data API writes stayed open since the first
-- migrations and the application never used them: an administrator could promote itself to owner
-- or remove the owner with one direct update. Production had closed some of them outside the
-- migrations (supabase/production/reconcile-drift.sql). The writes the application makes with the
-- user client stay: appointment, professional and service updates, and exception deletion.
begin;
drop policy if exists "business admins can insert memberships" on public.business_users;
drop policy if exists "business admins can update memberships" on public.business_users;
drop policy if exists "business admins can delete memberships" on public.business_users;
revoke insert, update, delete on table public.business_users from authenticated;

drop policy if exists patients_business_operator_insert on public.patients;
drop policy if exists patients_business_operator_update on public.patients;
drop policy if exists patients_business_admin_delete on public.patients;
revoke insert, update, delete on table public.patients from authenticated;

drop policy if exists professional_users_write on public.professional_users;
revoke insert, update, delete on table public.professional_users from authenticated;

drop policy if exists professional_services_write on public.professional_services;
revoke insert, update, delete on table public.professional_services from authenticated;

drop policy if exists appointments_insert on public.appointments;
revoke insert on table public.appointments from authenticated;

-- The policy also covers the deletion the application makes.
revoke insert, update on table public.availability_exceptions from authenticated;

drop policy if exists professionals_insert on public.professionals;
revoke insert on table public.professionals from authenticated;

drop policy if exists services_insert on public.services;
revoke insert on table public.services from authenticated;

drop policy if exists audit_logs_insert on public.audit_logs;
revoke insert on table public.audit_logs from authenticated;

-- Invitations change only through upsert_business_role_access; no policy ever let these writes in.
revoke insert, update, delete on table public.business_user_invites from authenticated;

-- The authorization helpers the policies use, and the schedule replacement, are for signed-in
-- users and the server: the public anon key, which reaches no table, needs none of them.
revoke execute on function public.business_allows_operation(uuid), public.list_business_users(uuid),
  public.user_can_configure_business(uuid), public.user_can_manage_business(uuid), public.user_can_manage_users(uuid),
  public.user_can_operate_business(uuid), public.user_can_read_professional_schedule(uuid,uuid),
  public.replace_professional_availability_rules(uuid,uuid,integer[],jsonb,integer) from public, anon;
grant execute on function public.business_allows_operation(uuid), public.list_business_users(uuid),
  public.user_can_configure_business(uuid), public.user_can_manage_business(uuid), public.user_can_manage_users(uuid),
  public.user_can_operate_business(uuid), public.user_can_read_professional_schedule(uuid,uuid),
  public.replace_professional_availability_rules(uuid,uuid,integer[],jsonb,integer) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
