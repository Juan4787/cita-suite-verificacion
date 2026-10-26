# Respaldo y recuperación

## Estado vigente — respaldo diario configurado y recuperación comprobada, 26 de octubre

Cuenta elegida **juanmarquez56783@gmail.com**, carpeta privada [Copias automáticas cifradas](https://drive.google.com/drive/folders/122AAiXE1qX2FED6IFUkF33ZCswLQoVYK). Ejecutor independiente y privado [Juan4787/cita-suite-respaldos](https://github.com/Juan4787/cita-suite-respaldos), revisión **742e5ded813a57ec769a4d846d43c984fcde2a46**. Copia diaria **04:07UTC / 01:07Argentina** y monitor **10:43UTC / 07:43Argentina**. **Primera ejecución natural comprobada:** [40303961884](https://github.com/Juan4787/cita-suite-respaldos/actions/runs/40303961884), evento `schedule` sobre esta revisión, iniciada a10:00:17UTC y terminada a10:04:41UTC. Estaba prevista a04:07UTC: demora de5h53min17s, sin garantía de puntualidad. Instantánea10:04:16.270UTC,105tablas/3930filas/126migraciones/24objetos, todos reutilizados y0bytes de Storage. Descarga independiente desdeDrive y huella comprobadas; no se repitió restauraciónSQL. Las pruebas anteriores siguientes fueron manuales. No hace falta tener esta computadora encendida.

**Pruebas reales:** copia actual40264983219; restauración completa40265535110 con105 tablas/3930 filas/126 migraciones/24 referencias, sin diferencias; luego descarga y descifrado de ESA misma instantánea externa, manifiesto `4e8ab983b65133e12ff538421e0aab3cb5749267cb178b2242106769f86c8c3d`. Incremental40266203512 reutilizó24 objetos con0 descargas/0 bytes de Storage. Monitor40266261547 aprobó frescura y huella sin acceder a la base. Retención 30d/37d probada con fixtures propios enDrive, todos retirados; verify final40266759429 aprobado sobre742e5de. Evidencias `.verification/backup-private-capacity-20261026/`. Esto no equivale a una transacción global entre SQL y Storage ni recuperación a un segundo exacto.

Sólo clave pública de recuperación en CI; kit privado y contraseña externos confirmados por el usuario, sin inspeccionar ese soporte. Rol DB dedicado de lectura/BYPASSRLS, sin membresía postgres ni escrituras, límite de dos conexiones. La clave de Storage tiene privilegios **service_role más amplios que GET**: el código sólo lee, pero la credencial conserva ese alcance. Dos secretos protegidos en el ejecutor, separados de Auth/Calendar; no se leyó ni reutilizó ninguno de esos dos JSON. La copia histórica del 24-oct se conserva.

Sin nuevas contrataciones ni aumento del presupuesto: captura Actions US$0 bloqueado y facturado visible US$0; saldo exacto de minutos no acreditado. Límites preventivos y contabilidad aproximada en el README. El monitor falla ante copia ausente/vencida/corrupta o Drive inaccesible; **no se certificó recepción de correo** y si Actions completo no ejecuta por cuota/caída, tampoco ejecutará el monitor. El propietario debe conservar ese control periódico. No repetir consentimiento, custodia o presupuesto ya aportados ni regenerar claves. Dominio y SMTP siguen como dependencias externas de la campaña; no se declara terminada la campaña por cerrar respaldos.


Procedimiento vigente del ejecutor en [Drive para respaldos](acceso-google-drive-respaldos.md#operación-del-ejecutor-privado--procedimiento-vigente). El procedimiento manual y los antecedentes siguientes se conservan con su alcance; no equivalen a la automatización privada.

Supabase Free no tiene respaldos diarios administrados. La documentación oficial los reserva a Pro, Team y Enterprise y recomienda que los proyectos gratuitos exporten sus datos con `supabase db dump` y guarden copias fuera de la plataforma ([respaldos](https://supabase.com/docs/guides/platform/backups), [respaldo y restauración](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)).

Cita Suite sigue ese procedimiento con `scripts/lib/supabase-backup.mjs`, que además cubre lo que la guía oficial no incluye. El ensayo de staging lo restaura completo.

## Qué contiene un respaldo

| Archivo | Contenido | Origen |
|---|---|---|
| `roles.sql`, `schema.sql`, `data.sql` | Roles sin contraseñas, esquema y datos con `COPY`. | La CLI fijada, con los comandos de la guía. |
| `managed.sql` | Políticas, disparadores y entradas de la publicación de Realtime que las migraciones agregan a los esquemas de la plataforma (`storage`, `realtime`, `auth`). | El catálogo de origen. |
| `history.sql` | El historial de migraciones de la CLI. | `supabase_migrations.schema_migrations`. |
| `objects/<sha256>` | Cada archivo almacenado. | La API de Storage. |
| `manifest.json` | Bytes y SHA-256 de cada archivo, filas por tabla, historial, objetos de plataforma y archivos almacenados. | El propio respaldo. |

## Hacer un respaldo

- **Producción:** `node scripts/backup-production.mjs [carpeta]`, desde esta máquina.
  - Exige el proyecto `yjzferwuzbtgpmdnzlcb` y usa la configuración privada existente. El comando manual no imprime credenciales ni las guarda en Git. La automatización independiente utiliza los dos secretos protegidos del repositorio privado, descritos en la guía de Drive.
  - Las consultas corren en transacciones de sólo lectura.
  - El destino predeterminado es `~/.local/share/cita-suite/backups/production-<fecha>`, privado (700). Un respaldo nunca sobrescribe otro.
- **Staging:** lo hace el ensayo `staging-operations` → `backup-rehearsal`.
  - Sólo corre en CI; el punto de entrada directo rechaza la máquina local antes de cargar servicios.
  - El archivo sintético vive en un bucket privado único por corrida. Un 400/409 al crearlo se rechaza, sin adoptar ni borrar un bucket anterior. Una vez confirmada la creación, la limpieza se intenta incluso si se pierde la respuesta de subida. Sólo quita el objeto exacto y su bucket vacío; si apareció otro objeto no vacía el bucket para forzar un verde. El recibo identifica el nombre y rechaza la falta de limpieza.

## Restaurar en un proyecto nuevo

1. Crear un proyecto Supabase nuevo, o la pila local de la CLI para ensayar.
2. Ejecutar `restoreSupabaseBackup`:
   - comprueba cada archivo contra el manifiesto;
   - restaura en una sola transacción, con el comando de la guía ampliado: roles, esquema, datos con `session_replication_role = replica`, después `managed.sql` y `history.sql`;
   - sube los archivos almacenados.
3. Configurar la app con la URL y las claves del proyecto nuevo.
   - Las contraseñas se conservan, porque están en `auth.users`.
   - Las sesiones vigentes dejan de valer, porque el proyecto nuevo firma con otra clave.
   - Volver a cargar los secretos de las tareas.
4. Verificar como el ensayo: filas por tabla, historial de migraciones, objetos de plataforma y huella de cada archivo.

## Qué agrega al procedimiento oficial

El ensayo encontró cuatro diferencias entre la guía y una restauración completa:

- **Roles de la plataforma.** El volcado crea el rol `supabase_realtime_admin` y le otorga un parámetro (`log_min_messages`). La CLI no reserva ese rol, y `postgres` no puede ejecutar esas sentencias.
  - La restauración omite lo que crea, otorga o modifica roles de la plataforma: los que el proyecto nuevo ya tiene, más `supabase_*` y `pg_*`.
  - Conserva los ajustes que la CLI restaura a propósito (`statement_timeout`, `pgrst.*`).
  - También aplica el arreglo de propietario `supabase_admin` que lista la guía.
- **Objetos en esquemas de la plataforma.** Sin `managed.sql` se perdían dos objetos:
  - el disparador `cita_storage_budget`: sin él, las cuotas de documentos dejarían de controlarse;
  - la política de Realtime de las revisiones de pacientes: sin ella, la lista caería al sondeo de unos 30 s.
- **Historial de migraciones.** El volcado no lo trae. `history.sql` lo vuelve a registrar, y así `apply-staging-migrations` y la CLI siguen viendo el mismo estado.
- **Versiones de los servicios.** Los servicios alojados van por delante de los que fija la CLI, y los datos traen sus tablas (por ejemplo, los códigos de recuperación de MFA de Auth).
  - Para ensayar, la pila local corre las versiones de Auth y Storage del origen, con los mismos archivos de versión que escribe `supabase link`.
  - Un proyecto alojado nuevo ya tiene las versiones vigentes.

Además, Storage se consulta con hasta tres intentos ante una respuesta transitoria. Cada falla queda registrada en el manifiesto.

## Respaldo productivo previo a expansión (23-oct)

Corridaab3c7cc0-8431-43e5-959b-b04f0a543187: respaldo privado creado13:40:23UTC,101tablas/4.410filas/97migraciones y32objetos/15.675.483B, sin fallas. Se releyeron las huellas/tamaños de los cinco dumps ylos32objetos; manifiesto SHA-2560c967a045ab477ca9fd1d8f0761929bec5a2733addfc837b53090255f2298e67. Carpeta privada700 fuera deGit; ruta exacta yrecibo production-backup-expansion-verification-20261023.json enel registro. No se publican SQL,datoAuth ni archivos clínicos. Esto acredita respaldo de ese estado, separado del ensayo de restauración deCI. La expansión ya dejó125migraciones, porlo que **ese respaldo97 no sirve para autorizar la contracción125→126**; se hará otro inmediatamente antes de esa tanda.

## Evidencia

**Ensayo `staging-operations` 39682517594, sobre `0618b35`**, con la siembra sintética de dos consultorios. La carga quedó en 83.335 filas en 96 tablas, con 35 MB de datos.

Este resultado cubre las **117 migraciones de esa corrida** y conserva la evidencia de volumen. El ensayo actual, descrito debajo, cubre las 126 migraciones; no se atribuyen al anterior.

| Comprobación | Resultado |
|---|---|
| Filas por tabla | Restauradas en 3,6 s, sin ninguna diferencia. |
| Historial de migraciones | 117 de 117. |
| Objetos de plataforma | 1 política y 1 disparador. |
| Archivo almacenado sintético | Restaurado con la misma huella y borrado de staging después. |

- **Recibo:** `.verification/backup-rehearsal-staging-20261021.json`.
- **Limpieza:** `capacity-cleanup` 39683097818 dejó staging sin consultorios sintéticos.
- **Pruebas livianas:** `scripts/lib/backup-verification.test.mjs`. Cubren el conteo de filas por los bloques `COPY`, las diferencias de filas y de archivos, y la regla de roles de la plataforma.
- **Propiedad y limpieza del recurso de prueba:** `scripts/lib/backup-storage-probe.test.mjs`: colisión que no adopta recursos ajenos, buckets distintos, subida con respuesta perdida y objeto ajeno que impide borrar el bucket. Reproducción negativa y resultado corregido en el registro; no sustituyen el ensayo de restauración real.

**Esquema actual: 39859035283, fuente `48b1c20`**, aprobado el 22-oct 21:52 UTC. Recibo `.verification/backup-rehearsal-39859035283.json`, logs `.verification/remote-39859035283-logs.zip` (SHA-256 `c21fb586afcccebb394d4c3d727a6e56e28a774be3f6d6436142c50948bb92ee`). **126/126 migraciones**, conteos idénticos de 96 tablas/76 filas, política y disparador propios conservados; objeto de 2.368 bytes restaurado con huella idéntica y bucket único retirado. Dump 93,8 s, restauración 1,1 s; Auth v2.197.0/Storage v1.80.2. No se volvió a sembrar la carga ya limpiada. El código de este ensayo, sus migraciones, dependencias y workflow no cambian en `a354a26`, comprobado mediante Git. Las advertencias de privilegios de extensiones permanecen en el recibo: estos conteos no certifican igualdad íntegra del catálogo de permisos.

## Límites y decisiones pendientes

- **El ensayo no usa un proyecto alojado nuevo.** Restaura en la pila local de la CLI, con las versiones de staging. Una restauración real puede encontrar otra diferencia de la plataforma, y la verificación del manifiesto la detectaría.
- **Destino vigente elegido por el usuario el 25 de octubre:** Google Drive de **`juanmarquez56783@gmail.com` (Juan Marquez)**. El usuario aceptó expresamente usar la cuenta ya conectada, de poco uso; esta decisión sustituye la selección anterior de `juampiluduena@gmail.com`. Perfil del conector comprobado antes de escribir; no hace falta reconectarlo. Respaldos para el primer consultorio sin nuevos abonos y automáticos en lo posible. No reutilizar clientes ni secretos de Google Auth o Calendar, ni reactivar la integración de Drive retirada de la aplicación.
- **Carpeta privada creada y comprobada:** [Cita Suite — Respaldos](https://drive.google.com/drive/folders/1mdnNa0fde28beeoOIurojp5pTZfbfQkK), ID `1mdnNa0fde28beeoOIurojp5pTZfbfQkK`. La lectura posterior devolvió `shared=false` y un único permiso de propietario para la cuenta elegida. En ese checkpoint inicial no se subieron copias ni se activó programación; la copia posterior se documenta abajo. Recibo `.verification/backup-drive-destination-20261025/destination-check.json`; el recibo anterior de cuenta distinta se conserva como antecedente, no como estado vigente.
- **Espacio mostrado por el usuario:** 6,7 MB usados de 5 TB en la nueva cuenta elegida. La captura da margen amplio respecto de las copias locales medidas (aproximadamente 12–48 MB); no es una lectura de cuota por API, espacio reservado ni garantía de retención indefinida. Comprobar consumo, crecimiento y disponibilidad antes de activar el proceso.
- **Frecuencia y custodia:** la propuesta es diaria; aún no hay programación ni retención activadas. El destino debe ser privado y las copias deben cifrarse; verificar los límites de almacenamiento, transferencia de Supabase y ejecución antes de aceptar la gratuidad. El permiso existente de generación local no se convierte silenciosamente en permiso para copiar las credenciales de producción a CI.
- **Mientras tanto:** se hace un respaldo de producción antes de cada publicación, con `backup-production.mjs`.

### Siguiente dependencia para las copias automáticas

El estado vigente está al inicio de este documento y en la guía de Drive: la configuración de Google, custodia y presupuesto ya fueron aportadas por el usuario. No repetir esas solicitudes. Las instantáneas inferiores son antecedentes fechados.

## Antecedente — acceso renovable y primera copia cifrada verificados el 25 de octubre

Cuenta **juanmarquez56783@gmail.com**, proyecto **Cita Suite Respaldos** (`project-ae0f9447-d7a0-49d1-b0b`), cliente de escritorio propio y alcance exclusivo `drive.file`. Capturas del usuario: marca guardada, OAuth externo **En producción** y permiso guardado. Autorización real recibida por retorno local con PKCE S256/state y renovación comprobada contra Google; identidad leída por Drive API, no deducida del login_hint. Token 600 ignorado por Git, sólo local; receptor terminado. No volver a pedir consentimiento ni recrear cliente mientras funcione la renovación.

Destino operativo: [Copias automáticas cifradas](https://drive.google.com/drive/folders/122AAiXE1qX2FED6IFUkF33ZCswLQoVYK), dentro de [Cita Suite — Respaldos](https://drive.google.com/drive/folders/1mdnNa0fde28beeoOIurojp5pTZfbfQkK). Creado con el cliente propio porque el contenedor del conector devuelve 404 con ese alcance; movido con el conector tras leer padres. Acceso propio conservado después del movimiento, privado y único propietario comprobados por ambas vías. Prueba inocua de crear/leer/modificar/borrar y404 final correcta. Cuota leída por API: límite 5.497.558.138.880 bytes y uso 7.060.446 bytes **antes** de esta carga; no acredita precio o facturación futuros.

**Primera copia externa preservada, histórica:** [archivo cifrado del 24 de octubre](https://drive.google.com/file/d/1YgGdOtBYk0qWEJjuF99jsi6Ax8t-siNI/view?usp=drivesdk),9.796.494 bytes, instantánea `2026-10-24T12:58:38.208Z`,126 migraciones,24 referencias de objetos / 22 contenidos únicos, cinco SQL y manifiesto:28 archivos únicos comprobados. No es una copia actual del 25. Manifiesto SHA256 `e042313d02e9c02599f55962a96e7d5a582436f0f55a2ea7fab0c7ef50ebabdf`; cifrado SHA256 `adfbb62bd14c72f3e3816022c01b92ab230f89c513a853c6a6e74615c55a2267`. Empaquetado sólo de archivos autorizados por manifiesto, sin seguir symlinks ni incluir credenciales. Cifrado OpenPGP con clave de recuperación propia, subclave cv25519 y AES256, mediante un llavero que sólo tenía la clave pública. Carga reanudable de Drive, descarga y huella idénticas; importación de clave exportada en un llavero nuevo, descifrado y28 archivos comparados byte por byte/hash con el origen. Prueba sintética previa rechaza un cifrado manipulado y no se descifra con la clave pública; ambas pruebas temporales remotas fueron eliminadas y devuelven 404. Esto prueba transporte, descifrado y contenido de archivos: **no restaura ni valida ahora una base PostgreSQL**, ni certifica atomicidad global del exportador.

**Fallo abierto de copia actual:** `backup-production.mjs` salió 1 en roles, archivo vacío; diagnóstico acotado con el mismoCLI repitió cierre inesperado al conectar al pooler en 5432. Una consulta sólo lectura desde el host tampoco conectó dentro del límite. Causa no establecida: no afirmar caída de Supabase, credencial inválida o falla de Docker como diagnóstico. Sin cambios de base, configuración, aplicación o datos; no subió una copia parcial. No repetir indiscriminadamente las exportaciones. Revalidar conectividad e identidad del destino antes de intentar una copia nueva; no cambiar a otro proyecto/puerto ni modificar secretos como atajo. CLI2.115.0; no se actualizó. No se tocaron los contenedores del otro proyecto que ya estaban ejecutándose.

**Pendientes, sin aprobación implícita:** custodia externa confirmada después por el usuario; resolver conexión y generar copia actual, restauración aislada de SQL y objetos, ejecutor independiente privado, credenciales de mínimo acceso, objetos incrementales, retención, límites gratuitos/facturación y alertas de fallo/ausencia. No hay tareas diarias, repositorio ejecutor ni secretos productivos copiados a CI. Ninguna contratación. Auth y Calendar no modificados; dominio y SMTP siguen pospuestos.

Rutas, custodia y procedimiento exacto en [Drive para respaldos](acceso-google-drive-respaldos.md#clave-de-recuperación-y-operación-reproducible). La primera copia externa preserva el respaldo histórico del 24-oct de la sección siguiente; no acredita una copia diaria vigente. Sigue pendiente recuperarSQL/objetos en un destino aislado. Evitar ejecutar diariamente el exportador completo sin resolver objetos incrementales, cuotas y límites: actualmente descarga todos los objetos en cada corrida. La propuesta de ejecuciones nocturnas independientes sigue pendiente; el repositorio público informativo jamás alojará datos, claves privadas o el ejecutor.

## Respaldo verificado24-oct antes del arreglo de avisos inactivos

Carpeta privada `~/.local/share/cita-suite/backups/production-2026-10-24T12-57-28-335Z`, fuera del repositorio:105tablas/3942filas/5dumps/24objetos/11.599.541bytes,0fallos. DB126, última migración20261022010000. Verificación independiente de hashes/tamaños yCOPYporstreaming, directorios 700/archivos 600; manifiesto SHA256e042313d02e9c02599f55962a96e7d5a582436f0f55a2ea7fab0c7ef50ebabdf. Recibo inactive-push-backup-verification-20261024.json, archivado en fase3. Ese dump no fue restaurado: el mecanismo tiene los ensayos aislados ya documentados. La recuperación productiva se hizo por versiones compatibles0851/832, sin restaurarDB ni perder escrituras. No copiar los SQL u objetos al repositorio.
