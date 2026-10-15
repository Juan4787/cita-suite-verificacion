# Matriz funcional y contratos de preservación

Fuente normativa: [plan íntegro](../plans/refactorizacion-cita-suite.md). Avance y evidencia: [registro separado](../plans/registro-refactorizacion-cita-suite.md).

Esta matriz identifica los recorridos existentes. La presencia de una prueba en la columna de evidencia no acredita todas las capas: SQL, unidad, Auth/Storage, navegador y staging tienen resultados independientes. El estado de cierre está en el registro.

| Recorrido | Actor y alcance | Garantías que conservar | Pruebas existentes relacionadas |
|---|---|---|---|
| Sesión y selección de consultorio | Usuario autenticado, membresía activa | Identidad verificada, cambio de consultorio, revocación, ausencia de mezcla de contexto | `user_business_contexts.sql`, `role_access_audit.sql`, `odonto-context.test.ts`, `roles-agenda-regression.spec.ts` |
| Administración comercial | Dueño, maestro o proveedor según operación | Estado activo/restringido/archivado, firma, repetición y conciliación | `manual_access_then_mp_payment.sql`, `commercial-access.test.ts`, `commercial-lock.spec.ts` |
| Equipo y prestaciones | Actor autorizado del consultorio | Asignaciones dentro del consultorio, duración, baja e invariantes de servicios predeterminados | `default_professional_services_backfill.sql`, `pending_attending_profiles.sql`, `booking-settings.test.ts` |
| Horarios y restricciones | Dueño/profesional con alcance | Disponibilidad base, excepciones, franjas por prestaciones; restricción vacía cerrada | `booking_extension_contracts.sql`, `availability-rules.test.ts`, `restrictions.test.ts` |
| Lectura de disponibilidad | Público autorizado o miembro | Mismo motor, datos completos y acotados, intervalos base/márgenes, privacidad | `availability.audit.test.ts`, `availability-snapshot.test.ts`, `booking-embed.spec.ts` |
| Reserva y reprogramación | Paciente mediante enlace o miembro | Exclusión, identidad, idempotencia, revalidación, límites contra abuso | `joint_appointments.sql`, `patient_identity_atomicity.sql`, tres scripts de concurrencia de identidad/reserva pública |
| Aranceles | Configurador y paciente | Pesos enteros, acumulación exacta, vigencia, cotización vinculada y fotografía histórica | `booking_extension_contracts.sql`, `pricing.test.ts`, `qa-booking-extensions.mjs` |
| Cuestionarios y datos | Profesional configura; paciente responde | Requeridos/opcionales, versiones, persistencia y trazabilidad sin mezclar perfiles | `booking_patient_information.sql`, `professional-questions.test.ts`, `booking-embed.spec.ts` |
| Ficha e historia clínica | Profesional y demás roles autorizados | Identidad, alcance, historial, procedencia y cambios concurrentes | `clinical_provenance_triggers.sql`, `appointment_patient_reassignment.sql`, `patients-appointments-ux.spec.ts` |
| Documentos | Paciente y profesional según permiso | Archivo privado, tamaño real, cuotas, reserva de bytes, expiración, descarga correcta | `clinical_files_phase1.sql`, `run_clinical_upload_limit_concurrency.sh`, `clinical-files.spec.ts`, `qa-booking-extensions.mjs` |
| Seguimientos | Miembro autorizado | Filtros, asignación, estado, revocación y concurrencia | `follow-ups.test.ts`, `follow-ups-concurrency.test.ts`, `seguimientos.spec.ts` |
| Exportación | Actor con permiso | Coherencia de fotografía, privacidad, caducidad y exclusión global | `patient_data_exports.sql`, ambos scripts de concurrencia de exportación, `patient-exports.test.ts` |
| Sitios y Natalia | Configurador y visitante | Orígenes exactos, alcance, navegación nativa, tema y misma aplicación de reserva | `booking_integration_foundation.sql`, `booking-integrations.test.ts`, `qa-natalia-direct-booking.mjs` |
| Gestión y notificaciones | Token del turno/dispositivo autorizado | Alcance mínimo, permisos por origen, privacidad y recuperación | `push_notification_click.sql`, `push_device_separation.sql`, `push.test.ts` |
| Calendario y reseñas | Tarea interna con credencial | Reclamación atómica, revalidación, entrega incierta y reintentos persistentes | `google_review_requests.sql`, `google-calendar-sync.test.ts`, `google-reviews.test.ts` |

## Verificación de las capas

- Unidad/cliente: `verify:fast` exige ejecución real y tipos de ambas aplicaciones.
- SQL: reconstrucción descartable de todas las migraciones, descubrimiento de todas las suites pgTAP y siete scripts de carreras.
- Integración local: GoTrue, PostgREST y Storage reales; perfiles productivo local y demo separados.
- OAuth de Google real: las dos suites existentes dependen de proveedor/cuentas externos; no cuentan como aprobadas por la ejecución local. Se registrará su límite expresamente en la auditoría.
- Staging y capacidad alojada: no se deducen de las pruebas locales; necesitan destino aislado y acceso verificados.

## Interfaces y migraciones

Los contratos públicos existentes y los tokens de gestión se mantienen. No se alteran migraciones aplicadas. Un nuevo contrato SQL incompatible se versiona y conserva compatibilidad durante la transición. El catálogo efectivo deberá extraerse de una base reconstruida; contar declaraciones en archivos no equivale a contar funciones activas.
