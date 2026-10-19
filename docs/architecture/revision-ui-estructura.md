# Revisión de interfaz de la etapa 5

**Ronda 2 completa sobre la fuente final; dictamen independiente pendiente (ver al final).** El [plan original](../plans/refactorizacion-cita-suite.md) conserva su autoridad. La [matriz de aceptación](evidencia-etapa5-estructura.md), el [registro](../plans/registro-refactorizacion-cita-suite.md) y el [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) identifican implementación, evidencias y continuidad.

## Recorridos y entorno

Se verifican ficha e historia del paciente, edición de datos, configuración de profesional/prestaciones/horarios, alta desde Equipo, reserva manual y formulario público final. La descomposición conserva el sistema visual y los controles personalizados; no introduce un rediseño ni cambia reglas por marca.

Se usa Playwright existente exclusivamente en GitHub Actions, un trabajador, sin reintentos ni suites paralelas; la máquina local no ejecuta navegadores. Aplicación y API están en loopback; PostgreSQL, GoTrue, PostgREST y Storage son servicios reales descartables con datos sintéticos propios. Las intercepciones de carga/error son pruebas de recuperación de interfaz, no caídas reales de un proveedor alojado.

Cita Suite conserva su tema oscuro único, incluso con preferencia clara del navegador. Natalia sí tiene dos modos reales por `color_mode`. Las combinaciones registran preferencia y tema renderizado por separado. Los anchos obligatorios son 320, 390, 768, 1280 y 1600 píxeles.

## Cambios que requieren prueba renderizada

- Coordinación de borradores separada de paneles de perfil, servicios, horarios y ciclo de vida; alta desde Equipo separada del listado y accesos.
- Controles que necesitan JavaScript deshabilitados hasta inicialización. El primer clic habilitado debe funcionar.
- La revisión de guardado pertenece a la base que originó el borrador; una invalidación con cambios remotos no puede actualizar silenciosamente ese token. Se comprueba rechazo SQL y lectura posterior, además del texto visible.
- Duraciones y márgenes admiten los mismos enteros que el servidor: no imponer un salto de cinco cuando el contrato acepta 23 y 3 minutos.
- Documento con título predeterminado y una única región principal. Aranceles usa la región del layout y una sección interior rotulada.
- Zoom del navegador permitido. Los calendarios/selectores siguen siendo personalizados; sus fuentes nativas invisibles de un píxel no son el control que debe medirse. La geometría comprueba los botones visibles que los sustituyen.

## Alcance del diagnóstico de consola y red

El observador adjunta categorías, rutas sin parámetros y ubicación de código; no conserva mensajes crudos, claves, tokens, URLs firmadas ni valores clínicos. Un mensaje desconocido, error de red no previsto, falta de título/contenido o overlay del framework hace fallar el caso.

El fixture no levanta Realtime. Se clasifica únicamente el handshake WebSocket que recibe 404 en `/realtime/v1/websocket`, contra el origen loopback exacto configurado y sólo en entorno `disposable`. El diagnóstico 39205109934 confirmó tres mensajes de esa categoría y ningún otro fallo de red/HTTP en el recorrido manual. Esto no acredita Realtime sano ni fallido en producción: su transporte, autoridad y revocación corresponden a staging real.

Los dos conflictos del editor se comprueban como `ActionResult` de tipo `failure` y estado 409: SvelteKit transporta esas respuestas de acciones mejoradas mediante HTTP 200. El caso exige las dos respuestas de acciones concretas, además de conservar borrador y comprobar persistencia independiente. El editor no permite errores HTTP. El único HTTP 500 inyectado en la carga de datos del paciente tiene ruta, método y cantidad esperada explícitos. No hay una exclusión general de errores 4xx/5xx. Se distingue el aviso DEV conocido de Svelte del resto de consola.

## Resultado de la ronda 2 (fuente final)

Fuente `a940f23cdd65a03b08d8f1d2e7f51117ca60b702`, full 39220668360. Las 136 capturas de `.impeccable/review/structure-20261018/round-2/` (manifiesto `captures.json` con origen, SHA-256, píxeles, ancho y preferencia) están alineadas a la tarea que nombran con `alignTaskForCapture`. Hay capturas propias de la cabecera del paciente, del encabezado del profesional, del panel de Servicios y de las categorías de Equipo, porque al alinear a la tarea esas regiones habrían quedado fuera de toda imagen. Para el formulario público se agregan capturas de región del orden completo de los campos.

La inspección propia (`round-2/inspection-round-2.md`) confirma los cuatro defectos de la ronda 1 corregidos y los tres defectos adicionales que encontró la detección automática: «Crear servicio nuevo» comprimido junto a un nombre largo, nombres de servicio partidos en 320, valores clínicos en una columna de 87 px y «Administradores» partido en 320. También confirma dos ajustes de terminación: acciones del paciente en una fila en vez de una escalera en ≥1280 y el contador de categorías en línea en 320. El detector (una corrida, `round-2/detector-notes.md`) devolvió cero hallazgos primarios y 14 recomendaciones preexistentes de tamaños tipográficos literales, que quedan para la auditoría transversal.

Las capturas no son la única barrera: `layoutIssues` aprueba las cinco matrices en el mismo full, y su sensibilidad quedó demostrada reintroduciendo los defectos reales (diagnóstico 39213353905).

## Antecedente: ronda 1 y relevo del 19 de octubre

La ronda 1 (61 capturas de `af5a2b6`/`09dec4e`) encontró historia comprimida en 320/390, acciones del paciente casi verticales en 768, badge del profesional comprimido y título del alta apretado en 320. Varias imágenes no mostraban la tarea nombrada. El manifiesto [etapa5-capturas.json](etapa5-capturas.json) conserva esos originales como evidencia negativa; no es un paquete apto para aprobar.

## Dictamen independiente

Pendiente: revisor fresco de Impeccable sobre la ronda 2 y, si corresponde, documentador de DESIGN.md. Esta revisión no incluye fase 6, capacidad alojada, release ni la auditoría final de la campaña.
