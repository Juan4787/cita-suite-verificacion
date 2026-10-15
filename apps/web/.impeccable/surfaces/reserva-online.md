# Reserva online y configuración del profesional

Mode: **Operate**. App: `apps/web`. Mundo: sistema oscuro existente de Cita Suite; ver `../../DESIGN.md` y `../design.json`.

## Resultado de la tarea

Una profesional que entra por primera vez encuentra el enlace de su agenda y las reglas generales en Reserva online. Configura a cada persona desde Equipo, con sus servicios, aranceles, horarios y preguntas. La estructura y los controles explican el uso; el texto sólo aclara decisiones necesarias.

## Ubicación principal de cada función

| Tarea | Lugar principal |
| --- | --- |
| Compartir enlace; ver como paciente; activar o pausar; anticipación y cancelación | Configuración → Reserva online |
| Nombre, dirección y datos del consultorio | Configuración → Datos del consultorio |
| Cambiar el identificador de la dirección pública | Datos del consultorio → Dirección personalizada |
| Contacto mostrado en una web | Datos del consultorio → Contacto en tu web |
| Permisos y espacio para documentos clínicos | Configuración → Archivos de pacientes |
| Perfil de una persona | Configuración → Equipo → profesional → Perfil |
| Asignar o crear servicios, duración y arancel visible | Profesional → Servicios y aranceles |
| Aranceles y ajustes mensuales | Servicios y aranceles → Aranceles |
| Disponibilidad | Profesional → Horarios |
| Datos habituales y otras preguntas de reserva | Profesional → Preguntas al paciente |
| Conectar o editar una web externa | Reserva online → Reservas desde tu sitio web → página separada |

Los servicios y horarios ya asignados en Equipo se reutilizan. No se solicita una segunda configuración para reservar. La integración externa permanece opcional; no precede las tareas frecuentes ni ocupa una hilera de accesos a funciones de otros niveles.

## Composición y controles

El primer bloque de Reserva online muestra título, estado y agenda lista para compartir. “Copiar enlace”, “Ver como paciente” y activar/pausar cubren las acciones principales. Después aparecen reglas en un formulario corto y, cuando está habilitado, el acceso separado a sitios externos.

La página de sitios comienza con una lista y estado de cada conexión. Su formulario muestra nombre, dirección de la web y agenda; “Opciones de esta web” pliega configuración adicional. “Todo el equipo actual” guarda los identificadores explícitos que se envían para la integración activa: no promete incorporar automáticamente personas futuras. El enlace general del consultorio consulta el catálogo actual dinámicamente. Se conservan claves, revisiones, permisos y límites existentes.

Preguntas usa filas para activar datos habituales y marcar “Obligatorio”. “Editar pregunta” expande sus opciones. Las preguntas adicionales permiten agregar, eliminar y ordenar, conservando identificadores y cuestionarios históricos. Las respuestas quedan en la ficha del paciente. Aranceles permanece dentro de servicios; el campo de presentación se llama “Arancel a mostrar (opcional)”.

Los selectores y calendarios de fecha/mes muestran menús propios. Sus controles originales se ocultan únicamente cuando JavaScript monta su mejora; conservan valores, nombres, eventos, validación y bindings. Las horas usan un campo de texto con entrada numérica que se normaliza a HH:mm, sin menú. El nombre accesible del calendario incluye el valor seleccionado y se conserva al cambiar atributos. Casillas y radios mantienen semántica nativa con acabado propio. El popover usa la capa superior, o posición fija cuando no está disponible.

## Estados y protección del trabajo

- Reservas: activadas, pausadas o suspendidas según configuración y habilitación efectiva. El formulario comunica una dirección faltante con una acción para completarla.
- Edición: cambios sin guardar visibles; guardado pendiente bloquea campos y acciones que interfieran. Las reglas pendientes se guardan antes de cambiar activación.
- Errores: mensaje humano con siguiente acción; campo inválido reconocido y enfocado, también si está en una sección plegada.
- Salir dentro de la app: “Seguir editando” conserva el borrador. “Descartar cambios” limpia el estado antes de navegar, incluido un cambio que reutilice la misma página.
- Cerrar o recargar: protección del navegador intencional. Sin JavaScript se conservan los controles originales y el envío del formulario cuando procede; editores que dependen de JavaScript evitan enviar un borrador incompleto.
- Permisos o función deshabilitada: estado explícito; no se ofrecen acciones de guardado que el usuario no pueda realizar.
- Sitios y preguntas vacíos: mensaje corto que indica el siguiente paso, sin datos inventados.

En móvil se apilan campos y cabeceras; el enlace ocupa una fila y las acciones de compartir otra. La navegación puede repartirse en dos columnas. Menús y diálogos se ajustan al viewport y los textos largos parten líneas.

## Evidencia y alcance

El cierre independiente aceptó arquitectura y UI tras corregir descarte antes de navegación con página reutilizada, ubicación de “Dirección personalizada”, etiqueta humana del arancel y persistencia del valor accesible del calendario.

La evidencia visual es local: Chromium a 1440, 390 y 320px, con datos sintéticos y Auth simulado. Se encuentra en `../../../../.impeccable/review/reservation-settings/` (por ejemplo `reservation-desktop.png`, `reservation-mobile.png`, `reservation-320.png`, `web-editor-320.png` y `questions-320.png`). No constituye prueba de configuración, autenticación ni publicación de producción. No se afirma una renovación de toda la app.

Cursos y noticias de Natalia siguen aplazados. No se agregan datos de negocio ni un módulo nuevo de estudios clínicos: esta entrega reorganiza los permisos y el espacio de archivos existentes; el backend de PDF ya publicado permanece. Los documentos de diseño del proyecto raíz y de `apps/natalia` tienen otro ámbito y se conservan.

## Fuentes

`../../PRODUCT.md`; contrato raíz `.impeccable/review/reservation-settings/direction.md`; `src/app.css`; rutas `odonto/configuracion`, `reserva-online`, `reserva-online/webs`, `negocio`, `negocio/contacto`, `documentos`, `profesionales/[professionalId]`, `aranceles` y `preguntas`; `lib/booking/{BookingShareLink,ProfessionalBookingFormEditor,BookingQuestionDetails,PricePolicyEditor}.svelte`; `lib/ui/{styled-controls,confirm-action}.ts`. Las huellas de los archivos representativos quedan en la sidecar.
