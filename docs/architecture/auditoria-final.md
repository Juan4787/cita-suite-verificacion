# Auditoría final punto por punto

**Actualización26-oct17:59UTC — campaña abierta.** Preparación de recuperación sin dominio: navegador dirigido40368550984 y reversión de staging40371503253 aprobados; auditoría completa40373057375/ad5ac57 aún en curso. Producción conserva0851 y sus cinco cron, metadata administrativa revalidada con33 bindings. El preflight falló en la primera lectura de base, antes de comprobar conteos/Auth/agenda; causa sin establecer y publicación detenida. SMTP no configurado ni correo recibido. [Traspaso exacto](../plans/traspaso-recuperacion-sin-dominio-20261026.md). Los estados inferiores son antecedentes con sus fechas: las decisiones del25-oct sustituyeron dos consultorios por uno y aceptaron únicamente la desviación de latencia. No repetir cargas de dos consultorios en Free ni presentar esa aceptación como umbrales cumplidos.

Contraste del [plan aprobado](../plans/refactorizacion-cita-suite.md) con la evidencia, como exige su instrucción de ejecución: «antes de declarar terminada la campaña, verificá punto por punto el cumplimiento del documento original utilizando evidencia comprobable». Las corridas y su detalle están en el [registro](../plans/registro-refactorizacion-cita-suite.md).

**Estado25-oct01:40UTC (24-oct22:40ART): campaña abierta, lanzamiento sin aprobar.** Producción sigue sirviendo la fuente0851; comprobación pública25-oct01:36:130archivosapp/35Natalia exactos,70relaciones/0expuestas. Release40096001763 había aprobado20/20 y44/44×3; recuperación83278ad comprobada con retorno nativo. Calendar, push realSamsung y reserva/cancelaciónNatalia conservaron sus pruebas funcionales y limpiezas. Identidad principal y directorio ya aplicados; fast40099372469 aprobó main257d928. No presentar documentación posterior como una compilación distinta.

**Dos cargas fallidas, ninguna convertida en aprobación:**40078561771 y comparación prespecificada40099997857 sin muestreadorSQL/instancia. La segunda falló escrituras p95=1689ms, lecturas p99=4476ms y escrituras p99=5400ms. Pública y abuso aprobaron;0errores técnicos reportados. El fallo ocurre sin el muestreador, sin que esto establezca una causa exclusiva. [Capacidad](capacidad.md) conserva tablas, confusores y umbrales.

Los readbacks antes/después no encontraron cruces ni superposiciones. **No se certifica delta de deadlocks ni deSQL:** `stats_reset:null`,V1deanálisis refutada/corregida yV2 conservadora; la lectura posterior fue más de10hdespués. Esta corrección limita también las antiguas atribuciones acumuladas de la primera carga, sin modificar sus resultados originales. Limpieza terminó25-oct01:33:0restos y conteos19/121/107, Calendar1/1,24objetos/11.599.541B restablecidos. Secreto temporal retirado y observador cerrado.

**AccesoCloudflare actual limitado:** sesión soportada ve una cuenta diferente del destino y GETdeployments responde403/10000. No se cambió sesión ni se desplegó. La metadata24-oct13:36 (app70f0cdc0/scheduler94bed118/5cron/staging0) se conserva como última verificación administrativa, no como lectura25-oct. Vercel sí confirmóNatalia6zBnr7/e3530edREADY. La evidencia pública no sustituye metadata/bindings.

[Traspaso](../plans/traspaso-refactorizacion-cita-suite.md) y [registro](../plans/registro-refactorizacion-cita-suite.md) fijan el punto exacto. Evidencias inmutables en fases[1](../archive/production-verification-20261024/phase1/README.md),[2](../archive/production-verification-20261024/phase2/README.md),[3](../archive/production-verification-20261024/phase3/README.md),[4](../archive/production-verification-20261024/phase4/README.md) y[5](../archive/production-verification-20261024/phase5/README.md). Dominio, SMTP y etiquetasSupabase siguen abiertos; el acceso administrativoCF se cerró según el recibo del25-oct y la custodia de respaldos tiene el estado actualizado del punto6. Ninguna contratación, ninguna pregunta intermedia.

Cierre documental9fcf4ee verificado por [fast40151651236](https://github.com/Juan4787/cita-suite/actions/runs/40151651236):13/13,1395servidor/175cliente,0fallos ni casos omitidos. Los recibos posteriores son sólo documentos y no cambian fuentes/configuración/SQL. [Fase6](../archive/production-verification-20261024/phase6/README.md) conserva el resultado y la localización offline de las pausas; no es aprobación de capacidad ni fullrelease nuevo.

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
| Programación nativa de Cloudflare con presupuestos medidos | [tareas automáticas](tareas-automaticas.md); staging con los cinco cron | Cumplido funcionalmente en staging y ciclo productivo, recuperación y cinco tipos decron comprobados. AptitudFree no aprobada; comercial manual se distingue del cron no observado. |
| Push y calendario cada cinco minutos, inicio dentro de diez | Etapa 6: escenario del plan y entrega real por FCM a un Samsung | Cumplido funcionalmente en staging y ciclo productivo, recuperación y cinco tipos decron comprobados. AptitudFree no aprobada; comercial manual se distingue del cron no observado. |
| Pruebas pesadas en CI descartable, sin cargar la computadora | [verificación](verificacion.md) | Cumplido |
| Natalia navega al turnero real | Release 39901784288: dos recorridos por perfil de CI y dos en staging alojado, con persistencia, recuperación y cancelación. Previews de archivos Vercel aprobados; producción requiere recorrido propio. | Cumplido en CI/staging; producción y Samsungv3 aprobados tras corrección de avisos inactivos; los recibos previos fallidos se conservan. |
| Cursos y noticias fuera; sin WhatsApp | Medición de Natalia; secciones intactas en `check-public.mjs` | Cumplido |

## 2. Arquitectura y contratos

| Requisito | Evidencia | Estado |
|---|---|---|
| Importaciones sólo entre interfaces públicas, sin ciclos ni código de servidor en el navegador | `dependency-cruiser` fijado, sin excepciones permanentes | Cumplido |
| Propiedad de las reglas | [contratos funcionales](functional-contracts.md) | Cumplido |
| Fábricas Supabase y consumidores tipados; tipos reproducibles | Doble generación con igualdad exacta en cada full; guarda `type-escapes` | Cumplido |
| JSON validados en ejecución | Contratos `readRecord` y `InvalidDataContractError`; objeto/null Calendar reproducido en rojo, corregido y probado en release40075434652 y lote productivo07:21UTC. | Cumplido para los contratos y caso corregido; no garantiza ausencia universal de defectos. |
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
| 6 | Recuperación y trabajo ordinario dentro de diez minutos | [Tareas automáticas](tareas-automaticas.md); fulls 39364962358 y 39366010644; recuperación en staging | Cumplido funcionalmente en staging y ciclo productivo, recuperación y cinco tipos decron comprobados. AptitudFree no aprobada; comercial manual se distingue del cron no observado. |

## 4. Capacidad, regresiones y observabilidad

| Requisito | Evidencia | Estado |
|---|---|---|
| Escenarios de 5 y 25 consultorios en CI | [capacidad](capacidad.md) | Evidencia conservada. Ya no es condición de cierre (decisión del 20 de octubre). |
| Dos consultorios en el despliegue gratuito: lecturas p95 < 1 s y p99 < 2 s | Primera carga: rep2 p95/p991024/3809ms. Comparación40099997857 sin sampler: rep3 p994476ms. Ambas fallidas. | **Impedimento medido.** Producción falla; correlaciónI/O/swap sincausalidad exclusiva. No rebajar umbrales ni contratar. |
| Escrituras p95 < 1,5 s y p99 < 3 s | Primera carga: rep3 p95/p992763/3810ms. Comparación: rep2 p951689 y rep3 p995400ms. | **Impedimento medido:** rep3 supera ambos umbrales; atribución no exclusiva. |
| Errores técnicos < 1 % | Ídem: 4 errores de red, ninguno de la aplicación. Sobre el total de cada fase, debajo del 1 % (0,48 %, 0 %, 0,48 % y 0,64 %). | Cumplido en staging |
| Sin violaciones de aislamiento, doble reserva ni cuotas | Pruebas SQL/carreras y readback productivo:0cruces/0superposiciones; delta acumulado de deadlocks no certificable con marcador vacío. | Cumplido para casos probados; continuidad de contadores productivos desconocida. |
| Disponibilidad completa o error explícito | Contratos de la etapa 4 y auditoría transversal (`r2`, `R7`, `r11`) | Cumplido |
| Colas: cinco pendientes por consultorio y escenario desigual | Etapa 6 en staging | Cumplido |
| Planes, índices, bloqueos y crecimiento de consultas | [capacidad](capacidad.md); correcciones `20261020020000` a `20261020050000` | Cumplido |
| Matriz de regresiones | [matriz de regresiones](matriz-regresiones.md): 12 puntos con sus capas | Cumplido |
| Observabilidad: viajes HTTP, proveedores y SQL separados; registros sin datos clínicos | Contadores de trabajos (`databaseRequests`, `providerRequests`); colector corregido con8 pruebas adversarias/funcionales. Los borradores previos y sus fallos se conservan; observador productivo usa el filtro permanente probado. | Filtro comprobado y cron productivo observado; ausencia de acceso a logs históricos se registra como límite, no como ausencia de ejecución. |

## 5. Auditoría, publicación y documentación

| Requisito | Evidencia | Estado |
|---|---|---|
| Rutas alternativas, tipos, duplicación, paginación, consultorio nuevo | Auditoría transversal cerrada: full 39667993859 | Cumplido |
| Recorridos cruzados sensibles sobre los artefactos construidos | Release40096001763:44/44 en desarrollo, candidata0851 y baseline reparado832 sobre126migraciones, cero omisiones, reintentos o intermitentes. Incluye privacidad, fecha clínica y transporte autenticado; los fallos previos se conservan. | Cumplido en CI |
| Ampliación de cuota y cambio de recursos conservando datos, permisos y pendientes | `clinical-files.spec.ts` aprobado en los tres perfiles del release 39901784288. Cambiar a Workers Paid no se ensayó alojado sin contratar; sus presupuestos tienen pruebas, sin certificar capacidad de un proveedor no contratado. | Cumplido para cuotas y perfiles; no hubo contratación |
| Respaldo y recuperación ensayados en un entorno aislado | 39859035283 (`48b1c20`): 126/126 migraciones, 96 tablas/76 filas sin diferencias, archivo con huella idéntica y bucket único retirado. 39682517594 conserva por separado el volumen de 83.335 filas/117 migraciones. [Respaldo y recuperación](respaldo-y-recuperacion.md). | Cumplido en pila aislada de CI; no es un proyecto alojado nuevo |
| Migraciones compatibles en staging |126 en ambos entornos; producción contrajo a126 a24-oct03:40:02UTC, con respaldo/preflight y humo14/14. | Cumplido en staging y producción |
| App, Natalia y programador desplegados y comprobados en staging | Release 39901784288: app478 versión `6bde847f-008c-4f9d-ab3b-8fc7b51d61dd`,130 archivos cliente/35Natalia exactos,61 relaciones sin exposición anónima y dos reservas nativas. Programador `49636b6a…` y cron observados previamente; humo y limpieza conservados sin cambios posteriores de runtime/SQL. | Cumplido en staging |
| Auditoría de release |40096001763 aprobado20/20, fuente0851, artefacto40095722950 y reversión40095847239. | Cumplido; no sustituye capacidad ni auditoría de producción |
| Programador anterior detenido | cron-job.org 7795525, deshabilitado; Netlify 404 y Vercel 503 (`check-previous-scheduler.mjs`, 22 de octubre, 12:43 UTC) | Cumplido; se repite en el paso 0 |
| Publicar migraciones y aplicaciones; activar el programador nuevo; versión, permisos, reserva, almacenamiento y tareas | [Publicación y reversión](publicacion-y-reversion.md),14pasos. DB126, app0851, humo14/14, catálogo9secciones, API70/0expuestas y ciclo Calendar/push reales documentados. | En ejecución: recuperación/carga/limpieza/Natalia realizadas con sus límites; carga fallida, defecto push corregido y verificado en producción; identidad principal aplicada; etiquetasSupabase pendientes. Cinco tipos posteriores observados200; desconexiones acreditadas. |
| Reversión sin restauraciones destructivas | Baseline dfb restaurado por rollback nativo en staging y reservas aprobadas en 39896937395; suite completa44/44 contra126 migraciones en 39901784288. Natalia:35/35 archivos anteriores exactos en preview de reversión, seleccionando el output archivado. | Cumplido en CI/staging/previews y producción: recuperación vigente83278ad/2b9609ae y retorno nativo a0851/70f0cdc0 comprobados13:15:32UTC, sin restaurarDB ni alterar secretos. Los anteriores5ee/CB son históricos. |
| Documentación entregable | Áreas, contratos, [permisos y capacidades](permisos-y-capacidades.md), documentos, tareas, verificación, capacidad, [decisiones](decisiones.md), publicación y [guía](guia-nuevas-funciones.md) | Cumplido |

## Base de producción

| Requisito | Evidencia | Estado |
|---|---|---|
| Migraciones exactas y compatibles antes de publicar | Ensayo con `ROLLBACK` sobre el esquema real: 8 sentencias fallaban por deriva manual. Con la reconciliación, cero fallas. | Cumplido como preparación |
| La base publicada es la probada | Comparación del catálogo después del ensayo: idéntico al de staging en las nueve secciones, salvo la deriva aceptada | Cumplido como preparación; se repite después de publicar |
| Rutas alternativas que evitan los contratos (sección 5) | `20261022010000` aplicada en producción, catálogo alineado y APIanónima70/0expuestas | Cumplido en CI y producción |
| Sin pérdida de información clínica | El borrado de un usuario borraba su historia clínica: `20261022000000`, con su prueba que falló primero | Aplicado en producción durante la expansión97→125; sin borrado de datos. |
| Reversión compatible | Publicación en dos tandas; `313355a` sólo sirve antes de contraer. Retorno alojado39896937395 y perfil completo44/44 del baseline dfb/126 en39901784288 aprobados. | Ensayo productivo vigente aprobado con83278ad/2b9609ae sobre126,33bindings conservados y retorno nativo a0851/70f0cdc0. Los baseline anterioresdfb/5ee conservan defectos y no son la recuperación vigente. |

## Ampliación: identidad Cita Suite

| Requisito | Evidencia | Estado |
|---|---|---|
| Inventario completo, con excepciones clasificadas | [identidad](identidad-cita-suite.md) | Cumplido |
| Código, paquetes y documentación unificados | Workspace `@cita-suite/shared`, raíz `cita-suite` | Cumplido |
| Renombre ensayado en un recurso descartable | [ensayo en GitHub](identidad-ensayo-github.json) | Cumplido |
| Repositorio `Juan4787/cita-suite`, nombres visibles deSupabase y proveedores conectados | Principal mismoID/promoción37f625b/renombre/remoto/Git/proveedores comprobados. Supabase conserva refs/regiones y estadoACTIVE_HEALTHY. | Principal y consumidores cumplidos; sólo etiquetasSupabase pendientes de acción administrativa normal. |
| Directorio local `Cita Suite` | Intercambio atómico13:24:07, mismo inode/FS y enlace compatible; HEAD/índice/plan/permisos preservados | Cumplido |

## Decisión del 20 de octubre: lanzamiento

| Requisito | Estado |
|---|---|
| Ninguna contratación ni cobro variable sin tope | Cumplido: Workers Free y Supabase Free, nada contratado |
| Protecciones de consumo decididas por mérito | Cumplido: [control de consumo](control-de-consumo.md) |
| Defectos propios de eficiencia corregidos y separados de los límites del proveedor | Cumplido: [capacidad](capacidad.md) |
| Dos consultorios cumplen los criterios en el despliegue gratuito antes de publicar para clientes reales | **Reemplazado el 25 de octubre por un consultorio** (decisión del usuario al final del plan). Las dos cargas de producción que fallaron percentiles de lecturas y escrituras se conservan como evidencia, sin aprobarse ni repetirse. |
| Un consultorio cumple los criterios en el despliegue gratuito antes de publicar (decisión del 25 de octubre) | **Impedimento del proveedor.** Las corridas 40169634680 y 40175346833 cumplieron dos de tres repeticiones y la fase pública, con 0 errores, sin cortes por CPU y sin violaciones de integridad. Pausas de 1 a 3,5 s por tormentas de swap de la instancia Nano, que sólo ocurren con carga y no cambiaron con `shared_buffers` en 128 MB, hicieron fallar una repetición en cada corrida. **Desviación aceptada por el usuario sólo para el primer consultorio** (decisión literal al final del plan); no es un criterio cumplido. Detalle en [capacidad](capacidad.md#qué-muestran-las-dos-corridas). |
| Segundo consultorio | El usuario pagará Supabase Pro, con tope de gasto; lo contrata él. Antes de incorporarlo, demostrar dos consultorios en ese destino. |
| Correo de Auth para restablecer contraseñas | Incompleto confirmado por el usuario: activó el interruptor SMTP pero no configuró datos. Falta proveedor/remitente y entrega real de recuperación. No enviar correo a un destino ajeno. |
| Destino de los respaldos de datos reales | Drive juanmarquez56783@gmail.com elegido por el usuario; copia cifrada externa recuperada y SQL/Storage ensayados el26-oct. Programación y monitor según la guía vigente. |


Antecedente histórico23-oct15:34UTC, reemplazado por el estado24-oct de arriba: la versión de app es a5b21dfd y el baseline658d3ae3 conserva la habilitación actual de Calendar además del secreto interno. Se verificaron en orden metadata/auth/130archivos/70relaciones; no cambió binario ni SQL. Ventana rutinaria y Storage15:17 comprobados; CPUFree y commercial18:17 abiertos. Calendar cron configuredtrue, pero el retorno del cliente dedicado falla redirect_uri_mismatch con control negativo válido. El cliente diferente usado por accesoGoogle sí llega al acceso; falta completar el regreso a app y confirmar URL Configuration actual. Usuario confirmó pruebas históricas de ambos recorridos y eliminación de URLs también en Supabase. Estos hechos no se sustituyen por inferencias desde.env ni por dos redirecciones iniciales correctas.


## Acciones externas pendientes: continuar una por vez

1. **Rendimiento de lanzamiento — resuelto por decisión del usuario el 25 de octubre.** Producción se compactó y se midió un consultorio dos veces, con el protocolo de [capacidad](capacidad.md#lanzamiento-con-un-consultorio--decisión-y-protocolo-del-25-de-octubre) y con `shared_buffers` en 128 MB. Ambas corridas fallaron una repetición por pausas de swap de la instancia Nano. El usuario aceptó lanzar el primer consultorio en Free con esas esperas ocasionales. Supabase Pro llega con el segundo consultorio, por decisión y contratación del usuario, y entonces se miden dos consultorios con los criterios completos. Opcional y recomendado: revertir el ajuste de 128 MB con `supabase postgres-config delete --config shared_buffers --project-ref yjzferwuzbtgpmdnzlcb --experimental`, que lo ejecuta el usuario.
2. **Acceso administrativo de Cloudflare — cerrado el 25 de octubre.** El usuario volvió a iniciar sesión en la cuenta `52b358653379c162b5a07b10ae5e84b3`. Las lecturas de despliegue, versión, bindings y cron coinciden con el recibo del 24 de octubre a las 13:36: app `70f0cdc0` al 100 % con 33 bindings, programador `94bed118` con cinco cron, staging sin cron y revisión servida `0851`. Recibo: `.verification/un-consultorio-20261025/cloudflare-readonly-check.json`.
3. **Correo de recuperación:** en Supabase, proyecto `yjzferwuzbtgpmdnzlcb` → Authentication → Emails → SMTP Settings, falta un proveedor y su servidor/puerto/usuario/contraseña/remitente. El interruptor activado no constituye configuración. Alternativa temporal preparada con Gmail y remitenteCitaSuite, sin dominio ni contratación; falta la contraseña de aplicación dedicada y configurar/probar entrega real. Guardar allí los valores, nunca en conversación; después probar recepción de recuperación y acceso con la contraseña nueva en una cuenta sintética acordada. [Procedimiento exacto](correo-de-recuperacion.md). No se activó SMTP ni se certifica recepción por preparar la guía.
4. **Dominio y Google:** el usuario compra el dominio cuando lo decida. Al comunicar el nombre, continuar [la guía](acceso-google-calendar.md#retomar-cuando-el-usuario-comunique-la-compra-del-dominio): propiedadDNS, presentación pública sinlogin, privacidad/términos, marca, retornos compatibles y recorridosAuth/Calendar separados. La compra sola no elimina los avisos de aplicación no verificada.
5. **Etiquetas Supabase:** abrir únicamente los ajustes generales de los proyectos `yjzferwuzbtgpmdnzlcb` y `ikaudqoilclfnztkxubz`; cambiar sólo Project Name a `Cita Suite` y `Cita Suite Staging`, respectivamente. No crear proyectos, cambiar ref/región, rotar claves ni tocar datos. Desde el 25 de octubre la CLI tiene una sesión administrativa que funciona (lista proyectos y lee `postgres-config`), pero la versión instalada, 2.30.4, no tiene un comando para renombrar: el cambio lo hace el usuario en el panel. No se extrajeron tokens de sus almacenes. Los intentos fallidos en la interfaz no prueban que el usuario carezca de permisos.
6. **Custodia de respaldos — avances verificados el26-oct:** Drive elegido por el usuario, cifrado previo a envío, recuperación de la misma instantánea externa y restauración SQL/Storage enCI aprobadas (40265535110).105tablas/3930filas/126migraciones/24referencias sin diferencias. Kit y contraseña externos confirmados por el usuario, sin inspeccionar el soporte. Incremental40266203512:24objetos reutilizados/0bytes de Storage; monitor40266261547 aprobado. Retención30/37d comprobada con fixtures propios, todos retirados. Horarios01:07/07:43 de Argentina publicados enSHA742e5de; primera copia natural40303961884 comprobada con descarga independiente desdeDrive, iniciada a07:00:17Argentina (5h53min17s después del horario). No garantiza puntualidad; monitor natural40364212526 comprobado a16:58:23UTC (6h15min23s después de10:43), frescura6,9h/huella verificada/sin acceso a la base. Aviso por correo no certificado. Sin contratación. La clave de Storage enCI tiene privilegios service_role más amplios queGET; el monitor depende deActions y no se certificó entrega de correo. [Estado y límites vigentes](acceso-google-drive-respaldos.md).

Estas dependencias no invalidan las pruebas funcionales aprobadas, pero tampoco se convierten en tareas terminadas. El rendimiento del primer consultorio quedó aceptado por el usuario (punto 1). Para atender a clientes reales todavía falta el correo de recuperación (punto3); el punto6 registra la custodia elegida, las pruebas aprobadas y el estado exacto de programación y sus límites. El dominio y Google (punto 4) son necesarios para quitar los avisos de aplicación no verificada, y los nombres de Supabase (punto 5) son de identidad. El cierre íntegro de la campaña sigue pendiente de esos puntos.
