# Verificación reproducible

El [plan aprobado](../plans/refactorizacion-cita-suite.md) fija los criterios; el [registro](../plans/registro-refactorizacion-cita-suite.md) indica cuáles fueron demostrados. La existencia de un comando o una configuración no acredita su ejecución.

## Comandos

| Comando | Alcance exigido |
|---|---|
| `pnpm verify:fast` | Integridad del plan, inventario, tipos compartidos/Svelte/Natalia, **tipos de las pruebas de navegador** (`browser-test-types`), pruebas del propio verificador, dependencias y unidades de servidor/cliente. |
| `pnpm verify:full` | Lo anterior; reapertura nativa del Excel exportado en LibreOffice, compilación estática de Natalia, reconstrucción SQL, todas las suites SQL y carreras, GoTrue/PostgREST/Storage reales, navegador, reserva nativa de Natalia y perfil demo separado. |
| `pnpm verify:release` | Exige el release de la misma revisión, el baseline distinto identificado y las claves de staging. Ejecuta el nivel completo; después, toda la suite de navegador sobre el artefacto candidato y sobre el baseline con el esquema actual; al final comprueba staging. No compila ni despliega. |

Se utiliza Node fijado en `.node-version`, pnpm fijado en `package.json` y el lockfile. Todas las suites, compilaciones y navegadores se ejecutan secuencialmente, con un único trabajador. Las dos conexiones de una carrera SQL pertenecen a un solo escenario controlado; no habilitan suites paralelas. `verify:full`, `verify:release`, la demo y los diagnósticos de navegador sólo arrancan en un runner estándar hospedado de GitHub con recursos comprobados. La ejecución local de esos recorridos quedó deshabilitada después de medir agotamiento de RAM y swap. `verify:fast` comprueba la memoria disponible antes de cada proceso.

## Recursos locales

`test-booking-foundation.mjs` crea exclusivamente un PostgreSQL propio, sin puertos públicos, y aplica las migraciones ordenadas desde cero. No acepta una URL remota ni reutiliza una base existente. Las imágenes están fijadas y deben estar instaladas previamente:

- `public.ecr.aws/supabase/postgres:17.6.1.166`
- `public.ecr.aws/supabase/storage-api:v1.70.3`
- `public.ecr.aws/supabase/postgrest:v16.1`
- `public.ecr.aws/supabase/gotrue:v2.196.0`

No se descargan imágenes grandes implícitamente. La configuración local mantiene PostgreSQL en 384 MB y una CPU; no ejecuta los escenarios pesados de capacidad. No se detienen contenedores de otros proyectos.

PostgREST entra como `authenticator` y expone sólo `public`, como en Supabase alojado. Las sesiones de `authenticator` precargan `safeupdate`, que rechaza un `UPDATE` o `DELETE` sin `WHERE` también dentro de las funciones que una petición llama. Hasta el 20 de octubre el entorno descartable se conectaba como `supabase_admin` y exponía `private`, y por eso no detectó la reconciliación de almacenamiento que falló en staging. Las suites SQL se conectan directamente, sin ese guardia: `supabase/tests/hosted_request_guards.sql` lo carga, comprueba que esté activo y llama como `service_role` a las entradas de base de las tareas programadas. `apps/web/e2e/scheduled-jobs.spec.ts` ejecuta las seis categorías por su ruta real.

GoTrue crea las identidades sintéticas por su API y realiza login real. Antes del navegador se comprueban identidad, rol y membresía con RLS. Storage transfiere archivos reales en el entorno descartable. Las pruebas SQL que usan claims configuradas en una conexión se distinguen de ese Auth HTTP real.

El presupuesto de conexiones de este stack pequeño está centralizado en `scripts/lib/fixture-database-budget.mjs`: máximo 12, tres reservadas, Auth 2, Storage 2, REST 2 y listener 1, administración 2. Ningún pool puede quedar en cero (ilimitado). Se conservan los límites de memoria. Tras generar tipos se ejercitan 240 lecturas HTTP reales con hasta cuatro en vuelo; el recibo `service-connections.json` separa servicios y no contiene credenciales. Es una prueba acotada de integración, sin reintentos; no sustituye los escenarios de capacidad.

Al terminar se conserva `platform-state.json` antes de limpiar. Incluye estado/OOM/uso de contenedores y conexiones agrupadas, sin texto SQL ni env. Los errores Auth se conservan como SQLSTATE/categorías, nunca cuerpos o logs crudos. Un error de infraestructura, SQL, OOM o diagnóstico ausente rechaza la corrida aunque el navegador haya aprobado. El fixture no levanta Realtime: su validación de transporte y revocación entre sesiones sigue correspondiendo al staging real; el 404 de ese servicio ausente no acredita una falla de producción.

## Exclusión, limpieza y recibos

Un lease por checkout identifica PID, raíz canónica y nonce. Los ejecutores hijos heredan esa autorización. Una segunda verificación independiente es rechazada. Si el dueño murió, se debe comprobar primero su PID y sus recursos antes de retirar el lease; no hay recuperación automática que pueda borrar trabajo todavía activo.

Contenedores y redes incluyen el identificador aleatorio de la corrida. La limpieza comprueba las etiquetas antes de borrar y propaga sus fallos. Los archivos temporales se separan por checkout. Las capturas E2E se escriben en la salida de Playwright, sin sobrescribir capturas históricas.

Los recibos actuales están en `.verification/fast.json`, `full.json` y `release.json`. Se escriben como fallidos al inicio y se reemplazan atómicamente después de cada paso; sólo el cierre completo establece `ok: true`. Las nuevas corridas también conservan su recibo en `.verification/runs/<id>/result.json`. La integración/navegador guarda evidencia bajo esa corrida; `latest-integration.json` indica su directorio. No confundir un recibo anterior con el proceso actual.

Se rechazan suites vacías, omitidas, interrumpidas, fallidas o que sólo aprueban con reintentos. Las pruebas del ejecutor introducen importaciones prohibidas y fallos deliberados en procesos descartables; comprueban rechazo, cancelación y exclusión reales. No modifican código de producción para efectuar esas comprobaciones.

## Diagnóstico y límites

`node scripts/run-campaign-integration.mjs --grep '<patrón>'` prepara un entorno nuevo y ejecuta una selección. Omite expresamente las suites SQL y marca `sqlVerified: false`. Su recibo y sus resultados son diagnósticos: **no cuentan como `verify:full`**. El modo completo rechaza un recibo que no acredite SQL.

La demo usa un servidor y archivo de datos propios. Los perfiles funcionales pueden limpiar intentos sintéticos de su propio consultorio entre recorridos independientes; los límites se mantienen dentro de cada recorrido y durante toda medición de carga. No se usan encabezados falsos ni se alteran umbrales para mejorar resultados.

El perfil local excluye los dos recorridos que dependen de cuentas Google externas. Sus contratos/proveedores tienen pruebas separadas, pero el login Google real no se considera aprobado por sustitución. La reserva nativa de Natalia y la integración embebida compatible tienen perfiles explícitos: Natalia no usa el embed para su navegación actual.

La comparación de Natalia (`measure-natalia-baseline.mjs`) construye la versión de referencia `c0129e4` y la candidata con las mismas herramientas, y mide doce cargas frías. Exige que no haya hidratación nueva y que el JavaScript de la candidata sea idéntico al de la referencia, salvo los cambios declarados en `scripts/lib/natalia-declared-changes.json`. Cada declaración lleva su motivo y los artefactos exactos de ambas versiones: nombre, bytes y SHA-256. Cualquier otro cambio, o una declaración que ya no coincide con la referencia, hace fallar la comparación. Un cambio deliberado de Natalia se declara en el mismo lote que lo introduce, con las huellas medidas por el full.

## Release y staging

**El release se compila una sola vez.** Lo arma `scripts/package-release-artifact.mjs`, en la operación `artifact` del workflow de staging. Contiene:
- el paquete de Cloudflare de la app con la configuración de staging y con la de producción: el mismo código, sólo cambia la configuración;
- el sitio de Natalia para cada entorno (`.verification/natalia-staging` y `.verification/natalia-production`), cada uno enlazado al turnero y a la integración de su entorno;
- un manifiesto con tamaño y SHA-256 de cada archivo.

Los despliegues de staging y producción y la verificación usan esos archivos exactos, nunca una compilación nueva. `loadBuildArtifact` rechaza un paquete que no coincide con su manifiesto o que contiene enlaces simbólicos, y `nataliaSite`, un sitio de Natalia que reserva en otro entorno.

**`verify:release`** corre en el workflow de verificación con `level=release`, `artifact_run` (la corrida que empaquetó esa revisión) y `rollback_run` (un empaquetado anterior aprobado, distinto, de la base de reversión):
1. **Preflight.** Rechaza, antes de cualquier trabajo, un release de otra revisión, claves de otro proyecto o rol, los dominios de producción conocidos y el proyecto configurado en `.env`. No imprime las claves.
2. **Nivel completo** sobre la revisión.
3. **Recorridos sobre el artefacto** (`run-campaign-integration.mjs --artifact=<release>`). La suite de navegador completa y la reserva nativa desde Natalia corren contra el paquete de producción del release, servido por workerd (`wrangler dev --local`) con los servicios reales descartables. Antes de abrir el navegador se comprueba que workerd sirve la revisión del release. Las suites SQL ya corrieron en el paso anterior.
4. **Compatibilidad de reversión** (`run-campaign-integration.mjs --rollback-artifact=<baseline>`). Descarga el paquete de `rollback_run` por su SHA comprobado en la API de Actions; exige empaquetado terminado con éxito. Ejecuta toda la suite actual de navegador contra ese binario anterior y la base descartable con todas las migraciones actuales, incluida la contracción. `integration-artifact.mjs` rechaza una revisión no identificada, la propia candidata usada como baseline y cualquier baseline usado para certificar la candidata. La evidencia queda en `integration-rollback`, con su revisión y propósito explícitos. Este paso no restaura permisos ni reconstruye el binario anterior. Si falla, la reversión no está demostrada.
5. **Staging desplegado** (`verify-campaign-staging.mjs`):
   - la app sirve la revisión y cada archivo de `_app/immutable` del release;
   - el login responde y una ruta privada redirige al login;
   - la CSP de la página admite exactamente el proyecto Supabase de staging, su WebSocket y sus imágenes, sin el comodín `*.supabase.co` (`assertSupabaseOrigin`);
   - la copia de Natalia (`natalia-frutos-staging`) sirve cada archivo de su sitio;
   - la clave anónima no alcanza ninguna relación de la API alojada (`probeAnonymousExposure`);
   - un navegador reserva desde la copia de Natalia en el consultorio sintético de release, en escritorio y en móvil: navegación nativa, recuperación sin duplicar, comprobante anterior compatible y cancelación desde la gestión del turno.

**Consultorio de release.** Es fijo y sintético, y se asegura con la operación `release-fixture` (`scripts/staging-release-fixture.mjs`). Si su configuración se desvía, el release falla, no se repara en silencio. Las reservas canceladas quedan en staging, cada una con un teléfono sintético nuevo.

**Diagnóstico sobre un paquete.** `level=browser` con `artifact_run` ejecuta la selección contra el paquete descargado, igual que el paso 3. Es diagnóstico y no reemplaza al release.

**Ensayo del retorno alojado.** `level=rollback`, `rollback_run=<empaquetado-anterior-aprobado>`, ejecuta `verify-campaign-staging.mjs --rollback` exclusivamente en CI. Se usa después de devolver staging al baseline: comprueba su versión y bytes exactos, CSP, clave anónima y las dos reservas nativas desde Natalia con lectura persistida, recuperación y cancelación. Usa sólo claves de staging y no levanta otra base. El recibo `staging-rollback.json` identifica separadamente el SHA del verificador y el binario anterior; no reemplaza a `verify:release`. Restaurar luego la candidata exacta antes del release.

Los puntos de entrada directos `qa-natalia-direct-booking.mjs` y `verify-campaign-staging.mjs` rechazan la ejecución local antes de cargar el navegador o consultar el entorno. La restricción de RAM no depende sólo de invocarlos desde el comando raíz.

**Advertencias del fixture Realtime.** `render-health.ts` reconoce sólo los mensajes exactos de handshake 404 o cierre durante conexión al WebSocket loopback propio, en `disposable`. Una cancelación exige observar además `WebSocket.close()` nativo en CONNECTING en esa misma corrida. No cambia el transporte ni certifica Realtime alojado. `render-health.spec.ts` reproduce el cierre nativo y rechaza un mensaje sin cierre observado; `realtime-diagnostics.test.mjs` rechaza entornos, destinos y errores ajenos. La corrida 39859031404 (`48b1c20`, artefacto 39858722802) aprobó los tres casos: profesional real, reproducción nativa sin app/SDK y rechazo del mensaje sin cierre observado. Evidencia `.verification/remote-39859031404/`; no sustituye el release completo ni prueba Realtime alojado.

**Después de publicar.** Las comprobaciones de staging y producción comparten `scripts/lib/served-release.mjs` (revisión, login, redirección privada, archivos por SHA-256 y CSP). En producción las corre `verify-production-release.mjs`. La reserva pública y un documento clínico de ida y vuelta las prueba `release-smoke.mjs staging|production` sobre el consultorio sintético `capacity-01`; su limpieza espera a que venzan las URL de carga, porque Storage vuelve a reservar 5 MB mientras una URL siga vigente. El orden y los comandos están en [publicación y reversión](publicacion-y-reversion.md).

**Límites de la preparación.** Las imágenes, el navegador y LibreOffice tienen límite propio (15, 20 y 10 minutos). El 22 de octubre un `apt-get` colgado retuvo 25 minutos una corrida que antes tardaba 19 s en ese paso. Un espejo trabado falla ahí y no consume el límite del trabajo.

El workflow de GitHub fija acciones por SHA y comprueba recursos antes de levantar servicios. Su presencia local no acredita una corrida hospedada. Tampoco una prueba en contenedores acredita capacidad de Supabase alojado o límites reales de Cloudflare. Esas evidencias siguen sus criterios propios y deben adjuntarse antes del cierre de campaña.

`prepare-ci-services.mjs` deja un recibo de preparación desde el inicio. Las imágenes fijadas se descargan de una en una; sólo fallos transitorios admiten hasta cuatro reintentos con espera creciente. Un rechazo persistente o un tag inexistente detiene la corrida antes de las pruebas. El recibo de preparación nunca equivale a aprobación de la aplicación.

Ante el agotamiento de transferencia de ECR en runners compartidos, la descarga usa los repositorios oficiales de Docker Hub con digest inmutable. Se comprobó que los cuatro manifiestos de servicios son idénticos a los de la corrida ECR aprobada; PostgREST se obtiene de su editor `postgrest/postgrest`. Las etiquetas locales ECR son alias de esas mismas imágenes. El recibo guarda referencia, origen, manifiesto e identificador de contenido; no se cambia de versión para eludir una falla.

## Tipos de la base reconstruida

`generate-database-types.mjs` usa `postgres-meta:v0.98.0`, el generador de la [CLI Supabase 2.115.0 fijada](https://github.com/supabase/cli/blob/v2.115.0/apps/cli/src/legacy/commands/gen/types/types.handler.ts), sobre la red interna de la base propia. Exige recibo y etiquetas de propiedad, no acepta una URL, proyecto vinculado ni credenciales remotas, y no descarga imágenes implícitamente. Genera dos veces y exige igualdad exacta antes de exportar, comprobar o reemplazar atómicamente el archivo.

El comando `pnpm supabase:types` exige esa base reconstruida en CI; ya no redirige la salida de un proceso a un archivo que podría quedar truncado si falla. `--check` detecta deriva frente a las migraciones. Durante el primer arranque de la etapa 2 se utiliza `--export` para recuperar el contrato generado; esa excepción tiene como responsable a la campaña y se elimina al incorporar el archivo inicial, antes de cerrar la etapa.

La campaña usa temporalmente `Juan4787/cita-suite-verificacion`, un repositorio público auxiliar sin conexión de despliegue ni credenciales de producción, con runners estándar gratuitos. Al inicio se conservó su integraciónCloudflare. El23-oct elusuario acreditó su desconexión de Buildsapp ydelGit delVercelviejo para publicar sólo paquetes exactos; el Workerapp sigue alojado enCloudflare. La fuente canónica actual es `0851de59ed7971debe2514e6d6851d142bbc5766`, con release40096001763 aprobado20/20 y44/44×3. Incluye los tres archivos de informes previamente comprobados por fast40094512375 y el arreglo de avisos inactivos, reproducido en rojo40095320426 y verde40095543973. La fuenteCB y su release40075434652 se conservan como antecedentes; su carga productiva fallida no cambia por aprobar otro release. `prepare-ci-snapshot.mjs` prepara una copia del código necesario mediante un índice independiente: no cambia el índice, la rama ni los archivos del usuario. Excluye adjuntos, archivos `.env`, evidencias y documentos ajenos; registra huellas y contenido exacto en `.verification/ci-source.json`.

Los resultados y capturas sintéticos se empaquetan con tamaño acotado y SHA-256 en los logs del workflow. No se habilita almacenamiento facturable de artifacts ni cachés. Los logs no consumen la cuota de artifacts según la [documentación de GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Tras descargar el ZIP de logs, `python3 scripts/collect-verification-evidence.py <logs.zip> <directorio-nuevo>` comprueba integridad y rutas antes de recuperar la evidencia; no sobrescribe resultados anteriores.

El release conserva por separado los tres perfiles de la reserva nativa: desarrollo, artefacto candidato y artefacto de reversión, cada uno bajo su `runs/<corrida>/<perfil>/native-booking/`. No comparten capturas ni resultados. El presupuesto de evidencia es de 48 MiB extraídos, 24 MiB comprimidos y 2.000 archivos; el colector admite ZIP y miembros de logs de hasta 64 MiB por la codificación base64 y la duplicación de logs de job/paso. Superar cualquier tope falla, sin omitir archivos. Estas cotas de transporte se ampliaron por el tercer perfil obligatorio; no cambian criterios funcionales ni retención. Las pruebas preservan 36 MiB repartidos entre perfiles y siguen rechazando 49 MiB, corrupción, rutas fuera de alcance y sobrescritura.

`python3 scripts/test-verification-evidence.py` comprueba el circuito completo con archivos descartables: conserva el estado fallido, oculta tokens, rechaza alteraciones y rutas que escapan del destino, y no sobrescribe evidencia anterior. Está incluido en la verificación rápida.


### Generación independiente al cambiar migraciones

El perfil manual `types` del workflow prepara exclusivamente la base/Storage descartables, reconstruye todas las migraciones y exporta dos generaciones idénticas. No depende de que la aplicación anterior compile contra un esquema nuevo: permite revisar e incorporar los tipos antes de ejecutar `verify:full`, que continúa exigiendo `--check`. No omite ese control ni permite reemplazarlo por una conversión.

El recibo `.verification/type-generation.json` identifica expresamente `types-generation-only` y `fullVerification: false`; las suites SQL, Auth y navegador no se consideran ejecutadas. El perfil no usa proyectos vinculados, contraseñas remotas ni datos reales. Al terminar o interrumpirse limpia únicamente contenedores con las dos etiquetas de propiedad correctas y redes internas con el identificador exacto de corrida; un fallo de limpieza hace fallar el recibo.

El perfil diagnóstico `sql` utiliza el mismo ejecutor con `--verify-sql`: aplica todas las migraciones, ensayos de actualización, suites SQL y carreras antes de exportar tipos. Conserva `kind: sql-and-types-generation-only`, `sqlVerified: true` sólo al completarlas, y `fullVerification: false`. Permite corregir SQL sin repetir navegador/unidades sin cambios; no sustituye la corrida full final. Sigue siendo exclusivo de CI, secuencial y descartable.

La generación independiente y las comparaciones completas posteriores fueron ejecutadas; el registro identifica revisiones y recibos. No se conserva una excepción que permita aprobar con tipos diferentes.


### Preparación del staging identificado

Destino autorizado: `ikaudqoilclfnztkxubz` (nombre actual **Staging 455**, región `us-west-2`). La sesión habitual accede como Developer; no se eleva a Owner/Admin. Producción sigue siendo `yjzferwuzbtgpmdnzlcb`, región `sa-east-1`. Esa diferencia regional deberá quedar explícita al medir el comportamiento alojado; no se trasladan datos para ocultarla.

Las conexiones de staging se guardan con permisos 0600 en `~/.config/cita-suite/staging/`, fuera del proyecto, y se suministran explícitamente. No se toma `SUPABASE_DB_URL` ni el vínculo CLI predeterminado. La línea de staging que el usuario agregó a `.env` se trasladó a esa configuración privada conservando los demás bytes del archivo. Ninguna credencial se copia al código, al snapshot ni a evidencia.

El workflow manual `staging-connectivity.yml` ejecuta sólo una inspección SQL de lectura en el proyecto exacto autorizado, con `default_transaction_read_only=on`, tiempo acotado y sin imprimir cadenas o errores del driver. Comparte exclusión con las verificaciones de campaña. El único secreto configurado en el repositorio auxiliar es `CITA_STAGING_DATABASE_URL`, exclusivo de ese staging. Este workflow no aplica migraciones, despliega, carga datos ni acredita capacidad o release.

### Despliegue y medición de tareas en staging

El workflow manual `staging-operations.yml` comparte la misma exclusión y sólo opera sobre ese staging:

- `artifact` construye la app para Cloudflare con `CITA_BUILD_VERSION` igual al commit del snapshot y la empaqueta con `wrangler deploy --dry-run --config wrangler.staging.jsonc`, sin desplegar. Publica el empaquetado, la salida de SvelteKit y un manifiesto con tamaño y SHA-256 de cada archivo, con retención de tres días.
- `migrations` aplica las migraciones versionadas en orden (`scripts/apply-staging-migrations.mjs`). Exige que la historia remota sea un prefijo de la local y deja un recibo con el hash de cada archivo.
- `queue-seed`, `queue-report` y `queue-cleanup` operan una corrida del escenario de colas del plan (`scripts/staging-queue-scenario.mjs`): 25 consultorios sintéticos con cinco recordatorios y uno con 150 que vencen primero, contra el receptor push sintético del proyecto de staging. Todo pertenece a la corrida por slug y endpoint, y la limpieza comprueba que no quede nada suyo. `queue-seed-abandoned` siembra el mismo escenario con todas sus reclamaciones vencidas, para demostrar su recuperación.
- `device-seed`, `device-report` y `device-cleanup` operan la prueba de Web Push en un teléfono real (`scripts/staging-device-push.mjs`): un consultorio sintético con un turno cuyo recordatorio vence en la siguiente ejecución de push. El enlace de gestión se lee sólo en la máquina local (`link`), nunca en un log público, y la persona activa las notificaciones en el teléfono.
- `capacity-seed`, `capacity-measure` y `capacity-cleanup` operan el ensayo alojado de 5 consultorios (`scripts/staging-capacity.mjs`, ver [capacidad](capacidad.md)): la misma siembra, los mismos usuarios virtuales, la reserva pública y el abuso contra el Worker de staging, y la limpieza que cada escenario de CI ensaya antes sobre sus propios datos.

El despliegue se hace en la máquina local con la sesión de Wrangler de la cuenta esperada, sin compilar: `node scripts/deploy-staging-workers.mjs app <artefacto descargado>` sube el empaquetado tal cual. Antes rechaza un artefacto que no coincida exactamente con su manifiesto, una configuración que no sea la del Worker `cita-suite-staging` (nombre, cuenta, proyecto Supabase, sin rutas ni crons), claves de Supabase de otro proyecto o rol y un directorio de assets que publique el bundle del servidor. Después comprueba que staging sirva la revisión. `node scripts/deploy-staging-workers.mjs scheduler` despliega `cita-suite-scheduler-staging` sólo si sus fuentes coinciden con el último snapshot verificado. Los secretos se leen de `~/.config/cita-suite/staging/` y viajan en un archivo temporal 0600 que se borra al terminar. `scripts/lib/staging-deploy.test.mjs` prueba esos rechazos.

`node scripts/tail-metrics.mjs staging|production <corrida> <minutos> [jobs|requests]` observa, en sólo lectura y durante un tiempo acotado, el Worker de la app del destino indicado: `cita-suite-staging` o `app`. Conserva sólo resultado, CPU y tiempo total cuando la plataforma los informa. Con `jobs` (por omisión) guarda la ruta de cada tarea y su registro de conteos; con `requests`, cada pedido por método y plantilla de ruta, sin identificadores, claves ni enlaces. Escribe `.verification/<destino>-tail-<corrida>.jsonl` y su resumen `-summary.json`. Encabezados, consultas, otros registros y otro tráfico se descartan al llegar (`scripts/lib/worker-tail.test.mjs`). Hasta el 22 de octubre se llamaba `staging-tail-metrics.mjs` y sólo observaba staging; las evidencias anteriores conservan ese nombre.


## Unidades sin omisiones y apertura nativa de exportaciones

`run-campaign-unit-tests.mjs` ejecuta los perfiles completos `server` y `client` con un trabajador, cero reintentos y `.only` prohibido. Conserva el reporte JSON en la corrida y lo contrasta con sus resultados individuales: un código de salida cero no alcanza si hubo casos omitidos, pendientes, interrumpidos o contadores incompatibles. Las pruebas deliberadas de `unit-report.test.mjs` comprueban ese rechazo.

La apertura nativa de XLSX se clasifica como integración, no como unidad portable opcional. Todos los archivos `src/**/*.office.test.ts` se ejecutan obligatoriamente en `verify:full`/`verify:release` mediante el perfil `office`. No hay `runIf` por disponibilidad del ejecutable. El entorno alojado instala LibreOffice Calc `4:24.2.7-0ubuntu0.24.04.7`, registra versiones de Calc/core/common y SHA-256 de `soffice.bin` en `office-toolchain.log`, y usa un perfil temporal exclusivo. Su ausencia, fallo, timeout o falta de pruebas rechaza la verificación. No se instala ni ejecuta esta dependencia pesada en la máquina local.


### Controles del propio ejecutor

El perfil Node descubre todos los archivos `scripts/lib/*.test.mjs` y usa un solo proceso de pruebas a la vez. Conserva eventos `test:summary` por archivo y el acumulado final, según la API de Node 22.23.2 fijada. Exige que cada archivo contenga pruebas efectivas y que el total coincida, sin omisiones, cancelaciones, pendientes ni fallos. Una terminación exitosa del proceso no sustituye ese recibo; una interrupción o reporte incompleto falla. El recibo no incorpora stdout ni detalles de error de las pruebas; TAP conserva el diagnóstico separado. El registro identifica sus ejecuciones reales y las adversarias añadidas posteriormente. Referencia: https://nodejs.org/download/release/v22.23.2/docs/api/test.html#event-testsummary .

## Diagnóstico de navegador sin fabricar una verificación completa

El workflow manual aislado admite `level=browser` con `browser_grep`. Invoca el diagnóstico ya existente `run-campaign-integration.mjs --grep`: reconstruye el entorno descartable con servicios reales y exige pruebas seleccionadas efectivas, sin retries, pero no certifica full, SQL completo, demo, Natalia ni release. Su recibo marca `diagnostic=true` y no sustituye `verify:full`.

```bash
gh workflow run 386107045 --repo Juan4787/cita-suite-verificacion --ref refactor/maintainability-20261015 -f level=browser -f 'browser_grep=isolated booking integration|patient structure|roles, profesionales'
```

El diagnóstico ejecuta **todos** los casos seleccionados aunque uno falle (sin `--max-failures=1`), para reunir fallos independientes en una sola corrida; cualquier fallo sigue rechazándolo. Full, demo y staging conservan la detención en el primer fallo.

Usarlo para diagnosticar un fallo ya localizado cuando tipos/unidades/SQL pertinentes tienen evidencia propia; después ejecutar full de la revisión final. El caso que depende de preparación de otra prueba requiere esa preparación explícita o seleccionar su grupo completo; no atribuir un fallo de fixture al producto ni convertir una suite vacía en éxito. Mismas restricciones de RAM/destinos/limpieza: exclusivamente CI externo, servicios propios, un trabajador, un proceso pesado por vez. La entrada no despliega, no recibe credenciales de producción ni introduce omisiones en fast/full/release.

## Tipos de las pruebas de navegador

`svelte-check` sólo incluye `src/`. Playwright transpila los specs sin comprobar tipos, de modo que un error de tipos en un fixture (columna inexistente, lectura que ignora `error`, id nulo enviado a un filtro) podía ejecutarse sin advertencia. `apps/web/e2e/tsconfig.json` y el script `pnpm --filter web check:e2e` tipan todos los specs y helpers; el paso `browser-test-types` lo exige en fast/full/release. Se comprobó que un error inyectado lo hace fallar.

Los fixtures usan `e2e/helpers/fixture-db.ts`: cliente de servicio tipado con `CitaDatabase`, `must()` exige fila (un error o `null` fallan) y `write()` cubre escrituras y limpiezas, cuyos errores nunca se ignoran. Los mensajes sólo exponen SQLSTATE. No se usan `any`, `as unknown as` ni aserciones para silenciar el contrato: los JSON se comprueban con `toMatchObject` y los globales del host aislado están declarados en `e2e/helpers/booking-harness.d.ts`.

## Contrato de usabilidad de layout

La ausencia de desbordamiento no demuestra que una pantalla sea legible. `app.css` declara `overflow-wrap: anywhere` en `body`, `.ux-btn*` y `.ux-badge*` para que nombres largos nunca ensanchen la página. Esa regla reduce el ancho mínimo de cualquier texto a un carácter: una columna flex/grid puede comprimir un botón, un badge o un título hasta letras sueltas sin desbordar el documento. Así pasaron cuatro defectos de etapa 5 por un full aprobado.

`e2e/helpers/layout-usability.ts` (`layoutIssues`/`expectUsableLayout`) es el contrato común de las matrices visuales: zoom permitido, sin desbordamiento horizontal, controles operables dentro del viewport con ancho útil (no las fuentes nativas invisibles `.ux-native-source`), sin overlay del framework y texto legible (`textIssues`): **ninguna palabra ordinaria (hasta 20 caracteres) partida entre líneas**, **ninguna etiqueta corta de botón, enlace-botón o badge (hasta 200 px de texto) partida en varias líneas**, **ningún número separado de su unidad o importe** (minutos, horas, años, %, $) **ni contador partido** («Paso 3 de 5»), **ningún «·» colgado al final de una línea** y **ningún texto del contenido de la tarea (`main` o diálogos) cortado con «…»**. Los disparadores de selector `.ux-control-trigger` muestran un valor elegido, no una acción: lo ajustan en varias líneas en vez de truncarlo. Cabecera y navegación pueden acortar nombres que la página muestra completos, y una excepción revisada se marca con `data-truncation="allowed"`. Tokens más largos (correos, URLs, nombres sintéticos extremos), cortes en guiones o barras, texto oculto, sr-only u opacidad 0 y opciones nativas no se informan. Las matrices acumulan los problemas de todas las combinaciones y los afirman una vez, para que un fallo nombre todos los anchos, temas y roles afectados.

`e2e/layout-usability.spec.ts` reproduce los mecanismos reales con la misma regla (palabras partidas por columnas comprimidas, «Quitar bloque» en dos líneas, «30 / minutos», «$ / 20.000», «Paso 3 de / 5 · Día», «·» al final de línea, opción truncada) y casos legítimos de cada clase: si el detector dejara de detectarlos, esa prueba falla. Las duraciones usan `formatDuration` y los contadores de pasos `formatStepCounter` (`lib/utils/format.ts`), que unen número y unidad, o «Paso N de M», con espacios duros. El «·» se une con espacio duro al grupo que introduce (`·&nbsp;`), para que el corte caiga antes del separador. Unir el texto no alcanza cuando la fila no tiene lugar: el `overflow-wrap: anywhere` global parte igual el bloque unido. Al diseñar un layout nuevo con texto junto a acciones o estados, usar `min-w-0` en la columna flexible y `shrink-0` (o grid) en los grupos de acciones y estados; si a 320 no entran en una fila, apilar la acción debajo de `sm`. Cubrir la pantalla con `layoutIssues` en los anchos del plan.

Las capturas de evidencia usan `alignTaskForCapture` (`e2e/helpers/task-capture.ts`): desplazan la tarea evaluada debajo del encabezado fijo y exigen que esté en pantalla. Una captura que muestra otra parte de la página no certifica la tarea, aunque las aserciones del caso hayan aprobado.


## Sesiones en las pruebas de navegador

El ingreso con contraseña conserva sus límites reales también en el entorno descartable: 5 intentos por correo y 40 por IP cada 15 minutos (`loginPasswordRateLimitRules`). Toda la suite sale de una sola IP local. Un spec con varios casos sobre la misma identidad debe usar `loginWithSharedSession` (`e2e/helpers/shared-auth.ts`), que inicia sesión una vez y restaura cookies en memoria. No se desactiva ni se eluden los límites con encabezados falsos. Una pantalla de «demasiados intentos» en una corrida es un error del arnés (ingresos repetidos), no un permiso para relajar la protección.

Los controles que requieren JavaScript quedan deshabilitados hasta hidratar (`createClientReadiness`). Las pruebas hacen un único clic, porque Playwright espera a que el control esté habilitado, y después verifican su efecto. No se usan reintentos `toPass` alrededor de un clic: con conmutadores pueden cerrar lo que acaban de abrir y además ocultarían un primer clic perdido. Las respuestas lentas se simulan con compuertas deterministas (una promesa liberada después de verificar el estado de carga), nunca con esperas fijas.


### Peticiones autenticadas del navegador sobre el artefacto

La app compilada conserva cookies Secure. Playwright 1.60.0 filtra esas cookies de su cliente HTTP sobre `http://127.0.0.1`, mientras Chromium conserva la sesión en ese loopback. El release 39898867324 lo expuso en la comprobación de privacidad: el control positivo rechazó el HTML de login. `browser-request.ts` mueve las peticiones autenticadas de los fixtures al fetch nativo del navegador, con origen y entorno propios, sin reescribir credenciales y rechazando redirecciones. La subida firmada a Storage conserva su cliente HTTP, porque usa la firma y otro origen. La caracterización `request-transport.spec.ts` exige además contexto anónimo rechazado y destinos/redirecciones ajenos rechazados; **aprobada en 39901069118**, fuente478c096: API401/navegador200/anónimo401, redirección y otro origen rechazados; diagnóstico total44/44 sin omitidos/reintentos. El tipado del diagnóstico corre antes de preparar servicios. El release39901784288 repitió44/44 en desarrollo, candidata y baseline contra126 migraciones; no se elimina Secure para hacer verde un fixture.


## Diagnóstico dirigido de tres recorridos

`level=capacity-targeted` del workflow manual ejecuta `node scripts/run-campaign-capacity.mjs --targeted` exclusivamente en CI con recursos suficientes. Utiliza un consultorio determinista de 6.000 pacientes / 12.000 turnos; realiza ocho lecturas de disponibilidad, ocho de ficha y tres preparaciones con tres creaciones. El inspector de workerd toma tres perfiles, sin cuerpos ni credenciales. El cliente envía el Origin de su endpoint local, como exige Wrangler; no se deshabilita su protección.

El modo exige identidad y contenido correctos, persistencia propia de las tres creaciones, integridad sin cruces/superposiciones, dos rechazos deliberados del limpiador, limpieza completa y diagnóstico sano de los cuatro servicios. Un HTTP 200 con nodo de error, un perfil vacío o la falta de telemetría hacen fallar el diagnóstico. Los tiempos de fetch solapados no se llaman consultas SQL ni se restan para inferir CPU.

Es una herramienta de localización: **no aprueba capacidad alojada ni el límite de CPU Free**. Mantiene los modos y umbrales originales. No ejecutarla en este host ni contra producción; un nuevo dispatch requiere revisión exacta comprobada, exclusión mutua y motivo específico. Después de un dispatch aceptado, recuperar su único run antes de considerar otro intento. La corrida ya terminada y sus fallos están en [el informe del 25 de octubre](diagnostico-rendimiento-20261025.md); no repetirla por actualizar documentación.
