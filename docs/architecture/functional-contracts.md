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
- SQL: reconstrucción descartable de todas las migraciones, descubrimiento de todas las suites pgTAP y descubrimiento de todos los scripts de carreras; cada recibo fija la cantidad y los resultados de su revisión.
- Integración local: GoTrue, PostgREST y Storage reales; perfiles productivo local y demo separados.
- OAuth de Google real: las dos suites existentes dependen de proveedor/cuentas externos; no cuentan como aprobadas por la ejecución local. Se registrará su límite expresamente en la auditoría.
- Staging y capacidad alojada: no se deducen de las pruebas locales; necesitan destino aislado y acceso verificados.

## Interfaces y migraciones

Los contratos públicos existentes y los tokens de gestión se mantienen. No se alteran migraciones aplicadas. Un nuevo contrato SQL incompatible se versiona y conserva compatibilidad durante la transición. El catálogo efectivo deberá extraerse de una base reconstruida; contar declaraciones en archivos no equivale a contar funciones activas.


## Operaciones extraídas durante etapa5

| Entrada pública | Contrato/autoridad | Verificación que corresponde |
|---|---|---|
| `patients/public/patient-detail.ts`, `patient-profile.ts`, `clinical-entries.ts`, `patient-archive.ts` | Proyecciones/ficha/entrada/archivo; contexto de paciente y SQL autenticado por alcance. | Contratos JSON, conflictos, fecha/zona, costos históricos, autores, archivo global/personal y revocación. Ver recibos de etapa5. |
| `team/public/professional-editor.ts` | Lectura completa, perfil, servicios, horarios, excepciones y guardado conjunto. Un error de lectura no fabrica una lista vacía. | SDK simulado + cliente real + SQL atómico + navegador con lectura posterior. |
| `team/public/service-editor.ts` | Creación/asignación SQL; edición con token de versión de apertura. | Creación confirmada, fallo intermedio, conflicto y preservación del borrador. |
| `team/public/professional-lifecycle.ts` | Conteos informativos y eliminación autenticada con nueva revisión definitiva de dependencias. Archivo/restauración conservan RLS. | JSON inválido, revocación, historia clínica/turnos/seguimientos, fallo de limpieza y concurrencia. |
| `scheduling/public/availability.ts`, `availability-snapshot.ts`, contratos puros `availability/*` | Calculador único y ventanas SQL acotadas; ámbitos público/interno distintos. | Equivalencia, no truncamiento, configuración concurrente y errores explícitos. |
| `sites/public/booking-integrations.ts`, `booking-integration-request.ts`, `booking-profile-config.ts` | Configuración/presentación/orígenes; ninguna marca otorga permisos. | Autorización, retorno/origen manipulado, misma reserva nativa y ambos temas. |
| `platform/logging.ts` | Diagnóstico de metadatos; etiqueta estática sin serializar errores/pacientes/URLs. | Guarda AST y errores de entorno/proveedor. No constituye un contador de SQL. |

Los nombres anteriores son entradas reales, sin barrel masivo. La [guía de nuevas funciones](guia-nuevas-funciones.md) explica cómo ampliar contratos, permisos y pruebas sin duplicar reglas. Una entrada documentada no acredita por sí sola que se haya publicado.

### RPC compatibles incorporados en esta etapa

- `update_clinical_entry_with_date_safely`: conserva el RPC anterior; añade fecha autorizada y rollback de contenido/costo cuando falla.
- `set_patient_archive_state_safely`: firma anterior conservada; dueño/admin global y profesional sólo su vínculo activo, con autoridad bloqueada/revalidada.
- `create_professional_service_safely`: creación/asignación/auditoría en una transacción; identificador repetido con el mismo payload no duplica.
- `get_professional_dependency_counts`: cita principal y profesionales de la cita se cuentan sin duplicar; no es autorización para borrar.
- `delete_professional_safely`: permisos vigentes, preservación de historial y limpieza atómica. Conflicto de bloqueo inmediato se informa para revisión, sin retry ciego.

Los tipos de estas funciones provienen del generador fijado sobre la reconstrucción completa; consultar firmas exactas en `packages/shared/src/database.types.ts` y migraciones nuevas, no inventar un consumidor a partir de esta descripción. Las migraciones y verificación alojadas corresponden al release posterior.

### Equipo y registro manual consolidados

- `access/public/team-access.ts`: listado íntegro validado y concesión de acceso autenticada; no escaneo del directorio Auth ni escrituras administrativas separadas. `upsert_business_role_access` conserva firma/ACL; autorización bloqueada y perfiles atendibles preservados.
- `team/public/member-profile.ts`: preparación del wizard y operaciones `create_team_member_profile`/`make_team_member_attending`. Perfil/defaults/prestaciones/horarios/invitación/auditoría forman una transacción; pendiente conserva perfil oculto. Fallo intermedio revierte todos los efectos.
- `patients/public/patient-registration.ts`: `register_patient_safely` confirma ficha/vínculo juntos; el DNI existente se recupera sin sobrescribir demografía y nombres/teléfonos siguen compartibles. Retorno incompleto no informa éxito ni dispara compensación administrativa.
- El parser y mapping horario único viven en `lib/team/professional-form.ts`. Los helpers de sincronización HTTP de asignaciones y el fallback horario sin consumidores se retiraron, sin alterar RPC públicos aplicados.

Estos consumidores y su descomposición son parte de la matriz de cierre de etapa5, cuyo estado/evidencia vigente está en `evidencia-etapa5-estructura.md`. No deducir publicación de estas firmas ni capacidad alojada de su aprobación en base descartable.
