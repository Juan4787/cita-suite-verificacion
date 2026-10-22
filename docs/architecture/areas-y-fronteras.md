# Áreas y fronteras de Cita Suite

Fuente normativa: [plan aprobado](../plans/refactorizacion-cita-suite.md), etapas 2/5/6. Estado al 22 de octubre: etapa 5 cerrada sobre `6746491`, full 39276578152, con la [matriz de evidencia](evidencia-etapa5-estructura.md); etapa 6 verificada en staging, con transición de producción y límites de CPU pendientes de release. La fuente/resultado de cada lote pertenece al [registro](../plans/registro-refactorizacion-cita-suite.md).

## Responsabilidades y contratos

| Área | Propietaria de | Entradas previstas |
|---|---|---|
| access | Identidad, contexto, membresías, ayuda y operación comercial | `server/access/public/*`; contratos puros `lib/access/*` |
| team | Profesionales, prestaciones, asignaciones y configuración de horarios | `server/team/public/*`; contratos puros cuando sean compartidos |
| scheduling | Disponibilidad, reserva, reprogramación, cotización y recordatorios operativos | `server/scheduling/public/*`; calculador/contratos compartidos |
| patients | Identidad, perfil, preguntas, clínica, documentos, seguimientos y exportaciones | `server/patients/public/*`; formas HTTP/puras compartidas |
| integrations | Adaptadores/procesamiento de push, calendario, reseñas y pagos | `server/integrations/public/*`; tareas con contexto propio |
| sites | Configuración de sitios, orígenes, integración y presentación pública | `server/sites/public/*`; contratos de presentación |

`server/platform` aloja únicamente mecanismos transversales de infraestructura (cliente Supabase, límites, firma, auditoría y datos demo). No constituye un séptimo negocio ni puede convertirse en depósito de reglas. PostgreSQL mantiene integridad/aislamiento/transacciones; el calculador TS sigue único.

Cada entrada pública por operación contiene su implementación y exporta su contrato TypeScript. No se añade un coordinador vacío por función ni un índice que importe todas las áreas/proveedores; así se evitan ciclos artificiales y carga accidental. Los detalles extraídos viven en `internal/`, inaccesibles desde fuera del área. Se permite dependencia entre entradas públicas; se prohíben ciclos de módulos, incluidos tipos. El código compartido con navegador usa contratos sin dependencias privadas, nunca import de un servidor aunque sea type-only.

La primera extracción elimina la separación artificial entre formas de UI y tipos dentro de módulos privados: contexto de negocio y recordatorios tienen contratos propios; la política comercial pura conserva sus funciones y validación en un único módulo sin env ni sesión. La autorización definitiva continúa en servidor/SQL.

## Criterios de cierre y evidencia

Los criterios siguientes se verificaron para el cierre de etapa 5 en su matriz; no son una lista actual de tareas por implementar. El release sobre el artefacto compilado, la capacidad alojada y la identidad externa conservan las puertas de la [auditoría final](auditoria-final.md).

- Extraer recorridos completos, controladores delgados y componentes por tarea/estado; mover archivos no satisface por sí solo este objetivo.
- Aplicar fronteras a las seis áreas sin una exclusión general del código anterior, con pruebas adversarias reales de imports privados/servidor/ciclos.
- Mantener contratos/rutas/diseños, controles mejorados, orden de datos, validación de retornos y transporte nativo de Natalia.
- Corregir y comprobar deuda de presentación/logs/SSR registrada, matriz320/390/768/1280/1600, teclado/foco/errores/carga/contenido largo y presupuesto de JS/hidratación.
- Preparar identidad y transición de repositorio/proveedores sin activar producción; ejecución externa conjunta en release autorizado.
- Fast/full y auditoría de esta revisión exacta antes de cerrar. Cursos/noticias permanecen fuera.

## Trazabilidad de la extracción inicial

[module-relocations.json](module-relocations.json) conserva ubicaciones anteriores/nuevas y el diff real entre snapshotsccb1398/e30daa4, incluyendo imports operativos, scripts y pruebas. El diff Git se usa como inventario completo; el log auxiliar del transformador no sustituye esa referencia. Las operaciones extraídas después tienen sus fuentes y verificaciones propias. Ningún movimiento equivale por sí solo al cierre de la etapa.

## Cambios posteriores al mapa inicial de extracción

`module-relocations.json` conserva evidencia histórica de la primera extracción, no un listado obligatorio de archivos que deban seguir existiendo. Después se retiraron `team/public/professional-services.ts` y su sincronización HTTP sin consumidores: normalización de IDs en `lib/team/professional-form.ts`, mutaciones en los RPC autenticados. El fallback semanal de borrar/reinsertar también desaparece; no restaurarlo como compatibilidad implícita.

Recorridos adicionales reales: `access/public/team-access.ts` valida lista/resultado de acceso; `team/public/member-profile.ts` prepara el alta y delega transacciones completas; `patients/public/patient-registration.ts` confirma ficha y vínculo juntos. Las rutas siguen siendo adaptadores HTTP/contexto y errores humanos. SQL mantiene autoridad y rollback, sin clientes administrativos para compensar un resultado incierto.

UI por tareas: `ProfessionalEditor` coordina base/borrador/versiones y paneles de perfil, servicios, horarios y ciclo de vida; `TeamMemberWizard` posee pasos y envío del alta; el listado de Equipo conserva accesos/perfil atendible/eliminación. Separar el wizard por intención evita convertir cada paso en una API de decenas de props sin estado propio. No hay un objetivo artificial de líneas por componente. Para ampliar, usar la guía de nuevas funciones y proteger los contratos con pruebas de estado y recorridos reales.

Tema: Cita Suite conserva diseño oscuro único; se verifica bajo preferencias clara/oscura del navegador. Natalia sí ofrece ambos modos reales; sus tokens semánticos siguen separados de reglas/permisos. No confundir preferencia del sistema, marca y capacidades. Capturas y recibos finales deben nombrar esa diferencia explícitamente.
