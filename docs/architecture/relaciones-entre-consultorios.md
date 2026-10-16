# Identidad de consultorio en relaciones

Estado: preparación de etapa 2, pendiente de generación y pruebas sobre migraciones reconstruidas. No aplicado a producción.

La migración `20261016010000_tenant_relation_identity.sql` completa dieciséis relaciones que tenían FK por identificador global sin incluir el consultorio. La autorización de funciones/RLS y los triggers vigentes se conservan; la restricción añade una garantía estructural para escrituras futuras, incluidas las privilegiadas. El hallazgo de una FK incompleta por sí solo no demuestra una explotación de la aplicación vigente.

Se conservan los nombres de las FK: añadir una segunda relación paralela puede hacer ambiguos los embeds de PostgREST. Cada acción de borrado original se mantiene. En SET NULL se limpia exclusivamente la columna de referencia, nunca `business_id`. Se añaden las cinco claves únicas de padres que faltaban. No cambian privilegios, datos, funciones ni rutas públicas.

El preflight detiene la migración ante enlaces existentes con identidades diferentes y muestra sólo nombre de restricción/recuento. No repara identidades ni borra información automáticamente. Las identidades NULL históricas de algunas tablas se conservan con MATCH SIMPLE; esto no habilita acceso nuevo ni reemplaza las políticas actuales. Los límites de espera de locks/ejecución hacen fallar la entrega en lugar de bloquearla indefinidamente. La transacción completa conserva las FK anteriores si falla alguna validación.

## Compatibilidad de aplicación y reversión

PostgREST puede reconocer la relación de costes clínicos como uno-a-uno al coincidir con UNIQUE(business_id,clinical_entry_id). La aplicación debe aceptar tanto el array anterior como el objeto nuevo; `readClinicalEntryAmount` establece ese contrato y sus pruebas conservan ausencia, cero y decimales históricos.

La preparación de release debe fijar una versión puente compatible con ambos esquemas antes de cambiar estas FK. La reversión de aplicación se limita a esa versión o una posterior compatible, sin deshacer destructivamente la migración. No afirmar compatibilidad de una versión anterior que sólo lee arrays.

Antes del cierre se exige reconstrucción completa, generación oficial reproducible, pruebas negativas de relaciones sin depender de triggers de usuario, conservación de CASCADE/RESTRICT/SET NULL y prueba HTTP de los embeds/ficha. Revisar también referencias históricas que deliberadamente no representan una FK activa; este documento no reemplaza la auditoría de todo el catálogo.
