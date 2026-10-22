# Inventario de la clave de servicio

La clave de servicio (`createSupabaseAdminClient`) ignora RLS. Por eso cada uso tiene que tener un motivo que no sea «la regla no alcanza»: si una operación del consultorio necesita la clave para funcionar, la regla está en el lugar equivocado. Este inventario lista todos los usos de `apps/web/src` al 21 de octubre de 2026, con la autoridad que limita cada uno. Lo hace cumplir la auditoría transversal; cualquier uso nuevo debe sumarse acá con su categoría.

## Regla

1. Un pedido de un usuario del consultorio lee y escribe con **su propio cliente** (`createSupabaseServerClient`), bajo RLS. Eso vale también para las sesiones de ayuda: `user_business_role` da `admin` mientras el permiso está vigente, así que la ayuda opera con las reglas de un administrador.
2. La clave de servicio se usa sólo en las categorías de abajo. Siempre se filtra por el consultorio resuelto del contexto verificado, nunca por un identificador que mande el cliente sin validar.
3. Las RPC exclusivas de `service_role` que reciben un actor (`p_actor_id`, `p_created_by_user_id`) lo revalidan en la misma transacción, y la ruta pasa la identidad que verificó `hooks`, nunca una que llegue en el pedido.

## Categorías

### 1. Rutas públicas sin sesión

La credencial es un token o una clave de integración, no un usuario. La clave de servicio llama RPC que validan esa credencial y devuelven sólo lo que corresponde a ella.

| Módulo | Uso |
|---|---|
| `routes/reservar/[businessSlug]` y `lib/server/scheduling/public/public-booking-page.ts` | Integración por defecto, recuperación de reserva y creación pública con su límite. |
| `routes/turno/[token]/*` (incluye `reprogramado`, `documentos`) y `lib/server/scheduling/public/appointment-token.ts` | Turno por su token: ver, confirmar, cancelar, reprogramar, avisos y documentos. |
| `routes/embed/v1/[integrationKey]/turno/[token]` | Lo mismo, dentro de un sitio integrado. |
| `routes/api/public/contacto/[integrationKey]`, `routes/api/public/reservas/[integrationKey]/catalogo` y `lib/server/sites/public/booking-integration-request.ts` | Lecturas públicas con el límite `consume_booking_integration_read_limit` y orígenes permitidos. |
| `lib/server/patients/public/booking-information.ts` | Esquema y respuestas de la información previa de una reserva pública. |
| `lib/server/sites/public/public-practice-settings.ts` | Liberación de cargas vencidas (`claim_expired_clinical_uploads`). |
| `routes/r/[token]` | Registro del clic en una reseña (`record_google_review_click`). |
| `routes/oauth/google-calendar/callback` | Intento de OAuth consumido por su `state`. |

### 2. Webhooks firmados

| Módulo | Uso |
|---|---|
| `routes/api/mercadopago/webhook` | Verifica la firma antes de leer el cuerpo y de crear el cliente; acredita con clave idempotente. |
| `routes/api/whatsapp/webhook` | Función descartada. Falla cerrado sin el secreto y rechaza sin leer el cuerpo. |

### 3. Tareas internas

Autorizadas por el secreto de tareas (`assertInternalJobRequest`) y por el interruptor de entradas antiguas.

| Módulo | Uso |
|---|---|
| `lib/server/integrations/public/scheduled-jobs.ts` | `legacy_job_entrypoints_enabled` y las tareas del programador. |
| `routes/internal/jobs/generate-reminder-dispatches`, `process-message-dispatches` | WhatsApp, descartado y dormido: exige `WHATSAPP_AUTOMATIC_REMINDERS_ENABLED`, que está apagado, y falla cerrado si no puede leer la suscripción. |

### 4. Panel maestro

La identidad maestra sale de `locals.verifiedUser`. El panel lee y opera entre consultorios por diseño.

| Módulo | Uso |
|---|---|
| `routes/odonto/maestro` | Accesos, suscripciones, invitaciones, correos autorizados, ayuda y eventos de Mercado Pago. Toda lectura parcial falla explícitamente. |
| `routes/odonto/maestro/almacenamiento` | Presupuesto y políticas de almacenamiento clínico. |
| `routes/odonto/+layout.server.ts` | Solicitudes de ayuda activas del maestro. |

### 5. Infraestructura de la plataforma

Tablas o RPC sin acceso de `authenticated` por diseño, con la autorización hecha antes o en SQL.

| Módulo | Uso |
|---|---|
| `lib/server/platform/rate-limits.ts` | `consume_server_rate_limits`, para que un usuario no pueda borrar ni leer sus contadores. |
| `lib/server/platform/audit.ts` | Inserción en `audit_logs`, de sólo agregado. |
| `lib/server/patients/public/clinical-files.ts` | Plano de control de cargas clínicas: reservar, proteger y conciliar el presupuesto. |
| `lib/server/patients/public/patient-exports.ts` | Plano de control de exportaciones, con el actor verificado. |
| `lib/server/patients/public/patient-list.ts` | Fila de revisión de la lista de pacientes (`business_data_revisions`). |
| `lib/server/access/public/business.ts` | Si una cuenta nueva tiene una invitación pendiente, antes de aplicarle el límite de altas. |
| `lib/server/access/public/account-assistance.ts` (vía `configuracion/ayuda`) | Buscar el usuario maestro en Auth y registrarlo como soporte. El permiso lo otorga el dueño con su cliente. |

### 6. Rutas del consultorio con un actor que SQL revalida

| Módulo | Uso |
|---|---|
| `routes/odonto/agenda` (crear turno) | `create_appointment_with_patient_identity` revalida en la transacción que el creador es dueño, administración o recepción, activo y aceptado. La lectura previa del paciente se limita al consultorio resuelto, que esos roles ya leen por RLS. |
| `routes/odonto/pacientes/[id]` (editar ficha) | `update_patient_with_clinical_profile_safely` revalida rol, vínculo profesional y operación comercial, y escribe el historial visible en la misma transacción (`20261021050000`). |
| `routes/odonto/pacientes/[id]` (leer ficha) y `lib/server/patients/public/patient-links.ts` | Vínculo propio del profesional, para mostrar si lo archivó. `professional_patient_links` no tiene acceso de `authenticated`. |

### 7. Tablas sin acceso de `authenticated`, leídas para el consultorio

| Módulo | Tabla | Por qué |
|---|---|---|
| `routes/odonto/agenda` (recordatorios de mañana) y `routes/odonto/recordatorios` | `push_subscriptions`, `push_devices` | Son dispositivos de pacientes; el consultorio sólo ve si un turno tiene aviso confirmado. |
| `routes/odonto/turnos/[appointmentId]` | Push y `appointment_google_calendar_events` | Reprogramar reinicia los avisos y sincroniza el calendario. La cola es durable, así que una falla no frena el cambio. |
| `routes/odonto/configuracion/suscripcion`, `routes/odonto/pago/procesando` | `mp_subscriptions` | Estado del cobro, que sólo escribe el backend. Si no se puede leer, la página dice que no pudo comprobarlo. |

## Corregido en la auditoría (21 de octubre)

- **Seguimientos** autorizaba en TypeScript y leía y escribía con la clave de servicio. Pasó a RLS y a funciones (`20261021040000`).
- **Datos del consultorio, reserva en línea y reseñas de Google** guardaban en sesiones de ayuda con la clave de servicio, salteando `business_allows_operation`. Ahora usan el cliente del usuario.
- **El camino heredado de membresías** de `business.ts` leía suscripciones con la clave de servicio y fabricaba acceso; se quitó.
- **La revisión de pacientes** tenía un respaldo con la clave de servicio para una función que existe en todos los entornos; se quitó.

## Permisos de los roles de la API

Las migraciones son la fuente de verdad de los permisos. `20261021020000` y `20261021060000` dejan producción con exactamente lo que ellas otorgan:

- `anon` no tiene permisos sobre tablas;
- `authenticated` sólo lee y escribe filas, sin `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN`;
- `service_role` no tiene `TRUNCATE`.

Lo comprueban `api_exposure_explicit.sql`, `service_role_backend_privileges.sql` y `table_privilege_hardening.sql`. La comparación de producción, en sólo lectura, está en `.verification/api-privileges-production-20261021.json`.

**Objetos ajenos a estas migraciones.** El proyecto de producción tiene tablas que no crean estas migraciones y que el código no usa: `landing_*`, `business_limits`, `business_rate_limits`, `platform_rate_limits`, `rate_limit_counters` y `audit_event_counters`. No dan ningún permiso a `anon` ni a `authenticated` y la campaña no las toca. Las de `landing_*` registran visitas de una página de aterrizaje, con datos.
