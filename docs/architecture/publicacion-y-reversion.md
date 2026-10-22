# Publicación y reversión

Procedimiento de la sección 5 del [plan](../plans/refactorizacion-cita-suite.md), con los destinos reales de Cita Suite. La autorización de producción es del 17 de octubre. El lanzamiento para clientes reales depende además de la decisión del usuario sobre Supabase Free (enmienda del 20 de octubre): publicar en producción sin clientes es parte de la verificación.

## Destinos

| Recurso | Identificador | Cómo se publica |
|---|---|---|
| App | Worker `app` en la cuenta `52b358653379c162b5a07b10ae5e84b3`, `https://app.cita-suite.workers.dev`, ubicado en `aws:sa-east-1` | `scripts/deploy-production-workers.mjs app <artefacto>`. Sube el paquete de producción que compiló CI y verifica la revisión servida. |
| Programador | Worker `cita-suite-scheduler`: los cinco cron del plan y un binding a `app` | `scripts/deploy-production-workers.mjs scheduler`, desde el código del snapshot verificado. |
| Base | Supabase `yjzferwuzbtgpmdnzlcb`, sa-east-1 | `scripts/apply-production-migrations.mjs <respaldo>`. Exige un respaldo de producción de menos de seis horas, tomado en el mismo estado de migraciones. |
| Respaldo | Carpeta privada fuera del repositorio | `scripts/backup-production.mjs` ([respaldo y recuperación](respaldo-y-recuperacion.md)). |
| Natalia | `natalia-frutos.vercel.app` | No se despliega desde este repositorio; el usuario indica cómo se publica. |

## Antes de publicar

1. **Disparadores automáticos desconectados, desde los paneles del usuario:**
   - Cloudflare Workers Builds de `app`: hoy despliega cada push a `main` de `Juan4787/dashboard`;
   - el proyecto `cita-suite` de Vercel, la copia vieja pausada.
2. **Full verde sobre la revisión exacta** del release.
3. **Ensayo de respaldo y restauración aprobado**, en staging.
4. **Staging con la misma revisión:**
   - migraciones aplicadas;
   - app desplegada desde el mismo flujo de artefactos;
   - tareas observadas;
   - medición de auditoría con integridad sin fallas.
5. **Compatibilidad de las migraciones pendientes con la versión servida**, analizada en el registro.
6. **Programador anterior detenido:** cron-job.org (7795525) está deshabilitado desde el 31 de agosto.

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
   - permisos, con la consulta del catálogo en sólo lectura;
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
