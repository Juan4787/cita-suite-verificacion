# Tareas automáticas: programación, presupuestos y recuperación

**Etapa 6 en preparación.** La fuente normativa es la etapa 6 del [plan íntegro](../plans/refactorizacion-cita-suite.md). Este documento registra límites verificados, el estado de partida y el diseño adoptado a medida que se implementa y comprueba. Nada de lo descrito aquí está publicado mientras el registro no acredite el despliegue.

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
- **Destino antiguo activo:** `https://cita-suite.netlify.app` sirve la aplicación completa y su `/internal/jobs/send-push-reminders` responde 401 sin secreto. Según la memoria operativa de junio, el cron de cron-job.org apuntaba a ese host cada 10 minutos. Antes de activar el programador nuevo hay que confirmar qué llama realmente a los jobs y retirar o neutralizar ese destino de forma reversible.
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

## Diseño (borrador de entrada; se ajusta al implementar y se reemplaza por lo comprobado)

1. **Programador** `apps/scheduler` (Worker propio, sin reglas de negocio ni credenciales de Supabase o proveedores). Cinco triggers UTC fijos del plan: push `*/5 * * * *`, calendario `1-59/5 * * * *`, reseñas `2-59/10 * * * *`, limpieza de cargas `3-59/15 * * * *` y mantenimiento `17 */3 * * *`. El mantenimiento alterna conciliación comercial y reconciliación de almacenamiento, cada una cada seis horas. Cada evento llama a **una** categoría mediante Service Binding al Worker `app`, espera el recibo y falla visiblemente si no es válido. Sólo comparte con el app el secreto de tareas internas.
2. **Endpoints por categoría** en el app, con autenticación interna, presupuesto y recibo estructurado sin datos clínicos, tokens ni URLs firmadas. El endpoint antiguo `send-push-reminders` deja de ejecutar varias categorías durante la transición.
3. **Presupuesto de toda la cadena:** contador de llamadas externas (HTTP a Supabase mediante el `fetch` envuelto y llamadas a proveedores registradas en su punto de uso), hasta cuatro simultáneas y fecha límite de 20 s con margen para cerrar. Perfil Free: 40 llamadas, incluida la del Service Binding. Perfil Paid: 300, sujeto a medición; no autoriza contratar. El lote se deriva del peor costo por elemento de cada categoría, incluidos fallos y registros finales.
4. **Contexto y escrituras agrupados** donde sea seguro: la reclamación devuelve el contexto necesario y los resultados se registran por lote. La cancelación o reprogramación se revalida inmediatamente antes del efecto externo.
5. **Reparto entre consultorios:** las reclamaciones ordenan por ronda (primer pendiente de cada consultorio, luego el segundo, etc.) y por urgencia, para que uno con mucho trabajo no monopolice la cola.
6. **Recuperación e idempotencia:** reclamaciones con vencimiento, reintentos persistentes con espera creciente y límite, y respuestas perdidas tratadas como inciertas. Se usan identificadores estables del proveedor cuando existen (`topic` por turno en Web Push e id de evento determinista en Calendar). No se promete entrega exactamente una.
7. **Limpieza automática de cargas**, con reparto entre consultorios: libera reservas vencidas respetando el plazo protegido y elimina mediante la API de Storage los objetos abandonados que ya no tienen URL válida. Nunca borra archivos clínicos confirmados.

8. **Envío Web Push contable:** `web-push` cifra y firma con `generateRequestDetails()`, y la petición sale por el `fetch` presupuestado con timeout explícito, en lugar del `https.request` interno de la biblioteca. Así cada llamada al proveedor se cuenta y se acota, y la cadena completa puede probarse contra un servicio push falso en el entorno descartable, sin relajar la validación de hosts al guardar suscripciones.
9. **CPU de Free:** cada envío cifra (ECDH P-256, HKDF, AES-128-GCM) y firma un JWT ES256. Con 10 ms por invocación, el lote de Free puede quedar limitado por CPU antes que por llamadas. Se mide con `workersInvocationsAdaptive` (`cpuTimeP50`/`cpuTimeP99`, `subrequests`) en el Worker real y el lote del perfil Free se fija con esa medición, no con un número supuesto.

### Orden de implementación previsto

1. Presupuesto de cadena (`job-budget`) y ejecutor común de tareas internas, con pruebas unitarias de conteo, concurrencia, fecha límite y agotamiento sin éxito parcial silencioso.
2. Migración compatible: reclamaciones con reparto por consultorio para push, calendario y reseñas (las firmas anteriores se conservan mientras el endpoint antiguo exista), espera creciente persistente en push y cierre de lote en un solo RPC. Además, limpieza automática de cargas para todos los consultorios con liberación de reservas vencidas. Pruebas SQL: reparto en escenario desigual, recuperación de reclamaciones vencidas, idempotencia del cierre, revalidación de cancelación y reprogramación, y aislamiento entre consultorios.
3. Endpoints por categoría (`push`, `calendar`, `reviews`, `uploads`, `commercial`, `storage`), cada uno con su presupuesto y recibo. El endpoint antiguo queda limitado a una sola categoría y, al activar el programador nuevo, deja de procesar.
4. Worker `apps/scheduler` con los cinco triggers versionados, Service Binding al `app` y pruebas del mapeo cron → categoría y de la alternancia del mantenimiento.
5. Integración en el entorno descartable: colas sintéticas (cinco pendientes por consultorio y un consultorio con cola grande), servicio push falso y medición del comienzo del trabajo por consultorio en tiempo simulado.
6. Staging y producción: medición real de CPU, subrequests y antigüedad de colas, y transición del programador anterior según la secuencia de publicación del plan.

Restricción de cuenta: Workers Free admite cinco Cron Triggers **por cuenta**. Staging y producción no pueden tener sus cinco triggers activos al mismo tiempo. La validación desplegada en staging usará la cuota durante una ventana acotada y la liberará antes de activar producción; se documentará el orden exacto.
