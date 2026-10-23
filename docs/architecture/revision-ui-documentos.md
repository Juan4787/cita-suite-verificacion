# Revisión de interfaz: documentos y cuotas

Fecha: 17 de octubre de 2026. Extensión de la etapa 3 de la campaña de refactorización.

La extensión mantiene el sistema establecido de Cita Suite y su modo **Operate**: administrar límites, comprender el espacio disponible y distinguir nuevas cargas de lectura histórica. El [dictamen del revisor](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/verdict-round-1.md) es **ship para las tres correcciones enumeradas, 3/3 resolved**. No constituye una auditoría completa de la interfaz ni el cierre de la campaña.

## Autoridad y alcance

Se contrastaron [PRODUCT.md](../../apps/web/PRODUCT.md), [DESIGN.md](../../apps/web/DESIGN.md), su [sidecar](../../apps/web/.impeccable/design.json), la [dirección de esta extensión](../archive/campaign-evidence-20261023/.verification/stage3-storage-ui-direction.md), código, seis capturas y los recibos recuperados de CI. Es una incorporación ordinaria al sistema existente, sin nueva identidad, paleta, familia tipográfica ni tokens.

El alcance comprende:

- Panel maestro de almacenamiento y sus acciones: `apps/web/src/routes/odonto/maestro/almacenamiento/`.
- Configuración del consultorio: `apps/web/src/routes/odonto/configuracion/documentos/+page.svelte`.
- Disponibilidad y vacío en `apps/web/src/lib/components/patients/RadiographsPanel.svelte`.
- Reparto de espacio del encabezado de `apps/web/src/routes/odonto/+layout.svelte` y acceso desde las herramientas maestras existentes.

Se preservaron byte a byte los tres archivos de autoridad. Sus huellas al comenzar y terminar esta documentación son:

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `apps/web/PRODUCT.md` | 1.801 | `5a605f04471b99a2b04f25d3cb7e5de3010c24251fdfa13cdc39e1246b3a2d2f` |
| `apps/web/DESIGN.md` | 16.778 | `6ca7b3c6e061fdf88317b07fc0be8be20e6614967f205ee9cde1fec7038a599d` |
| `apps/web/.impeccable/design.json` | 45.651 | `2748a214ebe77f4b2a692f4c6c225e07e30722a0e2cb57c82e53dea3e76b77cd` |

Esta documentación sólo crea el presente archivo. No modifica código, plan, tokens, cursos ni noticias.

## Coherencia con el sistema heredado

| Patrón establecido | Aplicación comprobada |
|---|---|
| Inter, superficies azul oscuro y acento violeta | Las tres superficies conservan la tipografía y el carácter visual del sistema. El panel nuevo utiliza los estilos compartidos de `apps/web/src/app.css`; no declara otra capa de tokens. |
| Grupos por tarea y jerarquía breve | El maestro separa configuración general y excepciones por consultorio. La configuración habitual separa envíos del paciente y espacio del consultorio; el detalle compartido queda plegado. La ficha presenta disponibilidad junto a sus documentos. |
| Tarjetas, botones, campos y estados compartidos | El panel emplea `ux-page`, `ux-card`, `ux-title`, `ux-section-title`, `ux-input`, botones primario/secundario y avisos. Hereda radios, foco, alturas mínimas y estados pendientes/deshabilitados de la hoja global. |
| Estado comunicado con texto | Éxito, rechazo, conflicto, pausa e indisponibilidad tienen mensajes propios. El color acompaña al texto. Una consulta fallida de disponibilidad no se presenta como una pausa configurada ni como una lista vacía. |
| Etiquetas visibles y semántica del formulario | Los límites tienen unidad y etiqueta; los valores decimales admiten coma. Los mensajes maestros se asocian al campo mediante `aria-describedby`; sólo los errores del importe añaden `aria-invalid`. Éxitos usan `status` y rechazos/conflictos, `alert`. |
| Preservación del trabajo | Los bindings de Svelte conservan la edición anterior a la hidratación. Los borradores son independientes por formulario; guardar uno no borra los demás. La salida con cambios utiliza la confirmación compartida y la advertencia de pestaña. |
| Adaptación estructural | A 320 px los campos y acciones se apilan y los nombres largos ocupan varias líneas. El encabezado de escritorio asigna regiones explícitas; antes de `xl` sitúa la navegación en otra fila. Las etiquetas de navegación se mantienen horizontales. |

La composición de estas páginas permanece local: sus anchos, filas y detalle de consumo no se convierten en una plantilla global. El nombre completo del consultorio sigue en el DOM y en `title`, aunque la marca del encabezado se abrevie visualmente para compartir espacio con navegación y cuenta.

La interfaz conserva las distinciones del [contrato de documentos](contabilidad-documentos.md): cuota individual sobre espacio compartido, bytes utilizados y pendientes, configuración de adjuntos del paciente, capacidad efectiva y permisos clínicos. La pausa impide nuevas cargas y mantiene la lectura histórica autorizada. Los controles orientan a la persona; la autorización y contabilidad definitivas pertenecen a PostgreSQL.

## Tres correcciones revisadas

La [revisión inicial](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/review-round-1.md) pidió un lote acotado. El mismo revisor puntuó su resolución tras las recapturas:

| Hallazgo | Resultado implementado y evidencia |
|---|---|
| **P1 — Navegación comprimida por un nombre largo** | La grilla del encabezado reparte marca, navegación y cuenta. Los enlaces evitan particiones de texto y conservan su ancho. Las capturas de consultorio y paciente a 1280 muestran los destinos legibles y separados; el E2E aprobado comprueba geometría a 768, 1024, 1280 y 1600. **Resolved.** |
| **P2 — Respuesta lejos del formulario maestro** | `form.target` sitúa el resultado dentro del formulario usado, tanto general como individual. La acción distingue importe inválido, límite menor al compromiso y conflicto de revisión, con mensajes humanos. Las capturas muestran éxito en la fila; el E2E acredita además error y conflicto locales, valores conservados y borradores ajenos intactos. **Resolved.** |
| **P2 — Invitación a adjuntar durante una pausa** | La invitación y su acción sólo aparecen con `canUpload && !demo`. En pausa, la ficha mantiene la ausencia real de documentos con texto neutral y muestra que los guardados siguen disponibles. Ambas capturas de la ficha y el E2E confirman la ausencia de invitación y botón de carga. **Resolved.** |

El dictamen no deja puntos parciales o sin resolver en **esa lista**. No amplía su conclusión a otras superficies ni sustituye las verificaciones posteriores exigidas por el plan.

## Evidencia comprobada

Corrida [39048463987](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/39048463987), fuente `50f0b58d3583402b82bd09678e779c267689b293`, digest de fuente `efe2d810070d46e49ae8d07e9aa91946b73dc4a2f40bddaa57ea54e7cbeaa41b`. El [recibo full](../archive/campaign-evidence-20261023/.verification/remote-39048463987/.verification/full.json) identifica `f0f7c135-b39d-4907-9c87-a33339bb2c04`, desde 16:15:50 hasta 16:21:06 UTC, `ok: true` y todos sus pasos con salida cero.

Se leyeron los reportes recuperados de esa corrida:

- 49 guardas de Node, 1.090 pruebas de servidor, 119 de cliente y una reapertura nativa de exportación: aprobadas, sin pendientes ni omisiones.
- [Navegador](../archive/campaign-evidence-20261023/.verification/remote-39048463987/.verification/runs/f0f7c135-b39d-4907-9c87-a33339bb2c04/integration/browser.json): 27 casos esperados aprobados, cero omitidos, inesperados o inestables. El caso de política de almacenamiento terminó aprobado y sin reintento.
- Dos casos de demo aprobados. [Natalia](../archive/campaign-evidence-20261023/.verification/remote-39048463987/.verification/native-booking/results.json) acredita navegación nativa y gestión en escritorio/móvil sobre la plataforma descartable, sin sustitución de transporte ni solicitudes a producción.
- El full incluye reconstrucción SQL y Auth/Storage reales del entorno descartable. El [recibo de tipos](../archive/campaign-evidence-20261023/.verification/remote-39048463987/.verification/generated-database-types.json) informa generación oficial reproducible; no es una inspección del esquema alojado.

El [E2E de política](../../apps/web/e2e/clinical-storage-policy.spec.ts) verifica edición de 110,5 MB antes de hidratar, cuerpo POST y persistencia de 110.500.000 bytes; borrador general independiente; cambio real de política por otra operación y rechazo de revisión antigua; importe inválido conservado y marcado; confirmación para seguir editando; cuota individual y pausa persistidas; rechazo de la carga por API; ausencia de fila creada; configuración y ficha pausadas; denegación del panel a un dueño ordinario; limpieza sintética. No se infiere persistencia únicamente del aviso de éxito.

Se abrieron estas seis capturas. Sus bytes coinciden con el origen recuperado de CI y sus seis SHA-256 coinciden con el [manifiesto de capturas](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/capture-source.json):

| Superficie/estado | Escritorio 1280 | Móvil 320 |
|---|---|---|
| Maestro, límite individual guardado y nombre largo | [desktop](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/master/desktop.png) | [mobile](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/master/mobile.png) |
| Configuración del consultorio pausado | [desktop](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/clinic/desktop.png) | [mobile](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/clinic/mobile.png) |
| Ficha del paciente pausada y vacía | [desktop](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/patient/desktop.png) | [mobile](../archive/campaign-evidence-20261023/.impeccable/review/storage-quotas-20261017/patient/mobile.png) |

Las imágenes corresponden a sus superficies, con contenido cargado y captura desde el inicio. La posición intermedia de la barra móvil fija en una imagen de página completa pertenece al viewport de captura; por sí sola no demuestra una regresión. El helper comprueba ausencia de desbordamiento horizontal antes de capturar.

## Desviaciones previas y límites

El [detector ya conservado](../archive/campaign-evidence-20261023/.verification/stage3-storage-ui-detector.json) enumera siete recomendaciones en los estilos de la página maestra anterior: cuatro tamaños de texto fuera de la escala documentada y tres radios. El diff de `apps/web/src/routes/odonto/maestro/+page.svelte` incorpora únicamente el enlace a almacenamiento; esas declaraciones de estilo ya existían. Se registran como desviación previa, sin modificar estilos ni ampliar la autoridad de DESIGN. Ese detector no inspecciona el estado final de `RadiographsPanel` y no se volvió a ejecutar para esta documentación.

El registro de campaña también conserva un aviso previo de metadata `buildPath` del tooling. No se refrescó esa metadata ni se presenta como comprobada nuevamente mediante una ejecución de contexto.

Esta revisión documental hizo lecturas, apertura de imágenes y comparaciones de bytes/huellas. No ejecutó tests, builds, navegador local, contexto ni detector; las pruebas de funcionamiento citadas pertenecen al runner externo y su plataforma descartable.

Las capturas muestran los estados indicados, no todos los errores, cargas o diálogos. La asociación accesible está comprobada en el código y ciertas conductas en el E2E; no se atribuye una auditoría interactiva completa de teclado, foco o lector de pantalla a las imágenes. La geometría adicional de escritorio no equivale a capturas de todos esos anchos. Quedan fuera de este dictamen la matriz transversal de la etapa 5, todos los temas y recorridos, capacidad alojada, staging, release y producción. El cierre integral se rige por el [plan original](../plans/refactorizacion-cita-suite.md) y su [registro separado](../plans/registro-refactorizacion-cita-suite.md).
