# Matriz de regresiones obligatoria

## Confirmación de correo — entrega del 31 de octubre

V8 `408ca04d9e6750e4657dc087264644665a63fb37` publicada y comprobada. Release exacto `41137595117`: 20/20 fases; navegador fuente 58/58, compilado candidato 58/58 y recuperación compatible 51/51. Prueba productiva `41238345216`: alta pendiente sin alerta, reenvío, corrección de dirección, ingreso no confirmado, enlace de Auth real en otro navegador, rechazo de enlaces falsos/usados y cinco anchos sin desbordes ni errores de ejecución. Ingreso/agenda en ambos dominios y 74 relaciones sin exposición anónima comprobados. [Recibos y límites](../plans/traspaso-confirmacion-email-20261030.md); recepción externa de confirmación no observada. Las entregas anteriores siguientes conservan sus propias revisiones y no son la versión productiva vigente.

Este documento responde a la matriz de la sección 4 del [plan](../plans/refactorizacion-cita-suite.md): qué protege cada punto, qué pruebas lo comprueban y en qué capa. Las corridas que lo demuestran están en el [registro](../plans/registro-refactorizacion-cita-suite.md). La evidencia de cierre es el full de la revisión que se publique, que ejecuta todas estas suites juntas. Una corrida anterior no certifica cambios hechos después de su snapshot.

Capas: **SQL** es PostgreSQL real descartable con las migraciones completas y claims sintéticos (pgTAP); **carreras**, dos conexiones controladas dentro de una prueba (`supabase/tests/run_*.sh`); **unidad**, Vitest de servidor y cliente; **navegador**, Playwright contra GoTrue, PostgREST y Storage reales descartables; **capacidad**, los escenarios de [capacidad](capacidad.md); **staging**, el despliegue aislado.

**Entrega A/B/C del30-oct:** release exacto C9 `deb74b023431e4f173eed85d6651c5073ad44557`, **41082416537**,20/20fases: todas las suites juntas, SQL B25/C15/diez carreras/deadlocks0,53casos de navegador sobre fuente y53sobre el paquete,49de compatibilidadB11/demo3; ninguna omitida, inesperada, inestable ni reintentada. La publicación y las pruebas productivas HTTP/SQL, la recuperación B11→C9, las huellas completas y los límites se contrastan por requisito en el [cierre propio](../plans/cierre-senas-avisos-natalia.md). Las matrices no sustituyen una medición de capacidad ni pruebas de teléfono o Realtime alojado.

## 1. Cruces de consultorio

Lecturas, escrituras, identificadores manipulados y funciones llamadas directamente, sin pasar por la interfaz.

- **SQL:** `tenant_relation_identity.sql` (45 controles: cada relación entre tablas de un consultorio es compuesta y validada, y rechaza un consultorio ajeno aun sin triggers de usuario); `tenant_context_revocation.sql` (paciente ajeno oculto por RLS, RPC directo que no puede modificar otro consultorio, identificador manipulado); `availability_windows.sql` (un miembro no lee el catálogo de otro consultorio, profesional manipulado, profesional o prestación privados fuera de la ventana pública); `patient_archive_actor_scope.sql`, `patient_registration_transaction.sql`, `clinical_direct_write_guards.sql` y `team_editor_atomic_commands.sql` (paciente, consultorio o destino ajenos en cada operación); `clinical_business_storage_budget.sql` (una reserva de carga no puede apuntar a un archivo de otro consultorio, un dueño no lee la cuota ajena); `security_definer_resolution.sql` (una tabla temporal no puede falsificar vínculos ni exponer pacientes); `patient_read_set_based.sql` (un usuario ajeno no ve ningún paciente); `table_privilege_hardening.sql` y `service_role_backend_privileges.sql` (privilegios de tablas y del rol de servidor).
- **SQL, auditoría transversal:**
  - `api_exposure_explicit.sql`: una tabla nueva no recibe permisos automáticos, `anon` no alcanza ninguna relación ni ejecuta ninguna función privilegiada de `public`, y los roles de la API sólo leen y escriben filas.
  - `direct_table_writes.sql` (release, 22 de octubre): ninguna escritura directa por la API reemplaza a las RPC transaccionales, ni en membresías, pacientes, vínculos, asignaciones, altas de turnos, excepciones, profesionales, prestaciones o auditoría. Un administrador no puede hacerse dueño ni quitar al dueño. Las escrituras que la app sí hace con el cliente del usuario siguen funcionando.
  - `write_expression_privileges.sql`: todo rol que puede usar una tabla puede ejecutar las funciones de sus restricciones, valores por defecto, políticas y vistas.
  - `follow_ups_database_rules.sql`: Seguimientos se lee bajo RLS y sólo cambia mediante sus funciones.
  - `user_business_contexts.sql`: los contextos del usuario salen de sus membresías y ayudas vigentes.
  - `assistance_business_settings.sql`: dueño y ayuda guardan con sus propias reglas, y el enlace de reseñas sigue validado.
- **Unidad:** `postgrest-filters.test.ts` (el texto de una búsqueda no puede partir el árbol de filtros de PostgREST). Las guardas `request-identity.test.mjs` (la identidad del pedido es la que verificó `hooks`), `uuid-pattern.test.mjs` (un único patrón de identificador) y `type-escapes.test.mjs` (sin `any` ni dobles conversiones en la app).
- **Capacidad:** ningún turno creado por la carga queda en otro consultorio (`crossPractice` 0), con 5 y 25 consultorios en CI y con los dos del lanzamiento en el ensayo alojado.

## 2. Revocación de membresía, cambio de rol y estados comerciales

- **Horarios liberados:** `appointment_slot_releases.sql` comprueba RLS, escrituras directas rechazadas y ocultar sólo por dueño/admin/recepción, con auditoría única; el actor reutiliza la revalidación bajo bloqueo verificada por las carreras de señas. La ruta valida ID y permiso antes de ejecutar; profesional y sólo lectura no tienen acciones en la interfaz.

- **Señas:** `appointment_deposits.sql` comprueba roles, consultorio ajeno, suspensión, acceso anónimo y rechazo de escrituras directas; `senas.server.test.ts`, `senas-config.server.test.ts`, `abrir.server.test.ts` y `appointment-detail.server.test.ts` cubren rutas y mensajes. SQL no delega el permiso a la pantalla. Ver [registro propio](../plans/registro-senas-avisos-natalia.md) para no confundir las capas aprobadas con las pendientes.

- **SQL:** `tenant_context_revocation.sql` (el contexto refleja el rol nuevo y la revocación de inmediato, también para RPC clínicos directos); `appointment_actor_revalidation.sql` (17 controles: una creación en curso revalida el rol en SQL, la recuperación idempotente no expone el turno a quien perdió el permiso); `patient_archive_actor_scope.sql`, `patient_registration_transaction.sql` y `team_editor_atomic_commands.sql` (membresía revocada, asistencia revocada y pausa comercial); `availability_windows.sql` (la revocación actúa en la siguiente llamada SQL); `role_access_audit.sql`, `team_access_transactions.sql` y `manual_access_then_mp_payment.sql`.
- **Carreras:** `run_appointment_actor_concurrency.sh`, `run_patient_archive_actor_concurrency.sh`, `run_patient_registration_concurrency.sh` y `run_team_editor_concurrency.sh`: el cambio de rol o la revocación entre la comprobación y la escritura.
- **SQL, auditoría transversal:** `user_business_contexts.sql` (una ayuda vencida, terminada o revocada, un soporte deshabilitado o un consultorio sin operación no dan contexto) y `assistance_business_settings.sql` (la ayuda vencida no lee ni guarda).
- **Unidad:** `commercial-access.test.ts`, `odonto-context.test.ts`, `account-assistance.test.ts`, `business-failclosed.test.ts` (la falta de la función de contextos falla cerrada, sin un camino heredado) y `messaging-access.test.ts` (un error de la suscripción no abre la mensajería). `hooks.server.test.ts` y `odonto-context.test.ts` fijan que sólo un pedido que no escribe comparte su lectura de membresías y que nunca se comparte entre pedidos. Las pruebas de retorno de `suscripcion.server.test.ts` y `procesando.server.test.ts` exigen una lectura nueva después de confirmar un pago.
- **Navegador:** `commercial-lock.spec.ts` (pantalla de bloqueo y salida en móvil), `account-assistance.spec.ts` (la ayuda se activa, el equipo configura y pierde acceso al revocar).

## 3. Capacidades diferentes entre consultorios y acceso histórico autorizado

- **SQL:** `clinical_business_storage_budget.sql` (disponibilidad del módulo por consultorio y global, pausa del consultorio, activación y cuotas independientes); `clinical_direct_write_guards.sql` (el dueño restringido conserva historia, perfil y costos; el acceso vencido o archivado cierra todo; solo lectura no gana perfil clínico); `patient_read_set_based.sql` (consultorio restringido: sólo sus dueños leen); `clinical_files_phase1.sql`.
- **Unidad:** `restricted-clinical-read.test.ts`, `team-permissions.test.ts`, `booking-settings.test.ts`.
- **Navegador:** `clinical-storage-policy.spec.ts` (política maestra por consultorio), `patient-structure-ux.spec.ts` (alcance por rol).

## 4. Reservas simultáneas, repetidas y reprogramadas

- **Horarios liberados:** `appointment_slot_releases.sql` prueba OLD de equipo, antigüedad por intervalo, correcciones rápidas, paso desde fecha pasada, ocupación parcial, bloqueos, orden de hechos con marcas iguales, fecha efectiva, cancelación por seña real y rollback si el registro falla. `appointment-slot-releases.spec.ts` recorre cancelación por la UI, reasignación real, desaparición por ocupación y ocultar sin cambiar la disponibilidad. Su ejecución está identificada en el registro; no deducir aprobación de su mera presencia.

- **Señas:** `appointment_deposits.sql` exige seña/Confirmado coherentes y auditoría atómica, fotografía histórica, idempotencia, apagado seguro y condiciones de cancelación. `run_deposit_expiry_concurrency.sh` verifica los dos órdenes de cobro/baja, reprogramación/deshacer, hijos con FK, `skip locked` y apagado de política, con cero bloqueos mutuos. `appointment-deposits.spec.ts` comprueba reserva nativa con condiciones, apertura de WhatsApp interceptando sólo el destino externo, registro real, agenda, vista pública y baja invocada sobre datos sintéticos en PostgreSQL; no simula la persistencia.

- **SQL:** `patient_identity_atomicity.sql` (creación de paciente y turno atómica e idempotente); `price_confirmation_lifecycle.sql` (un reintento tras una respuesta perdida devuelve la reserva confirmada aunque cambie la política); `joint_appointments.sql`; `public_booking_patient_policy.sql`; `availability_windows.sql`.
- **Carreras:** `run_patient_identity_idempotency_concurrency.sh`, `run_public_booking_limit_concurrency.sh`, `run_public_patient_resolution_concurrency.sh`, `run_availability_snapshot_concurrency.sh`, `run_availability_configuration_concurrency.sh`.
- **Unidad:** `public-booking.test.ts`, `appointments.test.ts`, `reschedule.server.test.ts`, `reschedule-push-migration.test.ts`, `public-booking-navigation.test.ts`.
- **Navegador:** `booking-embed.spec.ts` (recupera una reserva confirmada después de una respuesta perdida), `odonto.full.spec.ts` (protección contra solapamiento).
- **Capacidad:** ninguna superposición activa de un profesional (`overlaps` 0) después de la carga, y la reserva pública bajo sus límites, en CI y en el ensayo alojado.

## 5. Restricciones de seguimiento y eliminación de una prestación permitida

- **SQL:** `booking_extension_contracts.sql` (`FAIL_RESTRICTED_SERVICE`: la franja restringida rechaza otra prestación; `FAIL_DELETED_SERVICE_OPENS_RULE`: borrar la prestación permitida deja la franja cerrada); `availability_windows.sql` (una regla restringida sin prestaciones sigue explícitamente restringida).
- **Unidad:** `restrictions.test.ts`, `availability-rules.test.ts`, `public-booking.test.ts` (franja restringida sin prestaciones cerrada en el turnero público), `ProfessionalEditor.client.test.ts` («La franja está cerrada hasta que elijas una prestación»).

## 6. Cuestionarios obligatorios, opcionales y actualización del perfil

- **SQL:** `booking_patient_information.sql` (obligatorios sin atajos, `FAIL_PROFILE_NOT_UPDATED`, respuestas omitidas que no borran el perfil, procedencia, reintentos con el mismo formulario y con un formulario cambiado, recepción sin lectura clínica).
- **Unidad:** `professional-questions.test.ts`, `booking-information.test.ts`, `booking-information-page.test.ts`, `booking-patient-fields.test.ts`, `PublicBookingFlow.client.test.ts`, `ProfessionalBookingFormEditor.client.test.ts`.
- **Navegador:** `booking-embed.spec.ts` (los campos obligatorios antes que los opcionales en la reserva nativa, en todos los anchos; al guardar la información, el paciente vuelve al resumen del turno con el cartel de guardado).

## 7. Historia clínica y documentos bajo cada rol autorizado

- **SQL:** `clinical_direct_write_guards.sql` (34 controles por rol), `clinical_entry_date_edit.sql` (17), `clinical_provenance_triggers.sql`, `clinical_files_phase1.sql`, `appointment_patient_reassignment.sql`, `patient_change_history_atomic.sql` (la línea visible del cambio se escribe en la misma transacción que la ficha, y el autor profesional debe ser el del actor).
- **Unidad:** `clinical-entries.test.ts`, `clinical-files.test.ts`, `patient-permissions.test.ts`, `patient-profile.test.ts`, `patient-detail.server.test.ts`, `PatientHistoryPanel.client.test.ts` (el costo histórico conserva sus centavos), `ClinicalEntryDialog.client.test.ts`.
- **SQL, release:** `clinical_owner_user_deletion.sql`: borrar un usuario conserva su historia clínica, y el autor de una entrada no se puede borrar.
- **Navegador:** `patient-structure-ux.spec.ts` (roles por anchos y preferencias de color), `clinical-files.spec.ts` (dueño, profesional vinculado y recepción, que no descubre documentos ni historia), `clinical-entry-date.spec.ts`.

## 8. Límites de archivos, cargas simultáneas, expiraciones y descarga correcta

- **SQL:** `clinical_business_storage_budget.sql` (52 controles: 5 MB reservados por URL, cuota base de 100 MB, presupuesto global de 700 MB, expiración con margen, ampliación sin perder pendientes); `clinical_storage_reconciliation.sql` (14: estados pendiente, fallido, papelera, listo y derivados, repetible, nunca borra archivos).
- **Carreras:** `run_clinical_upload_limit_concurrency.sh`, `run_clinical_budget_concurrency.sh`.
- **Unidad:** `clinical-upload-availability.test.ts`, `clinical-storage-units.test.ts`.
- **Navegador:** `clinical-files.spec.ts` (un PDF real se descarga con los mismos bytes y el nombre del paciente; la ampliación de cuota y de capacidad global conserva documentos, permisos y cargas pendientes), `clinical-storage-policy.spec.ts`. Las dos corren también sobre el paquete de producción del release, en workerd.
- **Staging:** la reconciliación de almacenamiento bajo el guardia `safeupdate` alojado (`hosted_request_guards.sql`, etapa 6).

## 9. Precios acumulados, excepciones, redondeo, mes 600 y cambios durante la confirmación

- **SQL:** `price_contract_parity.sql` (los mismos vectores que TypeScript, sobre base real); `price_confirmation_lifecycle.sql` (14: la cotización anterior se rechaza después de editar la política, aceptar la nueva crea una sola reserva y los precios históricos no cambian); `booking_extension_contracts.sql` (fotografía histórica).
- **Unidad:** `pricing.test.ts`, `price-parity.test.ts`, `price-contracts.test.ts`, `PricePolicyEditor.client.test.ts`.

## 10. Proveedores lentos, caídos o con resultado incierto

- **Unidad:** `push.test.ts` (cada respuesta del proveedor y una respuesta perdida clasificadas como transitorias, 410 que marca muerto sólo el dispositivo, revalidación antes de enviar, corte por tiempo que libera la reclamación); `web-push-sender.test.ts`; `google-calendar-sync.test.ts` (creación cuya respuesta se perdió recuperada sin duplicar, 503 transitorio); `google-reviews.test.ts` (resultado incierto que espera la recuperación sin reenviar, fallo del cierre después de la aceptación); `mercadopago.test.ts` (500 y 429 reintentables, 404 que pide atención; los cobros finales que no pudieron comprobarse al cancelar dejan un evento que requiere atención); los webhooks de Mercado Pago y de WhatsApp (`webhook.server.test.ts` de cada uno: la firma se verifica antes de leer el cuerpo, que tiene tope); `suscripcion.server.test.ts` (una suscripción ilegible se presenta como desconocida, sin ofrecer actuar sobre ella); `job-budget.test.ts` y `scheduled-jobs.test.ts` (presupuesto de la cadena, fecha límite, recibo negativo sin exponer el error).
- **SQL:** `scheduled_job_batches.sql` y `scheduled_job_queue_scenarios.sql` (reclamaciones, espera persistente, reparto entre consultorios).
- **Realtime ausente o fallando:** `patient-revision-sync.client.test.ts`. La sincronización de pacientes no consulta con la pestaña oculta y se espacia sin Realtime. Al perderlo verifica una sola vez, no en cada reintento del cliente.
- **Control del propio arnés:** `render-health.spec.ts` caracteriza la advertencia nativa de cierre mientras conecta y exige rechazar el mensaje sin cierre observado; `realtime-diagnostics.test.mjs` limita la clasificación al loopback descartable exacto y rechaza 401/403/500, otros destinos y entornos alojados. Estado y evidencia en el registro; no certifica sincronización alojada.
- **Staging:** recuperación de reclamaciones abandonadas y entrega real por FCM (etapa 6).

## 11. Navegación, tema y notificaciones desde Natalia

- **Navegador:** `booking-embed.spec.ts` (fechas reales después de una ventana vacía en la reserva compartida y en la de Natalia, ambas identidades visuales en todos los anchos).
- **Unidad:** `booking-color-mode.test.ts`, `booking-installation.test.ts`, `embed-sdk.test.ts`, `booking-integrations.test.ts`, `booking-integration-request.test.ts`, `push-sw.test.ts`.
- **Natalia:** `qa-natalia-direct-booking.mjs` y la medición de JavaScript e hidratación del full.
- **Staging:** Web Push real desde el enlace de gestión del turnero, en el mismo origen al que navega Natalia (etapa 6). El recorrido desde el sitio de Natalia publicado pertenece a las comprobaciones de release y posteriores a la publicación.

## 12. Vistas de 320, 390, 768, 1280 y 1600 píxeles, contenido largo y teclado

- **Horarios liberados:** `appointment-slot-releases.spec.ts` añade los cinco anchos con nombre profesional largo, `layoutIssues` acumulado, captura alineada y activación por teclado de «Dar este horario»; modo demo sin acciones reales. También recorre el aviso interno de P3: aparece fuera de la agenda, se cierra, no vuelve con el horario ocupado u oculto, y vuelve con uno nuevo.
- **Cancelación desde recepción:** `reception-cancel.spec.ts` usa un rol real de recepción: cancela un turno futuro, un turno pasado o en curso se explica y el comando lo rechaza, y profesional, sólo lectura, otro consultorio y permiso retirado quedan rechazados.
- **Resoluciones reales:** `resolutions.spec.ts` mide 45 pantallas y estados en 26 resoluciones, de 320×568 a 2560×1440, con celulares apaisados, con el contrato de `layoutIssues`, más las pantallas de un profesional real y las etiquetas de la barra inferior. Toda pantalla nueva se suma a esa lista.
- **Volver atrás en la reserva:** `PublicBookingFlow.client.test.ts` exige que el paso aparezca sin animación al volver y animado al avanzar. `booking-embed.spec.ts` toca el enlace después de volver, en los dos temas y a 320 y 1280 px: un toque durante esa animación se perdía.
- **Correos que no se responden** (12.35): `appointment-email-content.test.ts` exige el pie nuevo y prohíbe pedir respuesta; `zoho-email.test.ts` y `appointment-email.test.ts`, que no salga `reply_to`; `appointment_email_delivery.sql` 6 y 20b, que un dominio verificado alcance y que la versión anterior pueda leer el reparto; `page.client.test.ts`, `email-settings.server.test.ts` y `email-preferences.spec.ts`, que la configuración no pida un correo de respuesta.
- **Páginas del paciente sin la marca en la pestaña** (12.35): `PublicInformationPage.client.test.ts` y `RescheduleNoticePage.client.test.ts` exigen el nombre del consultorio en el título, o un título neutro si falta; `booking-information-page.test.ts`, que la página abra aunque el nombre no se pueda leer.
- **Salud del navegador:** `render-health.spec.ts` comprueba en los tres motores que el colector no tapa problemas reales: un estilo rechazado fuera de una captura sigue fallando, y en WebKit también un `fetch` rechazado de otro origen.
- **Nada nativo:** `theme-modes.spec.ts` falla si en una pantalla queda a la vista un selector, una fecha o un campo de archivo del navegador; `native-controls.test.mjs` lo controla en el código. Sólo los recibos completos del registro acreditan su ejecución.

- **Señas:** `appointment-deposits.spec.ts` agrega los cinco anchos en configuración, lista, condiciones previas y turno pendiente/cancelado; Natalia claro y oscuro en las superficies públicas. Acumula `layoutIssues`, alinea cada tarea para la captura y exige comprobaciones de salud del navegador. `odonto.smoke.spec.ts` agrega las páginas nuevas al perfil demo. Estado de ejecución en el registro propio; escribir una matriz no significa haberla aprobado.

- **Guardas de diseño** sobre todas las vistas (`scripts/lib`): `font-weights.test.mjs` (sólo pesos cargados), `heading-kickers.test.mjs` (sin rótulos sobre los títulos), `glyph-icons.test.mjs` (íconos dibujados, no emojis ni glifos), `type-scale.test.mjs` (tamaños de la escala, no literales) y `text-truncation.test.mjs` (el texto de la tarea ajusta; los recortes revisados se declaran). En el navegador, `layoutIssues` reporta además un texto de ayuda más ancho que el espacio de su campo (`clipped-placeholder`), y `login-register-ux.spec.ts` y `patients-real-ux-audit.spec.ts` lo comprueban a 320 y 390 px.
- **Navegador:** `patient-structure-ux.spec.ts` (los cinco anchos, contenido largo y teclado por rol), `access-recovery-ui.spec.ts` (los cinco anchos y teclado), `booking-embed.spec.ts` (cinco anchos en las tareas profesionales y la reserva nativa), `clinical-storage-policy.spec.ts`, `layout-usability.spec.ts` (el detector de palabras comprimidas), `mobile-navigation-ux.spec.ts`, `roles-agenda-regression.spec.ts`. Las matrices visuales usan `layoutIssues` y `alignTaskForCapture` según la [guía de verificación](verificacion.md).

## Observabilidad

El plan pide distinguir viajes HTTP a la base, llamadas a proveedores y trabajo SQL, y que los registros excluyan datos clínicos, tokens y URLs firmadas con retención acotada.

- **Viajes y llamadas:** el presupuesto de tareas cuenta aparte los viajes a la base y las llamadas a proveedores de toda la cadena (`job-budget.test.ts`, `scheduled-jobs.test.ts`). Ningún contador de `fetch` se presenta como cantidad de consultas SQL.
- **Trabajo SQL:** los escenarios de capacidad lo miden con `pg_stat_statements` (sentencias anidadas incluidas), esperas de locks y `auto_explain`.
- **Contenido de los registros:** `platform/logging.ts` registra una etiqueta fija y sólo el SQLSTATE y el estado HTTP del error; `logging.test.ts` comprueba que excluye datos clínicos, tokens, URLs y metadatos arbitrarios. La guarda `scripts/lib/server-logging.test.mjs` recorre el árbol sintáctico del servidor y rechaza cualquier `console` con un error, una plantilla o un alias. `worker-tail` descarta encabezados, consultas y otros registros al recibirlos.
- **Retención:** la telemetría push se conserva 90 días por pg_cron (`scheduled_job_batches.sql`), los eventos de límites de servidor 7 días, y los límites de lectura de integraciones y los intentos de OAuth se depuran. Los intentos de reserva pública (`public_booking_attempts`: teléfono, hash de la dirección y agente de usuario), que nada borraba, se conservan 7 días desde `20261020040000` (`public_booking_attempts_retention.sql`); el limitador sólo lee los últimos 10 y 30 minutos. Los eventos de webhooks de Mercado Pago y de WhatsApp se conservan 180 días (`webhook_events_retention.sql`); `audit_logs` y `patient_profile_change_events` son historia del producto y no se depuran ([control de consumo](control-de-consumo.md)).

## E — pruebas parciales en desarrollo (3 de noviembre; antecedente, E se publicó el 6)

Las notas de E de esta sección y la siguiente conservan su fecha y su estado de entonces: donde dicen «sin publicar», hoy ya está publicado. La aceptación vigente está en la [matriz de E](../plans/ejecucion-etapa-e-20261103.md#matriz-de-seguimiento).

La [matriz identificada de E](../plans/etapa-e-correo-autogestion.md#4-matriz-completa-de-casos-y-aceptación) es la fuente única de casos EM/AC/RP/SN/RM/ZH/UI/OP. El [contraste C01–C13](../plans/etapa-e-correo-autogestion.md#2-contraste-con-el-código-qué-se-reutiliza-y-qué-debe-cambiar) es una revisión estática, no una corrida.

Al implementar: pruebas negativas antes de la corrección, SQL de atomicidad/historia/roles, carreras controladas en ambos órdenes y con el mismo estado de turno, unidades de tiempo/importe/plantillas, navegador real y correo real en buzones acordados. Verificar respuesta perdida después de guardar, resultado incierto del proveedor, identidad corregida sin fugas de credenciales, crédito acumulado, último momento y presupuesto de tareas existentes. La evidencia de cada capa debe indicar revisión, resultado y límites. Los dos envíos previos que informó Juan no son prueba integral de E.

Los casos de E no se marcan aprobados por actualizar este documento ni por reutilizar los verdes históricos de A/B/C o de Auth. La ejecución está autorizada en [12.20](../plans/propuesta-senas-avisos-natalia.md#ejecucion-e-autorizada); el [registro activo](../plans/ejecucion-etapa-e-20261103.md) conserva los 97 casos sin aceptación integral y sus pruebas parciales por fuente, sin atribuir ejecución a lo que aún no se probó.

## E — cobertura en desarrollo del 3 de noviembre (antecedente)

El [registro activo de E](../plans/ejecucion-etapa-e-20261103.md) conserva resultados por fuente/capa y los 97 casos. SQL parcial aprobado no acredita correo ni app completa. El spec `patient-management.spec.ts` usa fixtures descartables propios y etiqueta candidate-behavior para movimiento/dinero/repetición/revocación/sin JS y matrices de tema/ancho; dos recorridos aprobados en 41708652093, incluida la pregunta antes de desplazar y el resultado guardado en viewport; fuentes y límites en el registro. No cambia la compatibilidad de recuperación ni certifica producción. Personal/ayuda/contacto/cola y proveedor permanecen pendientes.


**E quedó publicada el 6 de noviembre.** Las notas siguientes conservan su fecha y su estado de entonces.

E3.24/E3.25, 5 de noviembre, **pendiente de verificación integrada y publicación**: Recordatorios debe preservar Hoy/Mañana, cobertura de push/calendario, normalización del teléfono, confirmación explícita de reapertura y texto neutral. Preparar por POST y marcar manualmente delegan efectos/auditoría a SQL29, sin UPDATE crudo ni emisión por GET. La revisión mostrada no puede cubrir otro horario/identidad; rechazo o resultado incierto no se anuncian como envío ni rollback confirmado. SQL 42011723187 aprueba dieciséis grupos nuevos y seis esperas adicionales (dieciocho totales); 71 dirigidas de modelos/servidor aprobadas. Navegador/tipado/cliente nuevos, Señas/detalle y proveedor conservan sus pendientes. [Evidencia por revisión](../plans/ejecucion-etapa-e-20261103.md#e325--consumidor-de-recordatorios-conectado-fastbrowser-pendientes).


E3.30, 5 de noviembre, **sin publicar y pendiente de fast/browser nuevos**, actualiza la conexión de consumidores descrita antes: pedidos de Señas y entrega/vista previa del detalle usan POST explícito, revisión mostrada y SQL29; sus lecturas no seleccionan token legado ni emiten credenciales. El detalle sólo ofrece preparar para contexto/permiso vigentes. Pedido liga normalización de teléfono al valor almacenado en la transacción; actor proviene de sesión. Abrir no acredita envío, y una respuesta incierta no afirma rollback. Noventa dirigidas servidor/puras aprobadas; componentes y recorridos reales de esos consumidores siguen pendientes. El aviso simple de baja por seña conserva su revisión separada pendiente, sin introducir gestión sobre un cancelado. [Evidencia, alcance y siguiente paso](../plans/ejecucion-etapa-e-20261103.md#e330--preparación-explícita-desde-señasdetalle-y-selector-de-formulario-real).


E3.33, 5 de noviembre, **sin publicar**, actualiza los lectores manuales: Recordatorios ya no selecciona token legado ni calcula un mensaje que sus botones no usan. El aviso de baja por seña prepara por POST un borrador con una lectura RLS actual y revisión mostrada, sin emitir credenciales, escribir negocio/dinero ni afirmar envío; mantiene la alternativa de nueva reserva sólo si está disponible. Su responsabilidad de lectura no necesita otro comando SQL. Las fichas bloqueadas/archivadas no ofrecen preparación; el registro de dinero conserva su autoridad independiente. El pedido con vencimiento alcanzado explica el plazo pasado sin exigir una fecha anterior ni inventar otra. 145 dirigidas locales aprobadas; tipos/componentes/browser de estos ajustes todavía pendientes. Browser 42021721105 sí aprobó el recorrido público informado con recuperación/hidratación/dinero/cancelación, cinco anchos/dos temas; el caso personal quedó detenido por una expectativa HTTP del arnés y debe completar su negativa de permiso y demás recorrido. [Evidencia y límites](../plans/ejecucion-etapa-e-20261103.md#e333--recorrido-público-aprobado-lectura-de-mensajes-y-contexto-actuales).


**E3.39, 5 de noviembre — SN14 implementado en desarrollo, sin publicar:** el detalle lee importes y revisión en un SELECT y el personal autorizado registra dinero posterior a la cancelación mediante un comando autenticado separado. No reactiva turno, cambia obligación cerrada, registra devolución ni envía avisos. Evento, auditoría y recibo son atómicos; la corrección conserva el hecho y lo enlaza una sola vez. Dinero tardío neto bloquea reparación de identidad y los reintentos conservan actor/identidad/payload. La pantalla muestra asignaciones exactas y últimos cincuenta registros; el total incluye todos. Veinte grupos SQL pasaron en una corrida detenida después por el arnés de carreras; 87 dirigidas servidor/puras aprobadas. Carreras, tipos oficiales, componentes, navegador y publicación aún pendientes. [Garantías, fallas y evidencia](../plans/ejecucion-etapa-e-20261103.md#e339--detalle-conectado-segunda-corrida-sql-detenida-en-sintaxis-del-arnés).


E3.42 actualiza únicamente la evidencia SQL del párrafo anterior: **42073541134 aprobado**, con veinte grupos y nueve carreras SN14, regresiones y dieciocho esperas previas, sin nuevos deadlocks; 161 migraciones y tipos oficiales reproducibles importados por su digest. La interfaz, navegador y publicación mantienen sus pendientes. [Detalle de revisión y límites](../plans/ejecucion-etapa-e-20261103.md#e342--sql30-y-nueve-carreras-aprobados-tipos-oficiales-importados).


E3.45 actualiza la verificación de interfaz SN14: fast **42076262537 aprobado**, código f4eff44, 2038 servidor/300 cliente y cero errores/avisos. El formulario tardío pertenece al panel de importes; la obligación cerrada conserva su descripción sin acciones. Browser 42076886857 todavía en curso; no hay prueba de banco/correo ni publicación. [Revisión exacta, evidencia y límites](../plans/ejecucion-etapa-e-20261103.md#e345--consumidor-integrado-aprobado-browser-sobre-la-misma-revisión).


**Actualización E3.50, interrupción documental:** personal conserva su caso aprobado en **42078792126** (corrida completa fallida por SN14), con las capas descritas en el registro. Browser **42080552190 terminó fallido** después del rechazo/borrador y registro nativos de 10.000; se detuvo en el clic JS antes de comprobar respuesta ilegible. Recuperación/corrección y visuales SN14 siguen pendientes. No queda esa corrida en curso, ni hay banco/correo/publicación E. Implementación detenida por pedido de Juan; [traspaso técnico, revisiones y evidencia](../plans/traspaso-etapa-e-20261105.md). Los estados de corridas de párrafos anteriores corresponden a sus checkpoints históricos.

## E — regresiones encontradas en este encargo (6 de noviembre)

- **Webhook de Zoho:** `webhook.server.test.ts` cubre la muestra sin firma que no se guarda y el rechazo de firmas inválidas; `zoho-email.test.ts`, las cuatro formas del panel, incluidas `email_delivery` y `fbl_compliant`.

| Regresión | Causa | Qué la protege |
|---|---|---|
| Un panel abierto antes de hidratar se cerraba solo | `open={expr}` asigna sin condición al hidratar | `e2e/late-deposits.spec.ts` |
| Sin JavaScript, cancelar o guardar desde `/gestion` daba 403 | `Referrer-Policy: no-referrer` hace que el navegador envíe `Origin: null` | `e2e/patient-management.spec.ts` y `patient-management-clinical.spec.ts` sobre el paquete; constante `FORM_PAGE_REFERRER_POLICY` |
| «Pedir seña por WhatsApp» y los demás mensajes preparados no abrían nada | Son formularios que redirigen a WhatsApp, y `form-action` también se aplica a la redirección | `e2e/appointment-deposits.spec.ts` y `staff-delivery.spec.ts` sobre el paquete; `form-action` en `svelte.config.js` |
| «Listo» con un remitente que no podía enviar | Se miraba sólo el dominio | Prueba de cliente de `/odonto/configuracion/correo` |
| Una falla de almacenamiento frenaba la retención | Las dos limpiezas iban en serie | `scheduled-jobs.test.ts` |
| Dos reclamos de correo se esperaban o repetían un mensaje | Protegido por `skip locked` | `run_appointment_email_concurrency.sh`, con mutaciones 42144983908 y 42145538367 |

**Por qué sólo se ven en el paquete:** el servidor de desarrollo no aplica ni el control de origen ni la política de seguridad de contenido. Una prueba de formularios, redirecciones o cabeceras sólo vale corrida sobre el paquete.

**Para correr la suite completa:** una falla reinicia el trabajador de Playwright y pierde la sesión en memoria, así que cada falla gasta un ingreso. Con el límite real de 5 cada 15 minutos, unas pocas fallas arrastran a todas las pruebas siguientes. Hay que leer primero las fallas más tempranas.
