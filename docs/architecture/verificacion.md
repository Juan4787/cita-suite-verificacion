# Verificación reproducible

El [plan aprobado](../plans/refactorizacion-cita-suite.md) fija los criterios; el [registro](../plans/registro-refactorizacion-cita-suite.md) indica cuáles fueron demostrados. La existencia de un comando o una configuración no acredita su ejecución.

## Comandos

| Comando | Alcance exigido |
|---|---|
| `pnpm verify:fast` | Integridad del plan, inventario, tipos compartidos/Svelte/Natalia, pruebas del propio verificador, dependencias y unidades de servidor/cliente. |
| `pnpm verify:full` | Lo anterior; compilación estática de Natalia, reconstrucción SQL, todas las suites SQL y carreras, GoTrue/PostgREST/Storage reales, navegador, reserva nativa de Natalia y perfil demo separado. |
| `pnpm verify:release` | Exige primero un staging explícito y ajeno a producción. Ejecuta el nivel completo, construye los artefactos para ese staging y comprueba identidad/artefactos y navegador remoto. No despliega. |

Se utiliza Node fijado en `.node-version`, pnpm fijado en `package.json` y el lockfile. Todas las suites, compilaciones y navegadores se ejecutan secuencialmente, con un único trabajador. Las dos conexiones de una carrera SQL pertenecen a un solo escenario controlado; no habilitan suites paralelas. `verify:full`, `verify:release`, la demo y los diagnósticos de navegador sólo arrancan en un runner estándar hospedado de GitHub con recursos comprobados. La ejecución local de esos recorridos quedó deshabilitada después de medir agotamiento de RAM y swap. `verify:fast` comprueba la memoria disponible antes de cada proceso.

## Recursos locales

`test-booking-foundation.mjs` crea exclusivamente un PostgreSQL propio, sin puertos públicos, y aplica las migraciones ordenadas desde cero. No acepta una URL remota ni reutiliza una base existente. Las imágenes están fijadas y deben estar instaladas previamente:

- `public.ecr.aws/supabase/postgres:17.6.1.166`
- `public.ecr.aws/supabase/storage-api:v1.70.3`
- `public.ecr.aws/supabase/postgrest:v16.1`
- `public.ecr.aws/supabase/gotrue:v2.196.0`

No se descargan imágenes grandes implícitamente. La configuración local mantiene PostgreSQL en 384 MB y una CPU; no ejecuta los escenarios pesados de capacidad. No se detienen contenedores de otros proyectos.

GoTrue crea las identidades sintéticas por su API y realiza login real. Antes del navegador se comprueban identidad, rol y membresía con RLS. Storage transfiere archivos reales en el entorno descartable. Las pruebas SQL que usan claims configuradas en una conexión se distinguen de ese Auth HTTP real.

## Exclusión, limpieza y recibos

Un lease por checkout identifica PID, raíz canónica y nonce. Los ejecutores hijos heredan esa autorización. Una segunda verificación independiente es rechazada. Si el dueño murió, se debe comprobar primero su PID y sus recursos antes de retirar el lease; no hay recuperación automática que pueda borrar trabajo todavía activo.

Contenedores y redes incluyen el identificador aleatorio de la corrida. La limpieza comprueba las etiquetas antes de borrar y propaga sus fallos. Los archivos temporales se separan por checkout. Las capturas E2E se escriben en la salida de Playwright, sin sobrescribir capturas históricas.

Los recibos actuales están en `.verification/fast.json`, `full.json` y `release.json`. Se escriben como fallidos al inicio y se reemplazan atómicamente después de cada paso; sólo el cierre completo establece `ok: true`. Las nuevas corridas también conservan su recibo en `.verification/runs/<id>/result.json`. La integración/navegador guarda evidencia bajo esa corrida; `latest-integration.json` indica su directorio. No confundir un recibo anterior con el proceso actual.

Se rechazan suites vacías, omitidas, interrumpidas, fallidas o que sólo aprueban con reintentos. Las pruebas del ejecutor introducen importaciones prohibidas y fallos deliberados en procesos descartables; comprueban rechazo, cancelación y exclusión reales. No modifican código de producción para efectuar esas comprobaciones.

## Diagnóstico y límites

`node scripts/run-campaign-integration.mjs --grep '<patrón>'` prepara un entorno nuevo y ejecuta una selección. Omite expresamente las suites SQL y marca `sqlVerified: false`. Su recibo y sus resultados son diagnósticos: **no cuentan como `verify:full`**. El modo completo rechaza un recibo que no acredite SQL.

La demo usa un servidor y archivo de datos propios. Los perfiles funcionales pueden limpiar intentos sintéticos de su propio consultorio entre recorridos independientes; los límites se mantienen dentro de cada recorrido y durante toda medición de carga. No se usan encabezados falsos ni se alteran umbrales para mejorar resultados.

El perfil local excluye los dos recorridos que dependen de cuentas Google externas. Sus contratos/proveedores tienen pruebas separadas, pero el login Google real no se considera aprobado por sustitución. La reserva nativa de Natalia y la integración embebida compatible tienen perfiles explícitos: Natalia no usa el embed para su navegación actual.

## Staging y CI

`CITA_STAGING_DESCRIPTOR` apunta a un descriptor explícito con origen de Cita Suite, origen de Natalia, otro proyecto Supabase, revisión completa, integración de reserva, consultorio sintético e identidades `.test`. Las credenciales se suministran únicamente mediante variables `CITA_STAGING_*`; no se toman de `.env`. El descriptor también debe incluir las huellas de los archivos reales de Natalia al comprobar los artefactos desplegados.

El preflight rechaza los dominios de producción conocidos, el proyecto configurado en `.env`, direcciones ambiguas y una conexión SQL de otro proyecto. Natalia se construye para el origen y la integración del staging. Las sumas y la versión servida deben coincidir con los artefactos locales revisados. No se imprime el contenido de las credenciales cuando una conexión es inválida.

El workflow de GitHub fija acciones por SHA y comprueba recursos antes de levantar servicios. Su presencia local no acredita una corrida hospedada. Tampoco una prueba en contenedores acredita capacidad de Supabase alojado o límites reales de Cloudflare. Esas evidencias siguen sus criterios propios y deben adjuntarse antes del cierre de campaña.

`prepare-ci-services.mjs` deja un recibo de preparación desde el inicio. Las imágenes fijadas se descargan de una en una; sólo fallos transitorios admiten hasta cuatro reintentos con espera creciente. Un rechazo persistente o un tag inexistente detiene la corrida antes de las pruebas. El recibo de preparación nunca equivale a aprobación de la aplicación.

Ante el agotamiento de transferencia de ECR en runners compartidos, la descarga usa los repositorios oficiales de Docker Hub con digest inmutable. Se comprobó que los cuatro manifiestos de servicios son idénticos a los de la corrida ECR aprobada; PostgREST se obtiene de su editor `postgrest/postgrest`. Las etiquetas locales ECR son alias de esas mismas imágenes. El recibo guarda referencia, origen, manifiesto e identificador de contenido; no se cambia de versión para eludir una falla.

## Tipos de la base reconstruida

`generate-database-types.mjs` usa `postgres-meta:v0.98.0`, el generador de la [CLI Supabase 2.115.0 fijada](https://github.com/supabase/cli/blob/v2.115.0/apps/cli/src/legacy/commands/gen/types/types.handler.ts), sobre la red interna de la base propia. Exige recibo y etiquetas de propiedad, no acepta una URL, proyecto vinculado ni credenciales remotas, y no descarga imágenes implícitamente. Genera dos veces y exige igualdad exacta antes de exportar, comprobar o reemplazar atómicamente el archivo.

El comando `pnpm supabase:types` exige esa base reconstruida en CI; ya no redirige la salida de un proceso a un archivo que podría quedar truncado si falla. `--check` detecta deriva frente a las migraciones. Durante el primer arranque de la etapa 2 se utiliza `--export` para recuperar el contrato generado; esa excepción tiene como responsable a la campaña y se elimina al incorporar el archivo inicial, antes de cerrar la etapa.

La campaña usa temporalmente `Juan4787/cita-suite-verificacion`, un repositorio público auxiliar sin conexión de despliegue ni credenciales de producción, con runners estándar gratuitos. El repositorio original conserva su integración Cloudflare sin modificaciones. `prepare-ci-snapshot.mjs` prepara una copia del código necesario mediante un índice independiente: no cambia el índice, la rama ni los archivos del usuario. Excluye adjuntos, archivos `.env`, evidencias y documentos ajenos; registra huellas y contenido exacto en `.verification/ci-source.json`.

Los resultados y capturas sintéticos se empaquetan con tamaño acotado y SHA-256 en los logs del workflow. No se habilita almacenamiento facturable de artifacts ni cachés. Los logs no consumen la cuota de artifacts según la [documentación de GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Tras descargar el ZIP de logs, `python3 scripts/collect-verification-evidence.py <logs.zip> <directorio-nuevo>` comprueba integridad y rutas antes de recuperar la evidencia; no sobrescribe resultados anteriores.

`python3 scripts/test-verification-evidence.py` comprueba el circuito completo con archivos descartables: conserva el estado fallido, oculta tokens, rechaza alteraciones y rutas que escapan del destino, y no sobrescribe evidencia anterior. Está incluido en la verificación rápida.


### Generación independiente al cambiar migraciones

El perfil manual `types` del workflow prepara exclusivamente la base/Storage descartables, reconstruye todas las migraciones y exporta dos generaciones idénticas. No depende de que la aplicación anterior compile contra un esquema nuevo: permite revisar e incorporar los tipos antes de ejecutar `verify:full`, que continúa exigiendo `--check`. No omite ese control ni permite reemplazarlo por una conversión.

El recibo `.verification/type-generation.json` identifica expresamente `types-generation-only` y `fullVerification: false`; las suites SQL, Auth y navegador no se consideran ejecutadas. El perfil no usa proyectos vinculados, contraseñas remotas ni datos reales. Al terminar o interrumpirse limpia únicamente contenedores con las dos etiquetas de propiedad correctas y redes internas con el identificador exacto de corrida; un fallo de limpieza hace fallar el recibo.

La generación independiente todavía debe ensayarse en el workflow sobre una revisión exacta antes de considerarse comprobada. El primer arranque exportado de la etapa 2 ya fue incorporado; la comparación completa sigue pendiente de la nueva corrida full, y no se conserva una excepción que permita aprobar con tipos diferentes.


### Preparación del staging identificado

Destino autorizado: `ikaudqoilclfnztkxubz` (nombre actual **Staging 455**, región `us-west-2`). La sesión habitual accede como Developer; no se eleva a Owner/Admin. Producción sigue siendo `yjzferwuzbtgpmdnzlcb`, región `sa-east-1`. Esa diferencia regional deberá quedar explícita al medir el comportamiento alojado; no se trasladan datos para ocultarla.

Las conexiones de staging se guardan con permisos 0600 en `~/.config/cita-suite/staging/`, fuera del proyecto, y se suministran explícitamente. No se toma `SUPABASE_DB_URL` ni el vínculo CLI predeterminado. La línea de staging que el usuario agregó a `.env` se trasladó a esa configuración privada conservando los demás bytes del archivo. Ninguna credencial se copia al código, al snapshot ni a evidencia.

El workflow manual `staging-connectivity.yml` ejecuta sólo una inspección SQL de lectura en el proyecto exacto autorizado, con `default_transaction_read_only=on`, tiempo acotado y sin imprimir cadenas o errores del driver. Comparte exclusión con las verificaciones de campaña. El único secreto configurado en el repositorio auxiliar es `CITA_STAGING_DATABASE_URL`, exclusivo de ese staging. Este workflow no aplica migraciones, despliega, carga datos ni acredita capacidad o release.
