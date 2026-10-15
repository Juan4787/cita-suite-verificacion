# Confirmación de reserva del paciente

Mode: Operate. Extensión acotada de la apariencia existente; no se cambia el contrato de reserva.

## Direction contract

THESIS: El paciente verifica su turno y completa primero lo necesario para confirmarlo.
OWN-WORLD: La imagen enviada fija resumen destacado, arancel visible, campos redondeados, respuestas Sí/No y botón amplio. Se conservan los tokens violeta/oscuro de Cita Suite y los temas claro/oscuro de Natalia.
STORY: Resumen real del turno → nombre y teléfono → preguntas obligatorias → preguntas y datos opcionales → confirmar.
FIRST VIEWPORT: Servicio y profesional, precio de la fecha elegida, día/hora/duración y comienzo de los datos obligatorios. En móvil el precio se adapta sin truncar información.
FORM: Una sola columna. Orden estable dentro de obligatorios y opcionales; asterisco para obligatorios y distintivo Opcional. Preguntas existentes y ayuda configurada; ninguna pregunta ni arancel inventados. No se muestra Información para el consultorio. Controles con teclado, estados y envío progresivo.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Adaptaciones de la referencia

Los nombres, precios y preguntas de la imagen son ejemplos, no datos del consultorio. Se muestran los valores configurados. La privacidad menciona al equipo autorizado; se conserva el acceso real al calendario y a la gestión del turno. Fechas de nacimiento permiten escribir día, mes y año, sin obligar a retroceder décadas en un calendario.

## Implementación registrada

La referencia es la imagen aportada por el usuario: establece jerarquía y geometría dentro del sistema existente, sin aprobar un mundo visual nuevo. No se generaron imágenes raster para esta superficie. Inter y los acentos violeta/oscuro se conservan en Cita Suite; los temas Natalia mantienen Hanken Grotesk, Newsreader y sus paletas cálidas existentes, incluidos los menús portados al body.

El resumen coloca el contexto y el arancel en la primera fila y el servicio con profesional en la segunda. Día, hora, duración, modalidad cuando corresponde y aviso de ajuste usan los datos de la selección y la cotización actuales. No se incorpora el precio ilustrativo de la referencia.

Los grupos visibles mantienen este orden: nombre y apellido, teléfono, preguntas obligatorias, preguntas opcionales, comentario y correo. El orden configurado se conserva dentro de cada grupo de preguntas. Un asterisco distingue lo obligatorio y Opcional distingue los demás campos; las leyendas de ambos grupos siguen disponibles para lectores de pantalla. No aparece el título Información para el consultorio.

Las respuestas booleanas usan radios nativos presentados como opciones amplias: Sí envía `true`, No envía `false` y Sin responder envía vacío cuando la pregunta es opcional. La fecha de nacimiento conserva un único campo nativo nombrado antes del montaje o con JavaScript deshabilitado; tras montarse, muestra día/mes/año y envía un único valor ISO oculto. Se conservan el valor inicial, la fecha ingresada antes de hidratar, los límites y los mensajes de validación.

La forma usa los tokens `patient-*` registrados en DESIGN.md. Campos y respuestas tienen (3.1rem) de alto mínimo; confirmar ocupa el ancho completo con (3.5rem) de alto mínimo. Hasta (480px), el contenedor reduce padding, los grupos reducen espaciado y Sin responder pasa a una fila completa. El resumen y las etiquetas permiten nombres extensos sin ensanchar la página.

Los contratos de esquema del paciente, revisión de integración, cotización, modalidad, profesionales e idempotencia conservan sus nombres y flujo de envío originales. Las opciones opcionales permanecen visibles en esta superficie; el patrón administrativo de plegar opciones secundarias no cambia su composición.

## Evidencia y alcance

[results.json](../../../../docs/audits/evidence/2026-10-14-patient-confirmation/results.json) registra siete verificaciones y ocho capturas locales de formulario y selector: Chromium, PostgreSQL/PostgREST aislados, Auth simulado y campos/arancel sintéticos. Incluye (1440px), (390px), (320px), temas Natalia claro/oscuro y persistencia local de No, fecha ISO y cotización. [nojs-results.json](../../../../docs/audits/evidence/2026-10-14-patient-confirmation/nojs-results.json) registra dos reservas locales reales sin JavaScript, con fecha de nacimiento obligatoria y opcional. Estas evidencias no verifican producción.

La revisión independiente pidió corregir el envío de fecha sin JavaScript. El campo nativo previo al montaje y las dos reservas locales documentadas cubren esa corrección; el veredicto posterior permite enviar la extensión. La documentación conserva la procedencia del mundo existente y de la referencia del usuario. Publicación y comprobación del sitio servido pertenecen al cierre de entrega, no a este registro visual.
