# Directivas del Proyecto y Restricciones de Entorno

## Encargo vigente: avisos, correo y calendarios (5 de noviembre, noche)

- **Mandato vigente de Juan, prioritario:** ejecutar de punta a punta notificaciones, correo, recordatorios y calendarios, cerrar E y publicar. [Mandato literal](docs/plans/mandato-integral-avisos-20261105.md), [plan canónico y checkpoint](docs/plans/plan-integral-avisos-20261105.md). Sustituye la detención documental de 12.31 ([plan 12.32](docs/plans/propuesta-senas-avisos-natalia.md#mandato-integral-20261105)). Después de una compactación, releer mandato, plan y especificación antes de seguir.
- **Antecedente, ya sustituido:** el 5 de noviembre a la tarde Juan detuvo la implementación para el traspaso ([12.31](docs/plans/propuesta-senas-avisos-natalia.md#traspaso-e-documental-20261105), [traspaso técnico](docs/plans/traspaso-etapa-e-20261105.md)). Ese traspaso es evidencia histórica, no un plan obligatorio.

- Juan autorizó implementar, auditar, probar y publicar E, con autonomía posterior a resolver las dudas iniciales. Pedido literal y precedencia: [plan 12.20](docs/plans/propuesta-senas-avisos-natalia.md#ejecucion-e-autorizada). Sustituye las esperas de inicio de los apartados históricos de E y el alcance limitado de la conexión local. La antigua D celular fue reemplazada por P3 interna posterior a E/P1/P2. Esta autorización era de E: publicar P1, P2 y P3 se pide aparte.
- **Entrega documental solicitada por Juan (5 de noviembre):** mantener el [índice de E](docs/plans/indice-etapa-e.md) y, al cierre real, dar rutas exactas y enlaces locales clicables desde la interfaz a implementación, pruebas, límites y publicación. No usar el índice como una segunda especificación.
- **Regla obligatoria ante compactaciones:** seguir la [continuidad de E](docs/plans/ejecucion-etapa-e-20261103.md#regla-obligatoria-de-continuidad). Releer plan completo/ajustes y especificación, recuperar checkpoint/corridas/evidencia, no reconstruir requisitos del resumen y guardar avance/decisiones/fallas antes de una interrupción conocida. El registro activo contiene la matriz de los 97 casos; ningún verde aislado acredita un cierre.
- **Punto actual:** ver el [checkpoint del plan canónico](docs/plans/plan-integral-avisos-20261105.md#0-checkpoint-vigente). E quedó publicada y comprobada en producción el 6 de noviembre, y P1, P2 y P3 el 7 (`docs/ESTADO-VIGENTE.md`). Lo que queda está en la [lista de pendientes](docs/plans/pendientes-vigentes.md#etapa-e-pendientes). **V12b y toda versión anterior a E dejaron de ser vuelta atrás válida:** el esquema nuevo las rompe. Recuperación: [D7](docs/plans/plan-integral-avisos-20261105.md#d7-recuperación-compatible-con-e).
- Toda decisión técnica lleva fundamento y prueba; datos comerciales faltantes de Natalia no se inventan. Mantener todos los límites de cuentas/secretos, recursos, compras y destinatarios de las secciones siguientes.
- **Prioridad metodológica posterior:** [plan 12.24](docs/plans/propuesta-senas-avisos-natalia.md#calidad-ingenieria-e). Antes de ampliar E, justificar invariantes y su conservación por todos los escritores y fronteras de operación; analizar causas estructurales y complejidad, no corregir para conseguir verdes. Distinguir producto, arnés/datos y contratos pendientes. Conclusiones breves y evidencia en el registro activo; no cerrar E sin implementación final y regresiones integrales.
- **Continuación histórica (12.25):** revisión aceptada; no repetir diagnóstico general. Sus objetivos quedan incorporados al mandato vigente.

## Tareas posteriores a E: P1, P2 y P3 (reanudadas el 6 de noviembre, publicadas el 7)

- Juan las encargó el 3 de noviembre, en orden y separadas: P1 cancelar desde recepción; P2 estilar todos los controles y superficies en claro y oscuro; P3 reemplazar D por notificaciones internas de horarios liberados, con patrón similar a Seguimientos. [Literal, 12.23](docs/plans/propuesta-senas-avisos-natalia.md#tareas-posteriores-a-e).
- **Vigente desde el 6 de noviembre: reanudadas** ([12.34](docs/plans/propuesta-senas-avisos-natalia.md#reanudacion-p1-p2-p3-20261106)), con P2 ampliada a la revisión de diseño y experiencia de toda la app. Sustituye la pausa de 12.26. Seguimiento y punto de trabajo en [tareas posteriores a E](docs/plans/tareas-posteriores-a-e-20261103.md#punto-de-trabajo). **Publicadas el 7 de noviembre** con la migración 165, por pedido de Juan: «publica cuando termines y deja la documentacion consistente».
- **Turnos pasados:** Juan decidió que un turno que ya empezó o ya pasó no se cancela y que la pantalla debe aclararlo.
- Turnos simultáneos y adaptación por rubro: sólo análisis conversado, sin implementar. No iniciarlos sin pedido de Juan.
- Las menciones históricas a D en pausa son del antiguo push al celular del consultorio, **reemplazado**, no un trabajo de push pendiente de retomar. La nueva D interna se hace como P3. No cambia el push/calendario del paciente ni el correo E.


## Criterio vigente: rigor y controles según el contexto de esta app

- **Corrección expresa del usuario (30 de octubre, hora argentina):** no pidió reducir auditorías, exigencia ni cobertura de inconsistencias. Busca ese rigor. El problema es la sobreingeniería que duplica trabajo para proteger turnos de pacientes ficticios o impone procedimientos ajenos a la situación real de esta app.
- **Contexto confirmado por el usuario:** actualmente no hay pacientes reales. Los pacientes y turnos de prueba pueden crearse, modificarse, eliminarse o regenerarse cuando la prueba lo requiera. No tratarlos como registros clínicos reales ni exigir su conservación exacta como condición de cierre.
- Evaluar cada control por el daño concreto que evita y por la evidencia adicional que aporta. Mantener auditorías profundas, pruebas adversarias y correcciones de causa raíz. No confundir rigor con cantidad de entornos, corridas, copias o documentos.
- La producción ya está autorizada para las escrituras y pruebas necesarias. En este contexto, probar directamente allí es una vía normal y preferente cuando permite comprobar el comportamiento real sin comprometer activos reales. Staging/aislamiento se usan cuando resuelven un riesgo o una limitación específicos; no son un paso previo obligatorio para toda modificación ni un motivo para duplicar la misma prueba.
- Siguen siendo reales y deben cuidarse los secretos, las cuentas e identidades de personas, los permisos y el aislamiento, la configuración comercial, el código, los dominios y la infraestructura. La ausencia de pacientes reales no convierte toda la base o la cuenta del proveedor en material descartable. No contratar ni enviar comunicaciones a destinatarios reales sin la autorización correspondiente.
- Para una entrega de UI/Auth sin migraciones, no exigir por inercia una copia de base menor a seis horas, huellas idénticas de turnos ficticios, instalar primero un checkpoint, ni ejecutar candidata→rollback→candidata en varios entornos. Conservar una versión recuperable y usarla si hace falta; ensayar específicamente la recuperación cuando el cambio concreto lo justifique.
- Aprovechar la evidencia existente. Repetir o ampliar verificaciones cuando un cambio, un fallo o una duda concreta lo justifique. Si un verificador contiene una condición obsoleta, corregir esa condición con su motivo documentado; no fabricar un verde ni mantenerla por obediencia al script.
- **Precedencia:** esta decisión posterior sustituye, en los planes, traspasos y reglas históricas siguientes, las obligaciones automáticas incompatibles de staging previo, duplicación de pruebas, respaldo por antigüedad fija, ensayos de reversión y preservación exacta de datos ficticios. No rebaja la seguridad ni prohíbe abrir nuevas auditorías. Si el contexto cambia y aparecen pacientes reales, adaptar los controles a ese cambio antes de tratar sus registros como descartables.

## Restricciones de Rendimiento y Memoria RAM
- **Memoria RAM muy limitada:** La máquina del usuario cuenta con poca memoria RAM y se satura con extrema facilidad.
- **Prohibido el paralelismo en pruebas:** Correr tests en paralelo casi garantiza el congelamiento del sistema.

### Reglas de Ejecución:
- **Tests / Pruebas:** Ejecutar siempre en modo secuencial (`--workers=1`, `--threads=false`, `--maxWorkers=1`, etc.).
- **Procesos en segundo plano:** Evitar spawnear múltiples tareas o compilaciones concurrentes pesadas.

## Campaña de refactorización de Cita Suite

Las reglas de procedimiento históricas de esta sección se interpretan según el criterio vigente del comienzo. Sus objetivos y evidencias se conservan; no reinstaurar por ellas las obligaciones automáticas que el usuario acaba de sustituir.

- La fuente de verdad es `docs/plans/refactorizacion-cita-suite.md`: contiene el plan aprobado íntegro y la instrucción de ejecución del usuario. Sus requisitos prevalecen sobre cualquier resumen de compactación.
- Después de cada compactación y antes de comenzar cada etapa, leer el documento original completo y contrastarlo con `docs/plans/registro-refactorizacion-cita-suite.md`, el traspaso vigente `docs/plans/traspaso-refactorizacion-cita-suite.md` y sus evidencias. No reconstruir el plan de memoria ni considerar eliminado un requisito porque falte en un resumen.
- Identificar el último punto verificado y continuar desde el siguiente trabajo pendiente, sin repetir innecesariamente operaciones ya comprobadas ni dar por terminadas tareas incompletas.
- Mantener el registro separado con etapas, cambios, pruebas, resultados, decisiones, bloqueos y pendientes. No modificar el plan original para hacerlo coincidir con una implementación incompleta.
- La autonomía cubre la campaña íntegra en rama aislada. El usuario autorizó además publicación y pruebas masivas en producción el 17 de octubre: consultar la ampliación literal del plan. Mantener la secuencia de validación/respaldo/reversión y usar datos sintéticos acotados, preservando los reales. No se autorizaron contrataciones; conservar todas las restricciones de RAM.
- Antes de declarar la campaña terminada, verificar punto por punto todos los requisitos y criterios de aceptación del documento original mediante evidencia comprobable.
- Alcance vigente (19 de octubre): al cerrar una etapa, avisar al usuario y continuar con la siguiente sin detenerse, hasta terminar la campaña. Esto no reduce ningún control.
- Alcance de lanzamiento (20 de octubre, decisión literal al final del plan): Cita Suite no tiene usuarios ni consultorios reales, y todos sus datos son ficticios. La cantidad de consultorios de esta decisión (dos) quedó reemplazada por uno el 25 de octubre (ver «Alcance de lanzamiento vigente»); si un límite del proveedor impide demostrar los criterios, es un impedimento que se informa con alternativas. La capacidad para 5 y 25 consultorios deja de ser condición de cierre, sin rebajar calidad, seguridad ni integridad. No contratar nada, ni ningún servicio con cobro variable sin tope. Las protecciones de consumo se deciden por mérito: ahora si se justifican, o postergadas con su riesgo residual documentado.
- Restricción económica posterior (25 de octubre): el usuario vendió la app con pago único, comprará el dominio y no asumirá servicios pagos recurrentes para un consultorio. Recién desde el segundo consultorio podrá evaluarse ese gasto; no hay autorización anticipada de contratación, migración ni cambio de plan. Esta decisión sustituye la previsión económica anterior de pagar desde el tercero; no modifica automáticamente criterios de aceptación ni convierte los ensayos fallidos de dos consultorios o el diagnóstico breve de uno en una aprobación. Priorizar soluciones sin nuevos cargos recurrentes para el primer consultorio, con evidencia propia y sin rebajar calidad, seguridad o integridad. Decisión literal y aplicación en `docs/architecture/control-de-consumo.md`; registro y traspaso conservan los pendientes. El dominio lo compra el usuario: no contratarlo por él.
- Alcance de lanzamiento vigente (25 de octubre, decisión literal al final del plan): el lanzamiento es para **un** consultorio sobre Workers Free y Supabase Free, y el despliegue gratuito debe demostrar con un consultorio los criterios del plan, sin rebajarlos, antes de publicar. No ejecutar más ensayos de dos consultorios sobre la infraestructura gratuita: los dos fallidos se conservan como evidencia. Optimizar para un consultorio con evidencia propia; un ajuste gratuito de configuración del proveedor se mide con los mismos criterios y se documenta con su reversión. Desde el segundo consultorio el usuario pagará Supabase Pro con tope de gasto: la contratación es suya y no autoriza al agente a contratar, migrar ni cambiar planes. Antes de incorporar el segundo, demostrar dos consultorios en ese destino. Aplicación en `docs/architecture/capacidad.md`.
- Aceptación del lanzamiento (25 de octubre, decisión literal al final del plan): el usuario acepta lanzar el primer consultorio en los planes gratuitos con esperas ocasionales de 2 a 3 s, porque no puede pagar para ese consultorio. Es una desviación de latencia aceptada sólo para el primer consultorio, no un criterio cumplido: las corridas 40169634680 y 40175346833 siguen fallidas y los umbrales no cambian. No cubre errores, aislamiento, doble reserva, cuotas, disponibilidad, push, calendario, seguridad ni integridad. No repetir la medición de un consultorio en Free salvo que haya un cambio concreto o una regresión. Correo de recuperación, custodia de respaldos, dominio y verificación de Google y nombres de Supabase siguen pendientes. (Estado al 27 de octubre: el dominio quedó operativo y el proyecto de producción de Supabase ya se llama «Cita Suite»; siguen pendientes el correo de recuperación, la verificación de Google y el nombre del proyecto de staging («Staging 455»), y la custodia de respaldos tiene su estado en `docs/architecture/auditoria-final.md`, punto 6. Ese día el usuario aceptó que las copias programadas se atrasen unas horas: lo que no se acepta es que dejen de copiarse o fallen sin aviso.)
- Documentación (22 de octubre, pedido literal del usuario: «deja todo extremadamente documentado»): cada corrida, falla, causa, corrección, decisión, bloqueo y pendiente queda en el registro con su identificador de corrida, SHA y ruta de evidencia; el traspaso refleja el punto exacto; los procedimientos llevan comandos exactos, precondiciones, comprobaciones y reversión. No sustituye ningún control.
- Criterio crítico (22 de octubre): asumir que tanto el código heredado como el trabajo propio pueden estar equivocados. Intentar refutar cierres y verificadores con pruebas adversarias; contrastar causas alternativas y no convertir un mensaje conocido o un verde anterior en garantía. Una excepción del arnés exige evidencia de su alcance y pruebas que detecten su abuso.
- Identidad y dominio (27 de octubre, pedido literal en el registro): el usuario pidió unificar Supabase, GitHub y la carpeta como «Cita Suite», con amplios permisos para renombrar otros nombres siempre que no genere problemas de ningún tipo. Se conservan los identificadores de contrato (`/odonto`, `ODONTO_SUPABASE_*`, refs y migraciones aplicadas), la evidencia histórica y los recursos de otros productos o herramientas (Codex, Cursor). El dominio está operativo desde el 27 de octubre. Por decisión literal del usuario (registro), `cita-suite.com.ar` es la landing, servida por Vercel desde `juan-altamira/landing-cita-suite` («la dejamos en vercel si no molesta»), y `app.cita-suite.com.ar` la aplicación (Worker `app`); `app.cita-suite.workers.dev` se conserva. No volver a enganchar el dominio principal a un Worker: `wrangler deploy` pisaría su CNAME hacia Vercel. Topología, procedimientos y pendientes en `docs/architecture/dominio.md`. Carpetas, reorganizadas por el usuario el 27 de octubre: la aplicación en `/home/usuario/CascadeProjects/CITA SUITE/Cita Suite App`, la landing en `/home/usuario/CascadeProjects/CITA SUITE/Landing Cita Suite` y Natalia en `/home/usuario/CascadeProjects/CITA SUITE/Web Natalia`; `Base de Datos Sabrina` es un enlace compatible a la aplicación. No escribir rutas absolutas en herramientas nuevas.
- Correo de recuperación (27 de octubre): SMTP de Gmail con la cuenta dedicada `citasuite@gmail.com`, comprobado con un correo real ([guía](docs/architecture/correo-de-recuperacion.md)). Para probarlo usar `citasuite+recuperacion@gmail.com` (llega al buzón del usuario), nunca la cuenta de prueba de las lecturas productivas, cuya contraseña usan esas lecturas. La contraseña de aplicación no pasa nunca por la conversación.
- Continuación autónoma (24 de octubre): el usuario autorizó vincular/controlar su Samsung y continuar todos los pendientes sin preguntas intermedias. Esta instrucción sustituye la espera tras cada consulta de los checkpoints anteriores. Resolver autónomamente lo autorizado, continuar trabajos independientes y dejar dudas o dependencias externas para el informe final; no detener la campaña por ellas ni declararlas aprobadas. Se mantienen RAM, preservación, evidencia estricta y prohibición de contratar. El usuario compró el dominio el 27 de octubre.

## Campaña de señas y avisos del consultorio de Natalia (29 de octubre)

Las exigencias históricas de entornos, copias y ensayos de esta sección están subordinadas a la corrección contextual vigente del comienzo. Las pausas de Natalia/D/E que aparecen en los apartados fechados siguientes son históricas: el alcance actual de E está en la sección «Etapa E — definición documental del 2 de noviembre» al final de este archivo. D y los datos comerciales faltantes de Natalia siguen pendientes; las cuentas/configuración reales conservan su protección.

- **Fuente de verdad:** `docs/plans/propuesta-senas-avisos-natalia.md`, aprobado íntegramente por el usuario el 29 de octubre.
  - Su sección 12 contiene la aprobación literal y los ajustes posteriores, y sólo crece hacia el final.
  - Registro: `docs/plans/registro-senas-avisos-natalia.md`.
  - Traspaso: `docs/plans/traspaso-senas-avisos-natalia.md`.
  - Información de la clienta: `docs/clientes/natalia-frutos/informacion-20261029.md`.
- **Al retomar:** después de cada compactación y antes de cada etapa, leer el plan completo, el traspaso y el registro. No reconstruir el plan de memoria.
- **Pedido literal del usuario:** «rigor más extremo posible, no dejes pasar ninguna inconsistencia bug ni error silencioso. No te confíes nunca, un test verde no demuestra ausencia de bugs silenciosos ni consistencia».
- **Forma de trabajo de la refactorización:**
  - pruebas que fallan primero;
  - verificación en CI del repositorio auxiliar;
  - candidatas sobre la versión publicada (`aacba5b` al empezar), armadas con un índice temporal;
  - staging antes de producción;
  - producción sólo con una autorización expresa que nombre la acción.
- **Ajustes al plan:** van como subsección nueva de la sección 12, con su motivo y las secciones que reemplazan. Nunca se edita en silencio el texto aprobado.
- **Producción:** no cargar configuración en el consultorio real de Natalia ni escribir en producción sin autorización expresa.
- **Autorización posterior (30 de octubre, literal):** «Te concedo por adelantado la autorizacion para escribir en produccion y probar lo que sea necesario». Autoriza las escrituras y pruebas necesarias para esta campaña sin otra consulta de permiso; sustituye la espera de autorización de los puntos anteriores. Conservar CI, staging, respaldo, recuperación, reversión y verificación del destino; datos sintéticos propios con limpieza comprobada y sin usar el consultorio de Juan como fixture. No inventar decisiones de configuración de Natalia ni contratar servicios; D y E siguen en pausa. Aplicación completa en la sección 12.8 del plan.

## Pruebas de navegador

- Seguir `docs/architecture/verificacion.md`: los specs e2e se tipan (`pnpm --filter web check:e2e`); las matrices visuales usan `layoutIssues` y `alignTaskForCapture`; los fixtures usan `e2e/helpers/fixture-db.ts`; un spec con varios casos reutiliza la sesión (`loginWithSharedSession`); no hay reintentos `toPass` alrededor de un clic.
- Un defecto encontrado a mano se reproduce primero con una prueba que falle y después se corrige. Una prueba verde sólo vale si puede detectar el defecto que protege.

## Reanudación posterior de configuración y D/E (30 de octubre)

- El usuario pidió «avancemos en esto» sobre el pendiente de configuración de Natalia y D/E. Aplicación en 12.12 del plan: autoriza avanzar y sustituye la pausa anterior. Se conservan el cierre de A/B/C, datos de negocio no inventados, CI/staging/release/respaldo/reversión y prohibición de contratar. No volver a preguntar si se puede iniciar el trabajo ya pedido.
- Los datos de contacto, transferencia, cuenta/consultorio, dispositivos y disponibilidad de Resend se piden sólo si faltan; mientras llegan, avanzar con código y pruebas independientes. Credenciales privadas fuera del chat y del repositorio; no enviar mensajes reales a personal/pacientes por inferencia.

- **Corrección posterior de alcance (30 de octubre):** en respuesta al proveedor, el usuario pidió «Dejemos el correo para después». E queda nuevamente pospuesta (plan, 12.13); continuar configuración confirmada y D. El correo y el WhatsApp recibidos están en la sección 6 del documento de Natalia; transferencia y dispositivos siguen pendientes. La cuenta no existía en producción al leerla, por lo que el alta puede usar el flujo transaccional con dueña pendiente, sin contraseñas inventadas ni correos externos.

## Tarea posterior, ya cerrada: confirmación de correo (30 de octubre)

- El usuario pidió dejar la configuración de Natalia y los avisos para después y corregir a fondo el alta con confirmación obligatoria de email, especialmente la UX: pantalla propia, sin apariencia de error para un paso normal. Plan `docs/plans/confirmacion-email-20261030.md`, registro y traspaso homónimos.
- Conservar la confirmación habilitada y comprobar Google/reset/ingreso. Aplicar las reglas de RAM y los controles proporcionados al contexto indicado al comienzo de este archivo; no reinstaurar el circuito histórico completo por inercia. No se necesita otra autorización productiva para esta corrección. Natalia tiene 12 meses asignados por Juan: no modificar ese acceso ni retomar D/E durante esta tarea.

## Cierre de confirmación de correo (31 de octubre, 20:22 UTC)

- **V9 publicada y comprobada (31 de octubre, 21:58 UTC):** `a3c707f368736da90d2adf5850d291460f657af0`, versión `2ef53723-0a46-4879-bf6e-4af5ed5320c9`: V8 más el registro de las fallas de Auth al comprobar el enlace. **Desde el 1 de noviembre producción sirve V10b** (ver «Estado al 1 de noviembre» más abajo); la recuperación vigente está en `docs/architecture/publicacion-y-reversion.md`. Detalle de V9 en `docs/plans/traspaso-confirmacion-email-20261030.md`.
- **Antes, publicada y comprobada en producción**: V8 `408ca04d9e6750e4657dc087264644665a63fb37`, Worker `app`, versión `a1844665-447e-40bb-b9e5-ce7c03ed29d7`. La entrega ya no está pendiente de publicación. Estado/evidencias: `docs/plans/traspaso-confirmacion-email-20261030.md` y registro homónimo.
- Navegador real contra producción `41238345216` aprobado: alta pendiente sin rojo, reenvío, otro navegador, confirmación con enlace generado por Auth alojado, enlaces falsos/usados y cinco anchos. No equivale a recepción de email en un buzón externo; ese límite queda explícito. Usuarios temporales y secreto CI eliminados; ingreso/agenda en ambos dominios y 74 relaciones sin exposición anónima comprobados.
- Puntero `.verification/ci-source.json` en V8; HEAD/índice del usuario preservados. Recuperación compatible y paquete candidato disponibles. Staging sigue en recuperación compatible, sin bloquear esta entrega. No repetir release, backups por edad ni ciclos de reversión por rutina.
- Conserva el rigor y el criterio contextual del comienzo. Natalia/D/E siguen en pausa y la autorización productiva persiste. No reabrir ni republicar este trabajo como pendiente por leer un traspaso anterior.

- **Consistencia documental revisada el 31 de octubre:** README, índice `docs/README.md`, guías operativas y traspasos generales remiten al cierre V8; sus apartados anteriores quedan como historia. Recuperación actual c195b1e, no C9/B11. La recepción histórica de recuperación no acredita recepción externa de confirmación. Detalle en el registro de esta tarea.

## Estado al 31 de octubre: cuenta real de Natalia y lista única de pendientes

- **Lista única de pendientes:** `docs/plans/pendientes-vigentes.md`. Juan pidió que no se pierda nada de lo pendiente (D, E, Resend y el resto): consultarla antes de dar algo por terminado y actualizarla al cerrar cada punto.
- **Natalia es la primera y única usuaria real.** Se registró con su propio correo (consta en la sección 7 de su documento privado) y es dueña de su consultorio «Consultorio» (`c488f625-cb9a-41ec-8526-b7ec03c4646b`), con 367 días de acceso dados por Juan. El resto de las cuentas, correos, pacientes y turnos son ficticios. Su cuenta, su consultorio y su configuración son reales: no se usan como fixture ni se modifican sin una instrucción expresa.
- **Consultorio preparado duplicado** (`1a00afa2-92ad-46cf-bc4a-cd6b58e4e4b0`): la base no permite borrarlo, porque `access_grants` es de sólo agregado. Desde el 1 de noviembre está archivado y se llama «Duplicado archivado — no usar» (ver el apartado siguiente).
- **Datos personales:** los datos de contacto de Natalia viven sólo en `docs/clientes/natalia-frutos/informacion-20261029.md` (permiso 600). No se copian a planes, registros, traspasos ni candidatas: el repositorio auxiliar `Juan4787/cita-suite-verificacion` es público.
- **Seguridad de las invitaciones:** una invitación pendiente se acepta en el primer ingreso de cualquier cuenta con ese correo. La protección depende de que «Confirm email» siga activo en Supabase: no desactivarlo mientras existan invitaciones pendientes.

## Estado al 1 de noviembre: configuración de Natalia, su web y V10b (plan de señas y avisos, 12.16)

- **Decisiones literales de Juan:** sección 12.16 del plan. Registro, sección «1 de noviembre»; traspaso, «Trabajo en curso — 1 de noviembre»; evidencia en `.verification/natalia-configuracion-20261101/`.
- **Dominios oficiales** (Juan, «de ahora en más»): `https://app.cita-suite.com.ar` para la app y `https://cita-suite.com.ar` para la landing. `workers.dev` no es oficial: nada que vea un paciente o un consultorio debe usarlo.
- **Consultorio real de Natalia** (`c488f625-cb9a-41ec-8526-b7ec03c4646b`):
  - «Consultorio Natalia Frutos», con la dirección `natalia-frutos`, el rubro «medicina» y el WhatsApp del consultorio;
  - su perfil profesional, dos prestaciones de 60 minutos y los horarios exactos;
  - la integración predeterminada de su web, con presencial y online;
  - la pregunta de obra social de 24 opciones.

  Se cargó como operador, directamente en la base y con la autorización de Juan, replicando las funciones de guardado de la app. La historia dice que lo hizo el operador. **Faltan datos de Natalia** (dirección, instrucciones online, honorarios, seña y más): lista en `docs/plans/pendientes-vigentes.md`. No se inventan.
- **Historia: V10b** `68f31741f6ff7f2253c036800b1369f1eda16510` (versión `1d2b4acd-7dd8-4cb7-81e3-a205bafe9f8d`) sirvió producción desde el 1 de noviembre. Ni V9 ni V10b son hoy una vuelta atrás válida: ninguna versión anterior a E se puede usar. Detalle en `docs/architecture/publicacion-y-reversion.md`.
- **La web de Natalia** reserva en su consultorio real por `app.cita-suite.com.ar`. Pide no ser indexada hasta que tenga dominio propio (`PRODUCTION_NATALIA_SITE_URL`); entonces la misma compilación produce las direcciones canónicas y el mapa del sitio.
- **Pruebas en su consultorio real:** se hicieron dos reservas marcadas, presencial y online, y se borraron con controles. El consultorio quedó con conteos idénticos a la foto previa; no dejar datos de prueba allí sin limpiarlos de la misma forma.

## Campaña de modo claro (2 de noviembre) — publicada como V12 y ajustada en V12b

- **Fuente de verdad:** `docs/plans/modo-claro-20261102.md`, aprobado por Juan el 2 de noviembre con autorización expresa para publicar en producción («autorizo todo lo que dijiste y la subida a produccion. No me pidan mas permisos ni autorizaciones, avanza con rigor extremo y exigencia de calidad muy alta. Deja todo perfectamente documentado de forma clara y ordenada»).
  - Sus ajustes van en la sección 12: 12.1 a 12.5.
  - Registro: `docs/plans/registro-modo-claro-20261102.md`. Traspaso: `docs/plans/traspaso-modo-claro-20261102.md`. Evidencia: `.verification/modo-claro-20261102/`.
- **Historia: V12b** `771fac5950c532b1123f11d4dde93eef9b42ceba`, versión `277d332d-1794-4367-8ef0-567ced159f1b` (2 de noviembre, 15:33 UTC), sirvió producción hasta la publicación de E del 6 de noviembre.
  - Es V12 (`c21a1983…`, versión `f18a80f2…`) con el fondo general del modo claro apenas más cálido, `#f6f5f3`, a pedido de Juan (12.5).
  - Es V11f más el modo claro predeterminado, el oscuro conservado y el selector Claro, Oscuro y Automático, con la preferencia por dispositivo en la cookie `cita-theme`.
  - No tiene migraciones de base.
- **Vuelta atrás: ya no aplica.** Desde la publicación de E ninguna de estas versiones se puede usar: ni V12 `f18a80f2-fd65-4ffc-b92f-fc0101d4f85f`, ni V11f `986cf666-ae09-423b-ae05-1928007dccde`, y **nunca** `59f81e89…`, que además restauraría el cliente anterior de Calendar. Detalle en `docs/architecture/publicacion-y-reversion.md`.
- **Colores:**
  - fuente única en `apps/web/src/lib/theme/palette.js`;
  - reglas en `apps/web/DESIGN.md`;
  - prohibido escribir colores a mano: lo controlan las guardias `scripts/lib/theme-colors.test.mjs` y `theme-palette.test.mjs`;
  - un color de texto en CSS lee sólo variables probadas como texto (`--accent` es de íconos y bordes, `--accent-text` es de texto);
  - una capa que flota sobre contenido conserva su opacidad exacta (ajuste 12.4).
- **Natalia:** su reserva sigue el `color_mode` de su web y se ve idéntica a la de antes, también en su lienzo (12.3). Su apariencia depende de las marcas `bk-*` y de `BookingAppearance.svelte`.
- **Verificación de contraste:**
  - `e2e/theme-modes.spec.ts` recorre toda pantalla que el entorno de prueba puede abrir y los menús y diálogos principales, en los dos modos y a 390 y 1280 px;
  - mide con axe y, lo que axe no decide, con el peor caso (`e2e/helpers/theme.ts`).

## Historia y cambios vigentes (2 de noviembre)

- **Registro único:** `docs/ESTADO-VIGENTE.md` dice qué revisión sirve producción, que esa revisión está en la historia de `main`, y qué código difiere de producción.
  - Se actualiza en el mismo paso de trabajo que cambia esos datos, nunca después.
  - Lo que no se sabe se escribe como «no verificado»; no se deduce ni se inventa.
- **Al empezar cualquier sesión:** correr `node scripts/check-repo-sync.mjs` desde la raíz. Si falla, se resuelve antes que cualquier otra cosa.
  - Falla ante: rama distinta de la registrada, copia local distinta de GitHub, trabajo fuera de Git, producción con otra revisión o fuera de la historia, y código distinto de producción sin declarar.
- **Rama de trabajo:** `main`. Las candidatas se arman sobre `main`. Al publicar, la revisión publicada entra a `main` y se sube a GitHub en el mismo paso.
- **No se congela una rama como protección.** El 2 de noviembre eso dejó tres historias divergentes (`origin/main`, la rama local y la línea de producción), que se unieron en `main` sin perder commits. El detalle está en el registro.
- **Nunca se publica en el repositorio** lo que `.gitignore` marca como privado: datos de clientes, volcados de base, evidencia nueva y archivos `.env`.

## Etapa E — definición documental del 2 de noviembre

- Fuente vigente: plan de señas y avisos, sección [12.18](docs/plans/propuesta-senas-avisos-natalia.md#etapa-e-vigente), y [especificación de E](docs/plans/etapa-e-correo-autogestion.md). Sustituyen Resend, la pausa conjunta D/E y la reprogramación sólo como pedido en este alcance. D sigue en pausa.
- Este pedido autoriza revisar código y actualizar documentación. Al terminar, avisar y **esperar la próxima instrucción de Juan para implementar/configurar/probar**. No adelantar código, migraciones, secretos, DNS, envíos o publicación.
- Cambios acordados: email público requerido por defecto, desactivable; recepción puede seguir sin email tras aviso; comprobantes y recordatorios 72/24 h con botones configurables y marca del consultorio; reprogramación autónoma; nueva seña por defecto y pérdida del importe anterior, con opciones de desactivar la nueva obligación y de conservar el anterior a cuenta. Reglas completas y casos identificados en la especificación, sin duplicarlas aquí.
- Zoho: Juan ya se registró y probó dos envíos; KYC pendiente y 100 emails gratuitos/día, según informó. Pagará al verificarse. No pedirle crear otra cuenta ni tratar KYC como impedimento para preparar las pruebas permitidas. No confundir esos envíos con integración E ni recepción/recorrido integral comprobados por el agente.
- Excepción económica expresa para correo: se admite costo operativo controlado aun con un consultorio, sin exigir gratuidad indefinida. No autoriza compras por el agente, auto-recargas, otros canales ni cambiar Supabase/Workers o SMTP de Auth.
- Los ajustes encontrados leyendo código se registran como requisitos pendientes, no como pruebas ejecutadas. Conservar historial de dinero, proyección de seña compatible, revisión semántica y revocación de gestión sin romper calendario/push. No copiar la lógica de reservas a la web de Natalia.
- Registro/traspaso de esta campaña y pendientes vigentes conservan el punto exacto. La revisión es documental; producción sigue en V12b y su versión se toma del estado vigente.

## Zoho por terminal — conexión persistente del 3 de noviembre

- Instrucción posterior de Juan: «conectemos zoho para que puedas controlarlo desde la terminal» y «Guarda todo, que no se pierda el acceso al reiniciar la pc». Sustituye la espera de 12.18 sólo para esta conexión; [plan 12.19](docs/plans/propuesta-senas-avisos-natalia.md#zoho-terminal-vigente). No interpreta este paso como inicio de todas las funciones de E ni de D.
- Conexión OAuth local real comprobada: consultas de agentes/dominios/registros, renovación y lectura posterior. [Guía y comandos](docs/architecture/zoho-cpaas-terminal.md). Herramienta versionada `scripts/zoho-cpaas.py`; credenciales persistentes en `~/.config/cita-suite/private/zoho-cpaas.json` (600, directorio 700), con refresh token. Nunca imprimir ese archivo, poner secretos en argumentos/chat ni publicarlos.
- Al retomar tras reiniciar: ejecutar `python3 scripts/zoho-cpaas.py status`, luego `python3 scripts/zoho-cpaas.py agents`. La herramienta renueva al vencer; no pedir crear otra cuenta ni otro cliente si el acceso guardado funciona. No necesita terminal, ventana ni daemon abierto.
- Evidencia privada en `~/.local/share/cita-suite/zoho/`, incluido `conexion-verificada.json`. Consultar cantidades/estados sin exponer direcciones o claves. No se enviaron correos nuevos ni se cambiaron DNS, SMTP de Auth, configuración de Natalia o producción. No confundir este acceso administrativo con una integración E desplegada o recepción en buzón comprobada.
