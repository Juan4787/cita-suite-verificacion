# Mantenibilidad y crecimiento de Cita Suite

Revisión del código versionado en `313355a4403e850379ace72bb4f37cd1c7952142`. Fecha: 2026-10-15. Alcance: arquitectura de Cita Suite, frontera con Natalia, acceso a datos, contratos, pruebas, tareas automáticas y documentación. Revisión estática y de configuración local; sin modificaciones funcionales, consultas a datos de producción ni pruebas de carga. Las pruebas ejecutadas en entregas anteriores no se cuentan como nuevas pruebas de esta revisión.

Actualización de alcance: el usuario confirmó tres o cuatro consultorios adicionales a corto plazo, 25 como horizonte concreto y la intención de cerrar la deuda estructural conocida antes del uso real. La [evaluación de la propuesta externa y hoja de ruta revisada](2026-10-15-architecture-proposal-review.md) eleva capacidades, cuotas por consultorio y tipado completo a requisitos de esa campaña; sustituye las prioridades iniciales donde difieren.

## Dictamen

La base tecnológica es adecuada y se puede conservar. La aplicación presenta una mantenibilidad desigual: tiene módulos reutilizables y garantías transaccionales importantes, pero también rutas y componentes que concentran demasiadas responsabilidades. Seguir agregando funciones a esos puntos aumentaría el trabajo de regresión y la dependencia de conocer excepciones históricas.

La capacidad de servir más tráfico no puede certificarse contando archivos. Workers permite distribuir ejecución HTTP, mientras que la base, las integraciones externas y el presupuesto de archivos siguen siendo recursos compartidos. No se midió un máximo de consultorios o pacientes. El objetivo histórico de capacidad no equivale a una prueba realizada ni a una garantía de costos.

La intervención recomendada es modularizar progresivamente la aplicación existente, conservando transacciones, rutas públicas y contratos. No hace falta una reescritura ni introducir servicios distribuidos para resolver los problemas observados.

## Inventario y método

Se contaron archivos obtenidos con `git ls-files`, con extensiones de código y estilos, dentro de las carpetas indicadas. Se excluyeron dependencias, artefactos compilados, carpetas locales sin seguimiento y la maqueta histórica. Líneas incluye comentarios y espacios; no mide complejidad ciclomática ni cobertura de pruebas.

El [inventario de evidencia](evidence/2026-10-15-maintainability/inventory.json) registra revisión, método, recuentos, archivos principales y límites del análisis.

| Área | Archivos | Líneas | Observación |
|---|---:|---:|---|
| `apps/web/src` | 456 | 84.607 | 149 archivos y 24.634 líneas de pruebas |
| Código y estilos de Cita Suite, excluyendo esas pruebas | 307 | 59.973 | 35 archivos superan 500 líneas y 14 superan 1.000 |
| `apps/natalia/src` | 33 | 3.238 | 2.070 líneas corresponden a `public.css`; sus pruebas de navegador viven fuera de `src` |
| `packages/shared/src` | 7 | 5.920 | 5.675 líneas de tipos generados; 245 líneas restantes |
| Migraciones SQL | 97 | 23.931 | Historia de cambios, no tamaño del esquema efectivo ni consultas ejecutadas por petición |

También hay 52 páginas Svelte, 52 módulos `+page.server.ts`, 55 endpoints `+server.ts` y cuatro layouts de servidor. Las 97 migraciones contienen 274 declaraciones de función con 200 nombres distintos; esto incluye redefiniciones legítimas y posibles sobrecargas, no 274 funciones activas independientes.

Un recuento textual de `as any` y anotaciones `: any` encontró 206 apariciones en código de `apps/web/src` y `packages/shared/src`, excluyendo pruebas. Es un indicador de fronteras débilmente tipadas; no prueba 206 errores. Un análisis heurístico de imports estáticos no encontró ciclos de ejecución entre esos archivos; excluye imports dinámicos y reexportaciones y no es una certificación completa del grafo.

## Bases que conviene preservar

1. **Motor público compartido.** `PublicBookingFlow.svelte` y `public-booking-page.ts` sirven a las rutas pública e integrada. Natalia navega al mismo turnero y no mantiene una segunda agenda o una copia del proceso de confirmación.
2. **Reglas críticas en transacciones.** Identidad del paciente, idempotencia, revisiones, exclusión temporal y fotografías históricas de condiciones tienen soporte SQL. La migración de turnos conjuntos incluye exclusiones GiST por profesional. Extraer componentes no debe trasladar esas garantías al navegador.
3. **Cálculo de disponibilidad separado de HTTP.** `lib/availability/calculate.ts` trabaja con estructuras de datos sin depender de una página. Es una frontera útil para pruebas y evolución.
4. **Paginación y contexto ya presentes.** `patient-list.ts` utiliza páginas de 30 filas, cursores y revisión de datos; `patient-list-cursor.ts` vincula el cursor a consultorio, búsqueda y archivo. `odonto-context.ts` centraliza parte de la sesión y el consultorio; `booking-integration-request.ts` comparte resolución dentro de una petición.
5. **Pruebas reales de base disponibles.** Además de pruebas con servicios simulados, `test-booking-foundation.mjs` reconstruye migraciones en una base descartable y ejecuta contratos SQL. Su existencia no significa que se ejecute en cada publicación.
6. **Tareas con reclamación atómica.** Push y mensajería ya utilizan RPC para reclamar trabajos. No corresponde describir el sistema como carente de colas o proponer reconstruir esa capacidad sin necesidad.

## Hallazgos estructurales

### M1 — Prioridad alta: responsabilidades concentradas en componentes y rutas

Ejemplos medidos:

| Archivo | Líneas | Responsabilidades observadas |
|---|---:|---|
| `routes/odonto/profesionales/[professionalId]/+page.svelte` | 1.669 | Perfil, servicios, aranceles, horarios, excepciones, borradores y navegación |
| `routes/turno/[token]/+page.svelte` | 1.641 | Gestión del turno, estados de push, permisos, recuperación por dispositivo, calendario, almacenamiento y eventos del navegador |
| `routes/odonto/pacientes/[id]/+page.svelte` | 1.630 | Interfaz de ficha, datos, historial y acciones relacionadas |
| `components/agenda/ManualAppointmentWizard.svelte` | 1.383 | Selección y estado del asistente de reserva manual |
| `routes/odonto/pacientes/[id]/+page.server.ts` | 1.321 | Carga, permisos, lectura clínica, validación, actualización, archivo e historial de cambios |
| `booking/PublicBookingFlow.svelte` | 1.010 | Selecciones, navegación, estados y formulario público |

El tamaño es una señal; la causa del riesgo es mezclar procesos con distintos motivos para cambiar. Por ejemplo, cambiar una guía de permisos de Android obliga a revisar un archivo que también gestiona calendario y datos del turno.

**Recomendación:** extraer componentes por responsabilidad y controladores de estado con interfaces pequeñas. En la gestión pública: resumen y acciones del turno, controlador de notificaciones, controlador de calendario y vistas de recuperación. En profesionales: perfil, prestaciones/aranceles y horarios. Mantener la composición y experiencia actuales durante la extracción.

### M2 — Prioridad alta: acceso a datos y casos de uso mezclados con HTTP

47 archivos de rutas contienen llamadas directas `.from(...)` o `.rpc(...)`: 181 sitios textuales de `.from` y 43 de `.rpc`. Estos números no indican llamadas realizadas en una navegación. Acceder a Supabase desde una ruta corta puede ser razonable; el problema aparece en rutas con autorización, normalización, varias escrituras y tratamiento de conflictos.

La ficha del paciente declara su propio `resolveBusinessActionContext`, además de existir `getOdontoContext`. El archivo de profesionales contiene 26 sitios de `.from` y cuatro RPC. Una nueva entrada al mismo caso de uso puede terminar copiando esa orquestación.

**Recomendación:** rutas delgadas que traduzcan HTTP a operaciones de un módulo. Casos de uso como actualizar una ficha o guardar horarios deben poseer su validación, contexto y resultado tipado. Los adaptadores de Supabase se ubican detrás de esa frontera. Evitar un repositorio CRUD genérico para toda la aplicación: los permisos y transacciones son específicos del dominio.

### M3 — Prioridad alta: tipos generados que no protegen el acceso central a la base

`packages/shared/src/database.types.ts` existe y contiene tablas y RPC recientes. Sin embargo, las fábricas de `supabase.ts` devuelven `SupabaseClient` sin el parámetro `Database` y crean clientes sin ese genérico. También hay `SupabaseClient<any, any, any>` y resultados públicos como `appointment: any` y `policies: any[]`.

Por eso, tener TypeScript estricto no garantiza que un cambio de columna o contrato RPC señale todos sus consumidores durante la compilación. Los escapes `as never` y `as any` merecen revisión, especialmente en las fronteras de persistencia.

**Recomendación:** introducir clientes tipados por etapas, tipos de consulta reales y modelos de entrada/salida de los casos de uso. Validar datos externos en ejecución. Regenerar tipos junto con cambios de esquema y comprobar su sincronización. No aceptar una migración masiva que haga compilar mediante nuevas conversiones ciegas.

### M4 — Prioridad alta: verificación dispersa y poco reproducible como proceso único

El comando raíz `pnpm test` ejecuta la suite de servidor de web; su configuración excluye `*.client.test.ts`. No incluye contratos SQL ni pruebas de navegador de Natalia. `pnpm check` tampoco incluye Natalia. Las suites adicionales existen, pero requieren conocer y ejecutar otros comandos. No se encontró un pipeline completo versionado en `.github`; esto no permite afirmar qué automatizaciones externas están configuradas.

Playwright fija un trabajador. Los dos configs de Vitest no fijan un límite equivalente; la disciplina de bajo consumo depende de que quien ejecute recuerde los flags. Además, el script de pruebas permite una ejecución sin tests con `--passWithNoTests`. Hay pruebas de migraciones que verifican texto SQL: son útiles para inspeccionar contratos de despliegue, pero no sustituyen la ejecución de transacciones y permisos.

**Recomendación:** un proceso secuencial versionado que cubra tipos, pruebas de dominio/servidor, componentes, SQL relevante y recorridos críticos. Separar verificación rápida por cambio de verificación completa de publicación. El comando de publicación debe fallar si una suite obligatoria no encuentra pruebas. Conservar pruebas SQL de ejecución y de concurrencia donde protegen invariantes, sin crear tests de cada detalle interno.

### M5 — Prioridad media-alta: presentación dependiente de detalles concretos del tema

`BookingAppearance.svelte` cambia colores seleccionando clases como `text-[#a78bfa]` y `bg-[#7c3aed]`, y contiene 21 usos de `!important`. Si una pantalla cambia sus clases, otra apariencia puede dejar de heredar el resultado esperado. Además, `public-booking-page.ts` relaciona el modo compacto y el salto de profesional con `integration.theme === 'natalia'`, aunque hoy está limitado al marco heredado.

**Recomendación:** roles visuales semánticos consumidos por componentes comunes: fondo, superficie, texto, acción, error y foco. Separar identidad visual, modo claro/oscuro, contexto de navegación y opciones de presentación. Agregar una marca no debería modificar las decisiones de reserva. Mantener compatibilidad de SDK y URLs existentes.

### M6 — Prioridad media-alta: las tareas independientes comparten presupuesto de ejecución

`internal/jobs/send-push-reminders/+server.ts` procesa push, solicitudes de reseña y sincronización de Google Calendar en secuencia. Cada operación tiene captura de errores independiente, lo cual evita que una excepción cancele las siguientes. Sin embargo, comparten la misma petición y su tiempo total: una operación lenta puede retrasar las demás aunque no lance una excepción.

**Recomendación:** conservar reclamaciones atómicas, estados y reintentos existentes; dar a cada tarea ejecución, límite, métricas y programación propios. Medir antigüedad de trabajo pendiente, duración, reintentos y fallos. Esto puede hacerse con el mismo código y despliegue, sin crear servicios distribuidos. La ubicación y configuración reales del cron externo no se comprobaron en esta revisión.

### M7 — Prioridad media: cuesta reconstruir el contrato vigente leyendo sólo documentos y migraciones

Las 97 migraciones son una historia legítima; no constituyen un defecto por su número. El trabajo de reconstrucción aparece cuando una función se redefine o envuelve en distintas etapas. Por ejemplo, la migración de aranceles conserva un creador anterior bajo otro nombre y establece un envoltorio con nuevas condiciones. Es una decisión válida, pero necesita un mapa del flujo vigente y pruebas de sus invariantes.

El documento `docs/booking-integration/architecture.md` aún afirma que la integración no está publicada y describe el iframe como entrada de Natalia. Contradice la navegación nativa implementada y los documentos de las últimas entregas. El preflight de staging todavía exige configuración de mensajería descartada para este alcance. Un nuevo mantenedor podría seguir instrucciones antiguas o interpretar como requisito una capacidad que no corresponde activar.

**Recomendación:** un punto de entrada de arquitectura vigente que enlace decisiones, módulos, tareas y despliegues; marcar documentos históricos como tales. Generar o verificar el esquema efectivo desde una base reconstruida y mantener un catálogo de funciones críticas, permisos y propietarios de reglas. No editar ni compactar el historial aplicado de migraciones en producción como atajo de limpieza.

## Escalabilidad: bases existentes, riesgos y límites de la evidencia

### Disponibilidad

El turno integrado consulta una RPC de snapshot (`integrated-availability.ts`). El recorrido alternativo sin modalidad en `public-booking.ts` lee tablas y divide los bloqueos en ventanas de 31 días. Esas consultas mensuales no muestran paginación ni comprobación de truncamiento. La configuración local de PostgREST fija `max_rows=1000`.

Esto deja un riesgo estático: si una ventana y selección de profesionales excede el límite efectivo, dividir por meses no garantiza recibir todos los bloqueos. Podrían mostrarse opciones ocupadas que la transacción rechace después. No se reprodujo un incidente, no se comprobó el límite remoto y no debe atribuirse este riesgo al recorrido integrado de Natalia, que usa la RPC. Antes de crecer, probar ese límite y consolidar ambos adaptadores detrás de un mismo contrato de lectura completo.

El código mantiene a cero el TTL de las cachés de resultados de disponibilidad y catálogo; conserva deduplicación de peticiones simultáneas dentro de una instancia. Es una elección consciente de consistencia entre Workers. No corresponde recomendar activar un TTL global a ciegas: cualquier optimización debe respetar revisiones y revalidación transaccional. La carga esperada debe medir consultas y CPU por paso, horizonte de fechas, profesionales seleccionados y filas de bloqueos, además de p95/p99.

### Archivos

`clinical_storage_budget` impone un presupuesto global de 700.000.000 bytes; un bloqueo transaccional común serializa las actualizaciones del contador. Es una protección deliberada del presupuesto compartido. En más consultorios, un límite global sin cuotas propias permite que uno consuma el margen de los otros. Tampoco se midió la contención de ese bloqueo a alto volumen.

Mantener el tope global y sus garantías; considerar cuotas por consultorio, distribución visible del consumo y una política de retención/configuración cuando el crecimiento lo requiera. No quitar el bloqueo ni aumentar el límite para esconder el problema. La cuota configurada en el código no garantiza por sí sola operar siempre dentro de todos los límites de un plan del proveedor.

### Integraciones y observabilidad

La instrumentación `Server-Timing` ya mide parte del tiempo y de los viajes a Supabase. Es una buena base. Para comprometer capacidad faltan mediciones representativas y una vista agregada de latencia, errores, consultas, carga SQL, archivos y edad de trabajos pendientes. No se auditó aquí la monitorización externa del proveedor.

## Arquitectura objetivo

Conservar `apps/web`, `apps/natalia`, Supabase y un despliegue principal de la aplicación. Dentro de web, organizar responsabilidades en módulos con fronteras comprobables:

| Módulo | Responsabilidad y contrato principal |
|---|---|
| Reservas y agenda | Disponibilidad, creación, cambios de estado y contexto histórico |
| Pacientes y clínica | Identidad, ficha, historia, permisos y documentos |
| Equipo y prestaciones | Profesionales, servicios y reglas de atención |
| Aranceles | Políticas, ajustes, cotización y fotografías de precio |
| Formularios | Definición versionada, renderizado, validación y registro de respuestas |
| Notificaciones y calendario | Adaptadores de proveedor, tareas y estado de entrega/sincronización |
| Acceso y suscripciones | Contexto de consultorio, roles y acceso comercial |
| Sitios e identidad visual | Configuración de entradas públicas y presentación |

Una ruta debe invocar la API pública de su módulo. Un módulo no importa detalles internos de otro ni hace escrituras ajenas sin un caso de uso coordinador. Introducir comprobaciones de imports y contratos para sostener esas reglas. El acceso privilegiado a Supabase debe permanecer explícito dentro de las operaciones que lo requieren, con su contexto validado.

Dentro de un módulo, separar sólo lo que sea útil: reglas puras y modelos, operaciones, adaptadores de persistencia e interfaz. No crear cuatro carpetas, interfaces o clases para cada helper pequeño. No convertir todo en un paquete npm ni en servicios remotos. Los límites deben reducir el trabajo para cambiar una función.

## Orden recomendado

1. **Hacer verificable el estado vigente.** Unificar comandos secuenciales, mapa de arquitectura y recorridos críticos. Identificar módulos activos y heredados. Salida: cualquier mantenedor puede verificar una entrega sin conocer comandos temporales o conversaciones anteriores.
2. **Cerrar fronteras de tipos.** Clientes Supabase tipados y contratos de entrada/salida en un piloto del núcleo. Salida: un cambio incompatible de columna o respuesta provoca un error de compilación o de contrato donde corresponde, sin sumar `any` para ocultarlo.
3. **Extraer un recorrido vertical pequeño.** Una operación como guardar horarios, con ruta delgada, permisos y transacción conservados y pruebas de comportamiento. Salida: un ejemplo real del patrón; no un árbol de carpetas vacío ni un movimiento masivo de archivos.
4. **Dividir los componentes más costosos.** Gestión del turno, ficha del paciente y profesional, uno por entrega, separando controladores de notificaciones y calendario. Salida: mismas funciones y UX, pruebas de navegación y estados conservadas; cambiar una responsabilidad no exige editar otra.
5. **Consolidar reglas y presentación.** Contratos entre TS/SQL con vectores comunes de prueba cuando una regla tiene previsualización y ejecución; tokens visuales semánticos y presentación independiente de la marca. Salida: agregar otra apariencia no cambia el motor ni exige selectores de colores concretos.
6. **Separar tareas y comprobar crecimiento.** Presupuestos de ejecución por tarea, mediciones por flujo, pruebas de grandes conjuntos y concurrencia, distribución de cuotas. Salida: capacidad respaldada por resultados para escenarios concretos antes de prometer nuevos volúmenes.

Las funciones nuevas pueden continuar cuando estén aisladas por esas fronteras. Si amplían uno de los puntos concentrados, primero extraer la responsabilidad afectada. Una función con otro ciclo de vida no debe terminar dentro de `+page.server.ts` de pacientes o del job de push por conveniencia.

## Qué ocurriría si se sigue agregando sin esta intervención

- Una nueva regla de arancel exigiría coordinar SQL, preview, formularios y estados públicos con contratos todavía parcialmente sin tipar.
- Otra apariencia podría necesitar más excepciones CSS y condiciones por nombre de marca.
- Otra integración automática consumiría parte del tiempo de un job ya compartido.
- Más volumen podría alcanzar límites de consultas o presupuesto de archivos antes de que el número de páginas sea un problema.
- Las revisiones dependerían cada vez más de recordar todos los recorridos secundarios y las decisiones históricas.

El sistema no fallaría inevitablemente por incorporar la siguiente función. Aumentaría el costo de comprobar cada cambio y el riesgo de regresiones entre funciones que deberían poder evolucionar con independencia. Ese es el problema a resolver ahora.
