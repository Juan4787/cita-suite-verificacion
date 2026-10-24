# Clientes y accesos Google de Cita Suite

La carpeta local **`ACCESOS-GOOGLE-CITA-SUITE/`**, en la raíz del proyecto, reúne los accesos de Google de esta aplicación. Abrir su **`LEEME.md`**: identifica la cuenta administradora, el proyecto, los clientes y el estado comprobado de cada uno.

Proyecto visible: **Dashboard Odontologia**. ID estable: **`dashboard-odontologia`**.

[Abrir los clientes del proyecto en Google Cloud](https://console.cloud.google.com/auth/clients?project=dashboard-odontologia).

| Subcarpeta privada | Cliente en Google Cloud | Finalidad |
|---|---|---|
| `GOOGLE-CALENDAR/` | Cita Suite - Google Calendar - Producción | Vincular Google Calendar y crear, reprogramar o cancelar el evento de un turno. |
| `AUTENTICACION-GOOGLE/` | Cita Suite - Auth - Produccion | Iniciar sesión en Cita Suite con Google mediante Supabase Auth. |

La carpeta general y sus archivos están excluidos de Git. Cada integración tiene su JSON de credenciales propio: **Calendar**, `GOOGLE-CALENDAR/CREDENCIALES-GOOGLE-CALENDAR-CITA-SUITE-PRODUCCION.json`; **autenticación**, `AUTENTICACION-GOOGLE/CREDENCIALES-AUTENTICACION-GOOGLE-CITA-SUITE-PRODUCCION.json`. El segundo contiene el secreto nuevo creado por el usuario dentro del cliente Auth existente. Sus guías y metadatos están separados; no intercambiar los archivos. Guardarlos localmente no acredita que los secretos nuevos estén instalados o que los recorridos completos funcionen.

El índice privado conserva también los identificadores históricos, su procedencia y sus incertidumbres. Drive fue retirado de la aplicación por decisión del usuario; su registro histórico no lo reactiva. El cliente anterior de Calendar conserva una conexión y un evento históricos; las credenciales del Worker ya fueron sustituidas por las del cliente nuevo, sin trasladar los tokens antiguos a otro cliente.

Comprobación del inventario: capturas aportadas el 23 de octubre de 2026 muestran los dos clientes de la tabla en Dashboard Odontologia y el nombre actualizado de autenticación. Posteriormente el usuario confirmó el acceso con Auth después de guardar su secreto nuevo en Supabase. Calendar completó consentimiento y creación gestionada de un evento sintético: lectura de producción del 24-oct02:24UTC confirma conexión del cliente nuevo, autorización cifrada presente y evento `active` con secuencia vigente, sin errores. Son comprobaciones acotadas a esa cuenta y cita; reprogramación/cancelación y verificación pública de Google siguen abiertas. Ver [estado y acceso de Calendar](acceso-google-calendar.md).
