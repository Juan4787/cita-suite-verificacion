# Cómo añadir una función a Cita Suite

Esta guía aplica al monolito y a sus seis áreas; no propone plugins, una base por consultorio ni servicios nuevos por funcionalidad. El [plan aprobado](../plans/refactorizacion-cita-suite.md) y sus garantías prevalecen. No hay cierre por cantidad de archivos movidos ni por un test que sólo busque texto en el código.

## Delimitar la responsabilidad antes de programar

Escribir el recorrido concreto: actor, consultorio, acción, resultado persistente y efecto observable. Elegir un área propietaria en [áreas y fronteras](areas-y-fronteras.md). Que una pantalla muestre datos de dos áreas no cambia su propiedad: Equipo administra prestaciones/horarios, Agenda calcula opciones/reserva, Pacientes conserva clínica y Sitios presenta/conecta el turnero.

Reutilizar una entrada pública existente cuando la responsabilidad coincida. Crear una operación pública si concentra validación, lectura/proyección, autorización o coordinación necesarias; no añadir un archivo que sólo reenvíe otra función. Los detalles internos permanecen dentro del área. Los contratos puros que usa el navegador viven fuera de `server/`; nunca importar un servidor por comodidad, tampoco como type-only. `dependency-cruiser` comprueba frontera privada, ciclos de tipos/ejecución e importaciones del navegador.

## Especificar contrato y autoridad

| Pregunta | Decisión que documentar |
|---|---|
| ¿Quién puede leer y escribir? | Identidad, rol, consultorio, acceso histórico y estado comercial. La pantalla no es la autoridad. |
| ¿Qué habilita la función? | Disponibilidad global, habilitación del consultorio, configuración y permisos efectivos del actor. Son dimensiones distintas. |
| ¿Qué datos acepta/devuelve? | Tipos efectivos, máximos, campos obligatorios, JSON válido y error explícito para incompletos. |
| ¿Qué debe confirmarse junto? | Transacción SQL para las invariantes y efectos persistentes; sin secuencia de HTTP que aparente atomicidad. |
| ¿Qué pasa si cambia la autoridad? | Comprobar permiso vigente durante la escritura y probar revocación/cambio de rol concurrente. |
| ¿Qué pasa al reintentar? | Idempotencia cuando corresponda, tratamiento de resultado incierto y recuperación sin duplicar efectos. |
| ¿Cómo escala? | Paginación/ventanas/presupuesto por operación, límites de consultas y recursos medidos. Nunca lista parcial presentada como completa. |

Usar fábricas Supabase tipadas y tipos generados desde todas las migraciones de la base descartable. Un tipo genérico no valida JSON en ejecución. Tratar transporte, Local Storage, FormData y RPC JSON como entrada desconocida. No eliminar filas inválidas con filter() para fabricar un éxito parcial; distinguir vacío legítimo, fallo y proyección incompleta.

En la base reconstruida por Cita Suite, una tabla, vista o secuencia nueva en `public` no recibe permisos por sí sola: `20261021020000` establece privilegios predeterminados explícitos, independientemente de los valores del proveedor. Al publicar, esa migración debe estar aplicada también en el destino. La migración de cada objeto habilita RLS, revoca todo a `public`, `anon`, `authenticated` y `service_role`, y otorga exactamente lo que cada rol usa. Una vista que lean usuarios lleva `security_invoker`. `anon`, la clave pública del navegador, no recibe tablas: el navegador llega a los datos por el servidor. `api_exposure_explicit.sql` lo comprueba.

Las relaciones entre entidades de consultorios llevan integridad compuesta cuando corresponda. Las funciones privilegiadas declaran search_path seguro y privilegios explícitos; comprobar llamadas directas que eviten la UI. Si la regla necesita una autoridad estable mientras escribe, definir sus bloqueos y su orden. No esperar una llamada a Storage/proveedor dentro de una transacción abierta. Un NOWAIT deliberado debe traducirse a una recuperación clara y tener prueba de concurrencia, no un bucle de reintentos inmediato.

Una función usada en una restricción, un valor por defecto, una política o una vista se ejecuta con los privilegios de quien lee o escribe la fila. Todo rol que pueda usar la tabla necesita `EXECUTE` sobre ella; lo comprueba `write_expression_privileges.sql`.

Un identificador de la URL o del formulario se valida con `isUuid` de `@cita-suite/shared/uuid` antes de consultar, y uno mal formado responde 404, nunca 500 ni 503. La guarda `uuid-pattern.test.mjs` impide copias propias del patrón.

**Postergado: comparadores de parámetros de ruta (`[id=uuid]`).**
- **Por qué:** hoy cada ruta valida su identificador y responde 404. Pasar las 22 carpetas `[param]` a comparadores cambia nombres de rutas, importaciones y pruebas, y no agrega comportamiento.
- **Riesgo residual:** una ruta nueva que olvide validar deja llegar un identificador mal formado a PostgreSQL (22P02) y responde un error en vez de 404. No expone datos: los permisos y RLS siguen aplicando.
- **Retomar:** al reorganizar las rutas o cuando se agreguen varias rutas nuevas con identificadores.

## Mantener controladores y UI comprensibles

Una ruta lee parámetros y contexto, verifica el acceso pertinente, llama la operación y traduce su resultado HTTP. Las reglas compartidas no se duplican entre el endpoint público, el interno, el preview y la pantalla. PostgreSQL confirma reservas/precios/cuotas; el calculador TS compartido produce opciones; el cliente valida de manera orientativa y presenta estados.

Separar componentes por tarea y por quién posee su estado. Un formulario posee campos, validación, envío y errores; un coordinador conserva sólo lo que debe sobrevivir al cambiar de tarea y el guardado conjunto cuando exista. No dividir visualmente para perder una transacción ni crear dos calendarios mentales al configurar una misma jornada.

Un resultado exitoso reconoce los datos **enviados**, no cambios hechos mientras esperaba la respuesta. Preservar token/revisión de apertura durante un conflicto; un409 no autoriza sobrescribir datos ajenos adoptando silenciosamente la revisión nueva. Cancelar solicitudes y descartar resultados tardíos al cambiar paciente, profesional, actor o consultorio. Si la operación pudo confirmarse y se perdió la respuesta, ofrecer revisión/recuperación en vez de permitir un doble envío ciego.

Conservar controles personalizados, semántica y temas. Primero datos obligatorios; después opcionales. Una marca cambia presentación, nunca permisos ni reglas. La web de Natalia navega al turnero real; no copia una segunda lógica de reservas. Retornos/orígenes son contratos validados y las notificaciones/gestión conservan su origen.

## Verificar según la garantía

| Capa | Qué comprueba | Qué no acredita por sí sola |
|---|---|---|
| Unidad con SDK real y transporte simulado | Payload, selección de contrato, proyección, error/recuperación y ausencia de fallback indebido | Persistencia/RLS/concurrencia reales. |
| Componente real | Interacciones, estado del borrador, foco, error y respuesta tardía | Geometría de navegador ni guardado SQL. |
| SQL descartable con claims sintéticos | Funciones/RLS/constraints, transacciones y bloqueos reales | GoTrue ni capacidad alojada. |
| Auth/Storage reales descartables + navegador | Cookies/sesión, HTTP, render, persistencia y lectura posterior | Despliegue/CPU/cuotas de Cloudflare/Supabase alojados. |
| Artefacto construido y staging | Dependencias de build, configuración/origen/destino y comportamiento desplegado | Volumen de25 consultorios sin ensayarlo. |
| Carga controlada | Capacidad y latencias del escenario/entorno medidos | Escala ilimitada o ausencia universal de fallas. |

No escribir tests que sólo repitan la implementación. Elegir casos que fallen si se pierde una garantía: consultorio ajeno, revocación, JSON incompleto, respuesta perdida, token viejo, mes/fecha límite, restricción vacía o cuota comprometida. Si se modifica SQL, reconstruir desde cero y ejecutar sus pruebas, no deducir éxito de una migración que compila. Las carreras usan dos conexiones controladas en una sola prueba; observar el bloqueo/resultado que demuestra la condición.

Para UI, cubrir320/390/768/1280/1600, claro/oscuro, teclado/foco, carga/error/vacío y contenido largo. Conservar capturas representativas de cada superficie y una matriz comprobable; distinguir fallos inyectados de recuperación real. Una confirmación de pantalla requiere lectura posterior en backend cuando se afirme persistencia.

## Interfaz y pruebas de navegador

- **Layouts con texto junto a acciones o estados.** `overflow-wrap: anywhere` es global: cualquier texto puede comprimirse hasta letras sueltas sin desbordar la página. Dar `min-w-0` a la columna flexible y `shrink-0` (o grid) a los grupos de acciones y estados. Cuando varios elementos comparten una fila angosta, usar `flex-wrap` con una base explícita (por ejemplo `flex-[1_1_12rem]`) para que la acción pase debajo en vez de comprimir el texto.
- **Texto que no se corta:** duraciones con `formatDuration`, contadores de pasos con `formatStepCounter` y el «·» unido al grupo siguiente con `·&nbsp;`. Dentro de `main` y de los diálogos no se trunca con «…»; una excepción revisada lleva `data-truncation="allowed"`.
- **Cubrir la pantalla con `layoutIssues`** (`apps/web/e2e/helpers/layout-usability.ts`) en 320/390/768/1280/1600. Acumular los problemas de todas las combinaciones y afirmarlos una vez. El selector de controles nombra los controles operables, no las fuentes nativas invisibles `.ux-native-source`.
- **Capturas que certifican una tarea:** `alignTaskForCapture` antes de la captura; si una región corregida queda fuera de la tarea (cabeceras, encabezados), capturarla aparte.
- **Controles que requieren JavaScript:** deshabilitados hasta hidratar (`createClientReadiness`). En las pruebas, un único clic y la verificación de su efecto. Nunca un reintento `toPass` alrededor de un clic.
- **Respuestas lentas o fallidas:** compuertas deterministas con `page.route` (una promesa que se libera después de verificar la carga), nunca esperas fijas. No retirar el handler mientras hay una petición retenida.
- **Fixtures:** `e2e/helpers/fixture-db.ts` (cliente tipado, `must` exige fila y `write` para escrituras y limpiezas). Ningún error de preparación o limpieza se ignora. Leer JSON con `toMatchObject`, sin `any`.
- **Sesiones:** un spec con varios casos sobre la misma identidad usa `loginWithSharedSession`. Los límites reales de ingreso (5 por correo y 40 por IP cada 15 minutos) siguen activos.

## Ejecutar y dejar evidencia

- `pnpm verify:fast`: tipos de ambas aplicaciones/shared **y de las pruebas de navegador**, guardas, fronteras, unidades de servidor/cliente.
- `pnpm verify:full`: lo anterior más exportación nativa, reconstrucción SQL, concurrencia, Auth/Storage, navegador, demo y comparación de JS de Natalia.
- `pnpm verify:release`: lo anterior más builds y puertas de staging/release. No sustituirlo por un nombre similar de script.

La máquina local tiene RAM muy limitada. Usar CI externo para suites/builds/SQL/navegador; un trabajo, un worker, sin suites pesadas paralelas. No ejecutar los comandos pesados localmente sólo porque exista memoria disponible en un momento. La preparación de snapshots preserva HEAD/index y excluye credenciales; push sólo al auxiliar de verificación mientras el principal pueda disparar despliegues.

Una suite obligatoria vacía, omitida, cancelada o con fallos impide el verde. Registrar SHA/digest, entorno, recibo, pruebas ejecutadas, resultado, captura/paquete/hash y alcance real. Después de una corrección repetir los casos fallidos y la regresión pertinente sobre la revisión final; no reutilizar el verde de una revisión anterior para código nuevo.

Actualizar catálogo de contratos y matriz funcional cuando cambie una interfaz. Añadir migraciones compatibles sin editar las aplicadas; si cambia una firma, documentar transición de consumidores/privilegios. Mantener datos clínicos/tokens/URLs firmadas fuera de logs y evidencias públicas. Los contadores HTTP a Supabase no son contadores de sentencias SQL; medir/nombrar cada capa correctamente.

## Cierre de una entrega

Indicar problema, comportamiento resultante, archivos/operaciones responsables, pruebas y límites. Dejar decisiones y desviaciones justificadas en el registro de campaña. Preparar destino, sumas, migraciones, respaldo y reversión compatibles antes de publicar. No contratar recursos ni tocar otros productos por compartir cuenta. Cursos y noticias de Natalia siguen fuera del alcance actual.

Antes de continuar una etapa de esta campaña, leer de nuevo **todo** el plan original y contrastar registro/evidencia; después de compactar también. El documento original no se reconstruye de memoria ni se reduce para ajustar una implementación incompleta.
