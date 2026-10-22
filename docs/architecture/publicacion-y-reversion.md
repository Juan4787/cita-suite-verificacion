# Publicación y reversión

Procedimiento de la sección 5 del [plan](../plans/refactorizacion-cita-suite.md), con los destinos reales de Cita Suite. La autorización de producción es del 17 de octubre. El lanzamiento para clientes reales depende además de la decisión del usuario sobre Supabase Free (enmienda del 20 de octubre): publicar en producción sin clientes es parte de la verificación.

## Destinos

| Recurso | Identificador | Cómo se publica |
|---|---|---|
| App | Worker `app` en la cuenta `52b358653379c162b5a07b10ae5e84b3`, `https://app.cita-suite.workers.dev`, ubicado en `aws:sa-east-1` | `scripts/deploy-production-workers.mjs app <artefacto>`. Sube el paquete de producción que compiló CI y verifica la revisión servida. |
| Programador | Worker `cita-suite-scheduler`: los cinco cron del plan y un binding a `app` | `scripts/deploy-production-workers.mjs scheduler`, desde el código del snapshot verificado. |
| Base | Supabase `yjzferwuzbtgpmdnzlcb`, sa-east-1 | `scripts/apply-production-migrations.mjs <respaldo>`. Exige un respaldo de producción de menos de seis horas, tomado en el mismo estado de migraciones. |
| Respaldo | Carpeta privada fuera del repositorio | `scripts/backup-production.mjs` ([respaldo y recuperación](respaldo-y-recuperacion.md)). |
| Natalia | `natalia-frutos.vercel.app` | No se despliega desde este repositorio; el usuario indica cómo se publica. El release trae su sitio ya compilado para producción (`.verification/natalia-production`): se publican esos archivos exactos. |

**Staging**, para la verificación del release:

| Recurso | Identificador | Cómo se publica |
|---|---|---|
| App | Worker `cita-suite-staging`, `https://cita-suite-staging.cita-suite.workers.dev` | `deploy-staging-workers.mjs app <release>` |
| Natalia | Worker de sólo archivos `natalia-frutos-staging`, `https://natalia-frutos-staging.cita-suite.workers.dev`, fuera de los buscadores (`X-Robots-Tag: noindex`) | `deploy-staging-workers.mjs natalia <release>` |
| Programador | Worker `cita-suite-scheduler-staging` | `deploy-staging-workers.mjs scheduler` |
| Consultorio de release | `release-staging`, sintético y fijo | operación `release-fixture` del workflow de staging |

## Antes de publicar

1. **Disparadores automáticos desconectados, desde los paneles del usuario:**
   - Cloudflare Workers Builds de `app`: hoy despliega cada push a `main` de `Juan4787/dashboard`;
   - el proyecto `cita-suite` de Vercel, la copia vieja pausada.
2. **Release empaquetado una sola vez** por la operación `artifact` del workflow de staging, sobre la revisión exacta.
3. **Ensayo de respaldo y restauración aprobado**, en staging.
4. **Staging con el mismo release:**
   - migraciones aplicadas;
   - app y copia de Natalia desplegadas desde ese paquete;
   - consultorio de release asegurado;
   - tareas observadas;
   - medición de auditoría con integridad sin fallas.
5. **`verify:release` aprobado** con ese paquete (`level=release`, `artifact_run`). Incluye el nivel completo, todos los recorridos de navegador sobre el paquete de producción servido por workerd y las comprobaciones del staging desplegado ([verificación](verificacion.md)).
6. **Compatibilidad de las migraciones pendientes con la versión servida**, analizada en el registro.
7. **Programador anterior detenido:** cron-job.org (7795525) está deshabilitado desde el 31 de agosto.

## Secuencia

1. **Respaldo nuevo de producción** con `backup-production.mjs`.
2. **Migraciones** con `apply-production-migrations.mjs <carpeta del respaldo>`. Se aplican en orden, y la historia se registra después de cada una.
3. **Entradas viejas apagadas:** `select public.set_legacy_job_entrypoints(false);`.
4. **App:** `deploy-production-workers.mjs app <artefacto>`. Rechaza un artefacto que no coincida con su manifiesto o una configuración que no sea la de producción, y se niega a desplegar si falta un secreto requerido. Al final comprueba que se sirva la revisión.
5. **Programador:**
   - liberar los cron de staging con `deploy-staging-workers.mjs scheduler-without-crons`, porque la cuenta Free tiene cinco;
   - después, `deploy-production-workers.mjs scheduler`.
6. **Comprobaciones posteriores:**
   - revisión servida;
   - permisos, con la consulta del catálogo en sólo lectura y la sonda de la clave anónima sobre la API;
   - reserva pública de un consultorio sintético;
   - almacenamiento;
   - tareas, observando el Worker;
   - push real al Samsung del usuario.
7. **Medición de dos consultorios en producción** con datos sintéticos, el muestreador de la instancia y la atribución de pausas. Después, limpieza comprobada.
8. **Repositorio:** con los disparadores desconectados, la revisión publicada llega a `main` y se aplica la transición de identidad de [identidad-cita-suite.md](identidad-cita-suite.md). Sólo se reconectan los disparadores revisados.

## Reversión

1. **Detener primero el programador nuevo:** desplegarlo sin cron, o borrarlo.
2. **Volver a la versión anterior de `app`:** `wrangler rollback` a `9b2df65c-f89c-4940-a625-4d7b3e5858f2`, la versión servida antes del release. Las 27 migraciones son compatibles con ella.
3. **Entradas viejas:** volver a encenderlas sólo si hace falta (`set_legacy_job_entrypoints(true)`). El programador anterior está deshabilitado y no se reactiva sin decisión del usuario.
4. **Base:** las migraciones no se deshacen destructivamente. Restaurar el respaldo es para un desastre, no para una reversión, porque perdería las escrituras posteriores.
