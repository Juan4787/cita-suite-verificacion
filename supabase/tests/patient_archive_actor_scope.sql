-- Real SQL/RPC/privileges with synthetic Auth claims. No hosted data.
begin;
select extensions.plan(28);
create temporary table archive_fixture (
	a uuid, b uuid, owner_id uuid, professional_user uuid, reception uuid,
	readonly_user uuid, support_user uuid, patient uuid, foreign_patient uuid,
	unlinked_patient uuid, own_link uuid, colleague_link uuid, membership uuid
);
grant select on archive_fixture to authenticated;
do $$
declare
	a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); o uuid := gen_random_uuid();
	pro uuid := gen_random_uuid(); rec uuid := gen_random_uuid(); ro uuid := gen_random_uuid();
	support uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
	unlinked uuid := gen_random_uuid(); professional uuid := gen_random_uuid(); colleague uuid := gen_random_uuid();
	link uuid; other_link uuid; membership uuid;
begin
	insert into auth.users(id,email) select id,'archive-'||id||'@example.test'
	from unnest(array[o,pro,rec,ro,support]) id;
	insert into public.businesses(id,name,slug,industry) values
		(a,'Synthetic archive A','archive-a-'||a,'other'),(b,'Synthetic archive B','archive-b-'||b,'other');
	update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,
		subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in(a,b);
	insert into public.business_users(business_id,user_id,role,status,accepted_at) values
		(a,o,'owner','active',now()),(a,rec,'reception','active',now()),(a,ro,'readonly','active',now());
	insert into public.business_users(business_id,user_id,role,status,accepted_at)
		values(a,pro,'professional','active',now()) returning id into membership;
	insert into public.professionals(id,business_id,name) values
		(professional,a,'Synthetic archive professional'),(colleague,a,'Synthetic archive colleague');
	insert into public.professional_users(business_id,professional_id,user_id) values(a,professional,pro);
	insert into public.patients(id,business_id,owner_id,full_name) values
		(pa,a,o,'Synthetic archive patient'),(pb,b,o,'Synthetic foreign archive patient'),
		(unlinked,a,o,'Synthetic unlinked patient');
	insert into public.professional_patient_links(business_id,professional_id,patient_id)
		values(a,professional,pa) returning id into link;
	insert into public.professional_patient_links(business_id,professional_id,patient_id)
		values(a,colleague,pa) returning id into other_link;
	insert into public.account_assistance_support_users(user_id,email) values(support,'archive-support-'||support||'@example.test');
	insert into public.account_assistance_grants(business_id,requested_by_user_id,support_user_id,expires_at)
		values(a,o,support,now()+interval '1 hour');
	insert into archive_fixture values(a,b,o,pro,rec,ro,support,pa,pb,unlinked,link,other_link,membership);
end $$;
select extensions.ok(not has_function_privilege('anon','public.set_patient_archive_state_safely(uuid,uuid,boolean)','execute'),'anonymous execution denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','AUTH_REQUIRED','missing identity denied');
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.lives_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,'professional archives own link');
reset role;
select extensions.ok((select archived_at is not null and archived_by=f.professional_user from public.professional_patient_links l,archive_fixture f where l.id=f.own_link),'personal archive records current actor');
select extensions.is((select archived_at from public.patients p,archive_fixture f where p.id=f.patient),null::timestamptz,'personal archive leaves global patient active');
select extensions.is((select archived_at from public.professional_patient_links l,archive_fixture f where l.id=f.colleague_link),null::timestamptz,'colleague remains active');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.lives_ok($$select public.set_patient_archive_state_safely(a,patient,false) from archive_fixture$$,'professional restores own archived link');
reset role;
select extensions.ok((select archived_at is null and archived_by is null from public.professional_patient_links l,archive_fixture f where l.id=f.own_link),'personal restoration clears both archive fields');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,unlinked_patient,true) from archive_fixture$$,
	'P0001','PROFESSIONAL_PATIENT_LINK_REQUIRED','unassigned patient denied');
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,foreign_patient,true) from archive_fixture$$,
	'P0001','PROFESSIONAL_PATIENT_LINK_REQUIRED','manipulated patient cannot cross clinics');
select extensions.throws_ok($$select public.set_patient_archive_state_safely(b,foreign_patient,true) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_DENIED','foreign clinic denied');
select set_config('request.jwt.claim.sub',(select reception::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_DENIED','reception denied through direct RPC');
select set_config('request.jwt.claim.sub',(select readonly_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_DENIED','readonly denied through direct RPC');
select set_config('request.jwt.claim.sub',(select owner_id::text from archive_fixture),true);
select extensions.lives_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,'owner keeps global archiving');
reset role;
select extensions.ok((select archived_at is not null from public.patients p,archive_fixture f where p.id=f.patient),'owner updates global archive');
select extensions.is((select archived_at from public.professional_patient_links l,archive_fixture f where l.id=f.own_link),null::timestamptz,'global archive does not rewrite personal link');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from archive_fixture),true);
select extensions.lives_ok($$select public.set_patient_archive_state_safely(a,patient,false) from archive_fixture$$,'owner keeps global restoration');
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,foreign_patient,true) from archive_fixture$$,
	'P0001','PATIENT_NOT_FOUND','owner cannot manipulate a foreign patient identifier');
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,null) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_INVALID','null action cannot silently restore a patient');
reset role;
update public.business_users set role='admin' where id=(select membership from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.lives_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,'current admin scope is global even with an old professional assignment');
reset role;
update public.business_users set role='professional',status='disabled',disabled_at=now() where id=(select membership from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,false) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_DENIED','revoked membership cannot use an existing professional link');
reset role;
update public.business_users set status='active',disabled_at=null where id=(select membership from archive_fixture);
update public.professional_patient_links set is_active=false where id=(select own_link from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','PROFESSIONAL_PATIENT_LINK_REQUIRED','inactive link denied');
reset role;
update public.professional_patient_links set is_active=true where id=(select own_link from archive_fixture);
delete from public.professional_users where user_id=(select professional_user from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select professional_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','PROFESSIONAL_LINK_REQUIRED','missing professional assignment denied');
select set_config('request.jwt.claim.sub',(select support_user::text from archive_fixture),true);
select extensions.lives_ok($$select public.set_patient_archive_state_safely(a,patient,false) from archive_fixture$$,'authorized support retains existing admin scope');
reset role;
update public.account_assistance_support_users set enabled=false where user_id=(select support_user from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select support_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_DENIED','disabled support denied');
reset role;
update public.account_assistance_support_users set enabled=true where user_id=(select support_user from archive_fixture);
update public.account_assistance_grants set status='revoked',revoked_at=now() where business_id=(select a from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select support_user::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','PATIENT_ARCHIVE_DENIED','revoked support grant denied');
reset role;
update public.business_subscriptions set commercial_access_enabled=false where business_id=(select a from archive_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from archive_fixture),true);
select extensions.throws_ok($$select public.set_patient_archive_state_safely(a,patient,true) from archive_fixture$$,
	'P0001','BUSINESS_ACCESS_RESTRICTED','commercial pause denies owner mutation');
reset role;
select extensions.is((select archived_at from public.patients p,archive_fixture f where p.id=f.patient),null::timestamptz,'denied operations leave the restored global archive unchanged');
select * from extensions.finish();
rollback;
