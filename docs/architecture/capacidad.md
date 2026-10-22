# Capacidad: escenarios, generadores y resultados

Este documento describe cómo se mide la capacidad de Cita Suite según la sección 4 del [plan](../plans/refactorizacion-cita-suite.md), qué herramientas lo hacen y qué se encontró. El detalle de cada corrida está en el [registro](../plans/registro-refactorizacion-cita-suite.md).

## Qué se mide y dónde

| Entorno | Qué demuestra | Qué no demuestra |
|---|---|---|
| CI (`level=capacity`): PostgreSQL con 4 GB y 2 CPU, GoTrue, PostgREST y Storage reales, y el build de producción para Cloudflare en workerd | Comportamiento de consultas, índices, locks y crecimiento con el volumen del plan; latencias del sistema sin la red pública | La capacidad de un proyecto alojado de Supabase ni de Cloudflare |
| Staging (`staging-operations` `capacity-*`): Worker `cita-suite-staging` y su proyecto Supabase, desde un runner externo | Comportamiento desplegado del escenario de 5 consultorios, con red real y los límites de los planes gratuitos | El escenario de 25, que no entra en los 500 MB de Supabase Free |

## Datos sintéticos

`scripts/capacity/seed-practices.sql` genera, por consultorio, 3 profesionales, 5 servicios, horarios de lunes a viernes de 9 a 18, una integración de sitio, 6.000 pacientes y 12.000 turnos en doce meses: nueve pasados y tres por delante, sin superposiciones. Los estados son los que el sistema admite hoy (`reserved`, `confirmed`, `cancelled`, `reschedule_requested`); el paso del tiempo no escribe estados. Hay una entrada clínica en tres de cada diez turnos pasados confirmados. Todo es determinista e identificado como `capacity-`, con identidades ficticias. Todo pasa por los triggers reales: vínculos con profesionales, identidad de pacientes, horarios del servicio, precios y presupuesto clínico.

Se siembra por lotes (500 pacientes, 1.000 turnos), cada uno con su propia sentencia y su propia transacción. Los triggers de identidad toman tres locks consultivos por paciente, y una transacción por escenario agotaría cualquier tabla de locks. Además, un proyecto alojado limita cuánto dura una sentencia: en staging, 2 minutos. Ninguna operación real se acerca a esos límites. Los identificadores son UUID v4 válidos derivados de un MD5, porque la app valida versión y variante igual que con `gen_random_uuid()`. El origen `public_booking` queda en los turnos pasados, para que el límite real de cuatro reservas públicas activas futuras por nombre no decida si la siembra termina.

`scripts/capacity/cleanup-practices.sql` quita esos consultorios y todo lo suyo en una transacción, y nada más. Un consultorio es sintético cuando su slug es `capacity-NN` y su id es el que la siembra le da a ese slug. Si aparece otro consultorio `capacity-` o un miembro que no es el dueño sintético, se detiene sin borrar nada. El orden respeta las restricciones que el esquema mantiene a propósito: el contexto de una reserva pública y las respuestas del paciente impiden borrar su integración y su paciente, así que primero se borran los turnos, que se los llevan; después las integraciones, y por último el consultorio. Un consultorio sintético con documentos se rechaza, porque sus objetos de Storage y su contabilidad no se quitan con SQL. Al terminar comprueba que ninguna tabla de `public` o `private` con `business_id` conserve filas de esos consultorios. Los dueños se quitan después por la API de Auth, sólo si la cuenta de cada id determinista conserva su correo sintético. Cada escenario de CI ensaya esta limpieza sobre sus propios datos antes de usarla en staging: primero los dos casos que deben detenerla y después la limpieza completa. Antes de sembrar staging, el ejecutor mide la base y se niega si la siembra dejaría menos de 50 MB de margen frente a los 500 MB de Supabase Free, porque pasado ese límite el proyecto queda en sólo lectura.

| Escenario | Pacientes | Turnos | Base | Tiempo de siembra |
|---|---:|---:|---:|---:|
| 5 consultorios | 30.000 | 60.000 | 238–240 MB | 48–81 s en CI |
| 25 consultorios | 150.000 | 300.000 | 1,02 GB | 6,4 min en CI |

## Carga interna

`scripts/lib/capacity-load.mjs`, con pruebas en `capacity-load.test.mjs`, define un usuario virtual por consultorio. Inicia sesión una vez por escenario con la acción real de la app: los límites de 5 por correo y 40 por IP cada 15 minutos no se tocan. Hace 80 % de lecturas (agenda del día y de la semana, búsqueda y lista de pacientes, ficha, historia, turno, disponibilidad) y 20 % de escrituras (turno nuevo en una franja libre, cancelación de uno propio, entrada clínica), con pausas de 3 a 8 s. Cada escenario hace tres repeticiones de 2 minutos de preparación y 10 de medición.

Una lectura cuenta como correcta sólo si la página y todos sus `load` respondieron. SvelteKit contesta HTTP 200 a una navegación aunque un `load` falle y pone el error en su nodo, así que el clasificador revisa cada nodo. Un conflicto 409 por una franja tomada es la respuesta esperada y no un error técnico.

Además de los criterios de latencia y errores del plan, cada escenario comprueba que ningún turno creado quede en otro consultorio, que no haya turnos activos superpuestos de un mismo profesional y que no haya interbloqueos. El ensayo alojado hace las mismas comprobaciones, con la misma consulta, antes y después de la carga, y cuenta sólo los interbloqueos que agregó la medición. Registra las sentencias más costosas (`pg_stat_statements`, incluidas las de dentro de funciones), las esperas de locks y los planes de lo que tarde más de 250 ms (`auto_explain`). Compara el tiempo medio de cada sentencia entre 5 y 25 consultorios: con los mismos datos por consultorio, una sentencia que crece no está acotada a su consultorio.

## Reserva pública

Se mide aparte, como pide el plan. Un único generador lee las páginas del enlace compartido (`/reservar/<id>`) y de la integración del sitio (`/embed/v1/<clave>`, el camino de Natalia), a unas 40 lecturas por minuto frente al límite de 120. Reserva un turno cada 4 minutos con un teléfono sintético distinto, el ritmo que entra en el límite de 3 cada 10 minutos por IP. Busca la franja como una persona: primero la página sin fecha, que lista los días con disponibilidad de las dos semanas siguientes, y después la del día elegido, con sus horarios. El formulario reenvía los campos ocultos que la página entrega, igual que la confirmación de la interfaz. Con un solo generador, franjas libres y teléfonos distintos, cada reserva programada debe salir bien: la evidencia guarda la respuesta de la app para cada una que no salga, y una sola hace fallar la fase.

Después, las pruebas de abuso esperan los rechazos. Una ráfaga de 130 lecturas debe recibir 429 desde la 121. Las reservas desde una misma dirección siguen hasta que la app responde con su mensaje exacto del límite por IP. Como cada intento cuenta, ese rechazo tiene que llegar a más tardar en la cuarta reserva, antes si el generador reservó en los últimos diez minutos. Una cuarta reserva aceptada, otro rechazo o la falta de franjas hacen fallar la prueba. Turnstile está desactivado en CI porque no hay clave; en producción la verificación anti-bots sigue vigente.

## Ensayo alojado de 5 consultorios (staging, planes gratuitos)

El Worker `cita-suite-staging` (Workers Free, ubicado en `aws:us-west-2`) y su proyecto de Supabase Free, con la siembra de 5 consultorios, las tres repeticiones, la fase pública y el abuso desde un runner de GitHub. `wrangler tail`, desde la sesión local de la cuenta, registra el resultado de plataforma y la CPU de cada pedido por ruta normalizada, sin datos. `capacity-report` lee `pg_stat_statements` de staging, en modo lectura.

| Repetición | Errores en lecturas | Errores en escrituras | Lecturas completas p95 / p99 |
|---|---:|---:|---:|
| 1 | 30 % | 12 % | 1.656 ms / 18,0 s |
| 2 | 44 % | 36 % | 979 ms / 2,8 s |
| 3 | 56 % | 30 % | 972 ms / 3,3 s |

Todos los errores son HTTP 503. La fase pública tuvo 70 % de errores y ninguna reserva, y la ráfaga de abuso falló antes de llegar al límite. Aislamiento, doble reserva e interbloqueos: 0.

**Causa dominante, medida por la plataforma: el límite de CPU de Workers Free.** De 891 pedidos observados, Cloudflare cortó 241 por CPU (`exceededCpu`). Durante los dos primeros minutos no cortó ninguno; desde entonces, entre 15 % y 52 % por minuto, cada uno detenido cerca de los 10 ms. Los pedidos completos usaron p50 11 ms y p99 222 ms de CPU; la agenda semanal, p50 116 ms. El límite documentado de Free es de 10 ms, y la tolerancia inicial no lo cambia.

**La base gratuita también es más lenta**, aunque los datos caben en memoria (aciertos de caché 1,0000): `work_mem` es de 2 MB y los ordenamientos van a disco (2,7 GB en archivos temporales), las sentencias de la carga tardan de 5 a 20 veces más que en CI y hubo dos atascos de unos 40 s. Dentro del Worker, los pedidos completos tienen p50 de 260 ms y p95 de 1,26 s.

Conclusión: con los planes gratuitos, el escenario de 5 consultorios no cumple el plan, y producción usa el mismo plan de Workers. Workers Paid elimina los cortes de CPU; con él hay que volver a medir la latencia sobre Supabase. Desde esta medición, el perfil de capacidad de CI usa la memoria por consulta de Supabase (`work_mem`, `shared_buffers` y `effective_cache_size` medidos en staging), para que los planes que allí van a disco aparezcan también en CI.

## Hallazgos

1. **Lectura de pacientes evaluada fila por fila** (corregido en `20261020020000_patient_read_set_based.sql`). La política de `patients` y las funciones de lista y conteo evaluaban `user_can_read_basic_patient`, cinco consultas, por cada paciente del consultorio. Con 6.000 pacientes, listar o buscar tardaba 2,9 s, con p95 de lecturas de 3,3 s. Las mismas reglas se evalúan ahora una vez por sentencia: p95 151 ms. `supabase/tests/patient_read_set_based.sql` demuestra la equivalencia exacta para cada rol y que una lectura completa no evalúa la regla por fila; sin la corrección, falló con 35 evaluaciones para 12 pacientes.
2. **Guardia `safeupdate` del PostgREST alojado** (corregido en `20261020010000`; encontrado en staging durante la etapa 6). El entorno descartable ahora entra como `authenticator` y reproduce ese guardia.
3. **Lectura de turnos evaluada fila por fila** (corregido en `20261020030000_appointment_read_set_based.sql`). Las políticas de turnos, asignaciones y contextos de reserva, y la ventana interna de disponibilidad, evaluaban `user_can_read_appointment` por fila. Con la corrección, la lectura de una semana bajó de 132 a 5,2 ms de media y las lecturas internas del diagnóstico de 5 consultorios, de p95 274 a 159 ms.
4. **Un formateador de zona horaria por cada fecha, regla y franja** en el calculador compartido de disponibilidad: 442 construcciones por cálculo. Ahora se construye uno por forma y zona y se reutiliza (`calculate.test.ts`).
5. **Agenda semanal contada en el Worker.** Leía todos los turnos de la semana, con un formateador por turno y por día: 116 ms de CPU de mediana en staging. Además mostraba una semana vacía ante un error y podía truncarse. Ahora la base cuenta por día local y estado (`20261020050000_agenda_week_counts.sql`) y la carga falla de forma explícita.
6. **Dos lecturas de membresías por pedido** (`list_user_business_contexts`, unas 2 por pedido en staging). Un pedido de lectura ahora comparte una sola entre layout y página.
7. **Consumo de la sincronización de revisiones**: cada pestaña abierta consultaba cada 5 s aunque estuviera oculta. Ahora no consulta oculta y, sin Realtime, se espacia hasta 30 s ([control de consumo](control-de-consumo.md)).

## Límites conocidos

- El escenario alojado de 25 consultorios necesita Supabase Pro: su base mide 1,02 GB frente a los 500 MB del plan gratuito. Requiere autorización del usuario.
- La CPU de Workers Free (10 ms documentados) se supera en tareas y páginas comunes, y bajo la carga de 5 consultorios Cloudflare corta entre 15 % y 52 % de los pedidos (ver arriba y [tareas automáticas](tareas-automaticas.md)). El usuario decidió no contratar Workers Paid, porque su consumo excedente no tiene tope: la app y el programador tienen que entrar en el límite de Free, y esa reducción se mide ruta por ruta en staging.

## Causa de las pausas en Supabase Free (staging, 21 de octubre)

La medición de dos consultorios sobre `08cba81` (`staging-operations` 39685702630) se repitió con instrumentación:
- `scripts/instance-sampler.mjs` toma las métricas de la instancia del endpoint de métricas de Supabase, disponible en Free, y lo que espera cada sesión de PostgreSQL;
- `scripts/attribute-pauses.mjs` compara las ventanas de un minuto con pedidos lentos (2 s o más) contra las demás.

Valores medianos, con evidencia en `.verification/staging-pause-attribution-20261021.json`:

| Métrica | Ventanas con pausas (6) | Ventanas normales (32) |
|---|---:|---:|
| CPU robada por la máquina compartida | 0 % | 0 % |
| CPU de trabajo (usuario y sistema) | 10 % | 2,5 % |
| Espera de disco | 30 % | 3 % |
| Tiempo detenido por I/O | 31 % | 3,5 % |
| Tiempo detenido por memoria | 13 % | 0,9 % |
| Páginas enviadas a swap por segundo | 925 | 39 |
| Páginas traídas de swap por segundo | 871 | 128 |
| Disco ocupado | 42 % | 6 % |
| Checkpoints | 0 | 0 |

**Conclusión.** La instancia Nano, de 0,5 GB, tiene unos 125 MB disponibles y medio GB en swap incluso en reposo. Con la carga intercambia memoria con un disco limitado a 250 IOPS, y PostgreSQL queda esperando sus páginas: así pasa una consulta de 20 ms a varios segundos. Las pausas no vienen de la CPU compartida, de los checkpoints ni del trabajo de la app, porque la CPU de trabajo es baja. Es un límite del tamaño del cómputo.

Micro duplica la memoria, a 1 GB, y el rendimiento de disco base, a 500 IOPS ([cómputo](https://supabase.com/docs/guides/platform/compute-and-disk)). Por lo medido, es razonable esperar que elimine la mayor parte del intercambio, pero se comprueba midiendo, como cualquier criterio.
