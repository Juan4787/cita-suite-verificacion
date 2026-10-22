# Documentos: capacidades, cuotas y ciclo de vida

Este documento describe la implementación de la etapa 3. La evidencia exacta y sus límites se registran en [el registro de campaña](../plans/registro-refactorizacion-cita-suite.md); el [plan íntegro](../plans/refactorizacion-cita-suite.md) conserva autoridad sobre los criterios de cierre. Una prueba descartable no acredita aplicación de migraciones ni funcionamiento del almacenamiento alojado.

## Autoridades y unidades

PostgreSQL autoriza, reserva y contabiliza. El servidor verifica el contexto, solicita URLs a Storage y valida el objeto real al completar. La interfaz orienta; sus controles nunca sustituyen SQL. Todos los MB son decimales: un MB son 1.000.000 bytes. Los formularios administrativos convierten texto con coma mediante enteros exactos, sin redondear un límite ni interpretar puntos como separadores de miles.

| Alcance | Límite y contabilidad |
|---|---|
| Proyecto | 700.000.000 bytes: todos los objetos del catálogo Storage más reservas pendientes. Incluye objetos de otros buckets. |
| Consultorio | Máximo individual: objetos atribuidos a su namespace más reservas pendientes. El valor inicial es 100.000.000 bytes. No preasigna ni garantiza capacidad compartida. |
| Archivo | Hasta 5.000.000 bytes por ruta permitida. Una imagen puede tener original y miniatura; ambas cuentan. El PDF no genera miniatura. |
| Paciente, por turno | Hasta tres documentos y 10.000.000 bytes reales más tamaños declarados pendientes. Los 5 MB pesimistas no se usan en este límite. |

Dos archivos de 3,5 MB y uno pendiente de 200 KB comprometen 7,2 MB del límite del paciente. La URL de ese tercero requiere respaldar 5 MB en los presupuestos global e individual: puede rechazarse por capacidad compartida real, nunca por sumar esos 5 MB al límite de 10 MB.

## Activación, permisos y cambios de política

Cada consultorio nuevo obtiene una cuenta de cuota dentro de su transacción de creación, sin reservar espacio. La activación de documentos comprueba la cuenta y las disponibilidades global e individual en la misma transacción; una cuenta ausente o inválida falla explícitamente. Los consultorios anteriores conservan el máximo previo aplicable y al menos todo el espacio comprometido. Desactivar y reactivar preserva su cuota.

Las capacidades conservan cuatro dimensiones: disponibilidad operativa global, disponibilidad del consultorio, configuración de documentos para el paciente y permisos/estado comercial del actor. La pausa global o individual bloquea nuevas cargas profesionales y públicas; no oculta documentos históricos que el actor todavía esté autorizado a consultar. Una falla al consultar disponibilidad se muestra como indisponibilidad temporal, nunca como una pausa configurada ni como ausencia de documentos.

Las tablas de cuotas tienen RLS y no admiten acceso directo de `anon` ni `authenticated`. El servidor maestro exige identidad Auth verificada y aplica las RPC administrativas mediante service_role. Las RPC no aceptan que un usuario ordinario se convierta en maestro suministrando un identificador. Las revisiones de política son independientes de los contadores: una carga normal no invalida el formulario, pero dos ediciones de la misma política no se sobrescriben silenciosamente. La UI siempre envía la revisión observada; el argumento opcional de revisión permite herramientas administrativas explícitas compatibles, no acceso público.

`set_clinical_storage_defaults` modifica el valor inicial de futuros consultorios y la pausa global. `set_business_clinical_storage_policy` modifica una excepción individual. No alteran archivos, pendientes ni otras cuotas. Reducir el máximo por debajo de usados más reservados falla; no se borra información para hacerlo caber. El panel maestro pagina de 50 en 50 y preserva borradores independientes al guardar otro consultorio. Éxito, rechazo y conflicto aparecen dentro del formulario utilizado; sólo un rechazo del importe marca ese campo como inválido. Un conflicto de revisión pide recargar, conserva lo escrito y no atribuye el problema al importe. Los cambios anteriores a la hidratación se conservan con bindings de Svelte, incluido el FileList de una selección pública.

## Reserva y emisión de URLs

Las operaciones coordinadas adquieren bloqueo global, cuenta individual y documento, en ese orden; si hay dos cuentas, se ordenan por identificador. No se llama a Storage con una transacción SQL abierta. La creación de un documento pendiente reserva hasta 5 MB por ruta mediante `clinical_upload_slots`. Cada slot referencia el mismo consultorio que el archivo con una FK compuesta.

El plazo inicial conserva dos horas más quince minutos. Después de obtener las URLs del cliente autenticado de Storage, el adaptador observa la expiración de sus tokens y llama a `protect_clinical_upload_urls` antes de devolver una URL al navegador. Se conserva el mayor plazo previo o real más quince minutos. Un token sin expiración válida, un slot expirado, una ruta ajena o una reserva incoherente impiden devolver la URL. Leer ese token del proveedor no autentica personas ni sustituye la verificación Auth.

Renovar nunca duplica la reserva ni acorta un plazo anterior. Una ruta cuyo objeto ya existe conserva el slot con reserva cero. Borrar o renombrar ese objeto no revoca una URL todavía válida: el trigger vuelve a respaldar su máximo y comprueba si ese crecimiento cabe. Una operación que no cabe revierte completa. Un fallo entre emisión y devolución puede dejar una reserva temporal conservadora; no autoriza a liberarla antes de la expiración.

**Consecuencia para el operador:** una limpieza que borra documentos tiene que esperar el vencimiento de sus URL de carga. El 22 de octubre, en el staging alojado, borrar el objeto de un documento recién subido volvió a reservar 5.000.000 bytes hasta su vencimiento, dos horas y cuarto después. Así, la protección quedó comprobada fuera del entorno descartable. `release-smoke.mjs <entorno> cleanup` espera ese plazo: después borra el objeto por la API de Storage, libera las reservas vencidas con `private.release_expired_clinical_reservations()` y recién entonces borra la fila.

## Transferencia y confirmación

La transferencia va del navegador a Storage con `upsert: false`. El trigger AFTER del catálogo calcula el estado completo posterior a la sentencia, sustituye reserva por bytes reales y aplica límites; un rechazo revierte la modificación de metadatos. No hay una descarga del PDF completo dentro del Worker.

La finalización comprueba metadatos reales de Storage (tamaño y MIME), el prefijo y el cierre del PDF con lecturas `Range` acotadas. Una respuesta que ignora Range se cancela al alcanzar el límite; no se usa una lectura completa de respaldo. Es validación básica síncrona, sin parseo estructural, cola ni promesa de antivirus. Imágenes conservan su validación específica y miniaturas privadas.

La identidad del paciente y del turno procede del contexto autorizado, no del nombre del archivo. La descarga utiliza el archivo privado correspondiente y un nombre seguro derivado del paciente. Las pruebas de navegador comparan los bytes descargados con el PDF subido; ver su estado en el registro antes de considerar comprobado ese recorrido.

## Papelera, fallos, expiración y reconciliación

Los bytes almacenados cuentan mientras existan, incluso en papelera, pendientes, fallidos o derivados. Un cambio de estado no libera capacidad física. La eliminación de producción pasa por Storage API, que mantiene sus protecciones contra borrado SQL directo. Sólo los ensayos SQL de catálogo sintético emplean la opción transaccional de eliminación utilizada por las pruebas oficiales de Storage.

La liberación de slots vencidos es repetible: devuelve sólo la reserva todavía registrada y conserva referencias necesarias para limpiar objetos existentes. Nunca borra un archivo clínico válido por diferencias de contador. El programador y los recorridos de limpieza deben respetar el plazo protegido, no sólo la fecha de creación del documento.

La reconciliación vuelve a calcular contadores globales e individuales desde el catálogo y slots vigentes. Incluye nombres clínicos conocidos aunque ya no exista su fila de archivo; informa bytes sin atribución, tamaños desconocidos y exceso de límites. Su límite de consultorios es explícito: no devuelve éxito parcial si lo supera. Agrupa los objetos una vez, sin recorrer el catálogo completo por cada consultorio. No aumenta máximos ni elimina objetos para corregir el resultado.

Este mecanismo detecta discrepancias visibles en el catálogo. No certifica objetos físicos que el proveedor mantenga fuera de ese catálogo ni puede impedir cambios externos con privilegios del proveedor. La auditoría alojada debe contrastar esa limitación con el uso y operaciones reales de Storage; no reemplazarla por una afirmación de inventario físico completo.

## Contratos y regresiones

| Evidencia | Garantía |
|---|---|
| `clinical_business_storage_budget.sql` | Cuenta automática, activación, máximos, pausas, CAS, ampliación, expiración real, repetición, borrado/renovación, reconciliación, aislamiento y privilegios. |
| `clinical_storage_reconciliation.sql` | Reconciliación de los cuatro estados, derivados, abandonados, otros buckets, objetos sin atribución/tamaño y excesos preexistentes conservando información. |
| Ensayo antes/después de migración | Preserva un objeto de 3,5 MB, una carga pendiente de 5 MB, sus slots y el máximo previo. |
| `run_clinical_budget_concurrency.sh` | Dos conexiones con bloqueo observado: no exceder presupuesto global entre dos consultorios ni máximo individual. |
| `booking_extension_contracts.sql` | Límites por turno y diferencia entre tamaños reales/declarados y reserva pesimista. |
| Unidades de archivos/disponibilidad/MB | Range ignorado/inválido, expiración malformada, disponibilidad fallida, importes exactos y mensajes humanos. |
| `clinical-files.spec.ts`, `booking-embed.spec.ts` | PDF profesional/paciente real, persistencia en ficha y descarga idéntica con nombre correcto. |
| `clinical-storage-policy.spec.ts` | Política maestra real, borradores, errores/conflictos en su formulario, edición antes de hidratación, pausa en UI y API, permisos, geometría de navegación con nombre largo y capturas de escritorio/móvil. |

Todo cambio de cuota, emisión de URL, cleanup, nueva ruta de carga o bucket debe revisar estos contratos. No se añade un contador alternativo ni una carga propia que eluda el presupuesto global. Migraciones nuevas conservan firmas públicas o definen una transición explícita; las aplicadas no se editan. Los tipos se regeneran desde todas las migraciones en PostgreSQL descartable y se comprueban dos veces antes de importarlos.
