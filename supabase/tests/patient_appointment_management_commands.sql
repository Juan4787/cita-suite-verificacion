-- E1: actual patient commands, executed only against the owned disposable DB.
-- The backend has already checked the selected slot with the shared calculator;
-- the command must hold its configuration version and enforce atomic persistence.
begin;
select extensions.plan(40);
create temporary table command_fixture(label text primary key,id uuid not null,extra jsonb);
create function pg_temp.cid(p_label text) returns uuid language sql as $$
 select id from command_fixture where label=p_label
$$;
-- Initially compiled as SQL, proving the absent command in the recorded red.
-- Execute with no patient-supplied internal identity, as service-role RPCs do.
create function pg_temp.command_call(p_token text,p_operation uuid,p_revision text,p_action text,
 p_target timestamptz,p_configuration bigint,p_terms jsonb,p_legacy boolean default false)
returns jsonb language plpgsql as $$
declare result jsonb; previous_sub text:=current_setting('request.jwt.claim.sub',true); begin
 perform set_config('request.jwt.claim.sub','',true);
 begin
  result:=public.apply_patient_appointment_management(p_token,p_legacy,p_operation,p_revision,p_action,p_target,p_configuration,p_terms);
 exception when others then
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true); raise;
 end;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 return result;
end
$$;
create function pg_temp.crevision(p_label text) returns text language sql as $$
 select private.appointment_semantic_revision(pg_temp.cid('business'),pg_temp.cid(p_label))
$$;
create function pg_temp.configuration() returns bigint language sql as $$
 select booking_availability_revision from public.businesses where id=pg_temp.cid('business')
$$;
create function pg_temp.ctarget(p_label text) returns timestamptz language sql as $$
 select starts_at+interval '6 hours' from public.appointments where id=pg_temp.cid(p_label)
$$;
create function pg_temp.cterms(p_label text,p_target timestamptz default null) returns jsonb language sql as $$
 select private.appointment_reschedule_financial_terms(pg_temp.cid('business'),a.id,coalesce(p_target,pg_temp.ctarget(p_label)),clock_timestamp())
 from public.appointments a where a.id=pg_temp.cid(p_label)
$$;
create function pg_temp.cstate(p_label text) returns jsonb language sql as $$
 select jsonb_build_object('appointment',to_jsonb(a),'management',(select to_jsonb(m) from public.appointment_management_states m where m.appointment_id=a.id),
 'projection',(select to_jsonb(d) from public.appointment_deposits d where d.appointment_id=a.id),
 'requirements',(select jsonb_agg(to_jsonb(r) order by ordinal) from public.appointment_deposit_requirements r where r.appointment_id=a.id),
 'money_events',(select jsonb_agg(to_jsonb(e) order by ordinal) from public.appointment_deposit_events e where e.appointment_id=a.id),
 'audit',(select count(*) from public.audit_logs where entity_id=a.id),
 'released',(select count(*) from public.appointment_slot_releases where appointment_id=a.id),
 'email_events',(select count(*) from private.appointment_email_events where appointment_id=a.id))
 from public.appointments a where a.id=pg_temp.cid(p_label)
$$;
do $$ declare b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) values(u,'command-'||u||'@example.test');
 insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
 values(b,'Patient command E1',b::text,'other','America/Argentina/Cordoba',true,365);
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,u,'owner','active',now());
 insert into public.professionals(id,business_id,name,is_public) values(p,b,'Command professional',true);
 insert into public.services(id,business_id,name,duration_minutes,is_public) values(s,b,'Command service',60,true);
 insert into public.professional_services(business_id,professional_id,service_id) values(b,p,s);
 insert into command_fixture(label,id) values('business',b),('owner',u),('professional',p),('service',s);
 update private.deposit_automation set enabled=true;
 update private.appointment_management_runtime set reschedule_enabled=true,email_producer_enabled=true;
 perform public.operator_set_business_email_sender(b,'command-e1.cita-suite.com.ar','verified');
 insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details)
 values(b,true,true,'fixed',40000,'Synthetic command fixture');
 perform set_config('request.jwt.claim.sub',u::text,true);
end $$;
create function pg_temp.command_case(p_label text,p_require boolean default true,p_disposition text default 'forfeit',p_status text default 'paid')
returns void language plpgsql as $$
declare a uuid; patient uuid; starts timestamptz; token text; begin
 update public.appointment_email_policies set require_deposit_on_reschedule=p_require,previous_deposit_disposition=p_disposition where business_id=pg_temp.cid('business');
 starts:=date_trunc('hour',now())+make_interval(days=>20+(select count(*)::integer from command_fixture));
 insert into public.patients(owner_id,business_id,full_name) values(pg_temp.cid('owner'),pg_temp.cid('business'),'Command synthetic '||p_label) returning id into patient;
 insert into public.appointments(business_id,patient_id,professional_id,service_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(pg_temp.cid('business'),patient,pg_temp.cid('professional'),pg_temp.cid('service'),starts,starts+interval '1 hour',starts,starts+interval '1 hour',
  'reserved','manual','Command service','Command professional',60) returning id into a;
 update public.appointment_management_states set terms_acknowledged=true,require_deposit_on_reschedule=p_require,
  previous_deposit_disposition=p_disposition,accepted_at=now(),accepted_policy_revision=1 where appointment_id=a;
 if p_status<>'pending' then
  perform public.set_appointment_deposit(pg_temp.cid('business'),a,p_status,(select revision from public.appointment_deposits where appointment_id=a),null);
 end if;
 token:=public.issue_appointment_management_capability(pg_temp.cid('business'),a,1);
 insert into command_fixture values(p_label,a,jsonb_build_object('token',token));
end $$;
create function pg_temp.move(p_label text,p_operation uuid default gen_random_uuid()) returns jsonb language sql as $$
 select pg_temp.command_call(extra->>'token',p_operation,pg_temp.crevision(p_label),'reschedule',pg_temp.ctarget(p_label),pg_temp.configuration(),pg_temp.cterms(p_label))
 from command_fixture where label=p_label
$$;

select pg_temp.command_case('default');
do $$ declare before_start timestamptz:=pg_temp.ctarget('default'); r jsonb; begin
 r:=pg_temp.move('default');
 if (r->>'changed')::boolean is distinct from true or (select starts_at from public.appointments where id=pg_temp.cid('default')) is distinct from before_start
  or (select status from public.appointments where id=pg_temp.cid('default')) is distinct from 'reserved'
  or (select status from public.appointment_deposits where appointment_id=pg_temp.cid('default')) is distinct from 'pending'
  or (select count(*) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('default') and status='paid' and allocation='forfeited' and not is_current)<>1
  or (select count(*) from public.appointment_deposit_events where appointment_id=pg_temp.cid('default') and event_type='payment_forfeited')<>1
 then raise exception 'E1_DEFAULT_MOVE_STATE_OR_MONEY'; end if;
end $$;
select extensions.pass('1. Real patient move preserves identity, forfeits only the previous informed payment and creates one pending advance');

select pg_temp.command_case('credit',true,'credit');
select pg_temp.move('credit');
select extensions.ok((select sum(amount) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('credit') and status='paid' and allocation='applied')=40000
 and (select amount from public.appointment_deposits where appointment_id=pg_temp.cid('credit'))=40000,
 '2. Credited previous payment and new unpaid obligation remain distinct');
select pg_temp.command_case('credit_none',false,'credit');
select pg_temp.move('credit_none');
select extensions.ok(not exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.cid('credit_none'))
 and (select sum(amount) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('credit_none') and status='paid' and allocation='applied')=40000
 and (select status from public.appointments where id=pg_temp.cid('credit_none'))='confirmed',
 '3. No new advance: remove only the current projection, retaining real credit/history and a valid prior confirmation');
select pg_temp.command_case('forfeit_none',false,'forfeit');
select pg_temp.move('forfeit_none');
select extensions.ok(not exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.cid('forfeit_none'))
 and (select sum(amount) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('forfeit_none') and status='paid' and allocation='forfeited')=40000,
 '4. Forfeit without a new obligation does not fabricate a waiver or another payment');

select pg_temp.command_case('pending',true,'forfeit','pending');
do $$ declare requirement uuid; begin
 select id into requirement from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('pending') and is_current;
 perform pg_temp.move('pending');
 if (select count(*) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('pending'))<>1
  or not exists(select 1 from public.appointment_deposit_requirements where id=requirement and is_current and status='pending' and allocation='none')
 then raise exception 'E1_DUPLICATED_UNPAID_OBLIGATION'; end if;
end $$;
select extensions.pass('5. Moving an unpaid appointment retains the same single obligation');

select pg_temp.command_case('noop');
do $$ declare before jsonb:=pg_temp.cstate('noop'); r jsonb; begin
 r:=pg_temp.command_call((select extra->>'token' from command_fixture where label='noop'),gen_random_uuid(),pg_temp.crevision('noop'),'reschedule',
  (select starts_at from public.appointments where id=pg_temp.cid('noop')),pg_temp.configuration(),null);
 if (r->>'changed')::boolean is distinct from false or pg_temp.cstate('noop') is distinct from before then raise exception 'E1_NOOP_WROTE_STATE'; end if;
end $$;
select extensions.pass('6. Same start is a true no-op: no revision, money, deadline, audit, release or email event change');

select pg_temp.command_case('replay');
do $$ declare op uuid:=gen_random_uuid(); rev text:=pg_temp.crevision('replay'); target timestamptz:=pg_temp.ctarget('replay');
 cfg bigint:=pg_temp.configuration(); terms jsonb:=pg_temp.cterms('replay'); token text; before jsonb; r jsonb; begin
 select extra->>'token' into token from command_fixture where label='replay';
 perform pg_temp.command_call(token,op,rev,'reschedule',target,cfg,terms); before:=pg_temp.cstate('replay');
 r:=pg_temp.command_call(token,op,rev,'reschedule',target,cfg,terms);
 if (r->>'idempotent_replay')::boolean is distinct from true or pg_temp.cstate('replay') is distinct from before then raise exception 'E1_REPLAY_DUPLICATED_EFFECT'; end if;
 insert into command_fixture values('replay_operation',op,jsonb_build_object('revision',rev,'target',target,'configuration',cfg,'terms',terms));
end $$;
select extensions.pass('7. Lost response: exact retry recovers the committed operation with no duplicate effects');
do $$ declare prior command_fixture; token text; before jsonb:=pg_temp.cstate('replay'); begin
 select * into prior from command_fixture where label='replay_operation'; select extra->>'token' into token from command_fixture where label='replay';
 begin
  perform pg_temp.command_call(token,prior.id,prior.extra->>'revision','cancel',null,null,null);
  raise exception 'E1_CHANGED_REPLAY_ACCEPTED';
 exception when others then if sqlerrm<>'APPOINTMENT_OPERATION_CONFLICT' then raise; end if; end;
 if pg_temp.cstate('replay') is distinct from before then raise exception 'E1_CHANGED_REPLAY_WROTE'; end if;
end $$;
select extensions.pass('8. Reusing an operation identity with different input fails without side effects');

select pg_temp.command_case('stale');
do $$ declare rev text:=pg_temp.crevision('stale'); before jsonb; begin
 perform pg_temp.move('stale'); before:=pg_temp.cstate('stale');
 begin perform pg_temp.command_call((select extra->>'token' from command_fixture where label='stale'),gen_random_uuid(),rev,'cancel',null,null,null);
  raise exception 'E1_STALE_CANCEL_ACCEPTED'; exception when others then if sqlerrm<>'APPOINTMENT_MANAGEMENT_CHANGED' then raise; end if; end;
 if pg_temp.cstate('stale') is distinct from before then raise exception 'E1_STALE_CANCEL_WROTE'; end if;
end $$;
select extensions.pass('9. A cancellation based on a stale time/revision cannot overwrite a move');

select pg_temp.command_case('tamper');
do $$ declare before jsonb:=pg_temp.cstate('tamper'); begin
 begin perform pg_temp.command_call((select extra->>'token' from command_fixture where label='tamper'),gen_random_uuid(),pg_temp.crevision('tamper'),'reschedule',
  pg_temp.ctarget('tamper'),pg_temp.configuration(),pg_temp.cterms('tamper')||'{"forfeit_amount":"0"}');
  raise exception 'E1_FALSE_TERMS_ACCEPTED'; exception when others then if sqlerrm<>'APPOINTMENT_FINANCIAL_TERMS_CHANGED' then raise; end if; end;
 if pg_temp.cstate('tamper') is distinct from before then raise exception 'E1_FALSE_TERMS_WROTE'; end if;
end $$;
select extensions.pass('10. Manipulated financial summary fails before changing appointment or money');
do $$ declare before jsonb:=pg_temp.cstate('tamper'); begin
 begin perform pg_temp.command_call((select extra->>'token' from command_fixture where label='tamper'),gen_random_uuid(),pg_temp.crevision('tamper'),'reschedule',
  pg_temp.ctarget('tamper'),pg_temp.configuration()-1,pg_temp.cterms('tamper'));
  raise exception 'E1_STALE_CONFIGURATION_ACCEPTED'; exception when others then if sqlerrm<>'APPOINTMENT_AVAILABILITY_CHANGED' then raise; end if; end;
 if pg_temp.cstate('tamper') is distinct from before then raise exception 'E1_STALE_CONFIGURATION_WROTE'; end if;
end $$;
select extensions.pass('11. A stale calculator configuration cannot be committed');

select pg_temp.command_case('cancel');
do $$ declare op uuid:=gen_random_uuid(); rev text:=pg_temp.crevision('cancel'); token text; before jsonb; begin
 select extra->>'token' into token from command_fixture where label='cancel';
 perform pg_temp.command_call(token,op,rev,'cancel',null,null,null); before:=pg_temp.cstate('cancel');
 perform pg_temp.command_call(token,op,rev,'cancel',null,null,null);
 if pg_temp.cstate('cancel') is distinct from before or (select status from public.appointments where id=pg_temp.cid('cancel'))<>'cancelled'
  or not exists(select 1 from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('cancel') and status='paid' and allocation='unresolved')
  or (select count(*) from private.appointment_email_events where appointment_id=pg_temp.cid('cancel') and purpose='cancellation_receipt')<>1
 then raise exception 'E1_CANCELLATION_CONTEXT_OR_MONEY'; end if;
end $$;
select extensions.pass('12. Cancellation and retry preserve money as unresolved and produce exactly one cancellation event');
do $$ begin
 begin perform pg_temp.move('cancel'); raise exception 'E1_CANCELLED_RESURRECTED';
 exception when others then if sqlerrm<>'APPOINTMENT_CANNOT_RESCHEDULE' then raise; end if; end;
end $$;
select extensions.pass('13. A cancelled appointment cannot be rescheduled or resurrected');

select pg_temp.command_case('public_off');
update public.businesses set public_booking_enabled=false where id=pg_temp.cid('business');
do $$ begin
 begin perform pg_temp.move('public_off'); raise exception 'E1_DISABLED_PUBLIC_RESCHEDULE';
 exception when others then if sqlerrm<>'APPOINTMENT_RESCHEDULE_UNAVAILABLE' then raise; end if; end;
 perform pg_temp.command_call((select extra->>'token' from command_fixture where label='public_off'),gen_random_uuid(),pg_temp.crevision('public_off'),'cancel',null,null,null);
end $$;
select extensions.is((select status from public.appointments where id=pg_temp.cid('public_off')),'cancelled','14. Public booking off blocks new slots but retains cancellation of a valid existing appointment');
update public.businesses set public_booking_enabled=true where id=pg_temp.cid('business');

select pg_temp.command_case('suspended');
update public.business_subscriptions set commercial_access_enabled=false,archived_at=now() where business_id=pg_temp.cid('business');
do $$ begin
 begin perform pg_temp.move('suspended'); raise exception 'E1_SUSPENDED_PUBLIC_RESCHEDULE';
 exception when others then if sqlerrm<>'APPOINTMENT_RESCHEDULE_UNAVAILABLE' then raise; end if; end;
 perform pg_temp.command_call((select extra->>'token' from command_fixture where label='suspended'),gen_random_uuid(),pg_temp.crevision('suspended'),'cancel',null,null,null);
end $$;
select extensions.is((select status from public.appointments where id=pg_temp.cid('suspended')),'cancelled','15. Archived/suspended clinic grants only the narrow existing-appointment cancellation exception');
update public.business_subscriptions set commercial_access_enabled=true,archived_at=null where business_id=pg_temp.cid('business');

select pg_temp.command_case('rollback');
create function pg_temp.reject_command_audit() returns trigger language plpgsql as $$
begin if new.entity_id=pg_temp.cid('rollback') and new.action='appointment.rescheduled' then raise exception 'E1_FORCED_COMMAND_AUDIT_FAILURE'; end if; return new; end $$;
create trigger e1_fail_command_audit before insert on public.audit_logs for each row execute function pg_temp.reject_command_audit();
do $$ declare before jsonb:=pg_temp.cstate('rollback'); begin
 begin perform pg_temp.move('rollback'); raise exception 'E1_FAILED_AUDIT_COMMITTED';
 exception when others then if sqlerrm<>'E1_FORCED_COMMAND_AUDIT_FAILURE' then raise; end if; end;
 if pg_temp.cstate('rollback') is distinct from before then raise exception 'E1_PARTIAL_MOVE_AFTER_FAILURE'; end if;
end $$;
select extensions.pass('16. Forced audit failure rolls back time, current advance, historical money, release and email events together');
drop trigger e1_fail_command_audit on public.audit_logs;

select pg_temp.command_case('revoked');
do $$ declare prior command_fixture; token text; begin
 perform public.revoke_appointment_management_access(pg_temp.cid('business'),pg_temp.cid('revoked'),gen_random_uuid(),pg_temp.crevision('revoked'));
 begin perform pg_temp.move('revoked'); raise exception 'E1_REVOKED_CAPABILITY_ACCEPTED';
 exception when others then if sqlerrm<>'APPOINTMENT_LINK_UNAVAILABLE' then raise; end if; end;
 select confirmation_token into token from public.appointments where id=pg_temp.cid('revoked');
 begin perform pg_temp.command_call(token,gen_random_uuid(),pg_temp.crevision('revoked'),'cancel',null,null,null,true); raise exception 'E1_REVOKED_LEGACY_ACCEPTED';
 exception when others then if sqlerrm<>'APPOINTMENT_LINK_UNAVAILABLE' then raise; end if; end;
 select * into prior from command_fixture where label='replay_operation';
 perform public.revoke_appointment_management_access(pg_temp.cid('business'),pg_temp.cid('replay'),gen_random_uuid(),pg_temp.crevision('replay'));
 select extra->>'token' into token from command_fixture where label='replay';
 begin perform pg_temp.command_call(token,prior.id,prior.extra->>'revision','reschedule',(prior.extra->>'target')::timestamptz,
  (prior.extra->>'configuration')::bigint,prior.extra->'terms'); raise exception 'E1_REVOKED_REPLAY_ACCEPTED';
 exception when others then if sqlerrm<>'APPOINTMENT_LINK_UNAVAILABLE' then raise; end if; end;
end $$;
select extensions.pass('17. Revocation covers new and legacy capabilities and precedes receipt replay');

select pg_temp.command_case('confirm_pending',true,'forfeit','pending');
do $$ begin
 begin perform pg_temp.command_call((select extra->>'token' from command_fixture where label='confirm_pending'),gen_random_uuid(),pg_temp.crevision('confirm_pending'),'confirm',null,null,null);
  raise exception 'E1_PENDING_CONFIRMED'; exception when others then if sqlerrm<>'APPOINTMENT_DEPOSIT_PENDING' then raise; end if; end;
end $$;
select extensions.pass('18. Attendance confirmation never bypasses an unpaid deposit');
select pg_temp.command_case('expired',true,'forfeit','pending');
update public.appointments set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=pg_temp.cid('expired');
do $$ begin
 begin perform pg_temp.command_call((select extra->>'token' from command_fixture where label='expired'),gen_random_uuid(),pg_temp.crevision('expired'),'cancel',null,null,null);
  raise exception 'E1_PAST_CANCELLED'; exception when others then if sqlerrm<>'APPOINTMENT_CANNOT_CANCEL' then raise; end if; end;
end $$;
select extensions.pass('19. Already-started appointments cannot acquire a new patient agenda mutation');

select pg_temp.command_case('paused');
update private.appointment_management_runtime set reschedule_enabled=false;
do $$ begin
 begin perform pg_temp.move('paused'); raise exception 'E1_PAUSED_MOVE_COMMITTED';
 exception when others then if sqlerrm<>'APPOINTMENT_RESCHEDULE_UNAVAILABLE' then raise; end if; end;
 perform pg_temp.command_call((select extra->>'token' from command_fixture where label='paused'),gen_random_uuid(),pg_temp.crevision('paused'),'cancel',null,null,null);
end $$;
select extensions.is((select status from public.appointments where id=pg_temp.cid('paused')),'cancelled','20. A technical reschedule pause does not disable legitimate cancellation');
update private.appointment_management_runtime set reschedule_enabled=true;

select pg_temp.command_case('financial_pause');
update private.deposit_automation set enabled=false;
do $$ declare before jsonb:=pg_temp.cstate('financial_pause'); begin
 begin perform pg_temp.move('financial_pause'); raise exception 'E1_FINANCIAL_PAUSE_LOST_PAYMENT';
 exception when others then if sqlerrm<>'APPOINTMENT_RESCHEDULE_UNAVAILABLE' then raise; end if; end;
 if pg_temp.cstate('financial_pause') is distinct from before then raise exception 'E1_FINANCIAL_PAUSE_WROTE'; end if;
end $$;
select extensions.pass('21. Pausing financial automation cannot forfeit or waive money through a move');
update private.deposit_automation set enabled=true;

select pg_temp.command_case('many');
do $$ declare rev bigint; begin
 perform pg_temp.move('many');
 select revision into rev from public.appointment_deposits where appointment_id=pg_temp.cid('many');
 perform public.set_appointment_deposit(pg_temp.cid('business'),pg_temp.cid('many'),'paid',rev,null);
 perform pg_temp.move('many');
 if (select count(*) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('many') and status='paid' and allocation='forfeited')<>2
  or (select count(*) from public.appointment_deposit_events where appointment_id=pg_temp.cid('many') and event_type='payment_forfeited')<>2
  or (select count(*) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('many') and is_current and status='pending')<>1
 then raise exception 'E1_REPEATED_MOVE_MONEY_HISTORY'; end if;
end $$;
select extensions.pass('22. A second paid voluntary move consumes its own current advance exactly once');
select extensions.ok((select count(*) from private.appointment_email_events where appointment_id=pg_temp.cid('many') and purpose='reschedule_receipt')=2
 and (select schedule_revision from public.appointment_management_states where appointment_id=pg_temp.cid('many'))=3,
 '23. Schedule versions track moves independently of payment/status changes');
select extensions.ok(has_function_privilege('service_role','public.apply_patient_appointment_management(text,boolean,uuid,text,text,timestamptz,bigint,jsonb,bigint)','EXECUTE')
 and not has_function_privilege('anon','public.apply_patient_appointment_management(text,boolean,uuid,text,text,timestamptz,bigint,jsonb,bigint)','EXECUTE')
 and not has_function_privilege('authenticated','public.apply_patient_appointment_management(text,boolean,uuid,text,text,timestamptz,bigint,jsonb,bigint)','EXECUTE')
 and not has_table_privilege('service_role','private.appointment_email_events','INSERT'),
 '24. Only the validated backend invokes patient commands; no direct event write or arbitrary patient actor');

select pg_temp.command_case('recreated');
do $$ declare old_revision bigint; before jsonb; begin
 select revision into old_revision from public.appointment_deposits where appointment_id=pg_temp.cid('recreated');
 update public.appointment_email_policies set require_deposit_on_reschedule=false where business_id=pg_temp.cid('business');
 perform pg_temp.move('recreated');
 if exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.cid('recreated')) then raise exception 'E1_PROJECTION_NOT_REMOVED'; end if;
 update public.appointment_email_policies set require_deposit_on_reschedule=true where business_id=pg_temp.cid('business');
 perform pg_temp.move('recreated'); before:=pg_temp.cstate('recreated');
 if (select revision from public.appointment_deposits where appointment_id=pg_temp.cid('recreated'))<=old_revision then raise exception 'E1_PROJECTION_REVISION_REUSED'; end if;
 begin perform public.set_appointment_deposit(pg_temp.cid('business'),pg_temp.cid('recreated'),'paid',old_revision,null);
  raise exception 'E1_STALE_PAYMENT_FORM_ACCEPTED'; exception when others then if sqlerrm<>'DEPOSIT_CHANGED' then raise; end if; end;
 if pg_temp.cstate('recreated') is distinct from before then raise exception 'E1_STALE_PAYMENT_FORM_WROTE'; end if;
end $$;
select extensions.pass('25. Removing/recreating the current advance cannot reuse a previous cycle revision or accept its stale payment form');

select pg_temp.command_case('uninformed');
update public.appointment_management_states set terms_acknowledged=false,require_deposit_on_reschedule=false,
 previous_deposit_disposition='credit',accepted_at=null,accepted_policy_revision=null where appointment_id=pg_temp.cid('uninformed');
select pg_temp.move('uninformed');
select extensions.ok(not exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.cid('uninformed'))
 and (select sum(amount) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('uninformed') and status='paid' and allocation='applied')=40000
 and not exists(select 1 from public.appointment_deposit_events where appointment_id=pg_temp.cid('uninformed') and event_type='payment_forfeited'),
 '26. A real move of an uninformed existing booking retains its money with no retroactive fee or loss');

select pg_temp.command_case('same_interval');
do $$ declare before jsonb:=pg_temp.cstate('same_interval'); begin
 begin perform pg_temp.command_call((select extra->>'token' from command_fixture where label='same_interval'),gen_random_uuid(),pg_temp.crevision('same_interval'),
  'staff_reschedule',pg_temp.ctarget('same_interval'),pg_temp.configuration(),pg_temp.cterms('same_interval'));
  raise exception 'E1_PATIENT_DECLARED_STAFF'; exception when others then if sqlerrm<>'APPOINTMENT_MANAGEMENT_CHANGED' then raise; end if; end;
 if pg_temp.cstate('same_interval') is distinct from before then raise exception 'E1_FALSE_STAFF_WROTE'; end if;
end $$;
select extensions.pass('27. A patient command cannot select staff origin or bypass the voluntary-change consequences');

do $$ declare old_catalog bigint; old_mutation bigint; new_mutation bigint; catalog jsonb;
 previous_role text:=current_setting('request.jwt.claim.role',true); begin
 select revision into old_catalog from private.availability_configuration_versions where business_id=pg_temp.cid('business');
 select booking_availability_revision into old_mutation from public.businesses where id=pg_temp.cid('business');
 insert into public.availability_exceptions(business_id,starts_at,ends_at,type)
 values(pg_temp.cid('business'),now()+interval '180 days',now()+interval '180 days 1 hour','extra_available');
 select booking_availability_revision into new_mutation from public.businesses where id=pg_temp.cid('business');
 perform set_config('request.jwt.claim.role','service_role',true);
 catalog:=public.get_availability_catalog(pg_temp.cid('business'),true);
 perform set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
 if new_mutation<=old_mutation or (catalog->>'availability_revision')::bigint is distinct from new_mutation
  or (catalog->>'configuration_revision')::bigint is distinct from old_catalog then raise exception 'E1_MIXED_AVAILABILITY_REVISIONS'; end if;
end $$;
select extensions.pass('28. Dated exceptions change the mutation version while preserving the established catalog/window configuration contract');

select pg_temp.command_case('event_rollback');
create function pg_temp.reject_command_event() returns trigger language plpgsql as $$
begin if new.appointment_id=pg_temp.cid('event_rollback') and new.purpose='reschedule_receipt' then raise exception 'E1_FORCED_EMAIL_EVENT_FAILURE'; end if; return new; end $$;
create trigger e1_fail_email_event before insert on private.appointment_email_events for each row execute function pg_temp.reject_command_event();
do $$ declare before jsonb:=pg_temp.cstate('event_rollback'); begin
 begin perform pg_temp.move('event_rollback'); raise exception 'E1_FAILED_EVENT_COMMITTED';
 exception when others then if sqlerrm<>'E1_FORCED_EMAIL_EVENT_FAILURE' then raise; end if; end;
 if pg_temp.cstate('event_rollback') is distinct from before then raise exception 'E1_PARTIAL_MOVE_AFTER_EVENT_FAILURE'; end if;
end $$;
select extensions.pass('29. Forced email-event failure rolls back the same appointment, financial history and released slot transaction');
drop trigger e1_fail_email_event on private.appointment_email_events;

select pg_temp.command_case('cancel_calendar');
update command_fixture f set extra=extra||jsonb_build_object('calendar_sequence',a.calendar_sequence,'calendar_token',a.confirmation_token)
 from public.appointments a where f.label='cancel_calendar' and a.id=f.id;
select pg_temp.command_call((select extra->>'token' from command_fixture where label='cancel_calendar'),gen_random_uuid(),pg_temp.crevision('cancel_calendar'),'cancel',null,null,null);
select extensions.ok((select a.calendar_sequence=(f.extra->>'calendar_sequence')::integer+1
 and a.confirmation_token=f.extra->>'calendar_token' from public.appointments a join command_fixture f on f.id=a.id where f.label='cancel_calendar'),
 '30. Cancellation advances the existing calendar sequence without rotating its calendar token/identity');

-- Real controlled identity repair, first without an existing advance. An old
-- booking event must remain tied to its original recipient generation.
update public.deposit_policies set applies_to_manual=false where business_id=pg_temp.cid('business');
select pg_temp.command_case('recipient_revision',true,'forfeit','pending');
update public.deposit_policies set applies_to_manual=true where business_id=pg_temp.cid('business');
do $$ declare patient uuid; begin
 insert into public.patients(owner_id,business_id,full_name)
 values(pg_temp.cid('owner'),pg_temp.cid('business'),'Synthetic replacement without advance') returning id into patient;
 perform public.reassign_appointment_patient_safely(pg_temp.cid('business'),pg_temp.cid('recipient_revision'),patient,pg_temp.cid('owner'),
  'Synthetic identity repair to verify recipient generation');
end $$;
select extensions.ok((select (to_jsonb(e)->>'management_generation')::bigint=1 from private.appointment_email_events e
 where e.appointment_id=pg_temp.cid('recipient_revision') and e.purpose='booking_receipt')
 and (select generation from public.appointment_management_states where appointment_id=pg_temp.cid('recipient_revision'))=2,
 '31. The existing booking event keeps its original generation after a controlled recipient identity repair');
select extensions.ok((select not terms_acknowledged and not require_deposit_on_reschedule and previous_deposit_disposition='credit'
 and accepted_at is null and accepted_policy_revision is null and terms_snapshot='{}'::jsonb
 from public.appointment_management_states where appointment_id=pg_temp.cid('recipient_revision')),
 '32. A replacement patient does not inherit another patient financial acceptance');

select pg_temp.command_case('recipient_pending',true,'forfeit','pending');
do $$ declare patient uuid; begin
 insert into public.patients(owner_id,business_id,full_name)
 values(pg_temp.cid('owner'),pg_temp.cid('business'),'Synthetic replacement with old pending advance') returning id into patient;
 perform public.reassign_appointment_patient_safely(pg_temp.cid('business'),pg_temp.cid('recipient_pending'),patient,pg_temp.cid('owner'),
  'Synthetic identity repair to verify no unpaid debt is inherited');
end $$;
select extensions.ok(not exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.cid('recipient_pending'))
 and not exists(select 1 from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('recipient_pending') and is_current)
 and exists(select 1 from public.appointment_deposit_requirements r join public.appointments a on a.id=r.appointment_id
  where r.appointment_id=pg_temp.cid('recipient_pending') and not r.is_current and r.status='pending' and r.allocation='none' and r.patient_id<>a.patient_id),
 '33. Controlled replacement closes the previous unpaid obligation without transferring debt, inventing a waiver or deleting its history');
update private.deposit_automation set enabled=false;
select extensions.is((select jsonb_build_array(t->'kind',t->'unavailable_reason',t->'base_amount') from
 (select pg_temp.cterms('recipient_pending') t) q),'["none",null,null]'::jsonb,
 '34. Old identity history is neither a new fee basis nor a financial pause imposed on the replacement patient');
update private.deposit_automation set enabled=true;
select pg_temp.command_call(public.issue_appointment_management_capability(pg_temp.cid('business'),pg_temp.cid('recipient_pending'),2),
 gen_random_uuid(),pg_temp.crevision('recipient_pending'),'cancel',null,null,null);
select extensions.ok((select (to_jsonb(e)->>'management_generation')::bigint=2 from private.appointment_email_events e
 where e.appointment_id=pg_temp.cid('recipient_pending') and e.purpose='cancellation_receipt')
 and (select (to_jsonb(e)->>'management_generation')::bigint=1 from private.appointment_email_events e
 where e.appointment_id=pg_temp.cid('recipient_pending') and e.purpose='booking_receipt'),
 '35. A new authorized action uses the replacement generation without retagging the previous booking event');

-- Transaction-start time is not authority after a wait. This deliberately
-- expires a real subscription while the transaction remains open. A separate
-- parent-lock race will also cover expiry while the command is blocked.
select pg_temp.command_case('clock_expiry',false,'credit','pending');
update public.business_subscriptions set is_permanent=false,paid_until=clock_timestamp()+interval '100 milliseconds',
 grace_until=null where business_id=pg_temp.cid('business');
insert into command_fixture values('clock_expiry_before',gen_random_uuid(),pg_temp.cstate('clock_expiry'));
select pg_sleep(0.15);
select extensions.throws_ok($q$select pg_temp.move('clock_expiry')$q$,'P0001','APPOINTMENT_RESCHEDULE_UNAVAILABLE',
 '36. Expired commercial access cannot authorize a new move using the transaction-start clock');
select extensions.is(pg_temp.cstate('clock_expiry'),(select extra from command_fixture where label='clock_expiry_before'),
 '37. Rejected expired access preserves appointment, money, events, release and audit together');
update public.business_subscriptions set is_permanent=true,paid_until=null where business_id=pg_temp.cid('business');
select pg_temp.command_case('payment_clock',true,'forfeit','pending');
create function pg_temp.cross_payment_window() returns trigger language plpgsql as $$
begin
 if new.id=pg_temp.cid('payment_clock') and new.starts_at is distinct from old.starts_at then
  perform pg_sleep_until(new.starts_at-interval '72 hours'+interval '25 milliseconds');
 end if;
 return new;
end $$;
create trigger zzz_cross_payment_window before update of starts_at on public.appointments for each row execute function pg_temp.cross_payment_window();
do $$ declare target timestamptz:=clock_timestamp()+interval '72 hours 2 seconds'; terms jsonb; token text; begin
 terms:=pg_temp.cterms('payment_clock',target);
 if (terms->>'auto_cancel')::boolean is distinct from true then raise exception 'PAYMENT_CLOCK_FIXTURE_NOT_CANCELLABLE'; end if;
 select extra->>'token' into token from command_fixture where label='payment_clock';
 perform pg_temp.command_call(token,gen_random_uuid(),pg_temp.crevision('payment_clock'),'reschedule',target,pg_temp.configuration(),terms);
 if not exists(select 1 from public.appointment_deposits where appointment_id=pg_temp.cid('payment_clock') and status='pending' and auto_cancel=false)
  or (select count(*) from public.appointment_deposit_requirements where appointment_id=pg_temp.cid('payment_clock'))<>1 then
  raise exception 'PATIENT_REENABLED_UNSAFE_PAYMENT_WINDOW'; end if;
end $$;
drop trigger zzz_cross_payment_window on public.appointments;
select extensions.pass('38. An unpaid move cannot restore auto-cancellation after a later trigger observes less than the minimum payment window');
select pg_temp.command_case('contact_replay',false,'credit','pending');
do $$ declare token text; op uuid:=gen_random_uuid(); rev text:=pg_temp.crevision('contact_replay'); before jsonb; begin
 select extra->>'token' into token from command_fixture where label='contact_replay';
 perform pg_temp.command_call(token,op,rev,'cancel',null,null,null);
 update public.patients set email='corrected-recipient@example.test'
 where id=(select patient_id from public.appointments where id=pg_temp.cid('contact_replay'));
 before:=pg_temp.cstate('contact_replay');
 begin
  perform pg_temp.command_call(token,op,rev,'cancel',null,null,null);
  raise exception 'E1_REVOKED_CONTACT_REPLAY_ALLOWED';
 exception when others then if sqlerrm is distinct from 'APPOINTMENT_LINK_UNAVAILABLE' then raise; end if; end;
 begin
  perform public.recover_patient_appointment_management(token,false,op,rev,'cancel');
  raise exception 'E1_REVOKED_CONTACT_RECOVERY_ALLOWED';
 exception when others then if sqlerrm is distinct from 'APPOINTMENT_LINK_UNAVAILABLE' then raise; end if; end;
 if pg_temp.cstate('contact_replay') is distinct from before then raise exception 'E1_REVOKED_CONTACT_REPLAY_MUTATED_STATE'; end if;
end $$;
select extensions.pass('39. Email revocation closes both execution replay and read recovery without undoing the original confirmed operation');

select pg_temp.command_case('capability_clock',false,'credit','pending');
create function pg_temp.expire_capability_during_audit() returns trigger language plpgsql as $$
declare deadline timestamptz; begin
 if new.entity_id=pg_temp.cid('capability_clock') then
  select c.expires_at into strict deadline from private.appointment_management_capabilities c
  where c.token_hash=encode(extensions.digest((select extra->>'token' from command_fixture where label='capability_clock'),'sha256'),'hex');
  perform pg_sleep_until(deadline+interval '25 milliseconds');
 end if;
 return new;
end $$;
create trigger e1_capability_expiry_audit before insert on public.audit_logs
 for each row execute function pg_temp.expire_capability_during_audit();
do $$ declare before jsonb:=pg_temp.cstate('capability_clock'); token text; op uuid:=gen_random_uuid(); begin
 select extra->>'token' into token from command_fixture where label='capability_clock';
 update private.appointment_management_capabilities set expires_at=clock_timestamp()+interval '1 second'
 where token_hash=encode(extensions.digest(token,'sha256'),'hex');
 begin
  perform pg_temp.command_call(token,op,pg_temp.crevision('capability_clock'),'cancel',null,null,null);
  raise exception 'E1_POST_EFFECT_CAPABILITY_EXPIRY_ALLOWED';
 exception when others then if sqlerrm is distinct from 'APPOINTMENT_LINK_UNAVAILABLE' then raise; end if; end;
 if pg_temp.cstate('capability_clock') is distinct from before
  or exists(select 1 from private.appointment_management_operations where operation_id=op) then
  raise exception 'E1_POST_EFFECT_CAPABILITY_EXPIRY_PARTIAL_STATE'; end if;
end $$;
drop trigger e1_capability_expiry_audit on public.audit_logs;
select extensions.pass('40. Expiry after actual command effects and audit delay rolls back agenda, money, release, events, audit and receipt');
select * from extensions.finish();
rollback;
