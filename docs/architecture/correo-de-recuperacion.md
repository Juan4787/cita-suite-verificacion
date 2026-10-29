# Correo de recuperación de Cita Suite

## Estado vigente — 27 de octubre de 2026, 22:29 hora de Argentina (01:29 UTC del 28)

**Activado y comprobado de punta a punta en producción.** El usuario creó la cuenta Gmail dedicada `citasuite@gmail.com`, con verificación en dos pasos y contraseña de aplicación propia (guardada por él en Bitwarden), y la cargó en Supabase → SMTP Settings: remitente `citasuite@gmail.com`, nombre `Cita Suite`, `smtp.gmail.com`, puerto `587`, usuario `citasuite@gmail.com`. Supabase muestra un aviso amarillo («proveedor pensado para correo personal»): es esperado con Gmail y no impide el envío. La plantilla en español con el asunto `Recuperá tu contraseña de Cita Suite` ya está cargada.

Prueba real, con la cuenta sintética `citasuite+recuperacion@gmail.com` (Gmail entrega las direcciones con `+` en el buzón `citasuite@gmail.com`, que controla el usuario):

1. 23:25:08 UTC del 27: cuenta creada desde el formulario real de registro de `app.cita-suite.com.ar`. Producción no pide confirmar el correo al registrarse (`mailer_autoconfirm`), así que el alta no envía correo.
2. 23:25:17: recuperación pedida desde `/reset`; la aplicación respondió éxito y Auth registró el envío a las 23:25:17.
3. El usuario recibió el correo en **Recibidos (no en spam)**: remitente `Cita Suite <citasuite@gmail.com>`, asunto `Recuperá tu contraseña de Cita Suite`, en español, con el botón «Elegir una nueva contraseña».
4. Ese primer enlace lo abrió unas dos horas después y la aplicación mostró «El enlace es inválido o expiró. Volvé a solicitarlo.»: el vencimiento de una hora funciona y el botón para pedir otro también.
5. Pidió otro, llegó, eligió una contraseña nueva (no compartida) y entró con ella: último ingreso 01:27:28 UTC del 28. Auth quedó sin enlace pendiente.
6. Reabrió el mismo enlace: rechazado (un solo uso).
7. 01:29:37: ingreso con la contraseña anterior rechazado. Esa contraseña aleatoria se borró del equipo.

`realEmailDelivered=true` y `productionRecoveryVerified=true`. Recibos sin secretos en `.verification/recuperacion-gmail-20261027/` (`registro.json`, `pedido.json`, `contrasena-anterior.json` y la herramienta de lectura `auth-estado.mjs`). La cuenta sintética queda como cuenta de prueba de correo; no es de un consultorio real.

**Límites que siguen:** Gmail admite unos 500 envíos por día; la cuenta es nueva y su reputación baja podría mandar correos a spam más adelante; un remitente `@cita-suite.com.ar` requiere un proveedor de envío (ver «Reversión y mantenimiento»). Si se cambia la contraseña principal de `citasuite@gmail.com`, Google revoca la contraseña de aplicación y el envío deja de funcionar hasta cargar una nueva.

## Decisión y estado anterior — 26 de octubre de 2026 (antecedente)

NIC.ar y la compra del dominio quedan fuera del camino necesario para preparar el correo. La alternativa temporal para un consultorio es SMTP de una cuenta Gmail existente, con nombre visible **Cita Suite** y su dirección Gmail como remitente. Esto no crea una dirección `@cita-suite.com.ar` ni elimina los avisos de verificación de Google OAuth. El usuario compró el dominio el 27 de octubre.

Antecedente: la guía se preparó primero para `juampiluduena@gmail.com`; el 27-oct el usuario eligió una cuenta dedicada, `citasuite@gmail.com`, y los valores de abajo ya la usan. Para esta cuenta no se reutilizan la autorización de Drive, su cuenta de respaldos, ni los clientes de Google Auth/Calendar. **Todavía no hay una contraseña de aplicación SMTP disponible ni una entrega real comprobada.** La preparación, las pruebas aisladas y la activación real se registran por separado.

Gmail permite SMTP autenticado con TLS; para esta integración se necesita una contraseña de aplicación y verificación en dos pasos. Su disponibilidad depende de la política de la cuenta. No desactivar esas protecciones ni usar la contraseña principal. Fuentes: [configuración SMTP de Google](https://support.google.com/mail/answer/7104828?hl=es), [contraseñas de aplicación](https://support.google.com/accounts/answer/185833?hl=es) y [SMTP propio de Supabase](https://supabase.com/docs/guides/auth/auth-smtp). No hace falta habilitar POP o IMAP para enviar correo.

## Activación en el proyecto existente

Precondiciones: sesión administrativa en el proyecto de producción `yjzferwuzbtgpmdnzlcb`, control de la cuenta Gmail, verificación en dos pasos activa y una contraseña de aplicación dedicada. No se contrata un servicio ni se cambia el plan.

1. Abrir [Contraseñas de aplicación de Google](https://myaccount.google.com/apppasswords) en la cuenta principal. Crear una con el nombre `Cita Suite - Recuperación`. Si Google no ofrece la opción, comprobar los requisitos de su ayuda; no suponer que crear otra credencial OAuth o habilitar una API la reemplaza.
2. Abrir [SMTP de producción en Supabase](https://supabase.com/dashboard/project/yjzferwuzbtgpmdnzlcb/auth/smtp). Conservar previamente los valores actuales en un gestor privado para poder revertir. El interruptor activado por sí solo no configura el envío.
3. Completar y guardar únicamente estos campos:

| Campo | Valor |
|---|---|
| Sender name / Nombre del remitente | `Cita Suite` |
| Sender email / Dirección del remitente | `citasuite@gmail.com` |
| Host | `smtp.gmail.com` |
| Port / Puerto | `587`, TLS/STARTTLS |
| Username / Usuario | `citasuite@gmail.com` |
| Password / Contraseña SMTP | La contraseña de aplicación dedicada de Google |

La contraseña se pega directamente en el campo protegido de Supabase. Nunca en conversación, documentación, Git, Actions, URLs, capturas o la configuración del navegador de la app. No se extraen tokens administrativos de almacenes internos para automatizar el panel. No usar `smtp-relay.gmail.com`, que corresponde a otra modalidad de Google Workspace.

4. En Authentication → URL Configuration, comprobar sin cambiar nada que estén permitidos los retornos exactos de recuperación `https://app.cita-suite.com.ar/reset/callback` (el que usa la aplicación desde la entrega de origen, publicada el 27-oct a las 14:19 UTC) y `https://app.cita-suite.workers.dev/reset/callback` (el anterior, que se conserva para una vuelta atrás). Estado al 27-oct, cargado por el usuario: los dos están permitidos y Site URL es `https://app.cita-suite.com.ar`; detalle en [dominio](dominio.md). No reemplazar las direcciones de Google Auth ni Calendar.
5. En Authentication → Emails → Reset Password, guardar el asunto `Recuperá tu contraseña de Cita Suite` y la [plantilla](../../supabase/templates/recovery.html). El enlace usa `{{ .ConfirmationURL }}`: no pegar un enlace de recuperación anterior ni reemplazarlo por la página de login o `SiteURL`.
6. Conservar los límites de envío del proyecto. No elevarlos ni desactivar controles para hacer aprobar una prueba. Registrar cualquier rechazo y el tiempo de espera informado por el proveedor.

El remitente configurado es `Cita Suite <citasuite@gmail.com>` (Gmail siempre envía con la cuenta que inicia sesión, aunque se escriba otra en «Sender email»); la presentación final depende del cliente de correo y de los contactos del destinatario. El correo se reserva para autenticación. No se lo usa para campañas ni para enviar datos clínicos. Esta alternativa no acredita una disponibilidad garantizada ni envío ilimitado.

## Comprobación real antes de cerrar

Usar exclusivamente una cuenta sintética cuyo buzón controle el usuario. No restablecer la contraseña de una cuenta ajena ni enviar correos a pacientes. La autorización de probar en producción no sustituye disponer del buzón acordado.

1. Desde `/reset`, solicitar una única recuperación. Registrar hora, entorno y resultado sin copiar la dirección completa, token o enlace en los logs.
2. Confirmar recepción en el buzón —incluida la carpeta de spam—, nombre/dirección del remitente, asunto y enlace al proyecto correcto. Un formulario exitoso o un SMTP aceptado no prueban recepción.
3. Abrir el enlace, comprobar que se muestra el formulario y que el fragmento con credenciales desaparece de la dirección. Elegir una contraseña distinta y verificar el resultado.
4. Ingresar a la app con la contraseña nueva y comprobar la agenda del consultorio sintético; la contraseña anterior debe fallar. No publicar las contraseñas ni guardar sesiones en la evidencia.
5. Reabrir el enlace original del correo: debe rechazarse. Verificar también un enlace inválido o vencido y que permita pedir otro. No interpretar la reutilización de una sesión ya emitida como una prueba del enlace de correo de un solo uso.
6. Revisar en Supabase los metadatos de entrega y límites. Conservar un recibo sin secretos que identifique revisión servida y configuración usada. Sólo entonces marcar `realEmailDelivered` y `productionRecoveryVerified` como verdaderos.

Las pruebas con Auth real en CI son aisladas: pueden generar un enlace con la API administrativa, validar el cambio de contraseña y el ingreso posterior, pero **no envían ni prueban recepción de un correo Gmail**. Las pruebas con respuestas simuladas se identifican expresamente. Ninguna de las dos sustituye los pasos anteriores.

## Reversión y mantenimiento

Si la prueba falla, conservar la causa observada y restaurar sólo los campos SMTP/plantilla/retornos previamente registrados. No modificar el proveedor Google, rotar sus claves ni crear otro proyecto. Desactivar SMTP propio sólo devuelve el envío integrado de Supabase, con restricciones para destinatarios y sin aprobación para clientes reales.

Para retirar el acceso, revocar únicamente la contraseña de aplicación de `citasuite@gmail.com` en Google y retirar su contraseña de Supabase. Cambiar la contraseña principal de Google también revoca las contraseñas de aplicación: corresponde generar una dedicada y repetir la prueba, sin prometer continuidad automática.

El usuario compró `cita-suite.com.ar` el 27 de octubre. Comprarlo no cambia el remitente ni configura correo: Gmail sigue siendo la alternativa temporal. Un remitente `@cita-suite.com.ar` requiere elegir un proveedor de correo y cargar sus registros DNS (SPF, DKIM y DMARC); hay que comprobar la entrega antes de retirar Gmail. Si se cargan los registros que impiden falsificar el dominio mientras no envía correo (ver [dominio](dominio.md#pendientes)), hay que reemplazarlos al habilitar ese remitente. No contratar un proveedor ni asumir cobro variable sin tope. La verificación de marca/Auth/Calendar sigue su [procedimiento separado](acceso-google-calendar.md).

## Evidencia de esta continuación

Corrida `recovery-20261026`, HEAD local preservado `80268e2a501198243996e1bdb0048ce066434727`. Preestado, diferencias, pruebas y recibos en `.verification/recovery-20261026/`. El [registro](../plans/registro-refactorizacion-cita-suite.md) y el [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) indican el último punto realmente comprobado. No declarar activado SMTP por la existencia de esta guía o de la plantilla.

### Corrección verificada antes de la activación

Fuente `ad5ac57435b41eef452be3c7449bb2fe3aacf682`, navegador alojado [40368550984](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/40368550984): Auth real descartable, rechazo de contraseña repetida, cambio válido, ingreso con contraseña nueva, rechazo de la anterior y del token consumido. Se verificaron controles y desbordamiento a 320,390,768,1280 y1600 píxeles. Las unidades reproducen las causas, incluido el orden real de inicialización de SvelteKit; los errores y primeros verificadores incompletos se conservan en el registro.

El formulario valida el correo y traduce fallos de configuración/red y límites; el callback retira el fragmento de credenciales, impide el doble envío y no informa éxito ante `same_password`. Lee `PUBLIC_SITE_URL` desde el espacio público correcto. El error de cierre de sesión posterior se distingue de una contraseña ya actualizada.

Esto **no acredita envío SMTP, recepción Gmail ni el recorrido desde el enlace real del correo**. Auditoría completa [40373057375](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/40373057375) en curso; publicación productiva pendiente. Artefactos candidato40369186753 y compatible40369909691; reversión desplegada de staging40371503253 aprobada. Consultar el traspaso antes de cualquier dispatch o despliegue.

### Entrega a otro modelo

El usuario pidió el traspaso a17:59UTC: [punto exacto y continuación](../plans/traspaso-recuperacion-sin-dominio-20261026.md). Release40373057375 sigue en curso en la última lectura. El preflight productivo falló en su primera lectura de base, después de metadata Cloudflare; causa no establecida. No se publicó la corrección ni se activó SMTP. Resolver la auditoría y ese control antes de desplegar; la entrega real de correo sigue sin comprobar.
