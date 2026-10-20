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

## Hallazgos

1. **Lectura de pacientes evaluada fila por fila** (corregido en `20261020020000_patient_read_set_based.sql`). La política de `patients` y las funciones de lista y conteo evaluaban `user_can_read_basic_patient`, cinco consultas, por cada paciente del consultorio. Con 6.000 pacientes, listar o buscar tardaba 2,9 s, con p95 de lecturas de 3,3 s. Las mismas reglas se evalúan ahora una vez por sentencia: p95 151 ms. `supabase/tests/patient_read_set_based.sql` demuestra la equivalencia exacta para cada rol y que una lectura completa no evalúa la regla por fila; sin la corrección, falló con 35 evaluaciones para 12 pacientes.
2. **Guardia `safeupdate` del PostgREST alojado** (corregido en `20261020010000`; encontrado en staging durante la etapa 6). El entorno descartable ahora entra como `authenticator` y reproduce ese guardia.

## Límites conocidos

- El escenario alojado de 25 consultorios necesita Supabase Pro: su base mide 1,02 GB frente a los 500 MB del plan gratuito. Requiere autorización del usuario.
- La CPU de Workers Free (10 ms documentados) se supera en tareas y páginas comunes; ver [tareas automáticas](tareas-automaticas.md).
