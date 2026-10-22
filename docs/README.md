# Documentación de Cita Suite

La fuente de verdad de esta campaña es el [plan aprobado íntegro](plans/refactorizacion-cita-suite.md), incluidas sus ampliaciones y decisiones posteriores. El [registro](plans/registro-refactorizacion-cita-suite.md) identifica cambios, fallas, corridas, revisiones y evidencias. El [traspaso](plans/traspaso-refactorizacion-cita-suite.md) fija el siguiente trabajo pendiente. Una conclusión histórica no certifica el estado actual.

## Contratos y operación vigentes

| Tema | Documento |
|---|---|
| Áreas y dependencias | [Áreas y fronteras](architecture/areas-y-fronteras.md) |
| Recorridos y autoridad de las reglas | [Contratos funcionales](architecture/functional-contracts.md) |
| Tipos, contexto y aislamiento | [Tipado y aislamiento](architecture/tipado-contexto-aislamiento.md), [relaciones entre consultorios](architecture/relaciones-entre-consultorios.md) |
| Permisos, capacidades y acceso privilegiado | [Permisos y capacidades](architecture/permisos-y-capacidades.md), [clave de servicio](architecture/clave-de-servicio.md) |
| Reservas y precios | [Disponibilidad y aranceles](architecture/disponibilidad-y-aranceles.md) |
| Documentos y cuotas | [Contabilidad de documentos](architecture/contabilidad-documentos.md) |
| Programador y recuperación de tareas | [Tareas automáticas](architecture/tareas-automaticas.md) |
| Pruebas y límites del equipo local | [Verificación](architecture/verificacion.md), [matriz de regresiones](architecture/matriz-regresiones.md) |
| Carga, límites y consumo | [Capacidad](architecture/capacidad.md), [control de consumo](architecture/control-de-consumo.md) |
| Respaldo, publicación y reversión | [Respaldo y recuperación](architecture/respaldo-y-recuperacion.md), [publicación y reversión](architecture/publicacion-y-reversion.md) |
| Estado punto por punto | [Auditoría final](architecture/auditoria-final.md) |
| Nombres y destinos | [Identidad Cita Suite](architecture/identidad-cita-suite.md) |
| Decisiones y trabajo nuevo | [Decisiones](architecture/decisiones.md), [guía para nuevas funciones](architecture/guia-nuevas-funciones.md) |

## Evidencias e historia

Las evidencias de [etapa 3](architecture/evidencia-etapa3-documentos.md), [etapa 4](architecture/evidencia-etapa4-agenda.md) y [etapa 5](architecture/evidencia-etapa5-estructura.md) documentan sus revisiones concretas. Las capturas y recibos conservan su fecha, entorno y alcance; no se reescriben para hacerlos coincidir con una candidata posterior.

`audits/`, `booking-integration/`, `exportacion-datos/` y los documentos de dominio en la raíz conservan requisitos, diseños, procedimientos y comprobaciones anteriores. Sus contratos que siguen activos se contrastan con el plan y la arquitectura vigentes. En particular, Natalia usa navegación nativa al turnero; los ejemplos iniciales de iframe no son su procedimiento actual. Las instrucciones antiguas para ejecutar bases, builds o navegadores locales no se aplican a esta campaña: ese trabajo corre secuencialmente en CI.

`archive/administrativo-inactivo/` conserva un módulo fuera del alcance activo y su integridad. Su presencia no autoriza activarlo ni implementar recomendaciones antiguas. Cursos, noticias y notificaciones automáticas por WhatsApp conservan las exclusiones del plan.

El [inventario documental del 22 de octubre](architecture/inventario-documental-20261022.json) conserva los 161 archivos presentes al retomar: rutas, tamaños, SHA-256, encabezados y clasificación. Es un inventario automatizado de entrada, asociado al snapshot `dfb487f`; las huellas corresponden a los bytes locales observados en ese momento, no afirman igualdad del árbol local con ese commit. No acredita inspección manual de cada imagen, vigencia de enlaces externos ni verificación de todos los contratos por sí solo. Los cambios posteriores quedan en Git y en el registro.
