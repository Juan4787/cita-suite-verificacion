// Auditoría de Mercado Pago en producción, sólo de lectura: una transacción `read only` que imprime
// conteos, fechas y comprobaciones de esquema. No imprime correos, nombres, identificadores de
// consultorios ni de pagos. Uso: node scripts/mercadopago-production-audit.mjs [--puerto 6543]
// [--consultorio <uuid>]: además, el estado comercial de ese consultorio (fechas, origen, precio propio y
// suscripciones), sin nombres ni correos. El puerto 6543 (agrupador en modo transacción) sirve cuando una
// VPN bloquea el 5432.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { productionEnvironment, productionPsql } from './lib/production-database.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const portIndex = process.argv.indexOf('--puerto');
const port = portIndex === -1 ? '5432' : process.argv[portIndex + 1];
if (!['5432', '6543'].includes(port)) throw new Error('El puerto tiene que ser 5432 o 6543. No se intentó ninguna conexión.');

const businessIndex = process.argv.indexOf('--consultorio');
const business = businessIndex === -1 ? null : process.argv[businessIndex + 1];
if (business !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(business ?? '')) {
	throw new Error('--consultorio necesita un identificador UUID. No se intentó ninguna conexión.');
}

const { database } = productionEnvironment(root);
database.port = port;

const sql = String.raw`
begin read only;
select 'consultorios_total', count(*) from public.businesses;
select 'estado_comercial_calculado', public.compute_business_subscription_status(commercial_access_enabled, is_permanent, paid_until, grace_until, restricted_until, archived_at),
  'permanente=' || is_permanent, 'habilitado=' || commercial_access_enabled, 'fuente=' || coalesce(access_source, '-'), count(*)
  from public.business_subscriptions group by 2, 3, 4, 5 order by 2, 3, 4, 5;
select 'suscripciones_mp_total', count(*) from public.mp_subscriptions;
select 'suscripciones_mp', coalesce(status, '(vacío)'), count(*), coalesce(min(created_at)::date::text, '-'), coalesce(max(created_at)::date::text, '-')
  from public.mp_subscriptions group by 2 order by 2;
select 'suscripciones_mp_sincronizacion', coalesce(status, '(vacío)'), min(last_synced_at), max(last_synced_at), max(updated_at)
  from public.mp_subscriptions group by 1, 2 order by 2;
select 'suscripciones_mp_origen', coalesce(m.status, '(vacío)'),
  'aplicacion_cita_suite=' || count(*) filter (where m.raw->>'application_id' = '6430070537499696'),
  'con_aplicacion=' || count(*) filter (where m.raw ? 'application_id'),
  'pagador_de_prueba=' || count(*) filter (where m.payer_email ilike '%@testuser.com'),
  'vendedores_distintos=' || count(distinct m.raw->>'collector_id'),
  'consultorios_distintos=' || count(distinct m.business_id),
  'monto=' || string_agg(distinct coalesce(m.transaction_amount::text, '-') || ' ' || coalesce(m.currency_id, '-'), ', ')
  from public.mp_subscriptions m group by 1, 2 order by 2;
select 'suscripciones_mp_estado_del_consultorio', coalesce(m.status, '(vacío)'),
  public.compute_business_subscription_status(b.commercial_access_enabled, b.is_permanent, b.paid_until, b.grace_until, b.restricted_until, b.archived_at),
  'permanente=' || b.is_permanent, count(*)
  from public.mp_subscriptions m left join public.business_subscriptions b using (business_id) group by 1, 2, 3, 4 order by 2, 3;
select 'avisos_mp_total', count(*), count(*) filter (where requires_attention), coalesce(min(received_at)::date::text, '-'), coalesce(max(received_at)::date::text, '-')
  from public.mp_webhook_events;
select 'avisos_mp', coalesce(topic, '(sin tópico)'), coalesce(action, '(sin acción)'), processing_status, 'firma=' || signature_valid, 'atención=' || requires_attention, count(*),
  min(received_at)::date, max(received_at)::date
  from public.mp_webhook_events group by 2, 3, 4, 5, 6 order by 2, 3, 4;
select 'acreditaciones_mp_total', count(*) from public.access_grants where source = 'mercado_pago';
select 'acreditaciones_mp', operation, count(*), max(created_at)::date from public.access_grants where source = 'mercado_pago' group by 2 order by 2;
select 'migraciones_mp_aplicadas', version from supabase_migrations.schema_migrations
  where version in ('20260704120000', '20260704130000', '20260705150000', '20261021010000', '20261021060000', '20261118010000', '20261118020000') order by version;
select 'acreditacion_mensual_en_la_funcion', 'mes_calendario=' || (position('+ interval ''1 month''' in d) > 0), 'gracia_10_dias=' || (position('interval ''10 days''' in d) > 0),
  'gracia_5_dias=' || (position('5 days' in d) > 0)
  from (select pg_get_functiondef('public.grant_business_access(uuid,text,integer,text,boolean,numeric,text,text,uuid,text,text)'::regprocedure) d) f;
select 'ruta_de_busqueda_de_la_funcion', array_to_string(proconfig, ',')
  from pg_proc where oid = 'public.grant_business_access(uuid,text,integer,text,boolean,numeric,text,text,uuid,text,text)'::regprocedure;
select 'columnas_nuevas', table_name, string_agg(column_name, ',' order by column_name) from information_schema.columns
  where table_schema = 'public' and ((table_name = 'mp_webhook_events' and column_name in ('resolved_at', 'resolved_by'))
    or (table_name = 'mp_subscriptions' and column_name like 'last_charge_%')) group by 2 order by 2;
select 'avisos_con_atencion_sin_resolver', count(*) from public.mp_webhook_events where requires_attention and resolved_at is null;
select 'acceso_provisorio_en_la_funcion', position('provisional_access' in pg_get_functiondef('public.grant_business_access(uuid,text,integer,text,boolean,numeric,text,text,uuid,text,text)'::regprocedure)) > 0;
select 'accesos_provisorios', count(*), coalesce(max(created_at)::text, '-') from public.access_grants where operation = 'provisional_access';
select 'intentos_de_suscripcion_24h', left(subject_hash, 8), count(*), min(created_at), max(created_at) from public.server_rate_limit_events
  where action = 'mp_subscription_create_by_business' and created_at > now() - interval '24 hours' group by 2 order by 4;
select 'precio_por_consultorio', 'con_precio_propio=' || count(*) filter (where mp_price_ars is not null), 'precios=' || coalesce(string_agg(distinct mp_price_ars::text, ','), '-')
  from public.business_subscriptions;
select 'rls_activa', relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('mp_subscriptions', 'mp_webhook_events') order by relname;
select 'politicas_rls', tablename, count(*) from pg_policies where schemaname = 'public' and tablename in ('mp_subscriptions', 'mp_webhook_events') group by tablename;
select 'privilegios_api', table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('mp_subscriptions', 'mp_webhook_events') and grantee in ('anon', 'authenticated') group by 2, 3 order by 2, 3;
select 'borrado_de_consultorio_con_suscripcion', confdeltype from pg_constraint where conname = 'mp_subscriptions_business_id_fkey';
select 'retencion_de_avisos', jobname, schedule, active from cron.job where jobname = 'cita-suite-webhook-events-retention';
${business ? `select 'consultorio_estado', public.compute_business_subscription_status(commercial_access_enabled, is_permanent, paid_until, grace_until, restricted_until, archived_at),
  'fuente=' || coalesce(access_source, '-'), 'permanente=' || is_permanent, 'habilitado=' || commercial_access_enabled,
  'vence=' || coalesce(paid_until::text, '-'), 'precio_propio=' || coalesce(mp_price_ars::text, '-')
  from public.business_subscriptions where business_id = '${business}';
select 'consultorio_suscripciones_mp', coalesce(status, '(vacío)'), count(*) from public.mp_subscriptions where business_id = '${business}' group by 2 order by 2;
select 'consultorio_ultimas_suscripciones', m.created_at, left(m.preapproval_id, 8), m.status, m.transaction_amount, m.currency_id,
  coalesce(left(m.payer_email, 1) || '…@' || split_part(m.payer_email, '@', 2), '-'), coalesce(m.raw->>'date_created', '-'), m.last_synced_at,
  coalesce(m.last_charge_status, '-'), coalesce(m.last_charge_detail, '-'),
  -- El formulario propone el correo de ingreso: si el pagador es ése, en Mercado Pago hay que entrar con esa cuenta.
  'pagador_es_el_correo_de_ingreso_del_dueno=' || coalesce((select bool_or(lower(u.email) = lower(m.payer_email)) from public.business_users bu
    join auth.users u on u.id = bu.user_id where bu.business_id = m.business_id and bu.role = 'owner'), false)
  from public.mp_subscriptions m where m.business_id = '${business}' order by m.created_at desc limit 4;
select 'consultorio_avisos_recientes', received_at, coalesce(topic, '-'), coalesce(action, '-'), processing_status, requires_attention, left(coalesce(processing_detail, ''), 160)
  from public.mp_webhook_events where business_id = '${business}' and received_at > now() - interval '6 hours' order by received_at;` : ''}
commit;
`;

process.stdout.write(productionPsql(database, sql, { application: 'auditoria-mercadopago-lectura', args: ['-Atq', '-F', ' | '], timeout: 60_000 }));

// --entorno-local: las suscripciones registradas en producción se consultan en Mercado Pago con el token
// del .env local (sólo GET). Si ese token las encuentra, pertenecen a su mismo entorno. Imprime sólo
// el estado de la base, el código HTTP y el estado que informa Mercado Pago: ni identificadores ni token.
if (process.argv.includes('--entorno-local')) {
	const { env } = productionEnvironment(root);
	const token = env.MP_ACCESS_TOKEN?.trim();
	if (!token) throw new Error('El .env local no tiene MP_ACCESS_TOKEN.');
	const tokenKind = token.startsWith('TEST-') ? 'TEST-' : token.startsWith('APP_USR-') ? 'APP_USR-' : 'otro';
	const rows = productionPsql(database, 'begin read only;\nselect status, preapproval_id from public.mp_subscriptions order by created_at;\ncommit;\n',
		{ application: 'auditoria-mercadopago-lectura', args: ['-Atq', '-F', '\t'], timeout: 60_000 })
		.split('\n').filter(Boolean).map((line) => line.split('\t'));
	console.log(`entorno_local | token ${tokenKind} | MP_ENVIRONMENT=${env.MP_ENVIRONMENT ?? '(sin valor)'} | suscripciones a consultar: ${rows.length}`);
	for (const [status, id] of rows) {
		const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
			headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000)
		});
		let remote = '-';
		try { remote = (await response.json())?.status ?? '-'; } catch { remote = '(sin cuerpo JSON)'; }
		console.log(`entorno_local_consulta | en la base: ${status} | HTTP ${response.status} | en Mercado Pago: ${response.ok ? remote : '-'}`);
	}
}
