# Revisión de interfaz: disponibilidad y aranceles

Fecha: 17 de octubre de 2026, hora argentina. Extensión de la etapa 4 de la campaña de refactorización.

El [dictamen independiente](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/review-round-1.md) es **ship para esta extensión**, sin correcciones materiales exigidas. Comprende navegación pública por fechas, recuperación de disponibilidad interna y previsualización de aranceles. No certifica toda la aplicación, un despliegue alojado ni el cierre de la campaña.

## Autoridad, alcance y preservación

Se contrastaron el [plan original íntegro](../plans/refactorizacion-cita-suite.md), el [registro de ejecución](../plans/registro-refactorizacion-cita-suite.md), la [dirección de la extensión](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/direction.md), [PRODUCT.md](../../apps/web/PRODUCT.md), [DESIGN.md](../../apps/web/DESIGN.md) y su [sidecar](../../apps/web/.impeccable/design.json). El modo es **Operate**: completar una reserva, recuperar una búsqueda y revisar una configuración antes de guardarla. Es una extensión ordinaria del sistema existente; no hay identidad nueva ni comp aprobado.

| Artefacto contrastado | Responsabilidad en esta revisión |
|---|---|
| `apps/web/src/lib/booking/PublicBookingFlow.svelte` | Rango de fechas, expansión local, navegación y salida de una ventana vacía. |
| `apps/web/src/lib/components/agenda/ManualAppointmentWizard.svelte` | Semana visible, estados de búsqueda, rechazo de respuestas incompletas y reintento. |
| `apps/web/src/routes/odonto/agenda/+page.svelte` | Inicialización de acciones que requieren JavaScript y referencias internas. |
| `apps/web/src/lib/booking/PricePolicyEditor.svelte` y `pricing.ts` | Preview local, límites inclusivos y traducción de errores al formulario. |
| `apps/web/src/lib/booking/BookingAppearance.svelte` | Presentación existente de Natalia, sin autoridad sobre permisos ni cálculo. |

Los seis archivos coinciden byte a byte con su contenido en la revisión de CI `c0129e492051a38d5b8025158fb996a81da0e871`. También coinciden las fuentes E2E y de componente citadas abajo. La documentación crea únicamente este archivo; no modifica código, plan, registro, evidencias ni autoridades de diseño. El formulario final conserva su orden obligatorio/opcional; cursos y noticias permanecen fuera del alcance.

Las huellas de las tres autoridades coinciden con el [manifiesto incumbente](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/incumbent-hashes.json) antes y después de esta documentación:

| Archivo | Bytes | SHA-256 preservado |
|---|---:|---|
| `apps/web/PRODUCT.md` | 1.801 | `5a605f04471b99a2b04f25d3cb7e5de3010c24251fdfa13cdc39e1246b3a2d2f` |
| `apps/web/DESIGN.md` | 16.778 | `6ca7b3c6e061fdf88317b07fc0be8be20e6614967f205ee9cde1fec7038a599d` |
| `apps/web/.impeccable/design.json` | 45.651 | `2748a214ebe77f4b2a692f4c6c225e07e30722a0e2cb57c82e53dea3e76b77cd` |

## Decisiones de interacción y estados

| Situación | Comportamiento documentado |
|---|---|
| Fechas públicas en carga | El paso muestra su estado de búsqueda; los resultados anteriores no se presentan como la nueva selección lista. |
| Ventana pública con fechas | El rango visible contextualiza la lista. “Ver más días” revela fechas ya cargadas; “Fechas siguientes” aparece cuando esa expansión terminó. Son acciones diferentes y no compiten por ocultar días disponibles. |
| Ventana pública vacía | El mensaje limita la ausencia a esas fechas, mantiene el contexto y ofrece cambiar la selección. Si existe otra ventana, “Fechas siguientes” es la salida principal. No se interpreta una quincena vacía como ausencia en todo el horizonte. |
| Navegación pública | Enlaces anteriores/siguientes conservan servicio, profesional o equipo y contexto de integración; limpian día/horario al cambiar de ventana. No se precarga automáticamente todo el horizonte. En móvil las acciones ocupan una columna; en escritorio admiten dos. |
| Acciones internas antes de inicializar | “Nuevo turno” y “Buscar” permanecen deshabilitados hasta montar sus handlers y estado. El primer clic habilitado abre el asistente; el cambio no deshabilita formularios con acción de servidor. |
| Búsqueda interna pendiente o vacía | La carga muestra su indicador. La semana realmente vacía mantiene un mensaje y navegación propios. El asistente pide siete fechas inclusivas cuando muestra una semana y una fecha al elegir un día. |
| Respuesta interna incompleta | Se retiran las opciones y la selección no certificadas, se muestra “No pudimos actualizar los horarios. No se reservó nada. Probá nuevamente.” y se ofrece “Reintentar búsqueda”. No coexiste con el mensaje de semana vacía. |
| Recuperación interna | El reintento conserva el último rango solicitado. Tras una respuesta válida reaparecen días reales de esa misma semana. El snapshot vencido o insuficiente no fundamenta una afirmación de vacío. |
| Preview con campos incompletos | Una ayuda pide completar importe y meses. Este estado se distingue de una configuración completa inválida. |
| Preview válido en el límite | El editor solicita hasta seis resultados válidos y conserva el mes 600 inclusive. El calculador mantiene el máximo de 120 resultados por llamada y rechaza pedidos explícitos fuera de rango. |
| Preview inválido | Fecha, importe y configuración tienen mensajes humanos dentro del formulario. El porcentaje mensual inválido conserva el valor, marca su input con `aria-invalid` y enlaza el mensaje mediante `aria-describedby`. El aviso usa `status`; guardar permanece bloqueado. |
| Corrección del preview | Al corregir el porcentaje reaparece la tabla, se retiran el aviso y el estado inválido y vuelve a habilitarse guardar. La previsualización no envía la política. |

La interfaz orienta la edición y selección. PostgreSQL conserva permisos, exclusión, idempotencia, revalidación y confirmación atómica. La [documentación del mecanismo](disponibilidad-y-aranceles.md) y la [matriz de etapa 4](evidencia-etapa4-agenda.md) describen sus pruebas propias: una captura no demuestra esas garantías.

El preview mantiene la serie exacta con una fracción de enteros y redondea sólo la cotización final; el resultado redondeado no alimenta el mes siguiente. El vector de control conserva 15 → 23 → 34 con aumento del 50 %. SQL confirma el precio y su fotografía histórica, con actualización y aceptación si cambió la política entre cotización y confirmación. Esta documentación no traslada esa autoridad al navegador.

## Correspondencia con el sistema existente

| Patrón incumbente | Correspondencia comprobada |
|---|---|
| Inter, superficies azul oscuro y acento violeta | La agenda, editor y reserva Cita Suite mantienen la familia, capas tonales, bordes, controles y acciones compartidos. No se añade una escala de tokens. |
| Presentación Natalia | `BookingAppearance` conserva Hanken Grotesk, títulos Newsreader, papel/superficie cálida y acento terracota. La navegación y el cálculo son los mismos. Las capturas de esta matriz muestran su variante clara; el código conserva su variante oscura existente. |
| Agrupación por tarea y jerarquía breve | Fechas, recuperación y preview aparecen en su paso o formulario. El error informa el problema y la siguiente acción sin exponer identificadores internos. |
| Botones, campos y avisos compartidos | Se reutilizan `ux-card`, `ux-choice`, `ux-btn-primary`, `ux-btn-secondary`, `ux-input`, `ux-empty` y `ux-alert`, con los controles de selección/mes ya mejorados. No se introduce una apariencia nativa nueva. |
| Estado reconocido por texto | Vacío, carga, fallo y recuperación tienen texto propio. El color acompaña; no sustituye la explicación del estado. |
| Semántica y foco | La paginación usa enlaces dentro de una navegación con nombre; la expansión y reintento usan botones. Se conserva el foco del sistema y el aviso de error interno usa `alert`. El porcentaje inválido tiene asociación accesible explícita. |
| Adaptación estructural | Las capturas a 320 muestran apilado de acciones y campos, nombres y mensajes en varias líneas. La geometría E2E comprueba enlaces móviles de más de 200 px de ancho y hasta 64 px de alto, además de ausencia de desbordamiento horizontal. |

Las decisiones de esta superficie permanecen locales. La revisión no convierte el paginado, los anchos o los estados del editor en reglas nuevas de todo el sistema.

## Evidencia contrastada

Corrida [39090572628](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/39090572628), fuente `c0129e492051a38d5b8025158fb996a81da0e871`. El [manifiesto de capturas](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/capture-source.json) conserva digest de fuente `09c5de9871c64cce502c1afcc1204f9a49d34de94360b7999934c5573209760a` y huella del paquete de evidencia `f9658aff60aefcece0ffa623553fa92b7e971ed4c5b3ad41364545ec8c41afaf`. Estas dos huellas se identifican según ese manifiesto y el registro; no se regeneró el paquete durante esta documentación.

Se leyeron el [recibo full](../archive/campaign-evidence-20261023/.verification/remote-39090572628/.verification/runs/85b7009b-d5df-4500-9e78-fc6f442b18bd/result.json), los reportes unitarios y de navegador recuperados. El recibo identifica `85b7009b-d5df-4500-9e78-fc6f442b18bd`, 02:36:36–02:42:02 UTC del 18 de octubre, `ok: true` y todos sus pasos con salida cero:

- 1.148 pruebas de servidor, 123 de cliente y una reapertura nativa de exportación aprobadas, con cero fallidas, pendientes o todo. Los tres casos de componente del editor aprueban mes 600, fecha fuera del límite y configuración completa inválida.
- [Navegador de integración](../archive/campaign-evidence-20261023/.verification/remote-39090572628/.verification/runs/85b7009b-d5df-4500-9e78-fc6f442b18bd/integration/browser.json): 29 casos esperados aprobados, cero omitidos, inesperados o inestables. Los dos casos específicos de ventanas/recuperación aprobaron sin reintentos.
- El full incluye SQL, Auth/Storage reales y tipos. El registro y la matriz conservan el detalle de 30 controles de disponibilidad, 18 vectores de paridad, 14 de ciclo de precios, diez carreras y generación oficial reproducible. No se abrió el archivo voluminoso de tipos para esta revisión documental.
- [Natalia nativa](../archive/campaign-evidence-20261023/.verification/remote-39090572628/.verification/native-booking/results.json) acredita navegación en la misma pestaña y gestión completa a 1440/390, sin sustitución de transporte; [demo](../archive/campaign-evidence-20261023/.verification/remote-39090572628/.verification/runs/85b7009b-d5df-4500-9e78-fc6f442b18bd/demo/browser-demo.json) conserva dos casos aprobados. Estos recorridos no amplían los anchos de la matriz visual siguiente.

El [E2E de las superficies](../../apps/web/e2e/booking-embed.spec.ts) delimita el origen de cada prueba: crea un bloqueo sintético real de quince días en PostgreSQL descartable; activa “Fechas siguientes” con Enter en las cuatro combinaciones de marca/ancho; comprueba rango, expansión local, selección de día y horarios, y retorno a la ventana vacía. En el recorrido interno intercepta deliberadamente una respuesta con HTTP 200 y `{}` para reproducir datos incompletos; luego retira esa sustitución y comprueba respuesta real, slots y mismo rango al reintentar. En el editor cambia 1001 % a 0 %, comprueba estados y mantiene el contador de POST en cero. La respuesta defectuosa es simulada; la recuperación y los datos sintéticos válidos pertenecen a la plataforma descartable.

Se abrieron las doce imágenes enumeradas, con contenido cargado desde el inicio del documento. Las doce huellas coinciden con el manifiesto y sus bytes coinciden con los originales recuperados de CI:

| Superficie y estado | 1280 | 320 |
|---|---|---|
| Cita Suite, ventana vacía | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-empty-cita-suite-1280.png) | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-empty-cita-suite-320.png) |
| Cita Suite, fechas disponibles | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-dates-cita-suite-1280.png) | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-dates-cita-suite-320.png) |
| Natalia, ventana vacía | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-empty-natalia-1280.png) | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-empty-natalia-320.png) |
| Natalia, fechas disponibles | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-dates-natalia-1280.png) | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-dates-natalia-320.png) |
| Agenda interna, respuesta incompleta | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-internal-error-desktop.png) | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/availability-internal-error-mobile.png) |
| Aranceles, porcentaje inválido | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/price-preview-error-desktop.png) | [captura](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/price-preview-error-mobile.png) |

El dictamen fresco conserva sus cinco secciones: `persistence`, `fidelity`, `ceiling`, `material_fixes` y `keep`. Resuelve **ship** sin correcciones materiales en este alcance. Las dos inspecciones propias previas y el dictamen ya están terminados; esta documentación no abre otro ciclo de pulido.

## Desviaciones previas y límites

El [detector conservado](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/detector.json) y sus [notas](../archive/campaign-evidence-20261023/.impeccable/review/availability-20261017/detector-notes.md) registran una única ejecución, cero hallazgos primarios y cuatro recomendaciones por texto de 11 px fuera de la escala documentada. Se contrastó con `57c1470`: tres usos en PublicBookingFlow y uno en agenda, con el mismo recuento actual. Son desviaciones preexistentes; no se amplió DESIGN ni se cambiaron estilos para ocultarlas.

El log recuperado de Vite conserva tres avisos genéricos de fetch durante SSR. El registro mantiene su diagnóstico separado pendiente para etapa 5; un full aprobado no los da por resueltos. Esta revisión no los atribuye a un defecto visual ni presume su causa.

La matriz visual se limita a 320/1280 y a los estados indicados, con Cita Suite oscuro y Natalia claro. No acredita por sí sola todos los temas, anchos, cargas, diálogos, contraste calculado, lector de pantalla o navegación completa por teclado. La activación con Enter y las interacciones citadas se fundamentan en el E2E aprobado, no en la imagen. La barra móvil fija visible a la altura del viewport dentro de una captura de página completa no demuestra por sí sola un recorte del contenido.

Esta documentación utilizó lecturas, apertura de imágenes y comparaciones de bytes/huellas. No ejecutó tests, builds, navegador local, launcher de contexto ni otro detector. Las pruebas citadas se ejecutaron en CI con datos sintéticos aislados; no prueban staging o producción ni persistencia en los proyectos alojados. La autorización de producción del plan no convierte esas comprobaciones pendientes en aprobadas.

Las etapas 5 y 6, la matriz transversal de interfaz, los escenarios de capacidad de cinco/veinticinco consultorios, staging, release, publicación/verificación de producción y auditoría final conservan sus puertas y criterios del plan. El cierre de etapa se registra en el registro de campaña; este documento aporta la revisión visual acotada y su evidencia, sin declarar terminada la refactorización.
