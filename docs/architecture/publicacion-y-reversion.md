# Publicación y reversión

## Último estado comprobado — lote 1 de la entrega a Natalia (P6, P7, P9, P10): 28 de noviembre de 2026, 03:53 hora argentina (06:53 UTC)

**La única vuelta atrás vigente es la de este apartado.** Las de los apartados siguientes son historia.

**Producción sirve** la instantánea `268b3b1cc93575d4d7112b2a3dbaa47fa69fdcab` en `main`, Worker `app`, versión de Cloudflare **`aaec6637-eb68-479f-b580-71e3a5068790`**. **172 migraciones:** la última es `20261128010000_entrega_natalia_lote1.sql` (`sha256` `244a60d33ba16b15a711f9ac8be267019a1f5c08bfd26d7fe12561b16fdbf8f9`). Programador `cita-suite-scheduler` reinstalado en versión **`24f7ceef-d9c1-48c4-b886-5fb7125554a1`** con los mismos cinco cron (`*/5`, `1-59/5`, `2-59/5`, `3-59/5`, `17 */3`).

**Qué trae** ([plan, bitácora y evidencia del lote 1](../plans/entrega-natalia-implementacion.md#lote-1-mejoras-chicas)):
- **P6:** horizonte configurable hasta `365` días («Hasta un año» en Reserva online, restricción `businesses_max_booking_days_ahead_check` `1..365` y validación en días calendario locales en `apply_patient_appointment_management`) preservando tramos fijos de 15 días, más leyenda única de valor estimado cuando `price_quote.adjusted = true` en pasos 4 y 5, `/turno/[token]`, `/gestion/[token]`, vista embebida y detalle interno.
- **P7:** resolución viva de `booking_integrations.video_instructions` (con respaldo en `video_instructions_snapshot`) para turnos virtuales en `private.appointment_management_snapshot` y `loadAppointmentBookingContext`; enlaces `https://` clicables seguros sin `{@html}` (escapando HTML e ignorando `http://`/`javascript:`/`data:`) en correos virtuales, página del turno y vista embebida, más aclaración de enlace vigente en los correos virtuales no cancelados.
- **P9:** validación de formato de correo en `/odonto/configuracion/negocio` (HTTP 400 si es inválido), exposición condicional de `contact.email` en `get_public_practice_contact` y `get_public_booking_catalogue` sólo cuando `public_contact_enabled = true`, y enlace `mailto:` responsivo en la cabecera de la reserva pública.
- **P10:** ayuda sobria y subrayada «¿No tenés correo?» en confirmación de reserva (14–16 px, área táctil >= 44×44 px, sin fondo verde) que despliega sugerencia de familiar y «Pedir turno por WhatsApp» con borrador armado sin perder datos (más alerta `#patient-email-missing-error` con las mismas dos salidas si se envía vacío).

Juan autorizó la publicación el 28 de noviembre a las 03:48 hora argentina («publicalo»).

**Verificación sobre la revisión exacta (`268b3b1c`):**
- local (`pnpm verify:fast` + TDD rojo/verde + *break-proof* 6/6): tipos sin errores ni advertencias, 2.295 pruebas de servidor, 384 de componentes y 197 guardias;
- GitHub SQL `46103796129` (4m10s): 172 migraciones, 125 suites SQL (`entrega_natalia_lote1.sql` 13/13), concurrencia y tipos exactos byte a byte;
- GitHub completa `46110017393` (19m33s): `verify:fast`, LibreOffice, Natalia, 172 migraciones, 125 suites SQL + concurrencia, tipos exactos, Chromium 86/86, demo 3/3 y reserva nativa de Natalia;
- paquete `46111629145` (`bundleSha256=4f289ef7e60e305fca7eadcf317dc457cbbc26e6a49cfe921730358bc1102d9a`), Chromium sobre paquete `46111733581` (86/86), Firefox sobre paquete `46114155114` (86/86) y WebKit sobre paquete `46115593778` (84/86 + 2 omitidas declaradas de WebKit en Linux);
- `verify-production-release.mjs` aprobado a las 06:53:28 UTC: 154 archivos idénticos y 78 relaciones sin exposición anónima; ambos `/_app/version.json` dicen `268b3b1cc93575d4d7112b2a3dbaa47fa69fdcab`;
- comprobación en vivo en producción sobre el consultorio de prueba **«Dra. Natalia Frutos — PRUEBA»** (`c121c69c-f90b-4248-89a9-cd6e5bed6163`, `natalia-frutos-prueba`, remitente `turnos@prueba-correo.cita-suite.com.ar`): **P6** (horizonte 365 días guardado, latencia medida en producción mediana `224 ms` en día 365 y `288 ms` en tramo cercano, leyenda estimada sólo con ajuste y día 366 con `0` horarios), **P7** (correo virtual real en bandeja principal de `citasuite@gmail.com` ID `1a220fc307e13647`, `SPF/DKIM/DMARC pass`, sin `Reply-To`, enlaces 200, Meet clicable y aviso de enlace vigente, sin dirección física; actualización instantánea del enlace Meet en `/turno/[token]` con escape XSS y sin enlazar `http://`), **P9** (rechazo 400 de correo inválido, contacto ON/OFF y `mailto:` en 320 px sin desborde), **P10** («¿No tenés correo?» y respaldo de error en 320 px/1280 px); datos temporales del Lote 1 limpiados (`0` turnos/pacientes/entregas/políticas/reglas domingo, configuración restaurada) y consultorio real de Natalia intacto (huella `75bb96cd…` y turnero `24/24`).

**Publicación:**
- ensayo (`rehearse-production-migrations.mjs`) a las 06:50 UTC: `applied: 171`, `pending: 1`, `failures: 0`;
- respaldo `~/.local/share/cita-suite/backups/production-2026-11-28T06-50-45-064Z`: 129 tablas, 4.930 filas, 171 migraciones, 26 objetos, `objectFailures: 0`;
- programador sin cron (`aa763f95-99c9-4d47-88aa-35a7042d0fdf`); migración 172 a las 06:52:55 UTC en 1,04 s; Worker `app` (`aaec6637-eb68-479f-b580-71e3a5068790`) desde el paquete exacto `46111629145`; verificación `verify-production-release.mjs`; programador con cron (`24f7ceef-d9c1-48c4-b886-5fb7125554a1`, preflight `401/410` aprobado).

**Vuelta atrás:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 7a4648b2-11ff-405f-8d5f-df4406e7d6ab --name app --message "<motivo>" --yes`, la versión del 27 de noviembre a las 20:29 (lote 0). Es compatible con la migración 172 porque ésta conserva todas las firmas, tablas y columnas existentes; la restricción `1..365` admite todos los valores previos (`1..90`) y el campo adicional `contact.email` es ignorado sin falla por `parsePublicContact` del lote 0. Después, los dos `/_app/version.json` deben decir `3bad70e896e382fc3ca98fe3d76de9f328555d4c`. La migración no se revierte. Nunca una versión anterior a E.

## Estado anterior — lote 0 de la entrega a Natalia (D1, D2, D3): 27 de noviembre de 2026, 20:29 hora argentina (23:29 UTC)

**Sirvió hasta el 28 de noviembre a las 03:53 hora argentina** la instantánea `3bad70e896e382fc3ca98fe3d76de9f328555d4c` en `main`, Worker `app`, versión de Cloudflare **`7a4648b2-11ff-405f-8d5f-df4406e7d6ab`**. **171 migraciones:** la última es `20261127010000_entrega_natalia_lote0.sql` (`sha256` `6a522572ca6bc2b05eb03ad1550728df749423c0a9dc6a1c349bc8f6d5fa1268`). Programador `cita-suite-scheduler` reinstalado en versión **`843f7426-ef36-4d28-88b2-196de8acd5a6`** con los mismos cinco cron (`*/5`, `1-59/5`, `2-59/5`, `3-59/5`, `17 */3`).

**Qué trae** ([plan, bitácora y evidencia del lote 0](../plans/entrega-natalia-implementacion.md#lote-0-defectos)):
- **D1:** los correos de turnos virtuales ya no muestran dirección, indicaciones para llegar ni enlace al mapa (ni en `private.appointment_management_snapshot` ni en `appointment-email-content.ts`), y muestran «Modalidad: virtual» junto a las indicaciones para la consulta online; los presenciales conservan dirección, indicaciones para llegar y mapa sin texto online.
- **D2:** la página de baja de correos (`/correo/baja/[token]`) distingue enlace vencido de enlace inválido mediante `public.get_email_unsubscribe_state(text)` (sin modificar `get_email_unsubscribe(text)`): ante enlace vencido muestra «Este enlace venció», el nombre del consultorio y el acceso público de WhatsApp y/o teléfono sin pedir nunca «respondé un correo»; ante enlace inválido no revela ningún dato del consultorio.
- **D3:** `list_appointment_email_reminder_coverage` comparte la misma regla SQL que `plan_appointment_email_work` y `claim_appointment_email_batch` para que `/odonto/recordatorios` y el aviso de `/odonto/agenda` reconozcan los turnos cubiertos por recordatorio automático de correo; `agenda/+page.server.ts` respeta los permisos de rol.
- Catálogo único de correos al paciente en [`docs/architecture/correos-al-paciente.md`](correos-al-paciente.md).

Juan autorizó la publicación el 27 de noviembre a las 20:24 hora argentina («publicalo y continua»).

**Verificación sobre la revisión exacta (`3bad70e8`):**
- local (`pnpm verify:fast` + TDD rojo/verde + *break-proof* 5/5): tipos sin errores ni advertencias, 2.275 pruebas de servidor y 379 de componentes;
- GitHub SQL `46067263127` (3m55s): 171 migraciones, 124 suites SQL (incluyendo `entrega_natalia_lote0.sql` 26/26 con paridad 10/10 planificador-lista), concurrencia y tipos exactos byte a byte;
- GitHub completa `46073307195` (20m25s): `verify:fast`, LibreOffice, Natalia, 171 migraciones, 124 suites SQL + concurrencia, tipos exactos, Chromium 85/85, demo y reserva nativa de Natalia;
- paquete `46075753631` (`bundleSha256=7061f2abbfcf6ea11f8ba9656c4428db59eadec7730bccd5d7c2e58a73f7e271`), Chromium sobre paquete `46075948345` (85/85), Firefox sobre paquete `46077621062` (85/85) y WebKit sobre paquete `46079782260` (83/85 + 2 omitidas declaradas de WebKit en Linux);
- `verify-production-release.mjs` aprobado a las 23:29 UTC: 152 archivos idénticos y 78 relaciones sin exposición anónima; ambos `/_app/version.json` dicen `3bad70e896e382fc3ca98fe3d76de9f328555d4c`;
- comprobación en vivo en producción sobre el consultorio de prueba **«Dra. Natalia Frutos — PRUEBA»** (`c121c69c-f90b-4248-89a9-cd6e5bed6163`, `natalia-frutos-prueba`, remitente `turnos@prueba-correo.cita-suite.com.ar`): D1 (2 correos reales en la bandeja principal de `citasuite@gmail.com` con `SPF/DKIM/DMARC pass`, sin `Reply-To`, enlaces 200 y capturas HTML inspeccionadas), D2 (baja vencida e inválida en `320px`/`390px`/`1280px`), D3 (`/odonto/recordatorios` y aviso exacto en `/odonto/agenda`), limpieza de registros temporales del Lote 0 (`0` turnos/pacientes/entregas/tokens) y comprobación de sólo lectura del consultorio real de Natalia (huella idéntica `75bb96cd…` y turnero `24/24`).

**Publicación:**
- ensayo (`rehearse-production-migrations.mjs`) a las 23:25 UTC: `applied: 170`, `pending: 1`, `failures: 0`;
- respaldo `~/.local/share/cita-suite/backups/production-2026-11-27T23-25-57-489Z`: 129 tablas, 4.948 filas, 170 migraciones, 26 objetos, `objectFailures: 0`;
- programador sin cron (`60da0618-6d93-414c-893b-71cd90d98533`); migración 171 a las 23:28:31 UTC en 1,48 s; Worker `app` (`7a4648b2-11ff-405f-8d5f-df4406e7d6ab`) desde el paquete exacto `46075753631`; verificación `verify-production-release.mjs`; programador con cron (`843f7426-ef36-4d28-88b2-196de8acd5a6`, preflight `401/410` aprobado).

**Vuelta atrás:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 3cd96265-1ed2-4769-aa65-e12bd9bfe110 --name app --message "<motivo>" --yes`, la versión del 21 de noviembre a las 22:23 (paso 1). Es compatible con la migración 171 porque ésta conserva `public.get_email_unsubscribe(text)` y todas las firmas, tablas y columnas existentes; sólo filtra `address_instructions` en turnos virtuales dentro de `private.appointment_management_snapshot` y agrega funciones nuevas (`get_email_unsubscribe_state`, `list_appointment_email_reminder_coverage` y los predicados compartidos). Después, los dos `/_app/version.json` deben decir `b6c3a8aea05c5c10b789edc544bb9f96fbc26a33`. La migración no se revierte. Nunca una versión anterior a E.

## Estado anterior — paso 1 de la entrega a Natalia (13 correcciones de auditoría): 21 de noviembre de 2026, 22:23 hora argentina (01:23 UTC del 22)

**Sirvió hasta el 27 de noviembre a las 20:29 hora argentina** la instantánea `b6c3a8aea05c5c10b789edc544bb9f96fbc26a33` en `main`, Worker `app`, versión de Cloudflare **`3cd96265-1ed2-4769-aa65-e12bd9bfe110`**. **170 migraciones:** la última es `20261121010000_entrega_natalia_paso1.sql` (`sha256` `168e8bb4aa6a7c935bee41947041595ffc09671da02245fb7eca4a64187ebfe6`). Programador `cita-suite-scheduler` reinstalado en versión **`11c3a192-373c-4f22-ada1-c45755b92a3c`** con los mismos cinco cron (`*/5`, `1-59/5`, `2-59/5`, `3-59/5`, `17 */3`).

**Qué trae** ([plan, bitácora y evidencia del paso 1](../plans/entrega-natalia-paso-1.md)):
- `AF1-001`: `allow_same_day_booking` aplicado de punta a punta en zona horaria del consultorio (disponibilidad, reserva directa/embebida y reprogramación pública), visible y editable en `/odonto/configuracion/reserva-online`; la agenda interna sigue permitiendo cargar turnos para hoy.
- `AF1-018`: en `/turno/[token]` y `/embed/v1/[key]/turno/[token]`, la confirmación «Tu turno quedó reservado» va primero dentro de `max-w-3xl`, antes de «Arancel registrado al reservar» e «Indicaciones para tu turno».
- `AF1-014`: los bloques de horario muestran y editan «Cada cuánto empieza un turno (minutos)»; los bloques nuevos arrancan con la duración de la consulta (60 min para Natalia) y los existentes no cambian al editar otros campos.
- `AF1-010`: `/api/public/contacto/[key]` y `/api/public/reservas/[key]/catalogo` exponen teléfono/dirección/WhatsApp con criterio coherente y sin 404 cuando el contacto público está apagado; `/turno/[token]` confirmado sigue mostrando dirección para asistir.
- `AF1-002`: un consultorio sin remitente verificado no exige email al reservar, no promete correos ni encola eventos/entregas muertas.
- `AF1-004`: los enlaces públicos de reserva sirven un único `<title>` SSR con el nombre del consultorio más `og:title` y `description`.
- `AF1-015`: «Preguntas al paciente» permite ver, editar y conservar el `Texto de ayuda` (`help`, hasta 300 caracteres).
- `AF1-012`: agregar o habilitar integrantes de equipo no impone «Consulta» ni «Otro servicio» si el consultorio ya tiene servicios activos, y los servicios base se pueden renombrar, ocultar, desactivar y desasignar.
- `AF1-003`: los planes pagados aparte (`access_source = 'manual'`) avisan su vencimiento 30 días calendario antes en la zona horaria del consultorio.
- `AF1-019`: cada rol ve habilitado sólo lo que puede ejecutar (`readonly` con `+ Nuevo paciente` deshabilitado; `reception`/`readonly` sin `Desarchivar`; `admin` sin edición/baja sobre `owner` ni sobre otro `admin`, ni promoción a `professional`).
- `AF1-007`: todos los avisos por umbral de días cuentan días calendario en la zona horaria correspondiente (crédito de Zoho avisa exacto 14 días calendario antes en Argentina).
- `AF1-013`: `/internal/jobs/generate-reminder-dispatches` y `/internal/jobs/process-message-dispatches` responden `410` cuando los entrypoints heredados están apagados (`503` cerrado si falla la consulta).
- `AF1-016`: `docs/architecture/permisos-y-capacidades.md` alineado con el alta real de Equipo y la visualización de `readonly`.

Juan lo autorizó el 21 de noviembre a las 19:21 hora argentina («cuando todo esté verificado, publicalo»).

**Verificación sobre la revisión exacta (`b6c3a8ae`):**
- local (`pnpm verify:fast` + *break-proof* 5/5): tipos sin errores ni advertencias, 2.257 pruebas de servidor y 374 de componentes;
- GitHub completa `44967198981` (20m29s): tipos, 2.257 server + 374 client, 170 migraciones, 123 suites SQL (incluyendo `entrega_natalia_paso1.sql`) + concurrencia, tipos exactos, Chromium 83/83, demo y base Natalia;
- paquete `44968891552`, Chromium sobre paquete `44969010280` (83/83), Firefox sobre paquete `44970155897` y WebKit sobre paquete `44970573918`;
- `verify-production-release.mjs` aprobado a las 01:23:40 UTC: 152 archivos idénticos y 78 relaciones sin exposición anónima; ambos `/_app/version.json` dicen `b6c3a8aea05c5c10b789edc544bb9f96fbc26a33`;
- verificación en vivo en producción sobre el consultorio temporal `944bcebc-721b-4498-b44f-3379a8cb4045` (archivado y limpio al cierre) y comprobación de sólo lectura de Natalia (huella idéntica `75bb96cd…` y 24/24 en su turnero).

**Publicación:**
- ensayo (`rehearse-production-migrations.mjs`) a las 01:20 UTC: `applied: 169`, `pending: 1`, `failures: 0`;
- respaldo `~/.local/share/cita-suite/backups/production-2026-11-22T01-20-38-110Z`: 129 tablas, 4.771 filas, 169 migraciones, 26 objetos, `objectFailures: 0`;
- programador sin cron (`dde08d59-92e4-45d1-9f33-31a9ba35b54e`); migración 170 a las 01:22:50 UTC en 1,78 s; Worker `app` (`3cd96265-1ed2-4769-aa65-e12bd9bfe110`) a las 01:23:18 UTC; verificación a las 01:23:40 UTC; programador con cron (`11c3a192-373c-4f22-ada1-c45755b92a3c`, preflight `401/410` aprobado).

**Vuelta atrás de entonces, ya no vigente:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback ef410385-86de-46b7-a804-80ba592a2a9c --name app --message "<motivo>" --yes`, la versión del 18 de noviembre a las 23:47. Es compatible con la migración 170 porque ésta conserva todas las firmas SQL, tablas y columnas existentes y sólo endurece validaciones internas y añade `allow_same_day_booking` en el JSON del catálogo. Después, los dos `/_app/version.json` deben decir `68cc273385c169e02e22504a7d0d00b2ed532b85`. La migración no se revierte. Nunca una versión anterior a E.

## Estado anterior — correo del pagador y rechazos de Mercado Pago explicados: 18 de noviembre de 2026, 23:47 hora argentina (02:47 UTC del 19)

**Sirvió hasta el 21 de noviembre a las 22:23 hora argentina** la instantánea `68cc273385c169e02e22504a7d0d00b2ed532b85` de `main` `f147d127`, Worker `app`, versión de Cloudflare **`ef410385-86de-46b7-a804-80ba592a2a9c`**. 169 migraciones, sin cambios de base. Programador `0f77c160-ccf0-46e9-bac7-dce4051accf1`, sin cambios: empaqueta sólo `apps/scheduler/` y `packages/shared/src/scheduled-jobs.ts`, que no cambiaron.

**Qué trae** ([plan, registro y traspaso](../plans/cobros-mercadopago-20261118.md), sección 10):
- el correo del pagador de Mercado Pago se escribe siempre, empieza vacío y se conserva tras un error;
- cada rechazo de Mercado Pago se explica en pantalla y se registra por categoría y códigos de causa, nunca con su texto;
- una solicitud pendiente dice para qué correo es, y sincronizar una cancelación ya no borra el correo guardado;
- la sección «Reprogramar» de la página del turno llega inerte hasta que la página está lista: un toque previo a la hidratación la abría y se volvía a cerrar sin pedir los horarios.

Juan lo autorizó: «publicalo».

**Verificación sobre la revisión exacta:**
- completa 44442511625: 2.243 pruebas de servidor y 368 de componentes, todas las suites SQL, Chromium con 83 de 83, las reservas de Natalia, la demostración y la medición de Natalia;
- paquete 44442536738 y Chromium sobre el paquete 44445038985, con 83 de 83;
- `verify-production-release.mjs` aprobado a las 02:47:26 UTC: 152 archivos idénticos y 78 relaciones sin exposición anónima. Los dos `/_app/version.json` dicen `68cc273385c169e02e22504a7d0d00b2ed532b85`.

Antes fallaron dos verificaciones completas en pruebas ajenas a estos cambios, y cada una se corrigió en su causa (plan, sección 10.4):
- 44409688705: la prueba de la fecha clínica interceptaba pedidos durante el arranque de la página;
- 44438357100: «Reprogramar» se podía abrir antes de hidratar.

**Publicación:** sin migración, así que no hubo ensayo ni respaldo nuevo: sirve el de las 18:54 UTC. App a las 02:47, verificación a las 02:47:26. El programador no cambió.

**Vuelta atrás:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 3d6d34af-b35b-40de-8fca-ecacbae95d72 --name app --message "<motivo>" --yes`, la versión de las 18:27, con el mismo esquema. Después, los dos `/_app/version.json` deben decir `189ea81fe9029341ab475d016500480bf2aaa5c8`. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — plan pagado aparte y correcciones del alta: 18 de noviembre de 2026, 18:27 hora argentina (21:27 UTC)

**Sirvió hasta las 23:47 del mismo día** la instantánea `189ea81fe9029341ab475d016500480bf2aaa5c8` de `main` `bf7cc2ab`, Worker `app`, versión de Cloudflare **`3d6d34af-b35b-40de-8fca-ecacbae95d72`**. 169 migraciones, sin cambios de base. Programador `0f77c160-ccf0-46e9-bac7-dce4051accf1`, sin cambios.

**Qué trae** ([plan, registro y traspaso](../plans/cobros-mercadopago-20261118.md), secciones 8.8 y 9):
- con un plan manual vigente, como el año de Natalia pagado por transferencia, la página de suscripción no ofrece Mercado Pago y suscribirse se niega;
- el botón de crear cuenta e ingresar se bloquea mientras espera, y el registro lleva a «Revisá tu correo» si el correo de esa cuenta acaba de salir;
- `/confirmar-correo` usa la política `same-origin`: «Cerrar sesión e ingresar» dejó de fallar con «Cross-site POST form submissions are forbidden»;
- una solicitud pendiente de Mercado Pago se reutiliza sólo con el mismo pagador.

Juan lo autorizó: «publicalo».

**Verificación sobre la revisión exacta:**
- completa 44395433577: 2.235 pruebas de servidor y 365 de componentes, todas las suites SQL, Chromium con 83 de 83, las reservas de Natalia, la demostración y la medición de Natalia;
- paquete 44395466254 y Chromium sobre el paquete 44398954906, con 83 de 83;
- `verify-production-release.mjs` aprobado a las 21:27:40 UTC: 152 archivos idénticos y 78 relaciones sin exposición anónima. Los dos `/_app/version.json` dicen `189ea81fe9029341ab475d016500480bf2aaa5c8`, y `/confirmar-correo` responde con `referrer-policy: same-origin`.

**Publicación:** sin migración, así que no hubo ensayo ni respaldo nuevo: sirve el de las 18:54 UTC, de dos horas y media antes. App a las 21:27, verificación a las 21:27:40. El programador no cambió.

**Vuelta atrás de entonces, ya no vigente:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback cb46bffc-35bf-439b-8115-682adfa909de --name app --message "<motivo>" --yes`, la versión de las 15:57, con el mismo esquema. Después, los dos `/_app/version.json` deben decir `b0c64f88d68b455b62ffd898d0aa7daca276a709`. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — acceso provisorio y precio fijo de Mercado Pago: 18 de noviembre de 2026, 15:57 hora argentina (18:57 UTC)

**Sirvió hasta las 18:27 del mismo día** la instantánea `b0c64f88d68b455b62ffd898d0aa7daca276a709` de `main` `8861ebbd`, Worker `app`, versión de Cloudflare **`cb46bffc-35bf-439b-8115-682adfa909de`**. 169 migraciones: la última es `20261118020000_mercadopago_provisional_access_and_price.sql`. Programador `0f77c160-ccf0-46e9-bac7-dce4051accf1`, reinstalado con los mismos cinco cron. Interruptores sin cambios.

**Qué trae** ([plan, registro y traspaso](../plans/cobros-mercadopago-20261118.md), sección 8):
- un día de acceso provisorio cuando una suscripción recién creada queda autorizada, mientras Mercado Pago procesa el primer cobro;
- el precio fijo de quien contrató: el primer cobro guarda el precio del consultorio y se usa siempre, también si cancela y vuelve;
- las pantallas de suscripción y de retorno no anuncian como pago un acceso provisorio.

Juan lo autorizó: «publicalo». Antes, ese mismo día, cargó el token productivo de Mercado Pago.

**Verificación sobre la revisión exacta:**
- SQL 44361103527 y completa 44362035616: tipos, 2.229 pruebas de servidor y 356 de componentes, todas las suites SQL y de concurrencia, comparación exacta de tipos, Chromium con 82 de 82, las reservas de Natalia, la demostración y la medición de Natalia;
- paquete 44362068113 y Chromium sobre el paquete 44365776635, con 82 de 82;
- `verify-production-release.mjs` aprobado a las 18:57:18 UTC: 152 archivos idénticos y 78 relaciones sin exposición anónima. Los dos `/_app/version.json` dicen `b0c64f88d68b455b62ffd898d0aa7daca276a709`.

**Publicación:**
- ensayo a las 18:54 UTC, sin fallas. Respecto del ensayo de las 16:57, sólo se suman la columna `business_subscriptions.mp_price_ars` con su restricción y la lista ampliada de operaciones de `access_grants`;
- respaldo `~/.local/share/cita-suite/backups/production-2026-11-18T18-54-36-619Z`: 129 tablas, 4.509 filas, 168 migraciones, 26 objetos, sin fallas;
- programador sin cron (`f63e08a0-f9f0-4410-91f9-1c45441e7aa4`); migración a las 18:56:27, en 1,1 s; app a las 18:57; verificación a las 18:57:18, y programador con cron.

**Vuelta atrás de entonces, ya no vigente:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback f592843a-3592-4f19-b2fd-bf7777428179 --name app --message "<motivo>" --yes`, la versión de las 14:02. Funciona con el esquema nuevo: no usa la operación nueva ni la columna. Mientras esté instalada no hay acceso provisorio y el precio que cobra es siempre el general. Después, los dos `/_app/version.json` deben decir `7f7ff06389c506fee574812eeb090d0fe72637d1`. La migración no se revierte: sólo agrega. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — cobros automáticos con Mercado Pago: 18 de noviembre de 2026, 14:02 hora argentina (17:02 UTC)

**Sirvió hasta las 15:57 del mismo día** la instantánea `7f7ff06389c506fee574812eeb090d0fe72637d1` de `main` `66ed73d0`, Worker `app`, versión de Cloudflare **`f592843a-3592-4f19-b2fd-bf7777428179`**. 168 migraciones: la última es `20261118010000_mercadopago_billing_fixes.sql`. Programador `3d3fefce-55d2-4fc7-beef-e6d7dd51765c`, reinstalado con los mismos cinco cron. Interruptores sin cambios.

**Qué trae** ([plan, registro y traspaso](../plans/cobros-mercadopago-20261118.md)):
- cada cobro automático suma un mes calendario, con 10 días de gracia para los reintentos de Mercado Pago;
- la búsqueda de cobros paginada de a 15: antes Mercado Pago la rechazaba siempre y sólo el aviso podía acreditar;
- el formulario pide el correo de la cuenta de Mercado Pago del pagador;
- los avisos que piden atención se resuelven desde el panel maestro, que además muestra la configuración vigente;
- el último cobro de cada suscripción, con aviso si Mercado Pago no pudo cobrar;
- `MP_ENVIRONMENT=production` y el precio de 90.000 pesos por mes como variables versionadas, en lugar de secretos ilegibles.

Juan lo autorizó: «Publicalo».

**Verificación sobre la revisión exacta:**
- completa 44336625015: tipos, pruebas unitarias (2.208 de servidor y 356 de componentes), todas las suites SQL y de concurrencia, comparación exacta de tipos, Chromium con 82 de 82, las reservas directas de Natalia, la demostración y la medición de Natalia;
- paquete 44336661039 y Chromium sobre el paquete 44340532929, con 82 de 82;
- `verify-production-release.mjs` aprobado a las 17:02:52 UTC: 152 archivos idénticos y 78 relaciones sin exposición anónima. Los dos `/_app/version.json` dicen `7f7ff06389c506fee574812eeb090d0fe72637d1`.

**Publicación:**
- ensayo a las 16:57 UTC, sin fallas. Las diferencias de catálogo con staging son las de esta migración (6 columnas, 1 índice y los cuerpos de las 2 funciones), las de la del 10 de noviembre, porque staging no tiene ninguna de las dos, y los 4 disparadores de almacenamiento de Supabase de siempre;
- respaldo `~/.local/share/cita-suite/backups/production-2026-11-18T16-58-22-402Z`: 129 tablas, 4.492 filas, 167 migraciones, 26 objetos, sin fallas;
- programador sin cron (`06539450-cc01-455e-aca2-86449ee3cf9b`); migración a las 17:01:12, en 1,3 s; borrado de los secretos `MP_ENVIRONMENT` y `MP_SUBSCRIPTION_AMOUNT_ARS` a las 17:01; app a las 17:02; verificación a las 17:02:52, y programador con cron.

**Token productivo:** Juan lo cargó el 18 de noviembre, después de esta publicación.

**Vuelta atrás de entonces, ya no vigente:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 6cf5a14c-cd2c-44e9-8389-f9d7efb38817 --name app --message "<motivo>" --yes`, la versión del enlace de reserva. Funciona con el esquema nuevo: la migración sólo agrega columnas y reemplaza dos funciones con la misma firma. Sin los dos secretos borrados, esa versión no cobra a un precio equivocado: con el token productivo su control de configuración se niega a suscribir, porque le falta el entorno, y con el de prueba vuelve al modo prueba. **No verificado:** si la vuelta atrás de Cloudflare restaura también los secretos de esa versión. Después, los dos `/_app/version.json` deben decir `a18b7364aba6a4534f4f14e830ebe35c9c1c006f`. La migración no se revierte: sólo agrega. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — enlace de reserva con el nombre del consultorio: 10 de noviembre de 2026, 22:58 hora argentina (01:58 UTC del 11)

**Sirvió hasta el 18 de noviembre** la instantánea `a18b7364aba6a4534f4f14e830ebe35c9c1c006f` de `main` `e127841a`, Worker `app`, versión de Cloudflare **`6cf5a14c-cd2c-44e9-8389-f9d7efb38817`**. 167 migraciones: la última es `20261110010000_business_booking_links.sql`. Programador `328b3dba-7ceb-4995-b993-befb86a48184`, reinstalado con los mismos cinco cron. Interruptores sin cambios.

**Qué trae** ([plan, registro y traspaso](../plans/enlace-de-reserva-20261110.md)):
- el enlace de reserva nombra al consultorio, por ejemplo `https://app.cita-suite.com.ar/reservar/consultorio-ramirez`. La dirección sale del nombre y lo sigue. El identificador y las direcciones anteriores redirigen a la actual, y ningún otro consultorio puede tomar una dirección ajena;
- la migración pasó al nombre las 19 direcciones que el alta propia había hecho con el correo del dueño. Natalia conserva `natalia-frutos`;
- «Reserva online» y su subpantalla de webs usan el dominio oficial, y la lista de señas ya no parte «hace 2 min.» entre el número y la unidad.

Juan lo autorizó: «PUBLICALO».

**Verificación sobre la revisión exacta:**
- completa 42936342156: tipos, pruebas unitarias, SQL con el par de la migración y la prueba de concurrencia, comparación de tipos, Chromium con 82 de 82, las reservas directas de Natalia, la demostración y la medición de Natalia;
- paquete 42939375661 y Chromium sobre el paquete 42939635382, con 82 de 82;
- `verify-production-release.mjs` aprobado: 152 archivos idénticos y 78 relaciones sin exposición anónima, con su recibo en `.verification/production-release-2026-11-11T01-58-50-505Z.json`;
- en producción: las 25 direcciones, iguales a las previstas, con una dirección anterior guardada para cada una de las 19 cambiadas. `/reservar/8b900b87-bcda-49b6-ad1a-6ff4e80b86dc` (Ramírez), su dirección vieja `cuentaprueba3-855fc174`, `Consultorio-Ramirez` y `consultorio-ramírez` redirigen a `/reservar/consultorio-ramirez`, también conservando la selección. Esa dirección y `natalia-frutos` abren sus páginas, y la integración de la web de Natalia responde con su tema.

**Publicación:**
- ensayo a las 01:55 UTC, sin fallas; las diferencias de catálogo son sólo las de la migración y los 4 disparadores de almacenamiento de Supabase que ya mostraba el ensayo del 9 de noviembre;
- respaldo `~/.local/share/cita-suite/backups/production-2026-11-11T01-55-43-360Z`: 128 tablas, 4.463 filas, 26 objetos, sin fallas;
- programador sin cron, migración a las 01:57:52 en 1,7 s, app a las 01:58, verificación a las 01:58:50 y programador con cron.

**Vuelta atrás de entonces, ya no vigente:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 57358b08-92ac-4218-afc8-396f3a89466e --name app --message "<motivo>" --yes`, la versión de los títulos de pestaña. Funciona con el esquema nuevo: enlaza por identificador, «Datos del consultorio» devuelve la dirección que muestra y las dos funciones de alta conservan su firma. Mientras esté instalada, las direcciones viejas que la migración reemplazó (por ejemplo `cuentaprueba3-855fc174`) no abren. Después, los dos `/_app/version.json` deben decir `aed1ddc1dd3634bb8e621c538e59d48cd46db439`. La migración no se revierte: sólo agrega. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — títulos de pestaña con el nombre del consultorio: 9 de noviembre de 2026, 21:03 hora argentina (00:03 UTC del 10)

**Sirvió** la instantánea `aed1ddc1dd3634bb8e621c538e59d48cd46db439` de `main` `3034e45a`, Worker `app`, versión de Cloudflare **`57358b08-92ac-4218-afc8-396f3a89466e`**. 166 migraciones, sin cambios de base. Programador `e79d5660-645a-4606-b481-7c143e7931f1`, sin tocar, con los mismos cinco cron. Interruptores sin cambios.

**Qué trae** ([plan 12.35](../plans/propuesta-senas-avisos-natalia.md#correo-sin-respuesta-20261109)):
- la página de información para la consulta y la del turno actualizado nombran al consultorio en la pestaña, por ejemplo «Información para tu consulta · Consultorio Ramirez», como ya lo hacían las demás páginas del paciente. Antes decían «Cita Suite»;
- si el nombre no se puede leer, la pestaña dice sólo «Información para tu consulta» o «Tu turno actualizado», sin nombrar a nadie, y la página se abre igual;
- el guion de instalación espera hasta 4 minutos a que se propague `version.json`.

Juan lo aprobó como publicación aparte: «2 si». El ícono de la pestaña y las propiedades del PDF quedan como estaban, por su decisión.

**Verificación sobre la revisión exacta:**
- paquete 42715483891, `fast` 42715511317 y SQL 42724057172;
- Chromium 42719418730 y Firefox 42721420609, con 82 de 82 cada uno;
- WebKit 42716382740: 80 aprobadas y las 2 omisiones declaradas;
- `verify-production-release.mjs` aprobado: 151 archivos idénticos y 78 relaciones sin exposición anónima, con su recibo en `.verification/production-release-2026-11-10T00-04-16-267Z.json`;
- en producción, con un turno sintético de Consultorio Ramirez reservado desde su página pública a las 00:10:48 UTC: las tres páginas de su enlace, que son el turno, la información y el turno actualizado, nombran al consultorio en la pestaña. Se comprobó en Chromium, Firefox y WebKit, a 390 y a 1440 px, y también en el HTML que entrega el servidor. El turno se canceló desde su gestión a las 00:14:57. Su comprobante de reserva fue el primer correo real de Ramírez y quedó entregado a la casilla de pruebas.

**Publicación:** sólo la app. La instalación empezó a las 00:03:15 UTC y terminó a las 00:03:42, con `version.json` ya cambiado dentro de la espera del guion. La verificación terminó a las 00:04:16. No hubo respaldo ni ensayo de base porque no hay migraciones: es el criterio de `AGENTS.md` para una entrega de interfaz.

**Vuelta atrás:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback a77821fa-45cb-43a1-8aa1-cccf204eaf09 --name app --message "<motivo>" --yes`, la versión de los correos que no se responden. Tiene el mismo esquema y no necesita pasos de datos; con ella esas dos pestañas vuelven a decir «Cita Suite». Después, los dos `/_app/version.json` deben decir `1382f5feeff962fc9895ebc0d97378fc7dbf5061`. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — correos que no se responden: 9 de noviembre de 2026, 19:48 hora argentina (22:48 UTC)

**Sirvió** la instantánea `1382f5feeff962fc9895ebc0d97378fc7dbf5061` de `main` `4dfc9f66`, Worker `app`, versión de Cloudflare **`a77821fa-45cb-43a1-8aa1-cccf204eaf09`**. 166 migraciones. Programador `e79d5660-645a-4606-b481-7c143e7931f1`, con los mismos cinco cron. Interruptores sin cambios.

**Qué trae** ([plan 12.35](../plans/propuesta-senas-avisos-natalia.md#correo-sin-respuesta-20261109)):
- los correos de turnos no reciben respuestas: no llevan `Reply-To`, y el pie dice «Este correo es automático y no recibe respuestas.»;
- la migración `20261109010000_email_no_reply.sql`: un dominio verificado alcanza para enviar, sin correo de respuesta;
- la configuración del consultorio ya no pide ese correo.

**Remitente de Consultorio Ramirez**, preparado el mismo día: `ramirez.cita-suite.com.ar` verificado en Zoho, sus dos registros en Cloudflare y `turnos@ramirez.cita-suite.com.ar` registrado en producción. Con esta versión es el único consultorio que envía.

**Verificación sobre la revisión exacta:**
- paquete 42703834473, `fast` 42703864339 y SQL 42712818034;
- Chromium 42708032413 y Firefox 42710456991, con 82 de 82 cada uno;
- WebKit 42704795637: 80 aprobadas y las 2 omisiones declaradas, ahora aceptadas por el control;
- staging migrado a 166 (42709196938) y ensayo contra producción sin fallas, con el mismo catálogo que las migraciones salvo los 4 disparadores de plataforma de `storage.buckets`;
- respaldo `production-2026-11-09T22-40-45-146Z`: 128 tablas, 4.440 filas y 26 archivos;
- `verify-production-release.mjs` aprobado: 151 archivos idénticos y 78 relaciones sin exposición anónima.

**Publicación:** programador sin cron a las 22:43:31 UTC, migración 166 a las 22:43:46 en 1,4 s, app a las 22:44:23, verificación a las 22:48:01 y programador con sus cinco cron a las 22:48:29. El guion de instalación de la app terminó con error: espera 60 s a que cambie `version.json`, y Cloudflare tardó unos 3 minutos en propagar ese archivo. El despliegue ya estaba activo y el HTML ya apuntaba al código nuevo.

**Vuelta atrás:** `wrangler rollback b8179d21-11b7-47f4-b753-96c665a1a982`, la versión del selector de modo de color. La migración 166 es compatible con ella: el reparto le sigue entregando una dirección donde espera la de respuesta, la de envío, y los correos saldrían con el pie anterior. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — selector de modo de color: 8 de noviembre de 2026, 04:50 hora argentina (07:50 UTC)

**Sirvió** la instantánea `9c8f6f7315afa61777b1d579c5f4b34e094b8299` de `main` `ec971743`, Worker `app`, versión de Cloudflare **`b8179d21-11b7-47f4-b753-96c665a1a982`**. 165 migraciones, sin cambios de base. Programador `0debec79-cadd-47e3-8bf6-47a46e6ba182`, sin tocar, con los mismos cinco cron. Interruptores sin cambios.

**Qué corrige:** el selector de modo de color marcaba el modo de la última carga completa de la página, no el que mostraba. Después de elegir un modo, al reabrir el menú de la cuenta o la hoja del teléfono, o después de navegar dentro de la app, podía marcar «Claro» sobre una página oscura. Ahora marca la clase de `<html>`, que es lo que decide los colores. Detalle en el [registro del modo claro, E10](../plans/registro-modo-claro-20261102.md).

**Verificación sobre la revisión exacta:**
- la prueba de navegador nueva falló con el código anterior (42413590220), donde debía;
- paquete 42413904658 y `fast` 42413691829;
- Chromium 42414349838 y Firefox 42414363996, con 82 de 82 cada uno;
- WebKit 42415352456: 79 aprobadas, las 2 omisiones declaradas del entorno y 1 falla ajena al selector, en la confirmación de un administrador invitado. Repetida sola sobre el mismo paquete, aprobó (42418301745);
- `verify-production-release.mjs` aprobado: 151 archivos idénticos, la política de la página admite sólo el proyecto de producción de Supabase y 78 relaciones sin exposición anónima;
- en producción, con navegador real y la cuenta de prueba, en Chromium, Firefox y WebKit: 0 desacuerdos entre el selector y la página en los 8 pasos del recorrido, y 0 en 61 observaciones del barrido de 15 anchos, de 320 a 2560 px. El detalle está en el registro, E10.

**Publicación:** sólo la app. La instalación empezó a las 07:49:35 UTC y terminó a las 07:50:02, con los dos orígenes sirviendo `9c8f6f73`. La verificación terminó a las 07:50:29, con su recibo en `.verification/production-release-2026-11-08T07-50-29-375Z.json`. No hubo respaldo ni ensayo de base porque no hay migraciones: es el criterio de `AGENTS.md` para una entrega de interfaz.

**Vuelta atrás:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback ecec47cb-93f2-49d6-be09-dfa94091810a --name app --message "<motivo>" --yes`, la versión de P1, P2 y P3. Tiene el mismo esquema y no necesita pasos de datos; con ella vuelve el defecto del selector. Después, los dos `/_app/version.json` deben decir `cabd8ae4012749907d7bdb80b90f75bc0119f2a3`. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — P1, P2 y P3: 7 de noviembre de 2026, 08:06 hora argentina (11:06 UTC)

**Sirvió** la instantánea `cabd8ae4012749907d7bdb80b90f75bc0119f2a3` de `main` `2f81c7ef`, Worker `app`, versión de Cloudflare **`ecec47cb-93f2-49d6-be09-dfa94091810a`**. 165 migraciones. Programador `0debec79-cadd-47e3-8bf6-47a46e6ba182`, con los mismos cinco cron. Interruptores sin cambios.

**Qué trae:**
- P1, cancelar desde recepción, con la migración `20261106040000_staff_cancel_before_start.sql`: el comando rechaza cancelar un turno que ya empezó.
- P2, todos los controles y superficies estilados en claro y oscuro, y la revisión de diseño y experiencia de toda la app.
- P3, el aviso interno de horarios liberados.
- Además: el cartel al guardar la información del paciente, la hora del consultorio en las pantallas internas, el aviso visible en Safari después de una acción, y volver atrás en la reserva sin mover la página bajo el dedo.

Detalle en [tareas posteriores a E](../plans/tareas-posteriores-a-e-20261103.md).

**Verificación sobre la revisión exacta:**
- paquete 42362009024, `fast` 42362019500 y SQL 42365877784;
- Chromium 42365013991 y Firefox 42363631730, con 81 de 81 cada uno;
- WebKit 42362424031, con 79 de 79 y las 2 omisiones declaradas del entorno. Ese trabajo figura fallido sólo porque `assertBrowserReport` exige cero omitidas;
- staging migrado a 165 (42366406312) antes del ensayo, porque le faltaba la correctiva `20261106030000`;
- ensayo contra producción sin fallas, con el mismo catálogo que las migraciones salvo los 4 disparadores de plataforma de `storage.buckets`;
- respaldo `production-2026-11-07T11-02-41-655Z`: 128 tablas, 4.392 filas y 26 archivos;
- `verify-production-release.mjs` aprobado: 151 archivos idénticos y 78 relaciones sin exposición anónima.

**Publicación:** programador sin cron a las 11:04:35 UTC, migración 165 a las 11:04:50 en 756 ms, app a las 11:05:27, verificación a las 11:05:49 y programador con sus cinco cron a las 11:06:30.

**Vuelta atrás:** `wrangler rollback eb1e8cf8-a8bd-4964-bfc0-66bd6c63a1f2`, la quinta versión de E. La migración 165 es compatible con ella y no se revierte: sólo agrega al comando la regla de no cancelar un turno ya empezado, y esa versión no ofrecía cancelar desde recepción. No se ensayó. Nunca una versión anterior a E.

## Estado anterior — quinta versión de E: 6 de noviembre de 2026, 18:00 hora argentina (21:00 UTC)

**Sirvió** la instantánea `93b711a13fd107ef1d4cd5ecfde064fe37c52259` de `main` `f459b95c`, Worker `app`, versión de Cloudflare **`eb1e8cf8-a8bd-4964-bfc0-66bd6c63a1f2`**. 164 migraciones, sin cambios de base ni del programador.

**Qué corrige:** el lector de eventos de Zoho reconoce `email_delivery` y `fbl_compliant`, y toma `processed_time` cuando el evento no trae hora propia.

**Verificación sobre la revisión exacta:** SQL 42289086004, paquete 42289073906, `fast` 42289995256 y navegador 42290663360 con 76 de 76. `verify-production-release.mjs` aprobado. Después de publicar, una firma válida recibió `200` y una inválida `401`.

**Vuelta atrás:** `wrangler rollback a8e1bea1-7aab-47fe-ba2d-e60176c702f3`, código de la cuarta versión con la clave vigente del webhook, sin este lector. No se ensayó: la última vuelta atrás ensayada fue con la tercera versión. Una versión más vieja vuelve con una clave anterior y rechaza los eventos firmados hasta recargarla. Nunca una versión anterior a E.

## Estado anterior — cuarta versión de E: 6 de noviembre de 2026, 16:40 hora argentina (19:40 UTC)

**Sirvió** la instantánea `10e268177681940509f4d59b86fd104c9d01b6c7` de `main` `311c2d09`, Worker `app`, versión de Cloudflare **`ea417ba0-4d1e-4e0b-a932-44de58f40bdd`**. 164 migraciones, sin cambios de base ni del programador. Con el mismo código, los cambios de clave crearon las versiones `d9580343-7468-45dc-8a2d-beee21bfcbd5` y `a8e1bea1-7aab-47fe-ba2d-e60176c702f3`.

**Qué corrige:** un POST sin firma al webhook de Zoho recibe `200` y no se guarda, porque el panel verifica la URL con una muestra sin firma y sólo acepta `200`. Una firma inválida sigue dando `401`.

**Verificación sobre la revisión exacta:** SQL 42276223292, paquete 42276199797, `fast` 42277055190 y navegador 42279637659 con 76 de 76. La primera corrida de navegador, 42277539218, dio 74 de 76: fallaron `late-deposits` y `staff-management`, las dos en el clic de la página sin JavaScript que abre un contexto aparte, con el síntoma ya registrado en E3.46 («esperó estabilidad»). Las instantáneas sólo difieren en los dos archivos del webhook y la repetición aprobó sin cambios. La causa de esa intermitencia no está resuelta. `verify-production-release.mjs` aprobado.

**Vuelta atrás:** `wrangler rollback 50c8570c-149d-43ea-8f42-f0d2e1496d1b`. Nunca una versión anterior a E.

## Estado anterior — tercera versión de E: 6 de noviembre de 2026, 09:12 hora argentina (12:12 UTC)

**Sirvió** la instantánea `fed61f5d9d81f821df180486c73aa07d04408f56` de `main` `83b8155e`, Worker `app`, versión de Cloudflare **`50c8570c-149d-43ea-8f42-f0d2e1496d1b`**. 164 migraciones.

**Qué corrige:** la migración `20261106030000_email_staff_actor.sql`, porque decidir sobre un correo en comprobación y guardar el contacto de respuesta fallaban para todo el personal. El código de la app es el de la segunda versión.

**Verificación sobre la revisión exacta:** SQL 42212825416, paquete 42213513295, `fast` 42213523343 y navegador 42213966225 con 76 de 76, ahora con los interruptores como en producción. Respaldo `production-2026-11-06T11-58-35-572Z` y ensayo sin fallas. `verify-production-release.mjs` aprobado.

**Vuelta atrás:** `wrangler rollback 5a05383b-cb99-49e4-bdaa-01aeb83c5490`. La migración es compatible y no se revierte. Nunca una versión anterior a E.

## Estado anterior — segunda versión de E: 6 de noviembre de 2026, 08:34 hora argentina (11:34 UTC)

**Sirvió** la instantánea `36d8fe9cc1d191f684f8ebd80f99eecf40eba293` de `main` `7f16f5cd`, Worker `app`, versión de Cloudflare **`5a05383b-cb99-49e4-bdaa-01aeb83c5490`**. Sin migraciones ni cambios en el programador.

**Qué corrige:** el envío de correo desde Workers, el orden de la guía de permisos, el estado después de restablecer un permiso, el mensaje contradictorio al reprogramar, el rojo de error en pasos normales, los textos de calendario y el bucle de reconexión de Google. Detalle en el [registro](../plans/ejecucion-etapa-e-20261103.md).

**Verificación sobre la revisión exacta:** paquete 42208846180, navegador 42209101549 con 76 de 76, y `fast` 42208860158. SQL 42147347019 sigue valiendo: `supabase` no cambió. `verify-production-release.mjs` aprobado con 148 archivos idénticos y 78 relaciones sin exposición anónima.

**Vuelta atrás:** `wrangler rollback 9ae1a573-7b50-4a8a-b9e7-0473042bc216`, la primera versión de E. Comparte el esquema, pero con ella ningún correo puede salir. Nunca una versión anterior a E.

## Estado anterior — primera versión de E: 6 de noviembre de 2026, 04:41 hora argentina (07:41 UTC)

**Sirvió la primera versión de E:** instantánea `dfec47747daabf0196dc5f2341eae3725088953f` de `main` `101c74dc`, Worker `app`, versión de Cloudflare **`9ae1a573-7b50-4a8a-b9e7-0473042bc216`**, en los dos orígenes. Esa versión tiene el código de `28258baa-6aaf-470a-b917-518499f55532` y sólo cambió el secreto de Google gestionado. Programador `853b9020-5738-4a66-be5e-acf1b1d6cb09`, con cinco cron.

**Verificación antes de publicar, sobre la revisión exacta:** SQL 42147347019, paquete 42179941722, navegador completo 42179970561 con 76 de 76, y `fast` 42181404563. Ensayo de la transacción contra producción sin fallas. Respaldo `production-2026-11-06T06-38-12-487Z`, de 131 migraciones.

**Publicación:** programador detenido, 32 migraciones en una transacción de 18 s (131 a 163), app instalada, `verify-production-release.mjs` aprobado con 148 archivos idénticos y 78 relaciones sin exposición anónima, programador instalado, interruptores encendidos. Recibos en `.verification/production-migrations-2026-11-06T07-39-13-360Z.json` y `.verification/production-release-2026-11-06T07-40-24-841Z.json`.

**Vuelta atrás:** no existe a una versión anterior a E. **Ninguna de las versiones de los apartados siguientes se puede usar**: sus indicaciones de `wrangler rollback` son historia. Vale la [recuperación por capas](#e--publicación-y-recuperación-compatible-5-de-noviembre): apagar el interruptor del canal, detener el programador o corregir hacia adelante. Desde la segunda versión de E se puede volver a la versión E anterior verificada.

## Estado anterior — V12b: 2 de noviembre de 2026, 12:33 hora argentina (15:33 UTC)

V12b `771fac5950c532b1123f11d4dde93eef9b42ceba`, Worker `app`, versión de Cloudflare `277d332d-1794-4367-8ef0-567ced159f1b`.

**Qué es V12b:** V12 con el fondo general del modo claro apenas más cálido: `#f6f5f3` en lugar de `#f5f6f8`.
- Fue a pedido de Juan (plan de modo claro, 12.5).
- No tiene migraciones.

**Verificación:**
- **CI sobre la revisión exacta:** `fast` 41469851263, paquete 41470383141 y navegador 41470743564, con 64 de 64 y el recorrido completo sin problemas de contraste ni de diseño.
- **`verify-production-release.mjs`:** aprobado (`verificacion-produccion-v12b.log`).
- **Primer pintado del servidor:** correcto, con la barra `#f6f5f3` (`produccion-modo-servidor-v12b.txt`).
- **Capturas contra V12:** la reserva de Natalia y el oscuro son idénticos; en el claro cambia sólo el tinte del fondo.
- **Puntero de la fuente:** `.verification/ci-source.json` en V12b, recibo `ci-source-v12b.json`.

**Vuelta atrás:**
- **A V12:** `wrangler rollback f18a80f2-fd65-4ffc-b92f-fc0101d4f85f`, que es el mismo modo claro con el fondo anterior.
- **A antes del modo claro:** `986cf666-ae09-423b-ae05-1928007dccde`, como se explica abajo. **Nunca** `59f81e89…`.
- **Datos:** ninguna de las dos necesita pasos de datos.

## Estado anterior — V12, modo claro: 2 de noviembre de 2026, 11:46 hora argentina (14:46 UTC)

**Sirvió V12** `c21a19839c814a8a5f476cb522a13273a10f89c4`, Worker `app`, versión de Cloudflare **`f18a80f2-fd65-4ffc-b92f-fc0101d4f85f`**, en `app.cita-suite.com.ar` y en `app.cita-suite.workers.dev`.

**Qué es V12:** V11f más el modo claro, que pasa a ser el predeterminado, conservando el oscuro.
- Selector Claro, Oscuro y Automático, con la preferencia por dispositivo en la cookie `cita-theme`.
- La reserva de Natalia se ve igual que antes.
- Plan: [modo claro](../plans/modo-claro-20261102.md); registro y traspaso homónimos.

**Base de datos:** sin cambios, porque V12 no tiene migraciones.

**Verificación:**
- **CI sobre la revisión exacta:**
  - `fast` 41460642336;
  - paquete 41462444575;
  - navegador completo sobre ese paquete 41462806211, con 64 de 64. Incluye el recorrido de 242 pantallas y estados en los dos modos sin problemas de contraste ni de diseño.
- **Después de publicar:**
  - `verify-production-release.mjs` aprobado: 140 archivos del cliente idénticos, HTTPS y 0 de 74 relaciones expuestas (`.verification/modo-claro-20261102/verificacion-produccion-v12.log`);
  - los dos orígenes sirven la revisión;
  - el primer pintado del servidor es correcto con cada valor de la cookie (`produccion-modo-servidor.txt`);
  - la reserva de Natalia es idéntica, píxel a píxel, a la de antes de publicar, en sus dos modos y con la app en cualquier modo (`produccion/`).
- **Puntero de la fuente:** `.verification/ci-source.json` en V12, recibo `ci-source-v12.json`. El de V11f no se había movido; el anterior, de V10b, quedó guardado.

**Vuelta atrás, si hiciera falta:**
- **Comando:** desde `apps/web`, `NODE_OPTIONS=--max-old-space-size=192 npx wrangler rollback 986cf666-ae09-423b-ae05-1928007dccde --name app --message "<motivo>" --yes`.
  - Esa versión es V11f con el cliente nuevo de Google Calendar, instalado el 2 de noviembre a las 03:03 UTC.
  - **Nunca volver a `59f81e89-412f-49be-b65b-3a2378ddf71e`:** es V11f con el cliente anterior de Calendar.
- **Comprobación:** los dos `/_app/version.json` deben decir `72d59ab00db67a8502ca560c762c61e6cfac1923`. Después correr `node scripts/verify-production-release.mjs .verification/ayuda-duraciones-20261101/release-candidate-v11f/cloudflare-staging-72d59ab00db67a8502ca560c762c61e6cfac1923`.
- **Sin pasos de datos:** V11f ignora la cookie `cita-theme`, y no hay migraciones.

## Estado anterior — V11f, 2 de noviembre de 2026, 02:12 UTC

Revisión `72d59ab00db67a8502ca560c762c61e6cfac1923`, de la campaña del 1 de noviembre (evidencia en `.verification/ayuda-duraciones-20261101/`; traspaso [de señas y avisos](../plans/traspaso-senas-avisos-natalia.md)).
- **Base:** la migración `20261101030000` se aplicó a las 02:10 UTC; producción quedó con 131 migraciones.
- **Publicación:** a las 02:12 UTC, versión `59f81e89-412f-49be-b65b-3a2378ddf71e`.
- **Su propia vuelta atrás** era `wrangler rollback 1d2b4acd-7dd8-4cb7-81e3-a205bafe9f8d`, a V10b, sin tocar la base.
- **Cliente nuevo de Google Calendar:** se instaló a las 03:03 UTC y produjo la versión `986cf666-ae09-423b-ae05-1928007dccde`, con el mismo código.

## Estado anterior — V10b, 1 de noviembre de 2026, 07:31 hora argentina (10:31 UTC)

**Sirvió V10b** `68f31741f6ff7f2253c036800b1369f1eda16510`, Worker `app`, versión de Cloudflare **`1d2b4acd-7dd8-4cb7-81e3-a205bafe9f8d`**, en `app.cita-suite.com.ar` y en `app.cita-suite.workers.dev`. V10b es V9 más:
- la vista aparte de consultorios archivados en el panel maestro;
- el rubro «medicina»;
- preguntas de opciones de hasta 40;
- la web de Natalia reservando en su consultorio real por el dominio oficial;
- dos correcciones de pruebas.

Detalle en el plan de señas y avisos, 12.16, y en su registro, sección «1 de noviembre».

- **Base:** 130 migraciones. Las dos nuevas (`20261101010000` y `20261101020000`) se aplicaron a las 02:40:51 UTC con la copia previa `~/.local/share/cita-suite/backups/production-2026-11-01T02-39-07-585Z`.
- **Verificación:**
  - `sql` 41265804819, `fast` 41265937843 y paquete 41266013495 (manifiesto `e3c6e647f33fd8bd19a78964444a1e10fabea365a3c433b1a2c893b140a1f574`);
  - navegador sobre el paquete exacto 41267444767, 7 de 7;
  - después de publicar, `verify-production-release.mjs`: 139 archivos del cliente idénticos, HTTPS y 0 de 74 relaciones expuestas;
  - la pantalla de confirmación de correo y el turnero de Natalia como paciente.
- **Web de Natalia:** commit `8ac6dfee28121e6f5abc7bf4e9d5608e68ab0d0a` en `juan-altamira/web-natalia`, despliegue de Vercel `dpl_2Xtgk4uEqhRumxb4t3Fc4dqdR6sU`. Sus 36 archivos servidos son idénticos al paquete.
- **Puntero de la fuente:** `.verification/ci-source.json` en V10b.

**Recuperación de la app, en este orden** (la base no se toca: las migraciones de V10 aceptan los datos de V9 y los de V10):

1. **Antes de volver a V9, dejar los datos legibles para V9.** V9 rechaza el rubro «medicina» y las preguntas de más de 20 opciones, y el consultorio de Natalia tiene las dos cosas.
   - Ejecutar `node .verification/natalia-configuracion-20261101/revertir-para-v9.mjs ensayo` y, si aprueba, `aplicar`; la aplicación exige un ensayo de la última hora.
   - Esto pasa todo consultorio de «medicina» a «otro» y toda pregunta de opciones de más de 20 a texto libre, con la misma identidad y el mismo destino en la ficha.
   - Su ensayo se comprobó el 1 de noviembre a las 10:16 UTC.
2. **Volver a V9:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 2ef53723-0a46-4879-bf6e-4af5ed5320c9 --name app --message "<motivo>" --yes`. Después comprobar que los dos `/_app/version.json` digan `a3c707f368736da90d2adf5850d291460f657af0` y correr `node scripts/verify-production-release.mjs .verification/confirmacion-email-v9-20261031/release-candidate-v9`.
3. **Si V9 también fallara:** la recuperación del apartado siguiente (V8 y después el paquete compatible `c195b1e`), siempre con el paso 1 hecho.

**Recuperación de la web de Natalia** (independiente de la app):
- **Inmediata:** en Vercel, volver a promover el despliegue anterior `dpl_6zBnr7E2FVg11SQ5mHiHv8rdPPKk`. Ojo: ese sitio reserva en el consultorio de prueba y por workers.dev.
- **Duradera:** un commit nuevo en `main` (nunca reescribir historia) cuyo `vercel.json` sirva `rollback/`, que es exactamente el sitio anterior.

## Estado anterior — V9, 31 de octubre de 2026, 18:58 hora argentina (21:58 UTC)

**Producción servía V9** `a3c707f368736da90d2adf5850d291460f657af0`, Worker `app`, versión de Cloudflare `2ef53723-0a46-4879-bf6e-4af5ed5320c9`, en `app.cita-suite.com.ar` y en `app.cita-suite.workers.dev`. V9 es V8 más el registro de las fallas al comprobar el enlace de confirmación (sin migraciones; 128 aplicadas). Verificación: nivel `fast` 41244933261, paquete 41244945074 (manifiesto `3a604dc3b3ea180a00fcd781e5098322428e21926668f7cf2fc7c47268e1f1b6`), navegador sobre el programa exacto 41245436407 (12 de 12, workerd, mismo SHA-256 del programa) y, después de publicar, `verify-production-release.mjs` (139 archivos del cliente idénticos, política sólo del proyecto productivo, HTTPS en los dos orígenes y 74 relaciones sin exposición anónima) más `comprobar-publicacion.mjs` (revisión, cabeceras de `/confirmar-correo`, respuesta neutra a un enlace inválido e ingreso). Evidencia: `.verification/confirmacion-email-v9-20261031/` y `docs/plans/registro-confirmacion-email-20261030.md`.

**Recuperación que valía con V9 publicada (desde V10b, rige la del apartado de arriba, que exige primero el paso de datos):**

1. Volver a V8, que ya está en el historial del Worker y conserva `/confirmar-correo`: `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback a1844665-447e-40bb-b9e5-ce7c03ed29d7 --name app --message "<motivo>" --yes`. Después comprobar `https://app.cita-suite.com.ar/_app/version.json` y el de workers.dev (deben decir `408ca04d9e6750e4657dc087264644665a63fb37`) y correr `node scripts/verify-production-release.mjs .verification/confirmacion-email-20261030/release-candidate-v8`.
2. Sólo si V8 también falla: instalar el paquete compatible `c195b1e` con `NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs app .verification/confirmacion-email-20261030/release-recovery-v7` (manifiesto `961ffbdb1c3e61e5cbb38aed9f3f887a5b7eb57126e06064c1a0ddf5e9c6a0fb`; copia privada en `~/.local/share/cita-suite/releases/c195b1e388f3acc947464363514ae99f94c413da`). Ese paquete nunca se instaló en producción: se ensayó en staging, no acá. Comprobar después con `verify-production-release.mjs` sobre esa misma carpeta.
3. Ninguno de los dos pasos toca la base ni el programador: V9 no tiene migraciones.

### Antecedente inmediato: V8, 31 de octubre de 2026, 17:22 hora argentina (20:22 UTC)

La confirmación de correo **quedó publicada y verificada**, fuente V8 `408ca04d9e6750e4657dc087264644665a63fb37`, Worker `app`, versión `a1844665-447e-40bb-b9e5-ce7c03ed29d7`. Ambos dominios sirven el paquete aprobado: 139 archivos cliente, 128 migraciones, ingreso/agenda operativos y 74 relaciones sin exposición anónima. Navegador productivo `41238345216` aprobado; cuentas temporales y secreto CI eliminados. El [traspaso de confirmación](../plans/traspaso-confirmacion-email-20261030.md) conserva paquetes, recibos y límites. La llegada del correo de confirmación al buzón externo no se observó: el enlace probado fue generado por Auth real.

Con V8 publicada, la recuperación compatible era `c195b1e388f3acc947464363514ae99f94c413da`, paquete `41136024072`: conserva `/confirmar-correo`. Desde V9 la recuperación vigente es la del apartado anterior. **C9/B11 y los IDs anteriores no son una recuperación válida**, porque pueden romper enlaces de confirmación ya emitidos. Los apartados fechados inferiores conservan la historia de cada entrega; no ejecutarlos como pendientes actuales.

Rige el criterio contextual inicial de [AGENTS.md](../../AGENTS.md): rigor y auditorías profundas; pruebas directas en producción autorizadas; staging, copias y ensayos de reversión cuando aporten protección o evidencia concreta. Para esta UI/Auth sin migraciones no son puertas automáticas un backup menor a seis horas, detener el scheduler, preservar hashes de pacientes ficticios ni repetir el circuito completo. Las reglas incompatibles de procedimientos históricos quedan sustituidas. Esta entrega histórica de UI/Auth no habilitó Natalia/D/E ni cambió su acceso. El alcance posterior de E está en [plan 12.18](../plans/propuesta-senas-avisos-natalia.md#etapa-e-vigente): definición revisada, sin implementación ni publicación todavía.

## Entrega anterior — señas y horarios liberados, 30 de octubre

Aplicación **C9 `deb74b023431e4f173eed85d6651c5073ad44557`**, paquete41081146798, versión productiva **`e5dddd3c-90e2-423c-8ce9-fc9ed4b9be15`** en ambos orígenes,32bindings conservados,136archivos cliente/35Natalia exactos, CSP propia,74relaciones sin exposición anónima y HTTPS. Esquema128, señas/global/cancelación automática apagados. No se configuró el consultorio de Natalia ni se tocó landingVercel/DNS.

**Recuperación compatible B11:** `bf0fd1892b1adc769d93c8ac369c533ee80a58b7`, paquete41049721655, versión productiva ensayada **`0fbe672e-607c-4358-b335-3b047642ff09`**. Conserva los controles de señas existentes; apagar el interruptor general **antes** de instalarla. Ensayo productivo con tres estados propios, registrar/deshacer por HTTP y SQL/auditoría, luego retorno **nativo** a C9 y mismas comprobaciones. Los datos propios se retiraron; huellas completas de21consultorios/122pacientes/108turnos idénticas al antes. No usar los IDs de recuperación históricos de abajo para esta entrega.

Programador restaurado **`16c73f28-eb48-4651-ac71-f2fd9f4087f9`**,5cron productivos/0staging,APP→app. **Observación natural aprobada:** ocho eventos16:51:46→17:03:31UTC de calendario/notificaciones/reseñas/cargas, todosok/sinexcepciones/versión16c73f28; tail terminado. Mantenimiento cada3h configurado, sin tick observado en esta ventana. Control final `cierre-productivo.json`17:04:43ok: Auth/agenda en ambos orígenes después de limpiar, mismosSHA de21consultorios/122pacientes/108turnos, globaloff y ningún dato de la fixture. Copia posterior41092046966 aprobada y recuperada independientemente,128migraciones/110tablas; manifiesto `ef847fb3378d952e3e4d0e853556227a94760dbef3ceac1ec9c117e6987716b5`. La secuencia reproducible y el estado exacto se conservan en [publicación de esta campaña](../plans/publicacion-senas-avisos-natalia.md), [cierre](../plans/cierre-senas-avisos-natalia.md) y [traspaso](../plans/traspaso-senas-avisos-natalia.md). La autorización anticipada12.8 sustituye otra consulta de permiso; los controles de respaldo/recuperación/drenaje/reversión/destino se conservan.

## Publicación anterior — 28 de octubre, 05:10 UTC

**Publicada y verificada el 28 de octubre, 03:55–05:06 UTC** (autorización expresa del usuario; recibos en `.verification/publicacion-agenda-20261028/`, detalle en el registro):

- Aplicación `aacba5b10ff6030ac061e20ce0cccdf28126c180` (horas de la agenda y del detalle del turno en la zona del consultorio; hora de la tarjeta sin partirse en celulares). Instalada como `a18e6001-84a5-4502-ba12-57c686291197`; dos mediciones limpias de `verify-production-release.mjs` (131 archivos de cliente). **Versión vigente `4e29aba6-8039-4340-8869-5e0b77bda328`**: la misma aplicación sin el secreto `GOOGLE_CALENDAR_REDIRECT_URI` (32 enlaces). La creó `wrangler secret delete` y no tiene mensaje («Secret Change»): la lectura posterior compara el mensaje de versión y lo marca como diferente; la revisión servida en las dos direcciones es `aacba5b`.
- Calendar pide el retorno del subdominio (ver [dominio](dominio.md), punto 6).
- Programador **`ba7b746d-7d86-4016-91aa-dfbea35ba464`** con los cinco cron (mismo código del programador que `95b2596`). Eventos reales desde las 04:42 UTC (unos 6 minutos de propagación): push, calendario, reseñas y cargas, 15 eventos `ok` sin excepciones hasta las 05:06; mantenimiento (`17 */3`) observado a las 06:17:28 UTC, `ok` sin excepciones, también de `ba7b746d`.
- Copia previa `40629440330` certificada y descargada de Drive (105 tablas, 4152 filas, 24 adjuntos).
- **Recuperación de esa entrega (ya no vigente; la actual está en el primer apartado):** detener primero el programador (`node scripts/deploy-production-workers.mjs scheduler-without-crons`) y después `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 8b41ec56-5df3-4050-94f2-8b0f40347365 --name app --message "<motivo>" --yes` (`95b2596`). Ensayada a las 04:20 UTC: sirve `95b2596`, recupera su secreto de Calendar (workers.dev) y sus 33 enlaces; lectura aprobada. Regreso nativo a `4e29aba6` a las 04:34.
- El límite de ingresos de la cuenta de prueba (abajo) se respetó separando las lecturas: 04:18, 04:20, 04:33:49 y 04:35:27.

## Continuación anterior — 27 de octubre, 15:00 UTC (antecedente)

**Direcciones (desde la entrega de origen, 27 de octubre, 14:19 UTC):**

- La aplicación se sirve en `app.cita-suite.com.ar` y en `app.cita-suite.workers.dev`.
- `cita-suite.com.ar` es la landing, servida por Vercel por decisión del usuario.
- `PUBLIC_SITE_URL` y `PRODUCTION_APP_ORIGIN` son `https://app.cita-suite.com.ar`. `PUBLIC_SITE_URL_FALLBACK`, Natalia y el retorno de Calendar (secreto `GOOGLE_CALENDAR_REDIRECT_URI`) siguen en workers.dev. Las verificaciones comprueban las dos direcciones.
- Por HTTP, workers.dev responde 308 a HTTPS desde la propia aplicación; el subdominio, 301 desde el borde de Cloudflare.

**Publicada y verificada el 27 de octubre, 14:03–14:57 UTC** (autorización expresa del usuario; recibos en `.verification/dominio-landing-20261027/`, detalle en el registro):

- Aplicación `95b2596a9b4f24d8ae50d78a94e3f1c9f95b811a`, versión **`8b41ec56-5df3-4050-94f2-8b0f40347365`**, servida en las dos direcciones; 130 archivos de cliente exactos, CSP sólo del proyecto propio, 0 de 70 relaciones expuestas, 33 enlaces idénticos.
- Programador **`cae02746-2b69-4481-b9b6-d6441b512f10`** con los cinco cron. Eventos reales observados entre las 14:50:33 y las 15:21:11 UTC: los cinco tipos (push, calendario, reseñas, cargas y mantenimiento), 20 eventos, todos `ok`, sin excepciones y sin huecos. El primero llegó 10 min 42 s después de instalar, dentro de la propagación de hasta 15 minutos que documenta Cloudflare: una primera ventana de observación vacía no indica una falla.
- Copia previa `40516167872`, certificada y descargada de Drive.
- **Recuperación de esa entrega (ya no vigente; la actual está en el primer apartado):** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback d0ac2bcf-7e6a-4786-b2fb-5ff14687d643 --name app --message "<motivo>" --yes` (compatible `b108c19`), ensayada el 27-oct a las 14:22 UTC con verificación y lectura aprobadas. Primero se detiene el programador (`deploy-production-workers.mjs scheduler-without-crons`). Con `b108c19`, workers.dev vuelve a aceptar HTTP sin redirigir.
- **Límite de ingreso de la cuenta de prueba:** la aplicación admite 5 ingresos por correo en una ventana móvil de 15 minutos (`login_password_by_email`), y cada lectura posterior (`production-readback.mjs`) ingresa dos veces, una por dirección. No hacer más de dos lecturas posteriores en 15 minutos; la tercera falla con `CONFIGURED_TEST_LOGIN_FAILED` sin que haya una regresión (pasó el 27-oct a las 14:24 UTC).

Topología, procedimientos y reversión de dominios: [dominio](dominio.md). Las publicaciones de la app no tocan dominios (`wrangler.jsonc` no declara `routes`). No agregarlas: `wrangler deploy` reemplaza el conjunto de dominios del Worker y, sin terminal interactiva, reasigna dominios de otros Workers y pisa registros DNS en conflicto (comprobado en el código de wrangler 4.86.0).

**Antecedente, publicada y verificada el 27-oct a las 03:11 UTC:** producción servía `b108c1912e2c3bc57403b006bcf33b71cdb91c23`, versión `d0ac2bcf-7e6a-4786-b2fb-5ff14687d643`. Programador `f105c4ff-160b-4e00-8b5d-14deb9f33b84` con cinco cron y eventos reales observados. La secuencia ejecutada y sus recibos están en el registro y en [el traspaso del panel](../plans/traspaso-apertura-panel-20261026.md). Recuperación: `wrangler rollback e3af637d-a115-4f06-a89a-ba64583f5e9c --name app` (compatible `dbd69d2`, con la corrección de recuperación), con las verificaciones de este documento. El acceso local a la base exige que esta máquina no salga por ProtonVPN (el pooler de sesión no responde por esa ruta). El subdominio `app.cita-suite.com.ar` sirve el mismo Worker. El cambio de `PUBLIC_SITE_URL` es una entrega propia: el usuario ya agregó los retornos de Supabase y Google, comprobados el 27-oct.

## Antecedente — recuperación, 26 de octubre, 17:59 UTC

Leer el [traspaso exacto](../plans/traspaso-recuperacion-sin-dominio-20261026.md) antes de ejecutar comandos: candidataad5ac57/artefacto40369186753 y compatible375e16a/artefacto40369909691. Reversión de staging aprobada; auditoría completa40373057375 todavía en curso. **No hubo publicación productiva de esta corrección.** El preflight falló en la primera lectura de base; causa no establecida y control pendiente. Metadata productiva revalidada:0851,versión70f0cdc0,33 bindings y cinco cron activos. No se detuvo el programador.

Los procedimientos y versiones inferiores describen entregas anteriores: no ejecutar scripts con SHA fijos ni usar la candidata de staging como versión de producción. La futura entrega requiere release aprobado, lectura de base/Auth/agenda, respaldo actual comprobado, drenaje/reversión y verificación de esta revisión. SMTP sigue sin configurar. El alcance del25-oct es un consultorio, con desviación de latencia aceptada sólo por el usuario; quedan prohibidos más ensayos de dos consultorios en Free. No se contrató nada ni cambió el plan.

## Antecedentes de publicación

Procedimiento del [plan íntegro](../plans/refactorizacion-cita-suite.md). Actualizado el 24 de octubre de 2026 después del ensayo de las13:15 UTC. La [auditoría](auditoria-final.md), el [registro](../plans/registro-refactorizacion-cita-suite.md) y el [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) distinguen preparación, ejecución y resultado.

La autorización del 17 de octubre permite publicación y ensayos sintéticos en producción. La decisión del 20 exige demostrar el lanzamiento de dos consultorios en infraestructura gratuita; no autoriza contratar. **Publicar para verificar no habilita abrir a clientes reales.** La instrucción del 24 permite controlar el Samsung y continuar sin preguntas intermedias; las dependencias externas se informan al final.

## Estado y revisiones del 24 y 25 de octubre (antecedente)

Esta sección se tituló «vigentes» hasta el 27 de octubre. Ya no lo es: la aplicación, el programador y la copia actuales están en «Continuación vigente», al principio de este documento. Lo que sigue conserva el estado de su fecha.

Comprobación del 24 de octubre, posterior al ensayo de las 13:15 UTC. Las cargas40078561771 y40099997857 fallaron latencia e impiden aprobar el lanzamiento. Cierre25-oct01:40UTC:130app/35Natalia/70relaciones públicos comprobados; Vercel conserva su despliegue. La sesión administrativaCFactual no ve la cuenta destino y devuelve403/10000; las versiones y cron de la tabla son la última metadata aprobada24-oct13:36, no una relectura25-oct. Restaurar acceso y comprobar antes de cualquier mutación; no desplegar por ese403.

| Recurso | Estado comprobado |
|---|---|
| Aplicación | Fuente `0851de59ed7971debe2514e6d6851d142bbc5766`, versión `70f0cdc0-c2fd-4b7d-93e6-d6a68e2529be`. Artefacto40095722950:216 archivos exactos;130 de cliente,35 de Natalia,70 relaciones sin exposición y33 bindings preservados. |
| Release |40096001763 aprobado:20/20 controles y44/44 casos en cada perfil de desarrollo, candidata y recuperación. Run475e7921-b8c2-47b6-b5a1-7f0ff11fd06b;681 evidencias, paquete SHA2569d5dfe3193f9547f48c6ed8a2c5287c7e77baaa1c06cfcb3f1ba8bd296e233bb. |
| Recuperación compatible | Fuente `83278ad47f15b0af4e08e328fb88548910c198b0`, versión `2b9609ae-31d5-4956-8003-01389e3ab316`, artefacto40095847239. Instalada y verificada en producción, con retorno nativo a70f0cdc0. Las tres comprobaciones conservaron hashes, permisos, agenda autenticada y datos; Samsung:0 activaciones para turno vencido y0 errores. Recibo `inactive-push-production-recovery-20261024.json`. |
| Base |126 migraciones; entrada heredada deshabilitada. No hubo nuevas migraciones ni cambios de secretos durante este arreglo. Los baseline antiguos CB/5ee conservan el intento de activar avisos inactivos; no son la recuperación vigente. |
| Programadores | Producción:94bed118-58f7-4608-b543-202812184fda, cinco cron restituidos. Staging permanece sin cron. Código de tareas idéntico al ya probado; no atribuir al cambio de interfaz otra medición de capacidad. |
| Respaldo | Carpeta privada `production-2026-10-24T12-57-28-335Z`:105 tablas,3942 filas,5 dumps,24 objetos/11.599.541 bytes; hashes, conteos COPY y permisos700/600 verificados. Manifiestoe042313d02e9c02599f55962a96e7d5a582436f0f55a2ea7fab0c7ef50ebabdf. Este dump exacto no fue restaurado; el mecanismo tiene ensayo aislado previo. |
| Natalia | Vercel Git `dpl_6zBnr7E2FVg11SQ5mHiHv8rdPPKk`, main e3530ed:35 archivos coinciden con ambos artefactos nuevos. Samsungv3 aprobó navegación nativa, reserva persistida, recuperación sin duplicación, comprobante anterior y cancelación,0 errores. |
| Limpieza | Dos pacientes y turnos de Natalia retirados con guardas verificadas; dos consultorios/dueños propios de proveedores retirados. Vínculo histórico Calendar1/1 preservado. Pestaña y forward propios cerrados; otras pestañas y permiso conservados. |
| Lanzamiento | No aprobado:40078561771 y comparación40099997857 sin muestreador fallaron latencia. Limpieza de ambas completada, credenciales temporales retiradas. SMTP sin proveedor/remitente y dominio pendiente de compra. No contratar ni sustituir la falla con un verde funcional. |

Los ensayos y versiones anteriores se conservan en sus recibos. El resto del procedimiento explica los controles; no repetir una corrida exclusiva ya terminada. Para otra entrega, sustituir explícitamente revisiones, artefactos, backup y versión de recuperación por los de esa entrega.

## Destinos y precondiciones

| Recurso | Identificador estable |
|---|---|
| Cuenta Cloudflare |`52b358653379c162b5a07b10ae5e84b3`, planFree |
| App / programador | Worker `app`, servido en `app.cita-suite.com.ar` (dominio de Worker) y en `app.cita-suite.workers.dev`. Programador `cita-suite-scheduler`, con *binding* `APP`→`app` y los cinco cron del plan. Landing aparte: `cita-suite.com.ar`, en Vercel ([dominio](dominio.md)). |
| Producción Supabase |`yjzferwuzbtgpmdnzlcb`,sa-east-1; conservar API/Auth/Storage/refs, nombres visibles se tratan por separado |
| Staging |`cita-suite-staging`, `ikaudqoilclfnztkxubz`,us-west-2; programador de staging sin cron durante la observación productiva |
| Natalia Vercel |`natalia-frutos.vercel.app`, proyecto `prj_ddhAhez9VNro373XWSykLkhU5vBS`, equipo `team_CGSlkRXKKlw98jb3O2wSmcyt`,Hobby |
| Repositorios |Principal `Juan4787/cita-suite`,ID1115936156; auxiliar `Juan4787/cita-suite-verificacion`; Natalia `juan-altamira/web-natalia`,ID1416254094 |

Workers Builds de `app` y Git del Vercel viejo fueron desconectados según las capturas del usuario del23-oct; no pedirlos otra vez. El Worker sigue alojado. No reconectar builds que compilen una revisión distinta del paquete probado. Verificar destino, SHA, DB y credenciales por sus nombres/función; jamás copiar valores a logs o CI. Un solo Wrangler activo; no compartirlo con tail. Pruebas pesadas sólo en CI y secuenciales.

## Recuperación reparada y vuelta a candidata

Precondiciones actuales: release40096001763 exitoso y perfiles de candidata/recuperación44/44 aprobados, ambos paquetes íntegros, DB126/legacyoff, respaldo fresco verificado, mismas33formas de bindings y programadores0cron. Si cambia versión, HEAD, cuota, cuenta o configuración, detener la mutación y releer el estado real. No reintentar una operación porque falte su salida de terminal.

```bash
D=.verification/releases/0851de5
B=.verification/releases/83278ad
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs scheduler-without-crons
node scripts/backup-production.mjs
```

El ensayo completo ya aprobó para la corrida actual: no repetir ninguno de sus comandos sin una nueva necesidad. El respaldo se comprueba antes de usarlo: manifiesto/proyecto/migraciones, cinco hashes/tamaños, COPY por tabla, objetos descargados/tamaños y permisos. No publicar SQL ni objetos clínicos. Se conserva evidencia de qué respaldo exacto fue restaurado y cuál sólo se verificó.

Confirmar0cron en ambos programadores mediante la API soportada de Cloudflare y sus bindings correctos. La corrida actual usa la confirmación12:57:15.740UTC como inicio conservador: margen hasta13:12:35.740. Respeta15min de propagación más20s de plazo; no afirmar observación directa de ejecuciones en vuelo. Registrar consultas y resultados saneados.

```bash
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs app "$B"
node scripts/verify-production-release.mjs "$B"
```

Esperado: marcador83278ad,130archivos exactos, CSP sólo del proyecto propio,70relaciones sin exposición. Leer metadata y registrar nueva versión/deployment100%, mensajeSHA y33bindings con nombres/tipos idénticos. Comprobar auth negativa401 y válida410 contra la entrada heredada apagada; no despachar colas para probar autenticación. Iniciar sesión con la cuenta de prueba ya configurada CITA_SUITE_TEST (sin imprimir sus valores) y leer su agenda completa (nodos sin errores y consultorio correcto). Comparar conteos de datos propios antes/después. Esto complementa el perfil44/44 y retorno alojado; no los reemplaza.

Volver a la candidata conocida mediante la operación nativa:

```bash
NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 70f0cdc0-c2fd-4b7d-93e6-d6a68e2529be --name app --message "Cita Suite native recovery return to verified 0851de5" --yes
node scripts/verify-production-release.mjs "$D"
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs scheduler
```

Esperar convergencia del marcador con plazo acotado, guardando cada muestra; no rebajar hashes ni aceptar otra revisión. Repetir metadata33bindings/auth/agenda y confirmar DB126/legacyoff y conteos. Si rollback nativo no está disponible, restaurar los bytes exactos de D con `deploy-production-workers.mjs app "$D"`, sin recompilar, y repetir los controles. Un fallo conserva el recibo y exige inspección: no se sobrescribe ni se presenta como aprobado. Restaurar los5cron sólo con candidata y autenticación comprobadas. Confirmar staging0cron, producción5cron y eventos posteriores reales. El punto de recuperación vigente de83278ad es `2b9609ae-31d5-4956-8003-01389e3ab316`; antes de usarlo releer metadatos, bindings y compatibilidad de cualquier cambio posterior.

La corrida ejecutada `.verification/deploy-and-rehearse-inactive-push-20261024.mjs` agrupa estas guardas y deja `inactive-push-production-recovery-20261024.json`; antes de cualquier reintento leer ese recibo y la API. No cambia secretos, esquema ni tipos generados.

## Medir dos consultorios sin alterar el sistema durante la carga

La corrida40078561771 ya terminó con fallo de latencia y su limpieza se completó: no quedan sus consultorios/dueños ni el secreto temporal de Actions/local. Los comandos siguientes describen el procedimiento de una futura corrida expresamente preparada; no ejecutarlos sobre el estado actual sin nueva siembra y credencial temporal propia. La comparaciónúnica40099997857 también terminó con fallo y limpieza completa: no existe una tercera corrida pendiente. No repetir para buscar un verde. Mantener un único observador; el protocolo determina si habrá samplerSQL y su impacto. La reproducción sin él no demuestra causa exclusiva ni mide su contribución anterior.

1. Guardar `node scripts/production-capacity.mjs integrity` y `report` antes de la carga.
2. Iniciar un único tail saneado. Sólo si el protocolo justifica instrumentación adicional, ejecutar `node scripts/instance-sampler.mjs production 80 <etiqueta>`; la comparación40099997857 lo omitió expresamente. Observación ligera local, carga desdeCI. El observador combinado actual registra jobs y requests con el filtro permanente probado. No persistir eventos crudos, tokens, URLs firmadas ni texto de consultas activas.
3. Ejecutar `gh workflow run production-measurement.yml --repo Juan4787/cita-suite-verificacion --ref refactor/maintainability-20261015`. Son3repeticiones de2min de preparación+10min medidos y una fase pública igual, seguidas de pruebas de abuso. Identificar el runID exacto y el SHA servido de esa corrida. No desplegar, renombrar destinos o rotar claves durante la medición.
4. Recuperar `production-measure-<run>`, conservar estados fallidos, y comparar p95/p99/errores con el plan sin cambiar umbrales. Guardar report/integridad posteriores y sus horas reales. Certificar deltas sólo con marcadores válidos de reinicio de cada familia de estadísticas, incluido pg_stat_statements; dosnull o un marcador ausente significan desconocido. No inventar0deadlocks nuevos niatribuir la actividad intermedia a la carga.
5. Ejecutar `node scripts/attribute-pauses.mjs <samples.jsonl> <requests.jsonl>`. Los requests deben tener at numérico,wallTimeMs y ruta normalizada. Separar HTTP, proveedor, SQL y resultados de plataforma. No atribuir causalidad exclusiva por una correlación.

Lecturas p95<1s/p99<2s; escrituras p95<1,5s/p99<3s; errores<1%; ningún cruce/superposición/cuota violada. Un límite de plataforma impide abrir a clientes reales: informar evidencia y alternativas, no contratar ni transformar un200tolerado en cumplimiento de10msFree.

## Limpiar sólo el ensayo propio

```bash
node scripts/release-smoke.mjs production cleanup
node scripts/production-capacity.mjs cleanup
gh secret delete CITA_PRODUCTION_CAPACITY_SECRET --repo Juan4787/cita-suite-verificacion
rm ~/.config/cita-suite/production/capacity-secret
```

La limpieza de la corrida actual ya está completada; no repetir esos comandos ni recrear un secreto sólo para ejecutarlos. Para una corrida futura, humo primero: capacidad rechaza documentos aún presentes. Respetar `cleanupAfter` de la última URL de carga (TTL+margen); el plazo actual05:55:18UTC ya venció. No repetir subidas sólo para obtener otro verde y extender el plazo. Exigir contabilidad coherente y cero consultorios/dueños del ensayo después. Borrar secreto sólo al terminar limpieza, porque los comandos todavía lo necesitan.

Para fixtures de proveedores: preservar reporte final e identificar slug/dueño/cita exactos. Calendar debe estar cancelado y su ausencia externa comprobada antes de quitar filas; conservar la conexión/evento histórico. Push debe conservar prueba recibida/mostrada; cerrar sólo notificaciones propias y retirar sólo los recursos ADB creados por esta corrida. No borrar otras pestañas, permisos, sesiones o dispositivos del usuario.

## Natalia: publicar conservando el sitio realmente servido

El baseline es **el despliegue CLI** `dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8`, no el árbol legado de maina66dea8. Sus35archivos/503.818B están archivados bajo `.verification/natalia-prior-production-20261023/site`, con manifiesto y huellas. Ambas selecciones de output ya aprobaron35/35 exactas en preview. El header `x-vercel-skip-toolbar:1` se usó exclusivamente en preview; producción se verifica sin normalización ni headerespecial.

Publicación ya ejecutada por cambio condicional de main y comprobada en Vercel: no repetir la preparación. El plan histórico `.verification/natalia-publication-cb8a9ba/complete-publication-plan.json` contiene:35nuevossite/,vercel.json,35anterioresrollback/ y su manifiesto; total72archivos. Commit remoto publicado `e3530eda43fd6ddc82b093a166eb49f83bf7815a`, árbol `2fadf0461e324a263a30d914848976228111abff`, padre/main esperado `a66dea894dcb513f5e9a4fcc9d8598c7f22503b9`; preserva15archivos ajenos. Main actual es e3530ed; no usar a66 como si siguiera siendo el HEAD vigente ni repetir la creación de blobs. El alias productivo está comprobado en natalia-production-publication-20261024.json.

Antes de mover main: revalidar repoID1416254094, HEAD/árbol, proyecto/equipo/Hobby, Git y alias/despliegue servido. Comparar35archivos del paqueteCB y35anteriores con manifiestos; configuración exacta frameworknull/buildCommandvacío/installCommandvacío/outputDirectorysite. Si hubo cambios externos, inspeccionarlos y regenerar la preparación necesaria, sin sobrescribirlos.

El plugin GitHub confirmó admin/push y permitió el cambio condicional de referencia. La cuenta CLI existente `juan-altamira` también tiene admin/push; `Juan4787` no lo tiene en este repo. Cambiar mediante `gh auth switch --hostname github.com --user juan-altamira`, comprobar `gh api user`, actualizar main con comparación deSHA y sinforce, y restaurar la cuenta anterior en finally. No exportar tokens ni solicitar otro login. Registrar padre/commit/árbol. Esperar deploymentREADY del commit exacto y alias productivo apuntando a él.

```bash
node scripts/verify-production-release.mjs "$D" --natalia
```

Exigir35archivos exactos sin headerespecial, y además reserva desde la web con persistencia en agenda, recuperación sin duplicar y cancelación propia. Un hash de frontend o READY no acredita backend. No eludir límites porIP ni crear reservas ajenas.

Reversión: comprobar HEAD esperado y crear commit nuevo que cambie **sólo** outputDirectory al archivo `rollback/dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8/site`, conleaseSHA y sin reescritura. La selección ya fue ensayada. Recuperación inmediata si está disponible: `vercel promote dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8 --scope juanaltamiras-projects --yes`; después alinear Git y comprobar alias/READY/35huellas anteriores. Si expiró ese deployment, los bytes archivados permiten el commit de recuperación sin depender de retención. No restaurar DB ni suponer que mainlegado reproduce el sitio anterior.

## Repositorio e identidad

Seguir [identidad](identidad-cita-suite.md) con builds desconectados. Main principal313 tiene147rutas históricas/adjuntos fuera del snapshot y109eliminaciones explícitas. Superponer sólo fuentes probados y documentos revisados mediante índice temporal; conservar146blobs históricos y la corrección explícita de `docs/mercadopago-suscripciones.md` (SHA-256415f0182766cd7ddb84b22b110f09f9484ca2a5cf700864db3eaa61721633b09). Los preparadores478 son históricos: para la fuente actual deben verificar1137 entradas y digesta31596d41d6e958e43502ab8a4b1e2f96b43e38db3ad7542be1c34adcb5b2a6d, no ignorar guardas para hacerlos pasar.

Promoción con padre/lease del HEAD leído, preservando índice/HEAD del usuario; renombrar únicamenteID1115936156 a `cita-suite`, comprobar mismahistoria/IDs/permisos/reglas/consumidores y actualizar remoto a `github-secundaria:Juan4787/cita-suite.git`. Mantener auxiliar independiente y no reconectar builds automáticos. Cambiar sólo nombres visibles de los proyectos Supabase correctos mediante interfaz soportada y sesión autorizada, conservando refs/región/endpoints/datos. La CLI instalada no ofrece rename ni hay token de gestión en entorno; no extraer almacenes. Si falta sesión disponible, dejar la acción exacta al final. Directorio físico ya trasladado a `Cita Suite`, con procesos propios finalizados y enlace atómico compatible desde la ruta anterior. No repetir ni retirar el enlace durante esta sesión.

## Dependencias y criterio de cierre

El dominio `cita-suite.com.ar` está comprado y operativo desde el 27-oct ([dominio](dominio.md)). Siguen pendientes:

- **Verificación de marca de Google:** no se envió. Bloqueo probable: el dominio autorizado de Supabase no se puede verificar ([guía](acceso-google-calendar.md#retomar-cuando-el-usuario-comunique-la-compra-del-dominio)).
- **SMTP:** configurado con Gmail (`citasuite@gmail.com`) y comprobado con un correo real el 27-oct ([correo de recuperación](correo-de-recuperacion.md)).
- **Respaldos:** el destino ya lo eligió el usuario (Drive, 26-oct). Su estado está en la [auditoría final](auditoria-final.md), punto 6.

No inventar ni contratar esos recursos.

La auditoría final contrasta todos los requisitos, distingue CI/simulación/producción/dispositivo y conserva fallos. Si Free no cumple, la campaña no se declara cerrada ni el lanzamiento habilitado. Se entrega evidencia concreta, alternativas y pasos restantes; no se enmascara el impedimento con un verde parcial.

## Antecedentes conservados

La expansión/reconciliación/contracción, las versiones antiguas, sus comandos y evidencias están en el [procedimiento anterior archivado](../archive/procedimientos-historicos/publicacion-y-reversion-20261024-0827.md), SHA-256 cfc3ea94229b35decb2c3a57f84f40c552156934a36437140df1b0f31d3e04b9. **Es histórico, no una receta para repetir migraciones, reinstalar secretos o volver al baseline defectuoso.** El plan y el registro originales se preservan íntegros.


## Identidad aplicada: alcance y comprobación

El principal se promovió a37f625b y se renombró a `Juan4787/cita-suite` manteniendoID1115936156, historia, otras ramas, tags, issues/PR y políticas. Origin apunta a `github-secundaria:Juan4787/cita-suite.git`; ambas direccionesGit se comprobaron. Plugin sinpermiso deescritura enprincipal: Git nativo usó expectativaexacta deHEAD y padre directo comprobado, con dry-run adversario rechazado; no se reescribió historia. App, programador y Natalia conservaron sus deploymentIDs después de la transición, sin builds reconectados. Directorio físicoCitaSuite con enlace anterior compatible. Los recibos de identidad identifican elSHA ejecutado; actualizaciones documentales posteriores conservan exactamente las fuentes verificadas.

## E — publicación y recuperación compatible (5 de noviembre)

Decisión y fundamento: [D7 del plan integral](../plans/plan-integral-avisos-20261105.md#d7-recuperación-compatible-con-e). Lo que sigue es el orden operativo. **V12b deja de ser una vuelta atrás válida en cuanto se confirman las migraciones.**

**Precondiciones**, todas sobre la misma revisión `R` de `main`:
- `fast` y `sql` aprobados en el repositorio auxiliar, con la prueba de carreras de correo.
- Paquete: `gh workflow run staging-operations.yml --repo Juan4787/cita-suite-verificacion --ref <rama de R> -f operation=artifact`.
- Navegador completo sobre ese paquete: `refactoring-verification.yml`, `level=browser`, `browser_grep=.`, `artifact_run=<corrida del paquete>`.
- El nivel `release` no aplica: exige un paquete de vuelta atrás compatible, que para E no existe.
- Desde esta máquina, el puerto 5432 del pooler debe responder; la VPN lo bloqueaba antes.

**Orden**, un paso por vez y leyendo el resultado antes del siguiente:

```bash
# 1. Ensayo de la transacción completa contra el esquema real; siempre se revierte.
node scripts/rehearse-production-migrations.mjs
# 2. Respaldo previo (directorio privado fuera del repositorio).
node scripts/backup-production.mjs
# 3. Sin trabajos programados mientras cambian esquema y app.
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs scheduler-without-crons
# 4. Las 32 migraciones de E en una sola transacción: todo o nada.
node scripts/apply-production-migrations.mjs <directorio del respaldo del paso 2>
# 5. Secretos de correo, leídos de archivos privados por la entrada estándar; nunca en argumentos ni registros.
# 6. App: el paquete exacto, y su verificación.
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs app <paquete descargado>
node scripts/verify-production-release.mjs <paquete descargado>
# 7. Programador con los cinco cron nuevos (correo en 3-59/5; reseñas y cargas alternan en 2-59/5).
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs scheduler
```

8. Interruptores: `reschedule_enabled` y `email_producer_enabled` en `private.appointment_management_runtime`; `GOOGLE_CALENDAR_MANAGED_ENABLED` como secreto. El correo de Natalia no sale: su consultorio no tiene remitente hasta que Juan decida. Precisión del 19 de noviembre: Juan decidió que envíe comprobantes y recordatorios; falta configurar su remitente ([pendientes vigentes](../plans/pendientes-vigentes.md#etapa-e-pendientes)). Configurado el 21 de noviembre: `turnos@natalia-frutos.cita-suite.com.ar` ([paso 0 de la entrega](../plans/entrega-natalia-20261121.md)).
9. Webhook de Zoho: la clave se genera en un archivo privado local y se carga como secreto del Worker. En el panel: agente → Webhooks → «Configurar webhook» → URL `https://app.cita-suite.com.ar/api/zoho/webhook` → Verificar → las cuatro casillas de correo → Agregar. La clave se carga después, con «Clave de autenticación»: sin webhook creado el panel no muestra ese botón, y admite como máximo 50 caracteres. Rechazó una clave con guiones y aceptó una de 32 letras y números. Al verificar, Zoho envía un POST de ejemplo sin firma y sólo acepta `200`; por eso un pedido sin firma recibe `200` y no se guarda, y una firma inválida recibe `401`. Cloudflare tiene una Configuration Rule, «Webhook de Zoho», que apaga Browser Integrity Check sólo para esa ruta. No fue la causa del «URL cannot be reached» y, medido desde esta máquina, el agente `Webhook` de Zoho pasa sin ella; se conserva por precaución y puede retirarse.
10. En el mismo paso: la instantánea publicada entra a la historia de `main` sin cambiar su árbol (`git merge -s ours --no-ff <instantánea>`), se actualiza `docs/ESTADO-VIGENTE.md`, se sube a GitHub y se corre `node scripts/check-repo-sync.mjs`.

**Si algo falla:**
- **Antes del paso 4:** la base no cambió. Se reinstala el programador con `scheduler`. Ese comando instala el programador del árbol verificado, no el de V12b, pero V12b atiende todas sus categorías salvo `email`: a esa le responde 404, sin ningún efecto, hasta que se publique la app. Reseñas sigue cada 10 minutos y cargas pasa de 15 a 10.
- **Si falla el paso 4:** la transacción se revierte entera y producción sigue en V12b. Se reinstala el programador igual que en el punto anterior.
- **Después del paso 4:** no se vuelve a V12b. Se apaga el interruptor del canal afectado, o se detiene el programador, y se corrige hacia adelante con el mismo circuito. Desde la segunda versión de E, `wrangler rollback` a la versión E anterior verificada es válido.
- **Último recurso:** restaurar el respaldo del paso 2 en un proyecto nuevo ([procedimiento](respaldo-y-recuperacion.md#restaurar-en-un-proyecto-nuevo)) con V12b. Pierde lo escrito después del respaldo e invalida las sesiones. Antes de elegirlo se cuentan los datos reales que se perderían.

## E — previsión del 2 y 3 de noviembre (antecedente: E se publicó el 6 de noviembre)

La [especificación de E](../plans/etapa-e-correo-autogestion.md) requiere migraciones aditivas, proyección actual de seña compatible y controles para productores/consumidores de correo. Los procedimientos anteriores no prueban recuperación con historia de varias señas o eventos de E. Al implementarse, comprobar específicamente ese estado y documentar qué automatización se detiene antes de volver; no elegir una recuperación antigua sólo por haber sido válida para A/B/C.

En este paso no hubo cambios de aplicación/base, secretos, DNS, envíos ni publicación. La versión productiva sigue siendo la del estado vigente y Juan dará después la instrucción para empezar.

Desarrollo de E, 3 de noviembre (entonces sin aplicar): .100 cierra UPDATE autenticado de agenda. Una recuperación posterior a aplicarla debe conservar los consumidores del comando .090 y los controles de las obligaciones existentes; V12b sola no satisface ese contrato. La recuperación E se comprobará sobre su esquema/historia/colas antes de publicar, sin reabrir escrituras sin auditoría para simular compatibilidad. Producción actual conserva su recuperación V12b documentada.
