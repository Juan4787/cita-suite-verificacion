---
name: Cita Suite
description: Sistema oscuro de trabajo para consultorios.
colors:
  bg: "#0b1626"
  surface: "#0b1d32"
  surface-2: "#0f2238"
  surface-raised: "#102842"
  border: "rgba(255, 255, 255, 0.1)"
  border-strong: "#244062"
  text: "#eaf1ff"
  text-muted: "rgba(234, 241, 255, 0.64)"
  text-subtle: "rgba(234, 241, 255, 0.42)"
  accent: "#8b5cf6"
  accent-strong: "#7c3aed"
  accent-press: "#6d28d9"
  accent-soft: "rgba(124, 58, 237, 0.18)"
  accent-text: "#c4b5fd"
  ring: "rgba(139, 92, 246, 0.65)"
  success: "#34d399"
  success-soft: "rgba(52, 211, 153, 0.14)"
  success-text: "#a7f3d0"
  warning: "#fbbf24"
  warning-soft: "rgba(251, 191, 36, 0.14)"
  warning-text: "#fde68a"
  danger: "#f87171"
  danger-strong: "#dc2626"
  danger-press: "#b91c1c"
  danger-soft: "rgba(248, 113, 113, 0.13)"
  danger-text: "#fecaca"
  on-accent: "#ffffff"
  field: "rgba(255, 255, 255, 0.045)"
  patient-muted: "#b5c2d7"
  patient-field: "rgba(234, 241, 255, 0.045)"
  patient-field-border: "#52637b"
  patient-summary: "rgba(139, 92, 246, 0.06)"
  patient-summary-border: "#8056c9"
typography:
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.7rem, 2.4vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
  supporting:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.95rem"
    lineHeight: 1.55
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
  button:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1
  badge:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
  micro:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
  caption:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
  cta:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.075rem"
    fontWeight: 700
  patient-service:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.35
  patient-label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.45
  patient-confirm:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
    lineHeight: 1
rounded:
  sm: "0.85rem"
  md: "1rem"
  lg: "1.4rem"
  xl: "1.75rem"
  menu: "0.75rem"
  pill: "999px"
  patient-form: "1.5rem"
  patient-control: "1.8rem"
  patient-answer: "1.2rem"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
  patient-fields: "1.4rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.25rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-press}"
  button-secondary:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.25rem"
  button-danger:
    backgroundColor: "{colors.danger-strong}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.25rem"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  card:
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "0.4rem 0.8rem"
  control-menu:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.menu}"
    padding: "0.4rem"
  confirm-dialog:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "1.5rem"
  patient-form:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.patient-form}"
    padding: "{spacing.xl}"
  patient-input:
    backgroundColor: "{colors.patient-field}"
    textColor: "{colors.text}"
    rounded: "{rounded.patient-control}"
    padding: "0.75rem 1rem"
    height: "3.1rem"
  patient-answer:
    backgroundColor: "{colors.patient-field}"
    textColor: "{colors.text}"
    rounded: "{rounded.patient-answer}"
    padding: "0.65rem 0.6rem"
    height: "3.1rem"
  patient-confirm:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.on-accent}"
    typography: "{typography.patient-confirm}"
    rounded: "{rounded.patient-control}"
    padding: "0.7rem 1.25rem"
    height: "3.5rem"
    width: "100%"
---

# Design System: Cita Suite

## Overview

**Creative North Star: "Cita Suite: claridad para trabajar"**

Se conserva la identidad existente: Inter, fondos azul oscuro y acento violeta. La precisión de los controles, la jerarquía de texto y los estados hacen reconocible el sistema. Esta frase describe el trabajo del producto; no introduce una identidad comercial nueva.

La interfaz permite encontrar una tarea y completarla con campos visibles, agrupaciones cortas y opciones secundarias progresivas. Este documento registra los estilos compartidos, los patrones implementados en configuración de reservas y confirmación del paciente, y las reglas de texto y composición verificadas también en la ficha clínica, Equipo y la reserva manual; no certifica una renovación de todas las páginas de la aplicación.

**Key Characteristics:**

- Una familia tipográfica para títulos, datos y controles.
- Superficies oscuras con diferencias de tono, bordes y elevación suave.
- Violeta para acciones principales, foco y selección; estados con texto propio.
- Controles consistentes, nombres cotidianos y adaptación estructural al celular.
- Texto completo: nombres, valores y mensajes se ajustan en más líneas en vez de cortarse con «…» o ensanchar la pantalla.

## Colors

### Primary

El violeta de `accent` identifica foco y selección. `accent-strong` sostiene la acción principal; `accent-press` acompaña la interacción. `accent-soft` y `accent-text` permiten estados suaves legibles sobre las superficies oscuras.

La variante de confirmación del paciente conserva esos acentos y añade los tokens `patient-*` para texto de ayuda, campos y resumen con bordes más visibles. Su alcance es ese formulario, sin sustituir la paleta administrativa. En la integración Natalia, el formulario y sus menús conservan los tokens propios de `BookingAppearance.svelte`: papel, superficie cálida y acento terracota en claro y oscuro. Esta extensión no redefine esa identidad existente.

### Neutral

`bg` es el fondo de la página; `surface` y `surface-2` agrupan contenido; `surface-raised` distingue menús y diálogos. `border-strong` delimita contenedores, mientras `border` separa filas y elementos secundarios. `text`, `text-muted` y `text-subtle` mantienen la jerarquía de lectura. Los valores del frontmatter conservan el formato del CSS original.

Verde comunica éxito; ámbar, advertencia o cambios pendientes; rojo, error o acción destructiva. Sus variantes suaves y de texto se usan juntas en avisos y estados. Cada estado necesita una etiqueta o mensaje además del color.

**The Estado legible Rule.** La persona debe poder reconocer un estado por su texto, sin depender sólo del color.

**The Tema único Rule.** Cita Suite tiene un solo tema oscuro (`color-scheme: dark`, con la variante `dark` siempre activa), también cuando el navegador prefiere el modo claro. Sólo la apariencia Natalia de la reserva pública alterna claro y oscuro, según el modo que indica su sitio (`color_mode` o el puente de la integración) y no según la preferencia del navegador.

## Typography

**Body Font:** Inter, con los fallbacks declarados en el frontmatter. La misma familia sostiene toda la jerarquía; no hay una fuente ornamental independiente.

**Escala y pesos.** Los tamaños salen de la escala de Tailwind y de los roles con nombre del frontmatter (`micro`, `caption`, `supporting`, `body`, `cta`, definidos en `tailwind.config.js`), nunca de valores literales; lo controla `scripts/lib/type-scale.test.mjs`. Los pesos son los que se cargan: 400, 500, 600 y 700. Un peso mayor se dibujaría como 700, así que no se pide (`scripts/lib/font-weights.test.mjs`).

`headline` corresponde al título de página; `title`, a grupos de trabajo. `body` registra el tamaño base del documento. `supporting` acompaña títulos con contexto breve; `label` nombra campos; `button` y `badge` mantienen acciones y estados compactos. Los campos usan un tamaño de una unidad rem para conservar legibilidad y evitar el zoom automático en iOS.

En el formulario final, `patient-service` nombra el servicio y profesional, `patient-label` hace legibles las preguntas y `patient-confirm` destaca el envío. El título del resumen pasa a (1.15rem) en la adaptación móvil. Estas funciones heredan Hanken Grotesk cuando el tema existente es Natalia; sus títulos de página conservan Newsreader.

**The Texto inseparable Rule.** Una cantidad no se separa de su unidad ni un contador se parte entre líneas: las duraciones usan `formatDuration` («30 minutos») y los pasos `formatStepCounter` («Paso 3 de 5»), ambos con espacios duros, y el separador «·» queda unido con espacio duro al grupo que introduce (`·&nbsp;`). Tampoco se parten las palabras comunes ni las etiquetas cortas de botones y estados.

## Layout

La página compartida apila sus grupos con una separación de `lg`. Los contenedores admiten columnas para campos relacionados y se apilan cuando falta espacio. Los valores de spacing registran medidas recurrentes del código, no una nueva escala de CSS.

Reserva online y su editor de sitios se centran con un ancho máximo de 64rem; Configuración admite 72rem. Alrededor de 640px se reorganizan cabeceras, acciones y el bloque para compartir. La navegación de preguntas se convierte en dos columnas por debajo de 480px. Enlaces largos, nombres y mensajes deben partir líneas sin ensanchar la pantalla. Estas composiciones pertenecen a sus superficies, no son una plantilla obligatoria para toda la app.

Todo el texto admite cortes en cualquier punto (`overflow-wrap: anywhere` en el documento, los botones y los estados): una columna sin ancho propio se comprimiría hasta letras sueltas. Por eso, en una fila con texto junto a acciones o estados, el texto es la columna que se encoge (`min-w-0`) y las acciones y estados conservan su ancho (`shrink-0`). Cuando varios elementos comparten una fila angosta, la fila se ajusta con una base explícita para el texto (entre 10 y 24rem, como `flex-[1_1_12rem]`) y la acción pasa debajo. Si a (320px) tampoco entran, la acción se apila bajo el texto hasta `sm` (640px), como en el encabezado de pasos de la reserva manual y de la reserva pública. El zoom del navegador permanece habilitado.

**The Texto completo Rule.** Dentro de `main` y de los diálogos ningún texto de la tarea se corta con «…»: se ajusta en más líneas. La cabecera y la navegación pueden acortar nombres que la página muestra completos; una excepción revisada se marca con `data-truncation="allowed"`.

El formulario final del paciente usa una columna, con los grupos separados del resumen y entre sí. El espaciado de campos es `patient-fields`, que pasa a `lg` hasta (480px). En ese mismo tamaño, el contenedor reduce su padding a (1.1rem). Las respuestas binarias se presentan en dos columnas; la opción de no responder ocupa una fila completa en móvil. El resumen ubica el arancel al final de la primera fila y reserva una segunda fila completa para servicio y profesional. El orden concreto y los contenidos configurados se registran en [.impeccable/surfaces/confirmar-reserva.md](.impeccable/surfaces/confirmar-reserva.md).

## Elevation & Depth

El sistema combina capas tonales y sombras difusas. Los contenedores existentes conservan un fondo con gradientes discretos; los menús y diálogos usan una superficie sólida elevada. La sidecar registra las sombras reales y su propósito. Los menús se muestran en la capa superior cuando existe la API de popover, con posicionamiento fijo como alternativa, para evitar recortes en formularios y diálogos.

La confirmación final del paciente utiliza un fondo plano y ningún sombreado en su contenedor. El borde y el tono del resumen establecen su jerarquía. Su acción principal conserva la elevación compartida; el selector continúa usando el menú elevado existente.

## Shapes

Campos y botones comparten curvas suaves de `md`; tarjetas usan `lg` y las cabeceras destacadas existentes usan `xl`. Los estados compactos tienen forma de píldora. Menús y casillas tienen radios propios adecuados a su densidad. Bordes finos separan filas sin convertir cada dato en una tarjeta independiente.

La variante del paciente tiene una geometría propia: `patient-control` para campos de una línea y confirmación, `patient-answer` para respuestas y texto multilínea, y `patient-form` para el contenedor. En móvil el contenedor también usa `patient-answer`. El resumen conserva `md`. Estos radios describen componentes reutilizables de la confirmación, no reemplazan los radios administrativos.

## Components

### Buttons

Una acción principal violeta; acciones secundarias sobre una superficie tenue; rojo para una acción destructiva. El alto mínimo compartido es 2.75rem. Hover modifica tono y desplaza ligeramente el botón; active reduce su escala; disabled baja la opacidad y elimina elevación. Las operaciones muestran texto como “Guardando…” y bloquean acciones incompatibles mientras están pendientes. Los controles que sólo funcionan con JavaScript (abrir un diálogo, cambiar de pestaña, mostrar acciones) se muestran deshabilitados hasta que su componente hidrata (`createClientReadiness`); una vez habilitados, el primer clic funciona.

### Cards / Containers

Tarjetas para un grupo de trabajo completo; filas y separadores para listas de tareas, sitios y preguntas. El padding pasa de `lg` a `xl` en pantallas amplias. El borde, el fondo y la sombra provienen de los tokens existentes.

### Inputs / Fields

Campos oscuros, etiquetas encima y foco visible. Error y cambios sin guardar tienen borde y mensajes propios. Selectores y fechas/meses mejoran progresivamente sus controles originales: el menú, calendario y trigger tienen acabado propio mientras la fuente conserva nombre, valor, validación y bindings. El trigger muestra el valor elegido completo y lo ajusta en varias líneas en vez de truncarlo. Las horas usan un campo de texto con entrada numérica y normalización al formato HH:mm, sin menú. Casillas y radios conservan su semántica nativa con dibujo propio. No ocultar la fuente hasta que su mejora esté montada.

### Navigation

Los enlaces de Configuración nombran tareas y ofrecen una línea corta de contexto. En un profesional, Perfil, Servicios y aranceles, Horarios y Preguntas al paciente mantienen una ubicación estable. La selección se distingue visualmente y, donde corresponda, con `aria-current`. En el editor del profesional, la pestaña activa usa el violeta de acción; el hover sólo aparece con puntero y nunca cambia el aspecto de la pestaña activa. El detalle de esta arquitectura pertenece a la nota de superficie.

### Menus, calendars and dialogs

Los selectores permiten teclado, búsqueda por texto y opciones deshabilitadas. Los calendarios anuncian etiqueta y valor seleccionado, incluso tras cambios de atributos; respetan límites de fecha. Escape cierra el selector y devuelve el foco. El diálogo de cambios sin guardar prioriza “Seguir editando” y ofrece “Descartar cambios”; sólo después de aceptar limpia el borrador y navega. La salida o recarga de pestaña conserva la advertencia del navegador.

### Final patient form

Etiquetas visibles y campos amplios, con alto mínimo de `patient-input`; respuestas binarias con alto mínimo de `patient-answer`. El botón de `patient-confirm` ocupa todo el ancho y su medida de altura también es mínima. El texto multilínea conserva (6.5rem) de alto mínimo. El foco dibuja un contorno de (2px) con el acento existente. Selección y bloqueo tienen estados propios; el envío muestra “Confirmando reserva…”.

**The Respuesta explícita Rule.** Una pregunta binaria conserva respuestas independientes para Sí y No. Si es opcional, permite volver a Sin responder; vacío y No representan datos diferentes.

Las preguntas mantienen su configuración, ayuda, obligatoriedad y nombres de envío. La fecha de nacimiento ofrece día, mes y año después del montaje y envía un único valor ISO con el nombre original. Antes del montaje, o sin JavaScript, ofrece un campo de fecha nativo con ese mismo nombre y límites; conserva una fecha ingresada antes de hidratar. Los selectores mantienen la mejora progresiva compartida y el menú adopta el tema Natalia cuando corresponde.

### Website installation

La instalación es un patrón compuesto de los controles administrativos existentes. Después de guardar, el bloque “Paso 2” prioriza elegir entre agenda dentro de la web y botón para reservar. Conserva radios visibles, acción principal de copia, confirmación textual y acceso manual al código. El editor guardado se pliega al continuar; las opciones secundarias siguen disponibles.

**The Instalación explícita Rule.** Guardar la configuración autoriza el dominio; colocar el código instala la agenda. “Autorizado” describe el permiso configurado y no acredita que la web tenga un turnero funcionando.

El bloque usa las tarjetas, botones, campos, bordes y foco existentes. Las elecciones pasan de dos columnas a una hasta (640px), y la acción de copia ocupa todo el ancho en móvil. Los enlaces de prueba abren los dominios autorizados y permiten una comprobación manual; no generan una marca automática de conexión. El contrato declarativo y los estados concretos se registran en [.impeccable/surfaces/conectar-sitio.md](.impeccable/surfaces/conectar-sitio.md).

El diálogo del SDK v1 define su propio centrado y límite de ancho, sin depender de los márgenes del navegador ni del reset del sitio que lo integra. Conserva un ancho máximo de 760px y separación del borde de 16px, reducida a 8px hasta 480px. La altura disponible descuenta esa separación, el encabezado de cierre y los bordes; el contenido se desplaza dentro del iframe. La variante integrada mantiene el ancho del contenedor y la altura de su contenido, sin adoptar los límites del diálogo.

## Do's and Don'ts

### Do:

- **Do** conservar Inter y los tokens compartidos del sistema oscuro existente.
- **Do** usar etiquetas visibles, foco reconocible y texto para comunicar cada estado.
- **Do** agrupar por tarea y plegar opciones secundarias después de los campos principales.
- **Do** conservar la semántica, validación y datos del formulario al mejorar sus controles.
- **Do** aplicar la variante `patient-*` dentro de la confirmación del paciente y conservar el tema de su integración.
- **Do** dar a cada fila de texto con acciones o estados una columna de texto flexible y acciones de ancho propio, que pasan debajo cuando no entran.

### Don't:

- **Don't** inventar datos reales, tarifas, contactos ni promesas de marca.
- **Don't** compensar una estructura confusa con párrafos de instrucciones.
- **Don't** dejar menús, calendarios o confirmaciones interiores con acabado nativo cuando están mejorados con JavaScript.
- **Don't** cortar con «…» el texto de la tarea dentro de `main` o de un diálogo, separar una cantidad de su unidad ni bloquear el zoom del navegador.
- **Don't** convertir patrones de esta entrega en afirmaciones sobre páginas que no se revisaron.
