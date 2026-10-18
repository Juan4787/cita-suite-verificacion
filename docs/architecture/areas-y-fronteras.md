# Áreas y fronteras de Cita Suite

Fuente normativa: [plan aprobado](../plans/refactorizacion-cita-suite.md), etapas2/5/6. Estado: etapa5 en ejecución; no se declara completada por reorganizar directorios. La fuente/resultado de cada lote pertenece al [registro](../plans/registro-refactorizacion-cita-suite.md).

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

## Puertas de cierre pendientes

- Extraer recorridos completos, controladores delgados y componentes por tarea/estado; mover archivos no satisface por sí solo este objetivo.
- Aplicar fronteras a las seis áreas sin una exclusión general del código anterior, con pruebas adversarias reales de imports privados/servidor/ciclos.
- Mantener contratos/rutas/diseños, controles mejorados, orden de datos, validación de retornos y transporte nativo de Natalia.
- Corregir y comprobar deuda de presentación/logs/SSR registrada, matriz320/390/768/1280/1600, teclado/foco/errores/carga/contenido largo y presupuesto de JS/hidratación.
- Preparar identidad y transición de repositorio/proveedores sin activar producción; ejecución externa conjunta en release autorizado.
- Fast/full y auditoría de esta revisión exacta antes de cerrar. Cursos/noticias permanecen fuera.

## Trazabilidad de la extracción inicial

[module-relocations.json](module-relocations.json) conserva ubicaciones anteriores/nuevas y el diff real entre snapshotsccb1398/e30daa4, incluyendo imports operativos, scripts y pruebas. El diff Git se usa como inventario completo; el log auxiliar del transformador no sustituye esa referencia. Las operaciones extraídas después tienen sus fuentes y verificaciones propias. Ningún movimiento equivale por sí solo al cierre de la etapa.
