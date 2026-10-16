# Registro de ejecución de la refactorización de Cita Suite

Fuente de verdad: [plan aprobado íntegro](refactorizacion-cita-suite.md). Integridad de la copia: [huellas SHA-256](refactorizacion-cita-suite.integridad.json).

Estado general: **en ejecución; campaña no terminada**. Rama: `refactor/maintainability-20261015`. No se modificó producción, datos reales ni se contrataron servicios.

## Regla de continuidad

Después de cada compactación y antes de cada etapa: releer íntegramente el plan, contrastar este registro y revisar la evidencia. No sustituir el original por este registro ni por documentos resumidos. La instrucción posterior de ejecución autoriza el trabajo local y de pruebas; la condición del texto original que reservaba esa autorización ya fue satisfecha. Producción continúa excluida.

## Estado por etapa

| Etapa | Estado y condiciones pendientes |
|---|---|
| 0. Base real y preservación | Cerrada localmente: rama, estado previo, inventario efectivo, matriz funcional, proveedores y destinos documentados. Accesos pendientes se mantienen como bloqueos explícitos de las etapas remotas. |
| 1. Verificación confiable | Base completa aprobada en CI `38825775890`: tipos, 1.108 unidades, fronteras/guardas, 24 suites SQL, siete carreras, Auth/Storage, 25 casos de navegador, dos de demo y Natalia nativa escritorio/móvil. Mecanismos de fallo deliberado y rechazo de omisiones comprobados. Release remoto permanece pendiente del staging separado y los accesos; no se lo considera aprobado por esta corrida. |
| 2. Tipos, contexto y aislamiento | En ejecución: comienza por generación reproducible desde la reconstrucción descartable. |
| 3. Capacidades y cuotas | No iniciada. |
| 4. Disponibilidad, reservas y aranceles | No iniciada. |
| 5. Áreas e interfaz | No iniciada. |
| 6. Tareas automáticas | No iniciada. |
| Capacidad y matriz de regresiones | No iniciada. |
| Auditoría transversal y entrega | No iniciada. Publicación fuera de esta autorización. |

## Cambios efectuados

- Rama aislada creada preservando las diferencias iniciales y los archivos ajenos.
- Vitest de servidor y cliente: un trabajador, sin paralelismo entre archivos y sin permitir éxito con cero pruebas.
- Comando raíz de tipos incluye Natalia.
- Nuevos comandos `verify:fast`, `verify:full`, `verify:release`; ejecución secuencial, exclusión entre verificaciones y recibos en `.verification/`. **Los niveles full/release no están cerrados: sus ejecutores de navegador/staging todavía deben completarse.**
- Reconstrucción SQL descubre todas las suites y los siete scripts de carreras, en lugar de ejecutar sólo una lista parcial. Comprueba planes y número de aserciones pgTAP.
- Preflight ya no exige ni recomienda credenciales de WhatsApp.
- Artefactos temporales de los fixtures separados por checkout; no comparten archivos globales con otra copia del repositorio.
- Auth GoTrue real en el ejecutor aislado: creación de usuarios por API, login real y comprobación previa de identidad, rol y membresía mediante RLS.
- Instalado `dependency-cruiser` 18.6.0 con versión exacta. Fronteras verificadas sobre 598 módulos y 1.145 relaciones; pruebas deliberadas de imports privados, servidor desde navegador y ciclos detectadas correctamente.

## Pruebas ejecutadas y resultados

### Verificación rápida inicial — aprobada

Comando: `pnpm verify:fast`. Recibo: `.verification/fast.json`. Registro completo: `/tmp/cita-refactor-fast-initial.log`.

- Tipos de shared: aprobados.
- Svelte: 0 errores, 0 advertencias.
- Natalia: 37 archivos; 0 errores, advertencias o hints.
- Servidor: 135 archivos, 1.008 pruebas aprobadas.
- Cliente: 13 archivos, 100 pruebas aprobadas.

### Reconstrucción SQL inicial — aprobada

Comando: `node scripts/test-booking-foundation.mjs --real-storage --keep`. Registro: `/tmp/cita-refactor-sql-initial.log`.

- Migraciones reconstruidas desde cero en PostgreSQL descartable 17.6.1.166.
- 24 suites SQL descubiertas y aprobadas, con validación de pgTAP.
- 7 scripts de concurrencia aprobados, ejecutados uno por vez: asociación de correo, límite de cargas, consistencia de exportación, exclusión global de exportación, identidad idempotente, límite de reservas y resolución pública de pacientes.
- Storage API v1.70.3 real. Esta corrida **no** prueba transferencia HTTP, Auth real, navegador ni despliegue.
- El contenedor retenido fue eliminado por su ejecutor al finalizar el intento de plataforma; no debe reutilizarse el identificador de aquel registro.

### Plataforma con Auth real — fallo diagnosticado, corrección por verificar

Registro: `/tmp/cita-refactor-platform.log`. El primer arranque de GoTrue falló porque las funciones Auth creadas por el fixture pertenecían a `supabase_admin` y sus migraciones necesitan el propietario `supabase_auth_admin`.

Corrección preparada: asignar las funciones del fixture al propietario correcto y detectar inmediatamente un servicio que terminó, en lugar de agotar todas las esperas. Pendiente repetir la reconstrucción y comprobar Auth real. No afecta ni modifica la base remota.

## Decisiones y desviaciones justificadas

- El chequeo de integridad detectó formato de tablas/espacios y una directiva adicional de continuidad en el archivo de trabajo. Se contrastaron los mensajes originales: plan e instrucción de ejecución sin cambios de contenido. Se restauró su formato literal, **se preservó íntegra la directiva adicional** y sólo se actualizó la huella del documento compuesto; las dos huellas originales siguen intactas. Se conserva la versión previa en `.verification/user-plan-format-and-continuity-edit.md` y el plan se excluye de Prettier. La directiva adicional también figura en AGENTS.
- Las pruebas ya no sobrescriben las siete capturas históricas versionadas: usan `test.info().outputPath`. Se archivaron las capturas sintéticas nuevas y se restauraron exclusivamente esos archivos que esta campaña había modificado.
- Diagnóstico del flujo operativo: aprobado completo en 56 segundos, con fixture que separa la agenda general de la selección restringida para la web. La agenda general permite servicios/profesionales nuevos; la integración de Natalia mantiene su alcance específico. Esto corrige la preparación de pruebas, no amplía permisos del producto.
- La verificación completa incorpora compilación real de Natalia antes de arrancar servicios y su recorrido nativo después del perfil Cita Suite, de manera secuencial. Los intentos sintéticos del consultorio propio se aíslan entre perfiles funcionales; no se alteran umbrales ni se reinician contadores durante una prueba o una medición de carga.
- Revisión de acceso Cloudflare repetida: la sesión sigue mostrando la cuenta `fc592fdc570803acbf4b523d106e446e`, distinta del destino configurado. El binario local de Wrangler no reconoce `--profile`; esa consulta falló antes de acceder a otra cuenta. No se cambió el destino ni se desplegó nada.

- Se guardó el plan exacto de la respuesta aprobada del 2026-10-15 10:50:15 UTC: 28.290 caracteres; SHA-256 `67ab8f5726aaeaaae7025e3538d4ded7e24c7f9ea043ec7032dc377645faf5bd`. También se comprobó que la instrucción guardada coincide con la cita del pedido posterior. El chequeo de integridad forma parte de `verify:fast`.
- Reglas de dependencias: 598 módulos y 1.145 relaciones, sin violaciones. Seis pruebas del ejecutor/fronteras aprobaron: interfaces públicas permitidas, privados rechazados, navegador-servidor rechazado, ciclos rechazados y exclusión/herencia/liberación del bloqueo.
- Catálogo efectivo de PostgreSQL reconstruido: 387 funciones públicas/privadas y 61 tablas; guarda firmas, propietarios, privilegios, configuración y huellas de las funciones en `.verification/database-catalog.json`. No es el catálogo de producción.
- Última corrida amplia: ocho pruebas de navegador aprobadas, incluidas ayuda/revocación, reserva con recuperación y cuestionarios, imágenes privadas/visor/restauración, paginación y recepción, acceso comercial y navegación móvil. Se detuvo en el flujo operativo por un selector antiguo que buscaba el enlace en un párrafo; hoy está en un campo etiquetado. No constituye aprobación de las 23 pruebas.
- Se actualizaron las comprobaciones clínicas a los textos vigentes y se corrigió la concordancia de “Añadir documento clínico”. La limpieza del fixture ahora respeta las referencias de `clinical_upload_slots` y libera sus reservas bajo el bloqueo global antes de borrar archivos; no se debilitaron claves foráneas ni restricciones.
- Revisión de seguridad de los propios ejecutores: se añadió validación del destino antes de cargar E2E. Los entornos descartables deben coincidir con sus contenedores/etiquetas y conexión SQL; staging debe usar otro proyecto explícito. La limpieza del flujo operativo se limita al consultorio sintético seleccionado y al sufijo de esta corrida; ya no puede barrer todos los consultorios o ignorar errores de borrado.
- Las ejecuciones diagnósticas con `--grep` se registran separadamente y no cuentan como `verify:full`. Se acotan esperas de acciones, conservando tiempo de navegación para compilación fría; no se aumentan timeouts para ocultar elementos ausentes.
- Workflow manual de GitHub preparado con Node fijado, acciones fijadas por SHA, un único trabajo y sin despliegues ni secretos de producción. **No ejecutado en GitHub**: falta verificar acceso y activación sin tocar la rama de producción.
- Pendiente para la auditoría de UI: la papelera aún habla de imágenes aunque el producto admite PDF. No se considera eliminada esta inconsistencia por conservar textos históricos en las pruebas.

- Segunda reconstrucción, con funciones Auth en su propietario correcto: las 24 suites SQL y siete carreras volvieron a aprobarse. GoTrue arrancó. Se sustituyó la inserción SQL incompleta de usuarios por su creación a través de la API real y el login por contraseña; no se completan campos internos del proveedor a mano.
- Primera ejecución de navegador con GoTrue real: inició 23 pruebas locales; se detuvo al diagnosticar que GoTrue emitía un rol vacío por faltar `GOTRUE_JWT_DEFAULT_GROUP_NAME` en el fixture. PostgREST rechazaba las sesiones. Corrección preparada: grupo `authenticated`, rol explícito al crear las dos identidades base y comprobación de identidad/rol/membresía RLS antes del navegador. Pendiente repetir. No es evidencia de falla del despliegue remoto ni de una corrección ya verificada.
- Inventario local reproducible: 636 archivos de código/pruebas, 167 archivos de rutas, 97 migraciones, 24 suites SQL y siete scripts de carreras, 14 archivos E2E. Recibo: `.verification/inventory.json`. Los recuentos no acreditan funciones SQL activas ni cobertura completa.

- El plan original y la instrucción se copiaron directamente de los mensajes originales registrados, no se reconstruyeron de memoria. Se verificó igualdad del texto y se guardaron huellas SHA-256.
- Los artefactos de verificación permanecen separados del plan. Los registros temporales aún deben consolidarse en evidencia durable antes del cierre.
- Sin herramienta de navegador gestionado expuesta en esta sesión: las verificaciones autorizadas usarán el Playwright ya instalado en el repositorio. No se atribuirá esa evidencia al plugin Browser ni a un despliegue real.

## Bloqueos y límites conocidos

- Candidato para la etapa 4, todavía sin cerrar como defecto reproducido: comprobar el límite máximo **después** del redondeo al múltiplo. Por ejemplo, un importe exacto de 1.000.000.000.000 y unidad 6 puede redondearse a 1.000.000.000.002. Los calculadores actuales comprueban el importe acumulado antes de redondear; las pruebas de paridad deberán impedir cotizaciones finales fuera del rango admitido.

- La consulta anterior de despliegues Cloudflare falló por discrepancia entre cuenta autenticada y cuenta configurada. Resolver acceso al destino correcto antes de staging remoto; no cambiar la cuenta para eludirlo.
- La cuenta activa inicial de GitHub no tenía permisos administrativos. Se encontró una segunda sesión ya autorizada (`Juan4787`) y se verificaron permisos de administración/escritura y Actions habilitado mediante una invocación aislada, sin cambiar la cuenta global ni imprimir credenciales. Este bloqueo de acceso está resuelto. Falta verificar que subir la rama aislada no active despliegues a producción; no se ejecutó carga externa.
- No hay evidencia de capacidad del Supabase alojado ni del perfil Free. Los objetivos de latencia y diez minutos siguen pendientes de medición.

## Próximo trabajo, en orden

1. Completar la etapa 2: generación de tipos desde la base reconstruida, clientes activos, validación JSON y contexto/autorización por petición.
2. Continuar capacidades/cuotas, disponibilidad/aranceles, áreas/interfaz y tareas según el plan íntegro.
3. Completar staging, capacidad, release y auditoría transversal. Los bloqueos de acceso no convierten esas pruebas en aprobadas.

## Actualización del 15 de octubre — continuación verificada

- Última corrida completa anterior: 19 de 23 pruebas de navegador aprobadas; falló una comprobación antigua que suponía un atributo de cierre en el fondo del modal. Se corrigió la prueba para efectuar un clic real fuera del diálogo y comprobar que permanece abierto, seguido del cierre con la X.
- Diagnóstico posterior: las cinco pruebas de seguimientos aprobaron en 18,7 segundos, incluida creación y edición con paciente/profesional reales del fixture. Se eliminaron salidas tempranas que podían presentar un recorrido sin datos como aprobado. Evidencia: `/tmp/cita-refactor-followups-diagnostic.log` y `.verification/browser-diagnostic.json` (diagnóstico; no equivale a suite completa).
- Los diagnósticos permiten preparar migraciones/Auth/Storage sin repetir las suites SQL ya comprobadas; el recibo marca `sqlVerified: false`. `verify:full` exige el recibo con SQL ejecutado y nunca usa ese atajo.
- La limpieza de la carrera de cargas elimina primero sus slots y libera reservas bajo el bloqueo global, preservando referencias y propagando errores de limpieza.
- Se releyeron el plan íntegro y este registro después de la compactación; el siguiente punto pendiente es la corrida completa, no volver a preparar lo ya cerrado.
- Se completó la identificación de aplicaciones, destinos, proveedores y automatismos en `docs/architecture/base-de-campana.md`. La matriz funcional vincula roles, contratos y pruebas. La integración GitHub de Cloudflare existe aunque no haya webhooks clásicos; falta comprobar su configuración antes de subir una rama para CI.
- La corrida siguiente volvió a aprobar tipos, 1.108 pruebas unitarias y las 24 suites SQL/siete carreras. Se detuvo en la navegación hacia información previa: la captura final muestra la pantalla correcta, pero la prueba no esperaba la navegación antes de comprobar el encabezado. Corrección: sincronización explícita con la URL de destino; sin eliminar comprobaciones ni aumentar la espera de contenido. Diagnóstico específico en curso.
- Ocho pruebas nuevas de los guardas del ejecutor aprobaron: rechazo de destinos implícitos/ajenos, cuenta SQL de staging y reportes de navegador vacíos, contradictorios, interrumpidos, omitidos o reintentados. Evidencia: `/tmp/cita-refactor-report-guards.log`.
- El ejecutor principal ahora escribe un recibo fallido al iniciar y tras cada paso, mediante reemplazo atómico; una interrupción ya no puede dejar vigente el éxito de una corrida anterior. Propaga cancelación a sus procesos y espera limpieza. Pruebas nuevas de propagación/interrupción y compilación real de Svelte pendientes de ejecución secuencial.
- Las 21 pruebas actuales del ejecutor aprobaron, incluyendo compilación real de un componente Svelte que intenta importar servidor, rechazo de ese import, cancelación de procesos y cuatro guardas de staging. La última corrida completa ya volvió a ejecutarlas satisfactoriamente. El recibo se conserva también por identificador de corrida, evitando sobrescribir el historial.
- Se ejecutó `verify:release` sin descriptor aislado como prueba negativa: salida 1, `ok: false`, cero pasos iniciados y mensaje explícito de ausencia de staging. No hubo compilaciones ni peticiones remotas. Esto verifica el cierre seguro del preflight; **no acredita un release real**.
- Nueva falla causal del ejecutor: el límite de acción de 15 segundos también abarcaba la navegación automática del clic de login. La captura y el contexto muestran que el profesional llegó correctamente a “Mis turnos”. Se centralizó el login E2E: clic sin espera de navegación implícita y espera explícita de URL con el presupuesto de navegación; se preservan todas las comprobaciones posteriores de permisos/contenido. Corrida completa en curso para comprobarlo.
- La guía `docs/architecture/verificacion.md` documenta entornos, recursos, lease, evidencia, diagnósticos, exclusiones de OAuth externo y límites de lo comprobado. El cierre de staging y de capacidad continúa pendiente.
- La corrida posterior resolvió el login, pero la prueba clínica monolítica llegó a su límite total de 120 segundos durante la lectura de papelera restringida. Se dividió en recorridos independientes con fixture propio por prueba: carga/visor en escritorio y móvil, contribución profesional, papelera/restricción/restauración/auditoría y paginación/recepción. Se conservan las aserciones y el límite por prueba. El caso de recepción ahora prepara un archivo real en su propio fixture para evitar que una ficha vacía aparente demostrar privacidad. Diagnóstico de las cuatro pruebas en curso; todavía no aprobado.
- La CLI de Supabase identificó dos proyectos activos y dos pausados en dos organizaciones. Esto no prueba su plan comercial ni que alguno esté vacío. Se solicitó identificar un staging separado autorizado; no se activó, creó ni reutilizó ningún proyecto.

## Continuación después de la interrupción

- Se releyó el plan original y se comprobó su integridad. No quedan procesos ni contenedores propios de verificación activos. Los archivos de `/tmp` anteriores ya no están disponibles; los recibos y resultados conservados en `.verification/` sí permanecen. No se los reemplaza por una suposición de éxito.
- Durante el diagnóstico local se observaron 447 MB de memoria disponible y los 2.047 MB de swap ocupados. Vite consumía aproximadamente 1,16 GB RSS, aun sin suites paralelas. La presión de memoria obliga a trasladar navegador y plataforma completa al runner externo previsto en el plan. Se añadió un guarda que rechaza integración/demo/fixture en la máquina local; la verificación liviana exige memoria disponible antes de cada proceso. Sus dos pruebas negativas aprobaron.
- El diagnóstico clínico interrumpido no aprobó: su recibo conserva cero aprobadas, un fallo de conexión con Auth y tres no ejecutadas. No se atribuye ese resultado de infraestructura a un defecto funcional del producto.
- Cloudflare sigue autenticado en otra cuenta; se repitió únicamente `whoami`, sin desplegar. Como el repositorio original tiene una integración de despliegue que no se puede verificar todavía, se prepara un repositorio auxiliar de CI aislado para los mismos runners/contratos aprobados. No sustituye la infraestructura de Cita Suite ni recibe credenciales de producción. La copia se limita al código necesario y contratos de prueba, sin adjuntos privados, archivos `.env`, evidencias ni cambios del índice/rama del usuario.
- Repositorio auxiliar creado: `https://github.com/Juan4787/cita-suite-verificacion`, público para usar el runner estándar gratuito previsto. Se comprobaron cero despliegues, webhooks y secretos. Se subió exclusivamente una copia de código de 751 archivos/6,05 MB; no se subió nada a `Juan4787/dashboard`. La integración Actions está habilitada, pero todavía no registró el workflow manual; se diagnostica esa activación antes de declarar una corrida externa.
- La evidencia se conserva como paquete acotado y verificado por SHA-256 dentro de los logs gratuitos. No se utiliza el almacenamiento facturable de artifacts ni se contratan runners mayores. El código de empaquetado/recuperación queda versionado para próximas auditorías.

## Comprobación final obligatoria

### Etapa 2: generación y contexto en curso

- Generador preparado con el mismo motor oficial de la CLI fijada: `postgres-meta:v0.98.0`. Comprueba propiedad/red del contenedor, no acepta destinos remotos, genera dos veces y compara antes de exportar/comprobar/escribir atómicamente. La primera exportación se incorpora al archivo compartido y luego el nivel completo exigirá `--check`; responsable: campaña, vencimiento: antes del cierre de etapa 2. Todavía no se considera generada ni reproducible hasta obtener el recibo real.
- La corrida `38826733120`, fuente `215b1feadb7fbc15b859784c28e87cf952200134`, agotó correctamente cinco intentos de descarga porque ECR respondió `Data limit exceeded`. No ejecutó pruebas de aplicación. Se comprobó por las APIs OCI que los cuatro manifiestos de Docker Hub oficial son idénticos a las imágenes ECR de la corrida aprobada; se fijaron esos digest. La imagen nueva del generador también queda fijada por digest. No cambian versiones ni contratos del fixture.
- Se eliminó la caché global de membresías. La reutilización queda limitada al objeto de cookies de una petición y a la misma identidad/token. El modo `fresh` fuerza una lectura nueva. Dos pruebas adicionales verifican cambio de rol/revocación entre peticiones e identidad/token cambiados; las pruebas originales se adaptaron al contrato aprobado conservando sus comprobaciones de coalescencia y expiración. Los 18 casos iniciales aprobaron y, después de añadir validación JSON negativa, aprobaron los 25 casos del archivo `business.test.ts`. Evidencia local: `.verification/stage2-business-tests.log`.
- Contextos JSON inválidos y suscripciones de otro consultorio se rechazan explícitamente antes de intentar un alta. Los mensajes no incluyen los datos recibidos. La comprobación de tipos encontró una incompatibilidad en la guarda inicial de objetos; se corrigió con una guarda que comprueba la estructura y permite el estrechamiento de TypeScript, sin conversiones ciegas. Repetición de tipos en curso.
- Se corrigió el directorio de salida de Playwright por perfil/corrida para que la demo no borre capturas del perfil previo. Pendiente comprobar su preservación en la próxima ejecución externa.

### CI externo: primera ejecución y corrección de preparación

- Workflow manual registrado y ejecutado en el repositorio auxiliar: [corrida 38825130254](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/38825130254), fuente `6015b87c6e0020a1137584ada7e9ba15f5467df6`. Instalación y comprobación de recursos aprobadas. La descarga de PostgreSQL terminó, pero ECR rechazó la de Storage con `toomanyrequests: Rate exceeded`. **No se ejecutaron pruebas de aplicación.** Registro conservado en `.verification/remote-first-failure.log`.
- Se incorporaron reintentos secuenciales acotados para errores transitorios de transporte/registro, con esperas de 15, 30, 60 y 120 segundos. No se cambian las imágenes ni se reintentan errores permanentes. La preparación deja recibo fallido desde el comienzo, aun si no puede iniciar pruebas. Dos pruebas unitarias comprobaron recuperación, límite de cinco intentos y rechazo inmediato de un tag inexistente; ambas aprobaron. Integridad del plan comprobada nuevamente.
- El guardado de evidencias de la primera corrida también falló porque no se había generado ningún recibo antes del rechazo del registro; esto no constituye un segundo defecto de la aplicación. El nuevo recibo de preparación permite conservar esa distinción en futuros fallos.
- Segunda corrida externa iniciada: [38825775890](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/38825775890), fuente `ccb30d4a0f03315128085da3a350392907da5850`. Preparación de imágenes/navegador aprobada; pruebas secuenciales en ejecución. Tres pruebas adicionales del empaquetado/recuperación aprobaron localmente con archivos descartables: conservación del fallo y redacción de credenciales, rechazo de alteración/rutas inseguras y rechazo de evidencia ausente. Se incorporaron al comando rápido para la próxima copia de CI; no se atribuyen a esta fuente anterior.
- Resultado definitivo de esa corrida: **aprobado**, recibo `df638b05-e5e8-45a1-9fb0-f02cbefd3f5f`, 23:50:40–23:54:22 UTC. Los 25 casos productivos locales y dos de demo aprobaron sin omisiones, fallos ni reintentos. Natalia aprobó navegación nativa en escritorio/móvil, gestión en Cita Suite, tema Natalia, recuperación sin duplicación y compatibilidad del recibo anterior. Evidencia recuperada en `.verification/remote-38825775890/`; paquete SHA-256 `b3e8ccf676cd9008f47dba664eeb51e8a3bbd1e99845c6494e8df23f387ddc46`. ZIP de logs y revisión remota comprobados. No es un despliegue real ni prueba de capacidad alojada.
- Antes de iniciar la etapa 2 se releyó el plan íntegro y se contrastó este registro. No se modifica ni reduce su alcance: la validación de release/staging remoto sigue exigida para el cierre final y requiere el entorno separado pendiente.

Antes de finalizar, transformar cada condición del plan original en una fila con resultado, evidencia y limitación. Ninguna fila pendiente equivale a aprobada. Este apartado todavía no constituye esa auditoría final.
