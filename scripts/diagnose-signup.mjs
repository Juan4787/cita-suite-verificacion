// Diagnóstico de sólo lectura del alta de una cuenta en producción: la cuenta de Auth y su confirmación,
// sus identidades, sesiones y códigos, el correo habilitado, el consultorio que se le creó y los intentos de
// registro de la ventana pedida. Una transacción `read only`; no imprime correos completos ni
// identificadores completos: las cuentas de la ventana salen con la inicial y el dominio. Los intentos de registro se guardan con el correo cifrado con una sal secreta del Worker: se
// listan todos los de la ventana, agrupados por su cifrado abreviado, para ver cuántos hubo y cuándo.
//
//   node scripts/diagnose-signup.mjs --correo <correo> [--desde <ISO>] [--hasta <ISO>] [--puerto 6543]
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { productionEnvironment, productionPsql } from './lib/production-database.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback = null) => {
	const index = process.argv.indexOf(name);
	return index === -1 ? fallback : process.argv[index + 1];
};
const email = String(option('--correo', '')).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--correo necesita un correo. No se intentó ninguna conexión.');
const since = option('--desde', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
const until = option('--hasta', new Date().toISOString());
for (const value of [since, until]) {
	if (!Number.isFinite(Date.parse(value))) throw new Error('--desde y --hasta tienen que ser fechas ISO. No se intentó ninguna conexión.');
}
const port = option('--puerto', '5432');
if (!['5432', '6543'].includes(port)) throw new Error('El puerto tiene que ser 5432 o 6543. No se intentó ninguna conexión.');

const { database } = productionEnvironment(root);
database.port = port;

const sql = String.raw`
begin read only;
select 'cuenta', count(*) from auth.users where lower(email) = lower(:'correo');
select 'cuenta_fechas', left(u.id::text, 8), 'creada=' || u.created_at, 'confirmacion_enviada=' || coalesce(u.confirmation_sent_at::text, '-'),
  'confirmada=' || coalesce(u.email_confirmed_at::text, '-'), 'ultimo_ingreso=' || coalesce(u.last_sign_in_at::text, '-'),
  'actualizada=' || u.updated_at, 'borrada=' || coalesce(u.deleted_at::text, '-'), 'bloqueada=' || coalesce(u.banned_until::text, '-'),
  'proveedor=' || coalesce(u.raw_app_meta_data->>'provider', '-')
  from auth.users u where lower(u.email) = lower(:'correo');
select 'identidades', i.provider, i.created_at, coalesce(i.last_sign_in_at::text, '-')
  from auth.identities i where i.user_id in (select id from auth.users where lower(email) = lower(:'correo')) order by i.created_at;
select 'flujos_pkce', f.authentication_method, f.created_at, coalesce(f.auth_code_issued_at::text, '-')
  from auth.flow_state f where f.user_id in (select id from auth.users where lower(email) = lower(:'correo')) order by f.created_at;
select 'codigos', t.token_type, t.created_at from auth.one_time_tokens t where t.user_id in (select id from auth.users where lower(email) = lower(:'correo')) order by t.created_at;
select 'sesiones', count(*), coalesce(min(s.created_at)::text, '-'), coalesce(max(s.created_at)::text, '-')
  from auth.sessions s where s.user_id in (select id from auth.users where lower(email) = lower(:'correo'));
select 'correo_habilitado', a.enabled, coalesce(a.onboarding_mode, '-'), a.created_at, coalesce(a.disabled_at::text, '-')
  from public.allowed_emails a where lower(a.email) = lower(:'correo');
select 'consultorio', bu.role, bu.status, bu.created_at, b.created_at,
  public.compute_business_subscription_status(s.commercial_access_enabled, s.is_permanent, s.paid_until, s.grace_until, s.restricted_until, s.archived_at),
  'fuente=' || coalesce(s.access_source, '-')
  from public.business_users bu
  join public.businesses b on b.id = bu.business_id
  left join public.business_subscriptions s on s.business_id = b.id
  where bu.user_id in (select id from auth.users where lower(email) = lower(:'correo'))
  order by bu.created_at;
select 'intentos_de_registro', e.action, left(e.subject_hash, 8), count(*), min(e.created_at), max(e.created_at)
  from public.server_rate_limit_events e
  where e.action like 'signup%' and e.created_at between :'desde'::timestamptz and :'hasta'::timestamptz
  group by 2, 3 order by min(e.created_at);
select 'intento', e.created_at, e.action, left(e.subject_hash, 8)
  from public.server_rate_limit_events e
  where e.action like 'signup%' and e.created_at between :'desde'::timestamptz and :'hasta'::timestamptz
  order by e.created_at;
-- Cuentas creadas en la ventana, con el correo enmascarado (inicial y dominio): para ver si otro intento creó otra.
select 'cuenta_de_la_ventana', left(u.email, 1) || '…@' || split_part(u.email, '@', 2),
  case when lower(u.email) = lower(:'correo') then 'este correo' else 'otro correo' end,
  'creada=' || u.created_at, 'confirmacion_enviada=' || coalesce(u.confirmation_sent_at::text, '-'),
  'confirmada=' || coalesce(u.email_confirmed_at::text, '-'), 'ultimo_ingreso=' || coalesce(u.last_sign_in_at::text, '-'),
  'actualizada=' || u.updated_at
  from auth.users u where u.created_at between :'desde'::timestamptz and :'hasta'::timestamptz order by u.created_at;
rollback;
`;

process.stdout.write(productionPsql(database, sql, {
	application: 'diagnostico-registro-lectura',
	args: ['-Atq', '-F', ' | ', '-v', `correo=${email}`, '-v', `desde=${since}`, '-v', `hasta=${until}`],
	timeout: 60_000
}));
