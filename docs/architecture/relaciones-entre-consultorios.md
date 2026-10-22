# Identidad de consultorio en relaciones

Estado al 22 de octubre: etapa 2 verificada en el entorno descartable, full 39002014621 sobre `02af5ff` (45 controles de relaciones, 34 clínicos, tipos reproducibles y Auth/Storage/navegador reales). Staging tiene 126 migraciones; producción conserva las 97 previas a la campaña. Las secciones de preparación siguientes describen el proceso histórico, no tareas aún sin verificar. Ver [registro](../plans/registro-refactorizacion-cita-suite.md) y [publicación](publicacion-y-reversion.md).

La migración `20261016010000_tenant_relation_identity.sql` completa dieciséis relaciones que tenían FK por identificador global sin incluir el consultorio. La autorización de funciones/RLS y los triggers vigentes se conservan; la restricción añade una garantía estructural para escrituras futuras, incluidas las privilegiadas. El hallazgo de una FK incompleta por sí solo no demuestra una explotación de la aplicación vigente.

Se conservan los nombres de las FK: añadir una segunda relación paralela puede hacer ambiguos los embeds de PostgREST. Cada acción de borrado original se mantiene. En SET NULL se limpia exclusivamente la columna de referencia, nunca `business_id`. Se añaden las cinco claves únicas de padres que faltaban. No cambian privilegios, datos, funciones ni rutas públicas.

El preflight detiene la migración ante enlaces existentes con identidades diferentes y muestra sólo nombre de restricción/recuento. No repara identidades ni borra información automáticamente. Las identidades NULL históricas de algunas tablas se conservan con MATCH SIMPLE; esto no habilita acceso nuevo ni reemplaza las políticas actuales. Los límites de espera de locks/ejecución hacen fallar la entrega en lugar de bloquearla indefinidamente. La transacción completa conserva las FK anteriores si falla alguna validación.

## Compatibilidad de aplicación y reversión

PostgREST puede reconocer la relación de costes clínicos como uno-a-uno al coincidir con UNIQUE(business_id,clinical_entry_id). La aplicación debe aceptar tanto el array anterior como el objeto nuevo; `readClinicalEntryAmount` establece ese contrato y sus pruebas conservan ausencia, cero y decimales históricos.

La preparación de release debe fijar una versión puente compatible con ambos esquemas antes de cambiar estas FK. La reversión de aplicación se limita a esa versión o una posterior compatible, sin deshacer destructivamente la migración. No afirmar compatibilidad de una versión anterior que sólo lee arrays.

Antes del cierre se exige reconstrucción completa, generación oficial reproducible, pruebas negativas de relaciones sin depender de triggers de usuario, conservación de CASCADE/RESTRICT/SET NULL y prueba HTTP de los embeds/ficha. Revisar también referencias históricas que deliberadamente no representan una FK activa; este documento no reemplaza la auditoría de todo el catálogo.


## Ciclo de reseñas y control de borrado

La prueba reconstruida detectó que borrar una suscripción que referencia una reseña y su entrega dispara una comprobación intermedia de FK antes de completar las acciones SET NULL. El control transaccional con las cuatro FK anteriores por id también falla con 23503 en CI `38887295401`: el problema es previo, no exclusivo de la nueva identidad compuesta. No se omite el borrado ni se cambian CASCADE/SET NULL por borrados manuales.

`DEFERRABLE INITIALLY IMMEDIATE` no resolvió el caso. Se prepara `DEFERRABLE INITIALLY DEFERRED` sólo para las dos referencias cíclicas entre entrega y reseña: la integridad se exige al finalizar la transacción, una vez terminadas las acciones de borrado. Las otras catorce FK conservan comprobación inmediata. La matriz negativa fuerza IMMEDIATE y comprueba las dieciséis escrituras cruzadas; el borrado difiere sólo el ciclo y fuerza luego su validación. Se añaden controles del estado final y dos escrituras inválidas diferidas que deben rechazarse al forzar el chequeo final. Las 45 aserciones aprobaron en CI `38888063444`, incluida validación final diferida. Es un cambio de momento de comprobación expresamente documentado, sin permitir inconsistencias confirmadas. [Semántica oficial de SET CONSTRAINTS](https://www.postgresql.org/docs/17/sql-set-constraints.html).

## Lectura clínica según rol y estado

La descripción vigente de recepción en Equipo excluye historia clínica. Las políticas directas anteriores no implementaban esa separación. La migración clínica la aplica en la base; el servidor deja de cargar esas filas y deniega la paginación, y la interfaz ofrece los datos básicos. Readonly conserva su lectura de historia anterior sin recibir perfil clínico. Dueño/admin conservan historia, perfil y costes durante acceso restringido; archivado impide las tres lecturas. Los helpers compartidos con escrituras no se amplían. Las 29 aserciones clínicas aprobaron en CI `38887295401` y `38888063444`. Se amplían a 34 para cerrar también la lectura cuando vence la fecha de acceso histórico aunque el programador aún no actualice su etiqueta; el helper SQL se alinea con el estado calculado por TypeScript. Esta revisión ampliada sigue pendiente de CI y no acredita cierre de etapa.

## Referencias históricas sin FK viva

`clinical_entries.created_by_professional_id` conserva procedencia histórica. Se deriva del actor en la creación autenticada; la exportación resuelve el profesional con el mismo consultorio. Una FK con borrado en cascada/SET NULL perdería historia y RESTRICT añadiría una restricción de eliminación inexistente. Se conserva el identificador al eliminar el perfil, se protegen las columnas de autoría frente a cambios autenticados y se valida una referencia nueva/cambiada en el consultorio. La suite clínica comprueba corrección de contenido posterior a la eliminación del profesional. Su rechazo previo en INSERT por el trigger de vínculo no prueba protección de UPDATE: la prueba separa ambos mecanismos.

`patient_export_sessions.patient_id` identifica el alcance de una fotografía de exportación, no una relación clínica viva. La tabla sólo tiene acceso de backend; la RPC valida paciente/consultorio al iniciar y contrasta la fotografía durante el recorrido. Las suites de exportación verifican cambios concurrentes, cancelación y caducidad. No se añade una FK que borre el registro de una exportación o impida los cambios de datos que precisamente debe detectar.
