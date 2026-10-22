# Matriz de regresiones obligatoria

Este documento responde a la matriz de la sección 4 del [plan](../plans/refactorizacion-cita-suite.md): qué protege cada punto, qué pruebas lo comprueban y en qué capa. Las corridas que lo demuestran están en el [registro](../plans/registro-refactorizacion-cita-suite.md). La evidencia de cierre es el full de la revisión que se publique, que ejecuta todas estas suites juntas. Una corrida anterior no certifica cambios hechos después de su snapshot.

Capas: **SQL** es PostgreSQL real descartable con las migraciones completas y claims sintéticos (pgTAP); **carreras**, dos conexiones controladas dentro de una prueba (`supabase/tests/run_*.sh`); **unidad**, Vitest de servidor y cliente; **navegador**, Playwright contra GoTrue, PostgREST y Storage reales descartables; **capacidad**, los escenarios de [capacidad](capacidad.md); **staging**, el despliegue aislado.

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
- **Unidad:** `professional-questions.test.ts`, `booking-information.test.ts`, `booking-patient-fields.test.ts`, `PublicBookingFlow.client.test.ts`, `ProfessionalBookingFormEditor.client.test.ts`.
- **Navegador:** `booking-embed.spec.ts` (los campos obligatorios antes que los opcionales en la reserva nativa, en todos los anchos).

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

- **Guardas de diseño** sobre todas las vistas (`scripts/lib`): `font-weights.test.mjs` (sólo pesos cargados), `heading-kickers.test.mjs` (sin rótulos sobre los títulos), `glyph-icons.test.mjs` (íconos dibujados, no emojis ni glifos), `type-scale.test.mjs` (tamaños de la escala, no literales) y `text-truncation.test.mjs` (el texto de la tarea ajusta; los recortes revisados se declaran). En el navegador, `layoutIssues` reporta además un texto de ayuda más ancho que el espacio de su campo (`clipped-placeholder`), y `login-register-ux.spec.ts` y `patients-real-ux-audit.spec.ts` lo comprueban a 320 y 390 px.
- **Navegador:** `patient-structure-ux.spec.ts` (los cinco anchos, contenido largo y teclado por rol), `access-recovery-ui.spec.ts` (los cinco anchos y teclado), `booking-embed.spec.ts` (cinco anchos en las tareas profesionales y la reserva nativa), `clinical-storage-policy.spec.ts`, `layout-usability.spec.ts` (el detector de palabras comprimidas), `mobile-navigation-ux.spec.ts`, `roles-agenda-regression.spec.ts`. Las matrices visuales usan `layoutIssues` y `alignTaskForCapture` según la [guía de verificación](verificacion.md).

## Observabilidad

El plan pide distinguir viajes HTTP a la base, llamadas a proveedores y trabajo SQL, y que los registros excluyan datos clínicos, tokens y URLs firmadas con retención acotada.

- **Viajes y llamadas:** el presupuesto de tareas cuenta aparte los viajes a la base y las llamadas a proveedores de toda la cadena (`job-budget.test.ts`, `scheduled-jobs.test.ts`). Ningún contador de `fetch` se presenta como cantidad de consultas SQL.
- **Trabajo SQL:** los escenarios de capacidad lo miden con `pg_stat_statements` (sentencias anidadas incluidas), esperas de locks y `auto_explain`.
- **Contenido de los registros:** `platform/logging.ts` registra una etiqueta fija y sólo el SQLSTATE y el estado HTTP del error; `logging.test.ts` comprueba que excluye datos clínicos, tokens, URLs y metadatos arbitrarios. La guarda `scripts/lib/server-logging.test.mjs` recorre el árbol sintáctico del servidor y rechaza cualquier `console` con un error, una plantilla o un alias. `worker-tail` descarta encabezados, consultas y otros registros al recibirlos.
- **Retención:** la telemetría push se conserva 90 días por pg_cron (`scheduled_job_batches.sql`), los eventos de límites de servidor 7 días, y los límites de lectura de integraciones y los intentos de OAuth se depuran. Los intentos de reserva pública (`public_booking_attempts`: teléfono, hash de la dirección y agente de usuario), que nada borraba, se conservan 7 días desde `20261020040000` (`public_booking_attempts_retention.sql`); el limitador sólo lee los últimos 10 y 30 minutos. Los eventos de webhooks de Mercado Pago y de WhatsApp se conservan 180 días (`webhook_events_retention.sql`); `audit_logs` y `patient_profile_change_events` son historia del producto y no se depuran ([control de consumo](control-de-consumo.md)).
