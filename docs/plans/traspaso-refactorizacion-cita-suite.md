# Traspaso de la campaña de refactorización de Cita Suite

## Estado de este documento

**Actualizado por Codex —23 de octubre de2026,12:43 UTC (punto3q).** Release **39901784288 aprobado20/20** sobre runtime478c096,44/44 navegador en desarrollo/candidata/baseline126 y staging alojado aprobado. Natalia candidata y reversión real **35/35 exactas en cada preview**; producción conserva despliegue y portada. Etapa5 cerrada; etapa6 funcional en CI/staging, transición productiva/CPU Free abiertas. **La campaña no está terminada.**

**Alcance vigente (instrucción del usuario del 19 de octubre al retomar con Opus 5.5):** completar y verificar íntegramente la fase 5, avisar al usuario cuando esté realmente cerrada y **continuar automáticamente con la fase 6 y todas las etapas restantes** hasta terminar la campaña, incluida la auditoría transversal, release, publicación y comprobaciones posteriores según las autorizaciones vigentes. Esta instrucción sustituye la restricción anterior de «detenerse antes de fase 6», que se conserva abajo sólo como antecedente de la intervención de GPT-6.1 Sol. Cambia únicamente el punto de detención: no reduce requisitos, garantías, controles ni procedimientos de seguridad.

*Antecedente reemplazado:* la intervención anterior tenía como instrucción cerrar la fase 5, avisar y detenerse antes de fase 6. Ya no está vigente.

## Alcance de lanzamiento vigente (enmienda del usuario del 20 de octubre)

Leer la decisión literal al final del plan. En resumen: no hay usuarios reales y todos los datos son ficticios; el lanzamiento es para dos consultorios sobre Workers Free y Supabase Free; no se contrata nada, ni servicios con cobro variable sin tope. El despliegue gratuito debe demostrar los criterios del plan con dos consultorios antes de publicar, y si un límite del proveedor lo impide, es un impedimento que se informa con alternativas. La capacidad de 5 y 25 consultorios deja de ser condición de cierre, sin rebajar calidad, seguridad ni integridad. Las protecciones de consumo se deciden por mérito y las postergadas se documentan con su riesgo residual. Se siguen corrigiendo los defectos reales de eficiencia, y se distinguen de los límites del proveedor.

## 3q. Desconexiones solicitadas con destinos exactos; preparación independiente aprobada

- Usuario pidió avanzar y que cualquier necesidad se solicite de forma ultra específica. Se agotaron otra vez los accesos de CLI/API: CloudflareWorkerapp200/tag621733… pero Builds403; Vercelsesiónjuan-altamira sólo accede ajuanaltamiras-projects, no al equipo viejojuans-projects-76d0ede4. GitHubhooks[] no prueba ausencia de Apps; instalaciones403. Ninguna mutación. Recibos `.verification/cloudflare-disconnection-access-20261023.json` y `vercel-disconnection-access-20261023.json`.
- **Dos preguntas asíncronas pendientes:** Cloudflarecuenta52b358…→Workers&Pages→app→Settings→Builds→Disconnect, resultado Connect sin repo; Vercel`https://vercel.com/juans-projects-76d0ede4/cita-suite/settings/git`→proyecto viejo/repositorioJuan4787/dashboard→Disconnect, resultado sinrepo. Si destino o acceso difieren, pedir estado exacto antes de cambiar nada. No tocarNatalia. No interpretar silencio como confirmación ni pedir otra autorización de producción.
- **Preflight12:43 aprobado**, `.verification/production-preflight-disconnections-20261023.json`: candidato478 y baselinedfb íntegros216 archivos cada uno, secretosapp completos (sólo nombres), versiónprod9b2df65c…100%/revisión313, base97/última20261014030000/32objetosStorage/capacity0; carpeta de respaldo700 con espacio. Readonly6s, sin suite pesada local. Huellas en `disconnection-preflight-index-20261023.json`.
- `productionReady:false`. Al llegar respuestas, registrar su alcance, repetir controles accesibles y, sólo si condiciones1/2 quedan acreditadas, retomar procedimiento paso0–1 con respaldo fresco. No sustituir comprobación de32 objetos por respaldo de los32. El recibo no acredita SMTP, capacidad o recuperación.
- El estado versionado anterior sigue en auxiliar**d60cb4235801eafae425f17abcdf8e348ac4c7f2**, runtime478 intacto; principal preparado**e191591f0ddf6e72b216f12f79afedf63a0306eb**, no publicado. Esta continuación agrega únicamente registro/traspaso; no presentar esa diferencia Markdown como cambio de binario ni mover el snapshot de runtime. Su commit y verificación remota quedan en `.verification/disconnection-docs-publication-20261023.json`; si el recibo aún no acredita push, completar sólo esa operación auxiliar.

## 3p. Ensayos cerrados; preparación final y puertas de publicación

Este punto prevalece sobre estados históricos inferiores. No repetir el release, respaldo ni reversiones aprobadas sin una causa nueva.

- **Runtime478c096e63299b886e640c4627cd25e0db22dbfa:** release39901784288, reciboa53af213-15c9-4197-adc1-296ef7d4d6a8,20/20;44/44 por cada uno de tres perfiles, staging con persistencia/recuperación/cancelación. Evidencia681 archivos, SHA-256abb6fb13ffef12c45230a5d52460677d4e281d43647a2bd6df304e1e902f6379. Artefacto39900877833,216 archivos, Worker SHA-256da830be716d1163dea0539f532ed64d64a3f45fa9c2dd48ed5719356d0a1e65f. Staging app6bde847f; producción app313sin publicar esta candidata.
- **Natalia:** corregida la suposición Git=producción. Producción real esdpl_GftFq86SmaGL6xWfynd9ZuxFWWa8 por CLI;35 archivos503.818B archivados. Candidata previewdpl_4jXRjdZNjkYXDK4fimdiQcw4oN1i y reversióndpl_93mxVYK91DxNaohsmDezycghPGbm **35/35 cada una**. Recibos `.verification/natalia-preview-{candidate,rollback}-20261023-toolbar-off.json`; verificador9d8c9d7f… . Control posterior `.verification/natalia-production-after-previews-20261023.json`,05:32:13 UTC: alias previo/portada idénticos, sin push/promoción. No certifica backend productivo. La reversión selecciona directorio archivado mediante commit nuevo, nunca el árbol legado.
- **Deltas posteriores exactos:** nueve Markdown de la candidata (dos sólo reparan enlaces), un documento histórico Markdown adicional y41 entradas de archivo de evidencia y una cadena JSON de instrucciones en prepare-natalia-publication.mjs; SHA-25622e04797ccced1e528c5444e636c1b5f898222ee1031fec87718ef379dd726d9, normalización exacta restaura script478 y pruebas adversarias rechazan código extra. No cambio de runtime/SQL/config/sitio; conservar478 como fuente del binario probado. El plan original conserva SHA-256796853d3fca1d82dfe3a8c0129d80f937180948cb0a75a24518c1721d20e60b9.
- **Preparación revisable:** el primer árbol ya se validó a09:32 UTC, recibo `.verification/principal-promotion-tree-478c096-20261023.json`; la edición final usa `.verification/prepare-principal-tree-478c096-archived-20261023.py` y recibo con sufijo archived; árbol sobre main313 con147 rutas preservadas/109 eliminaciones explícitas,1134 seleccionados,1281 esperados. De las147,146 conservan blob/modo y docs/mercadopago-suscripciones.md incorpora su corrección operativa existente, SHA-256415f0182766cd7ddb84b22b110f09f9484ca2a5cf700864db3eaa61721633b09; la preparación anterior la omitía. El control ampliado encontró40 enlaces cuyo destino existía localmente pero quedaba fuera de Git. Se archivaron40 fuentes exactas (5.622.981B, sintéticas) y manifiesto bajo docs/archive/campaign-evidence-20261023, con huellas y texto revisado por patrones de credenciales/URLs firmadas sin hallazgos; dos documentos reparan enlaces. Totales finales1322 principal/1176 auxiliar; los1281/1135 anteriores eran antes del archivo. Recibo del control primero fallido document-links-final-20261023.json; repetición estricta document-links-archived-20261023.json. Conservar índice/HEAD local80268e2. Conservar los deltas auditados en rama auxiliar separada `refactor/release-evidence-478c096`, no en runtime ni principal; SHA/árbol/recibos en `.verification/release-evidence-publication-478c096-20261023.json`; ese recibo debe mostrar push auxiliar verificado y principal no publicado. No atribuirle el release del binario478. Lectura final09:33:12 UTC confirma app313 y producciónNatalia sin cambios en `.verification/production-readonly-final-20261023.json`.
- **Impedimento externo vigente:** desconexiones Buildsapp y Git del Vercel viejo sin confirmar; API403/scope inaccesible. No interpretar «seguí» como confirmación, no repetir permiso de producción17-oct. Procedimiento condiciones1/2 antes de cambios. Después ejecutar pasos0–14 con respaldo fresco e instalar baseline real de app antes de contraer; no usar UUID staging en producción.
- **Cierre aún pendiente:** capacidad2 sobre Free, CPU/cadenas del programador, pruebas reales de Google/push/recuperación de contraseña según alcance, respaldo privado antes de clientes, identidad remota y traslado seguro local. Sin contratación, pruebas pesadas sólo CI secuencial, sin subagentes. Consultar registro/procedimiento para comandos, causas, pruebas adversarias y evidencia.

## 3o. Release cerrado; reversión de Natalia corregida y en ensayo (23-oct, desde~05:00 UTC)

- **Runtime478c096 aprobado:** release **39901784288**, recibo a53af213-15c9-4197-adc1-296ef7d4d6a8,20/20 pasos;136 guardas/11scheduler/1388servidor/171cliente/1nativa, SQL/carreras/servicios,44/44 en desarrollo/artefacto/baseline126,2/2demo,2/2nativas por perfil y staging alojado con2 reservas persistidas/recuperadas/canceladas. Evidencia **681 archivos**, SHA-256 **abb6fb13ffef12c45230a5d52460677d4e281d43647a2bd6df304e1e902f6379** en `.verification/remote-39901784288/`. No es campaña ni producción terminadas.
- **Hallazgo propio corregido:** Natalia publicada **no** es el árbol Git a66dea8. Actualproducción es **dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8 source=cli**, sin Git source, ya con navegación nativa. No decir que su reserva actual es app.js simulado. Se archivaron/verificaron sus35 archivos reales,503.818B, en `.verification/natalia-prior-production-20261023/`, SHA1 contraUIDAPI ySHA256. Metadatos y contraste0/12Git en registro. Persistencia de producción sigue sin certificarse por leer HTML.
- **Corrección sólo documental posterior al CI:** una cadena JSON `rollback` en `scripts/prepare-natalia-publication.mjs`, además de Markdown de PRODUCT/documentación. No cambió lógica ejecutable, sitio/config generado ni app/SQL. Archivo auditado SHA256 **22e04797ccced1e528c5444e636c1b5f898222ee1031fec87718ef379dd726d9**; normalizar el literal exacto restaura script478. Pruebas adversarias rechazan código extra de módulo, inline en esa propiedad y otra instrucción. `.verification/natalia-rollback-instruction-adversarial-20261023.json`. Conservar esta distinción en la documentación/promoción: no fingir CI de un runtime posterior.
- **Preparación completa:** `.verification/natalia-publication-478c096/complete-publication-plan.json`,72 entradas Git:35candidata+config+35anteriores+manifiesto. Archivo anterior fuera de output bajo rollback/dpl…/site; seleccionar ese output por commit nuevo para revertir, no el viejo árbol Git. La preparación equivocada anterior se conservó en `...-before-cli-baseline/`. Procedimiento§13 reescrito con comandos y precondiciones.
- **Preview candidata exacta35/35**, `https://natalia-frutos-4zxmm8cjc-juanaltamiras-projects.vercel.app`, dpl_4jXRjdZNjkYXDK4fimdiQcw4oN1i, recibo `.verification/natalia-preview-candidate-20261023-toolbar-off.json`. Primera lectura30/35 falló por Toolbar+163caracteres; header oficial x-vercel-skip-toolbar:1 sólo enpreview, sin normalizar cuerpos ni cambiarconfigglobal. Fuente oficial y fallo preservados. Verificador local secuencialheap128, CLIcurl autorizado; no se leen archivos de credenciales ni se copian tokens.
- **Preview de reversión creado**, `https://natalia-frutos-een2jed5v-juanaltamiras-projects.vercel.app`, sólo outputDir de la copia temporal apunta al archivo previo. **Verificación35 en curso**, proceso administrado de terminal, log `.verification/natalia-preview-rollback-verification-20261023.log`, recibo esperado `.verification/natalia-preview-rollback-20261023-toolbar-off.json`. Recuperar resultado antes de repetir/terminar. No se movieron dominios producción, no Git pushNat. Hobby vuelto a comprobar05:05 UTC.
- **Siguiente exacto:** recuperar rollbackpreview, contrastar alias/metadata/bytes de producción sin cambios. Cerrar auditoría/traspaso conlosresultados. Preparar árbol conservador del principal sobre main313 (147 históricos preservados/109 eliminaciones explícitas) e incluir sólo la excepción documental **exacta** auditada, no cualquiercambioMJS. Versionar documentación final en referencia auxiliar separada del snapshot478; si se verifica fast allí, mantener claro que el binario completo probado es478.
- **Bloqueo externo:** Buildsapp403 y Vercelviejo sin scope, desconexiones aún no confirmadas. No publicar migraciones/app/Nat/main hasta cumplir condiciones1/2. No pedir otra autorización de producción, concedida17Oct. Capacidad gratuita aún no acreditada, SMTP no verificado/destino respaldos/clientes/Google/push reales conservan puertas. Ningún gasto ni plan pago. Staging app478 versión6bde847f,35Natalia/130cliente; prodapp313sin cambios.

## 3n. Diagnóstico completo aprobado, release pendiente (23-oct, ~04:42 UTC)

- **Fuente congelada 478c096e63299b886e640c4627cd25e0db22dbfa**, digest33137563c757da333449f6eafc5e5a0d949250f63c34423f847d1bfc44d4b746, 1.134 archivos. **Artefacto39900877833 aprobado**, validado en `.verification/releases/478c096`, 216 archivos, Worker SHA-256 `da830be716d1163dea0539f532ed64d64a3f45fa9c2dd48ed5719356d0a1e65f`.
- **Diagnóstico39901069118 aprobado44/44**, cero omitidos/intermitentes/reintentos, 149s, tipado E2E previo aprobado. `.verification/remote-39901069118/`,219 archivos, SHA-256 `6c934bed3a9925eb856f8615be17109f84007dc76d21f1c9b1e220aa64eb5681`. Incluye creación/edición clínica, privacidad de recepción, cuotas/política, matrices y caracterización adversaria. Prueba independiente: API401/navegador200/anónimo401 con cookie Secure/HttpOnly real; rechaza redirección/origen ajeno. Mecanismo demostrado, sin tocar autenticación/RLS/cookies de la app.
- **Staging478 desplegado y comprobado:** versión **6bde847f-008c-4f9d-ab3b-8fc7b51d61dd**, `.verification/staging-candidate-478c096-20261023.json`, 04:42:51 UTC,130 archivos cliente/35Natalia iguales y CSP/login/redirección correctos. No cambiar crons ni producción.
- **Release39901784288 en curso**, `artifact_run=39900877833`, `rollback_run=39782403651`. Recuperar resultado/evidencia antes de repetir; no modificar ni redesplegar staging durante la corrida. Debe completar SQL/full y todos los recorridos contra baseline126 y staging. El diagnóstico44/44 no los sustituye. Corregir sólo un defecto nuevo comprobado; fuente congelada.
- Respaldo126 39859035283 y retorno nativo39896937395 ya acreditados, sin app/SQL posteriores que los invaliden; no repetir. Producción313 intacta. Desconexiones de Builds/Vercel viejo pendientes, accesos actualizados04:12:403/no scope; no suponer confirmadas. Capacidad gratuita, SMTP no verificado, respaldos privados y pruebas reales de Google/push conservan sus puertas.
- Al final regenerar paquete local de Natalia y promoción conservadora del principal para478 (147 archivos históricos preservados/109 eliminaciones revisadas), conservar registro final en referencia documental separada sin fingir que el commit documental fue el binario probado. El helper está restringido a fixtures; las subidas Storage firmadas conservan su cliente original.

## 3m. Fallo del transporte autenticado y diagnóstico pendiente (23-oct, ~04:29 UTC)

Prevalece sobre los puntos anteriores. **No hay release final aprobado.**

- **39898867324 falló**, fuente 557f6ab, recibo `eef74f32-6936-425b-ad14-3d69f5b8cd59`, 04:12:26–04:21:43 UTC. Full aprobado de nuevo (43/43 navegador, SQL/carreras/servicios, demo/Natalia). En artefacto 13 aprobadas/1 fallida/29 sin ejecutar; baseline y staging no corrieron. `.verification/remote-39898867324/`, 378 archivos, SHA-256 `dab22da61eb61178380f63377c9f1a768d1a17156064aee0d20644f09ab105e1`.
- **Selector clínico corregido y aprobado** en sus dos casos sobre el paquete. Fallo nuevo en `clinical-files.spec.ts:778`: recepción accede mediante navegador, pero `page.request.get` recibe login y el control positivo lo rechaza. No hay evidencia de exposición de historia ni se acepta una página de login como prueba de privacidad.
- **Causa localizada en Playwright 1.60.0 del lockfile:** `coreBundle.js` `filterCookies`/`isLocalHostname` excluye Secure sobre HTTP/127.0.0.1, aunque Chromium admite ese loopback. La app conserva `secure: !dev`. Falta caracterización de navegador propia para demostrar el mecanismo, no sólo su fuente.
- **Cambios aún sin verificar:** `e2e/helpers/browser-request.ts` usa fetch nativo del navegador para siete peticiones autenticadas del fixture (privacidad/cuota/política). Sólo entorno disposable, mismo origen127 y rutas odonto, sin copiar cookies/Authorization, rechaza redirecciones. Sigue exigiendo 403/409/contabilidad/persistencia. Storage por URL firmada mantiene su PUT original. `request-transport.spec.ts` caracteriza en servidor HTTP real sin app/SDK cookie Secure/HttpOnly: API401, navegador200, contexto anónimo401; rechaza redirección/origen externo. Leer cookies **sin filtro de URL** para no pasar por el mismo filtro defectuoso de Playwright. No contiene valores de cookies en el recibo.
- El tipado E2E local con heap192/guarda y timeout60 falló por heap en 8,44s, pico297.852KiB, sin agotar RAM del sistema. `.verification/e2e-types-transport-20261023.log`. **No aumentar memoria ni repetir localmente**. Nuevo paso de workflow `check:e2e` para diagnósticos antes de preparar servicios; full conserva su propio control. No hubo navegador/DB/build local.
- **26dc5d0** contiene sólo la consolidación anterior de cinco fixtures. **Empaquetado 39899846488 aprobado**, no descargado/desplegado y no incluye browser-request ni la prueba. No certificarlo como arreglo del transporte.
- **Fuente 478c096e63299b886e640c4627cd25e0db22dbfa**, digest `33137563c757da333449f6eafc5e5a0d949250f63c34423f847d1bfc44d4b746`, 1.134 archivos, subida sólo al auxiliar. **Empaquetado 39900877833 aprobado**, descargado/validado en `.verification/releases/478c096`, 216 archivos, Worker SHA-256 `da830be716d1163dea0539f532ed64d64a3f45fa9c2dd48ed5719356d0a1e65f`. **Diagnóstico 39901069118 en curso**, `artifact_run=39900877833`, `browser_grep=.`. Recuperar resultado antes de repetir. Ejecutar **diagnóstico de todos los casos** con `level=browser`, `artifact_run=<nuevo>`, `browser_grep=.`: tipa y corre toda la selección sin detenerse en el primer fallo. Esto evita descubrir diferencias de artefacto una por release completo. No sustituye full/release. Corregir cada fallo real, después desplegar el mismo paquete en staging y ejecutar release con baseline39782403651.
- Staging todavía **557f6ab**, versión e4b8fb00-86a9-4773-9a4a-547ce67d5ced. Producción313 intacta. Respaldo126 39859035283 y retorno alojado39896937395 preservados; app/SQL sin cambios. Las dos desconexiones siguen sin confirmar; lecturas actuales Builds403/Vercel scope inaccesible en registro. RAM local se mantiene protegida; no subagentes ni procesos pesados paralelos.

## 3l. Consolidación final de fixtures, posterior a 557f6ab (23-oct, ~04:20 UTC)

- **39898867324 todavía verifica 557f6ab**, artefacto 39898611547, baseline 39782403651. No tocar staging 557f6ab hasta que termine; no atribuirle cambios posteriores. Recuperar resultado antes de repetir/decidir el siguiente paso.
- Se encontraron cinco constructores administrativos fuera de `fixture-db.ts`, contrario a la instrucción vigente: tres en booking-embed, uno en patient-structure-ux y uno en clinical-storage-policy. Sustituidos por la fábrica compartida, mismas opciones/credenciales/tipado. Se conserva el cliente del actor dueño con clave anónima/Authorization, porque prueba permisos y no es un fixture administrativo. No cambió código de app/SQL ni aserciones/limpieza. Pendiente de CI propia.
- **Fuente final 26dc5d0c80d1e5e47c688f1d22c0413fc78d9b17**, digest `2d934821a15b885d254f10acd4a778fb4d5fa4412565e18d020be8a4ee8867fc`, 1.132 archivos. Subida al auxiliar; **empaquetado 39899846488 pendiente detrás de 39898867324** en el mismo mutex; máximo una corrida activa y una pendiente. No cancelar la evidencia útil del selector clínico ni desplegar la nueva candidata hasta que ese release termine. Tras empaquetar/validar, desplegar únicamente app desde bytes exactos, comprobar Natalia y correr release completo con su artifact_run nuevo/rollback_run 39782403651. No repetir backup ni retorno alojado ya acreditados por un cambio de fábricas de pruebas.
- Los cinco constructores eran la deuda de consolidación encontrada en la búsqueda completa de E2E; la búsqueda posterior deja sólo la fábrica común y el actor deliberadamente autenticado. Cambio estructural reversible, sin alegar un defecto funcional ni inventar una prueba roja. Se comprobaron imports/tipos usados y espacios; no se ejecutaron tests pesados locales.
- El estado anterior, paquetes/hashes, accesos 403/no scope, respaldo126, retorno y preservación de main147/109 permanecen en 3k/registro. Producción no fue modificada. Al cerrar, conservar la documentación final en una referencia documental separada del snapshot probado; no cambiar el SHA del binario que realmente se comprobó para fingir una prueba de un commit posterior.

## 3k. Continuación tras release 39897226356 (23-oct, ~04:06 UTC)

Prevalece sobre 3j en lo que cambia. El respaldo y retorno alojado ya aprobados no se repiten sin una causa nueva.

- **39897226356 fallido**, fuente a354, recibo `c0e1a3fc-15d8-4586-aa6c-f8404ebd26ef`. Full aprobado, **43/43 navegador**, SQL/carreras/servicios reales, demo y Natalia. Artefacto: **7 aprobadas, 1 fallida, 35 sin ejecutar**. Baseline completo y staging de release no ejecutados. `.verification/remote-39897226356/`, 358 archivos, SHA-256 `c18d787f3f9fae08eb45a6e2249f15acc92282f0c402331b185790cc7a5d4fa4`.
- **Fallo nuevo reproducido antes de corregir:** `clinical-entry-date.spec.ts:92`, selector de título ambiguo con scripts retenidos antes de hidratar: cabecera y main contienen el nombre. Captura/contexto inspeccionados. Se acotaron título/botón a main; se conservan bloqueo antes de JS, interacción, guardado, fecha UTC y recarga. Fixture usa el helper tipado común. Sólo cambia ese spec/documentación; falta repetir release.
- **Nueva fuente 557f6ab489f7ceb307a4f36a60556ed8b3f69886**, digest `c821948345fb2e4116e6c44b326896c5189587fb11aeb194456952f2ae22fcef`, 1.132 archivos, subida al auxiliar. **Empaquetado 39898611547 aprobado**, 216 archivos, Worker SHA-256 `d329c43308b87461b1ca0d648673efc554d2f5fb8f01780cc31c899edff010d0`, carpeta `.verification/releases/557f6ab`. **Staging desplegado**, versión e4b8fb00-86a9-4773-9a4a-547ce67d5ced. **Release 39898867324 en curso**, `artifact_run=39898611547`, `rollback_run=39782403651`. Recuperar resultado antes de repetir; no tocar staging mientras corre. Comprobar Natalia por bytes y no redesplegar si sigue igual. Ejecutar release con su `artifact_run` nuevo y `rollback_run=39782403651`. No usar un artefacto a354 para certificar otra revisión ni considerar corregido sin prueba real.
- **Evidencia ya cerrada y vigente para su alcance:** respaldo 39859035283 (126 migraciones), retorno alojado 39896937395 (baseline dfb, dos reservas persistidas/recuperadas/canceladas), ambos código/SQL sin cambios por esta corrección del spec. Staging ya sirve 557f6ab; los 35 archivos de Natalia coinciden y no necesitaron nuevo despliegue. Producción 313 sin cambios.
- Preparación de Natalia/árbol principal de a354 debe regenerarse para la candidata nueva, conservando 147 archivos no seleccionados y las 109 eliminaciones revisadas. Se concretó en el procedimiento la instalación/registro de un baseline compatible de producción **antes de contraer**; todavía no ejecutado.
- Identidad: corregida la falsa equivalencia entre pausa de Vercel y desconexión Git; secuencia unificada con publicación. SMTP propio sigue **no verificado**, no ausente (CLI sin lectura de Auth, sin token de administración en entorno/conector). Acreditar entrega antes de clientes; sólo si falta, decidir cuenta transaccional. Siguen pendientes las dos desconexiones del usuario; no asumir que «seguí» las confirma. Capacidad gratuita y resto de puertas originales vigentes.

## 3j. Punto exacto vigente (23 de octubre, desde ~03:46 UTC)

Reemplaza a 3i en lo que cambia; conservar abajo los antecedentes y el registro detallado.

- Plan íntegro releído y huella aprobada intacta; HEAD de trabajo `80268e2`, rama e índice del usuario preservados. No hay bases/builds/navegadores locales ni subagentes.
- **Fuente candidata congelada:** `a354a26dfebe9cf2937668465045cb568b9aa2d2`, digest `2b032caa01c8dc0d009808b4d8780e75356f172c5ed875920f957edc4da6cbdd`, 1.132 archivos. Rama auxiliar comprobada mediante `git ls-remote`. **Empaquetado 39896557552 aprobado**, descargado en `.verification/releases/a354a26`; manifiesto validado, 216 archivos, Worker SHA-256 `bfab1def9d0ab6d843cfc4b758e0cc53d92cb85bc7de85a81ee621712295b617`. Todavía no certifica release.
- **Diagnóstico WebSocket 39859031404 aprobado, 3/3, sin omitidos/reintentos**, fuente `48b1c20`, artefacto 39858722802. Profesional real, reproducción nativa sin app/SDK y rechazo de un mensaje falso sin cierre observado. `.verification/remote-39859031404/`, SHA-256 `673e2cf248a23799065aeda4794020393a651744784ec2b5ce8a02b7339d4f4e`. Diagnóstico específico cerrado, no Realtime alojado ni campaña. App/SDK/e2e no cambian en a354; ésta preserva evidencia por perfil y amplía sus cotas medidas. Pruebas locales rojas/verdes en registro; falta full/release exacto.
- **Respaldo 39859035283 aprobado:** 126/126 migraciones, conteos idénticos en 96 tablas/76 filas, política/disparador propios conservados y objeto de 2.368 bytes con huella idéntica; bucket único retirado. Recibo `.verification/backup-rehearsal-39859035283.json`, logs ZIP SHA-256 `c21fb586afcccebb394d4c3d727a6e56e28a774be3f6d6436142c50948bb92ee`. No equivale al volumen del ensayo anterior de 117 migraciones ni a un proyecto alojado nuevo. El código/dependencias/SQL de este ensayo no cambian entre 48b y a354 (Git comprobado).
- **Staging previo, 23-oct 03:45 UTC:** sirve `dfb487f`, 130 archivos cliente del baseline iguales. Los 35 archivos de Natalia servidos coinciden con la candidata final a354, por lo que no se redespliega ese sitio. CSP exacta. `.verification/staging-before-rollback-rehearsal-20261023.json`, `.verification/candidate-a354a26-package.json`. Producción sigue `313355a`, sólo lectura.
- **Candidata desplegada:** versión e5088b76-6ff9-4fe3-b9a3-b8590183f1e8, luego rollback nativo real a 04ef8a10-ad65-4ae6-81d0-4a1da21629b0. La app de staging volvió a servir dfb y sus 130 archivos cliente correctos; `.verification/staging-after-native-rollback-20261023.json`.
- **Retorno alojado 39896937395 aprobado** a las 03:49:49 UTC: fuente a354, baseline dfb, 130 archivos app/35 Natalia, 61 relaciones sin exposición anónima y dos reservas persistidas/recuperadas sin duplicar/canceladas desde Natalia, escritorio/móvil. `.verification/remote-39896937395/`, siete archivos, SHA-256 `4b799707dd373e5941fc824d02e8d3788581851dea225b31fc24896be3050b3b`. Sin sustitución de transporte ni errores de página. Dos capturas móviles abiertas para inspección; no equivale a toda la matriz.
- **Candidata restituida** desde el mismo paquete, versión **54a7ea04-9e5f-4c22-9062-83c3bc7a6bc6**, log `.verification/staging-restore-a354a26-20261023.log`. **Release 39897226356 en curso**, con `level=release`, `artifact_run=39896557552`, `rollback_run=39782403651`. Recuperar su resultado antes de repetir; no tocar staging mientras corre.
- **Reversión pendiente:** release exige toda la suite actual también sobre el baseline con las 126 migraciones. Antes de la contracción en producción se deberá instalar/registrar una versión compatible de rollback allí; `313355a` sólo es compatible después de expansión. No devolver permisos inseguros.
- **Bloqueos externos sin cambio:** usuario no confirmó desconexión de Builds del Worker app ni Git del Vercel viejo. API Builds 403; sesión Vercel sin ese scope; no asumir completado por «seguí». Natalia tiene repositorio/proyecto/plan Hobby comprobados, preparación reproducible, sin publicación. Su site debe prepararse con el paquete final aprobado. Capacidad gratuita, SMTP, respaldos privados y comprobaciones reales de Google/push mantienen sus puertas documentadas. Ninguna contratación.
- No reemplazar el árbol del repositorio principal con el snapshot auxiliar: éste es selectivo y excluye históricos/archivos ajenos. Preparar promoción concreta que preserve lo no seleccionado y el índice local. No hubo push al principal ni escrituras de producción.

## Antecedente 3i, reemplazado por 3j (22 de octubre, desde ~20:25 UTC)

Reemplaza a 3h en lo que cambia. Evidencia y comandos en la sección de reanudación al final del registro.

- Plan íntegro/AGENTS/traspaso y documentación operativa contrastados. Inventario de los 161 archivos de `docs/` con huellas y enlaces relativos en `.verification/resume-20261022-document-inventory.json`. Árbol preservado; HEAD local sigue `80268e2`, sin cambios al plan original.
- **`verify:release` 39783349541, intento 2, terminó fallido a las 14:02 UTC sobre `dfb487f`.** El nivel completo sí aprobó: 1.388 servidor, 171 cliente, 1 nativa, SQL/carreras, 41/41 navegador, 2/2 demo y Natalia. Después falló el caso de profesional (`booking-embed.spec.ts:835`) sobre el paquete en workerd: dos advertencias `unclassified` de `CKKE2KNF.js:8`. Cinco casos aprobados, uno fallido, 35 sin ejecutar; staging de release no ejecutado.
- **Evidencia recuperada:** `.verification/remote-39783349541/`, recibo `ff318c5e-45a4-4632-a38e-a75438e48347`, paquete SHA-256 `28516c4e1fe68be9eb8c1095315cd81e1791964e7b5ce515715cf659f3ccfa1a`.
- **Diagnósticos recuperados:** 39850821824 (`3c11ed0`) y 39851992541 (`f97669f`) fallidos; el segundo identificó exactamente dos advertencias de WebSocket cerrado antes de conectar. Paquetes `.verification/remote-39850821824/` y `remote-39851992541/`; huellas en el registro. La coincidencia textual no demuestra la causa ni autoriza descartarla.
- **Diagnóstico adversario 39854278078 (`b826d5c`): 1/3.** El profesional aprobó y observó cuatro cierres nativos en CONNECTING por cuatro advertencias; cero fallos HTTP/red. Las dos pruebas nuevas fallaron antes del WebSocket porque el fixture propio suponía incorrectamente que el login tenía `main`. Corregidas para usar un documento generado explícitamente en el origen loopback, sin app/SDK. Evidencia `.verification/remote-39854278078/`, SHA-256 `ff0db4f5e305c9a048d6bf1c8ee200cb610eb3361547a03cca3db8bd285561e2`. No se considera cerrado.
- **Fast 39856766704 de `12b15f5` aprobado:** 132 guardas, 11 del programador, 1.388 servidor, 171 cliente, tipos incluidos los nuevos casos e2e y arquitectura; 13 pasos, sin omitidos. Evidencia `.verification/remote-39856766704/`, SHA-256 `07ca6f8ae326a5315b0db253e8f6652fb78979263046d5cb1f378cd3f3a678ba`. No certifica las adiciones posteriores.
- **Candidata actual:** `48b1c20976f15ba66c1a5a1b84619e9aec510a10`, digest `559ac02bd357a799069b6677ff1fe1a58c059fe95f15036225e7f4b6179bda9f`, 1.130 archivos. **Empaquetado 39858722802 en curso.** Después, diagnóstico `level=browser`, `artifact_run=39858722802`, `browser_grep=professional tasks preserve persisted edits|render health socket evidence`; repetir respaldo de las 126 migraciones, retorno alojado y release. Las pruebas pesadas siguen sólo en CI. No se cambió código de ejecución de la app.
- **Criterio reforzado del usuario:** asumir que el trabajo propio y el heredado pueden estar equivocados; intentar refutar conclusiones y verificadores. Se documentó en AGENTS. El clasificador tiene pruebas locales negativas/positivas; la evidencia del navegador aún falta.
- **Verificador servido corregido tras tres reproducciones negativas:** mismo origen en redirecciones, CSP sin otros proyectos/wildcards/directivas duplicadas y límite de descarga comprobado durante el streaming. Local: 8/8 y, con clasificador, 11/11. Evidencia en el registro; falta CI exacta.
- **Reversión después de contracción reabierta:** `313355a` pierde escrituras necesarias tras `20261022010000`. Compatible sólo después de expansión. El siguiente release exige además `rollback_run=39782403651`: prueba completa de navegador actual contra el binario anterior `dfb487f` y las 126 migraciones. Candidata y baseline se validan por separado, sin sustituirse. La nueva puerta aún no pasó CI; falta ensayo de retorno en staging y registrar versión compatible de producción antes de la tanda 2. No devolver privilegios inseguros.
- **Limpiezas completadas:** documentos, recibo `release-smoke-staging-cleanup-2026-10-22T20-38-55-671Z.json`, 7 comprobaciones; capacidad **39850817211 aprobada**, cero dueños/consultorios propios, base de 20.002.483 bytes. No repetirlas.
- **Documentación corregida:** README y documentos de áreas, etapa 4, relaciones, tareas, decisiones y alcance tenían instrucciones/estados anteriores. Las correcciones enlazan las evidencias existentes, no crean nuevas certificaciones.
- **Disciplina reforzada:** ningún bucle/proceso local en segundo plano, `free -m` antes de cada paso no trivial, sin builds/navegadores/bases locales y sin dos procesos Wrangler a la vez. Sólo una corrida externa activa y como máximo otra pendiente, compartiendo exclusión.
- **Natalia:** main `a66dea894dcb513f5e9a4fcc9d8598c7f22503b9`, árbol `70e2bc614cc4baa54c859e43c4f3152ba7ba7ec3`, repo confirmado `juan-altamira/web-natalia`. CLI Vercel comprobó proyecto `prj_ddhAhez9VNro373XWSykLkhU5vBS`, equipo `team_CGSlkRXKKlw98jb3O2wSmcyt`, Git main y raíz sin framework/build/output personalizado (`vercel-natalia-project-20261022.json`). Preparación local revisable de b826, sin publicar. `prepare-natalia-publication.mjs` permite repetirla con la candidata exacta; procedimiento detalla blobs/árbol/commit, comparación de HEAD, 35 archivos bajo site, config sin build y reversión. Conservar el origen anterior. La sesión no tiene acceso al scope del Vercel viejo.
- **Readiness real en producción, lectura del 22-oct:** 97 migraciones, última `20261014030000`. La tabla de integración **sí existe** y la clave 9af… tiene un perfil activo, origen de Natalia autorizado, negocio y reserva pública activos, seis servicios y un profesional elegibles. No asumir ausente por memorias anteriores: `.verification/natalia-production-readiness-20261022.json`. Esto no prueba una nueva reserva ni el sitio publicado.
- **Realtime alojado:** lectura actual confirmó particiones vigentes en producción y ninguna en staging; ambos WebSocket abren (`realtime-readonly-20261022.json`). No certifica propagación, autorización de canales ni sincronización completa del navegador.
- **Respaldo reabierto:** el ensayo anterior cubría 117 migraciones, ahora son 126. El nuevo `backup-rehearsal` todavía no corrió. Se encontró y corrigió la adopción/borrado de un bucket compartido y la limpieza no preparada ante pérdida de respuesta de subida. Helper `backup-storage-probe.mjs`, pruebas **0/2 antes, 2/2 después**, registros `.verification/backup-probe-negative-20261022.log` y `-positive-20261022.log`. Ahora bucket privado único, 400/409 rechaza sin adoptar el anterior, limpieza del objeto exacto aun ante respuesta de subida perdida; un objeto ajeno no se borra para vaciar el bucket. La creación no confirmada queda registrada para inspección. Falta prueba alojada. Se leyó skill Supabase/Postgres y su guía de privilegios/transacciones; sin SQL nuevo ni migraciones de producción en esta intervención.
- **Protección local reforzada:** `qa-natalia-direct-booking`, `verify-campaign-staging` y `backup-rehearsal` rechazan arrancar fuera de CI antes de navegador/red/Docker; recibo `direct-browser-local-refusal-20261022.json`. No hay bucles locales ni procesos pesados en segundo plano.
- **Disparadores:** el usuario no verificó desconexiones. API Cloudflare Workers 200 / Builds triggers 403 (`cloudflare-builds-readonly-20261022.json`); se pidió desconectar `app` Builds y Vercel viejo `juans-projects-76d0ede4/cita-suite`. La respuesta sigue pendiente. No asumir completado ni pedir otra vez autorización de publicación, ya concedida.
- **Siguiente exacto:** terminar artefacto 39858722802 y probar los tres casos; repetir `backup-rehearsal` sin volver a sembrar capacidad; desplegar app/Natalia de ese mismo artefacto en staging, devolver la app de staging a la versión previa `04ef8a10-ad65-4ae6-81d0-4a1da21629b0` (`dfb487f`), y comprobarla con `level=rollback`, `rollback_run=39782403651`. Registrar versión y comparación de bytes, sin tocar cron ni producción. Restaurar luego la candidata exacta. Ejecutar `level=release`, `artifact_run=39858722802`, `rollback_run=39782403651`, que además prueba todo el navegador contra el baseline y las migraciones actuales. Actualizar auditoría/instructivo con sus resultados. Producción sigue sirviendo `313355a`; no se modificó.

## Antecedentes de los puntos 3f a 3h (21 y 22 de octubre)

1. **Cierre de etapa 5 (hecho, no repetir):** full 39276578152 sobre `6746491` (digest `44fb8645…`, recibo `c0219616-f7d1-4e03-9843-bf6cb72a4cb7`, paquete `.verification/remote-39276578152/`, SHA-256 `b7667aee…`): 15/15 etapas, 37/37 navegador, 2/2 demo, 1.265 servidor, 167 cliente, exportación nativa, SQL/carreras, deadlocks 0, Natalia idéntica. Revisión Impeccable en `.impeccable/review/structure-20261018/round-2/` (primer dictamen `fix`, tres puntajes literales en `verdict-passes.md`, el último `ship`) y documentador sobre `apps/web/DESIGN.md`. Matriz en `docs/architecture/evidencia-etapa5-estructura.md`.
2. **Etapa 6 cerrada (20 de octubre, ~08:15 UTC; se avisó al usuario).** Evidencia completa en el registro y en `docs/architecture/tareas-automaticas.md`. Fulls 39364962358 y 39366010644 sobre `c0f883d`. Staging desplegado: app `cita-suite-staging` (versión `df59a57d…`, revisión `9852251`, sin cambios de app hasta `2fe4408`), programador `cita-suite-scheduler-staging` (versión `5519dc77…`) con **los cinco cron de la cuenta Free prestados a staging**, base de staging con 113 migraciones. Escenario del plan, recuperación de reclamaciones abandonadas y entrega real por FCM a un Samsung, todo comprobado. Las corridas sintéticas `b03663a5ddbb`, `3a9214b7b23e`, `78e23f8788dc` y `6046bdb2e8db` quedaron limpias.
   - **Decisión del usuario (20 de octubre, ~20:30 UTC): no se contrata Workers Paid ni ningún servicio con cobro variable sin tope.** El usuario no acepta cargos por consumo que un defecto del código o del proveedor puedan volver impagables. Workers Free y Supabase Free cumplen esa condición, porque al exceder sus límites cortan o restringen y no cobran. Consecuencia: dentro del plan, que fija conservar Cloudflare, la app y el programador tienen que entrar en los 10 ms de CPU de Free. El trabajo siguiente es reducir y medir la CPU por ruta en staging; si no alcanza, presentar al usuario, con datos y como bloqueo de una decisión fundamental del plan, la alternativa de un alojamiento de precio fijo con tope duro. Supabase Pro sólo se mencionó como opción a evaluar por su límite de gasto (para el ensayo alojado de 25); no está contratado ni autorizado.
   - *Antecedente:* decisión pendiente del usuario, reforzada el 20 de octubre por el ensayo alojado de capacidad: con la carga de 5 consultorios, Cloudflare cortó por CPU entre 15 % y 52 % de los pedidos de la app (`exceededCpu`, HTTP 503; ver `docs/architecture/capacidad.md`). Workers Paid ya no es sólo para el programador: producción también está en Free. Además, push usa 64–124 ms de CPU por ejecución y Free documenta 10 ms. La plataforma no cortó nada durante la medición, pero esa tolerancia no está documentada. Se recomienda **Workers Paid** antes de activar el programador en producción, con `JOB_BUDGET_PROFILE=paid`. No contratar sin autorización explícita.
   - **Defecto corregido en esta etapa por evidencia de staging:** `safeupdate` del PostgREST alojado (`20261020010000`); el entorno descartable ahora lo reproduce (PostgREST como `authenticator`, sonda en `scheduled-jobs.spec.ts`).
   - **Transición (en la secuencia de publicación del plan):** liberar los cron de staging (desplegar el programador de staging sin triggers o borrarlo), aplicar las migraciones nuevas en producción, apagar las entradas antiguas con `set_legacy_job_entrypoints(false)`, comprobar que cron-job.org y las copias retiradas de Netlify y Vercel no llamen nada, desplegar app y programador de producción y verificar sus eventos reales.
3. **Capacidad y matriz de regresiones, en curso (21 de octubre).** Diseño, método y hallazgos en `docs/architecture/capacidad.md`; cronología en el registro; control de consumo en `docs/architecture/control-de-consumo.md`.
   - **Herramientas:** `scripts/capacity/seed-practices.sql` (generador determinista con triggers reales, por lotes), `scripts/run-campaign-capacity.mjs` (`level=capacity` en CI, con escenarios de 5 y 25), `scripts/lib/capacity-load.mjs` y `scripts/staging-capacity.mjs` (ensayo alojado: `staging-operations` `capacity-seed`, `capacity-measure`, `capacity-report` y `capacity-cleanup`, con `practices` 2, el lanzamiento y valor predeterminado, o 5). La CPU por ruta se observa con `node scripts/tail-metrics.mjs staging <12 hex> <minutos> requests` (antes `staging-tail-metrics.mjs`) desde la sesión local de Wrangler.
   - **Ensayo alojado de 5 consultorios (preservado como evidencia):** no cumplió por la CPU de Workers Free (cortes del 15 al 52 % por minuto); integridad sin fallas. Ya no es condición de cierre.
   - **Defectos reales corregidos y verificados después de ese ensayo** (todos reproducidos primero con una prueba que falló): lectura de pacientes y de turnos evaluada fila por fila (`20261020020000`, `20261020030000`); retención de `public_booking_attempts` (`20261020040000`); 442 formateadores por cálculo de disponibilidad; agenda semanal contada en la base con falla explícita (`20261020050000`), día actual en la zona del consultorio y fechas o filtros inválidos sin error 500; sincronización de revisiones que consultaba cada 5 s, oculta o no; dos lecturas de membresías por pedido; y el refresco del acceso tras el retorno de Mercado Pago, que devolvía la lectura anterior al pago. Última verificación: **fast 39518222613 sobre `94805f9`, aprobada** (1.325 servidor, 169 cliente); SQL 39515072553 con todas las migraciones.
   - **Staging:** 117 migraciones (operación 39518719822). App `cita-suite-staging` versión `c29f0341-d14d-4d16-8c33-b3623ffb3fbc`, sirviendo `94805f9` (artefacto 39518820340). **En curso:** ensayo de dos consultorios sobre Workers Free y Supabase Free, criterio de lanzamiento de la enmienda del 20 de octubre: siembra 39519107082 → medición con tail → informe → limpieza. Si Workers Free sigue cortando por CPU con dos consultorios, es un **impedimento de publicación** que se informa al usuario con alternativas. No se contrata nada.
   - **Siguiente:** cerrar la matriz de regresiones (`docs/architecture/matriz-regresiones.md`). Después, la auditoría transversal, con estos pendientes: historiales sin depurar, el 503 público sin registro de causa, los tres `as unknown as`, la agenda diaria que muestra un día vacío ante un error de lectura, copias del cálculo de fecha local y del patrón UUID, `getAuthUserId` repetido en `patient-list.ts` y la deuda de interfaz del punto 5. Luego el release.
   - **Release: correo de Auth.** Producción tiene `mailer_autoconfirm` activo, pero el restablecimiento de contraseña necesita correo, y el SMTP integrado de Supabase sólo entrega a miembros del equipo (2 por hora). Comprobar si producción tiene SMTP propio. Si no, es un impedimento para clientes reales y una decisión del usuario, porque requiere una cuenta de correo transaccional.
   - **Realtime alojado, para el release:** la primera siembra de staging mostró que allí las difusiones de `realtime.send` desde triggers se pierden por falta de la partición diaria de `realtime.messages` (una advertencia por fila). Comprobar en producción, en modo lectura, las particiones y el transporte antes de dar por verificada la sincronización de revisiones de pacientes. Con la corrección del 21 de octubre, sin Realtime la lista se actualiza en unos 30 s.
3f. **Punto exacto (22 de octubre, ~02:00 UTC).** Reemplaza a 3e; el detalle está en el registro.
   - **Auditoría transversal: cerrada.** Después del cierre apareció `r19` (copias sueltas del patrón UUID), corregido y verificado.
   - **Candidata al release: `cd8e9ad`.**
     - **Full 39704821720 aprobado entero.**
     - **Artefacto 39704832587:** trae los paquetes de staging y de producción, y su `_worker.js` es idéntico en los dos.
     - **Staging:** sirve `cd8e9ad`, versión `f07641c1…`, con 124 migraciones.
   - **Hecho del release:**
     - ensayo de respaldo y restauración aprobado (39682517594);
     - respaldo de producción del 21 de octubre a las 22:03 UTC, en `~/.local/share/cita-suite/backups/`;
     - migraciones de staging y medición de auditoría: funcional aprobada, p99 de lecturas incumplido;
     - atribución de las pausas: falta de memoria de Nano y swap;
     - compatibilidad de las 27 migraciones con `313355a`;
     - programador anterior: cron-job.org, deshabilitado.
   - **Herramientas:**
     - `backup-production.mjs`;
     - `apply-production-migrations.mjs`;
     - `deploy-production-workers.mjs` (`app` y `scheduler`);
     - `deploy-staging-workers.mjs scheduler-without-crons`;
     - `production-capacity.mjs` y el workflow `production-measurement.yml`;
     - `instance-sampler.mjs` y `attribute-pauses.mjs`.
     - El procedimiento está en `docs/architecture/publicacion-y-reversion.md`.
   - **Esperando al usuario. Ningún paso de producción corre antes de estas acciones:**
     1. desconectar Workers Builds del Worker `app` en Cloudflare;
     2. desconectar o borrar el proyecto `cita-suite` de Vercel;
     3. indicar cómo se publica Natalia, o autorizar el uso de la sesión de la CLI de Vercel sin leer sus archivos.
   - **Después, la secuencia del procedimiento:**
     1. respaldo nuevo;
     2. las 27 migraciones;
     3. `set_legacy_job_entrypoints(false)`;
     4. la app;
     5. liberar los cron de staging y desplegar el programador;
     6. las comprobaciones posteriores; para el push real, pedirle al usuario el Samsung;
     7. la medición de producción con muestreo de la instancia;
     8. el repositorio y la identidad.
   - **Decisiones pendientes del usuario:**
     - el plan de Supabase, con los datos de la medición de producción;
     - el correo transaccional para restablecer contraseñas;
     - el destino de los respaldos de datos reales.
   - **Postergado con riesgo documentado:** los comparadores de parámetros de ruta.
3g. **Punto exacto (22 de octubre, ~02:15 UTC).** Reemplaza a 3f en lo que cambia; el detalle está en el registro.
   - **Huecos del release encontrados al contrastar el plan:**
     - los recorridos de navegador no corrían sobre el paquete compilado, sino contra el servidor de desarrollo;
     - faltaba el staging de Natalia;
     - faltaba el ensayo de cuotas y recursos.
     Los tres son condición previa a publicar y no dependen del usuario.
   - **`verify:release` rediseñado** ([verificación](../architecture/verificacion.md), «Release y staging»):
     - **Release:** `package-release-artifact.mjs` lo arma una sola vez. Contiene la app para staging y producción, y el sitio de Natalia para cada entorno.
     - **Nivel `release`** del workflow de verificación, con `artifact_run`: full, recorridos sobre el paquete en workerd (`--artifact`) y staging desplegado. Staging se comprueba con los archivos del release, la sonda anónima y la reserva desde la copia de Natalia, incluida su cancelación.
   - **Staging nuevo:**
     - Worker `natalia-frutos-staging`: sólo archivos, con `noindex`;
     - consultorio sintético `release-staging`, asegurado con `staging-release-fixture.mjs` y la operación `release-fixture`;
     - secreto `CITA_STAGING_ANON_KEY` en el repositorio de verificación.
   - **Primera corrida:** snapshot `017b26f`, release 39708965987, staging desplegado (app `85aa471c…`, Natalia `1926a654…`) y `verify:release` 39709379322.
     - **Full:** aprobado entero.
     - **`artifact-browser`:** falló porque el paquete de producción sólo acepta orígenes HTTPS en las integraciones, y el entorno descartable usaba `http://127.0.0.1`. Es la regla correcta de producción, no un defecto.
     - **Corrección:** el anfitrión embebido se sirve por HTTPS en loopback, con un certificado de cada corrida.
   - **Segunda corrida (`df3f59c`):** el full se aprobó; sobre el paquete falló la subida de documentos por la CSP del paquete de producción. Ahora la CSP admite sólo el proyecto Supabase configurado.
   - **Deriva de producción encontrada y resuelta antes de publicar** (detalle en el registro y en `publicacion-y-reversion.md`):
     - el ensayo con `ROLLBACK` mostró 8 sentencias que fallaban;
     - la comparación del catálogo mostró políticas, funciones, columnas e índices cambiados a mano;
     - quedan cubiertas por la reconciliación `supabase/production/reconcile-drift.sql`, dos migraciones nuevas con su prueba que falló primero (`20261022000000` y `20261022010000`) y la publicación en dos tandas, en una sola transacción cada una.
   - **Tercera corrida (`e67fc46`):**
     - staging tiene 126 migraciones, con app `1f70e33f…` y Natalia `c7ca94dc…`;
     - el ensayo de producción contra staging da cero fallas y un catálogo idéntico, salvo la deriva aceptada;
     - `verify:release` 39736494567 en curso.
   - **Producción, sonda anónima previa:**
     - 20 relaciones responden 200, con RLS y sin filas visibles;
     - lo cierra la migración pendiente `20261021020000`, y la sonda posterior debe dar cero;
     - la política `master read allowed_emails`, sólo de producción, se decide con la comparación del catálogo después de publicar.
   - **Ensayo de cuota y capacidad:** prueba nueva en `clinical-files.spec.ts`. Corre en el full y sobre el paquete del release.
   - **Entregables nuevos:**
     - [permisos y capacidades](../architecture/permisos-y-capacidades.md);
     - [decisiones](../architecture/decisiones.md).
   - **Sigue vigente de 3f:** la espera de las acciones del usuario en los paneles y la secuencia de publicación, que ahora exige además `verify:release` aprobado con el paquete que se publica.
3h. **Punto exacto (22 de octubre, ~12:55 UTC).** Reemplaza a 3g en lo que cambia; el detalle está en el registro.
   - **Pedido del usuario: «deja todo extremadamente documentado».** Es directiva de la campaña (`AGENTS.md`): cada corrida, falla, causa, corrección, decisión y pendiente va al registro con su identificador, SHA y evidencia, y cada procedimiento lleva comandos, comprobaciones y reversión.
   - **Cuarta corrida del release (`934ac72`):** el full aprobó entero. Sobre el paquete falló la integración predeterminada del escenario descartable, que permitía un origen HTTP; producción (`313355a`) ya aplica la misma regla. Se corrigió el escenario.
   - **Quinta corrida (`f83bbc2`):**
     - empaquetado 39776901415, `_worker.js` `8e54c06e…`;
     - staging con app `83b60e2f…` y Natalia `ed419cbc…`;
     - `verify:release` 39777244477 **cancelado** a las ~12:50 UTC: la instalación fijada de LibreOffice quedó colgada 25 minutos, cuando antes tardaba 19 s. Los pasos de preparación del workflow tienen ahora límite propio (15, 20 y 10 minutos).
   - **Instructivo de publicación reescrito** ([publicación y reversión](../architecture/publicacion-y-reversion.md)): candidata, destinos, herramientas, condiciones previas con su estado, y 14 pasos con comando, resultado esperado, criterio de detención y reversión.
   - **Herramientas nuevas para publicar**, todas con la guarda común de destino (`scripts/lib/production-database.mjs`):
     - `production-legacy-jobs.mjs`, el interruptor de las entradas antiguas;
     - `verify-production-release.mjs`, la comprobación estática de producción;
     - `release-smoke.mjs staging|production`, reserva pública y documento clínico sobre `capacity-01`;
     - `production-device-push.mjs`, el push real en producción;
     - `check-previous-scheduler.mjs`, cron-job.org y las copias retiradas;
     - `deploy-production-workers.mjs scheduler-without-crons`, el primer paso de la reversión;
     - `tail-metrics.mjs`, que reemplaza a `staging-tail-metrics.mjs`.
     Guardas locales: 124 de 124.
   - **Hecho después (13:00 UTC):**
     - cancelación de 39777244477 confirmada;
     - siembra `capacity-` en staging (39781320040);
     - prueba de humo en staging aprobada con 14 comprobaciones, después de corregir su limpieza. La reserva de 5 MB por URL vigente es el diseño correcto de la etapa 3;
     - ensayo del programador sin cron y su restitución en staging (`6266c45a…` y `49636b6a…`);
     - snapshot final `dfb487f`, sin cambios de app, base ni paquetes respecto de `f83bbc2`;
     - empaquetado 39782403651, con `_worker.js` `607528d8…`.
   - **Siguiente, en orden:**
     1. desplegar staging desde 39782403651;
     2. `verify:release` de `dfb487f`;
     3. después de las 15:08:57 UTC, `release-smoke.mjs staging cleanup` y la operación `capacity-cleanup`;
     4. registrar todo y actualizar la candidata del instructivo.
     Después se espera al usuario, que sigue sin responder las condiciones previas 1, 2 y 3.
   - **Corrección de 3g:** la política `master read allowed_emails` no queda para después de publicar. La reconciliación ya la borra (`reconcile-drift.sql`, línea 77), y el ensayo con `ROLLBACK` mostró el catálogo igual al de staging.
4. **Copias antiguas retiradas por el usuario (resuelto el 19 de octubre):** `https://cita-suite.netlify.app` servía una copia completa de la aplicación con endpoint de tareas. El usuario desactivó ese proyecto y también pausó `https://cita-suite-app.vercel.app`, otra copia que no figuraba en el inventario. Comprobado por HTTP a las 21:12 UTC: Netlify responde 404 y Vercel 503. Ambas están en el inventario de `identidad-cita-suite.md`. El interruptor de base de la migración sigue siendo parte de la transición: neutraliza cualquier llamador antiguo (por ejemplo cron-job.org contra el Worker) sin depender de esas cuentas. Antes de activar el programador nuevo, volver a comprobar que las dos copias siguen fuera de servicio.
5. **Pendiente para la auditoría transversal** (debe corregirse ahí): con el criterio de retención de la sección 4, revisar las tablas de historia que no se depuran (`audit_logs`, `mp_webhook_events`, `patient_profile_change_events`, `whatsapp_webhook_events`) y decidir cuáles son historia del producto y cuáles registros; `public_booking_attempts` ya se conserva 7 días (`20261020040000`). La carga pública (`defaultIntegration` en `/reservar` y `readBookingIntegrationRequest`) convierte cualquier excepción en 503 sin registrar la causa. Tres `as unknown as` en producción (transporte `ws` del cliente Supabase de servidor, `configuracion/negocio/+page.svelte` y `patient-export.worker.ts`); deuda de interfaz preexistente no canonizada por el documentador (kickers/eyebrows, glifos como íconos en `.ux-tab-marker`, 14 tamaños literales, `truncate` en superficies no cubiertas, pesos 650–900 con Inter cargada en 400–700, `ThemeToggle.svelte` sin uso, fechas «4 de / noviembre» partidas a 320 y costo «$ 125,5»). Detalle en el registro. Resueltos en etapa 6: los casts de errores de `push.ts` (ahora `PushServiceError` y el error tipado del SDK) y la auditoría de las tareas fuera del `fetch` presupuestado (`insertAuditLog` recibe el cliente de la tarea).

## Antecedente: relevo de GPT-6.1 Sol (19 de octubre, ~06:02 UTC)

### Punto exacto del relevo de GPT-6.1 Sol (histórico, ya resuelto)

### Corrida que quedó trabajando

- **Full `39207125504`**, en `Juan4787/cita-suite-verificacion`, fuente **`09dec4ebca98afbfcdde7f025cd648c584eee535`**, digest **`fc2a07b9245dceb386fd1ece6e600bb53ea666d396ac8bede338a1bdef40d127`**. Última consulta: `in_progress`, paso `Verify sequentially`, 19-oct 06:01:44 UTC. No se canceló ni se lanzó otra corrida pesada. Consultar su resultado y recuperar sus logs antes de repetir.
- Esa fuente **NO contiene las cuatro correcciones visuales posteriores ni el nuevo helper de captura** descritos debajo. Aunque full apruebe, no certifica esos cambios posteriores. Sí puede dar evidencia válida de sus propios tipos, SQL, carreras, backend y medición de Natalia.
- El snapshot de relevo posterior preserva archivos y documentación en el auxiliar, pero **no se lanzó verificación nueva sobre él**. Obtener su SHA/digest de `.verification/ci-source.json` y de la referencia `refs/verification/maintainability-20261015`. El HEAD de trabajo permanece `80268e2a501198243996e1bdb0048ce066434727`; no confundirlo con el snapshot probado.

### Últimos resultados comprobados

- Fast `39186305257`, fuente `87e79eec1e7d21c34ad8981c932258f9046ea0f2`: tipos, fronteras, 59 guardas, **1.264 servidor y 167 cliente**, todos aprobados. Paquete recuperado `.verification/remote-39186305257/`, SHA256 `495caf3a75e4f106d6db02b1bd9fcdbfb9274b9cf11516628f2361536d02fee8`.
- SQL `39183067318` aprobado sobre `7c6a4034b9ef2059bb598ddd11c8fd8061225bcd`: todas las suites/carreras, incluidos 20 controles de registro, dos carreras de revocación de registro y auditoría de Equipo. **La variante posterior `FOR NO KEY UPDATE` del registro necesita la repetición del full actual.** Tipos oficiales reproducibles: SHA256 `497ee1245ed0f7c4ab1d1660caed3470e4ea1071cf869b9d496c1104698cfe1d`.
- Diagnóstico de navegador **`39206541967`**, fuente **`af5a2b630a7c4150a9f5a97da0caa1e64a550c90`**, digest `d91a1c31e09924d684b91ea188b7a99f03fb888a9864c4a00350032e292f3407`: **7 casos aprobados, 1 fallido en afterEach, 0 omitidos**. Matrices efectivamente recorridas: ficha 50 combinaciones; profesional 10; wizard 10; manual 10; público 20. No es full positivo ni cierre visual.
- La octava prueba también realizó alta/aceptación/perfil/horario de administrador, pero falló limpiando Auth: `SQLSTATE23503`. Faltaba eliminar el correo `e2e-admin-prof-*` creado por esa fixture; `allowed_emails.created_by/updated_by` conserva FK hacia el creador. En `09dec4e` se sustituyó el wildcard anterior por `IN` de los **dos correos sintéticos exactos** de la suite, antes de borrar las cuentas. No se alteró ninguna FK ni se ignoró el error. Full actual debe comprobar la reparación y ausencia de errores Auth/deadlocks.
- Evidencia del diagnóstico: `.verification/remote-39206541967/`, paquete SHA256 **`bb218fa3957dd7843035bb72b28d05a68ac860a17037f518907b27e92d14bfdc`**. Recibo/runId de integración **`2e2fb014-cabf-428a-b42e-81b0f49d1e59`**; plataforma con deadlocks 0 y el único error Auth de limpieza identificado.

### Qué encontró la inspección visual propia y qué quedó editado SIN VERIFICAR

Se abrió una ronda propia de **61 capturas**, todos los anchos del plan y estados representativos. Un intento de visualización `detail=low` fue rechazado por la herramienta; esas imágenes se volvieron a abrir con detalle admitido. La inspección real encontró defectos que la geometría de «no desbordar el documento» no detectaba:

1. **Historia clínica en 320/390:** el botón de detalles comparte una fila flexible con costo/Editar y puede comprimirse a una columna casi ilegible. El detalle completo queda debajo de una cabecera extremadamente alta. Se editó `apps/web/src/lib/components/patients/PatientHistoryPanel.svelte`: cabecera de entrada en grid de una columna, dos sólo desde `sm`, botón de detalle `w-full min-w-0`. **No probado después de editar.**
2. **Cabecera de paciente en 768 con nombre largo:** nombre y acciones compiten por el ancho; «Archivar paciente» y otras acciones quedan con letras casi verticales. En `apps/web/src/routes/odonto/pacientes/[id]/+page.svelte` se pasó a grid, columnas separadas recién en `xl`, acciones con wrap y sin encogerse, botón móvil de acciones `shrink-0`. Nombre completo y permisos preservados. **No probado.**
3. **Estado de profesional en escritorio:** nombre largo encoge el badge «Visible en reservas» hasta romperlo por letras. En `ProfessionalEditor.svelte`, el bloque del nombre ahora es `min-w-0 flex-1` y el de estado/guardar `shrink-0`. **No probado.**
4. **Wizard en 320:** progreso de seis pasos aprieta «Agregar integrante» hasta partir la palabra. En `TeamMemberWizard.svelte`, encabezado apila título y progreso en móvil; fila desde `sm`; progreso sin encoger. **No probado.**
5. **Capturas que no muestran su tarea:** manual muestra avisos/agenda por encima del selector; perfil de paciente muestra la cabecera larga; carga/error no deja ver el mensaje; formulario público muestra resúmenes anteriores y casi ningún campo. Son capturas inválidas para certificar esas tareas, aunque la interacción/DOM haya aprobado. **No enviarlas al revisor ni declarar aprobación visual.**

Se creó **`apps/web/e2e/helpers/task-capture.ts`**, exporta `alignTaskForCapture(anchor: Locator)`: desplaza la tarea debajo del header sticky/fixed y exige que esté en viewport. **Todavía no tiene consumidores ni verificación de tipos/navegador.** El trabajo se interrumpió inmediatamente después de escribir este helper y las cuatro correcciones visuales; no se llegaron a modificar los tres specs para usarlo.

### Siguiente trabajo concreto, sin reconstruir el plan

1. Releer el plan íntegro y contrastar este relevo/registro. Consultar full39207125504 y recuperar evidencia con el colector. Investigar primero cualquier fallo real; no atribuir suites no ejecutadas.
2. Completar la misma tanda visual ya identificada, sin abrir un rediseño nuevo. Conectar `alignTaskForCapture` en:
   - `apps/web/e2e/booking-embed.spec.ts`: selector manual anclado al h2 «Elegí un día»; perfil profesional al heading «Perfil»; horario al heading «Horarios de atención»; formulario público a `.patient-booking-summary` o al formulario real `.patient-booking-form`, para ver los campos y su orden. Se pueden agregar capturas de la región completa del formulario cuando sean necesarias, identificándolas como región y sin simular viewport.
   - `apps/web/e2e/patient-structure-ux.spec.ts`: historial anclado al botón de detalles; Datos al heading «Datos del paciente»; espera/error al mensaje correspondiente. Los dialogs ya capturan la tarea correcta. Conservar foco y las 50 combinaciones.
   - `apps/web/e2e/roles-agenda-regression.spec.ts`: alta anclada al encabezado/paso del wizard.
3. Añadir comprobaciones proporcionadas para los fallos reales: ancho legible del botón de detalles de historia (la ausencia de overflow no basta), acciones de cabecera sin altura de letras verticales, badge profesional no comprimido y heading de alta sin palabra partida por el progreso. No comparar sólo clases CSS ni debilitar las condiciones existentes.
4. Crear snapshot con la allowlist, empujar **sólo al auxiliar** y verificar secuencialmente. Puede usarse `level=browser` con `browser_grep=isolated booking integration|patient structure|roles, profesionales` para diagnóstico; no sustituye full. Los diagnósticos actuales usan `--max-failures=1`; si se quiere reunir fallos independientes, puede adaptarse sólo ese modo sin permitir que informe éxito con fallos. No ejecutar pruebas locales pesadas.
5. Recuperar las nuevas capturas, reemplazar el paquete de revisión con evidencia válida del código actual y completar la **segunda ronda propia** de confirmación de esta tanda. No reutilizar las imágenes actuales como si mostraran el código recién corregido. Si una puerta de implementación/captura sigue abierta, resolverla; el límite de pulido no autoriza certificar una falla.
6. Ejecutar detector Impeccable **una sola vez** sobre los targets cambiados, después de inspección válida. **Todavía NO se ejecutó**; sólo se consultó `detect --help`. Abrir revisión fresca `impeccable_finish_reviewer` sin historial (`fork_turns: none`), con todos los anchos/capturas requeridos, dirección, PRODUCT/DESIGN/craft-floor, hallazgos y alcance. No leer definiciones de agentes ni usar agentes anteriores con contexto heredado. Después, documenter fresco con frontera de escritura documental. **Ninguno de ambos se ejecutó para este cierre.**
7. Full final positivo de la revisión exacta, incluyendo todas las suites SQL/carreras, 35 casos locales de navegador previstos, demo y medición de Natalia. Confirmar los recuentos efectivos, cero omitidos/retries y diagnósticos de plataforma. La medición de Natalia aún no tenía resultado positivo cuando se pidió el relevo; revisar si full39207125504 llegó a ella.
8. Actualizar matriz de aceptación punto por punto, mapa, informe UI, registro, manifiesto y este traspaso. Sólo entonces avisar inmediatamente «fase5 terminada» y **continuar con la fase 6** (alcance vigente arriba; la detención antes de 6 quedó reemplazada). No anunciar campaña terminada ni ausencia total de deuda.

### Capturas y diagnósticos que recibe el siguiente agente

- Dirección: `.impeccable/review/structure-20261018/direction.md`. Revisión Operate que preserva el sistema existente, sin comp ni identidad nueva.
- 61 originales copiados sin editar a `.impeccable/review/structure-20261018/`, manifiesto `captures.json`; copia versionable **`docs/architecture/etapa5-capturas.json`** con SHA/dimensiones/ruta del archivo dentro del paquete remoto. **Ronda1, hallazgos abiertos, NO listo para review.** Incluye dos alias desktop/mobile que provienen del harness iframe histórico: sustituirlos por capturas nativas pertinentes antes de presentar el paquete como revisión de la reserva nativa.
- Los árboles de aplicación/SQL de af5a2b6 y09dec4e eran idénticos al seleccionar las capturas; se verificó con diff **entre los dos commits de snapshot**. Las correcciones visuales posteriores hacen que ya no representen el árbol de trabajo actual.
- **Cuidado con Git y los archivos nuevos:** muchos archivos de la campaña siguen sin seguimiento en el índice real. `git diff <snapshot> -- ...` contra el árbol de trabajo puede presentarlos falsamente como eliminados aunque existan. Comparar el manifiesto de `.verification/ci-source.json` y los blobs mediante `git hash-object --stdin-paths`, o crear snapshot aislado. Nunca restaurar/borrar archivos para «corregir» ese falso diff. No se borraron esos archivos.
- Observador `apps/web/e2e/helpers/render-health.ts`: conserva categorías/paths sin valores ni URLs/query. Realtime no corre en fixture; acepta sólo handshake404 contra el origen loopback exacto y en `disposable`. Último diagnóstico: manual3, profesional15, ficha51 y wizard2 mensajes de esa categoría; público0. Ficha exactamente un HTTP500 inyectado en GET `/datos`; ningún otro fallo de red/HTTP ni mensaje desconocido. Esto no prueba transporte Realtime alojado.
- Los dos conflictos de profesional son sobres **HTTP200 / ActionResult failure / status409**, comprobados en las acciones concretas `update_service` y `save_all` con readback SQL. No volver a esperar HTTP409 ni crear excepciones globales 4xx para hacer pasar el observador. Esta precisión se verificó contra el código primario fijado de SvelteKit.
- Aranceles ya corrigió el main anidado: región principal en layout, sección interior rotulada. Native sources `.ux-native-source` son campos invisibles de1px con aria-hidden/tabindex-1; geometría mide `.ux-control-trigger` visible, no el auxiliar. No cambiar el control personalizado para arreglar un falso positivo del arnés.

El relevo inmediato modifica el momento de entrega, **no reduce ninguna garantía ni criterio de cierre**. Se conservaron todos los cambios y no se desplegó, migró ni renombró producción.

## Autoridad, orden de lectura y conservación

1. Leer íntegro `docs/plans/refactorizacion-cita-suite.md`, incluidos instrucción literal de ejecución, continuidad, identidad y autorización de producción. Es la fuente normativa; prevalece sobre este traspaso, resúmenes de contexto y memorias.
2. Leer `AGENTS.md`, `docs/plans/registro-refactorizacion-cita-suite.md` y las matrices `docs/architecture/evidencia-etapa{3,4,5}-*.md`. Contrastar cada cierre con su revisión, corrida y alcance.
3. Leer `docs/architecture/areas-y-fronteras.md`, `functional-contracts.md`, `guia-nuevas-funciones.md`, `identidad-cita-suite.md`, `verificacion.md`, `contabilidad-documentos.md` y `disponibilidad-y-aranceles.md`.
4. Después de cada compactación y antes de cada etapa, repetir lectura del plan original completo y contraste con registro/evidencias. Nunca reconstruir requisitos de memoria ni modificar el plan para amoldarlo a trabajo incompleto.
5. Registrar separadamente cambios, pruebas, resultado, decisiones, bloqueos y pendientes. Una corrida posterior fallida no convierte sus suites no ejecutadas en aprobadas; tampoco borra la evidencia acotada de una corrida anterior.

## Espacio de trabajo y destinos

- Carpeta actual: `/home/usuario/CascadeProjects/Base de Datos Sabrina`. No moverla durante esta sesión: hay consumidores y referencias absolutas activos. La transición segura a `Cita Suite` está preparada en el inventario de identidad.
- Rama aislada: `refactor/maintainability-20261015`. HEAD conservado `80268e2a501198243996e1bdb0048ce066434727`. Hay numerosos cambios previos y archivos nuevos preservados; el snapshot de verificación no es un commit global del árbol ni autoriza limpiar archivos.
- No ejecutar `git reset --hard`, `git clean`, restauraciones globales ni `git add -A`. No incorporar secretos, `.env`, trazas clínicas ni recursos ajenos.
- Repositorio principal actual: `Juan4787/dashboard`; su rama principal está conectada al despliegue automático. **No empujar allí para obtener CI.** Nombre objetivo `Juan4787/cita-suite`, sujeto a volver a comprobar disponibilidad y consumidores en release.
- CI aislado: `Juan4787/cita-suite-verificacion`, rama `refactor/maintainability-20261015`, workflow numérico `386107045`. Es el único destino usado para snapshots de esta fase.
- Supabase producción: ref `yjzferwuzbtgpmdnzlcb`, nombre visible comprobado `Odontologia`, región `sa-east-1`. Staging: ref `ikaudqoilclfnztkxubz`, nombre visible aportado/comprobado `Staging 455`, región `us-west-2`. Renombrar sólo etiquetas del recurso correcto cuando corresponda, preservando refs/datos/URLs/claves/buckets.
- Cloudflare cuenta esperada `52b358653379c162b5a07b10ae5e84b3`; Worker `app`, origen estable `https://app.cita-suite.workers.dev`. **Workers Free**, confirmado por usuario; no contratar ni cambiar planes. El identificador del Worker y su URL no se cambian por uniformar una etiqueta.
- Natalia origen estable `https://natalia-frutos.vercel.app`. Mantener navegación al turnero real; no duplicar reglas en otra aplicación ni reintroducir iframe como recorrido principal para push.
- Credenciales: utilizar la configuración privada existente y comprobar sólo presencia/alcance. No copiar sus valores aquí, al chat, a snapshots, logs ni nuevos repositorios. Ninguna contraseña debe pedirse o publicarse para continuar.

## RAM y disciplina de pruebas

La máquina se satura con facilidad. Las restricciones sobreviven a cualquier permiso de autonomía/producción.

- No ejecutar builds, navegadores, bases, cargas ni múltiples procesos pesados en esta máquina. Los contenedores activos de otro producto no pertenecen a esta campaña: no detenerlos ni limpiarlos.
- CI ejecuta suites, compilaciones, PostgreSQL/Auth/Storage y navegador secuencialmente. Vitest/Playwright un trabajador, sin paralelismo entre archivos. Las carreras SQL son dos conexiones controladas dentro de una prueba.
- No aumentar conexiones/recursos para ocultar errores de bloqueo. PostgreSQL descartable se usa con el presupuesto configurado; el contador real de deadlocks debe seguir en cero. Las advertencias de SvelteKit DEV no prueban un fetch de componente ni justifican silenciar el framework.
- Mantener una corrida activa y, como máximo, una pendiente. No reemplazar pendientes sin registrar que quedaron canceladas. Las pruebas locales permitidas deben ser realmente livianas y secuenciales.

### Ciclo reproducible de snapshot y CI

Ejecutar cada comando sólo si el anterior terminó con salida cero; `exec_command` devuelve errores de salida sin lanzar necesariamente una excepción.

```bash
node --max-old-space-size=192 scripts/prepare-ci-snapshot.mjs
git push github-secundaria:Juan4787/cita-suite-verificacion.git refs/verification/maintainability-20261015:refs/heads/refactor/maintainability-20261015
gh workflow run 386107045 --repo Juan4787/cita-suite-verificacion --ref refactor/maintainability-20261015 -f level=full
```

La preparación usa índice aislado, conserva HEAD/índice de usuario y publica commit/tree/digest exactos. Incluye nuevas entradas mediante allowlist explícita; si se añade un script invocado por verificación, comprobar que el snapshot lo contiene. No deducirlo de `git diff` cuando el archivo sigue sin seguimiento. El manifiesto local está en `.verification/ci-source.json`; la ref Git de verificación conserva el árbol exacto y el auxiliar permite recuperarlo. El HEAD de la rama de trabajo no identifica por sí solo el código probado de su árbol sucio.

Niveles `fast`, `full`, `sql`, `types` (y diagnóstico separado `browser` con `browser_grep`): los dos últimos reconstruyen la base y recuperan tipos oficiales; `sql` además ejecuta todas las suites/carreras descubiertas. `verify:release` tiene puertas adicionales de artefactos/staging, no equivale a `full` ni se satisface llamándolo sobre producción.

### Recuperar evidencia sin perder binarios

```bash
gh api repos/Juan4787/cita-suite-verificacion/actions/runs/ID/logs > .verification/remote-ID-logs.zip
python3 scripts/collect-verification-evidence.py .verification/remote-ID-logs.zip .verification/remote-ID
```

El destino debe ser nuevo. El colector valida SHA256, límites, rutas y binarios. Evidencia de cada corrida está también en su log público; no imprimir bloques base64. Usar `rg --hidden --no-ignore` para buscar dentro de `.verification`. Analizar primero el primer fallo real, no los errores secundarios de las suites siguientes. Recibos JSON, SQL, tipos generados, resultados Playwright y capturas son pruebas distintas.

## Qué se hizo y qué conserva cada área

El detalle cronológico está en el registro. Esta sección explica responsabilidades y riesgos para quien amplíe el producto.

### Acceso

Contexto común por petición `server/access/public/odonto-context.ts`: identidad validada, consultorio, membresía y capacidades; sin caché global de permisos. `team-access.ts` usa RPC autenticados y valida listas completas y resultados de acceso en ejecución. Una fila inválida no desaparece silenciosamente del conteo de dueños. No escanea el directorio de Auth con una clave administrativa para simular una operación transaccional.

La firma de `upsert_business_role_access` se conserva; SQL mantiene el cambio de rol/invitación/perfil en transacción. Dueños/administradores atendibles conservan su perfil; el control del último dueño conserva el criterio canónico. Invitaciones no tienen SELECT directo por RLS: la lectura autenticada autorizada es `list_business_role_access`; no abrir esa tabla para corregir una prueba mal planteada.

### Equipo

Editor individual: coordinador de borrador/guardado en `ProfessionalEditor.svelte`, perfil, servicios, horario y ciclo de vida separados por tarea. Contratos/copias/sanitización en `lib/team/professional-editor.ts`; normalización y payload horario en `professional-form.ts`. Reconocer el guardado usa la fotografía enviada, conservando cambios posteriores. La revisión optimista pertenece a esa base: una invalidación sólo la renueva si la proyección persistida aún coincide en perfil, asignaciones y horarios canónicos. No enviar automáticamente el token nuevo de una base distinta con un borrador antiguo. Las franjas restringidas sin prestaciones quedan cerradas.

Servicios: creación+asignación en una transacción autenticada; edición conserva token y campos de apertura aunque llegue invalidación de datos remotos. Un resultado incierto no se reintenta como si fuera una creación fallida segura. Conteos de dependencias son informativos: la eliminación vuelve a verificar permisos e historial en SQL. El conteo incluye cita principal y equipo sin duplicar.

Eliminación: autoridad bloqueada, dependencias revalidadas y limpieza atómica; conflicto inmediato ante bloqueos incompatibles evita invertir el orden con FKs. El autor clínico nuevo toma bloqueo real sobre su profesional; la historia existente se conserva en actualizaciones ajenas a autoría.

Alta desde Equipo: `member-profile.ts` prepara/valida y delega a `create_team_member_profile` o `make_team_member_attending`. SQL guarda perfil, defaults reales, servicios, horarios, excepción opcional, vínculo/invitación y auditoría juntos. No hay rollback HTTP administrativo ni éxito parcial cuando fallan los defaults. La invitación pendiente mantiene el perfil oculto hasta registro.

`TeamMemberWizard.svelte` es dueño de pasos, borrador, errores y envío; listado de accesos permanece en su coordinador. El componente se identifica por consultorio/actor y descarta respuestas posteriores a desmontaje. Los controles JS esperan inicialización. El editor conserva la lista administrativa acotada de80 excepciones ordenada por inicio descendente; no usarla como fuente de disponibilidad ni suponer que es el historial completo. El contrato SQL de disponibilidad obtiene su ventana completa independientemente de esa lista. La auditoría transversal de paginación/listados del plan conserva su alcance propio. Las mutaciones alternativas sin consumidores y el fallback de borrado/reinserción horario se retiraron; no restaurarlos para compatibilidad silenciosa.

### Pacientes y clínica

Proyección, ficha, historia, edición clínica, archivo y documentos tienen operaciones públicas con permisos explícitos. Los retornos JSON se validan, errores secundarios de lecturas no se convierten en falsos vacíos y los costos históricos conservan decimales existentes cuando corresponde (no confundirlos con aranceles cotizados en pesos enteros).

Fecha clínica nueva respeta zona del consultorio; RPC compatible anterior permanece. Archivo profesional afecta su vínculo, no el archivo global ni el de un colega. Dueño/admin conservan alcance global. Las carreras prueban revocación de rol, vínculo, asignación, asistencia y pausa comercial.

Alta manual: `patient-registration.ts` y `register_patient_safely` guardan ficha+vínculo en transacción autenticada. DNI duplicado recupera identidad existente sin sobrescribir sus datos; nombre y teléfono repetidos siguen siendo válidos. Restaurar vínculo elige sólo uno entre históricos inactivos. No usar un cliente administrativo después de una comprobación previa de permisos ni borrar una ficha como compensación por un resultado incierto.

### Agenda/reservas

Un calculador TS y ventanas SQL acotadas; precio confirmado por SQL y preview exacto por TS. Se conservan intervalos base/márgenes/descansos, idempotencia, exclusión y aceptación de cotización actualizada. La UI manual y pública reutiliza esas reglas; marca y tema son sólo presentación. Cita Suite conserva su diseño oscuro único (también ante preferencia clara del navegador); Natalia tiene dos modos reales. No habilitar un tema privado inexistente manipulando clases en el arnés ni llamarlo cobertura de una función implementada. Cada etapa tiene su evidencia propia de paridad/carreras.

### Sitios

Configuración profesional/servicios/horarios sigue en Equipo, no se replica en conexión del sitio. Integración mantiene orígenes y retorno validados, navegación nativa, tokens/rutas existentes y mismo origen para gestión/push. El formulario final mantiene obligatorios antes de opcionales. Natalia no almacena una copia del motor ni convierte una confirmación visual en prueba de persistencia.

### Integraciones

Los módulos están clasificados con fronteras, pero **la separación y presupuesto de tareas de fase 6 no se consideran hechos**. Mantener push/calendario/reseñas/limpieza existentes hasta transición verificada. No activar programadores nuevos ni duplicar cron como efecto secundario de publicar una refactorización parcial.

## SQL nuevo y transición

Las migraciones aplicadas históricamente no se editan. Las nuevas de esta campaña están en la rama/snapshots y deben aplicarse en orden después de reconstrucción, respaldo/recuperación, staging y auditoría de release. No ejecutar un `db push` al destino vinculado por comodidad.

En el último lote de etapa 5:

| Migración | Responsabilidad |
|---|---|
| `20261018010000_clinical_entry_date_edit.sql` | Fecha de consulta compatible. |
| `20261018020000_patient_archive_actor_scope.sql` | Autoridad vigente y archivo global/personal. |
| `20261018030000_team_editor_atomic_commands.sql` | Servicios, dependencias, eliminación y autoría clínica concurrente. |
| `20261018040000_team_access_transactions.sql` | RPC canónico de acceso compatible y perfiles atendibles. |
| `20261018050000_team_profile_onboarding.sql` | Alta completa y perfil atendible atómicos. |
| `20261018060000_patient_registration_transaction.sql` | Registro manual de paciente y vínculo atómico. |

Esta tabla no sustituye el manifiesto completo: obtener todos los archivos pendientes, su orden y hashes al preparar la entrega. Tipos en `packages/shared/src/database.types.ts` provienen del generador fijado sobre todas las migraciones, con doble generación reproducible; nunca añadir firmas a mano para poner verde TypeScript.

## Identidad: aplicado, ensayado y preparado

- Aplicado en código: producto `Cita Suite`, raíz `cita-suite`, workspace `@cita-suite/shared`, filtros/imports/lockfile coherentes, configuración local y variable `CITA_SUITE_OWNER_EMAIL` con alias compatible histórico.
- Ensayado realmente: renombrado/reversión de repositorio sintético, conservación de ID/SHA/permisos/default branch, Git nativo y tres Actions sobre mismo SHA. Evidencia `docs/architecture/identidad-ensayo-github.json`. Recurso quedó con nombre original, archivado y Actions deshabilitado.
- Preparado: transición exacta del principal/remotos/proveedores, nombres visibles Supabase, hosting y directorio, con inventario/excepciones/reversión. Ver `identidad-cita-suite.md`.
- No aplicado en esta fase: nombres de producción, dominios, project refs, claves, vinculaciones de proveedores ni movimiento de carpeta. La redirección GitHub no sustituye actualizar consumidores. No afirmar que Apps externas no existen sólo porque webhooks/rulesets listados estén vacíos.

## Evidencia y limitaciones de entorno

Consultar el recibo final de etapa 5 y el registro para la revisión exacta aceptada. Referencias parciales verificadas: full39137667238 (ficha/fecha/costo), SQL39138864309 (archivo y carreras), fast39160133360 (editor160 cliente), SQL39161858092 (Equipo/accesos/alta y carreras), SQL39162608709 (registro de paciente18 controles), SQL39183067318 (20 controles, conservación de auditoría y dos carreras propias de registro). Ninguna certifica cambios hechos después de su snapshot.

Toda la evidencia SQL de CI usa PostgreSQL real descartable con claims sintéticos; las suites E2E usan GoTrue/PostgREST/Storage reales descartables. Intercepciones de red prueban presentación/recuperación, no una caída real del proveedor. `full` no acredita capacidad alojada, despliegue en Cloudflare/Vercel ni entrega real con OAuth externo. Las dos suites OAuth preexistentes tienen requisitos de cuentas/proveedores y se deben tratar expresamente en release/auditoría, sin contarlas como aprobadas por CI.

La comparación de Natalia construye baseline `c0129e492051a38d5b8025158fb996a81da0e871` y candidato con herramientas/dependencias fijadas; mide doce cargas frías (390/1280, tres por variante), JS comprimido/decodificado/transferido e indicadores de islas/eventos. Si no hay hidratación Astro, duración no aplicable: no inventar 0ms ni confundirlo con CPU de JS nativo. El contacto/catálogo usados para medir son sintéticos loopback.

## Continuidad después del cierre de fase 5

### Etapa 6: tareas automáticas

Releer su texto original antes de comenzar. Separar disparador Worker pequeño con Service Binding, sin reglas ni credenciales de Supabase/proveedores; trabajo en aplicación. Cada evento ejecuta una categoría y espera resultado. Programaciones UTC: push `*/5 * * * *`; calendario `1-59/5 * * * *`; reseñas `2-59/10 * * * *`; limpieza `3-59/15 * * * *`; mantenimiento `17 */3 * * *`. Mantenimiento alterna conciliación comercial y almacenamiento, cada una cada seis horas. Verificar capacidad efectiva de cinco disparadores en la cuenta/plan actual antes de activar; respetar propagación.

Medir cadena completa: perfil Free hasta40 llamadas externas, hasta4 simultáneas,20s totales con margen, CPU/memoria/conexiones de plataforma comprobadas. Perfil Paid hasta300 no autoriza contratar. Derivar lote del peor costo por elemento, incluyendo Auth, SDK, envíos, resultados, redirecciones y retries; un Service Binding no concede mágicamente otro presupuesto.

Reutilizar estados/reclamaciones existentes: vencimientos, reparto por consultorio, contexto/escrituras agrupadas seguras, revalidación cancelación/reprogramación antes de proveedor, respuesta perdida/resultado incierto, espera persistente e identificadores estables para deduplicar cuando sea posible. No prometer exactamente una entrega si el proveedor no la garantiza. El entrypoint viejo no puede seguir procesando categorías duplicadas.

Cierre con recuperación y comienzo de trabajo ordinario dentro de10min con proveedor sano/volumen acordado. Si Free no alcanza, medir y exponer el recurso necesario; no rebajar criterio ni contratar automáticamente.

### Capacidad y regresión transversal

Dos escenarios deterministas, no estados inventados:5 consultorios/30.000 pacientes/60.000 turnos y25/150.000/300.000, doce meses. Cada uno2min preparación+10min medición, tres repeticiones secuenciales; un usuario concurrente por consultorio,80% lecturas/20% escrituras internas, pausas3–8s. Runner externo, nunca esta máquina.

Reserva pública separada: recorrido Natalia y enlace; lecturas bajo límites; escrituras un único generador cada4min, teléfonos ficticios distintos; abuso espera rechazo. No desactivar límite IP global ni falsificar encabezados/IP. Medir lecturas p95<1s/p99<2s; escrituras p95<1,5s/p99<3s; errores inesperados<1%; cero cruces/doble reserva/cuotas; disponibilidad completa o error, nunca parcial silencioso.

Colas:5 pendientes por consultorio y escenario desigual con uno muy grande; antigüedad por consultorio además de total. Planes/índices/bloqueos/crecimiento de consultas con datos representativos; un seq scan no es un defecto sin contexto. No extrapolar contenedor a Supabase alojado. Observabilidad debe distinguir HTTP a base, proveedor y SQL: un contador de fetch no es número de queries SQL.

### Release, producción y auditoría final

Producción/pruebas masivas autorizadas por ampliación literal del17 de octubre; no volver a pedir ese permiso ni omitir puertas previas. No hay autorización de compras. Preparar manifiesto exacto de revisión, hashes, destinos y migraciones; ensayar respaldo/restauración aislados y reversión compatible; migraciones compatibles y aplicaciones/programador en staging; auditoría de artefactos y hosting.

Sólo después del conjunto aprobado, detener programador anterior, esperar activos, publicar migraciones/apps, activar nuevo, verificar eventos reales y versión servida, permisos, reserva, almacenamiento y tareas. Reversión detiene nuevo programador antes de restaurar versión compatible/programador anterior; no restauración destructiva que pierda escrituras nuevas.

Auditoría final punto por punto del plan, no una etiqueta general: rutas alternativas que eviten autoridad/cuota/capacidad, clientes/JSON/casts, duplicación/ciclos/imports, paginación/truncamiento/falso vacío, alta de consultorio sin configuración faltante, recorridos cruzados en artefactos y cambio de cuota/recursos sin perder datos/permisos/pendientes. Corregir y repetir fallos antes de cierre; no ocultar deuda en un comentario de trabajo futuro.

## Fuera del alcance actual

Cursos y noticias de Natalia continúan intactos y pospuestos. No abrir su implementación en esta campaña. Notificaciones de WhatsApp descartadas; no reintroducirlas en tareas ni pendientes. PDF y documentos sí tienen el alcance autorizado posterior y garantías de etapa3; no confundir con la postergación histórica anterior.

## Entrega requerida al usuario

Notificar fase5 en cuanto cierre realmente; identificar revisión/evidencia y documentación, y continuar sin detenerse con la fase 6 y las etapas restantes (alcance vigente del 19 de octubre). Quien continúe debe completar toda la campaña restante antes de presentarla como finalizada. Nunca asegurar “cero deuda” o “todo auditado” por un full positivo parcial, una captura o una migración no aplicada.
