# Auditoría final punto por punto

Contraste del [plan aprobado](../plans/refactorizacion-cita-suite.md) con la evidencia, como exige su instrucción de ejecución: «antes de declarar terminada la campaña, verificá punto por punto el cumplimiento del documento original utilizando evidencia comprobable». Las corridas y su detalle están en el [registro](../plans/registro-refactorizacion-cita-suite.md).

**Estado al 23 de octubre,14:41 UTC: candidata publicada; observación productiva en curso; auditoría de campaña abierta.** `verify:release` **39901784288** aprobó los 20 pasos sobre **478c096e63299b886e640c4627cd25e0db22dbfa**, artefacto 39900877833 y baseline 39782403651. Los 44 casos de navegador aprobaron en cada uno de tres perfiles: desarrollo, candidata compilada y binario anterior compatible contra las 126 migraciones actuales. El paso alojado de staging también aprobó, con reservas persistidas, recuperadas sin duplicación y canceladas. Evidencia: `.verification/remote-39901784288/`, 681 archivos, paquete SHA-256 `abb6fb13ffef12c45230a5d52460677d4e281d43647a2bd6df304e1e902f6379`.

La reserva publicada de Natalia ya usa navegación nativa: su despliegue real llegó por CLI y difiere del HEAD Git. Se corrigió la hipótesis anterior y se archivaron sus 35 archivos realmente servidos. Candidata y reversión aprobaron 35/35 bytes exactos en dos previews Vercel separados; producción conserva despliegue y portada, comprobados otra vez09:33:12 UTC (`production-readonly-final-20261023.json`). La app pasó de313 a baseline compatible y candidata478 durante los pasos documentados abajo. Estos ensayos no prueban persistencia de reservas en producción. Después del CI cambiaron documentación, un literal de instrucciones JSON auditado en `prepare-natalia-publication.mjs`, el desplegador de producción con su módulo/prueba de preflight de autenticación, y el colector operativo `scripts/lib/worker-tail.mjs` con su prueba: rutas/campos privados se descartan mediante catálogo y lista explícita (rojo6/8→verde8/8 y140/140 guardas Node locales secuenciales (46archivos)). No cambió app/SQL/paquete478 ni se atribuye el CI completo a ese parche posterior.

**La campaña no está terminada.** Desconexiones de Workers Builds y Git del Vercel viejo acreditadas por capturas del usuario23-oct; publicación en curso: expansión97→125, candidata478 verificada (130 archivos/70 relaciones sin exposición), entradas antiguas apagadas, baseline vigente035338f1 instalado/registrado con credencial alineada, semilla2 consultorios y humo14/14. Programador5cron activo frente a0 en staging, metadatos comprobados14:39 UTC; primeros dos eventos401 revelaron credencial incoherente, se detuvo y corrigió; nuevos eventos/CPU aún bajo observación. Contracción126, capacidad2 Free, push real (Samsung pendiente), Natalia e identidad remota siguen abiertos. Corrida ab3c7cc0-8431-43e5-959b-b04f0a543187; recibos en el registro y `.verification/production-publication-20261023.json`. El respaldo126 y las reversiones tienen evidencia separada con el alcance indicado abajo.

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
| Natalia navega al turnero real | Release 39901784288: dos recorridos por perfil de CI y dos en staging alojado, con persistencia, recuperación y cancelación. Previews de archivos Vercel aprobados; producción requiere recorrido propio. | Cumplido en CI/staging; producción pendiente |
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
| Dos consultorios en el despliegue gratuito: lecturas p95 < 1 s y p99 < 2 s | Staging, 39685702630: p95 cumplido; p99 de 2.046, 4.124 y 3.619 ms | **Impedimento.** La evidencia de memoria/swap de Supabase Nano es la causa principal medida; no demuestra causalidad exclusiva de toda latencia. Falta medir producción en São Paulo; no se contrata otro plan sin decisión del usuario. |
| Escrituras p95 < 1,5 s y p99 < 3 s | Ídem: p99 cumplido en las tres repeticiones; p95 de 1.758, 1.088 y 921 ms | **Impedimento:** la repetición 1 supera el p95. No se atribuyó por separado. Pendiente la medición de producción. |
| Errores técnicos < 1 % | Ídem: 4 errores de red, ninguno de la aplicación. Sobre el total de cada fase, debajo del 1 % (0,48 %, 0 %, 0,48 % y 0,64 %). | Cumplido en staging |
| Sin violaciones de aislamiento, doble reserva ni cuotas | Integridad antes y después de cada carga: 0 cruces y 0 superposiciones | Cumplido |
| Disponibilidad completa o error explícito | Contratos de la etapa 4 y auditoría transversal (`r2`, `R7`, `r11`) | Cumplido |
| Colas: cinco pendientes por consultorio y escenario desigual | Etapa 6 en staging | Cumplido |
| Planes, índices, bloqueos y crecimiento de consultas | [capacidad](capacidad.md); correcciones `20261020020000` a `20261020050000` | Cumplido |
| Matriz de regresiones | [matriz de regresiones](matriz-regresiones.md): 12 puntos con sus capas | Cumplido |
| Observabilidad: viajes HTTP, proveedores y SQL separados; registros sin datos clínicos | Contadores de trabajos (`databaseRequests`, `providerRequests`); colector corregido con8 pruebas adversarias/funcionales. Los borradores previos y sus fallos se conservan; observador productivo usa el filtro permanente probado. | Filtro local comprobado; evidencia de cron productivo en curso |

## 5. Auditoría, publicación y documentación

| Requisito | Evidencia | Estado |
|---|---|---|
| Rutas alternativas, tipos, duplicación, paginación, consultorio nuevo | Auditoría transversal cerrada: full 39667993859 | Cumplido |
| Recorridos cruzados sensibles sobre los artefactos construidos | Release 39901784288: 44/44 casos en desarrollo, candidata workerd y baseline dfb/126 migraciones, sin omisiones ni reintentos. Incluye privacidad de recepción, fecha clínica e independencia del transporte autenticado. Los fallos previos y sus reproducciones se conservan en el registro. | Cumplido en CI |
| Ampliación de cuota y cambio de recursos conservando datos, permisos y pendientes | `clinical-files.spec.ts` aprobado en los tres perfiles del release 39901784288. Cambiar a Workers Paid no se ensayó alojado sin contratar; sus presupuestos tienen pruebas, sin certificar capacidad de un proveedor no contratado. | Cumplido para cuotas y perfiles; no hubo contratación |
| Respaldo y recuperación ensayados en un entorno aislado | 39859035283 (`48b1c20`): 126/126 migraciones, 96 tablas/76 filas sin diferencias, archivo con huella idéntica y bucket único retirado. 39682517594 conserva por separado el volumen de 83.335 filas/117 migraciones. [Respaldo y recuperación](respaldo-y-recuperacion.md). | Cumplido en pila aislada de CI; no es un proyecto alojado nuevo |
| Migraciones compatibles en staging | 39736239031: 126 migraciones; producción pasó97→125 a13:45 UTC;126 pendiente de la segunda tanda. | Cumplido en staging |
| App, Natalia y programador desplegados y comprobados en staging | Release 39901784288: app478 versión `6bde847f-008c-4f9d-ab3b-8fc7b51d61dd`,130 archivos cliente/35Natalia exactos,61 relaciones sin exposición anónima y dos reservas nativas. Programador `49636b6a…` y cron observados previamente; humo y limpieza conservados sin cambios posteriores de runtime/SQL. | Cumplido en staging |
| Auditoría de release | 39901784288 aprobado,20/20 pasos, fuente478, artefacto39900877833. | Cumplido; no sustituye capacidad ni auditoría de producción |
| Programador anterior detenido | cron-job.org 7795525, deshabilitado; Netlify 404 y Vercel 503 (`check-previous-scheduler.mjs`, 22 de octubre, 12:43 UTC) | Cumplido; se repite en el paso 0 |
| Publicar migraciones y aplicaciones; activar el programador nuevo; versión, permisos, reserva, almacenamiento y tareas | [Publicación y reversión](publicacion-y-reversion.md): 14 pasos con comando, resultado esperado, criterio de detención y reversión. Cada comprobación posterior tiene su herramienta: `verify-production-release.mjs`, `release-smoke.mjs`, `tail-metrics.mjs production`, `production-device-push.mjs`, `compare-access-catalog.mjs` y `check-api-exposure.mjs`. | En ejecución: pasos0–6 aprobados;7 desplegado y en observación;8–14 pendientes. Desconexiones acreditadas por capturas, no pedirlas de nuevo. |
| Reversión sin restauraciones destructivas | Baseline dfb restaurado por rollback nativo en staging y reservas aprobadas en 39896937395; suite completa44/44 contra126 migraciones en 39901784288. Natalia:35/35 archivos anteriores exactos en preview de reversión, seleccionando el output archivado. | Cumplido en CI/staging/previews; baseline vigente035338f1 instalado y metadatos/credencial verificados en producción14:36 UTC. |
| Documentación entregable | Áreas, contratos, [permisos y capacidades](permisos-y-capacidades.md), documentos, tareas, verificación, capacidad, [decisiones](decisiones.md), publicación y [guía](guia-nuevas-funciones.md) | Cumplido |

## Base de producción

| Requisito | Evidencia | Estado |
|---|---|---|
| Migraciones exactas y compatibles antes de publicar | Ensayo con `ROLLBACK` sobre el esquema real: 8 sentencias fallaban por deriva manual. Con la reconciliación, cero fallas. | Cumplido como preparación |
| La base publicada es la probada | Comparación del catálogo después del ensayo: idéntico al de staging en las nueve secciones, salvo la deriva aceptada | Cumplido como preparación; se repite después de publicar |
| Rutas alternativas que evitan los contratos (sección 5) | Escritura directa de membresías, que dejaba a un admin hacerse dueño, y de pacientes, turnos y auditoría: `20261022010000`, con su prueba que falló primero | Cumplido en CI; producción en la tanda 2 |
| Sin pérdida de información clínica | El borrado de un usuario borraba su historia clínica: `20261022000000`, con su prueba que falló primero | Aplicado en producción durante la expansión97→125; sin borrado de datos. |
| Reversión compatible | Publicación en dos tandas; `313355a` sólo sirve antes de contraer. Retorno alojado39896937395 y perfil completo44/44 del baseline dfb/126 en39901784288 aprobados. | Ensayo cumplido; baseline vigente035338f1 registrado con credencial alineada antes de candidata/contracción, recibo production-step7-aligned-baseline-confirmed-20261023.json. |

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
