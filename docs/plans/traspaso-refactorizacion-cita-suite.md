# Traspaso de la campaña de refactorización de Cita Suite

## Estado de este documento

**Actualizado por Opus 5.5 — 20 de octubre de 2026, ~14:00 UTC.** La **etapa 5 está cerrada** sobre `674649108bc2caa87e82c8bca25d93f82d584d51` (full 39276578152, dictamen independiente `ship`, DESIGN.md documentado) y se avisó al usuario. La **etapa 6 está cerrada** (ver abajo). La campaña completa **no** está terminada.

**Alcance vigente (instrucción del usuario del 19 de octubre al retomar con Opus 5.5):** completar y verificar íntegramente la fase 5, avisar al usuario cuando esté realmente cerrada y **continuar automáticamente con la fase 6 y todas las etapas restantes** hasta terminar la campaña, incluida la auditoría transversal, release, publicación y comprobaciones posteriores según las autorizaciones vigentes. Esta instrucción sustituye la restricción anterior de «detenerse antes de fase 6», que se conserva abajo sólo como antecedente de la intervención de GPT-6.1 Sol. Cambia únicamente el punto de detención: no reduce requisitos, garantías, controles ni procedimientos de seguridad.

*Antecedente reemplazado:* la intervención anterior tenía como instrucción cerrar la fase 5, avisar y detenerse antes de fase 6. Ya no está vigente.

## Punto exacto actual (20 de octubre, Opus 5.5)

1. **Cierre de etapa 5 (hecho, no repetir):** full 39276578152 sobre `6746491` (digest `44fb8645…`, recibo `c0219616-f7d1-4e03-9843-bf6cb72a4cb7`, paquete `.verification/remote-39276578152/`, SHA-256 `b7667aee…`): 15/15 etapas, 37/37 navegador, 2/2 demo, 1.265 servidor, 167 cliente, exportación nativa, SQL/carreras, deadlocks 0, Natalia idéntica. Revisión Impeccable en `.impeccable/review/structure-20261018/round-2/` (primer dictamen `fix`, tres puntajes literales en `verdict-passes.md`, el último `ship`) y documentador sobre `apps/web/DESIGN.md`. Matriz en `docs/architecture/evidencia-etapa5-estructura.md`.
2. **Etapa 6 cerrada (20 de octubre, ~08:15 UTC; se avisó al usuario).** Evidencia completa en el registro y en `docs/architecture/tareas-automaticas.md`. Fulls 39364962358 y 39366010644 sobre `c0f883d`. Staging desplegado: app `cita-suite-staging` (versión `df59a57d…`, revisión `9852251`, sin cambios de app hasta `2fe4408`), programador `cita-suite-scheduler-staging` (versión `5519dc77…`) con **los cinco cron de la cuenta Free prestados a staging**, base de staging con 113 migraciones. Escenario del plan, recuperación de reclamaciones abandonadas y entrega real por FCM a un Samsung, todo comprobado. Las corridas sintéticas `b03663a5ddbb`, `3a9214b7b23e`, `78e23f8788dc` y `6046bdb2e8db` quedaron limpias.
   - **Decisión pendiente del usuario, reforzada el 20 de octubre por el ensayo alojado de capacidad:** con la carga de 5 consultorios, Cloudflare cortó por CPU entre 15 % y 52 % de los pedidos de la app (`exceededCpu`, HTTP 503; ver `docs/architecture/capacidad.md`). Workers Paid ya no es sólo para el programador: producción también está en Free. Además, push usa 64–124 ms de CPU por ejecución y Free documenta 10 ms. La plataforma no cortó nada durante la medición, pero esa tolerancia no está documentada. Se recomienda **Workers Paid** antes de activar el programador en producción, con `JOB_BUDGET_PROFILE=paid`. No contratar sin autorización explícita.
   - **Defecto corregido en esta etapa por evidencia de staging:** `safeupdate` del PostgREST alojado (`20261020010000`); el entorno descartable ahora lo reproduce (PostgREST como `authenticator`, sonda en `scheduled-jobs.spec.ts`).
   - **Transición (en la secuencia de publicación del plan):** liberar los cron de staging (desplegar el programador de staging sin triggers o borrarlo), aplicar las migraciones nuevas en producción, apagar las entradas antiguas con `set_legacy_job_entrypoints(false)`, comprobar que cron-job.org y las copias retiradas de Netlify y Vercel no llamen nada, desplegar app y programador de producción y verificar sus eventos reales.
3. **Capacidad y matriz de regresiones, en curso (20 de octubre).** Diseño, método y hallazgos en `docs/architecture/capacidad.md`; cronología en el registro.
   - **Herramientas:** `scripts/capacity/seed-practices.sql` (generador determinista con triggers reales, por lotes; UUID v4 válidos), `scripts/run-campaign-capacity.mjs` (`level=capacity`: escenarios de 5 y 25, tres repeticiones de 2+10 min, build de producción en workerd, perfil `CITA_FIXTURE_PROFILE=capacity` con 4 GB y 2 CPU, `pg_stat_statements` y `auto_explain`; `capacity-quick` y `capacity-seed` son diagnósticos), `scripts/lib/capacity-load.mjs` (usuarios virtuales, fase pública, abuso; 10 pruebas) y `scripts/staging-capacity.mjs` (ensayo alojado de 5 consultorios: `staging-operations` `capacity-seed`, `capacity-measure` y `capacity-cleanup`, con el secreto nuevo `CITA_STAGING_SERVICE_ROLE_KEY`).
   - **Defecto real corregido:** lectura de pacientes evaluada fila por fila (`20261020020000_patient_read_set_based.sql`, reproducido en SQL 39399568648 y verificado en SQL 39400882720; tipos `a53450de…`). Con la corrección, lecturas internas con p95 de unos 190 ms en el diagnóstico de 5 consultorios. Staging ya tiene 114 migraciones.
   - **Diagnóstico corto 39433749979 (`cbfadf0`):** interno y lecturas públicas dentro de criterios; falló sólo el abuso de reservas por dos defectos de la herramienta (reporte falso de reservas fallidas y búsqueda de franjas al azar), corregidos con pruebas que fallaban antes y sensibilidad por mutación (ver registro).
   - **Siguiente:** un diagnóstico corto sobre el snapshot con esas correcciones para confirmar la fase pública completa. Después, el ensayo alojado de 5 consultorios en staging (`capacity-seed` → `capacity-measure` → `capacity-cleanup`) y luego el full de capacidad (`level=capacity`, unas 2,5 h). Más tarde, la matriz de regresiones, la auditoría transversal (con la deuda nueva del 503 público sin registro de causa) y el release. Supabase Pro para el ensayo alojado de 25 sólo con autorización (el escenario rondaría 1,1 GB).
   - **Realtime alojado, para el release:** la primera siembra de staging mostró que allí las difusiones de `realtime.send` desde triggers se pierden por falta de la partición diaria de `realtime.messages` (una advertencia por fila). Comprobar en producción, en modo lectura, las particiones y el transporte antes de dar por verificada la sincronización de revisiones de pacientes.
4. **Copias antiguas retiradas por el usuario (resuelto el 19 de octubre):** `https://cita-suite.netlify.app` servía una copia completa de la aplicación con endpoint de tareas. El usuario desactivó ese proyecto y también pausó `https://cita-suite-app.vercel.app`, otra copia que no figuraba en el inventario. Comprobado por HTTP a las 21:12 UTC: Netlify responde 404 y Vercel 503. Ambas están en el inventario de `identidad-cita-suite.md`. El interruptor de base de la migración sigue siendo parte de la transición: neutraliza cualquier llamador antiguo (por ejemplo cron-job.org contra el Worker) sin depender de esas cuentas. Antes de activar el programador nuevo, volver a comprobar que las dos copias siguen fuera de servicio.
5. **Pendiente para la auditoría transversal** (debe corregirse ahí): retención de registros (sección 4 del plan): `public_booking_attempts` guarda teléfono, hash de IP y agente de usuario de cada intento de reserva pública sin ninguna retención, aunque sólo lo lee el limitador (10 y 30 minutos); revisar con el mismo criterio las demás tablas de límites, intentos y auditoría (la telemetría push ya tiene 90 días por pg_cron y los límites de alta, 7). La carga pública (`defaultIntegration` en `/reservar` y `readBookingIntegrationRequest`) convierte cualquier excepción en 503 sin registrar la causa. Tres `as unknown as` en producción (transporte `ws` del cliente Supabase de servidor, `configuracion/negocio/+page.svelte` y `patient-export.worker.ts`); deuda de interfaz preexistente no canonizada por el documentador (kickers/eyebrows, glifos como íconos en `.ux-tab-marker`, 14 tamaños literales, `truncate` en superficies no cubiertas, pesos 650–900 con Inter cargada en 400–700, `ThemeToggle.svelte` sin uso, fechas «4 de / noviembre» partidas a 320 y costo «$ 125,5»). Detalle en el registro. Resueltos en etapa 6: los casts de errores de `push.ts` (ahora `PushServiceError` y el error tipado del SDK) y la auditoría de las tareas fuera del `fetch` presupuestado (`insertAuditLog` recibe el cliente de la tarea).

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
