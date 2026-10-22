# Disponibilidad y aranceles

Autoridad: [plan íntegro, etapa 4](../plans/refactorizacion-cita-suite.md). El [registro](../plans/registro-refactorizacion-cita-suite.md) distingue cada fuente y resultado. **Garantía de concurrencia de configuración reabierta durante etapa5:** el cierre previo39090572628 conserva su evidencia funcional/visual, pero39092194979 expuso un deadlock al insertar profesionales concurrentemente. Se exige comparación con la nueva carrera real y la migración compatible antes de volver a cerrar esta garantía. No se aplicaron migraciones remotas.

## Propiedad y límites

PostgreSQL mantiene permisos, integridad, exclusión, idempotencia, transiciones atómicas y precio confirmado. TypeScript genera opciones con un solo calculador y previsualiza políticas sin guardarlas. La interfaz no decide la disponibilidad definitiva ni modifica fotografías históricas.

La unidad de lectura es de hasta quince **fechas naturales inclusivas** y dieciséis profesionales. El catálogo puede contener más profesionales: dieciséis limita una consulta, no el equipo. Los iteradores compartidos producen grupos fijos; no consultan automáticamente todo el horizonte ni subdividen por tamaño de JSON.

Una configuración y una ocupación cambian por motivos distintos. Se introduce `private.availability_configuration_versions`, una fila por consultorio, dentro de la misma transacción de alta y con FK/cascada. No tiene acceso directo de anon, authenticated o service_role. Los contratos autorizados exponen sólo su revisión.

La revisión avanza cuando cambian profesionales, prestaciones, asignaciones, reglas semanales, sus prestaciones permitidas o los campos de negocio que afectan el cálculo. Los turnos y las excepciones por fecha no la incrementan. Así, una reserva en otra ventana no invalida el catálogo ni obliga a reiniciar el horizonte.

Se eligió una tabla privada pequeña en vez de reutilizar `booking_availability_revision`, porque esa revisión anterior también avanza por reservas y otras operaciones. Su reutilización mezclaría ambos ciclos. Los disparadores adquieren primero la fila de negocio y después su revisión, en el orden de los escritores existentes; no hacen HTTP dentro de la transacción.

## Contratos SQL

| Contrato | Entrada / salida |
|---|---|
| `get_availability_catalog` | Negocio y contexto público/interno. Devuelve negocio de cálculo, revisión, prestaciones, profesionales, asignaciones y reglas semanales. |
| `get_availability_window` | Mismo contexto, prestación cuando es pública, grupo de profesionales, fechas inclusivas y revisión observada. Devuelve excepciones y asignaciones ocupadas, identidad del alcance y conteos explícitos. |

El contexto lo fija el servidor que atiende el recorrido. El indicador público no es una preferencia de interfaz ni una fuente de permisos. El contexto público exige service_role y negocio activo con reserva y operación habilitadas. El interno conserva la membresía vigente y la lectura autorizada de agenda. Una identidad autenticada no puede invocar el contexto público como atajo.

Los intervalos conservan inicio/fin de atención, ocupación base con márgenes y ocupación ampliada con descanso. Se incluyen los identificadores de reserva necesarios para excluir la reserva que se reprograma, sin nombres de pacientes, teléfonos, notas ni información clínica.

Cada llamada usa funciones STABLE y una vista MVCC para sus lecturas de datos. Una revisión diferente impide combinar configuración antigua con la ventana nueva; no provoca un reinicio recursivo. Las comprobaciones de permisos se conservan separadas y no se convierten en una caché global de autorización. Fundamento: [volatilidad y snapshots de PostgreSQL 17](https://www.postgresql.org/docs/17/xfunc-volatility.html).

El borrador inicial de ventana usó SECURITY DEFINER para acceder a la revisión privada. La comparación posterior detectó que eso exige aplicar expresamente `user_can_read_appointment` a las asignaciones internas, como la política existente de `appointment_professionals`. Se preparó ese filtro sin duplicar su lista de roles. Los dos controles nuevos bajo authenticated fallaron antes del filtro y aprobaron después en CI 39051242102: 63 asignaciones propias y cero del colega. La comparación conserva también los otros 28 controles.

No se usa paginación implícita de una tabla PostgREST para construir estos agregados. La función agrega todas las filas de la ventana y declara los conteos. Una respuesta que supera el límite explícito de 5 MB falla completa: no recorta filas ni devuelve una agenda vacía. Los contratos anteriores se conservan durante la transición compatible; eso no autoriza mantener activa una lectura alternativa susceptible de truncamiento al cerrar la etapa.

## Coordinación y validación

`availability/contracts.ts` valida versión, negocio, contexto, revisión, fechas, identificadores, conteos, relaciones y todos los intervalos necesarios. Un 200 con fragmentos ausentes no equivale a disponibilidad vacía. Las reglas restringidas mantienen su estado y un array vacío de prestaciones permitidas: nunca se interpretan como acceso a todas.

`server/availability-windows.ts` recibe un catálogo ya cargado y consulta grupos/ventanas secuencialmente. No vuelve a pedir el catálogo por cada fragmento, no reintenta un horizonte entero y no convierte un error en éxito parcial. Si el mismo identificador reaparece con datos contradictorios entre fragmentos, rechaza el resultado en vez de sobrescribirlo silenciosamente. Las cargas reales y sus permisos definitivos siguen perteneciendo a SQL.

El parser anterior se movió a `availability/rows.ts` para compartir contratos sin importar servidor desde navegador. El adaptador anterior lo reexporta durante la transición. Esto no crea otro calculador ni otra autoridad de reglas.

El calculador de servidor y el snapshot interno usan catálogo/ventanas y retiraron su fallback de tablas (fast 39051788001 y full 39070230569). El endpoint interno fija su contexto interno aunque filtre visibilidad pública. El snapshot HTTP conserva su forma y predetermina quince fechas; solicitudes explícitas mayores se dividen en ventanas fijas. El estado público también recibe un único catálogo por petición, aplica el alcance de integración y conserva el requisito de horario semanal activo para mostrar servicios/profesionales. Carga inicialmente quince fechas naturales, permite una fecha directa y ofrece navegación con `dates_from`, sin descargar automáticamente todo el horizonte. El plazo público conserva el límite existente de 1–90 días, independiente del tamaño de ventana. La modalidad y las ventanas de modalidad siguen siendo entradas del mismo calculador. Los enlaces de siguiente/anterior conservan identidad visual y selección; una ventana vacía no elimina la navegación.

El adaptador histórico queda sólo como reexportación del parser compartido. Ningún consumidor activo llama a los snapshots SQL históricos ni usa una alternativa de tablas. Las funciones SQL anteriores permanecen para transición compatible; no deben confundirse con una recuperación activa.

Las confirmaciones por fecha, recuperación sin duplicación, cuestionarios y ambos temas aprobaron en full 39070230569. Full 39073720665 comprobó además quince días bloqueados y navegación real en ambos temas/anchos, frontera HTTP interna, inicialización honesta y ciclo real de cotización. La revisión visual del lote aprobó con alcance acotado, según revisión-ui-agenda-aranceles.md.

## Frontera HTTP y vida de cada petición

El resuelto de integración comparte únicamente configuración y contexto de marco entre layout y página. Un cliente Supabase captura su `event.fetch` de origen: compartirlo permitía que una página consultara mediante el fetch de un layout ya terminado. Cada consumidor de datos crea ahora su cliente con el fetch de su propio load. La coalescencia del control de acceso/configuración sigue limitada a la petición; no se agrega una caché de permisos. Full 39070230569 dejó de emitir ese aviso específico. Persisten avisos genéricos de fetch durante SSR (tres en 39073720665), con diagnóstico separado pendiente para etapa 5.

En revisión posterior, el asistente manual deja de solicitar 28 fechas para mostrar siete. `availability/http.ts` valida slots y snapshots internos usando los mismos validadores de configuración/ocupación; no sintetiza revisiones ni permisos para hacerlos aprobar. Una respuesta incompleta no se convierte en una agenda vacía; referencias se actualizan juntas sólo tras validarlas. El cálculo local no usa un snapshot vencido. Fast 39071516947 comprobó dieciocho casos de frontera HTTP y un caso de componente rechazando respuesta parcial. El full 39073720665 confirmó el rechazo y la recuperación real mediante la proyección individual legítima (arrays de equipo opcionales). El reintento explícito de la misma semana aprobó en full 39090572628, con fecha/rango exactos y slots reales.

## Aranceles exactos

Los importes y las fotografías se expresan en pesos enteros. Las políticas admiten porcentaje general con vigencia, excepción de un mes y múltiplo de redondeo. La cadena conserva precisión exacta: TypeScript usa una fracción de enteros y PostgreSQL numeric. El importe redondeado de un mes no alimenta el siguiente.

Ejemplo de control: base 15, aumento mensual 50 %, unidad 1. Las cotizaciones son 15, 23 y 34; el valor exacto acumulado del segundo ajuste es 33,75. Usar 23 como base del siguiente ajuste produciría 35 y viola el contrato.

Los desplazamientos válidos son de 0 a 600, inclusive. Una previsualización devuelve como máximo 120 resultados y comprueba `inicio + cantidad - 1`. Una fecha anterior al mes base falla, sin ajustarse silenciosamente a cero. El límite monetario de 1.000.000.000.000 se verifica después del redondeo, incluso en el mes base, además de durante la acumulación.

`20261017020000_price_contract_bounds.sql` reemplaza sólo el cuerpo de la función existente, conserva firma/privilegios y no cambia precios guardados. La aceptación del precio y su hash/revisión en la confirmación conservan sus controles SQL. La zona del consultorio determina el mes; no se usa la zona del navegador como autoridad.

## Evidencia y límites

| Evidencia | Resultado y alcance |
|---|---|
| `price-contract-vectors.json`, `price-parity.test.ts`, `price_contract_parity.sql` | Un único archivo de 18 casos y resultados esperados independientes del código probado; comparación real de TypeScript/PostgreSQL. |
| CI `39049638614` / `39049648311` | Ocho fallos TypeScript y dos SQL conservados antes de la corrección. |
| CI `39049884855` | Full aprobado sobre `11d6d78`: los 18 casos SQL y 19 de TypeScript, incluido el límite de 120 resultados; regresiones de SQL/carreras/browser/Natalia/demo aprobadas. No incluye nuevos consumidores de disponibilidad. |
| CI `39050404355` | 28 controles SQL de disponibilidad y diez carreras aprobados; catálogo mayor que un grupo, 1.001 asignaciones completas, DST, identidad, ámbitos y consistencia real con dos conexiones. Generación oficial reproducible. No incluye los dos controles posteriores del alcance profesional. |
| CI `39051242102` | Full con 30/30 disponibilidad: comparación negativa/positiva de lectura profesional, SQL completo, diez carreras, tipos y regresiones. |
| CI `39070230569` | Full de consumidores nuevos: 1.129 servidor, 119 cliente, SQL completo, diez carreras, 27 navegador, Natalia nativa y dos demo. No cubre las nuevas pruebas HTTP/ventana vacía/ciclo de cotización posteriores. |
| CI `39071528383` | SQL con 14 controles de cambios reales entre cotización/confirmación y replay; atomicidad, aceptación del nuevo importe y fotografía histórica preservada. Incluye todas las suites y diez carreras. |
| CI `39072048885` | Fast del resultado actual de aplicación: 1.147 servidor, 123 cliente; últimos tres casos comprueban preview UI al mes 600, rechazo del 601 y error humano de configuración completa. Capturas/E2E ampliados posteriores aún requieren full. |
| CI `39073720665` | Full consolidado sobre `ee1db49`: 50 guardas, 1.148 servidor, 123 cliente, una reapertura nativa; SQL completo, diez carreras, tipos reproducibles, 29 navegador, Natalia y demo2 sin omisiones/reintentos. Incluye recuperación individual real y cuatro combinaciones públicas de tema/ancho. |
| CI `39090572628` | Full del lote visual sobre `c0129e4`: 1.148 servidor/123 cliente/29 navegador y restantes suites sin omisiones. Reintento real de misma semana, FormData certificado, geometría de enlaces móviles, expansión antes de siguiente ventana y feedback accesible sin guardar. |
| CI `39051023222` | Fast aprobado sobre `982ef9a`: once controles de fechas/JSON y cuatro del coordinador. Sus respuestas HTTP son simuladas; no se presentan como PostgreSQL ni como navegador desplegado. |

Las verificaciones alojadas, capacidad, UI completa, reserva desde Natalia/enlace directo y auditoría transversal tienen sus puertas posteriores. Este cierre descartable no reduce ninguna condición de las etapas posteriores.

## Corrección de lock de configuración en comparación

La función inicial toma FOR UPDATE sobre el consultorio tras una inserción hija. La FK ya mantiene KEY SHARE sobre esa fila. La reproducción controlada conserva FK/constraints reales y un gate AFTER ordenado después de sus checks; exige dos inserciones confirmadas y revisión+2 sin retry. El SQL negativo176b121 mantiene el lock anterior; el borrador20261018000000 cambia únicamente a FOR NO KEY UPDATE, compatible con KEY SHARE y todavía exclusivo entre escritores. Conserva orden consultorio→revisión, firma/OID/privilegios y datos. No se modifica la prueba de roles para evitar su concurrencia.

La comparación quedó aprobada en full 39093599146 sobre `366dcf5`, después de la reproducción negativa 39093073514: dos INSERT con FK reales confirmados, revisión +2, sin retry y deadlocks 0. La [matriz de etapa 4](evidencia-etapa4-agenda.md) y el registro conservan SHA/recibo/paquete. Fuente normativa del modo: [locks de fila de PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS). El contador real de deadlocks sigue siendo obligatorio en los fulls; no basta que los escenarios de interfaz concluyan.
