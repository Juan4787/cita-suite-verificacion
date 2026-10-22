# Decisiones arquitectónicas y alternativas descartadas

Entregable de la sección 5 del [plan](../plans/refactorizacion-cita-suite.md). Cada decisión lleva su motivo, lo que se descartó y dónde está el detalle. Las decisiones de alcance las tomó el usuario: están literales al final del plan y no se reabren acá. Las demás son técnicas y se tomaron con evidencia, registrada en el [registro](../plans/registro-refactorizacion-cita-suite.md).

## Estructura

**Monolito modular en seis áreas.** El producto conserva una aplicación, una base multiempresa, Cloudflare y la web de Natalia. Las áreas exponen interfaces públicas, y `dependency-cruiser`, con versión fijada, rechaza importaciones privadas y ciclos.
- **Descartado:** microservicios, una base por consultorio y plugins genéricos. Multiplican despliegues, migraciones y fallas parciales sin resolver ningún problema medido de dos consultorios, ni de veinticinco.
- **Descartado:** coordinadores o repositorios que sólo reenvían llamadas.
- **Detalle:** [áreas y fronteras](areas-y-fronteras.md).

**PostgreSQL es la autoridad.** Aislamiento, relaciones entre consultorios, permisos de base, exclusión temporal, cuotas, idempotencia, transiciones atómicas y precio confirmado.
- **Descartado:** trasladar transacciones a TypeScript para simplificar el SQL. Pierde atomicidad frente a fallas y concurrencia.
- **Detalle:** [contratos funcionales](functional-contracts.md) y [relaciones entre consultorios](relaciones-entre-consultorios.md).

**Contexto común por petición, sin caché global de permisos.** Resuelve identidad, consultorio, membresía y capacidades, y sólo un pedido que no escribe comparte su lectura de membresías.
- **Descartado:** cachear permisos entre pedidos o personas. Una revocación tardaría en tener efecto.
- **Detalle:** [tipado, contexto y aislamiento](tipado-contexto-aislamiento.md) y [permisos y capacidades](permisos-y-capacidades.md).

**Tipos generados desde una base descartable con todas las migraciones,** dos veces y con igualdad exacta, más validación de los JSON en ejecución.
- **Descartado:** escribir firmas a mano o convertir tipos a ciegas para obtener un verde.

## Agenda, aranceles y documentos

**Disponibilidad:** un calculador TypeScript común alimentado por ventanas SQL consistentes, de hasta quince días y dieciséis profesionales. Una respuesta incompleta falla explícitamente.
- **Descartado:** la lectura alternativa que se truncaba, la división recursiva por tamaño de JSON y descargar todo el horizonte al iniciar.
- **Detalle:** [disponibilidad y aranceles](disponibilidad-y-aranceles.md).

**Aranceles:** SQL confirma el importe y guarda su fotografía, TypeScript previsualiza sin guardar. Los dos usan los mismos vectores, con paridad comprobada sobre base real.
- **Descartado:** una sola implementación. En SQL, la previsualización dependería de la red; en TypeScript, no habría confirmación atómica.

**Cuotas de documentos:** son máximos individuales sobre una capacidad compartida. Una URL firmada reserva 5 MB hasta que su carga termina o vence, y los bloqueos siguen el orden global, consultorio y documento.
- **Descartado:** reservar el tamaño declarado en el presupuesto global, porque la URL admite hasta 5 MB.
- **Descartado:** una cola de análisis estructural de PDF.
- **Descartado:** borrar documentos para cumplir un límite.
- **Detalle:** [contabilidad de documentos](contabilidad-documentos.md).

## Tareas y consumo

**Programador propio:** un Worker pequeño con cinco cron y un Service Binding a la app. Cada evento ejecuta una sola categoría con presupuesto de toda la cadena y reclamaciones persistentes.
- **Descartado:** cron-job.org y los puntos de entrada que ejecutaban varias categorías. El trabajo de cron-job.org está deshabilitado. El interruptor `set_legacy_job_entrypoints(false)` se apaga en la secuencia de publicación después de aplicar la tanda 1; aún no existe en las 97 migraciones de producción. No confundir la preparación del interruptor con su aplicación remota.
- **Descartado:** suponer que el Service Binding agrega presupuesto.
- **Detalle:** [tareas automáticas](tareas-automaticas.md).

**Sin cobros por consumo sin tope** (decisión del usuario del 20 de octubre).
- La app y el programador corren en Workers Free, que corta al exceder sus límites y no cobra.
- **Descartado:** Workers Paid.
- Las protecciones de consumo, implementadas y postergadas, están en [control de consumo](control-de-consumo.md).

**Capacidad del lanzamiento:** dos consultorios en Supabase Free.
- Las pausas medidas se atribuyen a la memoria de la instancia Nano, no a la aplicación ([capacidad](capacidad.md)).
- El plan de Supabase lo decide el usuario con la medición de producción.

## Verificación y publicación

**Pruebas pesadas en CI descartable, una a la vez.** Corren en GitHub Actions, sobre snapshots aislados en el repositorio auxiliar `cita-suite-verificacion`.
- **Descartado:** suites, navegadores o bases pesadas en la máquina local, que se queda sin memoria.
- **Descartado:** empujar a `Juan4787/dashboard` para obtener CI, porque su `main` desplegaba producción.
- **Detalle:** [verificación](verificacion.md).

**El release se compila una sola vez.**
- Staging y producción reciben los mismos archivos. El paquete del Worker es idéntico en los dos entornos: sólo cambia la configuración.
- `verify:release` corre la suite de navegador sobre ese paquete en workerd y comprueba que staging lo sirve.
- **Descartado:** compilar por entorno o desde el disparador de Git de cada proveedor. El paquete probado podría no ser el publicado.
- **Detalle:** [publicación y reversión](publicacion-y-reversion.md).

**Staging de Natalia como Worker de sólo archivos** en la cuenta de Cloudflare, fuera de los buscadores.
- **Descartado:** una vista previa de Vercel. Exige la sesión de la CLI, no disponible para la campaña, y Vercel la protege con autenticación.
- Un sitio estático se comporta igual en los dos alojamientos para lo que se verifica: archivos idénticos, enlace nativo al turnero y validación del origen.

**Respaldo con el procedimiento oficial de la CLI.** Roles, esquema y datos, más los objetos de Storage, la historia de migraciones y los objetos de los esquemas de la plataforma, ensayado con una restauración completa.
- **Descartado:** restaurar sobre la imagen sola, que no tiene los roles y esquemas de un proyecto nuevo.
- **Detalle:** [respaldo y recuperación](respaldo-y-recuperacion.md).

**Producción vuelve al modelo probado antes de publicar.** Su catálogo tenía cambios hechos fuera de las migraciones: políticas, funciones, columnas, restricciones e índices. Una reconciliación versionada lo devuelve al estado que declaran sus migraciones aplicadas, dentro de la misma transacción de publicación, y un ensayo con `ROLLBACK` lo comprueba sobre el esquema real.
- **Descartado:** publicar sobre la deriva. Tres migraciones fallaban, y la app nueva habría corrido sobre reglas que ninguna prueba cubre: por ejemplo, `owner_id` con `auth.uid()` por omisión rompía las inserciones del servidor.
- **Descartado:** volver tolerantes a la deriva las migraciones pendientes. La deriva habría quedado viva, sin prueba que la cubra.
- **Adoptado de la deriva:** dos protecciones que el modelo probado no tenía, ahora migraciones con su prueba que falla primero:
  - el cierre de las escrituras directas, que dejaba a un administrador hacerse dueño (`20261022010000`);
  - la historia clínica que sobrevive al borrado de un usuario (`20261022000000`).
- **Postergado: las lecturas con alcance por rol** que producción tenía a mano. Por ejemplo, un profesional sólo veía los profesionales, prestaciones y horarios de su agenda.
  - **Riesgo residual:** dentro de un mismo consultorio, cualquier miembro lee esos datos de sus colegas, incluido el motivo de una excepción de horario. No cruza consultorios.
  - **Por qué no ahora:** adoptarlas cambia lo que ve cada rol y exige recorrer de nuevo la interfaz con esas reglas.
  - **Cuándo retomarlo:** cuando un consultorio real pida esa reserva entre colegas, con una migración y sus pruebas por rol.
- **Detalle:** [publicación y reversión](publicacion-y-reversion.md).

**Natalia abre el turnero real por navegación nativa.**
- **Descartado:** el iframe y el SDK como recorrido principal: las notificaciones y la gestión necesitan el mismo origen del turnero.

## Identidad

Producto y recursos propios se llaman Cita Suite, o `cita-suite` donde la plataforma exige un identificador.
- **Se conservan** los identificadores estables cuyo cambio rompería contratos: el Worker `app` y su origen, la ruta `/odonto`, los project refs, claves y buckets.
- **Descartado:** reemplazos globales de `sabrina`, `odonto` u `odontologia`.
- **Detalle:** [identidad](identidad-cita-suite.md).

## Postergado, con su riesgo

**Comparadores de parámetros de ruta.** Hoy cada ruta valida su identificador con `isUuid` y responde 404. El riesgo y cuándo retomarlo están en la [guía para nuevas funciones](guia-nuevas-funciones.md).
