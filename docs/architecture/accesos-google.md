# Clientes y accesos Google de Cita Suite

La carpeta padre **`ACCESOS-GOOGLE-CITA-SUITE/`** reúne los accesos Google del producto y su operación. Su nombre se conserva: abarca autenticación, Calendar y respaldos externos. **No implica una sola cuenta ni un solo proyecto.** Su `LEEME.md`, índices y subcarpetas distinguen cada finalidad.

**Autenticación y Calendar:** administradora indicada `juampiluduena@gmail.com`, proyecto **Dashboard Odontologia**, ID `dashboard-odontologia`. **Respaldos externos:** Drive elegido `juanmarquez56783@gmail.com`, proyecto **Cita Suite Respaldos**, ID `project-ae0f9447-d7a0-49d1-b0b`. Sin auditoría IAM; el perfil de Drive de respaldo sí se comprobó mediante el conector.

[Abrir los clientes del proyecto en Google Cloud](https://console.cloud.google.com/auth/clients?project=dashboard-odontologia).

| Subcarpeta privada | Cliente en Google Cloud | Finalidad |
|---|---|---|
| `GOOGLE-CALENDAR/` | Cita Suite - Google Calendar - Producción | Vincular Google Calendar y crear, reprogramar o cancelar el evento de un turno. |
| `AUTENTICACION-GOOGLE/` | Cita Suite - Auth - Produccion | Iniciar sesión en Cita Suite con Google mediante Supabase Auth. |

La carpeta general y sus archivos están excluidos de Git. Cada integración tiene su JSON de credenciales propio: **Calendar**, `GOOGLE-CALENDAR/CREDENCIALES-GOOGLE-CALENDAR-CITA-SUITE-PRODUCCION.json`; **autenticación**, `AUTENTICACION-GOOGLE/CREDENCIALES-AUTENTICACION-GOOGLE-CITA-SUITE-PRODUCCION.json`. El segundo contiene el secreto nuevo creado por el usuario dentro del cliente Auth existente. Sus guías y metadatos están separados; no intercambiar los archivos. Guardarlos localmente no acredita que los secretos nuevos estén instalados o que los recorridos completos funcionen.

El índice privado conserva también los identificadores históricos, su procedencia y sus incertidumbres. Drive fue retirado de la aplicación por decisión del usuario; su registro histórico no lo reactiva. El cliente anterior de Calendar conserva una conexión y un evento históricos; las credenciales del Worker ya fueron sustituidas por las del cliente nuevo, sin trasladar los tokens antiguos a otro cliente.

## Respaldos externos — cliente y JSON identificados

Custodia del kit y contraseña confirmada por el usuario. Ejecutor privado https://github.com/Juan4787/cita-suite-respaldos configurado con cron01:07Argentina y monitor07:43Argentina, dos secretos protegidos y sólo clave pública de recuperación. Copia actual, recuperación completa del mismo cifrado externo, incremental sin descargas deStorage y retención probados. Primera ejecución natural de cron pendiente; evidencia742e5de y corridas en la guía. Procedimiento y estado exacto en la guía específica.

La nueva custodia de respaldos usa la cuenta elegida **`juanmarquez56783@gmail.com`**, distinta de la administradora indicada para Auth y Calendar. No reactiva la integración de Drive retirada de la aplicación.

- Carpeta privada verificada por el conector: [Cita Suite — Respaldos](https://drive.google.com/drive/folders/1mdnNa0fde28beeoOIurojp5pTZfbfQkK).
- Proyecto seleccionado mostrado por el usuario: **Cita Suite Respaldos**, ID **`project-ae0f9447-d7a0-49d1-b0b`**, número `320579536277`, organización visible `juanmarquez56783-org`. Su nombre anterior visible era «My First Project» para el mismo ID; no se certifica un proyecto nuevo ni vacío.
- [Configuración del proyecto](https://console.cloud.google.com/iam-admin/settings?project=project-ae0f9447-d7a0-49d1-b0b) y [clientes OAuth de respaldos](https://console.cloud.google.com/auth/clients?project=project-ae0f9447-d7a0-49d1-b0b).
- Cliente creado: **Cita Suite Respaldos - Automatico**, **Aplicación de escritorio**, ID `320579536277-3rvibd44oktsjauql3ff8ldm3ssf898p.apps.googleusercontent.com`, según captura y JSON instalado validado.
- JSON archivado: `ACCESOS-GOOGLE-CITA-SUITE/RESPALDOS-GOOGLE-DRIVE/CREDENCIALES-RESPALDOS-GOOGLE-DRIVE-CITA-SUITE.json`; mismos419bytes, archivo 600/carpeta700 e ignorado porGit. Guías y metadatos propios, separados de Auth/Calendar.
- Estado: OAuth externo En producción y drive.file guardados según capturas; autorización y renovación reales para juanmarquez56783@gmail.com, destino propio privado probado. Primera copia cifrada histórica del 24-oct preservada y recuperada a nivel de archivos. Copia actual y recuperación verificadas; programación diaria configurada, primer evento natural aún pendiente. Las credenciales de respaldo están sólo en el ejecutor privado; ninguna en la app. Clave privada y contraseña fuera de CI; custodia externa confirmada por el usuario.
- Páginas públicas de respaldo: [inicio](https://juan4787.github.io/cita-suite-respaldos-info/), [privacidad](https://juan4787.github.io/cita-suite-respaldos-info/privacidad/) y [condiciones](https://juan4787.github.io/cita-suite-respaldos-info/terminos/), HTTPS200/huellas comprobados. Repositorio informativo `Juan4787/cita-suite-respaldos-info`, separado de cualquier ejecución/copia. Contacto confirmado completo por el usuario. URLs y dominio juan4787.github.io guardados por el usuario; OAuth publicado, sin afirmar verificación pública de marca.
- [Guía completa y conservación del acceso](acceso-google-drive-respaldos.md). Evidencia `.verification/backup-drive-client-archival-20261025/`.

Siguiente paso y pruebas necesarias en [respaldo y recuperación](respaldo-y-recuperacion.md#siguiente-dependencia-para-las-copias-automáticas). Recibo `.verification/backup-drive-project-20261025/project-identification.json`.

Comprobación del inventario: capturas aportadas el 23 de octubre de 2026 muestran los dos clientes de la tabla en Dashboard Odontologia y el nombre actualizado de autenticación. Posteriormente el usuario confirmó el acceso con Auth después de guardar su secreto nuevo en Supabase. Calendar completó consentimiento y creación gestionada de un evento sintético: lectura de producción del 24-oct02:24UTC confirma conexión del cliente nuevo, autorización cifrada presente y evento `active` con secuencia vigente, sin errores. Son comprobaciones acotadas a esa cuenta y cita. El24-oct07:21UTC el lote nuevo actualizó la secuencia2 en246.403ms; la UI de Google en el Samsung confirmó contenido y horario. La cancelación pública y una búsqueda exacta con aviso sin resultados comprobaron el borrado externo. El vínculo y autorización del ensayo se retiraron conservando la conexión/evento históricos. La verificación pública de Google sigue pendiente de dominio propio y requisitos de marca; no se confunde con el ciclo funcional. Evidencias archivadas en `docs/archive/production-verification-20261024/phase1/`. Ver [estado y acceso de Calendar](acceso-google-calendar.md).
