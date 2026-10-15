# Instalación del turnero en una web

Mode: Operate. Extensión del sistema existente y reparación funcional, sin mundo visual nuevo.

THESIS: Autorizar un dominio y colocar el turnero son dos pasos diferentes; guardar la configuración no debe anunciar una instalación que no ocurrió.
OWN-WORLD: Se conservan los controles, tonos oscuros y acentos de Cita Suite, y la apariencia pública existente de Natalia. Las capturas del usuario documentan el fallo, no son una composición a reproducir.
STORY: Elegir la agenda y autorizar el dominio → guardar → copiar un botón o la agenda integrada → colocar el código en la web → abrir el sitio para probarlo.
FIRST VIEWPORT: Nombre del sitio, tarea de instalación y elección entre agenda integrada o botón; la configuración guardada continúa accesible sin competir con el siguiente paso.
FORM: Radios visibles, código copiable con alternativa manual, enlaces de prueba seguros y guardas para selecciones vacías. Ningún estado de conexión se deduce sólo del dominio ni se afirma una verificación automática.
FINISH: Revisión independiente de la superficie y documentación de contratos, pruebas locales y verificación de la publicación.

El contrato v1 permanece como fuente de verdad de servicios, profesionales, disponibilidad, aranceles y reserva. La instalación declarativa añade una entrada al SDK sin alterar `mount`, idempotencia, validación de origen o mensajes. Se conserva un enlace sin JavaScript. La web de Natalia usa la integración configurada por el usuario; la publicación debe rechazar una clave ausente, nunca inventar otra.

## Contrato implementado

La página separa dos tareas: configurar el alcance de una web y colocar la agenda en ella. El nombre, los dominios exactos y la selección de agenda se guardan en la integración existente. “Guardar y continuar” conserva su clave pública y revisión y lleva al bloque de instalación con el editor plegado. Visitar una configuración existente mantiene el editor accesible y muestra también su instalación.

| Estado visible | Lo que acredita | Siguiente acción |
| --- | --- | --- |
| Autorizado | La integración permite reservas según su configuración. | Instalar o revisar el código en la web. |
| Pausado | La integración está desactivada. | Activar su permiso cuando corresponda. |
| Configuración guardada | Se guardaron dominio y agenda; no se comprobó la instalación. | Copiar y colocar el código. |
| Código copiado | El navegador copió el bloque elegido. | Pegarlo o enviarlo a quien administra el sitio. |
| Copia no disponible | El navegador no permitió copiar. | Abrir “Ver código”, seleccionar y copiar manualmente. |

Reserva online cuenta sitios con dominios configurados y los llama “configurados”. Ni ese contador ni “Autorizado” prueban que el código esté publicado. La selección explícita de algunos profesionales o servicios exige al menos uno; vacío no se interpreta como todo el equipo o todos los servicios. “Todo el equipo actual” sigue guardando los identificadores actuales y no promete incorporar personas futuras.

## Composición y adaptación

El bloque de instalación usa una tarjeta existente con título, explicación breve y “Paso 2”. El grupo de radios ofrece “Agenda dentro de mi web” por defecto y “Botón para reservar”. Una acción “Copiar código” y un mensaje con `role="status"` preceden a “Ver código”, que contiene un campo de sólo lectura seleccionable. La prueba manual y el enlace de la agenda se presentan después; la opción de compartir sólo el enlace permanece plegada.

Se conservan Inter, la paleta administrativa oscura, el violeta de selección, los controles y radios compartidos. Las dos elecciones se disponen en columnas y se apilan hasta 640px; la acción de copia ocupa todo el ancho en móvil. Los nombres largos, el código y los dominios parten líneas. Los controles desplegables conservan una altura mínima de 2.75rem. La apariencia del calendario pertenece a la integración pública existente, incluido el tema Natalia, y no se replica en el editor.

El detector registra dos avisos de tamaño (0.85rem) en el texto de apoyo de las opciones y el campo de código. Se conservan como valores locales de esta implementación; no se añaden a la escala tipográfica normativa ni se presentan como reglas para nuevas superficies. El resto del sistema visual permanece vigente.

## Instalación y compatibilidad

- **Agenda dentro de la web:** el código incluye un contenedor `data-cita-suite-booking`, un enlace marcado `data-cita-suite-fallback` y el script versionado `/booking/embed-v1.js` con `defer`. El SDK monta la agenda real en línea al cargar el documento. Si el script está bloqueado o JavaScript no corre, el enlace sigue disponible; si el calendario falla después de montar, el SDK mantiene sus opciones de reintento y apertura en otra página.
- **Botón para reservar:** el código es un enlace HTML a `/embed/v1/<clave pública>`, con `target="_blank"` y `rel="noopener noreferrer"`; funciona sin JavaScript. No requiere copiar reglas de agenda al sitio externo.
- **SDK v1:** `install()` busca los contenedores declarativos y reutiliza los ya montados. Cargar otra vez el SDK o volver a instalar no duplica esos turneros; un bloque inválido no inutiliza los demás ni su enlace. La API manual `mount()` conserva su contrato existente, validación de origen, mensajes, idempotencia y recuperación de reserva.
- **Fuente de verdad:** profesionales, servicios, disponibilidad, aranceles y reservas continúan en Cita Suite. El código copiado contiene la clave pública de integración y el origen de Cita Suite, no credenciales de Supabase ni información del paciente.

“Probá la instalación” abre exclusivamente los dominios guardados, en otra pestaña con protección de la ventana de origen, e indica elegir servicio, día y horario. Es una comprobación manual. No inspecciona la web ni asigna un estado automático de conexión.

## Evidencia y límite del cierre

Las comprobaciones de esta entrega incluyen 65 verificaciones unitarias y seis comprobaciones de navegador local. El navegador usó la aplicación y el SDK reales sobre PostgreSQL/PostgREST descartables, con autenticación simulada. El sitio externo de prueba tuvo un origen HTTP local autorizado: se pegó el bloque copiado, se abrió el calendario y se llegó al formulario del paciente. Se comprobó también el enlace sin JavaScript, la ausencia de duplicados, los permisos de administración y los anchos 1440, 390 y 320px. No se enviaron reservas reales.

La revisión independiente cubrió tanto la interfaz administrativa como el bloque instalado. Las cuatro capturas y el recibo de ejecución se conservan en [la evidencia de la auditoría](../../../../docs/audits/evidence/2026-10-14-website-installation/results.json): `desktop.png`, `mobile.png`, `user-320.png` e `installed-site-mobile.png`. Esta evidencia es local y no certifica una publicación productiva.

El diagnóstico remoto previo, de sólo lectura, encontró ausente la clave `PUBLIC_NATALIA_INTEGRATION_KEY` en el HTML publicado de Natalia, mientras el catálogo de la clave indicada respondió correctamente para su origen permitido. La configuración pública de Natalia se preparó por separado y su compilación productiva ahora rechaza una clave ausente. La verificación de publicación corresponde al informe de auditoría y no se deduce de guardar un dominio, de las pruebas locales ni de este documento.

Cursos y noticias de Natalia permanecen aplazados. Esta extensión no cambia plantillas, identidad global ni otros módulos.

## Fuentes

`src/lib/booking/{BookingInstallation.svelte,booking-installation.ts}`; `src/routes/odonto/configuracion/reserva-online/{+page.svelte,+page.server.ts}`; `src/routes/odonto/configuracion/reserva-online/webs/{+page.svelte,+page.server.ts}`; `static/booking/embed-v1.js`; `src/app.css`; las huellas SHA-256 representativas en `../design.json`.
