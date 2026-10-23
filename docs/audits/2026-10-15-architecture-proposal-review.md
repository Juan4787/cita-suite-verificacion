# Evaluación de la propuesta externa y alcance estructural previo al lanzamiento

Fecha: 2026-10-15. Código contrastado: `313355a4403e850379ace72bb4f37cd1c7952142`.

Este documento complementa la [auditoría estructural](2026-10-15-maintainability-and-growth.md). Es análisis y propuesta: no implementa cambios funcionales, migraciones ni despliegues.

## Premisas confirmadas por el usuario

- Todavía no hay profesionales con pacientes reales usando la aplicación.
- Se esperan aproximadamente tres o cuatro consultorios adicionales a corto plazo; 25 es un horizonte concreto y 50 está más lejos.
- Se acepta ampliar recursos y pasar a Supabase Pro cuando corresponda.
- Crecer debe ser una evolución natural de capacidad/configuración, conservando la infraestructura base.
- Se requieren funciones distintas por consultorio y protección frente a regresiones cruzadas.
- Se quiere resolver ahora la deuda estructural conocida, aprovechando el menor riesgo operativo.

Esto eleva el alcance respecto del primer informe: el piloto puede servir como primer paso técnico, pero no es un estado final aceptable del tipado o la modularización. Las cuotas por consultorio y la resolución coherente de capacidades pasan a ser requisitos previos al lanzamiento multiempresa.

## Dictamen

La oportunidad de intervención previa al uso real es válida. Recomiendo una campaña integral de refactorización con entregas verificables y un cierre definido para todo el alcance. La ausencia de usuarios reduce mucho el impacto operativo; siguen existiendo riesgos de perder comportamiento, garantías SQL, configuración y tiempo de desarrollo.

El objetivo verificable es cerrar las deudas identificadas, impedir que reaparezcan mediante contratos y pruebas, y demostrar los escenarios de crecimiento acordados. No es posible garantizar ausencia eterna de errores o que toda necesidad futura se resuelva cambiando datos. Una función nueva puede requerir código y migraciones legítimas sin que eso implique rehacer la infraestructura.

## Evaluación de los cinco puntos

### 1. Frontera SQL/TypeScript y disponibilidad — acuerdo con una corrección factual

**Hecho verificado:** `integrated-availability.ts` llama a `get_integrated_public_availability_snapshot`, que devuelve filas de prestaciones, profesionales, reglas, excepciones y bloqueos. El cálculo público posterior llama a `calculateAvailabilitySlots`, también usado por otros recorridos. La RPC integrada procede de la migración de integración de octubre; `get_availability_snapshot`, de julio, es otro contrato para el recorrido interno.

Por tanto, el ejemplo describe adaptadores de lectura diferentes que alimentan cálculo compartido; no demuestra dos generadores independientes de horarios, uno SQL y otro TS. Sí demuestra una lectura alternativa que conviene consolidar y someter a los mismos contratos de completitud y aislamiento.

**Decisión recomendada:** un servicio de lectura de disponibilidad y un modelo de snapshot versionado, con fachadas autorizadas para uso público e interno. Extraer consultas comunes donde sea útil. Retirar el recorrido alternativo de lectura mensual después de probar que todos sus casos quedan cubiertos. Conservar límites de rango, volumen y validación; un JSON agregado en SQL puede evitar el truncamiento de filas de PostgREST, pero también producir una respuesta enorme si no se acota.

No mezclar permisos: la reserva pública obtiene sólo profesionales y prestaciones autorizados y públicos; la agenda interna conserva sus reglas y sus datos correspondientes. Unificar contrato no significa abrir una RPC privilegiada universal al navegador.

**Frontera propuesta por responsabilidad:**

| Responsabilidad | Propietario |
|---|---|
| Integridad entre consultorios, privilegios, idempotencia, ocupación temporal, cuotas y escrituras atómicas | PostgreSQL: restricciones, RLS y funciones controladas |
| Lecturas consistentes y acotadas para disponibilidad | Contrato de snapshot con adaptadores SQL autorizados |
| Generación de opciones horarias | Calculador TypeScript común, salvo que una medición y decisión posterior justifiquen reemplazarlo por completo |
| Resultado financiero confirmado y cálculo de arancel | Una implementación canónica de servidor, junto a su persistencia y fotografía histórica |
| HTTP, proveedores externos, reintentos de I/O y composición de casos de uso | Servidor TypeScript |
| Renderizado, estados de interacción y validación para orientar al usuario | Interfaz; la autorización y aceptación definitiva permanecen en servidor/base |

Hay duplicación efectiva de cálculo de arancel entre el preview TS y SQL. Para este alcance prefiero que una previsualización de configuración aún no guardada invoque el mismo calculador canónico del servidor. Tendrá que proteger el orden de las respuestas, limitar llamadas y preservar una experiencia ágil. No debe escribir una política para poder previsualizarla.

Las pruebas de paridad son válidas para réplicas deliberadas, compatibilidad o una migración; no reemplazan la decisión de quién es dueño de una regla. Validar nuevamente una escritura en la base es necesario frente a concurrencia y clientes manipulados, aunque la interfaz ya la haya validado.

El número de funciones SQL de la auditoría corresponde a nombres declarados a lo largo de migraciones, no prueba 200 implementaciones activas de reglas duplicadas.

### 2. Capacidades por consultorio — incorporar ahora, con capas distintas

**Acuerdo:** configurar capacidades por `business_id` es parte de la base multiempresa para el horizonte confirmado. Deben resolverse centralmente y aplicarse en operaciones de servidor, no sólo para ocultar controles.

**Precisión:** ya existen ajustes por negocio, formularios por profesional y `BusinessAccessCapabilities` vinculado al acceso comercial. El flag `patient_documents_enabled` también se valida por consultorio en SQL. El trabajo consiste en integrarlos en un modelo coherente y cerrar dispersión; no partir de la premisa de que todo depende de variables globales.

Separar estas preguntas:

1. ¿La función está disponible operativamente en el despliegue? Los interruptores globales de emergencia/despliegue siguen siendo útiles.
2. ¿Este consultorio tiene habilitada o contratada esa función?
3. ¿Cómo la configura este consultorio y, cuando corresponde, cada profesional?
4. ¿Esta persona tiene permiso y acceso comercial vigente para realizar esta operación?

La identidad visual no responde ninguna de esas preguntas. Una ruta histórica bajo `/odonto` tampoco debe decidir el sector o los permisos; se puede preservar como URL compatible mientras se organiza el núcleo.

Definir un catálogo pequeño de capacidades conocidas, configuración validada y un resultado efectivo tipado en el contexto de la petición. Reutilizar el modelo comercial y las guardias de autorización existentes, con propietario claro. Evitar consultas repetidas de configuración en cada helper y cachés que mantengan permisos revocados.

Al deshabilitar una capacidad, distinguir nuevas operaciones de lectura histórica autorizada. Apagar cargas no debe borrar documentos ni privar automáticamente de la historia clínica a quien conserva permiso de verla.

Los flags habilitan capacidades implementadas. Una función nueva requiere su módulo, contrato y pruebas; no se promete programar comportamientos arbitrarios mediante un campo JSON ni construir ahora una plataforma general de plugins.

### 3. Tipado completo — cambiar el criterio de finalización

**Acuerdo:** antes de la extracción amplia, las fábricas centrales y sus consumidores deben terminar tipados con el esquema correspondiente. El piloto deja de ser una entrega final; sólo puede ser un paso dentro de una tarea que se cierra por completo.

Requisitos: `Database` sincronizado, clientes tipados, tipos concretos para consultas y contratos, y eliminación de escapes injustificados en fronteras de persistencia y datos públicos. Las dependencias externas que exijan tratamiento especial deben quedar aisladas y justificadas.

**Límite de la afirmación externa:** `createClient<Database>` no brinda protección del 100%. En el esquema actual hay RPC con retorno `Json`; agregar el genérico no describe automáticamente la estructura interna de ese JSON. Tampoco prueba RLS, transacciones, semántica de precios, permisos, SDK externos o comportamiento del navegador. Se requieren contratos de ejecución y pruebas sobre base real descartable.

Las 206 apariciones textuales de `any` no son todas el mismo problema ni desaparecen automáticamente al tipar la fábrica. Sustituirlas por conversiones ciegas, `as unknown as T` o supresiones ocultaría deuda en vez de resolverla.

### 4. Cuotas por consultorio — adelantar al alcance previo al lanzamiento

**Acuerdo completo:** para el horizonte confirmado, incorporar ahora presupuestos configurables por consultorio además del global. Mi recomendación anterior de considerarlo al crecer era insuficiente para esta premisa.

El modelo debe contar consumo y reservas pendientes en ambos niveles, con comprobación y actualización atómica. Conservar límites por archivo y reserva. Incluir miniaturas, archivos en papelera que todavía ocupen espacio, objetos subidos cuya finalización falló y cargas abandonadas. Asegurar liberación, reconciliación, orden de bloqueos consistente y ausencia de sobreasignación bajo concurrencia.

Los límites de cada consultorio no están definidos todavía y no deben inventarse. Deben ser datos configurables, validados y sólo modificables por actores autorizados. El cambio de plan o la ampliación de cuota debe poder ensayarse actualizando esa configuración, conservando objetos y pendientes existentes.

**Precisión comercial:** Supabase limita dos proyectos gratuitos, no dos consultorios dentro de un proyecto multiempresa. Pasar a Pro al tercer consultorio puede ser una decisión de negocio, no es una obligación técnica por ese contador. El dimensionamiento considera capacidad de cómputo, base, archivos, tráfico y disponibilidad operativa, además de número de consultorios. [Facturación oficial de Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase).

Una cuota de almacenamiento limita bytes guardados; no controla por sí sola transferencia o frecuencia de descargas. La configuración y monitorización deben distinguir esos recursos.

### 5. Subrequests y lotes — incorporar presupuesto explícito y medir recorridos

**Acuerdo:** el primer informe debía incluir presupuesto de llamadas externas, además de tiempo, CPU, memoria y consultas SQL. Se debe resolver antes de ampliar tareas automáticas.

**Límites oficiales consultados el 2026-10-15:** Workers Free admite 50 subrequests externos por ejecución. Workers Paid tiene 10.000 por defecto, configurable. Las redirecciones también pueden sumar llamadas. No se verificó el plan efectivo de esta cuenta. [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/#subrequests), [cambio de límites de febrero de 2026](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/).

Los 26 sitios `.from` y cuatro RPC de profesionales están repartidos entre carga y distintas acciones. No son 30 consultas ejecutadas necesariamente en una visita. Los límites se aplican por invocación; sumar 25 consultorios no implica consumir las llamadas de todos dentro de cada petición. Un cron global que procesa trabajo de todos sí debe controlar cuánto reclama y ejecuta por lote.

Propuesta:

- Instrumentar llamadas efectivas por ruta/acción/job, incluyendo proveedores, reintentos y redirecciones; los recuentos de sitios de código no sustituyen esa medición.
- Separar la ejecución de push, reseñas y calendario, preservando sus reclamaciones atómicas y estados.
- Reclamar un lote acotado con el contexto requerido y lecturas agrupadas. Evitar consultas repetidas de profesional, negocio o configuración para cada ítem.
- Conservar la comprobación de cancelación/reprogramación y permisos vigentes antes de ejecutar efectos externos. Reducir viajes sin eliminar garantías.
- Aplicar límites de tiempo y llamadas; dejar pendiente lo que no cabe. La continuidad y reintentos deben sobrevivir a la finalización de la petición.
- Agrupar confirmaciones/resultados donde sea correcto y mantener registro de intentos. No asumir entrega exactamente una vez a través de una red con respuestas perdidas.
- Acotar concurrencia y repartir trabajo entre consultorios, de modo que uno con una cola grande no monopolice el procesamiento.

Un presupuesto conservador puede expresarse como `llamadas_fijas + tamaño_lote × costo_máximo_por_ítem + margen <= límite`. El costo depende del proveedor y los reintentos; no fijar un lote por intuición. Agregar `Promise.all` puede reducir espera, pero no elimina llamadas; agrupar trabajo en una RPC tampoco elimina su costo SQL.

## Otras afirmaciones que requieren matiz

- La duplicación de contextos de sesión/negocio es un riesgo de divergencia; no se demostró una vulnerabilidad actual ni existe un umbral de diez consultorios que la active. Consolidar la obtención de contexto y conservar controles específicos de operación, RLS y guardias de funciones privilegiadas.
- Tener pruebas de TS/SQL no es en sí deuda técnica: se deben probar garantías entre capas. El problema es mantener dos autoridades de una misma regla sin decisión explícita.
- No se justifica una reescritura, un motor de plugins, microservicios o una base por cliente sólo por tener 25 consultorios. Las fronteras internas y la configuración por negocio resuelven la necesidad planteada con menor carga operativa.
- La ausencia de usuarios permite asumir más cambios estructurales ahora. No convierte en beneficioso un cambio masivo sin estados intermedios verificables.

## Hoja de ruta revisada

| Orden | Trabajo | Criterio de cierre |
|---|---|---|
| 1 | Inventario funcional vigente, mapa de reglas/contratos, baseline y verificación unificada secuencial | Suites obligatorias completas y reproducibles; estado histórico y vigente claramente identificado |
| 2 | Tipado de fábricas y todos los consumidores activos; contratos JSON y contexto de autorización común | Sin clientes activos sin tipar ni escapes que oculten contratos; tipos regenerables y sincronizados |
| 3 | Modelo efectivo de capacidades/configuración y cuotas por consultorio/globales | Diferencias entre consultorios aplicadas en servidor/SQL; aislamiento y cuotas comprobados bajo concurrencia |
| 4 | Módulos por dominio y casos de uso; contrato común de lectura de disponibilidad y cálculo canónico de precios | Rutas delgadas; autoridad de cada regla documentada; recorrido alternativo retirado con cobertura de sus casos |
| 5 | Separar controladores y componentes grandes, temas semánticos y presentación independiente del negocio | Mismas funciones y UX; sin decisiones de negocio basadas en nombre de marca; límites de imports comprobados |
| 6 | Ejecución independiente de tareas y procesamiento acotado por presupuesto | Recuperación, idempotencia, revalidación y reparto de trabajo comprobados; ausencia de bucles externos sin límite |
| 7 | Validación de carga/aislamiento y transición de recursos para el corto plazo confirmado (tres o cuatro consultorios adicionales) y 25 consultorios sintéticos | Mediciones de escenarios definidos y ampliación de cuotas/capacidad sin cambiar el modelo multiempresa ni reescribir el núcleo |

El trabajo es integral por su criterio final, y se ejecuta en cambios pequeños para poder revisar y localizar regresiones. Ningún paso parcial debe presentarse como cierre de la campaña. No mezclar esta campaña con funciones futuras pospuestas ni con cambios de diseño que no sean necesarios para conservar la presentación.

## Qué significa terminado antes de incorporar consultorios reales

1. Una modificación incompatible de tablas o RPC rompe el contrato de tipos o una prueba de ejecución antes de publicar.
2. Un consultorio habilita una capacidad y otro la mantiene apagada; la interfaz y las llamadas directas al servidor respetan esa diferencia.
3. Modificar permisos, formularios, precios o configuración de un consultorio no altera los demás; se prueban distintos roles y contextos.
4. Desactivar una capacidad conserva acceso histórico autorizado y no borra datos.
5. Lecturas de disponibilidad de alto volumen son completas o fallan de manera explícita; ninguna respuesta parcial se interpreta como ausencia de bloqueos.
6. Dos reservas concurrentes para el mismo profesional/horario conservan la exclusión e idempotencia, incluidos reintentos y respuestas perdidas.
7. Subidas concurrentes no exceden cuotas globales ni por consultorio; fallos, expiraciones y objetos pendientes se reconcilian correctamente.
8. Ampliar cuotas y recursos conserva datos, permisos, configuración y cargas pendientes; se ensaya la transición antes de necesitarla.
9. La caída o lentitud de un proveedor no consume indefinidamente el procesamiento de los demás; se conoce el presupuesto por lote y la antigüedad del trabajo pendiente.
10. Los recorridos públicos de Cita Suite y Natalia conservan funciones, selección, cuestionarios, gestión y modos visuales en escritorio y móvil.
11. Existen mediciones con datos y actividad representativos del corto plazo confirmado y de 25 consultorios. Se documentan volumen, simultaneidad, CPU, latencia, llamadas, SQL, almacenamiento y transferencia; el simple hecho de crear 25 filas no cuenta como prueba de capacidad.
12. Los comandos, fixtures, contratos, decisiones, migraciones y comprobaciones de publicación están versionados y no dependen de conversaciones o scripts temporales.

Estos criterios buscan cerrar deudas conocidas y detectar regresiones antes de publicar. No prometen que toda futura función sea sólo configuración ni que ninguna modificación futura necesite una migración o un índice nuevo.
