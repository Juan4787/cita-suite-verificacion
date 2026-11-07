# Publicación y reversión

## Último estado comprobado — P1, P2 y P3: 7 de noviembre de 2026, 08:06 hora argentina (11:06 UTC)

**La única vuelta atrás vigente es la de este apartado.** Las de los apartados siguientes son historia.

**Producción sirve** la instantánea `cabd8ae4012749907d7bdb80b90f75bc0119f2a3` de `main` `2f81c7ef`, Worker `app`, versión de Cloudflare **`ecec47cb-93f2-49d6-be09-dfa94091810a`**. 165 migraciones. Programador `0debec79-cadd-47e3-8bf6-47a46e6ba182`, con los mismos cinco cron. Interruptores sin cambios.

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

8. Interruptores: `reschedule_enabled` y `email_producer_enabled` en `private.appointment_management_runtime`; `GOOGLE_CALENDAR_MANAGED_ENABLED` como secreto. El correo de Natalia no sale: su consultorio no tiene remitente hasta que Juan decida.
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
