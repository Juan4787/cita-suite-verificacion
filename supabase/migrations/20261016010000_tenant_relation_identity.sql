-- Enforce clinic identity at the relationship, including privileged writes.
-- Preserve FK names to avoid ambiguous PostgREST embeddings, and every
-- existing ON DELETE action. Never clear business_id through SET NULL.
-- No clinical data is rewritten. Legacy NULL clinic identities stay unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A mismatched historical link blocks the migration with counts only. It must
-- be diagnosed separately; silently assigning/deleting real data is forbidden.
do $preflight$
declare mismatches bigint;
begin
  select count(*) into mismatches from public.clinical_entries child join public.patients parent on parent.id=child.patient_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: clinical_entries_patient_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.clinical_entry_costs child join public.clinical_entries parent on parent.id=child.clinical_entry_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: clinical_entry_costs_clinical_entry_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.follow_ups child join public.professionals parent on parent.id=child.assigned_professional_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: follow_ups_assigned_professional_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.follow_ups child join public.patients parent on parent.id=child.patient_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: follow_ups_patient_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.google_review_requests child join public.push_delivery_attempts parent on parent.id=child.push_delivery_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: google_review_requests_push_delivery_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.google_review_requests child join public.push_subscriptions parent on parent.id=child.push_subscription_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: google_review_requests_push_subscription_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.mp_webhook_events child join public.access_grants parent on parent.id=child.credited_grant_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: mp_webhook_events_credited_grant_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.patient_clinical_profiles child join public.patients parent on parent.id=child.patient_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: patient_clinical_profiles_patient_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.patient_profile_change_events child join public.professionals parent on parent.id=child.changed_by_professional_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: patient_profile_change_events_changed_by_professional_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.patient_profile_change_events child join public.patients parent on parent.id=child.patient_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: patient_profile_change_events_patient_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.patient_radiographs child join public.patients parent on parent.id=child.patient_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: patient_radiographs_patient_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.professional_patient_links child join public.patients parent on parent.id=child.patient_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: professional_patient_links_patient_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.professional_patient_links child join public.professionals parent on parent.id=child.professional_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: professional_patient_links_professional_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.push_delivery_attempts child join public.google_review_requests parent on parent.id=child.google_review_request_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: push_delivery_attempts_google_review_request_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.push_delivery_attempts child join public.push_subscriptions parent on parent.id=child.subscription_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: push_delivery_attempts_subscription_id_fkey (% rows)', mismatches; end if;
  select count(*) into mismatches from public.push_subscriptions child join public.appointments parent on parent.id=child.appointment_id
    where child.business_id is not null and child.business_id is distinct from parent.business_id;
  if mismatches > 0 then raise exception 'TENANT_RELATION_INCONSISTENCY: push_subscriptions_appointment_id_fkey (% rows)', mismatches; end if;
end $preflight$;

alter table public.access_grants add constraint access_grants_business_id_id_key unique (business_id,id);
alter table public.clinical_entries add constraint clinical_entries_business_id_id_key unique (business_id,id);
alter table public.google_review_requests add constraint google_review_requests_business_id_id_key unique (business_id,id);
alter table public.push_delivery_attempts add constraint push_delivery_attempts_business_id_id_key unique (business_id,id);
alter table public.push_subscriptions add constraint push_subscriptions_business_id_id_key unique (business_id,id);

alter table public.clinical_entries
  drop constraint clinical_entries_patient_id_fkey,
  add constraint clinical_entries_patient_id_fkey foreign key (business_id,patient_id)
    references public.patients(business_id,id) ON DELETE CASCADE not valid;
alter table public.clinical_entries validate constraint clinical_entries_patient_id_fkey;

alter table public.clinical_entry_costs
  drop constraint clinical_entry_costs_clinical_entry_id_fkey,
  add constraint clinical_entry_costs_clinical_entry_id_fkey foreign key (business_id,clinical_entry_id)
    references public.clinical_entries(business_id,id) ON DELETE CASCADE not valid;
alter table public.clinical_entry_costs validate constraint clinical_entry_costs_clinical_entry_id_fkey;

alter table public.follow_ups
  drop constraint follow_ups_assigned_professional_id_fkey,
  add constraint follow_ups_assigned_professional_id_fkey foreign key (business_id,assigned_professional_id)
    references public.professionals(business_id,id) ON DELETE RESTRICT not valid;
alter table public.follow_ups validate constraint follow_ups_assigned_professional_id_fkey;

alter table public.follow_ups
  drop constraint follow_ups_patient_id_fkey,
  add constraint follow_ups_patient_id_fkey foreign key (business_id,patient_id)
    references public.patients(business_id,id) ON DELETE CASCADE not valid;
alter table public.follow_ups validate constraint follow_ups_patient_id_fkey;

alter table public.google_review_requests
  drop constraint google_review_requests_push_delivery_id_fkey,
  add constraint google_review_requests_push_delivery_id_fkey foreign key (business_id,push_delivery_id)
    references public.push_delivery_attempts(business_id,id) ON DELETE SET NULL (push_delivery_id) deferrable initially deferred not valid;
alter table public.google_review_requests validate constraint google_review_requests_push_delivery_id_fkey;

alter table public.google_review_requests
  drop constraint google_review_requests_push_subscription_id_fkey,
  add constraint google_review_requests_push_subscription_id_fkey foreign key (business_id,push_subscription_id)
    references public.push_subscriptions(business_id,id) ON DELETE SET NULL (push_subscription_id) not valid;
alter table public.google_review_requests validate constraint google_review_requests_push_subscription_id_fkey;

alter table public.mp_webhook_events
  drop constraint mp_webhook_events_credited_grant_id_fkey,
  add constraint mp_webhook_events_credited_grant_id_fkey foreign key (business_id,credited_grant_id)
    references public.access_grants(business_id,id) ON DELETE SET NULL (credited_grant_id) not valid;
alter table public.mp_webhook_events validate constraint mp_webhook_events_credited_grant_id_fkey;

alter table public.patient_clinical_profiles
  drop constraint patient_clinical_profiles_patient_id_fkey,
  add constraint patient_clinical_profiles_patient_id_fkey foreign key (business_id,patient_id)
    references public.patients(business_id,id) ON DELETE CASCADE not valid;
alter table public.patient_clinical_profiles validate constraint patient_clinical_profiles_patient_id_fkey;

alter table public.patient_profile_change_events
  drop constraint patient_profile_change_events_changed_by_professional_id_fkey,
  add constraint patient_profile_change_events_changed_by_professional_id_fkey foreign key (business_id,changed_by_professional_id)
    references public.professionals(business_id,id)  not valid;
alter table public.patient_profile_change_events validate constraint patient_profile_change_events_changed_by_professional_id_fkey;

alter table public.patient_profile_change_events
  drop constraint patient_profile_change_events_patient_id_fkey,
  add constraint patient_profile_change_events_patient_id_fkey foreign key (business_id,patient_id)
    references public.patients(business_id,id) ON DELETE CASCADE not valid;
alter table public.patient_profile_change_events validate constraint patient_profile_change_events_patient_id_fkey;

alter table public.patient_radiographs
  drop constraint patient_radiographs_patient_id_fkey,
  add constraint patient_radiographs_patient_id_fkey foreign key (business_id,patient_id)
    references public.patients(business_id,id) ON DELETE RESTRICT not valid;
alter table public.patient_radiographs validate constraint patient_radiographs_patient_id_fkey;

alter table public.professional_patient_links
  drop constraint professional_patient_links_patient_id_fkey,
  add constraint professional_patient_links_patient_id_fkey foreign key (business_id,patient_id)
    references public.patients(business_id,id) ON DELETE CASCADE not valid;
alter table public.professional_patient_links validate constraint professional_patient_links_patient_id_fkey;

alter table public.professional_patient_links
  drop constraint professional_patient_links_professional_id_fkey,
  add constraint professional_patient_links_professional_id_fkey foreign key (business_id,professional_id)
    references public.professionals(business_id,id) ON DELETE CASCADE not valid;
alter table public.professional_patient_links validate constraint professional_patient_links_professional_id_fkey;

alter table public.push_delivery_attempts
  drop constraint push_delivery_attempts_google_review_request_id_fkey,
  add constraint push_delivery_attempts_google_review_request_id_fkey foreign key (business_id,google_review_request_id)
    references public.google_review_requests(business_id,id) ON DELETE SET NULL (google_review_request_id) deferrable initially deferred not valid;
alter table public.push_delivery_attempts validate constraint push_delivery_attempts_google_review_request_id_fkey;

alter table public.push_delivery_attempts
  drop constraint push_delivery_attempts_subscription_id_fkey,
  add constraint push_delivery_attempts_subscription_id_fkey foreign key (business_id,subscription_id)
    references public.push_subscriptions(business_id,id) ON DELETE CASCADE not valid;
alter table public.push_delivery_attempts validate constraint push_delivery_attempts_subscription_id_fkey;

alter table public.push_subscriptions
  drop constraint push_subscriptions_appointment_id_fkey,
  add constraint push_subscriptions_appointment_id_fkey foreign key (business_id,appointment_id)
    references public.appointments(business_id,id) ON DELETE CASCADE not valid;
alter table public.push_subscriptions validate constraint push_subscriptions_appointment_id_fkey;

-- Deliver only after commit, so HTTP embeds observe the validated relationships.
notify pgrst, 'reload schema';
commit;
