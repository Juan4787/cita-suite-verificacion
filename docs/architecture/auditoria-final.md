# Auditoría final punto por punto

Contraste del [plan aprobado](../plans/refactorizacion-cita-suite.md) con la evidencia, como exige su instrucción de ejecución: «antes de declarar terminada la campaña, verificá punto por punto el cumplimiento del documento original utilizando evidencia comprobable». Las corridas y su detalle están en el [registro](../plans/registro-refactorizacion-cita-suite.md).

**Estado al 23 de octubre, ~03:48 UTC: auditoría abierta.** La campaña **no** está terminada: `verify:release` 39783349541 de `dfb487f` aprobó el nivel completo, pero falló después sobre el artefacto compilado (dos advertencias de consola desconocidas); el paso de staging no se ejecutó. Diagnóstico 39850821824 sobre `3c11ed0`, paquete 39850442948. El diagnóstico 39859031404 aprobó sus tres casos; la candidata a354 está empaquetada (39896557552), fue desplegada en staging y se ejecutó el rollback nativo a dfb. Su ensayo funcional 39896937395 y el release completo siguen pendientes. También faltan producción, capacidad y las decisiones marcadas abajo. Una fila se cierra sólo con su evidencia; una corrida detenida no aprueba las suites posteriores.

Estados:
- **Cumplido:** con su evidencia.
- **Pendiente:** trabajo que sigue, con su puerta.
- **Decisión del usuario:** requiere gasto o un compromiso suyo.
- **Impedimento:** límite demostrado del proveedor, informado con alternativas.
- **Postergado:** con su riesgo documentado.

## 1. Decisiones fijadas

| Requisito | Evidencia | Estado |
|---|---|---|
| Seis áreas con subdivisiones útiles | [áreas y fronteras](areas-y-fronteras.md); reglas de `dependency-cruiser` en `verify:fast` | Cumplido |
| Calculador TS común y lecturas SQL acotadas | [disponibilidad y aranceles](disponibilidad-y-aranceles.md), [evidencia de etapa 4](evidencia-etapa4-agenda.md) | Cumplido |
| SQL confirma el importe, TS previsualiza, paridad comprobada | Vectores comunes y pruebas de paridad (etapa 4) | Cumplido |
| Presupuesto global de 700 MB y cuota base de 100 MB | [contabilidad de documentos](contabilidad-documentos.md), [evidencia de etapa 3](evidencia-etapa3-documentos.md) | Cumplido |
| Cuotas como máximos, no espacio reservado | Ídem | Cumplido |
| Programación nativa de Cloudflare con presupuestos medidos | [tareas automáticas](tareas-automaticas.md); staging con los cinco cron | Cumplido en staging; producción pendiente |
| Push y calendario cada cinco minutos, inicio dentro de diez | Etapa 6: escenario del plan y entrega real por FCM a un Samsung | Cumplido en staging; producción pendiente |
| Pruebas pesadas en CI descartable, sin cargar la computadora | [verificación](verificacion.md) | Cumplido |
| Natalia navega al turnero real | Reserva nativa comprobada en el nivel completo; copia de Natalia desplegada en staging. Su recorrido alojado se exige en el último paso de `verify:release`. | Cumplido en CI; recorrido alojado de la candidata pendiente de release aprobado |
| Cursos y noticias fuera; sin WhatsApp | Medición de Natalia; secciones intactas en `check-public.mjs` | Cumplido |

## 2. Arquitectura y contratos

| Requisito | Evidencia | Estado |
|---|---|---|
| Importaciones sólo entre interfaces públicas, sin ciclos ni código de servidor en el navegador | `dependency-cruiser` fijado, sin excepciones permanentes | Cumplido |
| Propiedad de las reglas | [contratos funcionales](functional-contracts.md) | Cumplido |
| Fábricas Supabase y consumidores tipados; tipos reproducibles | Doble generación con igualdad exacta en cada full; guarda `type-escapes` | Cumplido |
| JSON validados en ejecución | Contratos `readRecord` y `InvalidDataContractError`; tandas de la auditoría transversal | Cumplido |
| Contexto común sin caché global de permisos | [tipado, contexto y aislamiento](tipado-contexto-aislamiento.md) | Cumplido |
| Cuatro cuestiones de capacidades | [permisos y capacidades](permisos-y-capacidades.md) | Cumplido |
| Rutas públicas y enlaces de gestión conservados; RPC con transición explícita | Reserva nativa con recuperación y comprobante anterior compatible | Cumplido |
| `/odonto` histórica; el módulo administrativo inactivo no se activa | [identidad](identidad-cita-suite.md); archivo en `docs/archive/administrativo-inactivo` | Cumplido |

## 3. Etapas

| Etapa | Cierre exigido | Evidencia | Estado |
|---|---|---|---|
| 0 | Base identificada, cambios preservados y alcance trazable | [base de campaña](base-de-campana.md) | Cumplido |
| 1 | Los comandos detectan una falla deliberada y no informan éxito si omiten una suite | Registro, etapa 1: pruebas adversarias del ejecutor | Cumplido |
| 2 | Clientes tipados, JSON comprobados, contexto común, negativas entre consultorios y tras revocar | Suites `tenant_*`; [matriz de regresiones](matriz-regresiones.md), puntos 1 y 2 | Cumplido |
| 3 | Carreras, expiración, repetición, reconciliación, descarga correcta y ampliación de cuotas | [Evidencia de etapa 3](evidencia-etapa3-documentos.md); el ensayo de ampliación también sobre el paquete del release | Cumplido |
| 4 | Equivalencia pública e interna, paridad, reservas simultáneas, reprogramación, excepciones, márgenes, cambios de política y respuestas perdidas | [Evidencia de etapa 4](evidencia-etapa4-agenda.md) | Cumplido |
| 5 | Equivalencia funcional y visual, capturas y recorridos | [Evidencia de etapa 5](evidencia-etapa5-estructura.md); full 39276578152; dictamen independiente `ship` | Cumplido |
| 6 | Recuperación y trabajo ordinario dentro de diez minutos | [Tareas automáticas](tareas-automaticas.md); fulls 39364962358 y 39366010644; recuperación en staging | Cumplido en staging; producción pendiente |

## 4. Capacidad, regresiones y observabilidad

| Requisito | Evidencia | Estado |
|---|---|---|
| Escenarios de 5 y 25 consultorios en CI | [capacidad](capacidad.md) | Evidencia conservada. Ya no es condición de cierre (decisión del 20 de octubre). |
| Dos consultorios en el despliegue gratuito: lecturas p95 < 1 s y p99 < 2 s | Staging, 39685702630: p95 cumplido; p99 de 2.046, 4.124 y 3.619 ms | **Impedimento.** Atribuido a la memoria de Supabase Nano. La medición de producción en São Paulo está pendiente y el plan lo decide el usuario. |
| Escrituras p95 < 1,5 s y p99 < 3 s | Ídem: p99 cumplido en las tres repeticiones; p95 de 1.758, 1.088 y 921 ms | **Impedimento:** la repetición 1 supera el p95. No se atribuyó por separado. Pendiente la medición de producción. |
| Errores técnicos < 1 % | Ídem: 4 errores de red, ninguno de la aplicación. Sobre el total de cada fase, debajo del 1 % (0,48 %, 0 %, 0,48 % y 0,64 %). | Cumplido en staging |
| Sin violaciones de aislamiento, doble reserva ni cuotas | Integridad antes y después de cada carga: 0 cruces y 0 superposiciones | Cumplido |
| Disponibilidad completa o error explícito | Contratos de la etapa 4 y auditoría transversal (`r2`, `R7`, `r11`) | Cumplido |
| Colas: cinco pendientes por consultorio y escenario desigual | Etapa 6 en staging | Cumplido |
| Planes, índices, bloqueos y crecimiento de consultas | [capacidad](capacidad.md); correcciones `20261020020000` a `20261020050000` | Cumplido |
| Matriz de regresiones | [matriz de regresiones](matriz-regresiones.md): 12 puntos con sus capas | Cumplido |
| Observabilidad: viajes HTTP, proveedores y SQL separados; registros sin datos clínicos | Contadores de los trabajos (`databaseRequests`, `providerRequests`); `tail-metrics.mjs` | Cumplido |

## 5. Auditoría, publicación y documentación

| Requisito | Evidencia | Estado |
|---|---|---|
| Rutas alternativas, tipos, duplicación, paginación, consultorio nuevo | Auditoría transversal cerrada: full 39667993859 | Cumplido |
| Recorridos cruzados sensibles sobre los artefactos construidos | `verify:release` exige toda la suite y Natalia nativa sobre workerd. Diferencias anteriores corregidas: HTTPS del anfitrión, CSP y origen predeterminado. En 39783349541, `dfb487f`, el full aprueba pero el artefacto queda en 5 aprobadas, 1 fallida y 35 sin ejecutar por dos advertencias desconocidas del recorrido de profesional. Evidencia `.verification/remote-39783349541/`, paquete `28516c4e…`. | Diagnóstico específico cerrado en 39859031404 (3/3); release íntegro a354 en curso: 39897226356 |
| Ampliación de cuota y cambio de recursos conservando datos, permisos y pendientes | Prueba de ampliación en `clinical-files.spec.ts`: aprobada en los fulls 39731246349 y 39737443779; se repite sobre el paquete. El cambio de Workers a Paid no se ensaya alojado sin contratar: lo cubren las pruebas del perfil de presupuesto. | Pendiente: perfiles de artefacto candidato a354 y baseline dfb en 39897226356 |
| Respaldo y recuperación ensayados en un entorno aislado | 39859035283 (`48b1c20`): 126/126 migraciones, 96 tablas/76 filas sin diferencias, archivo con huella idéntica y bucket único retirado. 39682517594 conserva por separado el volumen de 83.335 filas/117 migraciones. [Respaldo y recuperación](respaldo-y-recuperacion.md). | Cumplido en pila aislada de CI; no es un proyecto alojado nuevo |
| Migraciones compatibles en staging | 39736239031: 126 migraciones; producción mantiene 97 hasta la publicación en dos tandas. | Cumplido en staging |
| App, Natalia y programador desplegados y comprobados en staging | Candidata a354 restituida: app `54a7ea04…`, 130 archivos cliente/35 Natalia exactos. Retorno a dfb probado con reservas en 39896937395; programador `49636b6a…` sin cambios. La prueba de humo aprobó 14 comprobaciones y su limpieza posterior 7 (dos documentos); capacity-cleanup 39850817211 dejó cero consultorios/dueños sintéticos. | Pendiente: paso alojado de `verify:release` de la revisión final |
| Auditoría de release | 39685702630, más `verify:release` | Pendiente: la corrida del release |
| Programador anterior detenido | cron-job.org 7795525, deshabilitado; Netlify 404 y Vercel 503 (`check-previous-scheduler.mjs`, 22 de octubre, 12:43 UTC) | Cumplido; se repite en el paso 0 |
| Publicar migraciones y aplicaciones; activar el programador nuevo; versión, permisos, reserva, almacenamiento y tareas | [Publicación y reversión](publicacion-y-reversion.md): 14 pasos con comando, resultado esperado, criterio de detención y reversión. Cada comprobación posterior tiene su herramienta: `verify-production-release.mjs`, `release-smoke.mjs`, `tail-metrics.mjs production`, `production-device-push.mjs`, `compare-access-catalog.mjs` y `check-api-exposure.mjs`. | Pendiente: requiere las acciones del usuario en los paneles |
| Reversión sin restauraciones destructivas | `313355a` sólo es compatible antes de contraer. Baseline dfb restaurado por rollback nativo en staging y aprobado con dos reservas persistidas/recuperadas/canceladas (39896937395). El paso 5 del procedimiento instala/registra su versión de producción antes de la candidata. | Parcial: falta `rollback-browser` completo de 39897226356 y la instalación real del baseline de producción antes de tanda 2 |
| Documentación entregable | Áreas, contratos, [permisos y capacidades](permisos-y-capacidades.md), documentos, tareas, verificación, capacidad, [decisiones](decisiones.md), publicación y [guía](guia-nuevas-funciones.md) | Cumplido |

## Base de producción

| Requisito | Evidencia | Estado |
|---|---|---|
| Migraciones exactas y compatibles antes de publicar | Ensayo con `ROLLBACK` sobre el esquema real: 8 sentencias fallaban por deriva manual. Con la reconciliación, cero fallas. | Cumplido como preparación |
| La base publicada es la probada | Comparación del catálogo después del ensayo: idéntico al de staging en las nueve secciones, salvo la deriva aceptada | Cumplido como preparación; se repite después de publicar |
| Rutas alternativas que evitan los contratos (sección 5) | Escritura directa de membresías, que dejaba a un admin hacerse dueño, y de pacientes, turnos y auditoría: `20261022010000`, con su prueba que falló primero | Cumplido en CI; producción en la tanda 2 |
| Sin pérdida de información clínica | El borrado de un usuario borraba su historia clínica: `20261022000000`, con su prueba que falló primero | Cumplido en CI; producción en la tanda 1 |
| Reversión compatible | Publicación en dos tandas; `313355a` sólo sirve antes de contraer. Retorno alojado 39896937395 aprobado para dfb/126 migraciones. La puerta `rollback-browser` verifica toda la suite actual contra ese binario en 39897226356. | Parcial: falta el perfil completo y registrar la versión compatible en producción antes de la tanda 2 |

## Ampliación: identidad Cita Suite

| Requisito | Evidencia | Estado |
|---|---|---|
| Inventario completo, con excepciones clasificadas | [identidad](identidad-cita-suite.md) | Cumplido |
| Código, paquetes y documentación unificados | Workspace `@cita-suite/shared`, raíz `cita-suite` | Cumplido |
| Renombre ensayado en un recurso descartable | [ensayo en GitHub](identidad-ensayo-github.json) | Cumplido |
| Repositorio `Juan4787/cita-suite`, nombres visibles de Supabase y proveedores conectados | Nombre libre (404) y permisos de administración comprobados | Pendiente: va después de publicar, con los disparadores desconectados |
| Directorio local `Cita Suite` | Preparado | Pendiente: al final, con los procesos detenidos |

## Decisión del 20 de octubre: lanzamiento

| Requisito | Estado |
|---|---|
| Ninguna contratación ni cobro variable sin tope | Cumplido: Workers Free y Supabase Free, nada contratado |
| Protecciones de consumo decididas por mérito | Cumplido: [control de consumo](control-de-consumo.md) |
| Defectos propios de eficiencia corregidos y separados de los límites del proveedor | Cumplido: [capacidad](capacidad.md) |
| Dos consultorios cumplen los criterios en el despliegue gratuito antes de publicar para clientes reales | **Impedimento** (p99 de lecturas). Hay que medir producción y decidir el plan. |
| Correo de Auth para restablecer contraseñas | No verificado: acreditar SMTP y entrega de recuperación. Si falta SMTP propio, su cuenta/configuración requiere decisión del usuario. |
| Destino de los respaldos de datos reales | Decisión del usuario |
