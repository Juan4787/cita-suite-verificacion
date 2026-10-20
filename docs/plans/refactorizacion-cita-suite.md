# Plan integral de refactorización de Cita Suite

## 1. Objetivo, alcance y condiciones de partida

Preparar Cita Suite para incorporar nuevos consultorios, llegar al escenario de 25 y seguir agregando funciones sin rehacer su infraestructura ni depender de controles manuales para evitar regresiones.

La estrategia es conservar el monolito, PostgreSQL/Supabase, Cloudflare y la web de Natalia, pero establecer responsabilidades claras, contratos comprobables, aislamiento entre consultorios y límites operativos medidos. No habrá una reescritura, microservicios, una base por consultorio ni un sistema genérico de plugins.

La campaña se realizará en entregas pequeñas sobre una rama aislada. **La publicación será posterior al cierre de toda la campaña y su auditoría.** Un avance parcial no se presentará como refactorización terminada.

### Decisiones que quedan fijadas

| Tema | Decisión |
|---|---|
| Organización | Seis áreas funcionales amplias, con subdivisiones internas cuando resulten útiles. |
| Disponibilidad | Un calculador TypeScript compartido y lecturas consistentes mediante contratos SQL acotados. |
| Aranceles | SQL confirma el importe; TypeScript permite previsualizar configuraciones sin guardarlas. Paridad comprobada entre ambos. |
| Archivos | Presupuesto global de 700 MB y cuota base automática de 100 MB por consultorio que active documentos. |
| Naturaleza de las cuotas | Son máximos individuales sobre una capacidad compartida, no espacio garantizado reservado. |
| Tareas automáticas | Programación nativa de Cloudflare, con ejecuciones separadas y presupuestos medidos. |
| Push y calendario | Frecuencia inicial de cinco minutos; objetivo de comenzar el trabajo pendiente ordinario dentro de diez minutos. |
| Pruebas pesadas | Entorno descartable de CI; no aumentar la carga sobre tu computadora ni usar producción. |
| Natalia | Navegación al turnero real de Cita Suite, conservando su presentación e identidad visual. |
| Funciones pospuestas | Cursos y noticias quedan fuera. Las notificaciones por WhatsApp continúan descartadas. |

Los MB se expresarán en bytes decimales: 100 MB son `100.000.000` bytes.

### Qué está comprobado y qué sigue pendiente

La revisión actual incluyó código, configuraciones, scripts, migraciones y documentación oficial. **No constituye todavía una prueba de funcionamiento de la arquitectura propuesta:** esa evidencia se obtendrá durante su ejecución.

Hay dos bloqueos operativos comprobados:

- La cuenta autenticada en Wrangler no coincide con la cuenta configurada para el proyecto. La consulta de despliegues falló por autenticación. Antes de publicar debe resolverse el acceso al destino correcto; no se cambiará el identificador para publicar accidentalmente en otra cuenta.
- La sesión actual de GitHub permite consultar el repositorio, pero no administrar sus políticas de Actions. Esto no demuestra que la clave SSH carezca de permisos de escritura; son accesos diferentes.

El plan efectivo de Cloudflare, los disparadores disponibles y la versión actualmente desplegada deben verificarse cuando se recupere ese acceso.

**Esta aprobación alcanza al diseño del plan. Su ejecución requiere tu indicación explícita.**

## 2. Arquitectura de destino y contratos

### Seis áreas, sin fragmentación burocrática

| Área | Responsabilidades |
|---|---|
| Acceso y administración comercial | Sesiones, membresías, permisos, administración maestra y estados comerciales. |
| Equipo | Profesionales, prestaciones, asignaciones y configuración de horarios. |
| Agenda y reservas | Disponibilidad, reservas, reprogramaciones, restricciones y aranceles. |
| Pacientes y clínica | Identidad, cuestionarios, historia clínica, documentos, seguimientos y exportaciones. |
| Integraciones y tareas | Push, calendario, reseñas, proveedores y procesamiento diferido. |
| Sitios y presentación pública | Integraciones web, direcciones autorizadas, identidad visual y configuración del turnero público. |

Se permitirán importaciones entre las interfaces públicas de estas áreas. Se impedirán las importaciones de sus detalles internos, los ciclos y el acceso desde el navegador a código exclusivo del servidor.

No se exigirá un archivo coordinador para cada operación sencilla. Tampoco se crearán repositorios genéricos, clases o capas que sólo reenvíen llamadas.

Las reglas de dependencias se comprobarán automáticamente con `dependency-cruiser`, usando una versión compatible fijada en el proyecto. Las excepciones temporales tendrán propietario y desaparecerán antes del cierre; no habrá una exclusión general permanente para el código antiguo.

### Propiedad de las reglas

| Responsabilidad | Autoridad |
|---|---|
| Aislamiento, relaciones entre consultorios, permisos de base, exclusión temporal, cuotas e idempotencia | PostgreSQL. |
| Transiciones atómicas y precio confirmado de una reserva | PostgreSQL. |
| Lectura autorizada y consistente de disponibilidad | Contratos SQL específicos para cada alcance. |
| Generación de opciones horarias | Calculador TypeScript común. |
| HTTP, contexto de petición y proveedores externos | Servidor TypeScript. |
| Interacción, presentación y validación orientativa | Interfaz. |

Una validación de interfaz nunca sustituirá la validación definitiva. Tampoco se trasladarán transacciones a TypeScript para simplificar artificialmente los archivos SQL.

### Tipado, autorización y contratos públicos

Todas las fábricas Supabase y sus consumidores activos terminarán tipados. Los tipos se generarán desde una base descartable construida con las migraciones completas y se comprobará que sean reproducibles.

Los retornos JSON tendrán validación en ejecución. Un genérico `Database` no demuestra que el contenido interno de un JSON sea correcto.

El contexto común de petición resolverá identidad, consultorio, membresía, permisos y capacidades efectivas. Podrá reutilizar lecturas dentro de esa petición, pero no conservar permisos en una caché global compartida entre personas. Las escrituras comprobarán autorización vigente.

Las capacidades distinguirán cuatro cuestiones:

1. Disponibilidad operativa global.
2. Habilitación del consultorio.
3. Configuración del consultorio o profesional.
4. Permisos del actor y estado comercial.

Las rutas públicas actuales, los enlaces de gestión y sus alcances se conservarán. Los cambios incompatibles de RPC tendrán una transición explícita; las migraciones ya aplicadas no se editarán.

La ruta histórica `/odonto` puede conservarse sin determinar el comportamiento del negocio. El módulo administrativo inactivo no se activará ni recibirá contratos inventados.

## 3. Ejecución ordenada y criterios de cierre

### Etapa 0. Establecer una base real y preservar el trabajo existente

Antes de modificar código:

- Registrar el estado efectivo del árbol de trabajo, las diferencias locales y los archivos relevantes.
- Separar el estado vigente de los cambios anteriores que fueron rechazados. Un commit existente no equivale a una entrega aceptada.
- Identificar aplicaciones, destinos, migraciones, variables, proveedores y programadores actualmente utilizados.
- Construir una matriz funcional: recorrido, roles, consultorio, contrato, garantía SQL y prueba correspondiente.
- Registrar problemas existentes para distinguirlos de regresiones introducidas.

No se harán limpiezas globales, restauraciones masivas ni incorporaciones indiscriminadas de archivos.

**Cierre:** base identificada, cambios preservados y alcance trazable. Los accesos pendientes quedarán como bloqueos explícitos de las etapas remotas.

### Etapa 1. Hacer confiable la verificación

Se establecerán tres comandos:

| Comando | Contenido |
|---|---|
| `verify:fast` | Tipos de las aplicaciones activas, reglas de dependencias y pruebas unitarias de servidor y cliente. |
| `verify:full` | Lo anterior, migraciones desde cero, pruebas SQL, aislamiento, concurrencia, Auth/Storage reales en entorno descartable y recorridos de navegador. |
| `verify:release` | Lo anterior, compilaciones, pruebas del artefacto construido, comprobaciones de staging y evidencias necesarias para publicar. |

Reglas:

- Suites, compilaciones y navegadores se ejecutan secuencialmente.
- Vitest y Playwright quedan configurados con un único trabajador y sin paralelismo entre archivos.
- Una suite obligatoria con cero pruebas, omitida o interrumpida hace fallar la verificación.
- Natalia queda incluida expresamente; el comando raíz actual no será considerado suficiente por su nombre.
- Un bloqueo de exclusión impide que dos verificaciones usen simultáneamente la misma base descartable.
- Cada ejecución identifica sus recursos y sólo limpia los que le pertenecen.
- Los servidores deben demostrar que están preparados antes de iniciar las pruebas.

Las pruebas de carreras usarán dos conexiones controladas dentro de una única prueba. Esto permite comprobar concurrencia sin ejecutar múltiples suites pesadas.

Se distinguirán las evidencias de PostgreSQL con autenticación simulada, Auth/Storage reales y despliegue real en Cloudflare/Vercel. Ninguna sustituirá silenciosamente a otra.

**Cierre:** comandos reproducibles que detectan una falla introducida deliberadamente en una garantía crítica y que no pueden informar éxito por haber omitido una suite.

### Etapa 2. Completar tipos, contexto y aislamiento

Se tiparán las fábricas centrales y todos sus consumidores activos, incluidas acciones, rutas públicas y tareas automáticas.

Los escapes de tipos se corregirán en su origen. No se reemplazará `any` por conversiones ciegas, supresiones o `as unknown as` para obtener una compilación verde. Las particularidades inevitables de un SDK quedarán contenidas en su adaptador.

En paralelo:

- Consolidar la resolución de sesión y consultorio.
- Mantener separados el contexto de un usuario, el de una reserva pública y la autenticación interna de tareas.
- Revisar las relaciones entre entidades pertenecientes a consultorios y completar restricciones compuestas donde correspondan.
- Revisar RLS, privilegios de funciones y funciones privilegiadas, incluidas las llamadas directas que evitan la interfaz.
- Conservar las diferencias vigentes entre acceso restringido, archivado y permisos históricos.

Las funciones nuevas tendrán privilegios explícitos. Si cambia el tipo de retorno de una función SQL, se resolverán sus dependencias y permisos mediante una migración compatible, no suponiendo que `CREATE OR REPLACE` admite cualquier cambio.

**Cierre:** todos los clientes activos tipados; contratos JSON comprobados; contexto común; pruebas negativas de acceso entre consultorios y después de revocar permisos.

### Etapa 3. Integrar capacidades y cuotas

La habilitación de documentos y su cuota será una única operación coherente:

- Un consultorio nuevo que active documentos recibe automáticamente la cuota base de 100 MB.
- El administrador maestro puede modificar el valor predeterminado y las excepciones individuales.
- Si ya existe una cuota válida, desactivar y reactivar documentos la conserva.
- No puede informarse una activación exitosa con cuota ausente o cero.
- Los consultorios existentes se migran sin reducir silenciosamente su capacidad: se conserva el máximo anterior aplicable y nunca se fija un límite inferior a su consumo más reservas pendientes.
- Reducir un límite por debajo del espacio comprometido se rechaza. No se eliminan documentos para forzar el cumplimiento.

La contabilidad tendrá dos niveles:

| Control | Cálculo |
|---|---|
| Presupuesto global y del consultorio | Bytes almacenados más reservas pesimistas de cargas pendientes. |
| Límite del paciente por reserva | Bytes reales finalizados más tamaño declarado de cargas pendientes. |

Se conservan los límites de 5 MB por archivo, 10 MB y tres documentos por reserva del paciente.

Mientras una URL firmada permita subir hasta 5 MB, se reservarán esos 5 MB en los presupuestos global y del consultorio. Para el límite de 10 MB se usará el tamaño declarado pendiente, verificándolo contra el tamaño real al finalizar.

**Caso obligatorio:** dos archivos de 3,5 MB y uno de 200 KB deben caber en el límite de la reserva. Podrán rechazarse por falta real de presupuesto global o del consultorio para respaldar la URL, pero no por confundir ambas contabilidades.

Las operaciones bloquearán siempre en el mismo orden: global, consultorio y documento. No habrá llamadas a Storage dentro de una transacción abierta.

La reconciliación incluirá objetos pendientes, abandonados, fallidos, derivados y archivos que sigan ocupando espacio aunque estén en papelera. Las demás rutas propias de carga también deberán participar del presupuesto global. Las modificaciones manuales externas a la aplicación se detectarán mediante reconciliación; no se fingirá que un contador interno puede impedirlas.

La liberación de reservas respetará la expiración real de las URLs y su margen de seguridad. Será repetible y no borrará archivos clínicos válidos por una discrepancia de contadores.

Se conserva la validación síncrona básica de PDF: metadatos reales y lecturas parciales acotadas. Si Storage ignora `Range`, no se descargará el archivo completo a memoria como alternativa. No se construirá una cola para analizar estructuralmente PDFs.

**Cierre:** pruebas de carreras, expiración, repetición, reconciliación, descarga del archivo correcto y ampliación de cuotas sin alterar datos ni pendientes.

### Etapa 4. Consolidar disponibilidad, reservas y aranceles

**Disponibilidad**

Se mantendrá un único calculador TypeScript. Las lecturas pública e interna conservarán sus permisos propios y alimentarán un contrato común.

La lectura utilizará ventanas fijas de hasta quince días naturales y grupos de hasta dieciséis profesionales por consulta. El horizonte público seguirá respetando la configuración existente; ese tamaño de grupo no será un límite al equipo del consultorio.

Cada ventana será consistente en SQL. Se conservarán los intervalos necesarios para distinguir ocupación base, márgenes y descansos: reducirlos únicamente a inicio y fin perdería comportamiento actual.

El catálogo y la configuración no se consultarán de nuevo por cada fragmento. La interfaz solicitará las ventanas necesarias, sin descargar automáticamente todo el horizonte al iniciar.

Se eliminará la lectura alternativa susceptible de truncamiento una vez cubierta su equivalencia. No habrá división recursiva por tamaño de JSON ni reinticios de todo el horizonte porque haya entrado una reserva en otra ventana.

Una respuesta incompleta, truncada o inválida fallará explícitamente. Nunca se convertirá en una lista vacía que aparente disponibilidad.

**Reservas y restricciones**

Se conservarán exclusión temporal, idempotencia, revalidación y atomicidad. Las franjas de seguimiento seguirán vinculadas a prestaciones del mismo consultorio.

Si una franja restringida pierde sus prestaciones permitidas, quedará cerrada; nunca pasará automáticamente a permitir todas.

**Aranceles**

El contrato será:

- Importes en pesos enteros.
- Acumulación con precisión exacta, sin alimentar el siguiente mes con un importe redondeado.
- Redondeo únicamente sobre la cotización final, al peso o múltiplo configurado.
- Cambios del porcentaje general con vigencia y excepciones de un mes conservan sus diferencias actuales.
- Mes determinado con la zona horaria del consultorio.
- Meses `0` a `600`, inclusive; máximo de 120 resultados por previsualización.
- Una fecha anterior al mes base se rechaza coherentemente en TypeScript y SQL.

Se corregirá el desfase comprobado del límite superior del preview.

El ejemplo de control será `$15` con 50 % mensual: `$23` el primer mes y `$34` el segundo. Redondear cada mes produciría incorrectamente `$35`.

TypeScript permitirá una previsualización inmediata sin guardar políticas. SQL seguirá confirmando el importe y guardando su fotografía histórica. Ambas implementaciones usarán los mismos vectores de resultados esperados y pruebas de paridad sobre base real.

Al cambiar una política entre cotización y confirmación, se exigirá actualizar y aceptar el importe. No se reescribirán precios históricos.

**Cierre:** equivalencia entre recorridos públicos e internos, paridad de precios y pruebas de reservas simultáneas, reprogramación, excepciones, márgenes, cambios de política y respuestas perdidas.

### Etapa 5. Extraer las áreas y descomponer la interfaz

Con los contratos y garantías anteriores establecidos, se extraerán recorridos completos hacia las seis áreas.

Las rutas conservarán lectura de parámetros, autorización, llamada a la operación y traducción de resultados. Las reglas compartidas saldrán de los controladores; las operaciones sencillas no recibirán capas artificiales.

Los componentes grandes se dividirán por tareas del usuario y estados de interacción. Se conservarán los controles personalizados y el diseño vigente.

Comprobaciones específicas:

- Configuración de profesional, prestaciones y horarios permanece en su lugar; no se duplica en la conexión del sitio.
- El formulario final mantiene los campos obligatorios antes de los opcionales.
- La marca sólo determina presentación, nunca permisos ni reglas.
- Los temas utilizan colores semánticos y mantienen continuidad clara/oscura.
- Natalia abre la reserva real de Cita Suite mediante navegación nativa.
- Notificaciones y gestión funcionan en el mismo origen del turnero real.
- Las direcciones de retorno se validan; no se permite una redirección arbitraria.
- No aparecen desbordamientos horizontales, controles recortados ni estilos nativos accidentales.

Se revisarán escritorio y móvil, teclado, foco, errores, carga, estados vacíos y contenido largo. La comparación incluirá JavaScript transferido e hidratación: reorganizar archivos no deberá aumentar injustificadamente la carga de la web de Natalia.

**Cierre:** equivalencia funcional y visual comprobada, con capturas de referencia y recorridos de navegador. Cursos y noticias permanecen intactos.

### Etapa 6. Separar y presupuestar las tareas automáticas

El programador será un Worker pequeño dedicado a disparar trabajo mediante un Service Binding. No contendrá reglas del negocio, credenciales de Supabase ni credenciales de proveedores.

Cada evento ejecutará un tipo de tarea y esperará su resultado:

| Trabajo | Programación UTC |
|---|---|
| Push | `*/5 * * * *` |
| Calendario | `1-59/5 * * * *` |
| Reseñas | `2-59/10 * * * *` |
| Limpieza de cargas | `3-59/15 * * * *` |
| Mantenimiento | `17 */3 * * *` |

El mantenimiento alternará conciliación comercial y reconciliación de almacenamiento; cada una tendrá frecuencia de seis horas. Sus operaciones serán acotadas.

Son cinco disparadores: se verificará que la cuenta correcta disponga de capacidad antes de activarlos. La programación se mantendrá versionada. Cloudflare utiliza UTC y advierte que los cambios pueden tardar hasta quince minutos en propagarse. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

El presupuesto comprenderá **toda la cadena de ejecución**. No dependerá de asumir que cada Service Binding otorga un presupuesto nuevo.

Los perfiles iniciales serán:

| Perfil | Presupuesto de aplicación |
|---|---|
| Workers Free | Hasta 40 llamadas externas por cadena, con margen frente al límite de plataforma. |
| Workers Paid | Hasta 300 llamadas externas por cadena, sujeto a las mediciones del lote. |
| Ambos | Hasta cuatro operaciones externas simultáneas y veinte segundos de tiempo total por ejecución, reservando margen para finalizar. |

El tamaño del lote se derivará del costo máximo por elemento, incluyendo autenticación, lecturas, envíos, resultados, SDK, redirecciones y reintentos. No se conservará un número fijo porque actualmente exista en el código.

Cloudflare documenta además 128 MB por isolate, seis conexiones salientes simultáneas y sólo 10 ms de CPU en Free. Por eso cumplir el presupuesto de llamadas no basta para certificar este perfil. [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).

Se reutilizarán las reclamaciones y estados persistentes existentes:

- Recuperación de reclamaciones vencidas.
- Reparto entre consultorios sin que uno monopolice la cola.
- Contexto y escrituras agrupadas cuando sea seguro.
- Revalidación de cancelación o reprogramación antes del efecto externo.
- Tratamiento explícito de respuestas perdidas y entrega incierta.
- Reintentos persistentes con espera, sin bucles inmediatos indefinidos.
- Identificadores estables cuando el proveedor permita deduplicación.

No se prometerá entrega exactamente una vez en proveedores que no puedan garantizarla.

Se separarán los puntos de entrada de push, calendario, reseñas y limpieza. El punto de entrada antiguo dejará de ejecutar varias categorías durante la transición.

**Cierre:** recuperación demostrada y comienzo del trabajo ordinario dentro de diez minutos en el escenario acordado. Si Free no alcanza, la ampliación necesaria quedará medida y documentada antes de publicar.

## 4. Verificación de capacidad, regresiones y mantenibilidad

### Entornos

Tu computadora conservará las pruebas livianas y secuenciales. La disponibilidad de memoria observada no justifica aumentar el contenedor local de PostgreSQL a 4 GB.

Para pruebas pesadas se usará GitHub Actions con `ubuntu-24.04`, versiones fijadas y un único trabajo secuencial. El repositorio es público y GitHub documenta recursos estándar de cuatro CPU y 16 GB para ese entorno; falta comprobar y habilitar el acceso efectivo a Actions. [Runners de GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

El trabajo comprobará memoria, disco y servicios disponibles antes de cargar datos. PostgreSQL tendrá inicialmente 4 GB y dos CPU en ese runner, dejando margen al resto del entorno.

Además habrá staging aislado de Cloudflare, Natalia y Supabase para demostrar el comportamiento desplegado. Si necesita recursos pagos, su contratación requerirá autorización específica. El resultado del contenedor de CI no se presentará como prueba de capacidad del Supabase alojado.

### Datos y carga

| Escenario | Pacientes | Turnos |
|---|---:|---:|
| Cinco consultorios, doce meses | 30.000 | 60.000 |
| Veinticinco consultorios, doce meses | 150.000 | 300.000 |

Se usarán datos sintéticos deterministas, identidades ficticias y los estados realmente admitidos por el sistema. No se inventarán estados para facilitar las pruebas.

Cada escenario tendrá dos minutos de preparación y diez minutos de medición, repetidos tres veces secuencialmente. Habrá un usuario concurrente por consultorio, 80 % de lecturas y 20 % de escrituras internas, con pausas de tres a ocho segundos.

La reserva pública se probará por separado:

- Recorrido completo real desde Natalia y desde el enlace compartido.
- Carga de lecturas públicas dentro de sus límites.
- Escrituras desde un único generador limitadas a una cada cuatro minutos, con teléfonos sintéticos diferentes.
- Pruebas específicas de abuso que esperan el rechazo correspondiente.

El límite por IP actual es global. No se desactivará ni se eludirá con encabezados falsos para fabricar una medición favorable.

### Criterios de aceptación

| Aspecto | Condición |
|---|---|
| Lecturas principales | p95 inferior a 1 s; p99 inferior a 2 s. |
| Escrituras principales | p95 inferior a 1,5 s; p99 inferior a 3 s. |
| Errores técnicos inesperados | Menos del 1 %. |
| Aislamiento, doble reserva y cuotas | Ninguna violación. |
| Push y calendario | Inicio dentro de diez minutos con proveedores saludables y volumen ensayado. |
| Disponibilidad | Completa o error explícito; nunca éxito parcial silencioso. |

Son objetivos que deben demostrarse, no resultados ya obtenidos.

Para las colas se ensayarán cinco elementos pendientes por consultorio y un escenario desigual: un consultorio con una cola muy grande y los restantes con trabajo pendiente. Se medirá la antigüedad por consultorio, además del total procesado.

La revisión SQL comprobará planes, índices, bloqueos y crecimiento de consultas al aumentar otros consultorios. No se exigirá eliminar todo recorrido secuencial: se justificará cada decisión con datos representativos.

### Matriz de regresiones obligatoria

- Cruces de consultorio mediante lecturas, escrituras, identificadores manipulados y funciones directas.
- Revocación de membresía, cambio de rol y estados comerciales.
- Capacidades diferentes entre consultorios y acceso histórico autorizado.
- Reservas simultáneas, repetidas y reprogramadas.
- Restricciones de seguimiento y eliminación de una prestación permitida.
- Cuestionarios obligatorios, opcionales y actualización correcta del perfil.
- Historia clínica y documentos bajo cada rol autorizado.
- Límites de archivos, cargas simultáneas, expiraciones y descarga con identidad correcta.
- Precios acumulados, excepciones, redondeo, mes 600 y cambios durante la confirmación.
- Proveedores lentos, caídos o con resultado incierto.
- Navegación, tema y notificaciones desde Natalia.
- Vistas de 320, 390, 768, 1280 y 1600 píxeles, contenido largo y navegación por teclado.

La observabilidad diferenciará viajes HTTP a la base, llamadas a proveedores y trabajo SQL. No llamará “cantidad de consultas SQL” a un contador de `fetch`. Los registros excluirán datos clínicos, tokens y URLs firmadas, y tendrán retención acotada.

## 5. Auditoría final, publicación y documentación

### Auditoría final

Una vez completadas las etapas se hará una revisión transversal del resultado, no sólo de cada cambio:

- Buscar rutas alternativas que eviten permisos, cuotas, capacidades o contratos.
- Detectar clientes sin tipar y conversiones que oculten incompatibilidades.
- Revisar duplicación de reglas e importaciones privadas.
- Comprobar paginación, truncamiento y listas vacías usadas como recuperación de errores.
- Confirmar que el funcionamiento no depende de configuración manual ausente en un consultorio nuevo.
- Repetir los recorridos cruzados más sensibles sobre los artefactos construidos.
- Ensayar aumento de cuota y cambio de recursos conservando datos, permisos y pendientes.

Los defectos encontrados dentro de la campaña se corregirán y volverán a verificar. Una deuda conocida no quedará cerrada mediante un comentario que diga “más adelante”.

### Publicación

La preparación de una entrega incluirá versiones, sumas de comprobación, destinos y migraciones exactas.

La secuencia será:

1. Verificar y ensayar respaldo y recuperación en un entorno aislado.
2. Aplicar las migraciones compatibles en staging.
3. Desplegar y comprobar aplicación, Natalia y programador.
4. Ejecutar la auditoría de release.
5. Presentar la entrega concreta para tu autorización explícita de publicación.
6. Una vez autorizada, detener el programador anterior y esperar sus ejecuciones activas.
7. Publicar migraciones compatibles y aplicaciones.
8. Activar el programador nuevo y comprobar sus eventos reales.
9. Verificar versión servida, permisos, reserva pública, almacenamiento y tareas.

La reversión detendrá primero el programador nuevo. Después restaurará una versión compatible y, si corresponde, el programador anterior. No dependerá de deshacer destructivamente migraciones ni de restaurar una base completa perdiendo escrituras nuevas.

### Documentación entregable

Quedarán versionados:

- Mapa de áreas, dependencias y propiedad de las reglas.
- Catálogo de contratos públicos y SQL.
- Matriz de permisos y capacidades.
- Contabilidad y ciclo de vida de archivos.
- Programación, presupuestos, reclamaciones y recuperación de tareas.
- Comandos de verificación y preparación de entornos.
- Generadores sintéticos y resultados de carga.
- Decisiones arquitectónicas y alternativas descartadas.
- Procedimiento de publicación y reversión.
- Guía para añadir una función: área responsable, contrato, permisos, efectos transaccionales y regresiones que debe cubrir.

**La campaña se considerará terminada cuando cierre las deudas identificadas dentro de este alcance, demuestre los escenarios de cinco y veinticinco consultorios y permita ampliar recursos sin cambiar el modelo multiempresa.** La evidencia distinguirá siempre lo comprobado localmente, lo simulado y lo demostrado en un despliegue real.

---

# Instrucción de ejecución aprobada por el usuario

Ejecutá íntegramente el plan de refactorización aprobado, de principio a fin, con autonomía técnica y sin detenerte a solicitar autorización entre etapas.

**Modalidad de ejecución: estricta en los objetivos, flexible en la implementación.**

1. **Cumplimiento obligatorio:** respetá el alcance, las decisiones arquitectónicas, las garantías funcionales, los criterios de aceptación y las condiciones de cierre del plan. No omitas etapas, pruebas ni compromisos para simplificar el trabajo.

2. **Flexibilidad técnica:** podés modificar los detalles de implementación cuando encuentres una alternativa demostrablemente mejor, más simple, más segura o más mantenible. No sigas literalmente una solución si descubrís que es incorrecta o inferior. Toda modificación debe preservar o mejorar las garantías exigidas.

3. **Autonomía:** investigá, implementá, ejecutá pruebas, diagnosticá fallas y corregí sus causas raíz sin pedirme permiso para cada decisión. Continuá con la siguiente etapa cuando hayas verificado satisfactoriamente la anterior.

4. **Profundidad:** evitá soluciones superficiales, parches que oculten defectos, verificaciones ficticias y refactorizaciones puramente cosméticas. Corregí los mecanismos responsables de los problemas.

5. **Preservación:** mantené todos los comportamientos existentes que no deban modificarse expresamente. No introduzcas regresiones, pérdidas de información, incompatibilidades injustificadas ni cambios funcionales ajenos al plan.

6. **Verificación:** cada etapa debe cumplir sus criterios de cierre mediante evidencia real. Si una prueba falla, investigá y corregí antes de avanzar. No declares completado aquello que no pudiste comprobar.

7. **Desviaciones:** documentá brevemente los cambios respecto del plan y su justificación técnica. Si descubrís que una decisión fundamental del plan es inviable o compromete sus objetivos, no improvises una arquitectura diferente: exponé el bloqueo y la alternativa recomendada.

8. **Alcance:** no agregues funcionalidades nuevas ni complejidad innecesaria. Podés realizar cambios adicionales cuando sean indispensables para cumplir correctamente los objetivos aprobados.

9. **Continuidad:** completá toda la campaña, incluida la auditoría transversal final. No interpretes la finalización de una etapa como la finalización del encargo.

10. **Producción:** trabajá sobre una rama aislada y los entornos de prueba autorizados. No despliegues a producción, modifiques datos reales ni contrates servicios sin mi autorización explícita.

**Criterio rector:** máxima calidad técnica y mantenibilidad, mínimo de complejidad accidental, preservación integral del funcionamiento y cumplimiento demostrable de todos los objetivos del plan.

No priorices terminar rápido ni minimizar cambios por encima de hacer correctamente el trabajo. Entregá el resultado completo junto con las pruebas ejecutadas, sus resultados, las desviaciones justificadas y cualquier limitación pendiente.


# Directivas de preservación y continuidad

guardá el plan completo y aprobado en `docs/plans/refactorizacion-cita-suite.md`, sin resumirlo, simplificarlo ni omitir ninguna condición.

Ese archivo será la fuente de verdad durante toda la campaña, por encima de cualquier resumen generado por compactación de contexto.

Mantené un registro separado de etapas terminadas, cambios efectuados, pruebas ejecutadas, resultados, decisiones justificadas, bloqueos y trabajos pendientes.

Después de cada compactación, y antes de comenzar cada etapa, volvé a consultar el plan original y contrastá el estado de ejecución con sus requisitos y criterios de aceptación.

Nunca reconstruyas el plan de memoria ni interpretes un requisito omitido en el resumen como un requisito eliminado.

Podés adaptar los medios técnicos, pero no reducir los objetivos, las garantías ni los criterios de cierre aprobados.

Antes de declarar terminada la campaña, verificá punto por punto el cumplimiento del documento original utilizando evidencia comprobable.

Después de cada compactación, releé el plan original y el registro de progreso, identificá el último punto verificado y continuá desde el siguiente trabajo pendiente, sin repetir innecesariamente operaciones ya comprobadas ni dar por terminadas tareas incompletas.

---

# Ampliación aprobada por el usuario: identidad unificada «Cita Suite»

## Pedido original íntegro — 16 de octubre de 2026

Agrega cuanto antes al plan en la fase que consideres oportuna, un cambio de nombre de repositorio, supabase, github, etc por "Cita Suite" el repositorio se llama base de datos sabrina, el proyecto de supabase "odontologia" en github tiene otro nombre, necesito que quede TODO UNIFICADO bajo "Cita Suite", pero incorpora al plan la instruccion de hacerlo con rigor extremo modificando todo lo que haya que modificar para que no genere efectos secundarios y quede 100% consistente en todos. Siguiente punto que quiero que sepas, ya conecte github actions, te paso los comandos asi estas al tanto de todo.
Hechas estas aclaraciones, segui donde quedaste con rigor extremo

## Incorporación al alcance y secuencia obligatoria

Esta ampliación agrega un objetivo de cierre a la campaña original; no sustituye ninguna etapa, garantía ni condición previa. La denominación de producto y los nombres visibles de sus recursos propios serán **Cita Suite**. Cuando una plataforma exija un identificador sin espacios, se utilizará `cita-suite`, con sufijos de entorno o función explícitos cuando sean necesarios, por ejemplo `cita-suite-staging` y `cita-suite-verificacion`. No se confundirá la identidad del producto con la del consultorio o profesional: Natalia y las denominaciones reales de cada consultorio se conservan.

1. **Etapa 0, ampliación inmediata del inventario:** identificar los nombres efectivos y todas sus dependencias antes de ejecutar cambios. Registrar nombre anterior, nombre objetivo, propietario/cuenta, entorno, identificador estable, consumidores, mecanismo de cambio, comprobaciones y reversión. Incluir repositorio GitHub principal y auxiliar, remotos y clones Git, directorio local, proyecto Supabase y configuración CLI, paquetes/workspaces, documentación, CI, aplicaciones de GitHub, webhooks, proveedores de despliegue, Workers/programador, Vercel, dominios, OAuth, correo, notificaciones, manifest/PWA, almacenamiento/cachés y scripts. Verificar existencia y alcance real: no renombrar recursos de otros productos por compartir cuenta.
2. **Etapas 2 a 6, preparación compatible:** ajustar las referencias de código, configuración, scripts y documentación que dependan de nombres; incorporar comprobaciones sobre esos contratos. El cambio de identidad no debe mezclarse con una migración injustificada de datos o infraestructura. Las referencias operativas activas se actualizan; los registros históricos, migraciones ya aplicadas y evidencias originales se preservan y se explican en un inventario de excepciones justificado.
3. **Etapa 5, identidad y repositorio:** consolidar los nombres de presentación, paquetes y documentación; preparar la transición del repositorio principal a `cita-suite`. Confirmar disponibilidad del nombre y permisos, vínculos entre repositorios/entornos, protección de ramas, Actions, permisos y disparadores, referencias `owner/repo`, aplicaciones instaladas y consumidores externos. Ensayar el cambio en un recurso descartable cuando tenga efectos de integración. La redirección automática de GitHub no sustituye actualizar ni comprobar los consumidores. Si algún nombre objetivo está ocupado, registrar el conflicto y resolverlo sin apropiarse ni destruir recursos ajenos.
4. **Preparación de release y staging:** probar la identidad y todas sus dependencias sobre los artefactos construidos y destinos separados. Preparar una secuencia exacta de cambio y reversión, con responsables, nombres/URLs anteriores y nuevos, referencias que se actualizan juntas y orden de aplicación. No habilitar un despliegue automático al renombrar o reconectar el repositorio.
5. **Puerta de publicación existente:** los cambios externos que afecten destinos de producción, sus nombres, dominios, integraciones, aplicaciones o claves de vinculación se ejecutarán dentro de la entrega explícitamente autorizada. Este pedido autoriza incorporar y preparar rigurosamente la ampliación; no elimina la prohibición de intervenir producción, datos reales o contratar servicios. Se registrará lo preparado, lo ensayado y lo efectivamente aplicado por separado.
6. **Directorio local:** preparar y verificar el cambio de `Base de Datos Sabrina` a `Cita Suite`, incluyendo referencias absolutas vigentes, configuraciones del editor, tareas, scripts y registros de continuidad. Ejecutar el movimiento sólo con procesos detenidos y contexto de trabajo trasladado de forma segura. No invalidar a mitad de la campaña las rutas de esta sesión ni manipular credenciales o archivos ajenos. Los vínculos históricos de evidencia no se reescriben como si hubieran sido creados en la ruta nueva.

## Garantías técnicas de la unificación

- **Supabase:** cambiar el nombre visible del proyecto correcto conservando su project ref, organización, región, datos, esquema, buckets, políticas, claves y URLs de API/Auth/Storage, salvo que exista una razón técnica comprobada y una transición específica autorizada. Un cambio de nombre no requiere crear otra base, reemplazar credenciales ni migrar pacientes. Revisar qué referencias CLI o de integración dependen del nombre y cuáles del identificador. El nombre «Odontologia» corresponde, según el adjunto, a `yjzferwuzbtgpmdnzlcb`; volver a verificarlo antes de cualquier acción remota. No confundirlo con el proyecto distinto «Odonto» ni con recursos de otros productos.
- **GitHub y CI:** conservar historia, ramas, PR/issues, permisos, reglas y configuración relevante. Guardar el inventario anterior y comprobar remotos, clonación, workflow manual sobre el SHA esperado, checks y vínculos de proveedores después de la transición. Los tokens no se copian a archivos ni logs. El workflow propio mantiene permisos mínimos explícitos aunque la configuración general de Actions otorgue escritura.
- **Hosting y dominios:** un nombre visible, un slug de recurso y una dirección pública son contratos distintos. Si renombrar un Worker, proyecto o dominio cambia URLs o bindings, preparar compatibilidad de enlaces existentes, enlaces de gestión de turnos, API pública, notificaciones/push, service worker, webhooks, callbacks OAuth, orígenes permitidos/CORS/CSP y retornos validados. Evitar programadores duplicados, cron interrumpido, cachés incompatibles y pérdida de suscripciones. No invalidar enlaces compartidos ni reservas vigentes para uniformar una etiqueta.
- **Identificadores técnicos históricos:** conservar `/odonto` y otros identificadores estables cuando cambiarlos rompa contratos o no aporte identidad visible. No hacer reemplazos globales de `sabrina`, `odonto` u `odontologia`: podrían afectar nombres de personas, datos de consultorios, migraciones, permisos, rutas públicas o fixtures. Todo remanente activo debe clasificarse: identidad de producto que se corrige, identificador estable cuya compatibilidad se preserva, marca ajena que no se toca o evidencia histórica inmutable. No usar esta clasificación para dejar sin resolver nombres de producto o recursos propios que sí puedan unificarse de manera segura.
- **Consistencia verificable:** cada entrada del inventario termina aplicada y comprobada, o preparada con bloqueo/puerta de publicación identificados. Ninguna plataforma se declara unificada sólo por modificar README, un remoto local o una etiqueta de pantalla.

## Criterios de aceptación adicionales

- Inventario completo, búsqueda reproducible de denominaciones anteriores y clasificación justificada de todos los resultados relevantes; sin reemplazos ciegos ni referencias operativas rotas.
- Producto y recursos propios identificados como Cita Suite, con slugs coherentes y distinción inequívoca entre producción, staging y verificación; marcas de profesionales/consultorios preservadas.
- Tipos, fronteras, unidades, SQL, navegador, builds y auditoría de release siguen aprobando sobre la revisión exacta del cambio; se comprueban además las integraciones realmente afectadas por cada nombre.
- Repositorio, remotos, Actions y proveedores conectados apuntan al recurso esperado sin activar producción por accidente. Evidencia del SHA ejecutado y del destino/versión servida cuando corresponda.
- Auth, OAuth, API, reserva desde Natalia/enlace directo, gestión, notificaciones, almacenamiento y tareas conservan comportamiento y acceso; no hay pérdida de datos ni duplicación de ejecuciones. Se ensayan enlaces anteriores cuando cambien direcciones.
- Supabase conserva sus identificadores y datos; los cambios de nombres no se presentan como correcciones de los timeouts de conexión observados, que requieren diagnóstico independiente.
- Procedimiento de reversión ensayado sin restauraciones destructivas y documentación actualizada para futuras auditorías. Las acciones de producción pendientes de autorización permanecen explícitas; no se declaran realizadas.

## Información operativa aportada por el usuario

El adjunto del 16 de octubre muestra login de GitHub con `Juan4787`, Actions habilitado y permisos de workflow predeterminados de escritura, sin aprobación de revisiones de PR. Muestra también el proyecto Supabase vinculado `yjzferwuzbtgpmdnzlcb` llamado «Odontologia», intentos fallidos de listar migraciones por timeout/reset y una sesión Wrangler en la cuenta `fc592fdc570803acbf4b523d106e446e`. Estos datos son evidencia de los comandos adjuntos, no prueba de que una ejecución posterior, conexión SQL o destino Cloudflare correcto ya funcione. Contrastar el estado vigente antes de utilizarlo; conservar credenciales fuera del proyecto y la conversación.

---

# Autorización adicional del usuario: producción y pruebas masivas

## Pedido original íntegro — 17 de octubre de 2026

produccion, testeo masivo en produccion y auditoria final estan autorizadas tambien, que no quede ni un solo hueco sin auditar ni una sola deuda tecnica. siempre cuidando la ram eso si

## Aplicación a la campaña

Esta autorización posterior amplía el alcance operativo: permite publicar y efectuar pruebas masivas y auditoría final en producción. Sustituye las prohibiciones anteriores de intervenir producción y la necesidad de volver a solicitar autorización para esas acciones ya autorizadas. No elimina etapas, criterios de aceptación ni garantías del plan.

Se conserva la secuencia de reconstrucción, pruebas aisladas, respaldo/recuperación, staging y auditoría previa a publicar. Cada acción deberá identificar destino, revisión, migraciones y reversión compatibles; el permiso no convierte una prueba pendiente en aprobada.

Las pruebas de producción emplearán consultorios y datos sintéticos identificables, sin modificar, exportar ni eliminar datos clínicos reales para preparar o limpiar los ensayos. La limpieza verificará pertenencia a la corrida y respetará las relaciones y contabilidad. La carga se ejecutará desde recursos externos con límites de plataforma vigentes, sin falsificar IP ni eludir protecciones. Se conservarán evidencia y criterios de interrupción ante errores o impacto sobre datos reales.

Workers permanece en Free por confirmación expresa del usuario; no se autorizaron contrataciones ni cambios a planes pagos. Cualquier límite comercial que impida demostrar un criterio deberá quedar medido y expuesto, sin fingir su cumplimiento. La computadora local conserva pruebas livianas secuenciales, sin bases/navegadores/cargas pesadas ni procesos pesados concurrentes.

El cierre exige la auditoría punto por punto, corrección y repetición de los casos fallidos. No se declarará ausencia de deuda por omitir pruebas, ocultar incertidumbres o posponer defectos dentro del alcance aprobado.

---

# Decisión del usuario: lanzamiento con dos consultorios, infraestructura gratuita y control de consumo

## Pedido original íntegro — 20 de octubre de 2026

Continuá con la refactorización de Cita Suite desde el último estado realmente verificado, respetando el plan aprobado, sus objetivos arquitectónicos, los criterios de calidad y las instrucciones previamente establecidas.

Quiero establecer algunas decisiones importantes sobre infraestructura, escalabilidad y control de costos, pero **dejando a tu mejor criterio técnico determinar qué conviene implementar ahora y qué conviene postergar**.

### 1. Situación actual y contratación

Actualmente Cita Suite **NO tiene usuarios ni consultorios reales**. Todos los usuarios, pacientes, turnos y datos utilizados hasta ahora son ficticios.

Sin embargo, estamos preparando la aplicación para su lanzamiento y posteriormente sí habrá clientes reales. Por lo tanto, las decisiones actuales deben contemplar las consecuencias que podrían tener cuando la aplicación esté operando en producción.

**Por ahora NO voy a contratar Cloudflare Workers Paid, Supabase Pro ni ninguna otra plataforma de hosting paga.**

Mi intención es utilizar infraestructura gratuita para los primeros dos consultorios y comenzar a pagar Supabase Pro y una plataforma de hosting a partir del tercer consultorio activo.

Esta previsión no constituye una autorización anticipada para contratar servicios, cambiar planes o migrar de plataforma. El proveedor de hosting pago todavía no está decidido.

### 2. Escalabilidad y prioridades

**No quiero optimizar ahora la aplicación para soportar 25 consultorios simultáneos.**

El objetivo inmediato es ofrecer una experiencia sólida, segura, eficiente y confiable para dos consultorios, utilizando la infraestructura gratuita disponible.

No obstante, quiero que escalar posteriormente a 5, 10, 25 o más consultorios sea natural y no exija rehacer componentes centrales.

Preservá una arquitectura modular, extensible y mantenible, sin introducir deuda técnica estructural ni sobreingeniería innecesaria.

No confundas la decisión de postergar capacidad adicional con una autorización para postergar correcciones de calidad, seguridad, integridad o funcionamiento.

### 3. Control de consumo y riesgos de facturación

Este punto requiere especialmente tu criterio.

Cuando contratemos infraestructura paga, quiero minimizar al máximo posible el riesgo de que bugs, bucles, reintentos descontrolados, operaciones duplicadas, ataques o configuraciones incorrectas produzcan facturas extraordinarias.

Para ello debemos aprovechar tanto las protecciones que pueden implementarse desde el código como los controles independientes que ofrezca el proveedor.

**No confío en que el código sea infalible, pero eso NO significa que debamos prescindir de sus protecciones.** Son una parte fundamental de la defensa y deberán complementarse con otras capas cuando estén disponibles.

Ahora bien, **NO te estoy ordenando implementar todas esas protecciones inmediatamente, ni tampoco postergarlas todas hasta contratar servicios pagos**.

Quiero que evalúes cada medida según su mérito técnico.

Por ejemplo:

- Si un problema representa un riesgo importante para clientes reales, puede provocar fallos graves, pérdida de datos, operaciones duplicadas o consumo descontrolado, y conviene solucionarlo antes del lanzamiento, hacelo ahora.
- Si una protección está estrechamente relacionada con la arquitectura actual y agregarla después implicaría modificaciones profundas, regresiones o deuda técnica considerable, puede ser preferible implementarla ahora.
- Si una mejora es sencilla, tiene un beneficio claro y previene errores difíciles de diagnosticar posteriormente, evaluá incorporarla desde ahora.
- Si una protección solo adquiere sentido con un servicio pago específico que todavía no elegimos, probablemente sea más razonable postergarla.
- Si una optimización está destinada exclusivamente a soportar decenas de consultorios y no aporta valor relevante a la operación inicial ni a la calidad arquitectónica, no hace falta implementarla ahora.
- Si la implementación preventiva introduce más complejidad, mantenimiento o riesgo de regresiones que el problema que pretende evitar, considerá dejarla para una etapa posterior.

**Estos ejemplos son criterios de razonamiento, no reglas mecánicas ni una lista exhaustiva.**

Quiero que utilices tu mejor juicio de ingeniería para decidir.

En particular, considerá:

1. La probabilidad de que el problema ocurra.
2. La gravedad de sus consecuencias, especialmente cuando existan usuarios reales.
3. El costo y la complejidad de prevenirlo ahora.
4. El costo y los riesgos de corregirlo posteriormente.
5. Su impacto en la arquitectura, el rendimiento y la mantenibilidad.
6. Si depende de un proveedor o plan que todavía no contratamos.
7. Si existe una solución más simple y suficientemente eficaz.

**El objetivo es anticiparnos a los problemas que realmente conviene prevenir, no intentar resolver hoy todos los problemas posibles del futuro.**

### 4. Pruebas, rendimiento y limitaciones actuales

Conservá y documentá los resultados de las pruebas ya realizadas, incluido el ensayo alojado de cinco consultorios.

Ya sabemos que Cloudflare Workers Free presenta límites de CPU incompatibles con determinadas cargas. No quiero que dediques esfuerzos desproporcionados a microoptimizar la aplicación exclusivamente para hacer que escenarios de cinco o veinticinco consultorios funcionen dentro de límites gratuitos que probablemente abandonaremos al crecer.

Sin embargo, **sí quiero que sigas corrigiendo los defectos reales de eficiencia y rendimiento que detectes**, especialmente si podrían perjudicar también a los clientes reales o persistir en infraestructura paga.

Distinguí entre defectos propios de la aplicación y limitaciones demostradas del proveedor.

Las pruebas deben seguir siendo objetivas, reproducibles y sensibles a fallos reales. No declares aprobados requisitos incumplidos ni reduzcas los estándares para acomodarlos a las limitaciones gratuitas.

Antes del lanzamiento con clientes reales, la configuración elegida deberá demostrar que satisface los requisitos de confiabilidad, seguridad e integridad correspondientes a la operación inicial. Si una limitación de infraestructura impide garantizarlo, señalala claramente como impedimento para publicar y presentá alternativas fundamentadas.

No hace falta demostrar ahora capacidad para 25 consultorios si esa escala no forma parte del lanzamiento inicial.

### 5. Autonomía técnica y documentación

**Tenés libertad para decidir qué implementar ahora y qué postergar**, dentro de los objetivos y restricciones anteriores.

No quiero que busques una interpretación literal que te obligue a implementar absolutamente todo ni una que te permita omitir mejoras importantes.

Quiero decisiones de ingeniería justificadas.

Cuando identifiques una mejora o protección relevante:

- Evaluá sus beneficios, riesgos y costos.
- Decidí si corresponde implementarla ahora o dejarla pendiente.
- Implementala y verificá su funcionamiento si corresponde hacerla ahora.
- Si decidís postergarla, documentá brevemente por qué, qué riesgo residual implica y bajo qué circunstancias convendría retomarla.

No hace falta convertir cada decisión menor en un informe extenso ni interrumpir continuamente la refactorización para solicitar autorización. Reservá las consultas para decisiones que requieran gastos, cambios importantes de alcance o compromisos que me correspondan.

Continuá desde el último punto verificado, actualizando el plan de refactorización, el registro de ejecución, el documento de traspaso y las instrucciones obsoletas que correspondan.

Mantené las verificaciones rigurosas, la prevención de regresiones y la revisión de documentación después de cada compactación.

### Objetivo final

Quiero lanzar Cita Suite con la menor deuda técnica razonablemente posible, funcionando correctamente para sus primeros clientes reales, preparada para crecer de manera natural y con una arquitectura que facilite implementar protecciones más exigentes cuando contratemos infraestructura paga.

**No quiero ni sobreingeniería prematura ni postergaciones irresponsables. Quiero que utilices tu mejor criterio técnico para determinar qué vale la pena resolver ahora y qué es más inteligente resolver después.**

La prioridad es el funcionamiento confiable del producto, la calidad de su arquitectura y la prevención proporcional de riesgos reales, tanto técnicos como económicos.

Continuá.

## Aplicación a la campaña

Esta decisión cambia el alcance de lanzamiento y la condición de cierre de capacidad; no elimina etapas, garantías ni criterios de calidad, seguridad o integridad. Se aplica así:

1. **Lanzamiento.** Cita Suite no tiene usuarios ni consultorios reales: todos sus datos son ficticios. El lanzamiento inicial es para dos consultorios sobre la infraestructura gratuita vigente (Cloudflare Workers Free y Supabase Free). Antes de publicar para clientes reales, el despliegue gratuito debe demostrar los criterios del plan con dos consultorios bajo el modelo de carga de la sección 4: lecturas p95 menor a 1 s y p99 menor a 2 s, escrituras p95 menor a 1,5 s y p99 menor a 3 s, errores técnicos menores al 1 %, ninguna violación de aislamiento, doble reserva o cuotas, disponibilidad completa o error explícito, y push y calendario dentro de diez minutos. Si un límite del proveedor lo impide, es un impedimento para publicar, que se informa con alternativas fundamentadas. Los criterios no se rebajan.
2. **Escala.** Los escenarios de 5 y 25 consultorios dejan de ser condición de cierre de este lanzamiento. Se conservan como evidencia los ya medidos, incluido el ensayo alojado de cinco consultorios en planes gratuitos, que no cumplió por la CPU de Workers Free, y las herramientas para repetirlos. La arquitectura debe permitir crecer a 5, 10, 25 o más consultorios sin rehacer componentes centrales. Los defectos de escalabilidad del sistema se siguen corrigiendo, porque afectan a cualquier escala y plataforma.
3. **Contrataciones.** Ninguna sin autorización explícita: ni Workers Paid, ni Supabase Pro, ni hosting pago. La previsión de pagar Supabase Pro y un hosting desde el tercer consultorio activo no autoriza contratar, cambiar de plan ni migrar, y el proveedor de hosting no está decidido. Tampoco se aceptan servicios con cobro variable sin tope (decisión del 20 de octubre).
4. **Control de consumo.** Cada protección se evalúa por probabilidad, gravedad, costo y riesgo de prevenir ahora o después, dependencia de un proveedor no elegido y existencia de una solución más simple. Las justificadas se implementan y verifican ahora; las postergadas quedan documentadas con su riesgo residual y la circunstancia en que conviene retomarlas.
5. **Rendimiento.** Se corrigen los defectos reales de eficiencia de la aplicación, que persistirían en cualquier plataforma. No se microoptimiza sólo para que 5 o 25 consultorios entren en los límites gratuitos. Se distinguen siempre los defectos propios de las limitaciones demostradas del proveedor.
6. **Cierre.** El resto del plan sigue vigente: matriz de regresiones, auditoría transversal, publicación con respaldo y reversión ensayados, y auditoría final punto por punto. Para este lanzamiento, la condición «demuestre los escenarios de cinco y veinticinco consultorios» se reemplaza por la demostración de los dos consultorios en el despliegue gratuito, la evidencia de CI ya obtenida y una arquitectura que permita ampliar recursos sin cambiar el modelo multiempresa.
