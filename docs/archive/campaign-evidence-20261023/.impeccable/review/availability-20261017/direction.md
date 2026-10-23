# Dirección de la extensión de etapa 4

Modo Operate. Fuente de alcance: `docs/plans/refactorizacion-cita-suite.md`, etapa 4, y su instrucción de preservación. La revisión de esta extensión no equivale a aprobar toda la app ni la campaña.

El sistema existente de `apps/web/PRODUCT.md`, `apps/web/DESIGN.md` y `apps/web/.impeccable/design.json` se conserva. La presentación Natalia hereda `BookingAppearance.svelte`: cambian colores/tipografía, no permisos ni cálculo. No hay nueva identidad ni comp aprobado para esta extensión. El formulario final y su orden obligatorio/opcional permanecen como estaban.

Objetivos de esta revisión:

- El paciente entiende qué fechas se muestran, encuentra anteriores/siguientes y puede salir de una ventana sin horarios; conserva su servicio, profesional y presentación.
- El calendario interno solicita la semana visible; ante una respuesta incompleta muestra un error y una acción de recuperación, sin afirmar que no hay horarios. Las acciones de cliente no aparentan estar listas antes de inicializarse; el primer clic habilitado debe funcionar.
- El editor muestra el último mes válido de la serie y diferencia campos incompletos de datos completos inválidos. El error de preview queda en su formulario; se recupera sin enviar/guardar la política.
- Controles y estados usan el sistema existente, sin estilos nativos accidentales, texto recortado, desbordamiento horizontal ni una pared de explicaciones. Mantener teclado, foco, contraste y claridad.

Matriz de capturas requerida antes de pedir dictamen: público Cita Suite y Natalia, cada uno a 1280 y 320, vacío y fechas disponibles (8); error interno a 1280/320 (2); error de preview de aranceles a 1280/320 (2). Se abrirá cada archivo y se conservará su hash/origen de CI. Una captura fullPage puede mostrar una barra fija en la altura del viewport: eso por sí solo no demuestra una regresión.

El reporte de navegador debe demostrar activación por teclado, siguiente/anterior, selección de fecha/horario, recuperación tras 200 incompleto y preview sin POST. Los guards, SQL/SDK, permisos y persistencia tienen sus pruebas propias. Las capturas no acreditan aquello que sólo corresponde a esas pruebas ni a staging/producción.

Detector ejecutado una vez: cero hallazgos primarios, cuatro recomendaciones preexistentes de 11px, clasificadas en `detector-notes.md`. No reparar el sistema de diseño para ocultarlas. No ejecutar pruebas, compilaciones, navegadores ni otro detector en esta máquina. La auditoría amplia de etapa 5 y la auditoría transversal final conservan sus puertas independientes.
