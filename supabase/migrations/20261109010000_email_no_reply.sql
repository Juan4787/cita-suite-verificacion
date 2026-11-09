-- Appointment emails are not answered (Juan, 9 November, plan 12.35). They carry no Reply-To and
-- their footer says so, so a practice can send once its domain is verified: the reply mailbox stops
-- being a requirement. Nothing is deleted: the column and save_business_email_contact stay, because
-- the previous app still reads and writes them.
begin;

create or replace function private.email_sender_ready(p_business_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select exists(select 1 from private.business_email_senders s where s.business_id=p_business_id
  and s.domain_state='verified' and s.sending_domain is not null)
$$;

-- The mirror only follows changes to a sender: recompute what it stored under the previous rule.
update public.appointment_email_policies p set sender_verified=private.email_sender_ready(p.business_id)
 where p.sender_verified is distinct from private.email_sender_ready(p.business_id);

-- The same claim. The previous app requires a reply address in each item, so the sending address
-- stands in for a missing one; a reply to it is not received either. The current app sends no Reply-To.
create or replace function public.claim_appointment_email_batch(p_limit integer,p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_now timestamptz:=coalesce(p_now,clock_timestamp()); v_runtime private.appointment_management_runtime;
 d private.appointment_email_deliveries; a public.appointments; m public.appointment_management_states;
 pol public.appointment_email_policies; s private.business_email_senders; dep public.appointment_deposits; v_contact record;
 v_items jsonb:='[]'::jsonb; v_taken integer:=0; v_used integer; v_budget integer; v_lease uuid; v_token text; v_unsub text;
 v_snapshot jsonb; v_email text; v_discarded integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>20 or not isfinite(v_now) then raise exception 'EMAIL_CLAIM_INVALID'; end if;
 select * into v_runtime from private.appointment_management_runtime where singleton;
 if not v_runtime.email_producer_enabled then return jsonb_build_object('enabled',false,'items','[]'::jsonb); end if;

 perform private.plan_appointment_email_work(v_now,50);

 update private.appointment_email_deliveries set state='uncertain',failure_code='lease_expired',lease_token=null,lease_expires_at=null
 where state='sending' and lease_expires_at<=v_now;
 update private.appointment_email_deliveries set state='discarded',discard_reason='expired',next_attempt_at=null
 where state in ('pending','retry') and expires_at<=v_now;

 if v_runtime.email_paused_until is not null and v_runtime.email_paused_until>v_now then
  return jsonb_build_object('enabled',true,'paused',true,'reason',v_runtime.email_pause_reason,'items','[]'::jsonb);
 end if;

 -- The provider exposes no quota: this is our own durable count, shared by all practices.
 select count(*) into v_used from private.appointment_email_deliveries where started_at>v_now-interval '24 hours';
 v_budget:=greatest(0,v_runtime.email_daily_limit-v_runtime.email_daily_reserve-v_used);

 for d in select x.* from private.appointment_email_deliveries x
  where x.state in ('pending','retry') and coalesce(x.next_attempt_at,x.due_at)<=v_now and private.email_sender_ready(x.business_id)
  order by case when x.purpose in ('booking_receipt','reschedule_receipt','cancellation_receipt') then 0 when x.purpose='deposit_request' then 1 else 2 end,x.due_at,x.id
  limit p_limit*3 for update of x skip locked loop
  exit when v_taken>=p_limit or v_budget<=0;
  select * into a from public.appointments where business_id=d.business_id and id=d.appointment_id for no key update skip locked;
  continue when not found;
  select * into m from public.appointment_management_states where business_id=d.business_id and appointment_id=d.appointment_id;
  select * into pol from public.appointment_email_policies where business_id=d.business_id;
  select * into s from private.business_email_senders where business_id=d.business_id;
  select * into dep from public.appointment_deposits where business_id=d.business_id and appointment_id=d.appointment_id;

  if not pol.email_enabled then perform private.discard_appointment_email(d.id,'email_disabled'); v_discarded:=v_discarded+1; continue; end if;
  if d.purpose='cancellation_receipt' then
   if a.status<>'cancelled' then perform private.discard_appointment_email(d.id,'not_cancelled'); v_discarded:=v_discarded+1; continue; end if;
  else
   if a.status not in ('reserved','confirmed','reschedule_requested') then perform private.discard_appointment_email(d.id,'appointment_cancelled'); v_discarded:=v_discarded+1; continue; end if;
   if a.starts_at<=v_now then perform private.discard_appointment_email(d.id,'appointment_started'); v_discarded:=v_discarded+1; continue; end if;
   if d.schedule_revision is distinct from m.schedule_revision then perform private.discard_appointment_email(d.id,'superseded_schedule'); v_discarded:=v_discarded+1; continue; end if;
  end if;
  if d.purpose='deposit_request' and (dep.appointment_id is null or dep.status<>'pending') then
   perform private.discard_appointment_email(d.id,'deposit_not_pending'); v_discarded:=v_discarded+1; continue;
  end if;

  select * into v_contact from private.appointment_email_contact(d.business_id,d.appointment_id);
  v_email:=btrim(v_contact.email);
  if v_email is null or v_email='' then perform private.discard_appointment_email(d.id,'no_recipient'); v_discarded:=v_discarded+1; continue; end if;
  if char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   perform private.discard_appointment_email(d.id,'invalid_recipient'); v_discarded:=v_discarded+1; continue; end if;
  if exists(select 1 from private.email_suppressions x where x.business_id=d.business_id and x.email_normalized=lower(v_email) and x.lifted_at is null) then
   perform private.discard_appointment_email(d.id,'suppressed'); v_discarded:=v_discarded+1; continue; end if;
  -- A receipt accepted just before a reminder opens already carries the same appointment facts
  -- for the same address and revision. Proximity alone never suppresses anything.
  if d.purpose in ('reminder_72h','reminder_24h') and exists(select 1 from private.appointment_email_deliveries r
   where (r.business_id,r.appointment_id)=(d.business_id,d.appointment_id) and r.schedule_revision=d.schedule_revision
    and r.purpose in ('booking_receipt','reschedule_receipt') and r.state in ('accepted','delivered')
    and r.accepted_at>=d.due_at-interval '30 minutes' and r.contact_revision=v_contact.contact_revision) then
   perform private.discard_appointment_email(d.id,'covered_by_receipt'); v_discarded:=v_discarded+1; continue;
  end if;

  v_token:=null;
  if d.purpose<>'cancellation_receipt' then
   v_token:=public.issue_appointment_management_capability(d.business_id,d.appointment_id,m.generation);
  end if;
  v_unsub:=encode(extensions.gen_random_bytes(32),'hex');
  insert into private.email_unsubscribe_tokens(token_hash,business_id,email_normalized,delivery_id,expires_at)
  values(encode(extensions.digest(v_unsub,'sha256'),'hex'),d.business_id,lower(v_email),d.id,v_now+interval '365 days');
  v_snapshot:=private.appointment_management_snapshot(d.business_id,d.appointment_id,null,v_now);
  v_lease:=gen_random_uuid();
  update private.appointment_email_deliveries set state='sending',attempts=attempts+1,lease_token=v_lease,lease_expires_at=v_now+interval '10 minutes',
   next_attempt_at=null,started_at=v_now,recipient_email=v_email,patient_id=v_contact.patient_id,contact_revision=v_contact.contact_revision,management_generation=m.generation
  where id=d.id;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('delivery_id',d.id,'lease_token',v_lease,'purpose',d.purpose,'recipient',v_email,
   'token',v_token,'unsubscribe_token',v_unsub,
   'sender',jsonb_build_object('from_address',s.from_local||'@'||s.sending_domain,'reply_to',coalesce(s.reply_to_email,s.from_local||'@'||s.sending_domain)),
   'preferences',jsonb_build_object('show_cancel',pol.show_cancel,'show_reschedule',pol.show_reschedule),
   'snapshot',v_snapshot));
  v_taken:=v_taken+1; v_budget:=v_budget-1;
 end loop;

 return jsonb_build_object('enabled',true,'paused',false,'items',v_items,'discarded',v_discarded,
  'quota',jsonb_build_object('used',v_used+v_taken,'limit',v_runtime.email_daily_limit,'reserve',v_runtime.email_daily_reserve));
end $$;

commit;
