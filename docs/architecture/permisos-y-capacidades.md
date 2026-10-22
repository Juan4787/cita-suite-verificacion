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

Cada celda supone el estado `active` o `grace`. En `restricted`, la columna «Lectura en restricción» indica qué queda.

| Acción | Dueño | Admin | Recepción | Profesional | Sólo lectura | Lectura en restricción | Fuente |
|---|---|---|---|---|---|---|---|
| Agenda del consultorio | ✓ | ✓ | ✓ | Sus turnos (`mis-turnos`) | Ver | — | `canOperate`; navegación por rol en `+layout.svelte` |
| Crear turnos | ✓ | ✓ | ✓ | — | — | — | `resolvePatientPermissions.canCreateAppointment` |
| Ver pacientes | ✓ | ✓ | ✓ | Los de sus vínculos activos | ✓ | Dueño y admin | RLS de `patients` (`20261020020000`), `patient_read_set_based.sql` |
| Editar datos del paciente | ✓ | ✓ | ✓ | ✓ | — | — | `canEditPatient` |
| Archivar paciente | Global | Global | — | Su vínculo | — | — | `canArchivePatient`, `patient_archive_actor_scope.sql` |
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
| Asignar roles | Todos | Salvo dueño; admin sólo con ayuda | — | — | — | — | `canAssignTeamRole` |
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
