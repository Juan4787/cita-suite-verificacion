begin;

-- A clean Supabase reconstruction does not inherit the grants that already
-- exist in the hosted project. Cita Suite's trusted server client performs
-- maintenance and server-only reads/writes across the public schema, so those
-- privileges must be explicit and reproducible. This does not grant anything
-- to anon or authenticated and service_role continues to stay server-side.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Older hosted projects auto-granted table privileges when a table was
-- created; current clean CLI reconstructions no longer do that by default.
-- Reproduce only the operations that already have an authenticated RLS policy
-- instead of relying on environment-specific implicit grants.
grant usage on schema public to authenticated;
grant select on table public.access_grants to authenticated;
grant select on table public.account_assistance_grants to authenticated;
grant select on table public.allowed_emails to authenticated;
grant select on table public.appointment_professionals to authenticated;
grant select, insert, update on table public.appointments to authenticated;
grant select, insert on table public.audit_logs to authenticated;
grant select, insert, update, delete on table public.availability_exceptions to authenticated;
grant select, insert, update, delete on table public.availability_rules to authenticated;
grant select on table public.business_subscriptions to authenticated;
grant select on table public.business_user_invites to authenticated;
grant select, insert, update, delete on table public.business_users to authenticated;
grant select, update on table public.businesses to authenticated;
grant select, insert, update, delete on table public.clinical_entries to authenticated;
grant select on table public.clinical_entry_costs to authenticated;
grant select, insert, update, delete on table public.follow_ups to authenticated;
grant select on table public.inbound_messages to authenticated;
grant select, update on table public.message_dispatches to authenticated;
grant select, insert, update, delete on table public.message_templates to authenticated;
grant select, insert, update, delete on table public.messaging_accounts to authenticated;
grant select on table public.patient_clinical_profiles to authenticated;
grant select, insert on table public.patient_profile_change_events to authenticated;
grant select on table public.patient_radiographs to authenticated;
grant select, insert, update, delete on table public.patients to authenticated;
grant select, insert, update, delete on table public.professional_services to authenticated;
grant select, insert, update, delete on table public.professional_users to authenticated;
grant select, insert, update on table public.professionals to authenticated;
grant select on table public.public_booking_attempts to authenticated;
grant select, insert, update on table public.services to authenticated;
grant select on table public.whatsapp_webhook_events to authenticated;

-- Clinical files remain mutation-only through their audited RPC control
-- plane, even for application code holding the service credential.
revoke insert, update, delete on table public.patient_radiographs from service_role;
grant select on table public.patient_radiographs to service_role;

-- Audit history is append-only to the application backend.
revoke update, delete on table public.audit_logs from service_role;
grant select, insert on table public.audit_logs to service_role;

-- Rate-limit events are reachable only through the bounded security-definer
-- functions, never as a general-purpose server-side table API.
revoke select, insert, update, delete on table public.server_rate_limit_events from service_role;

-- The discontinued Google Drive model stays inert for every application role,
-- including the server client. Historical rows remain only as inventory.
revoke select, insert, update, delete on table public.drive_connections from service_role;
do $$
begin
	if to_regclass('public.patient_drive_folders') is not null then
		execute 'revoke select, insert, update, delete on table public.patient_drive_folders from service_role';
	end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
