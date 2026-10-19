# Revisión de interfaz de la etapa 5

**Abierta: este documento no certifica todavía el cierre.** El [plan original](../plans/refactorizacion-cita-suite.md) conserva su autoridad. La [matriz de aceptación](evidencia-etapa5-estructura.md), el [registro](../plans/registro-refactorizacion-cita-suite.md) y el [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) identifican implementación, evidencias y continuidad.

## Recorridos y entorno

Se verifican ficha e historia del paciente, edición de datos, configuración de profesional/prestaciones/horarios, alta desde Equipo, reserva manual y formulario público final. La descomposición conserva el sistema visual y los controles personalizados; no introduce un rediseño ni cambia reglas por marca.

Browser plugin no disponible en las herramientas activas. Se usa Playwright existente exclusivamente en GitHub Actions, un trabajador, sin reintentos ni suites paralelas. Aplicación y API están en loopback; PostgreSQL, GoTrue, PostgREST y Storage son servicios reales descartables con datos sintéticos propios. Las intercepciones de carga/error son pruebas de recuperación de interfaz, no caídas reales de un proveedor alojado.

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

## Resultado y cierre pendientes

Faltan el recibo de navegador completo sobre revisión final, la comparación medida de JavaScript/hidratación de Natalia, la inspección propia de capturas válidas, el detector y la revisión/documentación independientes exigidos por Impeccable. Los resultados rápidos anteriores no sustituyen esas puertas. Cursos y noticias permanecen intactos. Esta revisión no incluye fase 6, capacidad alojada, release ni auditoría final de toda la campaña.

## Relevo inmediato y primera inspección visual — 19 de octubre

El usuario solicitó el relevo inmediato antes del cierre. La inspección propia de61 capturas encontró cuatro defectos reales: cabecera de historia comprimida en320/390; acciones del paciente casi verticales en768 con nombre largo; badge del profesional comprimido en escritorio; título del alta apretado por el progreso en320. Hay correcciones de layout preparadas pero **sin verificar**. Además, varias imágenes no muestran la tarea nombrada: es necesario alinear el selector manual, perfil, estados de carga/error y formulario final antes de capturar. `task-capture.ts` fue creado para ello y todavía no tiene consumidores.

El manifiesto [etapa5-capturas.json](etapa5-capturas.json) conserva los originales/hashes como evidencia negativa de ronda1; no es un paquete apto para aprobar. Detector, segunda inspección, revisión fresca y documenter continúan pendientes. Consultar primero el [punto exacto de relevo](../plans/traspaso-refactorizacion-cita-suite.md). Full39207125504 sigue sobre09dec4e y no contiene estas correcciones posteriores. No se certifica la fase5.
