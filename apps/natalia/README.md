# Web de Natalia

Aplicación estática en Astro + TypeScript + Tailwind. Conserva la identidad y las fotos de la maqueta `WEB NATALIA`; utiliza el único motor de reserva de Cita Suite. No guarda agendas ni reservas en el navegador.

La campaña vigente ejecuta los tipos, builds y navegadores secuencialmente en CI; no lanzar los comandos pesados en la computadora del usuario. Desde la raíz del monorepo, en ese entorno de verificación:

```sh
pnpm --filter natalia check
pnpm --filter natalia build
pnpm --filter natalia test:browser
pnpm --filter natalia dev
```

Copiar `.env.example` a una configuración local para indicar la URL pública de Cita Suite y la clave pública del enlace creado en **Configuración → Reserva online**. La clave pública no es una contraseña ni una clave de Supabase. No agregar credenciales del consultorio al sitio estático.

Sin enlace configurado, `/turnos` explica que las reservas todavía no están habilitadas. No inventa horarios, precios ni contacto. Con enlace configurado, los botones abren el turnero y conservan una URL directa como alternativa. El catálogo público consulta las prestaciones del mismo enlace cuando la sección entra en proximidad de la pantalla. Las preguntas y el guardado del paciente pertenecen a Cita Suite.

La aplicación usa HTML estático, fuentes WOFF2 locales, fotografías WebP responsivas, dimensiones explícitas y carga diferida del contenido inferior. Los enlaces de reserva navegan en la misma pestaña al turnero real de Cita Suite; Natalia no usa el SDK ni un iframe. El menú, el tema y el catálogo usan TypeScript pequeño; no se hidrata un framework de interfaz.

La parte pública conserva las diez secciones de la referencia, las cuatro consultas y sus detalles, los tres cursos, las tres notas completas, los testimonios suministrados, la formación y el pie completo. Las notas y los detalles funcionan con diálogos nativos y páginas propias, también sin JavaScript. `check:public`, incluido en el build, protege la presencia de todos estos bloques y sus destinos.

Los valores editoriales de la maqueta se muestran como referencia; la agenda configurada es la fuente de prestaciones, horarios y aranceles vigentes. Las acciones de cursos conservan su lugar y permiten leer la información, con inscripción, cobro y acceso de estudiantes deshabilitados. El contacto directo espera datos confirmados. No se simulan inscripciones, pagos ni mensajes enviados. El aula autenticada y la administración de cursos/noticias están pospuestas, fuera del trabajo actual.

Con integración activa, el catálogo también publica el teléfono y la dirección configurados en Cita Suite. Las prestaciones de ese catálogo enlazan a la agenda conservando `service_id`. Los IDs editoriales nunca se usan como servicios operativos. Las pruebas aisladas de la presentación usan respuestas controladas; los recorridos nativos de la campaña utilizan Auth/Storage reales descartables y, en release, staging alojado. Sus pruebas y entornos no se sustituyen entre sí: ver [verificación](../../docs/architecture/verificacion.md).

## Procedencia de los recursos

Las imágenes derivan de las fotografías suministradas en `WEB NATALIA/assets`: se redimensionaron y comprimieron, sin generar imágenes nuevas. El contenido editorial conserva referencias de la maqueta y necesita revisión del consultorio antes de publicar; no acredita títulos ni datos públicos reales por sí mismo.

Newsreader y Hanken Grotesk se obtuvieron del servicio oficial Google Fonts. Se incluyen sus licencias SIL Open Font License en `public/fonts/licenses/`, provenientes de `google/fonts`, directorios `ofl/newsreader` y `ofl/hankengrotesk`. La página institucional carga las fuentes locales. El adaptador de reserva de Cita Suite todavía usa Google Fonts al abrir el turnero o una página pública del turno.

El alcance actual está en [PRODUCT.md](PRODUCT.md) y el [plan aprobado](../../docs/plans/refactorizacion-cita-suite.md). La autorización de documentos del 14 de octubre sustituyó la postergación inicial: las cargas se verifican en Cita Suite con sus límites y permisos; no se activa una configuración clínica ausente ni se convierte la maqueta en fuente de datos. Publicación y reversión: [procedimiento vigente](../../docs/architecture/publicacion-y-reversion.md). Los documentos de integración inicial se conservan como historia y compatibilidad del embed.
