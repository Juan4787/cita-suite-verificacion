# Matriz de permisos y capacidades

Entregable de la sección 5 del [plan](../plans/refactorizacion-cita-suite.md). Resume quién puede hacer qué y bajo qué condiciones, con la fuente de cada regla y las pruebas que la sostienen. **La interfaz sólo orienta.** PostgreSQL vuelve a autorizar cada lectura y escritura con la membresía vigente: RLS, funciones con privilegios explícitos y revalidación dentro de la transacción ([propiedad de las reglas](areas-y-fronteras.md)).

## Las cuatro cuestiones del plan

Una acción está disponible sólo si las cuatro la admiten (sección 2 del plan).

| Cuestión | Dónde se decide | Ejemplos |
|---|---|---|
| 1. Disponibilidad operativa global | Variables del Worker y fila única `clinical_storage_budget` | `BOOKING_INTEGRATIONS_ENABLED`, `BOOKING_CONTEXTS_AVAILABLE`, `BOOKING_INFORMATION_ENABLED`; `uploads_enabled` global de documentos. |
| 2. Habilitación del consultorio | Columnas del consultorio y su cuenta de almacenamiento | `patient_documents_enabled`, `uploads_enabled` y cuota de `clinical_business_storage_budget`, integraciones activas. |
| 3. Configuración del consultorio o profesional | Tablas de configuración | Prestaciones, asignaciones, horarios, formularios de reserva, políticas de aranceles, enlaces de reseña. |
| 4. Permisos del actor y estado comercial | Contexto común de petición (`odonto-context.ts`, `business.ts`, `commercial-access.ts`) y, otra vez, SQL | Las dos tablas siguientes. |

La marca y el tema sólo determinan presentación: nunca habilitan una acción.

## Estado comercial

Fuente: `getBusinessAccessState` en `apps/web/src/lib/access/commercial-access.ts`, espejo de `business_commercial_status` en SQL.

| Estado | Cuándo | Entra a la app | Usa el consultorio | Capacidades |
|---|---|---|---|---|
| `active` | Permanente, o pagado hasta una fecha futura | Sí | Sí | Todas |
| `grace` | Venció el pago, dentro de la gracia | Sí | Sí | Todas |
| `restricted` | Acceso comercial apagado, o dentro de la restricción | Sí | No | Sólo leer pacientes, historia y costos existentes, y ver la suscripción |
| `archived` | Archivado, o vencido después de la restricción | No | No | Sólo ver la suscripción |

Un consultorio sin fila de suscripción sólo es `active` si es anterior a las suscripciones (`2026-05-28`). Si no, es `restricted`. Ninguna otra fila la reemplaza.

## Roles del consultorio

Roles: `owner` (dueño), `admin`, `reception` (recepción), `professional` y `readonly` (`BUSINESS_ROLES`). La **ayuda de cuenta** da a un usuario de soporte el rol `admin` mientras dure el permiso que concedió el dueño. El **administrador maestro** se identifica por `MASTER_EMAIL` y no es un rol del consultorio.

> **Alcance de `readonly` en la interfaz de Equipo (`AF1-016`, 21-nov-2026):** `readonly` existe como rol válido en base de datos, RLS y membresías vigentes (si un consultorio ya tiene usuarios con ese rol, `/odonto/configuracion/usuarios` muestra la sección «Solo lectura» para consultarlos y gestionarlos). El asistente «Agregar integrante» ofrece intencionalmente sólo los roles operativos `owner`, `admin`, `reception` y `professional`.

Cada celda supone el estado `active` o `grace`. En `restricted`, la columna «Lectura en restricción» indica qué queda.

| Acción | Dueño | Admin | Recepción | Profesional | Sólo lectura | Lectura en restricción | Fuente |
|---|---|---|---|---|---|---|---|
| Agenda del consultorio | ✓ | ✓ | ✓ | Sus turnos (`mis-turnos`) | Ver | — | `canOperate`; navegación por rol en `+layout.svelte` |
| Crear turnos | ✓ | ✓ | ✓ | — | — | — | `resolvePatientPermissions.canCreateAppointment` |
| Ver pacientes | ✓ | ✓ | ✓ | Los de sus vínculos activos | ✓ | Dueño y admin | RLS de `patients` (`20261020020000`), `patient_read_set_based.sql` |
| Crear pacientes | ✓ | ✓ | ✓ | ✓ | — | — | `loadPatientList`, `create_patient`, `get_patient_data_revision` (`AF1-019`) |
| Editar datos del paciente | ✓ | ✓ | ✓ | ✓ | — | — | `canEditPatient` |
| Archivar / desarchivar paciente | Global | Global | — | Su vínculo | — | — | `canArchivePatient`, `patient_archive_actor_scope.sql`, `pacientes/+page.svelte` (`AF1-019`) |
| Historia clínica: leer | ✓ | ✓ | — | ✓ | ✓ | Dueño y admin | `canReadClinicalHistory` |
| Historia clínica: escribir | ✓ | ✓ | — | ✓ | — | — | `canCreateClinicalEntry`, `clinical_direct_write_guards.sql` |
| Perfil clínico | ✓ | ✓ | — | ✓ | — | Dueño y admin leen | `canReadClinicalProfile`, `canEditClinicalProfile` |
| Costos de la historia | ✓ | ✓ | — | — | — | Dueño y admin | `canViewCosts` |
| Documentos clínicos: ver | ✓ | ✓ | — | ✓ | — | Dueño y admin | `canViewRadiographs`; recepción recibe 403 |
| Documentos clínicos: subir | ✓ | ✓ | — | ✓ | — | — | `canUploadRadiographs`, más cuota y habilitación |
| Papelera de documentos | ✓ | ✓ | — | — | — | Dueño y admin la ven | `canViewRadiographTrash`, `canTrashRadiographs` |
| Exportar datos | ✓ | ✓, salvo ayuda de cuenta | — | — | — | ✓ | `canExportPatientDataFromContext` |
| Seguimientos | Todos | Todos | Todos | Los suyos | — | — | `roleSeesAllFollowUps`, `roleParticipatesInFollowUps`, `follow_ups_database_rules.sql` |
| Configuración del consultorio | ✓ | ✓ | — | — | — | — | `canManage`; las secciones sin permiso no se muestran y redirigen |
| Asignar / quitar roles | `owner`, `admin`, `reception`, `professional` | `reception` y `professional` (`admin` también en ayuda de cuenta); nunca `owner` ni otros `admin` | — | — | — | — | `canAssignTeamRole`, `usuarios/+page.server.ts`, `usuarios/+page.svelte` (`AF1-019`) |
| Perfil atendible de dueño o admin | ✓ | El de admin; el del dueño sólo con ayuda | — | — | — | — | `canConfigureAttendingProfile` |
| Suscripción | ✓ | ✓, salvo ayuda de cuenta | — | — | — | ✓: es la salida del bloqueo para volver a pagar | `canViewSubscription`; excepción del bloqueo en `+layout.svelte` |

En `archived` nadie del consultorio entra a la app.

**Administrador maestro:**
- crea consultorios con su dueño en una sola transacción (`create_business_with_owner`);
- concede y retira acceso comercial;
- fija las cuotas de documentos (`set_business_clinical_storage_policy`, `set_clinical_storage_defaults`);
- atiende pedidos de ayuda.

Sus rutas (`/odonto/maestro/*`) rechazan a cualquier otra identidad con 403 o la redirigen al login.

## Cuotas de documentos

Las cuotas son máximos individuales sobre una capacidad compartida, no espacio reservado ([contabilidad de documentos](contabilidad-documentos.md)).

| Nivel | Valor inicial | Quién lo cambia | Garantía |
|---|---|---|---|
| Global (`clinical_storage_budget.max_bytes`) | 700 MB | El operador, con una migración versionada, cuando cambia el plan | No baja de lo guardado más lo reservado (`CLINICAL_STORAGE_COMMITTED`) |
| Predeterminada por consultorio | 100 MB | Maestro | La recibe todo consultorio nuevo, sin configuración manual |
| De un consultorio | La predeterminada al crearlo | Maestro | Conserva documentos y cargas pendientes. Ampliarla se ensaya en `clinical-files.spec.ts`, también sobre el paquete del release. |

## Pruebas que sostienen la matriz

Las capas y suites de cada punto están en la [matriz de regresiones](matriz-regresiones.md):
- **punto 2:** revocación, cambio de rol y estados comerciales;
- **punto 3:** capacidades diferentes y acceso histórico;
- **punto 7:** historia clínica y documentos por rol.

Las pruebas de interfaz de roles siguen la regla de ocultar y redirigir: una sección sin permiso no se muestra ni se abre, y no hay vistas de sólo lectura sustitutas.

## Señas (campaña del 29 de octubre de 2026)

**Horarios liberados (etapa C):** la lectura usa los mismos conjuntos autorizados que turnos y señas: dueño/admin/recepción/sólo lectura ven el consultorio operativo; profesional, sólo sus turnos asignados. El aviso interno de P3 sólo se muestra a dueño, administración y recepción, que son quienes pueden dar el horario. La app sigue dirigiendo profesionales a «Mis turnos». Sólo dueño/admin/recepción ocultan avisos; SQL bloquea y revalida autoridad/comercial, aplica cambio y auditoría en una transacción. Soporte conserva únicamente su concesión vigente. Anónimo no lee ni ejecuta; ningún rol API escribe directamente el registro. El disparador es la única fuente de los hechos. `appointment_slot_releases.sql` verifica estos límites; la prueba de navegador no los sustituye.

La migración `20261029010000_appointment_deposits.sql` y `private.deposit_actor` vuelven a comprobar la membresía activa y la operación comercial dentro de la transacción. La interfaz no reemplaza ese permiso.

| Acción | Autoridad | Límite |
|---|---|---|
| Leer la seña interna | Mismo permiso que leer su turno, mediante RLS por conjuntos | No cruza consultorios; un profesional sólo ve sus turnos autorizados |
| Registrar, exceptuar, deshacer o abrir el pedido de WhatsApp | Dueño, administración o recepción con operación comercial vigente | RPC autenticada, turno activo, revisión observada cuando cambia la seña; no escritura directa en tablas |
| Configurar la política | Dueño o administración con operación vigente | Política completa y revisión obligatoria; recepción/profesional/lectura sola no guardan |
| Leer el estado público | Servidor mediante token del turno | Proyección mínima, datos de transferencia sólo con seña pendiente; sin acceso anónimo a tablas/RPC |
| Calcular condiciones previas a reservar | Servidor `service_role` | Lote acotado de horarios, sin datos para transferir ni permiso de mutación |
| Operar el interruptor general y ejecutar la baja | Operador y pg_cron | Funciones privadas sin `EXECUTE` para roles API; global y política apagados al instalar |

Las rutas `senas` redirigen a profesional y lectura sola; configuración redirige también a recepción. Si una lectura falla, no se fabrica una lista vacía ni un estado saludable. Release exacto C9 **41082416537**: SQL B25/C15, diez carreras y deadlocks0; tipos0/0; navegador53fuente/53paquete y49compatibilidad B11. Lectura productiva:74relaciones sin exposición anónima; las pruebas HTTP de acciones usaron exclusivamente la dueña sintética propia, con lectura SQL y limpieza. Detalle por capa en el [cierre](../plans/cierre-senas-avisos-natalia.md) y el [registro](../plans/registro-senas-avisos-natalia.md); no atribuir una prueba de interfaz al catálogo íntegro de permisos.

## E — permisos (publicados el 6 de noviembre)

Las notas siguientes conservan su fecha y su estado de entonces: donde dicen «sin publicar», hoy ya está publicado. Vigente en el [estado](../ESTADO-VIGENTE.md).

El [plan 12.18](../plans/propuesta-senas-avisos-natalia.md#etapa-e-vigente) y su [especificación](../plans/etapa-e-correo-autogestion.md) añaden requisitos, no permisos ya aplicados:

- Dueña/administración configuran obligación de email, botones, identidad de correo y políticas de reprogramación con la capacidad comercial/contexto correspondiente. Las credenciales del proveedor no se exponen al navegador ni al consultorio como un secreto global compartido.
- Recepción continúa sin email sólo tras aviso; puede completar el contacto de su paciente y registrar/exceptuar señas según las capacidades actuales, siempre revalidadas. No inventar permisos para profesional o lectura sola.
- El paciente gestiona un único turno mediante una capacidad validada, limitada y revocable; no puede elegir actor, consultorio, turno excluido, monto o excepción de personal.
- Consultar/cancelar una cita vigente cuando la reserva online está apagada no habilita nuevas reservas. Una excepción para suspensión/archivo requiere comando específico y pruebas de aislamiento; no retirar guardias globales ni reactivar el consultorio.
- Funciones nuevas sin exposición anónima directa por inercia: revisar grants, RLS, referencias compuestas y las suites de catálogo. Webhooks autenticados y relacionados con el envío/consultorio correctos.

Estado parcial de E1: tablas de preferencias/historia con lectura mediante los conjuntos de turnos y sin escrituras directas; hashes y recibos privados; emitir/resolver capacidades y ejecutar acciones del paciente sólo con `service_role`; revocar gestión con dueño/admin/recepción autorizados. Cancelar con enlace válido es una excepción mínima del comando del paciente, incluida suspensión/archivo, sin habilitar reservas ni operación interna. Comando, lectura, recuperación e identidad se comprobaron en la suite SQL completa `41705610343` (773 aserciones/18 scripts). Rutas `/turno` legado y `/gestion` capacidad integradas inicialmente en desarrollo, con comandos backend y resolución revocable, con fast 41710295801/browser 41708652093 parciales, incluida prioridad/foco. Sin paquete de E. Vencimiento natural de ayuda durante seis esperas y diez grupos de contrato comprobados; comandos de agenda/alta con Ayuda y configuración del personal siguen en auditoría: no se deduce OP02 ni revocación integral de email/calendarios de estas pruebas. No hay una ampliación de permisos productivos ni un cierre integral de E; [evidencia y continuación](../plans/ejecucion-etapa-e-20261103.md).

Desarrollo E1.49: comando del personal sólo service_role con actor de sesión verificada; revalida autoridad compartida tras bloqueos. Campo calculado de revisión sólo authenticated y visibilidad del turno, dentro de la lectura mostrada. Nueve migraciones SQL aprobadas en 41715645324; no son una publicación. Consumidores escritos/79 dirigidos; HTTP y cierre de UPDATE/alta/reasignación comprobados después, en E1.55; contacto y cierre integral pendientes.

Desarrollo E1.51: .100 retira UPDATE autenticado; .110 reutiliza autoridad temporal en alta manual/recuperación y reparación, con control final tras bloqueos. Conserva la responsabilidad de esas RPC, autoría y dueño real de la ficha, sin membresía artificial. Once migraciones aprobadas en SQL 41759448286 y browser del personal en 41757455635, con límites en el registro. No hay cambios de permisos productivos. .120 de revocación por contacto aprobada en SQL 41761097542 (doce migraciones, con límites en registro). Editor de contacto: roja 41761295231 y SQL 41762069407 aprobado para .130, autoridad temporal/rol efectivo/autoría y revalidación final después de historia; trece migraciones con doce esperas. Fast integrado 41762158350 aprobado; vías auxiliares y entrega siguen pendientes.

Actualización E del 4 de noviembre (sin publicar): información auxiliar por canal explícito, wrappers legados sujetos a generación/contacto y alcance clínico propio aprobados en SQL 41787913428. Documentos 20261104020000/consumidores escritos tras roja 41788727620, aprobados en SQL 41790517400 (consumidores integrados: fast 41791538890 y browser clínico 41793557725, límites en registro): pendientes vinculados a generación/contacto, Ready preservado, gracia acotada y revalidación transaccional al completar. Nuevas sobrecargas sólo backend; no habilitan lectura clínica durante suspensión ni emisión de credenciales desde el token de calendario. Evidencia/límites actuales en el registro de ejecución, E1.61–E1.70.

Actualización E, 4 de noviembre, sin publicar (E1.73–E1.82): push decide altas/preparación/feedback por token/canal en SQL y conserva el recibo independiente del dispositivo; SQL 41798812002 y fast 41823253513 con sus alcances. Proyección auxiliar distingue formulario clínico y recordatorios de reserva/reprogramación (SQL 41824317218). OAuth liga nonce a hash/canal original, conserva enlace cifrado y revalida al consumir/conceder; grant/evento durable/auditoría juntos, sin renovar autoridad desde calendario ni retirar conexiones previas por editar email. SQL 41825879784 aprobado (18 migraciones, 41 carreras/dos contraejemplos FK); consumidores con 54 dirigidas y fast 41827070902 (1852/281, cero errores/avisos)/browser ampliado 41827075064 aprobados con sus alcances. La carrera 42 de 41828016563 reprodujo deadlock concesión/callback; corregido con diecinueve y 43 carreras/dos contraejemplos FK aprobados en SQL 41829516097; tipos/digest cotejados. La conciliación externa posterior de b269876 tiene 37 dirigidas modeladas, fast nuevo pendiente. Lease/conciliación inmediata y fronteras restantes de calendario/PDF/retención siguen pendientes. Tracking/borrado y distribución/correo conservan pendientes en el registro, no se consideran protegidos por estas pruebas parciales.


E1.89, 4 de noviembre, todavía sin publicar: veinte añade reclamación dirigida backend con recuperación del mismo owner sin renovar plazo y protege la lease frente a otra concesión. 18/18 grupos propios pasaron en 41841284461; regresión de un comando backend existente corregida, comprobación conjunta/tipos pendientes. Inmediato y lote ya comparten protocolo de propietario/resultado; respuesta SQL perdida no habilita otra escritura por ID, y sólo se libera trabajo conocido como no iniciado. 51 pruebas modeladas aprobadas; tipado/fast nuevos, proveedor real, fronteras restantes/distribución/contacto/correo y cierre E siguen pendientes. El estado incierto de una mutación remota conserva la ventana de reclamación y no se anuncia como rechazo ni entrega.


E1.91: veinte aprobada íntegramente en SQL 41842452349 (18 grupos propios, 45 carreras/dos contraejemplos FK y doce esperas), tipos oficiales importados con digest cotejado. Consumidores y retiro de revocación global del plan 12.27 tienen 65 pruebas modeladas; fast integrado posterior pendiente. Esto actualiza el estado parcial de E1.89 sin atribuir nuevas llamadas reales a Google ni publicación. Tracking/borrado público/retención/distribución/contacto/correo conservan pendientes.


E1.94, sin publicar: consumidores de tracking/ofrecido/retiro/métricas ahora pasan token/canal a comandos propios; transacción SQL de observación incluye contador/actividad/audit y bloqueo final del paciente UPDATE. Métricas Android/Maps conservan audit sin cobertura; lectura mínima ICS estable se preserva. 99 pruebas modeladas aprobadas, veintiuna/48 carreras en SQL 41875359541 todavía pendientes, tipos nuevos/fast/navegador/proveedor sin recibo. No se atribuye protección integral a PDF/distribución/contacto/correo.


E1.95 actualiza lo anterior: SQL 41875359541 aprobado con veintiuna, 15 grupos de observación/18 de lease, 48 carreras/dos contraejemplos FK y doce esperas; tipos oficiales importados con digest cotejado. PDF ampliado usa gestión vigente por su propio canal y conserva renderer/lectura independiente de ICS. 103 pruebas modeladas aprobadas; fast/navegador de esta revisión, proveedor real, retención/distribución/contacto/correo y publicación siguen pendientes.


Actualización E3.24/E3.25, 5 de noviembre, **sin publicar**: SQL29 agrega `prepare_staff_appointment_delivery` y `mark_appointment_whatsapp_reminder_sent`, ejecutables sólo por authenticated, con actor de auth.uid() y owner/admin/reception actuales. No concede el UPDATE directo retirado ni habilita al lector de una lista a emitir credenciales. Mantiene separado el emisor backend. Revalida autoridad tras padre/paciente y después de efectos/auditoría; dieciséis grupos SQL y dieciocho esperas de ayuda aprobados en 42011723187. Recordatorios ya usa estos comandos con formulario POST/revisión mostrada, GET sin emisión y comprobación del teléfono ligada al snapshot; 71 dirigidas locales, fast/browser de esos consumidores pendientes. Señas y detalle aún no conectados. [Registro y límites](../plans/ejecucion-etapa-e-20261103.md#e324--sql29-aprobada-y-tipos-oficiales-incorporados).


E3.30, 5 de noviembre, **sin publicar y pendiente de fast/browser nuevos**, actualiza la conexión de consumidores descrita antes: pedidos de Señas y entrega/vista previa del detalle usan POST explícito, revisión mostrada y SQL29; sus lecturas no seleccionan token legado ni emiten credenciales. El detalle sólo ofrece preparar para contexto/permiso vigentes. Pedido liga normalización de teléfono al valor almacenado en la transacción; actor proviene de sesión. Abrir no acredita envío, y una respuesta incierta no afirma rollback. Noventa dirigidas servidor/puras aprobadas; componentes y recorridos reales de esos consumidores siguen pendientes. El aviso simple de baja por seña conserva su revisión separada pendiente, sin introducir gestión sobre un cancelado. [Evidencia, alcance y siguiente paso](../plans/ejecucion-etapa-e-20261103.md#e330--preparación-explícita-desde-señasdetalle-y-selector-de-formulario-real).


E3.33, 5 de noviembre, **sin publicar**, actualiza los lectores manuales: Recordatorios ya no selecciona token legado ni calcula un mensaje que sus botones no usan. El aviso de baja por seña prepara por POST un borrador con una lectura RLS actual y revisión mostrada, sin emitir credenciales, escribir negocio/dinero ni afirmar envío; mantiene la alternativa de nueva reserva sólo si está disponible. Su responsabilidad de lectura no necesita otro comando SQL. Las fichas bloqueadas/archivadas no ofrecen preparación; el registro de dinero conserva su autoridad independiente. El pedido con vencimiento alcanzado explica el plazo pasado sin exigir una fecha anterior ni inventar otra. 145 dirigidas locales aprobadas; tipos/componentes/browser de estos ajustes todavía pendientes. Browser 42021721105 sí aprobó el recorrido público informado con recuperación/hidratación/dinero/cancelación, cinco anchos/dos temas; el caso personal quedó detenido por una expectativa HTTP del arnés y debe completar su negativa de permiso y demás recorrido. [Evidencia y límites](../plans/ejecucion-etapa-e-20261103.md#e333--recorrido-público-aprobado-lectura-de-mensajes-y-contexto-actuales).


**E3.39, 5 de noviembre — SN14 implementado en desarrollo, sin publicar:** el detalle lee importes y revisión en un SELECT y el personal autorizado registra dinero posterior a la cancelación mediante un comando autenticado separado. No reactiva turno, cambia obligación cerrada, registra devolución ni envía avisos. Evento, auditoría y recibo son atómicos; la corrección conserva el hecho y lo enlaza una sola vez. Dinero tardío neto bloquea reparación de identidad y los reintentos conservan actor/identidad/payload. La pantalla muestra asignaciones exactas y últimos cincuenta registros; el total incluye todos. Veinte grupos SQL pasaron en una corrida detenida después por el arnés de carreras; 87 dirigidas servidor/puras aprobadas. Carreras, tipos oficiales, componentes, navegador y publicación aún pendientes. [Garantías, fallas y evidencia](../plans/ejecucion-etapa-e-20261103.md#e339--detalle-conectado-segunda-corrida-sql-detenida-en-sintaxis-del-arnés).


E3.42 actualiza únicamente la evidencia SQL del párrafo anterior: **42073541134 aprobado**, con veinte grupos y nueve carreras SN14, regresiones y dieciocho esperas previas, sin nuevos deadlocks; 161 migraciones y tipos oficiales reproducibles importados por su digest. La interfaz, navegador y publicación mantienen sus pendientes. [Detalle de revisión y límites](../plans/ejecucion-etapa-e-20261103.md#e342--sql30-y-nueve-carreras-aprobados-tipos-oficiales-importados).


E3.45 actualiza la verificación de interfaz SN14: fast **42076262537 aprobado**, código f4eff44, 2038 servidor/300 cliente y cero errores/avisos. El formulario tardío pertenece al panel de importes; la obligación cerrada conserva su descripción sin acciones. Browser 42076886857 todavía en curso; no hay prueba de banco/correo ni publicación. [Revisión exacta, evidencia y límites](../plans/ejecucion-etapa-e-20261103.md#e345--consumidor-integrado-aprobado-browser-sobre-la-misma-revisión).


**Actualización E3.50, interrupción documental:** personal conserva su caso aprobado en **42078792126** (corrida completa fallida por SN14), con las capas descritas en el registro. Browser **42080552190 terminó fallido** después del rechazo/borrador y registro nativos de 10.000; se detuvo en el clic JS antes de comprobar respuesta ilegible. Recuperación/corrección y visuales SN14 siguen pendientes. No queda esa corrida en curso, ni hay banco/correo/publicación E. Implementación detenida por pedido de Juan; [traspaso técnico, revisiones y evidencia](../plans/traspaso-etapa-e-20261105.md). Los estados de corridas de párrafos anteriores corresponden a sus checkpoints históricos.

## Correo de los turnos (6 de noviembre)

Las tablas de correo están en `private` y nadie las lee directo: todo pasa por funciones.

| Función | Quién | Para qué |
|---|---|---|
| `claim_appointment_email_batch`, `record_appointment_email_results`, `record_email_provider_event`, `run_appointment_email_retention`, `get_email_unsubscribe`, `apply_email_unsubscribe`, `operator_set_business_email_sender` | Sólo `service_role` | El programador, el webhook firmado y la página de baja |
| `list_appointment_email_deliveries`, `resolve_appointment_email_delivery`, `get_business_email_status` | Dueña, administración y recepción de ese consultorio | Ver los correos de un turno y decidir uno en comprobación |
| `save_business_email_contact` | Dueña y administración | Correo donde se reciben las respuestas |
| `operator_get_email_operations`, `operator_set_email_operations` | Sólo `service_role`; la página admite únicamente la cuenta maestra verificada | Crédito, cupo, interruptor y pausas |

Un profesional o una lectura sola no ven la sección de correos del turno. El operador ve estados y conteos, nunca la dirección de un paciente. Pruebas: `appointment_email_delivery.sql` 1 y 31, `appointment_email_operations.sql` 1, y las pruebas de servidor de cada ruta.
