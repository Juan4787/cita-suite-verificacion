# Acceso administrativo a Google Calendar de Cita Suite

**Pendiente vigente —24 de octubre de2026:** el usuario confirmó que todavía no tiene dominio propio y que lo comprará en breve. La configuración del dominio y la verificación de marca/acceso de Google quedan pendientes hasta que comunique la compra. La consulta sobre disponibilidad del dominio ya fue respondida; no repetirla ni solicitar nuevas capturas de los pasos ya documentados. Esto no cierra la integración ni la campaña.

El cliente OAuth de producción está en el proyecto **Dashboard Odontologia**, ID estable **dashboard-odontologia**.

[Enlace directo a los clientes de Google Cloud](https://console.cloud.google.com/auth/clients?project=dashboard-odontologia). Seleccionar **Cita Suite - Google Calendar - Producción**.

La identificación privada de la cuenta administradora y el JSON están en **`ACCESOS-GOOGLE-CITA-SUITE/GOOGLE-CALENDAR/`**, dentro de la carpeta general de accesos Google en la raíz del proyecto. Abrir su `LEEME.md` para la identificación específica de Calendar; el `LEEME.md` de la carpeta general reúne también autenticación. Ver [índice de todos los clientes Google](accesos-google.md).

El archivo privado se llama **`CREDENCIALES-GOOGLE-CALENDAR-CITA-SUITE-PRODUCCION.json`** y se usa exclusivamente para integrar los turnos con Google Calendar. No usarlo para Drive, el acceso con Google o Supabase Auth. La carpeta completa está excluida de Git; las credenciales no se incorporan a documentación ni al repositorio.

Guardar el JSON sólo acredita disponibilidad local. La puesta en servicio exige verificar Google Calendar API, consentimiento, retorno autorizado, credenciales desplegadas y creación/actualización/cancelación de un evento sintético. La clave de cifrado existente y los vínculos históricos se preservan.

## Estado comprobado: consentimiento y creación

El 23-octlocal/24-octUTC el usuario completó la autorización del cliente Calendar nuevo y aportó las pantallas de aviso, consentimiento y editor de Google Calendar. El aviso **«Google no ha verificado esta aplicación» es real**: no equivale a una detección de infección ni a una certificación negativa del código. No se presenta como un aviso falso ni se considera su bypass un cierre para clientes reales. Google indica que la verificación retira esta pantalla: [aplicaciones no verificadas](https://support.google.com/googleapi/answer/7454865?hl=en).

La lectura de producción de las02:24:30UTC, limitada al fixture `production-calendar-1a4b7003690d` y a su propietario ficticio, confirmó un intento OAuth consumido, conexión del cliente nuevo con autorización cifrada presente y no revocada, y un único vínculo de evento `active`, con ID remoto presente y secuencia0 igual a la del turno. Última sincronización02:17:21.753UTC, sin errores. Quedó una conexión/evento histórico ajeno al fixture. Evidencia `.verification/calendar-consent-readback-2026-10-24T02-24-29-615Z.json`, fuente `.verification/inspect-calendar-consent-20261024.mjs`, HEAD80268e2a501198243996e1bdb0048ce066434727, runtime478c096e63299b886e640c4627cd25e0db22dbfa.

Esto acredita el intercambio OAuth y la creación gestionada confirmada por la respuesta del proveedor y persistida por el recorrido de la app. **No acredita todavía una lectura independiente del contenido remoto, actualización/cancelación, cadencia de cola ni capacidad de dos consultorios.** El editor de la tercera captura tiene un botón Guardar; no demuestra por sí mismo si se trata del mismo evento o de un borrador manual y no se usa como prueba de persistencia.

Lectura HTTP secuencial de la página publicada: escritorio200 conserva la opción manual; una petición con User-Agent Android200 muestra «Recordatorio guardado en tu calendario» y formulario para quitarlo. Es simulación de encabezado para comprobar HTML del servidor, no un navegador ni un dispositivo real. La política `/privacidad`200 declara el alcance y su uso, sin enumerar los demás eventos, y la autorización cifrada. **7/7** comprobaciones, `.verification/calendar-postconsent-http-20261024.json`; fuente homónima `.mjs`. No cambiar el alcance por la diferencia de presentación entre dispositivos sin verificar el contrato y sus regresiones.

## Avisos y siguiente comprobación administrativa

Permiso solicitado y concedido: `openid` y `https://www.googleapis.com/auth/calendar.events.owned`. Google lo describe como acceso para ver, crear, cambiar y eliminar eventos de los calendarios propios: es más amplio que los eventos de Cita Suite. El código limita sus operaciones a los vínculos de la app, pero esa limitación del código no reduce la facultad del token. No afirmar que el aviso de permisos sea falso. [Alcances oficiales de Calendar](https://developers.google.com/workspace/calendar/api/auth).

La alternativa `calendar.app.created` opera sobre calendarios secundarios creados por la app; adoptarla cambiaría el destino actual `primary`, requeriría transición y pruebas, y no se aplica como parche para ocultar el aviso. No se modificaron permisos, credenciales, dominio ni código de producción en esta comprobación.

La solución para ofrecer el recorrido actual sin la advertencia de aplicación no verificada es completar la verificación aplicable de marca y acceso a datos en Google. El consentimiento se configura para el proyecto que contiene ambos clientes; **los clientes y secretos de Auth y Calendar siguen siendo distintos**. Ver [verificación de marca](https://developers.google.com/identity/verification/authentication-verification) y [estados OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

Antecedente ya completado mediante capturas posteriores: abrir [Centro de verificación de Dashboard Odontologia](https://console.cloud.google.com/auth/verification?project=dashboard-odontologia), con la cuenta indicada en la guía privada, y aportar captura del estado/requisitos. No pulsar envío ni modificar configuración para obtener esa captura. No hay acceso administrativo Google conectado en esta sesión: el enlace oficial lleva al acceso y la pantalla privada no se puede consultar con la herramienta web. No se conoce todavía si existe una solicitud enviada, pausada o ausente; tampoco se comprobó el estado de publicación ni los dominios acreditados. No inventar esas condiciones a partir del aviso. Después se prepara el paso exacto que corresponda, preservando el acceso Auth confirmado. Esperar esta única respuesta antes de otro pedido o tema.


## Problemas de marca identificados24-oct y prerrequisito de dominio

La captura posterior del usuario muestra los cuatro rechazos del intento anterior: propiedad del sitio Netlify sin acreditar, privacidad Netlify insuficiente, inicio detrás de acceso y propósito sin explicar. Los campos actuales muestran Cloudflare, pero no acreditan publicación del borrador ni una revisión nueva. HTTP de producción confirma que `/`302redirige a `/login`; la política actual sí responde200 y declaraCalendar. No trasladar el rechazo de privacidad antigua a la nueva sin revisarla, ni declarar cumplimiento completo por encontrar el nombre delscope.

Google exige verificar **Domain Property mediante DNS**, no una propiedad URL-prefix o una metaetiquetaHTML: [procedimiento específico de verificación de dominios OAuth](https://support.google.com/cloud/answer/13804266?hl=en). Workers.dev es un subdominio facilitado por Cloudflare; no una zonaDNS propia. La API de la cuenta correcta52, con versióned468 confirmada, muestra0dominiospropiosdeapp/0zonas. No demuestra que el usuario no posea un dominio en otro proveedor. Ese dato fue consultado y el usuario confirmó después que todavía no tiene dominio y lo comprará en breve; ver el pendiente vigente y la continuación al comprarlo. No se contrata ni publica otra revisión sin resolver los requisitos; no pedir archivo/metaetiquetaHTML como solución al controlDNS.

Recibos `.verification/google-branding-issues-user-20261024.json`, `.verification/google-branding-public-preflight-20261024.json` y `.verification/google-branding-domain-inventory-20261024.json`. Los anteriores pasos «capturaCentro/capturamarca» ya se completaron y no deben repetirse. No se cambió código, DNS, cliente, secreto, hosting ni facturación en este diagnóstico.

## Retomar cuando el usuario comunique la compra del dominio

La respuesta literal fue: «no tengo aun, lo comprare en breve, deja registrado actualizar eso pendiente cuando lo compre». La compra la realizará el usuario; no hay una contratación ni renovación automática autorizada al agente. No hay una pregunta pendiente ahora. El nombre del dominio y su proveedor todavía se desconocen.

Al recibir el dominio, retomar desde este punto:

1. Comprobar propiedad, acceso a DNS y destino correcto; preparar incorporación compatible al Worker de Cita Suite. Conservar enlaces existentes de `workers.dev`, citas, vínculos Calendar, clave de cifrado y reversión. No sustituir dominios mediante reemplazos globales.
2. Resolver la presentación pública: explicar qué hace Cita Suite sin iniciar sesión y enlazar privacidad/términos accesibles. Verificar el contenido real de la política y el tratamiento de datos Google; no dar por subsanado el rechazo anterior sólo por cambiar la URL.
3. Verificar la propiedad DNS en Search Console con la cuenta y permisos correspondientes al proyecto **Dashboard Odontologia**. Revisar los dominios autorizados de los clientes existentes y retirar referencias obsoletas sólo después de demostrar que no son necesarias para ningún recorrido vigente.
4. Actualizar coherentemente marca, página principal, privacidad, términos, orígenes y retornos afectados de Google/Supabase/Cloudflare. Auth y Calendar mantienen clientes, secretos y callbacks distintos. Revisar enlaces públicos, retorno desde Natalia, CORS/CSP, cookies y notificaciones: las suscripciones push dependen del origen y no se trasladan silenciosamente a otro dominio.
5. Contrastar los permisos declarados en Google con los solicitados realmente por cada recorrido. La tarjeta de acceso a datos afirmaba que no había permisos sensibles, pero Calendar concedió `calendar.events.owned`; la causa de esa discrepancia sigue sin confirmarse. No ignorarla ni añadir permisos Calendar al cliente Auth para uniformar configuraciones.
6. Publicar sólo cambios verificados con respaldo/reversión compatibles y pruebas de los recorridos afectados. Repetir acceso Auth y ciclo Calendar sin dar por aprobados contenido remoto, actualización/cancelación o dispositivo real por la creación ya demostrada. Solicitar nuevamente la verificación Google cuando los requisitos estén subsanados y comprobar su resultado: comprar/conectar un dominio no garantiza aprobación.

El procedimiento con comandos y valores concretos se completará al conocer el dominio, proveedor y configuración efectiva. No inventar registros DNS o URLs de retorno antes de ese dato. Evidencia de esta decisión: `.verification/domain-purchase-pending-user-20261024.json`; continuación vigente en `docs/plans/traspaso-refactorizacion-cita-suite.md` y registro separado.
