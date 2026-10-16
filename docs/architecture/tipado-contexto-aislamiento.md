# Tipado, contexto y aislamiento

Este documento explica los mecanismos de la etapa 2. El [plan original](../plans/refactorizacion-cita-suite.md) fija sus requisitos y el [registro](../plans/registro-refactorizacion-cita-suite.md) conserva resultados, revisiones exactas y limitaciones. Una comprobación de tipos no demuestra por sí sola permisos, funcionamiento HTTP ni despliegue.

## Contrato de la base

`packages/shared/src/database.types.ts` se obtiene del generador oficial fijado sobre PostgreSQL descartable reconstruido con todas las migraciones. Se generan dos salidas idénticas; full exige comprobar la salida versionada. No se edita para conseguir que una llamada compile.

Las fábricas de servidor, administración y OAuth usan `CitaDatabase`; recuperación y Realtime del navegador usan el esquema generado. El módulo administrativo inactivo sólo expone Auth: no recibe un esquema inventado. Sus archivos originales permanecen archivados con huellas.

El adaptador `lib/types/database.ts` contiene la limitación del generador sobre argumentos SQL NULL. Conserva las claves, obligatoriedad, funciones sin argumentos y retornos. NULL y omisión siguen siendo diferentes. La adaptación WebSocket de Node queda en la fábrica del SDK. Las pruebas negativas de compilación rechazan tablas, funciones, campos y argumentos inventados.

Los JSON de base, proveedor y HTTP se validan en su frontera. Los validadores básicos viven en `lib/contracts/json.ts`, sin dependencias del servidor. Cada contrato de negocio interpreta después sus campos: configuración, cuestionarios, perfiles, disponibilidad, aranceles, exportación y proveedores. Las respuestas incompletas no se convierten en listas vacías. La lista HTTP de pacientes comprueba también alcance de caché y cursor de continuación; rechaza una respuesta exitosa incompleta.

## Contexto de cada petición

Hooks publica `locals.verifiedUser` después de validar Auth. El contexto privado reutiliza esa identidad y resuelve consultorio, membresía y capacidades. Sin identidad verificada consulta Auth; decodificar el JWT no sustituye esa comprobación.

La reutilización de membresías se limita al objeto de cookies de una petición y a la misma identidad/token. `fresh` relee autorización incluso en esa petición. No existe una caché global de permisos entre personas o peticiones. RLS y las RPC comprueban además el permiso vigente en la operación.

Reserva pública, gestión mediante token, callbacks de proveedores y tareas internas tienen autenticación propia. Las cookies privadas de otro recorrido no los identifican ni los redirigen a login. Esto no elimina la comprobación de token, firma, estado OAuth o credencial interna de cada controlador.

## Relaciones y procedencia

La [matriz de relaciones](relaciones-entre-consultorios.md) documenta dieciséis FK compuestas, acciones conservadas, preflight sin reparación de datos, compatibilidad PostgREST y reversión de aplicación. Las dos referencias cíclicas de reseñas/entregas se comprueban al finalizar la transacción; las pruebas fuerzan esa comprobación y rechazan identidades cruzadas también en ese modo.

Las escrituras clínicas directas respetan los roles de las RPC. Recepción conserva operaciones básicas de agenda/pacientes, sin acceder a historia clínica. La procedencia original no puede alterarse mediante UPDATE autenticado. La autoría profesional histórica puede sobrevivir al perfil borrado; una referencia nueva debe pertenecer al consultorio.

## Lectura clínica

| Actor/estado | Datos básicos | Historia | Perfil clínico | Costes | Documentos |
|---|---|---|---|---|---|
| Dueño/admin operativo | Sí | Sí | Sí | Sí | Sí |
| Profesional operativo | Pacientes vinculados | Vinculados | Vinculados | No | Vinculados |
| Recepción operativa | Sí | No | No | No | No |
| Readonly operativo | Sí | Sí | No | No | No |
| Dueño/admin restringido con plazo vigente | Sí | Sí | Sí | Sí | Lectura existente |
| Acceso vencido o archivado | No | No | No | No | No |

Las capacidades son acumulativas: un rol permitido no habilita un consultorio inoperativo ni una función deshabilitada. La fila restringida no permite crear/modificar clínica ni cargar archivos. El ayudante temporal no adquiere permiso de exportación por tener rol efectivo admin.

La vigencia histórica se calcula por fechas, permiso comercial y archivo; una etiqueta `restricted` atrasada no prolonga el acceso hasta que corra mantenimiento. No se amplían los helpers de escritura para conceder lectura histórica. La recepción no recibe historia oculta en HTML/JSON: el cargador no la consulta, la paginación la deniega y SQL aplica la misma separación.

## Evidencia y cierre

- Generación oficial y SQL se comprueban sobre la base descartable; no describen el esquema remoto de producción.
- Los controles directos usan RLS/RPC reales con claims sintéticas y se revierten. Las carreras usan dos conexiones controladas dentro de una sola prueba.
- Auth/Storage HTTP y navegador constituyen una capa distinta. El caso de roles conserva la sesión original durante el alta de otra persona; no compensa errores volviendo a ingresar.
- Los reportes de unidades se validan individualmente. La reapertura nativa XLSX es obligatoria en full/release y se ejecuta en CI con LibreOffice fijado; no se omite por faltar el programa.
- Los resultados parciales y el incidente anterior de identidad conservan sus recibos. Un verde posterior no demuestra por sí solo la causa histórica de aquel incidente.

Las huellas, números de corrida y estado efectivo de cierre están en el registro. Staging, capacidad alojada, release y auditoría transversal siguen sus propias condiciones; esta etapa no los sustituye.
