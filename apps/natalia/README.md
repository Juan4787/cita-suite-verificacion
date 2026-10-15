# Web de Natalia

Aplicación estática en Astro + TypeScript + Tailwind. Conserva la identidad y las fotos de la maqueta `WEB NATALIA`; utiliza el único motor de reserva de Cita Suite. No guarda agendas ni reservas en el navegador.

Desde la raíz del monorepo:

```sh
pnpm --filter natalia check
pnpm --filter natalia build
pnpm --filter natalia test:browser
pnpm --filter natalia dev
```

Copiar `.env.example` a una configuración local para indicar la URL pública de Cita Suite y la clave pública del enlace creado en **Configuración → Reserva online**. La clave pública no es una contraseña ni una clave de Supabase. No agregar credenciales del consultorio al sitio estático.

Sin enlace configurado, `/turnos` explica que las reservas todavía no están habilitadas. No inventa horarios, precios ni contacto. Con enlace configurado, los botones abren el turnero y conservan una URL directa como alternativa. El catálogo público consulta las prestaciones del mismo enlace cuando la sección entra en proximidad de la pantalla. Las preguntas y el guardado del paciente pertenecen a Cita Suite.

La aplicación usa HTML estático, fuentes WOFF2 locales, fotografías WebP responsivas, dimensiones explícitas y carga diferida del contenido inferior. El SDK y el iframe de reserva se cargan al solicitar un turno. El menú, el tema y el catálogo usan TypeScript pequeño; no se hidrata un framework de interfaz.

La parte pública conserva las diez secciones de la referencia, las cuatro consultas y sus detalles, los tres cursos, las tres notas completas, los testimonios suministrados, la formación y el pie completo. Las notas y los detalles funcionan con diálogos nativos y páginas propias, también sin JavaScript. `check:public`, incluido en el build, protege la presencia de todos estos bloques y sus destinos.

Los valores editoriales de la maqueta se muestran como referencia; la agenda configurada es la fuente de prestaciones, horarios y aranceles vigentes. Las acciones de cursos conservan su lugar y permiten leer la información, con inscripción, cobro y acceso de estudiantes pendientes. El contacto directo espera datos confirmados. No se simulan inscripciones, pagos ni mensajes enviados. El aula autenticada y el panel interno corresponden a la etapa posterior solicitada por el usuario.

Con integración activa, el catálogo también publica el teléfono y la dirección configurados en Cita Suite. Las prestaciones de ese catálogo enlazan a la agenda conservando `service_id`. Los IDs editoriales nunca se usan como servicios operativos. La prueba de navegador usa el SDK real y respuestas interceptadas, un navegador y contextos secuenciales; no utiliza Auth ni escribe en una base o servicio remoto.

## Procedencia de los recursos

Las imágenes derivan de las fotografías suministradas en `WEB NATALIA/assets`: se redimensionaron y comprimieron, sin generar imágenes nuevas. El contenido editorial conserva referencias de la maqueta y necesita revisión del consultorio antes de publicar; no acredita títulos ni datos públicos reales por sí mismo.

Newsreader y Hanken Grotesk se obtuvieron del servicio oficial Google Fonts. Se incluyen sus licencias SIL Open Font License en `public/fonts/licenses/`, provenientes de `google/fonts`, directorios `ofl/newsreader` y `ofl/hankengrotesk`. La página institucional carga las fuentes locales. El adaptador de reserva de Cita Suite todavía usa Google Fonts al abrir el turnero o una página pública del turno.

Las instrucciones de activación y la auditoría de implementación están en `docs/booking-integration/implementation-natalia.md` en la raíz del monorepo. La carga de estudios por el paciente está expresamente postergada.
