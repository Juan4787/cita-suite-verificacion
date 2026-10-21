-- Production still carries privileges that Supabase granted automatically when its
-- older tables were created. No migration declares them, so a project rebuilt from the
-- migrations does not have them, and the application does not use them: it reaches these
-- tables through functions or with the service role. Row level security already denied
-- what they allow; this removes them, so every environment holds exactly the privileges
-- the migrations grant. Tables outside these migrations hold no privilege for these roles
-- and do not change. Evidence: .verification/api-privileges-production-20261021.json,
-- compared with the catalog of a project rebuilt from the migrations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Nothing in the Data API creates foreign keys, triggers or maintenance work.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;

revoke insert, update, delete on table public.allowed_emails from authenticated;
revoke delete on table public.appointments from authenticated;
revoke update, delete on table public.audit_logs from authenticated;
revoke insert, delete on table public.businesses from authenticated;
revoke insert, update, delete on table public.inbound_messages from authenticated;
revoke insert, delete on table public.message_dispatches from authenticated;
revoke all on table public.mp_subscriptions from authenticated;
revoke all on table public.mp_webhook_events from authenticated;
revoke all on table public.professional_patient_links from authenticated;
revoke delete on table public.professionals from authenticated;
revoke insert, update, delete on table public.public_booking_attempts from authenticated;
revoke delete on table public.services from authenticated;
revoke insert, update, delete on table public.whatsapp_webhook_events from authenticated;

notify pgrst, 'reload schema';
commit;
