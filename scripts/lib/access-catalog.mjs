// The catalog that decides how a database behaves: row level security, the privileges of the API
// roles, policies, columns, constraints, indexes, triggers and function bodies. Never a row: policy
// expressions, defaults, definitions and bodies are compared by digest, since one may name a person.
export const CATALOG_QUERY = `select json_build_object(
 'rls',(select json_object_agg(c.relname,json_build_array(c.relrowsecurity,c.relforcerowsecurity) order by c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
 'tables',(select json_object_agg(c.relname||':'||r.role,(select coalesce(string_agg(p.privilege,',' order by p.privilege),'')
   from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege)
   where has_table_privilege(r.role,c.oid,p.privilege)) order by c.relname,r.role)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r(role)
  where n.nspname='public' and c.relkind in ('r','p','v','m')),
 'functions',(select json_object_agg(f.oid::regprocedure::text,json_build_array(has_function_privilege('anon',f.oid,'EXECUTE'),
   has_function_privilege('authenticated',f.oid,'EXECUTE'),has_function_privilege('service_role',f.oid,'EXECUTE'),f.prosecdef) order by f.oid::regprocedure::text)
  from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname in ('public','private') and f.prokind in ('f','p')),
 'policies',(select json_object_agg(schemaname||'.'||tablename||':'||policyname,json_build_array(cmd,roles,permissive,
   md5(coalesce(qual,'')),md5(coalesce(with_check,''))) order by schemaname,tablename,policyname)
  from pg_policies where schemaname in ('public','storage')),
 'columns',(select json_object_agg(c.relname||'.'||a.attname,json_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,
   md5(coalesce(pg_get_expr(d.adbin,d.adrelid),''))) order by c.relname,a.attname)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped),
 'constraints',(select json_object_agg(c.relname||':'||k.conname,json_build_array(k.contype,md5(pg_get_constraintdef(k.oid))) order by c.relname,k.conname)
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'indexes',(select json_object_agg(t.relname||':'||i.relname,md5(pg_get_indexdef(i.oid)) order by t.relname,i.relname)
  from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=i.relnamespace
  where n.nspname='public'),
 'triggers',(select json_object_agg(n.nspname||'.'||c.relname||':'||t.tgname,md5(pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','storage','auth')),
 'bodies',(select json_object_agg(f.oid::regprocedure::text,md5(pg_get_functiondef(f.oid)) order by f.oid::regprocedure::text)
  from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname in ('public','private') and f.prokind in ('f','p')))::text;`;

export const CATALOG_SECTIONS = ['rls', 'tables', 'functions', 'policies', 'columns', 'constraints', 'indexes', 'triggers', 'bodies'];

// Objects of other products that share the production project. No migration creates them, the
// code never uses them, and the campaign does not touch them (clave-de-servicio.md).
export const FOREIGN_TABLES = new Set(['audit_event_counters', 'business_limits', 'business_rate_limits', 'landing_crm_admins', 'landing_events',
	'landing_leads', 'landing_sessions', 'platform_rate_limits', 'rate_limit_counters']);
const FOREIGN_FUNCTIONS = /^(public\.)?(landing_[a-z_]+|check_and_increment_rate_limit|compact_audit_event_counter|window_start_for)\(/;

/** Whether a catalog entry belongs to the foreign objects, by the table or function it names. */
export function isForeign(section, key) {
	if (section === 'functions' || section === 'bodies') return FOREIGN_FUNCTIONS.test(key);
	const table = section === 'rls' ? key
		: section === 'policies' || section === 'triggers' ? key.split(':')[0].split('.').at(-1)
			: section === 'columns' ? key.split('.')[0] : key.split(':')[0];
	return FOREIGN_TABLES.has(table);
}

// Inert drift of production, kept on purpose and nothing else (publicacion-y-reversion.md):
// - functions of earlier membership, invitation and hold operations: no migration creates them, the
//   code never calls them, and after the reconciliation no API role executes them;
// - the columns of an earlier public hold and risk feature, with their checks and keys: nullable or
//   with defaults that satisfy them, and the code neither reads nor writes them;
// - indexes that change no behavior: performance only, or unique over one of those columns.
// Only objects that exist in production alone can be accepted, by their exact name.
const LEGACY_FUNCTIONS = [
		'accept_pending_business_invites_for_user(text,uuid)', 'assign_business_role_to_email_safely(uuid,text,text,uuid,boolean)',
		'business_commercial_status(uuid)', 'change_business_user_role_safely(uuid,text)',
		'disable_allowed_email_as_authenticated_master_safely(text,text)', 'disable_allowed_email_as_master_safely(text,uuid,text,text)',
		'disable_allowed_email_safely(text,text)', 'disable_business_user_safely(uuid,text)', 'disable_professional_patient_link(uuid,text)',
		'expire_public_booking_holds()', 'link_patient_to_professional_safely(uuid,uuid,uuid,text)',
		'link_professional_user_safely(uuid,uuid,uuid)', 'sync_patient_last_entry()', 'unlink_professional_user_safely(uuid,uuid)',
		'user_is_active_owner(uuid,uuid)'
];
export const ACCEPTED_PRODUCTION_DRIFT = Object.freeze({
	functions: LEGACY_FUNCTIONS,
	bodies: LEGACY_FUNCTIONS,
	columns: [
		'appointments.expired_at', 'appointments.hold_expires_at', 'appointments.public_confirmed_at', 'appointments.public_device_hash',
		'appointments.public_email_hash', 'appointments.public_identity_bundle_hash', 'appointments.public_identity_hash',
		'appointments.public_ip_hash', 'appointments.public_phone_hash', 'appointments.public_risk_flags', 'appointments.public_risk_score',
		'business_user_invites.expires_at', 'business_users.last_seen_at', 'patients.created_from_public_hold_at', 'patients.has_clinical_alert',
		'patients.internally_touched_at', 'patients.internally_touched_by', 'patients.origin', 'patients.origin_metadata',
		'patients.public_hold_archived_at', 'professionals.name_source', 'professionals.profile_status',
		'public_booking_attempts.appointment_id', 'public_booking_attempts.device_hash', 'public_booking_attempts.email_hash',
		'public_booking_attempts.idempotency_key', 'public_booking_attempts.identity_bundle_hash', 'public_booking_attempts.risk_flags',
		'public_booking_attempts.risk_score'
	],
	constraints: [
		'appointments:appointments_public_risk_score_check', 'patients:patients_internally_touched_by_fkey', 'patients:patients_origin_check',
		'professionals:professionals_name_source_check', 'professionals:professionals_profile_status_check',
		'public_booking_attempts:public_booking_attempts_appointment_fk', 'public_booking_attempts:public_booking_attempts_risk_score_check'
	],
	indexes: [
		'appointments:appointments_public_hold_expiry_idx', 'appointments:appointments_public_identity_future_idx',
		'audit_logs:audit_logs_reason_created_idx', 'business_user_invites:business_user_invites_business_role_status_idx',
		'business_user_invites:business_user_invites_professional_idx', 'business_users:business_users_business_status_role_idx',
		'business_users:business_users_user_status_idx', 'clinical_entries:clinical_entries_patient_created_at_idx',
		'public_booking_attempts:public_booking_attempts_success_idempotency_uq'
	]
});

/** Entries only in the expected catalog, only in the actual one, or different, per section; foreign ones and accepted drift apart. */
export function compareCatalogs(expected, actual) {
	const differences = {};
	for (const section of CATALOG_SECTIONS) {
		const left = expected[section] ?? {}, right = actual[section] ?? {};
		const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().filter(key => !isForeign(section, key));
		const accepted = new Set(ACCEPTED_PRODUCTION_DRIFT[section] ?? []);
		differences[section] = {
			onlyInMigrations: keys.filter(key => !(key in right)),
			onlyInProduction: keys.filter(key => !(key in left) && !accepted.has(key)),
			different: keys.filter(key => key in left && key in right && JSON.stringify(left[key]) !== JSON.stringify(right[key])),
			accepted: keys.filter(key => !(key in left) && accepted.has(key)).length
		};
	}
	return differences;
}
