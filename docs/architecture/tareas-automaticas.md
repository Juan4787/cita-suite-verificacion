# Tareas automáticas: programación, presupuestos y recuperación

**Etapa 6 en curso: implementada y probada en el entorno descartable; falta la medición desplegada en staging y la transición.** La fuente normativa es la etapa 6 del [plan íntegro](../plans/refactorizacion-cita-suite.md). Este documento registra límites verificados, el estado de partida y el diseño adoptado. Nada de lo descrito aquí está publicado mientras el registro no acredite el despliegue.

## Límites de plataforma verificados (19 de octubre de 2026)

Fuente: documentación oficial consultada el 19 de octubre de 2026. Son condiciones a contrastar con mediciones; no son capacidad demostrada.

| Recurso | Workers Free | Workers Paid | Fuente |
|---|---|---|---|
| CPU por invocación (HTTP y Cron) | 10 ms | 30 s en Cron con intervalos menores a 1 h | [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/) |
| Subrequests por invocación | 50 | 10.000 | ídem |
| Conexiones salientes simultáneas | 6 | 6 | ídem |
| Memoria por isolate | 128 MB | 128 MB | ídem |
| Cron Triggers por cuenta | 5 | 250 | ídem |
| Requests por día | 100.000 | sin límite | ídem |
| Tiempo de pared de un evento programado | 15 min | 15 min | ídem |

- Cada request a otro Worker mediante un Service Binding cuenta como subrequest del llamador. La documentación no dice si el Worker invocado comparte el presupuesto de subrequests y CPU del llamador. Por eso el presupuesto de esta campaña cubre **toda la cadena**, tal como fija el plan. Una solicitud admite como máximo 32 invocaciones de Workers. [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- Los Cron Triggers se evalúan en UTC y sus cambios pueden tardar hasta 15 minutos en propagarse. El controlador programado ofrece `noRetry()`, lo que implica que la plataforma puede reintentar un evento fallido: el trabajo debe ser idempotente. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Supabase Free, según la [página de precios](https://supabase.com/pricing) consultada el mismo día: 500 MB de base por proyecto, 1 GB de Storage, 5 GB de egress, 50.000 MAU, archivos de hasta 50 MB, 200 conexiones Realtime, pausa del proyecto tras una semana sin actividad, 1 día de logs y **sin backups incluidos**. Pro: desde USD 25/mes, 8 GB de disco, 100 GB de Storage, 250 GB de egress, backups diarios por 7 días y sin pausa por inactividad.

## Capacidad de la cuenta comprobada (19 de octubre, sólo lectura)

Wrangler 4.86.0 autenticado en la cuenta esperada `52b358653379c162b5a07b10ae5e84b3`, con permiso de escritura sobre scripts. La API lista un único Worker, `app` (modelo `standard`, sólo handler `fetch`, última modificación 2026-10-15 06:29 UTC, coincidente con el último push al repositorio principal), **sin cron triggers**. Los cinco triggers de Workers Free están disponibles para el programador.

## Estado de partida (antes de la etapa 6)

- `POST /internal/jobs/send-push-reminders` ejecuta en una sola llamada recordatorios push, solicitudes de reseña y sincronización de Google Calendar. Lo dispara un cron externo (cron-job.org, fuera del repositorio) con secreto `INTERNAL_JOB_SECRET`.
- `POST /internal/jobs/reconcile-mercadopago`: conciliación comercial disparada externamente cada ~6 h.
- `generate-reminder-dispatches` y `process-message-dispatches` pertenecen a WhatsApp, descartado por el plan; no forman parte de los cinco disparadores.
- **Destinos antiguos:** `https://cita-suite.netlify.app` servía la aplicación completa con su `/internal/jobs/send-push-reminders`; según la memoria operativa de junio, cron-job.org lo llamaba cada 10 minutos. El 19 de octubre el usuario desactivó ese proyecto y pausó otra copia en `https://cita-suite-app.vercel.app` (comprobado: 404 y 503). Cualquier llamador antiguo que quede, por ejemplo contra el Worker, se neutraliza con el interruptor de base descrito abajo.
- `pg_cron` en la base: `cita-suite-clinical-files-integrity` (`17 */6 * * *`) y `cita-suite-patient-export-maintenance` (`*/15 * * * *`).
- **Brecha:** `private.release_expired_clinical_reservations()` (liberación de reservas de carga vencidas) sólo se invoca desde pruebas SQL. La limpieza de cargas abandonadas existe únicamente como acción manual del dueño. En producción ningún proceso automático libera hoy esas reservas.
- Las reclamaciones de push ordenan por id de suscripción; calendario y reseñas usan una cola global. Ninguna reparte el trabajo entre consultorios: uno con mucho pendiente puede ocupar todo el lote. Las reclamaciones vencidas se recuperan a los 10 minutos.

## Costo actual por elemento (lectura del código antes de la etapa 6)

| Categoría | Por lote | Por elemento (camino feliz) | Fallo o caso extra |
|---|---|---|---|
| Push 24 h/2 h (`sendDuePushReminders`) | borrado de telemetría vencida + reclamación (2) | lectura del turno, alta del intento, envío al proveedor, aceptación, marca de enviado y auditoría (6) | lectura de `failed_count` y liberación, o RPC de endpoint muerto (+1–2) |
| Reseñas (`sendDueGoogleReviewRequests`) | recuperación de reclamaciones + reclamación (2) | entrega aceptada previa, preparación, comprobación de reclamación, envío rastreado (alta, proveedor, aceptación) y cierre/auditoría (≈8) | conflicto de idempotencia con lectura adicional (+1) |
| Calendario (`processGoogleCalendarSyncJobs`) | reclamación (1) | carga del vínculo, renovación del token OAuth (proveedor), alta o modificación del evento (proveedor) y cierre (≈4–5) | respuesta perdida en el alta: lectura del evento existente (+1 proveedor); revocación al desconectar (+1) |
| Conciliación comercial (`reconcileMercadoPago`) | lista acotada de suscripciones (1) | consulta a Mercado Pago y escrituras de estado/pagos (≈2–3) | presupuesto temporal propio (`budgetMs`) |

Con el presupuesto Free de 40 llamadas por cadena (incluida la del Service Binding), push procesaría hoy unos 4 recordatorios por ejecución en el peor caso. Esto confirma que el lote debe derivarse del costo y que el contexto y las escrituras deben agruparse por lote donde sea seguro. A esto se suma la CPU de 10 ms, que se mide aparte.

## Diseño adoptado

### Cadena y puntos de entrada

- **Programador** `apps/scheduler` (Worker `cita-suite-scheduler`, sin `workers_dev` ni URLs de preview): cinco triggers UTC versionados en `wrangler.jsonc` (push `*/5`, calendario `1-59/5`, reseñas `2-59/10`, cargas `3-59/15`, mantenimiento `17 */3`). El mantenimiento alterna conciliación comercial (00, 06, 12 y 18 h UTC) y reconciliación de almacenamiento (03, 09, 15 y 21 h). Cada evento hace **una** llamada por Service Binding a `POST /internal/jobs/<categoría>` del Worker `app` con el secreto de tareas y la hora programada, y exige un recibo `{ ok: true, kind }` de esa categoría; si no lo recibe, falla visiblemente y llama a `noRetry()`, porque las reclamaciones persistentes ya retoman el trabajo. No contiene reglas ni credenciales de Supabase o proveedores. El contrato de categorías y recibo es `@cita-suite/shared/scheduled-jobs`. Sus pruebas corren con `node:test` sobre el stripping de tipos nativo de Node 22.23, sin bundler.
- **App:** la ruta `/internal/jobs/[kind=job]` (el matcher sólo admite las seis categorías) ejecuta `runScheduledJob` (`server/integrations/public/scheduled-jobs.ts`). El recibo y el registro `Tarea programada` llevan sólo nombres, conteos y mediciones (perfil, llamadas usadas, viajes a la base, llamadas a proveedores, duración): nunca datos clínicos, tokens ni URLs firmadas.
- **Entradas antiguas:** `send-push-reminders` ejecuta sólo push y `reconcile-mercadopago` sólo la conciliación, con la misma implementación presupuestada; calendario y reseñas dejaron de correr ahí. Cuando el interruptor `public.set_legacy_job_entrypoints(false)` está apagado responden **410** sin ejecutar nada. Además, las reclamaciones SQL antiguas (`claim_due_push_reminders`, `claim_google_calendar_sync_jobs`, `claim_due_google_review_requests`) devuelven vacío con el interruptor apagado, sea cual sea la versión de la app que las llame. Así, detener el programador anterior en el release no depende de acceder a su host. La migración deja el interruptor encendido hasta ese paso (prueba de actualización).

### Presupuesto de la cadena

`server/integrations/internal/job-budget.ts`. Perfil Free: 40 llamadas por cadena, contando la del Service Binding; perfil Paid (`JOB_BUDGET_PROFILE=paid`): 300. Ambos: 4 llamadas externas simultáneas, 5 s como máximo por llamada y 20 s en total, con los últimos 4 s reservados para registrar resultados. El cliente de Supabase de la tarea usa `fetch` presupuestado como `database` (PostgREST, Storage, Auth) y los proveedores como `provider`; ninguno se presenta como cantidad de consultas SQL. Cada llamada se cuenta antes de empezar, y el trabajo nuevo empieza sólo si su peor caso y la reserva de cierre todavía entran. **PostgREST reintenta solo los GET, también tras un rechazo del presupuesto**, durmiendo 1, 2 y 4 s: las lecturas que hace una tarea llevan `.retry(false)`, y la recuperación persistente de cada cola cubre ese fallo.

| Categoría | Peor caso por elemento | Fijo por ejecución | Límite con Free |
|---|---|---|---|
| Push | 1 envío; el avance de cada tramo de 4 registra el tramo anterior y prepara el siguiente | reclamación + avance final | 28 recordatorios (7 tramos de 4) |
| Calendario | 3 llamadas a Google (token, cambio, búsqueda o revocación); por tramo, 1 lectura y 1 cierre | reclamación + liberación final | 10 eventos |
| Reseñas | 8 (entrega previa, preparación, comprobación, intento, envío, resultado, cierre, auditoría) | recuperación + reclamación | 4 solicitudes |
| Cargas abandonadas | — | 1 reclamación + 1 borrado por bucket y cada 100 objetos | 200 archivos |
| Conciliación comercial | 9 por suscripción + 4 por cada cobro aprobado nuevo | lectura + resumen | según presupuesto, 20 suscripciones como máximo |
| Almacenamiento | — | 1 RPC | — |

**La CPU de Free (10 ms por invocación) no está certificada por este cálculo.** El cifrado Web Push se mide en el Worker desplegado (`workersInvocationsAdaptive`) y, si hace falta, el lote de Free se acota por CPU con esa medición.

### Colas, reparto y recuperación (`20261019010000_scheduled_job_batches.sql`)

- **Reparto:** push, calendario, reseñas y cargas reclaman por turnos: el primer pendiente de cada consultorio, luego el segundo, etc. Un consultorio con mucha cola no monopoliza el lote (prueba con una cola larga que empieza primero). Entre ejecuciones, push, calendario y reseñas recuerdan cuándo atendieron por última vez a cada consultorio (`private.job_queue_rotation`): dentro de un mismo turno va primero el consultorio que más espera y después el más urgente. Sin esa memoria, el turno se recalculaba en cada reclamación y un consultorio atendido volvía a competir en igualdad con los que seguían esperando: en el escenario de calendario con Free un consultorio tardó 25 minutos en empezar (full 39360081612). Cada reclamación registra sus consultorios una vez, al final y en orden de identificador, para que dos reclamaciones simultáneas no se bloqueen mutuamente. Las cargas abandonadas no la necesitan: cada ejecución admite 200 elementos, muy por encima de un turno por consultorio.
- **Propiedad:** push y calendario guardan un token de reclamación; sólo su dueño registra resultados, y un resultado tardío de otro dueño se descarta (`stale`). Las reclamaciones vencen a los 10 minutos y se recuperan.
- **Push:** `claim_push_reminder_batch` no devuelve endpoint ni claves. `advance_push_reminder_batch` registra en un viaje los resultados del tramo enviado (aceptado, `gone`, rechazado o transitorio, con auditoría en SQL) y prepara el siguiente. Antes de devolverlo revalida reclamación, vínculo, dispositivo (vía el trigger de identidad) y ventana viva del turno, cierra como transitorio un intento previo sin resultado (respuesta perdida) y crea el intento nuevo. Un fallo espera en forma persistente 1, 2, 4… hasta 60 minutos; la ventana del recordatorio termina los reintentos. Una reprogramación reinicia ambos recordatorios, su reclamación y su espera. No se promete entrega exactamente una vez: el `topic` por turno y el `tag` de la notificación colapsan un recordatorio repetido.
- **Envío Web Push:** `web-push` sólo cifra (aes128gcm); la petición sale por el `fetch` del llamador y la firma VAPID se hace una vez por origen del servicio push. Lo mismo vale para la prueba de notificación y el aviso de reprogramación. Una prueba con la biblioteca real descifra el mensaje con la clave del navegador y verifica la firma.
- **Calendario:** la reclamación trae cada vínculo y el token cifrado de su conexión. El token se refresca una vez por conexión y ejecución. Cada tramo lee sus turnos en una consulta (el lugar sigue la regla de la vista pública), hace los cambios en Google con el núcleo compartido con el camino inmediato y los registra con `complete_google_calendar_sync_batch`, que reutiliza las transiciones existentes. Un resultado mal formado rechaza el tramo completo. La revocación ante Google ocurre después de confirmar el borrado que eliminó el último vínculo.
- **Reseñas:** misma implementación para la reclamación antigua y la de lote (`private.claim_google_review_requests`), con el protocolo por solicitud existente.
- **Cargas:** `claim_abandoned_clinical_uploads` libera las reservas vencidas de todos los consultorios (la brecha del estado de partida) y devuelve los objetos a borrar, nunca archivos confirmados. Es la misma implementación que la limpieza manual del dueño, limitada a su consultorio. El borrado agrupa por bucket.
- **Conciliación comercial:** lee en un viaje qué cobros ya están acreditados (`access_grants`) y sólo acredita los nuevos; antes llamaba al RPC idempotente por cada cobro de la página, un costo que crecía con la antigüedad de la suscripción.
- **Telemetría push:** la retención de 90 días pasó a pg_cron (`cita-suite-push-telemetry-retention`, 04:41 UTC), porque es trabajo sólo de base.

### Evidencia

SQL 39330239590 (`scheduled_job_batches.sql` 6/6, par de actualización 5/5, todas las suites y carreras); unidades locales de cada módulo. Las verificaciones completas, la medición desplegada y la transición se registran en el [registro](../plans/registro-refactorizacion-cita-suite.md).

### Pendiente de esta etapa

1. Full positivo de la revisión exacta.
2. Staging: desplegar app y programador, colas sintéticas (cinco pendientes por consultorio y escenario desigual), medir CPU p50/p99, subrequests y antigüedad por consultorio, y fijar el lote de Free por CPU si hace falta.
3. Transición según la secuencia de publicación del plan, con los triggers de Free prestados a staging durante una ventana acotada.

Restricción de cuenta: Workers Free admite cinco Cron Triggers **por cuenta**. Staging y producción no pueden tener sus cinco triggers activos al mismo tiempo. La validación desplegada en staging usará la cuota durante una ventana acotada y la liberará antes de activar producción; se documentará el orden exacto.
