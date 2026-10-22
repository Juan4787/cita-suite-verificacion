# Publicación y reversión

Instructivo de la sección 5 del [plan](../plans/refactorizacion-cita-suite.md) con los destinos reales de Cita Suite. Cada paso dice qué comando correr, qué comprueba, qué recibo deja, cuándo detenerse y cómo volver atrás.

**Autorizaciones:**
- **17 de octubre:** el usuario autorizó publicar en producción y las pruebas masivas con datos sintéticos.
- **20 de octubre:** decidió lanzar dos consultorios sobre Workers Free y Supabase Free, sin contratar nada ni servicios con cobro variable sin tope.
- **Hoy no hay clientes reales.** Publicar en producción es parte de la verificación. Abrir a clientes reales depende además de la medición de producción y de las decisiones pendientes del usuario (final de este documento).

**Dónde queda la evidencia:**
- cada paso deja su recibo en `.verification/`;
- el [registro](../plans/registro-refactorizacion-cita-suite.md) anota cada corrida con su identificador, SHA y resultado.

## Candidata vigente

| Dato | Valor |
|---|---|
| Revisión | Snapshot `dfb487faa74b8117c46c180c70f368f77f3dbcd2`: el código de la app de `f83bbc2` más las herramientas de publicación |
| Release | Operación `artifact` 39782403651, artefacto `cloudflare-staging-dfb487faa74b8117c46c180c70f368f77f3dbcd2` (216 archivos en el manifiesto) |
| Paquete del Worker | `_worker.js` idéntico en staging y producción, SHA-256 `607528d8d6ee78b315ad25f4c968002b60cdb1ae5f9ca8170e3c990677ef3cb8` |
| Staging | Se despliega desde ese paquete antes de su `verify:release`; 126 migraciones |
| `verify:release` | Pendiente para `dfb487f`. La corrida de `f83bbc2` (39777244477) se canceló por un `apt-get` colgado en CI |
| Base de producción | 97 migraciones aplicadas; quedan 29, en dos tandas (28 y 1) |
| Versión de reversión de `app` | `9b2df65c-f89c-4940-a625-4d7b3e5858f2`, del 15 de octubre: sirve `313355a` |

Esta tabla se actualiza con cada candidata. Sólo se publica una candidata con su `verify:release` aprobado.

## Destinos

**Producción:**

| Recurso | Identificador | Cómo se publica |
|---|---|---|
| App | Worker `app` de la cuenta `52b358653379c162b5a07b10ae5e84b3`, `https://app.cita-suite.workers.dev`, ubicado en `aws:sa-east-1` | `deploy-production-workers.mjs app <release>`: sube el paquete de producción que compiló CI, sin compilar aquí, y comprueba la revisión servida. |
| Programador | Worker `cita-suite-scheduler`, con los cinco cron del plan y un binding a `app` | `deploy-production-workers.mjs scheduler`, desde el código del snapshot verificado. |
| Base | Supabase `yjzferwuzbtgpmdnzlcb`, sa-east-1 | `apply-production-migrations.mjs <respaldo>`. Exige un respaldo de producción de menos de seis horas, en el mismo estado de migraciones. |
| Respaldo | Carpeta privada fuera del repositorio, `~/.local/share/cita-suite/backups/` | `backup-production.mjs` ([respaldo y recuperación](respaldo-y-recuperacion.md)). |
| Natalia | `https://natalia-frutos.vercel.app` | No se despliega desde este repositorio; el usuario indica cómo se publica. El release trae su sitio ya compilado para producción, en `.verification/natalia-production` (35 archivos), y se publican esos archivos exactos. |

**Staging, para verificar el release:**

| Recurso | Identificador | Cómo se publica |
|---|---|---|
| App | Worker `cita-suite-staging`, `https://cita-suite-staging.cita-suite.workers.dev` | `deploy-staging-workers.mjs app <release>` |
| Natalia | Worker de sólo archivos `natalia-frutos-staging`, `https://natalia-frutos-staging.cita-suite.workers.dev`, fuera de los buscadores (`X-Robots-Tag: noindex`) | `deploy-staging-workers.mjs natalia <release>` |
| Programador | Worker `cita-suite-scheduler-staging`, versión `49636b6a-b43d-4468-8b46-8daf749e9b88`; hoy tiene los cinco cron de la cuenta Free | `deploy-staging-workers.mjs scheduler`, o `scheduler-without-crons` para liberarlos |
| Consultorio de release | `release-staging`, sintético y fijo | operación `release-fixture` del workflow de staging |

## Herramientas

Todas corren desde esta máquina con la configuración privada (`.env` ignorado y `~/.config/cita-suite/`). Ninguna imprime claves, contraseñas, tokens ni URLs firmadas. Las de producción validan el destino con `scripts/lib/production-database.mjs`: el pooler de São Paulo, el usuario del proyecto, la base `postgres` y la contraseña, en el puerto 5432. Cualquier otro destino se rechaza antes de conectar.

| Herramienta | Qué hace | Se niega cuando | Recibo |
|---|---|---|---|
| `check-previous-scheduler.mjs` | Lee en cron-job.org que todos los trabajos estén deshabilitados, y que las copias retiradas de Netlify y Vercel no sirvan la app. | — (falla si algo sigue activo) | `previous-scheduler-<fecha>.json` |
| `backup-production.mjs [carpeta]` | Respaldo completo: roles, esquema, datos, objetos de plataforma, historia y archivos de Storage. | La carpeta existe; la conexión o la API no son de producción. | `manifest.json` del respaldo |
| `rehearse-production-migrations.mjs [--until=<versión>]` | La misma transacción de la publicación sobre el esquema real, siempre con `ROLLBACK`, y el catálogo resultante comparado con staging. | La historia no es prefijo de las migraciones. | `production-migration-rehearsal-<fecha>.json` |
| `apply-production-migrations.mjs <respaldo> [--until=<versión>]` | Una tanda, en una sola transacción: reconciliación cuando corresponde, migraciones e historia. | No hay respaldo de producción de menos de 6 h en el mismo estado; la historia no es prefijo; una migración controla su transacción fuera de su primera y última línea. | `production-migrations-<fecha>.json` |
| `production-legacy-jobs.mjs status\|off\|on` | Lee o cambia el interruptor de las entradas antiguas de tareas. | El interruptor todavía no existe (antes de la tanda 1). | `production-legacy-jobs-<fecha>.json` |
| `deploy-production-workers.mjs app <release>` | Sube el paquete de producción y espera la revisión servida. | El paquete no coincide con su manifiesto; la configuración no es la de producción; falta un secreto requerido. | Salida del comando |
| `deploy-production-workers.mjs scheduler` / `scheduler-without-crons` | Despliega el programador con los cinco cron, o sin ninguno (primer paso de una reversión). | El código del programador difiere del snapshot verificado; falta el secreto de tareas. | Salida del comando |
| `deploy-staging-workers.mjs scheduler-without-crons` | Libera los cinco cron de staging, que la cuenta Free necesita para producción. | Igual que el anterior, en staging. | Salida del comando |
| `verify-production-release.mjs <release> [--natalia]` | Revisión servida, login, redirección privada, cada archivo cliente del release, CSP con sólo el proyecto Supabase de producción y la sonda de la clave anónima. Con `--natalia`, los archivos exactos de Natalia. | — (falla ante la primera diferencia) | `production-release-<fecha>.json` |
| `production-capacity.mjs secret\|seed\|integrity\|measure\|report\|cleanup` | Consultorios sintéticos `capacity-01` y `capacity-02`, su medición y su limpieza ([capacidad](capacidad.md)). | Ya hay consultorios `capacity-`; la base no deja margen; falta el secreto de la medición. | `production-capacity-*.json` |
| `release-smoke.mjs production [cleanup]` | Prueba de humo sobre `capacity-01`: reserva pública desde el enlace compartido y su cancelación; documento clínico subido, completado, listado, descargado con los mismos bytes y llevado a la papelera, con los contadores exactos. `cleanup` quita después esos documentos y deja los contadores del consultorio en cero. | `capacity-01` no es el consultorio sintético de la siembra o tiene documentos ajenos a la prueba; en `cleanup`, mientras alguna URL de carga siga vigente. | `release-smoke-production-run-<fecha>.json` y `-cleanup-<fecha>.json` |
| `tail-metrics.mjs production <corrida> <minutos> [jobs\|requests]` | Observa el Worker `app`: resultado, CPU y tiempo de cada tarea, o de cada pedido por plantilla de ruta. | Destino desconocido. | `production-tail-<corrida>*.json*` |
| `production-device-push.mjs seed\|link\|report\|cleanup` | Push real a un teléfono, con un consultorio sintético por corrida. El enlace de gestión sólo se imprime en esta terminal. | Identificador de corrida inválido. | `production-device-<corrida>.json` |
| `compare-access-catalog.mjs` | Compara en sólo lectura el catálogo de producción con el de staging. | — | `access-catalog-<fecha>.json` |
| `check-api-exposure.mjs production` | Cada relación de la API leída con la clave anónima debe rechazarla (401, `42501`). | Las claves no son del proyecto o de su rol. | `api-exposure-production-<fecha>.json` |

## Condiciones previas

Todas deben cumplirse antes del paso 1. Estado al 22 de octubre, 13:05 UTC:

| # | Condición | Estado | Evidencia |
|---|---|---|---|
| 1 | Workers Builds desconectado del Worker `app`. Hoy despliega cada push a `main` de `Juan4787/dashboard`, y pisaría la app publicada con el código de `main`. | **Pendiente del usuario** | Panel de Cloudflare: Workers & Pages → `app` → Settings → Builds → Disconnect. |
| 2 | Proyecto `cita-suite` de Vercel desconectado o borrado. Es la copia vieja pausada; se construye con cada push a `main`. | **Pendiente del usuario** | Panel de Vercel. |
| 3 | Forma de publicar Natalia definida, o autorización para usar la sesión de la CLI de Vercel sin leer sus archivos. | **Pendiente del usuario** | — |
| 4 | Release empaquetado una sola vez, sobre la revisión exacta. | Hecho para `dfb487f` | Operación `artifact` 39782403651 |
| 5 | Ensayo de respaldo y restauración aprobado. | Hecho | `staging-operations` 39682517594 |
| 6 | Staging con el mismo release: migraciones, app, Natalia, consultorio de release y tareas observadas. | App y Natalia de `dfb487f` desplegadas (`04ef8a10…` y `b52e723b…`); tareas observadas el 22 de octubre de 12:55 a 13:00 UTC: push dos veces y calendario una, cada una en su horario | Registro; `staging-tail-6fa828d2f6af-summary.json` |
| 7 | `verify:release` aprobado con ese release. | En curso: 39783349541 sobre `dfb487f`. La de `f83bbc2` (39777244477) se canceló por un `apt-get` colgado en CI | — |
| 8 | Ensayo de la base sobre producción, con `ROLLBACK`: cero fallas y catálogo igual al de staging, salvo la deriva aceptada. | Hecho el 22 de octubre a las 06:52 UTC; se repite en el paso 2 | `production-migration-rehearsal-2026-10-22T06-52-19-008Z.json` |
| 9 | Compatibilidad de cada tanda con la versión servida, analizada. | Hecho | Registro y «Reversión» |
| 10 | Programador anterior detenido. | Hecho: cron-job.org 7795525 deshabilitado desde el 31 de agosto; Netlify 404 y Vercel 503 a las 12:43 UTC | `previous-scheduler-2026-10-22T12-43-14-864Z.json` |
| 11 | Prueba de humo ensayada en staging. | Hecho: 14 comprobaciones aprobadas; su limpieza se habilita a las 15:08:57 UTC | `release-smoke-staging-run-2026-10-22T12-54-08-566Z.json` |
| 12 | Programador sin cron y su restitución, ensayados en staging. | Hecho: versiones `6266c45a…` (sin cron) y `49636b6a…` (con los cinco) | Registro |

## La deriva de producción y su reconciliación

El catálogo de producción se alejó de su propia historia de migraciones por cambios hechos fuera de ellas. El ensayo del 22 de octubre lo mostró: tres migraciones pendientes fallaban sobre esos objetos.

**`supabase/production/reconcile-drift.sql` restituye,** una sola vez y dentro de la tanda 1:
- las políticas que las migraciones crean y faltaban, y borra las que ninguna migración declara;
- los nombres de las claves foráneas;
- los cuerpos de las funciones;
- la nulabilidad y los valores por omisión de las columnas;
- las restricciones e índices;
- y deja sin ejecución para la API las funciones heredadas que podía llamar el usuario autenticado.

Cada sentencia comprueba su objeto, y los objetos de otros productos del proyecto no se tocan.

**Deriva aceptada** (`ACCEPTED_PRODUCTION_DRIFT` en `scripts/lib/access-catalog.mjs`): objetos que sólo existen en producción y no cambian el comportamiento.
- funciones heredadas sin ejecución para la API;
- columnas de una función anterior de retención y riesgo de reservas públicas, con sus restricciones: admiten nulo o tienen valores por omisión que las cumplen, y el código no las lee ni las escribe;
- índices de rendimiento.

Se conservan con sus datos. Una limpieza posterior los puede quitar.

## Secuencia

Expandir, desplegar, comprobar y recién entonces contraer. Ante cualquier falla, detenerse en ese paso y aplicar su reversión. No se saltea ni se reordena un paso.

### 0. Preparación (sin cambios)

```bash
D=<carpeta nueva y vacía>
gh run download <operación artifact> --repo Juan4787/cita-suite-verificacion --name cloudflare-staging-<revisión> --dir "$D"
node scripts/check-previous-scheduler.mjs
pnpm --filter web exec wrangler deployments list --name app
node scripts/verify-production-release.mjs "$D"
```

- **Esperado:**
  - el chequeo del programador anterior aprueba;
  - `app` sirve `9b2df65c-f89c-4940-a625-4d7b3e5858f2`, la versión de reversión;
  - `verify-production-release.mjs` falla con «serves 313355a… instead of <revisión>»: demuestra que la comprobación detecta otra versión.
- **Detenerse si:** `app` sirve otra versión. Primero hay que registrar cuál, y fijarla como nueva versión de reversión.

### 1. Respaldo

```bash
node scripts/backup-production.mjs
```

- **Esperado:** imprime la carpeta, filas por tabla, migraciones (97) y archivos, con `objectFailures: 0`.
- **Detenerse si:** falla o algún archivo no se respaldó.

### 2. Ensayo de las dos tandas

```bash
node scripts/rehearse-production-migrations.mjs --until=20261022000000
node scripts/rehearse-production-migrations.mjs
```

- **Esperado:** `failures: 0` en las dos. Las diferencias con staging son sólo la deriva aceptada. En el ensayo de la tanda 1 sola, también los efectos de `20261022010000`, que todavía no se aplica.
- **Detenerse si:** falla una sentencia o aparece una diferencia nueva.

### 3. Tanda 1: expansión

```bash
node scripts/apply-production-migrations.mjs <carpeta del respaldo> --until=20261022000000
```

- **Contiene:** la reconciliación, las 27 migraciones del release, `20261022000000` (la historia clínica sobrevive al borrado de un usuario) y la historia, en una sola transacción.
- **Esperado:** el recibo dice `before: 97` y `after: 125`, sin `failed`.
- **Si falla:** la transacción entera se deshace y la historia sigue en 97. No hay nada que revertir; se diagnostica con el recibo.

### 4. Entradas viejas apagadas

```bash
node scripts/production-legacy-jobs.mjs off
```

- **Esperado:** `before.enabled: true` y `after.enabled: false`.
- **Efecto:** las reclamaciones antiguas devuelven vacío y las entradas antiguas responden 410, la llame quien la llame. El programador nuevo no lo consulta.
- **Reversión:** `production-legacy-jobs.mjs on`.

### 5. App

```bash
node scripts/deploy-production-workers.mjs app "$D"
node scripts/verify-production-release.mjs "$D"
```

- **Esperado:**
  - el despliegue termina con `{"deployed":"app","revision":"<revisión>"}`;
  - la comprobación aprueba: revisión, archivos, CSP con sólo `https://yjzferwuzbtgpmdnzlcb.supabase.co` y su WebSocket, y la sonda anónima en 0. La tanda 1 trae `20261021020000`, que le quita a `anon` sus privilegios.
- **Reversión:** volver a la versión anterior (ver «Reversión», punto 2).

### 6. Consultorios sintéticos y prueba de humo

```bash
node scripts/production-capacity.mjs secret
node scripts/production-capacity.mjs seed
node scripts/release-smoke.mjs production
```

- **Esperado:**
  - la siembra crea `capacity-01` y `capacity-02`, con sus dueños sintéticos;
  - la prueba de humo aprueba sus 14 comprobaciones: reserva pública con su página de gestión y su cancelación, y documento clínico de ida y vuelta, con los contadores exactos y el documento en la papelera;
  - informa `cleanupAfter`, la hora desde la que su limpieza es posible (paso 12).
- **Detenerse si:** falla cualquier comprobación. Revertir la app y diagnosticar.

### 7. Programador

```bash
node scripts/deploy-staging-workers.mjs scheduler-without-crons
node scripts/deploy-production-workers.mjs scheduler
node scripts/tail-metrics.mjs production <12 hex> 20 jobs
```

- **El orden importa:** la cuenta Free tiene cinco cron, y staging los tiene todos.
- **Propagación:** Cloudflare avisa que un cambio de cron puede tardar hasta 15 minutos.
- **Esperado en la observación:**
  - push (`*/5`), calendario (`1-59/5`), reseñas (`2-59/10`) y limpieza de cargas (`3-59/15`) responden 200, una categoría por evento;
  - el mantenimiento (`17 */3`) corre a las HH:17 de cada tercera hora UTC; se observa en su próxima ejecución;
  - la CPU de cada tarea queda registrada. Superar los 10 ms de Free sin corte es el riesgo ya documentado de la etapa 6; un corte (`exceededCpu`) es un hallazgo.
- **Reversión:** `deploy-production-workers.mjs scheduler-without-crons`, y después `deploy-staging-workers.mjs scheduler` para devolverle los cron a staging.

### 8. Push real

**Necesita el teléfono Samsung del usuario: frenar y pedirlo.**

```bash
node scripts/production-device-push.mjs seed
node scripts/production-device-push.mjs link <corrida>
node scripts/production-device-push.mjs report <corrida>
node scripts/production-device-push.mjs cleanup <corrida>
```

1. El usuario abre en el teléfono el enlace que imprime `link` y activa las notificaciones.
2. El recordatorio vence en la siguiente ejecución de push.
3. `report` debe mostrar el envío de 24 h aceptado por el servicio de push y, si el teléfono lo informa, recibido y mostrado.
4. `cleanup` borra la corrida.

### 9. Tanda 2: contracción

```bash
node scripts/backup-production.mjs
node scripts/apply-production-migrations.mjs <carpeta del respaldo nuevo>
node scripts/release-smoke.mjs production
```

- **Por qué un respaldo nuevo:** la historia cambió, y el script exige un respaldo del estado actual.
- **Contiene:** `20261022010000`, el cierre de las escrituras directas. Se aplica sólo con la app nueva comprobada, porque `313355a` escribía directamente: el alta de pacientes, las prestaciones, las asignaciones, los profesionales y las excepciones.
- **Esperado:** `before: 125` y `after: 126`. La prueba de humo vuelve a aprobar con los privilegios cerrados.
- **Detenerse si:** la prueba de humo falla. La app nueva no debería escribir directamente; diagnosticar antes de seguir.

### 10. Permisos

```bash
node scripts/compare-access-catalog.mjs
node scripts/check-api-exposure.mjs production
```

- **Esperado:** el catálogo coincide con el de staging, salvo la deriva aceptada y los objetos de otros productos. La clave anónima no alcanza ninguna relación.
- **Confirma además:** que no queda la política `master read allowed_emails`, que sólo existía en producción y la reconciliación borra (`reconcile-drift.sql`, línea 77).

### 11. Medición de dos consultorios

1. `node scripts/production-capacity.mjs integrity` y `report`, antes de la carga.
2. Cargar el secreto de la medición, sin imprimirlo:
   `gh secret set CITA_PRODUCTION_CAPACITY_SECRET --repo Juan4787/cita-suite-verificacion < ~/.config/cita-suite/production/capacity-secret`.
3. En esta máquina, durante toda la carga:
   - `node scripts/instance-sampler.mjs production 80 <etiqueta>`;
   - `node scripts/tail-metrics.mjs production <12 hex> 80 requests`.
4. `gh workflow run production-measurement.yml --repo Juan4787/cita-suite-verificacion --ref refactor/maintainability-20261015`. Son tres repeticiones de 12 minutos y la fase pública.
5. Descargar el artefacto `production-measure-<corrida>`.
6. `production-capacity.mjs report` e `integrity`, después de la carga.
7. `node scripts/attribute-pauses.mjs .verification/instance-samples-production-<etiqueta>.jsonl .verification/production-tail-<12 hex>.jsonl`.

- **Criterio de la decisión del 20 de octubre:**
  - lecturas p95 < 1 s y p99 < 2 s;
  - escrituras p95 < 1,5 s y p99 < 3 s;
  - errores técnicos < 1 %;
  - integridad sin cruces ni superposiciones.
- **Si no se cumple por un límite del proveedor:** es un impedimento para abrir a clientes reales. Se informa con la atribución medida y las alternativas, y no se rebaja el criterio.

### 12. Limpieza de la medición

```bash
node scripts/release-smoke.mjs production cleanup
node scripts/production-capacity.mjs cleanup
gh secret delete CITA_PRODUCTION_CAPACITY_SECRET --repo Juan4787/cita-suite-verificacion
rm ~/.config/cita-suite/production/capacity-secret
```

- **El orden importa:** la limpieza de capacidad se niega mientras `capacity-01` tenga documentos (`CAPACITY_CLEANUP_HAS_DOCUMENTS`). Antes corre la de la prueba de humo, que espera el `cleanupAfter` de la última corrida: dos horas y cuarto después de su subida.
- **Esperado:** la prueba de humo deja los contadores del consultorio en cero, y los globales se mueven igual que los del consultorio. La limpieza de capacidad informa cero consultorios y cero dueños `capacity-` restantes.

### 13. Natalia

1. El usuario publica, o autoriza publicar, los archivos exactos de `.verification/natalia-production` en `natalia-frutos.vercel.app`.
2. `node scripts/verify-production-release.mjs "$D" --natalia` debe aprobar, archivo por archivo.

### 14. Repositorio e identidad

Con los disparadores desconectados, la revisión publicada llega a `main` y se aplica la transición de [identidad-cita-suite.md](identidad-cita-suite.md). Sólo se reconectan los disparadores revisados.

## Reversión

1. **Detener primero el programador nuevo:**
   `node scripts/deploy-production-workers.mjs scheduler-without-crons`, y después `node scripts/deploy-staging-workers.mjs scheduler` para devolverle los cron a staging.
2. **Volver a la versión anterior de `app`:**
   `pnpm --filter web exec wrangler rollback 9b2df65c-f89c-4940-a625-4d7b3e5858f2 --name app --message "<motivo>" --yes`. Sintaxis comprobada con `wrangler rollback --help` de la versión fijada.
   - **Después de la tanda 1:** es compatible. La versión anterior no usa nada de lo que la reconciliación retira y ya funcionaba con las 27 migraciones.
   - **Después de la tanda 2:** la versión anterior pierde las operaciones que escribían directamente: el alta de pacientes, las prestaciones, las asignaciones, los profesionales y las excepciones. Antes de volver a ella habría que devolver esas escrituras con una migración nueva, nunca deshaciendo la anterior.
3. **Entradas viejas:** volver a encenderlas sólo si hace falta (`production-legacy-jobs.mjs on`). El programador anterior está deshabilitado y no se reactiva sin decisión del usuario.
4. **Base:** las migraciones no se deshacen destructivamente. Restaurar el respaldo es para un desastre, no para una reversión, porque perdería las escrituras posteriores.
5. **Datos sintéticos:** si la publicación se interrumpe con consultorios sintéticos en producción, se quitan en este orden:
   - `release-smoke.mjs production cleanup`, cuando venzan sus URL de carga;
   - `production-capacity.mjs cleanup`;
   - `production-device-push.mjs cleanup <corrida>`.

## Pendiente del usuario

- **Antes de cualquier paso de producción:** las condiciones previas 1, 2 y 3.
- **Antes de abrir a clientes reales:**
  - el plan de Supabase, con la medición del paso 11;
  - el correo transaccional, porque el restablecimiento de contraseña necesita SMTP propio;
  - el destino privado de los respaldos de datos reales.
