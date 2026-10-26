# Correo de recuperación de Cita Suite

## Decisión y estado — 26 de octubre de 2026

NIC.ar y la compra del dominio quedan fuera del camino necesario para preparar el correo. La alternativa temporal para un consultorio es SMTP de una cuenta Gmail existente, con nombre visible **Cita Suite** y su dirección Gmail como remitente. Esto no crea una dirección `@cita-suite.ar` ni elimina los avisos de verificación de Google OAuth. La compra del dominio sigue a cargo del usuario.

La cuenta principal indicada por el usuario es `juampiluduena@gmail.com`. Los valores de abajo se preparan para esa cuenta; no se reutilizan la autorización de Drive, su cuenta de respaldos, ni los clientes de Google Auth/Calendar. **Todavía no hay una contraseña de aplicación SMTP disponible ni una entrega real comprobada.** La preparación, las pruebas aisladas y la activación real se registran por separado.

Gmail permite SMTP autenticado con TLS; para esta integración se necesita una contraseña de aplicación y verificación en dos pasos. Su disponibilidad depende de la política de la cuenta. No desactivar esas protecciones ni usar la contraseña principal. Fuentes: [configuración SMTP de Google](https://support.google.com/mail/answer/7104828?hl=es), [contraseñas de aplicación](https://support.google.com/accounts/answer/185833?hl=es) y [SMTP propio de Supabase](https://supabase.com/docs/guides/auth/auth-smtp). No hace falta habilitar POP o IMAP para enviar correo.

## Activación en el proyecto existente

Precondiciones: sesión administrativa en el proyecto de producción `yjzferwuzbtgpmdnzlcb`, control de la cuenta Gmail, verificación en dos pasos activa y una contraseña de aplicación dedicada. No se contrata un servicio ni se cambia el plan.

1. Abrir [Contraseñas de aplicación de Google](https://myaccount.google.com/apppasswords) en la cuenta principal. Crear una con el nombre `Cita Suite - Recuperación`. Si Google no ofrece la opción, comprobar los requisitos de su ayuda; no suponer que crear otra credencial OAuth o habilitar una API la reemplaza.
2. Abrir [SMTP de producción en Supabase](https://supabase.com/dashboard/project/yjzferwuzbtgpmdnzlcb/auth/smtp). Conservar previamente los valores actuales en un gestor privado para poder revertir. El interruptor activado por sí solo no configura el envío.
3. Completar y guardar únicamente estos campos:

| Campo | Valor |
|---|---|
| Sender name / Nombre del remitente | `Cita Suite` |
| Sender email / Dirección del remitente | `juampiluduena@gmail.com` |
| Host | `smtp.gmail.com` |
| Port / Puerto | `587`, TLS/STARTTLS |
| Username / Usuario | `juampiluduena@gmail.com` |
| Password / Contraseña SMTP | La contraseña de aplicación dedicada de Google |

La contraseña se pega directamente en el campo protegido de Supabase. Nunca en conversación, documentación, Git, Actions, URLs, capturas o la configuración del navegador de la app. No se extraen tokens administrativos de almacenes internos para automatizar el panel. No usar `smtp-relay.gmail.com`, que corresponde a otra modalidad de Google Workspace.

4. En Authentication → URL Configuration, conservar el origen actual `https://app.cita-suite.workers.dev` y permitir el retorno exacto `https://app.cita-suite.workers.dev/reset/callback`. No reemplazar las direcciones de Google Auth ni Calendar. El cambio futuro de dominio tendrá una transición propia.
5. En Authentication → Emails → Reset Password, guardar el asunto `Recuperá tu contraseña de Cita Suite` y la [plantilla](../../supabase/templates/recovery.html). El enlace usa `{{ .ConfirmationURL }}`: no pegar un enlace de recuperación anterior ni reemplazarlo por la página de login o `SiteURL`.
6. Conservar los límites de envío del proyecto. No elevarlos ni desactivar controles para hacer aprobar una prueba. Registrar cualquier rechazo y el tiempo de espera informado por el proveedor.

El remitente configurado será `Cita Suite <juampiluduena@gmail.com>`; la presentación final depende del cliente de correo y de los contactos del destinatario. El correo se reserva para autenticación. No se lo usa para campañas ni para enviar datos clínicos. Esta alternativa no acredita una disponibilidad garantizada ni envío ilimitado.

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

Para retirar el acceso, revocar únicamente `Cita Suite - Recuperación` en Google y retirar su contraseña de Supabase. Cambiar la contraseña principal de Google también revoca las contraseñas de aplicación: corresponde generar una dedicada y repetir la prueba, sin prometer continuidad automática.

Cuando el usuario compre el dominio, preparar el remitente de ese dominio y sus registros DNS con el proveedor elegido; comprobar entrega antes de retirar Gmail. Comprar el dominio no modifica el remitente ni configura correo por sí solo. No contratar un proveedor ni asumir cobro variable sin tope. La verificación de marca/Auth/Calendar sigue su [procedimiento separado](acceso-google-calendar.md).

## Evidencia de esta continuación

Corrida `recovery-20261026`, HEAD local preservado `80268e2a501198243996e1bdb0048ce066434727`. Preestado, diferencias, pruebas y recibos en `.verification/recovery-20261026/`. El [registro](../plans/registro-refactorizacion-cita-suite.md) y el [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) indican el último punto realmente comprobado. No declarar activado SMTP por la existencia de esta guía o de la plantilla.

### Corrección verificada antes de la activación

Fuente `ad5ac57435b41eef452be3c7449bb2fe3aacf682`, navegador alojado [40368550984](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/40368550984): Auth real descartable, rechazo de contraseña repetida, cambio válido, ingreso con contraseña nueva, rechazo de la anterior y del token consumido. Se verificaron controles y desbordamiento a 320,390,768,1280 y1600 píxeles. Las unidades reproducen las causas, incluido el orden real de inicialización de SvelteKit; los errores y primeros verificadores incompletos se conservan en el registro.

El formulario valida el correo y traduce fallos de configuración/red y límites; el callback retira el fragmento de credenciales, impide el doble envío y no informa éxito ante `same_password`. Lee `PUBLIC_SITE_URL` desde el espacio público correcto. El error de cierre de sesión posterior se distingue de una contraseña ya actualizada.

Esto **no acredita envío SMTP, recepción Gmail ni el recorrido desde el enlace real del correo**. Auditoría completa [40373057375](https://github.com/Juan4787/cita-suite-verificacion/actions/runs/40373057375) en curso; publicación productiva pendiente. Artefactos candidato40369186753 y compatible40369909691; reversión desplegada de staging40371503253 aprobada. Consultar el traspaso antes de cualquier dispatch o despliegue.

### Entrega a otro modelo

El usuario pidió el traspaso a17:59UTC: [punto exacto y continuación](../plans/traspaso-recuperacion-sin-dominio-20261026.md). Release40373057375 sigue en curso en la última lectura. El preflight productivo falló en su primera lectura de base, después de metadata Cloudflare; causa no establecida. No se publicó la corrección ni se activó SMTP. Resolver la auditoría y ese control antes de desplegar; la entrega real de correo sigue sin comprobar.
