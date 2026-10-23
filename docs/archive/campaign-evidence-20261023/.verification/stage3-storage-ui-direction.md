# Extensión de documentos y cuotas — dirección y evidencia

## Encargo aprobado

Campaña de refactorización, etapa 3: cuota automática de 100 MB, presupuesto compartido de 700 MB, excepciones y valor inicial administrables, activación coherente, preservación de datos y límites diferenciados. El usuario exige claridad intuitiva, funciones ubicadas por tarea, controles personalizados, ausencia de desbordamientos y rigor comprobable. Esta extensión conserva el sistema visual existente; no redefine la identidad de Cita Suite ni toca cursos o noticias.

## Contrato de dirección

Modo Operate. El dueño del consultorio ve su espacio y configura qué puede adjuntar el paciente en Configuración → Archivos de pacientes. El administrador maestro administra límites en su herramienta dedicada. Los permisos clínicos, la disponibilidad de nuevas cargas y el espacio comprometido son estados diferentes. Pausar nuevas cargas conserva la lectura histórica autorizada. La ficha del paciente muestra una pausa o indisponibilidad explícita sin simular una lista vacía.

Se heredan tipografía, tokens semánticos, espaciado, formularios y botones ux existentes en `apps/web/PRODUCT.md`, `apps/web/DESIGN.md` y `apps/web/.impeccable/design.json`. No hay comp ni nuevo mundo visual. Se permiten saltos de línea en nombres largos; no se oculta overflow para aparentar corrección. Los formularios conservan datos tras fallo y borradores de otros formularios, y advierten antes de salir con cambios.

## Alcance de revisión

- `apps/web/src/routes/odonto/maestro/almacenamiento/+page.svelte` y su cargador/acciones.
- `apps/web/src/routes/odonto/configuracion/documentos/+page.svelte`.
- Estado de cargas en `apps/web/src/lib/components/patients/RadiographsPanel.svelte`.
- Enlace de acceso desde la página maestra existente; no rediseño de esa página completa.

El detector ya ejecutado está en `.verification/stage3-storage-ui-detector.json`: siete avisos de estilos preexistentes del panel maestro, sin hallazgos en el panel nuevo/documentos. No incluye el estado posterior de RadiographsPanel y no sustituye una revisión visual.

## Evidencia requerida

Capturas reales de escritorio 1280 y móvil 320 del panel nuevo, con nombre de consultorio largo, y estados de pausa configurados por API real. Las pruebas también deben demostrar persistencia, error conservado, borradores independientes, salida con cambios y rechazo del usuario ordinario. Antes de atribuir aprobación visual deben abrirse las capturas y remitirlas al revisor independiente solicitado por Impeccable. Las capturas, revisión y documentación todavía están pendientes al crear este documento.

Este documento no acredita el resto de la matriz visual de etapa 5 (320/390/768/1280/1600, temas, teclado y todos los recorridos). Tampoco acredita staging, publicación o capacidad alojada.
