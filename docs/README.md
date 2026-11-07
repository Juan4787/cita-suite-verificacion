# Documentación de Cita Suite

**Todo lo que queda pendiente está en una sola lista:** [pendientes vigentes](plans/pendientes-vigentes.md). Los datos faltantes de Natalia conservan su tratamiento separado. P1, P2 y P3 están [publicadas](plans/tareas-posteriores-a-e-20261103.md) desde el 7 de noviembre; P3 sustituye D celular. E conserva su [especificación con Zoho](plans/etapa-e-correo-autogestion.md) y autorización histórica de implementación/publicación, pero **el pedido posterior 12.31 detiene implementación para documentación y traspaso**, sin cierre ni publicación E. [Registro activo](plans/ejecucion-etapa-e-20261103.md), checkpoint E3.50.

**Documentación detallada de E:** [índice de implementación, decisiones, pruebas y operación](plans/indice-etapa-e.md). El [traspaso del 5 de noviembre](plans/traspaso-etapa-e-20261105.md) es historia.

## Estado operativo y criterio actuales — 6 de noviembre

**Qué historia y qué cambios están vigentes:** [estado vigente](ESTADO-VIGENTE.md), el registro único; lo comprueba `node scripts/check-repo-sync.mjs`.

**Producción:** la revisión, la versión de Cloudflare y los interruptores figuran sólo en el [estado vigente](ESTADO-VIGENTE.md). [Índice de E](plans/indice-etapa-e.md).

Antes, V12b `771fac5950c532b1123f11d4dde93eef9b42ceba` (versión `277d332d-1794-4367-8ef0-567ced159f1b`) desde el 2 de noviembre a las 15:33 UTC, que ya no es vuelta atrás válida. Es V12 (`c21a1983…`, 14:46 UTC) con el fondo general del modo claro apenas más cálido.
- Es V11f más el modo claro predeterminado, con el oscuro conservado y el selector Claro, Oscuro y Automático.
- Documentos: [plan](plans/modo-claro-20261102.md), [registro](plans/registro-modo-claro-20261102.md), [traspaso](plans/traspaso-modo-claro-20261102.md) y [publicación y reversión](architecture/publicacion-y-reversion.md).

Antes, V11f `72d59ab00db67a8502ca560c762c61e6cfac1923` (2 de noviembre a las 02:12 UTC). Antes aún, V10b `68f31741f6ff7f2253c036800b1369f1eda16510`, versión `1d2b4acd-7dd8-4cb7-81e3-a205bafe9f8d` desde el 1 de noviembre a las 10:15 UTC (plan de señas y avisos, 12.16): V9 más la vista de consultorios archivados, el rubro «medicina», preguntas de hasta 40 opciones y la web de Natalia reservando en su consultorio real. Antes de volver a V9 hay que dejar los datos legibles para V9 ([publicación y reversión](architecture/publicacion-y-reversion.md)). V9 `a3c707f368736da90d2adf5850d291460f657af0` (31 de octubre) es V8 más el registro de las fallas al comprobar el enlace. La confirmación de correo está publicada y comprobada: [traspaso de cierre](plans/traspaso-confirmacion-email-20261030.md), [registro y evidencias](plans/registro-confirmacion-email-20261030.md), [guía funcional](architecture/confirmacion-de-correo.md) y [publicación](plans/publicacion-confirmacion-email-20261030.md). Fuente V8 `408ca04d9e6750e4657dc087264644665a63fb37`, versión `a1844665-447e-40bb-b9e5-ce7c03ed29d7`. Las revisiones anteriores de otros traspasos son históricas y no indican una publicación pendiente.

Los datos comerciales faltantes de Natalia conservan sus pendientes. D celular fue reemplazada por la notificación interna P3; P1, P2 y P3 se publicaron el 7 de noviembre, por 12.34. E se rige por [12.18](plans/propuesta-senas-avisos-natalia.md#etapa-e-vigente): revisión documental terminada; conexión administrativa local de Zoho comprobada por el pedido posterior [12.19](plans/propuesta-senas-avisos-natalia.md#zoho-terminal-vigente), y ejecución íntegra posterior autorizada en [12.20](plans/propuesta-senas-avisos-natalia.md#ejecucion-e-autorizada). La implementación parcial actual no acredita cierre funcional ni publicación. El acceso de Natalia no se modifica. El criterio inicial de [AGENTS.md](../AGENTS.md) prevalece sobre procedimientos antiguos: máximo rigor, controles proporcionados y producción autorizada; no duplicar entornos ni renovar copias por antigüedad como rutina para una UI sin migraciones. La ausencia de pacientes reales no vuelve descartables cuentas, secretos, permisos, configuración comercial o infraestructura.

La fuente de verdad de esta campaña es el [plan aprobado íntegro](plans/refactorizacion-cita-suite.md), incluidas sus ampliaciones y decisiones posteriores. El [registro](plans/registro-refactorizacion-cita-suite.md) identifica cambios, fallas, corridas, revisiones y evidencias. El [traspaso](plans/traspaso-refactorizacion-cita-suite.md) fija el siguiente trabajo pendiente. Una conclusión histórica no certifica el estado actual.

## Campaña de señas y avisos (desde el 29 de octubre)

Para el consultorio de Natalia Frutos, la primera clienta, rigen estos documentos:
- el [plan aprobado](plans/propuesta-senas-avisos-natalia.md), cuya sección 12 tiene la aprobación literal y los ajustes posteriores;
- el [registro](plans/registro-senas-avisos-natalia.md);
- el [traspaso](plans/traspaso-senas-avisos-natalia.md);
- la [especificación de E](plans/etapa-e-correo-autogestion.md), con decisiones de la conversación, contraste C01–C13 y matriz de aceptación integral pendiente y evidencia parcial en el registro activo;
- la información que mandó la clienta (documento privado `docs/clientes/natalia-frutos/informacion-20261029.md`, sólo en la computadora de trabajo).

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
| Confirmación de correo y alta | [Flujo publicado y límites](architecture/confirmacion-de-correo.md) |
| Correo para recuperar contraseñas | [Configuración temporal con Gmail y prueba real](architecture/correo-de-recuperacion.md) |
| Estado punto por punto | [Auditoría final](architecture/auditoria-final.md) |
| Nombres y destinos | [Identidad Cita Suite](architecture/identidad-cita-suite.md) |
| Dominio, landing y direcciones públicas | [Dominio](architecture/dominio.md) |
| Decisiones y trabajo nuevo | [Decisiones](architecture/decisiones.md), [guía para nuevas funciones](architecture/guia-nuevas-funciones.md) |

## Evidencias e historia

Las evidencias de [etapa 3](architecture/evidencia-etapa3-documentos.md), [etapa 4](architecture/evidencia-etapa4-agenda.md) y [etapa 5](architecture/evidencia-etapa5-estructura.md) documentan sus revisiones concretas. Las capturas y recibos conservan su fecha, entorno y alcance; no se reescriben para hacerlos coincidir con una candidata posterior.

`audits/`, `booking-integration/`, `exportacion-datos/` y los documentos de dominio en la raíz conservan requisitos, diseños, procedimientos y comprobaciones anteriores. Sus contratos que siguen activos se contrastan con el plan y la arquitectura vigentes. En particular, Natalia usa navegación nativa al turnero; los ejemplos iniciales de iframe no son su procedimiento actual. Las instrucciones antiguas para ejecutar bases, builds o navegadores locales no se aplican a esta campaña: ese trabajo corre secuencialmente en CI.

`archive/administrativo-inactivo/` conserva un módulo fuera del alcance activo y su integridad. Su presencia no autoriza activarlo ni implementar recomendaciones antiguas. Cursos, noticias y notificaciones automáticas por WhatsApp conservan las exclusiones del plan.

El [inventario documental del 22 de octubre](architecture/inventario-documental-20261022.json) conserva los 161 archivos presentes al retomar: rutas, tamaños, SHA-256, encabezados y clasificación. Es un inventario automatizado de entrada, asociado al snapshot `dfb487f`; las huellas corresponden a los bytes locales observados en ese momento, no afirman igualdad del árbol local con ese commit. No acredita inspección manual de cada imagen, vigencia de enlaces externos ni verificación de todos los contratos por sí solo. Los cambios posteriores quedan en Git y en el registro.
