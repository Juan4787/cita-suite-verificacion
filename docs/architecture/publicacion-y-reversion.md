# Publicación y reversión

## Continuación vigente — 28 de octubre, 05:10 UTC

**Publicada y verificada el 28 de octubre, 03:55–05:06 UTC** (autorización expresa del usuario; recibos en `.verification/publicacion-agenda-20261028/`, detalle en el registro):

- Aplicación `aacba5b10ff6030ac061e20ce0cccdf28126c180` (horas de la agenda y del detalle del turno en la zona del consultorio; hora de la tarjeta sin partirse en celulares). Instalada como `a18e6001-84a5-4502-ba12-57c686291197`; dos mediciones limpias de `verify-production-release.mjs` (131 archivos de cliente). **Versión vigente `4e29aba6-8039-4340-8869-5e0b77bda328`**: la misma aplicación sin el secreto `GOOGLE_CALENDAR_REDIRECT_URI` (32 enlaces). La creó `wrangler secret delete` y no tiene mensaje («Secret Change»): la lectura posterior compara el mensaje de versión y lo marca como diferente; la revisión servida en las dos direcciones es `aacba5b`.
- Calendar pide el retorno del subdominio (ver [dominio](dominio.md), punto 6).
- Programador **`ba7b746d-7d86-4016-91aa-dfbea35ba464`** con los cinco cron (mismo código del programador que `95b2596`). Eventos reales desde las 04:42 UTC (unos 6 minutos de propagación): push, calendario, reseñas y cargas, 15 eventos `ok` sin excepciones hasta las 05:06; mantenimiento (`17 */3`) observado a las 06:17:28 UTC, `ok` sin excepciones, también de `ba7b746d`.
- Copia previa `40629440330` certificada y descargada de Drive (105 tablas, 4152 filas, 24 adjuntos).
- **Recuperación vigente:** detener primero el programador (`node scripts/deploy-production-workers.mjs scheduler-without-crons`) y después `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 8b41ec56-5df3-4050-94f2-8b0f40347365 --name app --message "<motivo>" --yes` (`95b2596`). Ensayada a las 04:20 UTC: sirve `95b2596`, recupera su secreto de Calendar (workers.dev) y sus 33 enlaces; lectura aprobada. Regreso nativo a `4e29aba6` a las 04:34.
- El límite de ingresos de la cuenta de prueba (abajo) se respetó separando las lecturas: 04:18, 04:20, 04:33:49 y 04:35:27.

## Continuación anterior — 27 de octubre, 15:00 UTC (antecedente)

**Direcciones (desde la entrega de origen, 27 de octubre, 14:19 UTC):**

- La aplicación se sirve en `app.cita-suite.com.ar` y en `app.cita-suite.workers.dev`.
- `cita-suite.com.ar` es la landing, servida por Vercel por decisión del usuario.
- `PUBLIC_SITE_URL` y `PRODUCTION_APP_ORIGIN` son `https://app.cita-suite.com.ar`. `PUBLIC_SITE_URL_FALLBACK`, Natalia y el retorno de Calendar (secreto `GOOGLE_CALENDAR_REDIRECT_URI`) siguen en workers.dev. Las verificaciones comprueban las dos direcciones.
- Por HTTP, workers.dev responde 308 a HTTPS desde la propia aplicación; el subdominio, 301 desde el borde de Cloudflare.

**Publicada y verificada el 27 de octubre, 14:03–14:57 UTC** (autorización expresa del usuario; recibos en `.verification/dominio-landing-20261027/`, detalle en el registro):

- Aplicación `95b2596a9b4f24d8ae50d78a94e3f1c9f95b811a`, versión **`8b41ec56-5df3-4050-94f2-8b0f40347365`**, servida en las dos direcciones; 130 archivos de cliente exactos, CSP sólo del proyecto propio, 0 de 70 relaciones expuestas, 33 enlaces idénticos.
- Programador **`cae02746-2b69-4481-b9b6-d6441b512f10`** con los cinco cron. Eventos reales observados entre las 14:50:33 y las 15:21:11 UTC: los cinco tipos (push, calendario, reseñas, cargas y mantenimiento), 20 eventos, todos `ok`, sin excepciones y sin huecos. El primero llegó 10 min 42 s después de instalar, dentro de la propagación de hasta 15 minutos que documenta Cloudflare: una primera ventana de observación vacía no indica una falla.
- Copia previa `40516167872`, certificada y descargada de Drive.
- **Recuperación vigente:** `NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback d0ac2bcf-7e6a-4786-b2fb-5ff14687d643 --name app --message "<motivo>" --yes` (compatible `b108c19`), ensayada el 27-oct a las 14:22 UTC con verificación y lectura aprobadas. Primero se detiene el programador (`deploy-production-workers.mjs scheduler-without-crons`). Con `b108c19`, workers.dev vuelve a aceptar HTTP sin redirigir.
- **Límite de ingreso de la cuenta de prueba:** la aplicación admite 5 ingresos por correo en una ventana móvil de 15 minutos (`login_password_by_email`), y cada lectura posterior (`production-readback.mjs`) ingresa dos veces, una por dirección. No hacer más de dos lecturas posteriores en 15 minutos; la tercera falla con `CONFIGURED_TEST_LOGIN_FAILED` sin que haya una regresión (pasó el 27-oct a las 14:24 UTC).

Topología, procedimientos y reversión de dominios: [dominio](dominio.md). Las publicaciones de la app no tocan dominios (`wrangler.jsonc` no declara `routes`). No agregarlas: `wrangler deploy` reemplaza el conjunto de dominios del Worker y, sin terminal interactiva, reasigna dominios de otros Workers y pisa registros DNS en conflicto (comprobado en el código de wrangler 4.86.0).

**Antecedente, publicada y verificada el 27-oct a las 03:11 UTC:** producción servía `b108c1912e2c3bc57403b006bcf33b71cdb91c23`, versión `d0ac2bcf-7e6a-4786-b2fb-5ff14687d643`. Programador `f105c4ff-160b-4e00-8b5d-14deb9f33b84` con cinco cron y eventos reales observados. La secuencia ejecutada y sus recibos están en el registro y en [el traspaso del panel](../plans/traspaso-apertura-panel-20261026.md). Recuperación: `wrangler rollback e3af637d-a115-4f06-a89a-ba64583f5e9c --name app` (compatible `dbd69d2`, con la corrección de recuperación), con las verificaciones de este documento. El acceso local a la base exige que esta máquina no salga por ProtonVPN (el pooler de sesión no responde por esa ruta). El subdominio `app.cita-suite.com.ar` sirve el mismo Worker. El cambio de `PUBLIC_SITE_URL` es una entrega propia: el usuario ya agregó los retornos de Supabase y Google, comprobados el 27-oct.

## Antecedente — recuperación, 26 de octubre, 17:59 UTC

Leer el [traspaso exacto](../plans/traspaso-recuperacion-sin-dominio-20261026.md) antes de ejecutar comandos: candidataad5ac57/artefacto40369186753 y compatible375e16a/artefacto40369909691. Reversión de staging aprobada; auditoría completa40373057375 todavía en curso. **No hubo publicación productiva de esta corrección.** El preflight falló en la primera lectura de base; causa no establecida y control pendiente. Metadata productiva revalidada:0851,versión70f0cdc0,33 bindings y cinco cron activos. No se detuvo el programador.

Los procedimientos y versiones inferiores describen entregas anteriores: no ejecutar scripts con SHA fijos ni usar la candidata de staging como versión de producción. La futura entrega requiere release aprobado, lectura de base/Auth/agenda, respaldo actual comprobado, drenaje/reversión y verificación de esta revisión. SMTP sigue sin configurar. El alcance del25-oct es un consultorio, con desviación de latencia aceptada sólo por el usuario; quedan prohibidos más ensayos de dos consultorios en Free. No se contrató nada ni cambió el plan.

## Antecedentes de publicación

Procedimiento del [plan íntegro](../plans/refactorizacion-cita-suite.md). Actualizado el 24 de octubre de 2026 después del ensayo de las13:15 UTC. La [auditoría](auditoria-final.md), el [registro](../plans/registro-refactorizacion-cita-suite.md) y el [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) distinguen preparación, ejecución y resultado.

La autorización del 17 de octubre permite publicación y ensayos sintéticos en producción. La decisión del 20 exige demostrar el lanzamiento de dos consultorios en infraestructura gratuita; no autoriza contratar. **Publicar para verificar no habilita abrir a clientes reales.** La instrucción del 24 permite controlar el Samsung y continuar sin preguntas intermedias; las dependencias externas se informan al final.

## Estado y revisiones del 24 y 25 de octubre (antecedente)

Esta sección se tituló «vigentes» hasta el 27 de octubre. Ya no lo es: la aplicación, el programador y la copia actuales están en «Continuación vigente», al principio de este documento. Lo que sigue conserva el estado de su fecha.

Comprobación del 24 de octubre, posterior al ensayo de las 13:15 UTC. Las cargas40078561771 y40099997857 fallaron latencia e impiden aprobar el lanzamiento. Cierre25-oct01:40UTC:130app/35Natalia/70relaciones públicos comprobados; Vercel conserva su despliegue. La sesión administrativaCFactual no ve la cuenta destino y devuelve403/10000; las versiones y cron de la tabla son la última metadata aprobada24-oct13:36, no una relectura25-oct. Restaurar acceso y comprobar antes de cualquier mutación; no desplegar por ese403.

| Recurso | Estado comprobado |
|---|---|
| Aplicación | Fuente `0851de59ed7971debe2514e6d6851d142bbc5766`, versión `70f0cdc0-c2fd-4b7d-93e6-d6a68e2529be`. Artefacto40095722950:216 archivos exactos;130 de cliente,35 de Natalia,70 relaciones sin exposición y33 bindings preservados. |
| Release |40096001763 aprobado:20/20 controles y44/44 casos en cada perfil de desarrollo, candidata y recuperación. Run475e7921-b8c2-47b6-b5a1-7f0ff11fd06b;681 evidencias, paquete SHA2569d5dfe3193f9547f48c6ed8a2c5287c7e77baaa1c06cfcb3f1ba8bd296e233bb. |
| Recuperación compatible | Fuente `83278ad47f15b0af4e08e328fb88548910c198b0`, versión `2b9609ae-31d5-4956-8003-01389e3ab316`, artefacto40095847239. Instalada y verificada en producción, con retorno nativo a70f0cdc0. Las tres comprobaciones conservaron hashes, permisos, agenda autenticada y datos; Samsung:0 activaciones para turno vencido y0 errores. Recibo `inactive-push-production-recovery-20261024.json`. |
| Base |126 migraciones; entrada heredada deshabilitada. No hubo nuevas migraciones ni cambios de secretos durante este arreglo. Los baseline antiguos CB/5ee conservan el intento de activar avisos inactivos; no son la recuperación vigente. |
| Programadores | Producción:94bed118-58f7-4608-b543-202812184fda, cinco cron restituidos. Staging permanece sin cron. Código de tareas idéntico al ya probado; no atribuir al cambio de interfaz otra medición de capacidad. |
| Respaldo | Carpeta privada `production-2026-10-24T12-57-28-335Z`:105 tablas,3942 filas,5 dumps,24 objetos/11.599.541 bytes; hashes, conteos COPY y permisos700/600 verificados. Manifiestoe042313d02e9c02599f55962a96e7d5a582436f0f55a2ea7fab0c7ef50ebabdf. Este dump exacto no fue restaurado; el mecanismo tiene ensayo aislado previo. |
| Natalia | Vercel Git `dpl_6zBnr7E2FVg11SQ5mHiHv8rdPPKk`, main e3530ed:35 archivos coinciden con ambos artefactos nuevos. Samsungv3 aprobó navegación nativa, reserva persistida, recuperación sin duplicación, comprobante anterior y cancelación,0 errores. |
| Limpieza | Dos pacientes y turnos de Natalia retirados con guardas verificadas; dos consultorios/dueños propios de proveedores retirados. Vínculo histórico Calendar1/1 preservado. Pestaña y forward propios cerrados; otras pestañas y permiso conservados. |
| Lanzamiento | No aprobado:40078561771 y comparación40099997857 sin muestreador fallaron latencia. Limpieza de ambas completada, credenciales temporales retiradas. SMTP sin proveedor/remitente y dominio pendiente de compra. No contratar ni sustituir la falla con un verde funcional. |

Los ensayos y versiones anteriores se conservan en sus recibos. El resto del procedimiento explica los controles; no repetir una corrida exclusiva ya terminada. Para otra entrega, sustituir explícitamente revisiones, artefactos, backup y versión de recuperación por los de esa entrega.

## Destinos y precondiciones

| Recurso | Identificador estable |
|---|---|
| Cuenta Cloudflare |`52b358653379c162b5a07b10ae5e84b3`, planFree |
| App / programador | Worker `app`, servido en `app.cita-suite.com.ar` (dominio de Worker) y en `app.cita-suite.workers.dev`. Programador `cita-suite-scheduler`, con *binding* `APP`→`app` y los cinco cron del plan. Landing aparte: `cita-suite.com.ar`, en Vercel ([dominio](dominio.md)). |
| Producción Supabase |`yjzferwuzbtgpmdnzlcb`,sa-east-1; conservar API/Auth/Storage/refs, nombres visibles se tratan por separado |
| Staging |`cita-suite-staging`, `ikaudqoilclfnztkxubz`,us-west-2; programador de staging sin cron durante la observación productiva |
| Natalia Vercel |`natalia-frutos.vercel.app`, proyecto `prj_ddhAhez9VNro373XWSykLkhU5vBS`, equipo `team_CGSlkRXKKlw98jb3O2wSmcyt`,Hobby |
| Repositorios |Principal `Juan4787/cita-suite`,ID1115936156; auxiliar `Juan4787/cita-suite-verificacion`; Natalia `juan-altamira/web-natalia`,ID1416254094 |

Workers Builds de `app` y Git del Vercel viejo fueron desconectados según las capturas del usuario del23-oct; no pedirlos otra vez. El Worker sigue alojado. No reconectar builds que compilen una revisión distinta del paquete probado. Verificar destino, SHA, DB y credenciales por sus nombres/función; jamás copiar valores a logs o CI. Un solo Wrangler activo; no compartirlo con tail. Pruebas pesadas sólo en CI y secuenciales.

## Recuperación reparada y vuelta a candidata

Precondiciones actuales: release40096001763 exitoso y perfiles de candidata/recuperación44/44 aprobados, ambos paquetes íntegros, DB126/legacyoff, respaldo fresco verificado, mismas33formas de bindings y programadores0cron. Si cambia versión, HEAD, cuota, cuenta o configuración, detener la mutación y releer el estado real. No reintentar una operación porque falte su salida de terminal.

```bash
D=.verification/releases/0851de5
B=.verification/releases/83278ad
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs scheduler-without-crons
node scripts/backup-production.mjs
```

El ensayo completo ya aprobó para la corrida actual: no repetir ninguno de sus comandos sin una nueva necesidad. El respaldo se comprueba antes de usarlo: manifiesto/proyecto/migraciones, cinco hashes/tamaños, COPY por tabla, objetos descargados/tamaños y permisos. No publicar SQL ni objetos clínicos. Se conserva evidencia de qué respaldo exacto fue restaurado y cuál sólo se verificó.

Confirmar0cron en ambos programadores mediante la API soportada de Cloudflare y sus bindings correctos. La corrida actual usa la confirmación12:57:15.740UTC como inicio conservador: margen hasta13:12:35.740. Respeta15min de propagación más20s de plazo; no afirmar observación directa de ejecuciones en vuelo. Registrar consultas y resultados saneados.

```bash
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs app "$B"
node scripts/verify-production-release.mjs "$B"
```

Esperado: marcador83278ad,130archivos exactos, CSP sólo del proyecto propio,70relaciones sin exposición. Leer metadata y registrar nueva versión/deployment100%, mensajeSHA y33bindings con nombres/tipos idénticos. Comprobar auth negativa401 y válida410 contra la entrada heredada apagada; no despachar colas para probar autenticación. Iniciar sesión con la cuenta de prueba ya configurada CITA_SUITE_TEST (sin imprimir sus valores) y leer su agenda completa (nodos sin errores y consultorio correcto). Comparar conteos de datos propios antes/después. Esto complementa el perfil44/44 y retorno alojado; no los reemplaza.

Volver a la candidata conocida mediante la operación nativa:

```bash
NODE_OPTIONS=--max-old-space-size=192 pnpm --filter web exec wrangler rollback 70f0cdc0-c2fd-4b7d-93e6-d6a68e2529be --name app --message "Cita Suite native recovery return to verified 0851de5" --yes
node scripts/verify-production-release.mjs "$D"
NODE_OPTIONS=--max-old-space-size=192 node scripts/deploy-production-workers.mjs scheduler
```

Esperar convergencia del marcador con plazo acotado, guardando cada muestra; no rebajar hashes ni aceptar otra revisión. Repetir metadata33bindings/auth/agenda y confirmar DB126/legacyoff y conteos. Si rollback nativo no está disponible, restaurar los bytes exactos de D con `deploy-production-workers.mjs app "$D"`, sin recompilar, y repetir los controles. Un fallo conserva el recibo y exige inspección: no se sobrescribe ni se presenta como aprobado. Restaurar los5cron sólo con candidata y autenticación comprobadas. Confirmar staging0cron, producción5cron y eventos posteriores reales. El punto de recuperación vigente de83278ad es `2b9609ae-31d5-4956-8003-01389e3ab316`; antes de usarlo releer metadatos, bindings y compatibilidad de cualquier cambio posterior.

La corrida ejecutada `.verification/deploy-and-rehearse-inactive-push-20261024.mjs` agrupa estas guardas y deja `inactive-push-production-recovery-20261024.json`; antes de cualquier reintento leer ese recibo y la API. No cambia secretos, esquema ni tipos generados.

## Medir dos consultorios sin alterar el sistema durante la carga

La corrida40078561771 ya terminó con fallo de latencia y su limpieza se completó: no quedan sus consultorios/dueños ni el secreto temporal de Actions/local. Los comandos siguientes describen el procedimiento de una futura corrida expresamente preparada; no ejecutarlos sobre el estado actual sin nueva siembra y credencial temporal propia. La comparaciónúnica40099997857 también terminó con fallo y limpieza completa: no existe una tercera corrida pendiente. No repetir para buscar un verde. Mantener un único observador; el protocolo determina si habrá samplerSQL y su impacto. La reproducción sin él no demuestra causa exclusiva ni mide su contribución anterior.

1. Guardar `node scripts/production-capacity.mjs integrity` y `report` antes de la carga.
2. Iniciar un único tail saneado. Sólo si el protocolo justifica instrumentación adicional, ejecutar `node scripts/instance-sampler.mjs production 80 <etiqueta>`; la comparación40099997857 lo omitió expresamente. Observación ligera local, carga desdeCI. El observador combinado actual registra jobs y requests con el filtro permanente probado. No persistir eventos crudos, tokens, URLs firmadas ni texto de consultas activas.
3. Ejecutar `gh workflow run production-measurement.yml --repo Juan4787/cita-suite-verificacion --ref refactor/maintainability-20261015`. Son3repeticiones de2min de preparación+10min medidos y una fase pública igual, seguidas de pruebas de abuso. Identificar el runID exacto y el SHA servido de esa corrida. No desplegar, renombrar destinos o rotar claves durante la medición.
4. Recuperar `production-measure-<run>`, conservar estados fallidos, y comparar p95/p99/errores con el plan sin cambiar umbrales. Guardar report/integridad posteriores y sus horas reales. Certificar deltas sólo con marcadores válidos de reinicio de cada familia de estadísticas, incluido pg_stat_statements; dosnull o un marcador ausente significan desconocido. No inventar0deadlocks nuevos niatribuir la actividad intermedia a la carga.
5. Ejecutar `node scripts/attribute-pauses.mjs <samples.jsonl> <requests.jsonl>`. Los requests deben tener at numérico,wallTimeMs y ruta normalizada. Separar HTTP, proveedor, SQL y resultados de plataforma. No atribuir causalidad exclusiva por una correlación.

Lecturas p95<1s/p99<2s; escrituras p95<1,5s/p99<3s; errores<1%; ningún cruce/superposición/cuota violada. Un límite de plataforma impide abrir a clientes reales: informar evidencia y alternativas, no contratar ni transformar un200tolerado en cumplimiento de10msFree.

## Limpiar sólo el ensayo propio

```bash
node scripts/release-smoke.mjs production cleanup
node scripts/production-capacity.mjs cleanup
gh secret delete CITA_PRODUCTION_CAPACITY_SECRET --repo Juan4787/cita-suite-verificacion
rm ~/.config/cita-suite/production/capacity-secret
```

La limpieza de la corrida actual ya está completada; no repetir esos comandos ni recrear un secreto sólo para ejecutarlos. Para una corrida futura, humo primero: capacidad rechaza documentos aún presentes. Respetar `cleanupAfter` de la última URL de carga (TTL+margen); el plazo actual05:55:18UTC ya venció. No repetir subidas sólo para obtener otro verde y extender el plazo. Exigir contabilidad coherente y cero consultorios/dueños del ensayo después. Borrar secreto sólo al terminar limpieza, porque los comandos todavía lo necesitan.

Para fixtures de proveedores: preservar reporte final e identificar slug/dueño/cita exactos. Calendar debe estar cancelado y su ausencia externa comprobada antes de quitar filas; conservar la conexión/evento histórico. Push debe conservar prueba recibida/mostrada; cerrar sólo notificaciones propias y retirar sólo los recursos ADB creados por esta corrida. No borrar otras pestañas, permisos, sesiones o dispositivos del usuario.

## Natalia: publicar conservando el sitio realmente servido

El baseline es **el despliegue CLI** `dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8`, no el árbol legado de maina66dea8. Sus35archivos/503.818B están archivados bajo `.verification/natalia-prior-production-20261023/site`, con manifiesto y huellas. Ambas selecciones de output ya aprobaron35/35 exactas en preview. El header `x-vercel-skip-toolbar:1` se usó exclusivamente en preview; producción se verifica sin normalización ni headerespecial.

Publicación ya ejecutada por cambio condicional de main y comprobada en Vercel: no repetir la preparación. El plan histórico `.verification/natalia-publication-cb8a9ba/complete-publication-plan.json` contiene:35nuevossite/,vercel.json,35anterioresrollback/ y su manifiesto; total72archivos. Commit remoto publicado `e3530eda43fd6ddc82b093a166eb49f83bf7815a`, árbol `2fadf0461e324a263a30d914848976228111abff`, padre/main esperado `a66dea894dcb513f5e9a4fcc9d8598c7f22503b9`; preserva15archivos ajenos. Main actual es e3530ed; no usar a66 como si siguiera siendo el HEAD vigente ni repetir la creación de blobs. El alias productivo está comprobado en natalia-production-publication-20261024.json.

Antes de mover main: revalidar repoID1416254094, HEAD/árbol, proyecto/equipo/Hobby, Git y alias/despliegue servido. Comparar35archivos del paqueteCB y35anteriores con manifiestos; configuración exacta frameworknull/buildCommandvacío/installCommandvacío/outputDirectorysite. Si hubo cambios externos, inspeccionarlos y regenerar la preparación necesaria, sin sobrescribirlos.

El plugin GitHub confirmó admin/push y permitió el cambio condicional de referencia. La cuenta CLI existente `juan-altamira` también tiene admin/push; `Juan4787` no lo tiene en este repo. Cambiar mediante `gh auth switch --hostname github.com --user juan-altamira`, comprobar `gh api user`, actualizar main con comparación deSHA y sinforce, y restaurar la cuenta anterior en finally. No exportar tokens ni solicitar otro login. Registrar padre/commit/árbol. Esperar deploymentREADY del commit exacto y alias productivo apuntando a él.

```bash
node scripts/verify-production-release.mjs "$D" --natalia
```

Exigir35archivos exactos sin headerespecial, y además reserva desde la web con persistencia en agenda, recuperación sin duplicar y cancelación propia. Un hash de frontend o READY no acredita backend. No eludir límites porIP ni crear reservas ajenas.

Reversión: comprobar HEAD esperado y crear commit nuevo que cambie **sólo** outputDirectory al archivo `rollback/dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8/site`, conleaseSHA y sin reescritura. La selección ya fue ensayada. Recuperación inmediata si está disponible: `vercel promote dpl_GftFq86SmaGL6xWfynd9ZuxFWWa8 --scope juanaltamiras-projects --yes`; después alinear Git y comprobar alias/READY/35huellas anteriores. Si expiró ese deployment, los bytes archivados permiten el commit de recuperación sin depender de retención. No restaurar DB ni suponer que mainlegado reproduce el sitio anterior.

## Repositorio e identidad

Seguir [identidad](identidad-cita-suite.md) con builds desconectados. Main principal313 tiene147rutas históricas/adjuntos fuera del snapshot y109eliminaciones explícitas. Superponer sólo fuentes probados y documentos revisados mediante índice temporal; conservar146blobs históricos y la corrección explícita de `docs/mercadopago-suscripciones.md` (SHA-256415f0182766cd7ddb84b22b110f09f9484ca2a5cf700864db3eaa61721633b09). Los preparadores478 son históricos: para la fuente actual deben verificar1137 entradas y digesta31596d41d6e958e43502ab8a4b1e2f96b43e38db3ad7542be1c34adcb5b2a6d, no ignorar guardas para hacerlos pasar.

Promoción con padre/lease del HEAD leído, preservando índice/HEAD del usuario; renombrar únicamenteID1115936156 a `cita-suite`, comprobar mismahistoria/IDs/permisos/reglas/consumidores y actualizar remoto a `github-secundaria:Juan4787/cita-suite.git`. Mantener auxiliar independiente y no reconectar builds automáticos. Cambiar sólo nombres visibles de los proyectos Supabase correctos mediante interfaz soportada y sesión autorizada, conservando refs/región/endpoints/datos. La CLI instalada no ofrece rename ni hay token de gestión en entorno; no extraer almacenes. Si falta sesión disponible, dejar la acción exacta al final. Directorio físico ya trasladado a `Cita Suite`, con procesos propios finalizados y enlace atómico compatible desde la ruta anterior. No repetir ni retirar el enlace durante esta sesión.

## Dependencias y criterio de cierre

El dominio `cita-suite.com.ar` está comprado y operativo desde el 27-oct ([dominio](dominio.md)). Siguen pendientes:

- **Verificación de marca de Google:** no se envió. Bloqueo probable: el dominio autorizado de Supabase no se puede verificar ([guía](acceso-google-calendar.md#retomar-cuando-el-usuario-comunique-la-compra-del-dominio)).
- **SMTP:** configurado con Gmail (`citasuite@gmail.com`) y comprobado con un correo real el 27-oct ([correo de recuperación](correo-de-recuperacion.md)).
- **Respaldos:** el destino ya lo eligió el usuario (Drive, 26-oct). Su estado está en la [auditoría final](auditoria-final.md), punto 6.

No inventar ni contratar esos recursos.

La auditoría final contrasta todos los requisitos, distingue CI/simulación/producción/dispositivo y conserva fallos. Si Free no cumple, la campaña no se declara cerrada ni el lanzamiento habilitado. Se entrega evidencia concreta, alternativas y pasos restantes; no se enmascara el impedimento con un verde parcial.

## Antecedentes conservados

La expansión/reconciliación/contracción, las versiones antiguas, sus comandos y evidencias están en el [procedimiento anterior archivado](../archive/procedimientos-historicos/publicacion-y-reversion-20261024-0827.md), SHA-256 cfc3ea94229b35decb2c3a57f84f40c552156934a36437140df1b0f31d3e04b9. **Es histórico, no una receta para repetir migraciones, reinstalar secretos o volver al baseline defectuoso.** El plan y el registro originales se preservan íntegros.


## Identidad aplicada: alcance y comprobación

El principal se promovió a37f625b y se renombró a `Juan4787/cita-suite` manteniendoID1115936156, historia, otras ramas, tags, issues/PR y políticas. Origin apunta a `github-secundaria:Juan4787/cita-suite.git`; ambas direccionesGit se comprobaron. Plugin sinpermiso deescritura enprincipal: Git nativo usó expectativaexacta deHEAD y padre directo comprobado, con dry-run adversario rechazado; no se reescribió historia. App, programador y Natalia conservaron sus deploymentIDs después de la transición, sin builds reconectados. Directorio físicoCitaSuite con enlace anterior compatible. Los recibos de identidad identifican elSHA ejecutado; actualizaciones documentales posteriores conservan exactamente las fuentes verificadas.
