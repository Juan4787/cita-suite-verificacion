# Verificación reproducible

El [plan aprobado](../plans/refactorizacion-cita-suite.md) fija los criterios; el [registro](../plans/registro-refactorizacion-cita-suite.md) indica cuáles fueron demostrados. La existencia de un comando o una configuración no acredita su ejecución.

## Comandos

| Comando | Alcance exigido |
|---|---|
| `pnpm verify:fast` | Integridad del plan, inventario, tipos compartidos/Svelte/Natalia, pruebas del propio verificador, dependencias y unidades de servidor/cliente. |
| `pnpm verify:full` | Lo anterior; compilación estática de Natalia, reconstrucción SQL, todas las suites SQL y carreras, GoTrue/PostgREST/Storage reales, navegador, reserva nativa de Natalia y perfil demo separado. |
| `pnpm verify:release` | Exige primero un staging explícito y ajeno a producción. Ejecuta el nivel completo, construye los artefactos para ese staging y comprueba identidad/artefactos y navegador remoto. No despliega. |

Se utiliza Node fijado en `.node-version`, pnpm fijado en `package.json` y el lockfile. Todas las suites, compilaciones y navegadores se ejecutan secuencialmente, con un único trabajador. Las dos conexiones de una carrera SQL pertenecen a un solo escenario controlado; no habilitan suites paralelas.

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
