# Respaldo y recuperación

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
  - Exige el proyecto `yjzferwuzbtgpmdnzlcb` y usa la configuración privada existente. Las credenciales no van a ningún registro, al repositorio ni a CI.
  - Las consultas corren en transacciones de sólo lectura.
  - El destino predeterminado es `~/.local/share/cita-suite/backups/production-<fecha>`, privado (700). Un respaldo nunca sobrescribe otro.
- **Staging:** lo hace el ensayo `staging-operations` → `backup-rehearsal`.

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

## Evidencia

**Ensayo `staging-operations` 39682517594, sobre `0618b35`**, con la siembra sintética de dos consultorios. La carga quedó en 83.335 filas en 96 tablas, con 35 MB de datos.

| Comprobación | Resultado |
|---|---|
| Filas por tabla | Restauradas en 3,6 s, sin ninguna diferencia. |
| Historial de migraciones | 117 de 117. |
| Objetos de plataforma | 1 política y 1 disparador. |
| Archivo almacenado sintético | Restaurado con la misma huella y borrado de staging después. |

- **Recibo:** `.verification/backup-rehearsal-staging-20261021.json`.
- **Limpieza:** `capacity-cleanup` 39683097818 dejó staging sin consultorios sintéticos.
- **Pruebas livianas:** `scripts/lib/backup-verification.test.mjs`. Cubren el conteo de filas por los bloques `COPY`, las diferencias de filas y de archivos, y la regla de roles de la plataforma.

## Límites y decisiones pendientes

- **El ensayo no usa un proyecto alojado nuevo.** Restaura en la pila local de la CLI, con las versiones de staging. Una restauración real puede encontrar otra diferencia de la plataforma, y la verificación del manifiesto la detectaría.
- **Destino y frecuencia de los respaldos de datos reales: lo decide el usuario.** El destino tiene que ser privado, cifrado y gratuito o con tope duro de gasto.
- **Mientras tanto:** se hace un respaldo de producción antes de cada publicación, con `backup-production.mjs`.
