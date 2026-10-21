# Control de consumo

Decisión del usuario del 20 de octubre, preservada al final del plan: el lanzamiento es para dos consultorios sobre Workers Free y Supabase Free, sin contratar nada. Tampoco se acepta ningún servicio con cobro variable sin tope. Cada protección se evalúa por su mérito: las justificadas se implementan y verifican ahora, y las postergadas quedan aquí con su riesgo residual y la circunstancia en que conviene retomarlas.

## Qué pasa al exceder los planes gratuitos

Ninguno de los dos planes cobra un excedente. Por eso el riesgo actual es de **disponibilidad**, no de dinero.

- **Workers Free:** 100.000 pedidos por día, que se reinician a medianoche UTC; pasado ese número, Cloudflare responde con el error 1027. Además rige un límite de 10 ms de CPU y 50 subpedidos por pedido ([límites de Workers](https://developers.cloudflare.com/workers/platform/limits/)).
- **Supabase Free:** avisa al exceder la cuota y da un período de gracia. Después puede pausar proyectos, pasar la base a solo lectura o responder 402 a toda la API ([preguntas de facturación](https://supabase.com/docs/guides/platform/billing-faq)). Las cuotas incluyen 500 MB de base, 1 GB de archivos, 5 GB de transferencia y 2 millones de mensajes de Realtime. Además, un proyecto con poca actividad durante 7 días se pausa, con un aviso por correo una semana antes, y puede restaurarse ([pausa de proyectos](https://supabase.com/docs/guides/platform/free-project-pausing)).

Las protecciones del código siguen valiendo con cualquier proveedor. Con infraestructura paga deben complementarse con un tope duro del proveedor.

## Implementadas y verificadas

| Protección | Qué evita | Evidencia |
|---|---|---|
| Sincronización de revisiones de pacientes acotada: una pestaña oculta no consulta. Sin Realtime, verifica a los 5, 10 y 20 s y después cada 30 s. Al perder Realtime verifica una sola vez, no en cada reintento fallido del cliente. | Antes, una pestaña abierta, visible u oculta, consultaba cada 5 s: unas 17.000 consultas por día. Con Realtime caído o bloqueado sumaba una por cada reintento: 100 en 5 minutos. Seis pestañas olvidadas agotaban el día de Workers Free. | `patient-revision-sync.client.test.ts`: reproducido con 71 y 100 consultas (fast 39516370916 y 39517223539); corregido (registro). |
| Retención de 7 días de `public_booking_attempts`, podada una vez por día, a lo sumo 20.000 filas por vez. | Crecimiento sin fin de teléfonos y huellas de direcciones hacia los 500 MB. | `public_booking_attempts_retention.sql` (SQL 39493189672). |
| Retención de 180 días de `mp_webhook_events` y `whatsapp_webhook_events`, podada una vez por día, a lo sumo 20.000 filas por vez. Se conservan los eventos de Mercado Pago que requieren atención. | Crecimiento sin fin de registros operativos que nadie consulta pasado el período de reclamos. | `webhook_events_retention.sql`: reproducido en SQL 39551655597, aprobado en SQL 39551937221 (`20261021010000`). |
| Cuerpos de los webhooks leídos con tope y sólo cuando se pueden autenticar: Mercado Pago verifica la firma antes de leer, con 64 KB como máximo; WhatsApp rechaza sin leer si no hay secreto y lee hasta 256 KB. | Que un anónimo haga parsear cuerpos enormes: CPU que con un plan pago se cobra. | `webhook.server.test.ts` (dos rutas): reproducido en fast 39582965020, aprobado en fast 39583902412. |
| Límites existentes por IP y por teléfono en la reserva pública; por correo, IP y usuario en ingreso, alta y creación de consultorios. | Automatización abusiva de escrituras. El límite por IP es global y no se elude. | Pruebas de servidor y SQL de etapas 2 a 4; abuso del ensayo de capacidad. |
| Presupuesto de las tareas automáticas: perfil Free de 40 llamadas externas por cadena, 4 simultáneas y 20 s; reclamaciones con espera persistente; un solo tipo de tarea por evento. | Bucles de reintento, colas que se disparan solas y tareas que exceden la plataforma. | Etapa 6 (`tareas-automaticas.md`). |
| Cuotas de documentos: 700 MB globales, 100 MB por consultorio y 5 MB por archivo, con reservas pesimistas. | Que una carga o un defecto llene el almacenamiento de 1 GB. | Etapa 3 (`contabilidad-documentos.md`). |
| Lecturas acotadas: agenda semanal contada en la base, a lo sumo 7 días por 4 estados; ventanas de disponibilidad de 15 días y grupos de 16 profesionales; listas paginadas. | Respuestas que crecen con el consultorio, truncamientos silenciosos y CPU por fila en el Worker. | `agenda_week_counts.sql`, `agenda-week.server.test.ts`, etapa 4. |
| Defectos de eficiencia corregidos: reglas de lectura de pacientes y turnos evaluadas una vez por sentencia, formateadores de zona horaria reutilizados y una sola lectura de membresías por pedido de lectura. | Trabajo de base y CPU que crece con los datos o se repite en cada pedido. | `patient_read_set_based.sql`, `appointment_read_set_based.sql`, `calculate.test.ts`, `hooks.server.test.ts` y `odonto-context.test.ts`. |

## Postergadas, con su riesgo y cuándo retomarlas

| Medida | Por qué se posterga | Riesgo residual | Retomar cuando |
|---|---|---|---|
| Límite de pedidos por IP **antes** del Worker, con una regla de limitación de Cloudflare. | Cada pedido que llega al Worker ya cuenta para los 100.000 diarios, así que un límite dentro de la app no protege esa cuota. La regla necesita un dominio propio en Cloudflare, y comprarlo es una decisión del usuario. `workers.dev` no admite esas reglas. | Una ráfaga de pedidos, por ejemplo contra el turnero público, puede agotar el día y dejar la app con el error 1027 hasta medianoche UTC. Hoy no tiene costo, pero sí deja sin servicio. Las escrituras siguen limitadas. | Al conectar un dominio propio, o antes de abrir el turnero público a tráfico real si aparece una ráfaga en la analítica de Workers. También al pasar a un alojamiento con proxy propio. |
| Depuración de `audit_logs` y `patient_profile_change_events`. | Decidido en la auditoría transversal: son historia del producto, la ven los usuarios, y el historial de cambios de un paciente acompaña su historia clínica, que la ley argentina obliga a conservar al menos diez años (ley 26.529). Crecen con el uso real, una fila por cambio. | Con dos consultorios, unos pocos MB por año. | Si la base supera la mitad de su cuota, o si se define una política de conservación que permita archivar lo más antiguo. |
| Tope de transferencia de documentos clínicos (5 GB por mes en Free). | Las descargas pasan por URLs firmadas de Storage y la ficha guarda en caché las radiografías ya vistas. Con dos consultorios, el volumen esperado queda lejos de la cuota. | Un defecto del cliente que repita descargas podría agotar la cuota del mes y Supabase restringiría el proyecto. | Si el uso mensual pasa la mitad de la cuota en el panel de Supabase, o antes de contratar un plan pago. |
| Pausa por inactividad de Supabase Free. | Con consultorios en uso diario no aplica. | Un proyecto de staging o un lanzamiento sin uso durante una semana se pausa, con aviso previo por correo. | Antes de una pausa larga sin uso. Restaurar el proyecto no pierde datos. |

## Al contratar infraestructura paga

La previsión del usuario de pagar Supabase Pro y un alojamiento desde el tercer consultorio activo **no autoriza contratar nada**. Cuando se decida:

- Sólo servicios de precio fijo o con tope duro de gasto. Por ejemplo, Supabase Pro con el tope de gasto activado: al llegar a la cuota restringe en vez de cobrar el excedente. Antes de contratar hay que verificar qué partidas cubre ese tope.
- Para el alojamiento, uno de precio fijo que limite y no cobre el excedente. El análisis del 20 de octubre está en el registro, y el proveedor no está decidido.
- Las protecciones de esta página se conservan. Los perfiles de presupuesto de las tareas (`JOB_BUDGET_PROFILE`) se recalibran con mediciones del nuevo destino, no por suposición.
