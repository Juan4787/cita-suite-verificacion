# Activación futura y verificación

> **Alcance histórico, actualizado el 22 de octubre de 2026.** Este procedimiento describe la integración embebida inicial, que conserva compatibilidad para otros sitios. Natalia ahora navega de forma nativa al turnero de Cita Suite: usar el [plan aprobado](../plans/refactorizacion-cita-suite.md), la [verificación vigente](../architecture/verificacion.md) y el [procedimiento de publicación](../architecture/publicacion-y-reversion.md). No conectar sus botones al iframe ni ejecutar localmente los comandos pesados de las secciones históricas: bases, builds y navegadores se ejecutan secuencialmente en CI. Las evidencias locales de abajo no certifican la activación actual ni sustituyen el release.

## Estado inicial

`BOOKING_INTEGRATIONS_ENABLED=false` y `BOOKING_CONTEXTS_AVAILABLE=false` conservan el comportamiento anterior y evitan consultas a tablas nuevas antes de instalarlas. No hay registros reales de Natalia en estas migraciones. `WEB NATALIA` sigue siendo una maqueta.

La pieza de integración está implementada y cuenta con evidencia local. Eso no activa un consultorio real ni vuelve funcional el resto de la web. Los pasos siguientes requieren la configuración clínica y comercial confirmada, el despliegue verificado y, por separado, la migración de la maqueta y la conexión de sus botones.

## Preparación y despliegue

1. Revisar el diff y el destino. Excluir secretos y archivos ajenos al cambio. Ejecutar verificaciones secuenciales y preparar una versión identificable y recuperable.
2. Aplicar primero las dos migraciones aditivas `20261012235000_patient_timestamp_optional_alert.sql` y `20261013000000_booking_integration_foundation.sql`. La primera corrige un defecto de reconstrucción existente: el trigger de timestamps refería a una columna clínica no creada por las migraciones. Conserva su comportamiento cuando la columna existe y también funciona cuando está ausente.
3. Publicar el código con altas integradas apagadas. Después de comprobar el esquema, configurar `BOOKING_CONTEXTS_AVAILABLE=true`. Este indicador debe conservarse durante una reversión operativa para leer modalidad e instrucciones históricas.
4. Crear el consultorio de Natalia mediante el flujo existente, con su acceso comercial real, servicios, profesional, asignaciones, horarios, excepciones, dirección e indicaciones confirmados. No importar turnos, valores o pacientes ficticios desde la maqueta.
5. Copiar `natalia.example.json` a un archivo privado local, completar identificadores reales y revisar preguntas/modalidades. El ejemplo contiene marcadores inválidos a propósito; no puede crear datos ficticios accidentalmente.
6. Ejecutar `check`, revisar destino/configuración, crear el perfil deshabilitado, comprobar su clave estable y revisar de nuevo. Crear un perfil predeterminado inactivo puede bloquear el enlace nativo cuando se habilita el lector del nuevo esquema; coordinar este estado antes de habilitar la consulta pública de Natalia.
7. En staging, habilitar el indicador de integración y activar únicamente el perfil preparado. Probar la reserva completa, comprobante, gestión, cancelación y solicitud de reprogramación, ambos temas, reintentos, conflictos y aislamiento.
8. Al migrar la web de Natalia, conectar sus botones al SDK y retirar la simulación. Configurar su CSP para permitir script, CSS y frame del dominio de Cita Suite. Registrar cada dominio real que mostrará el marco; no habilitar comodines para previews de Vercel.
9. Publicar y verificar el artefacto servido, cabeceras, entorno, integración y comportamiento real del extremo a extremo. Un build local o una variable guardada en Cloudflare no demuestra el estado de producción.

No activar virtual hasta confirmar cómo se comunica el acceso al paciente. Las instrucciones no se revelan durante la selección; se guardan y muestran sólo en el turno reservado. No se construye aquí una plataforma de videollamada.

## Herramienta de configuración

Requiere Node >=22.23 y las variables privadas del proyecto. Lee `.env` sin sobreescribir variables ya presentes. No imprimir ni pasar claves de servicio en argumentos, JSON de configuración o código del sitio.

```sh
node scripts/booking-integration.mjs check /ruta/privada/natalia.json
node scripts/booking-integration.mjs create-disabled /ruta/privada/natalia.json
node scripts/booking-integration.mjs check /ruta/privada/natalia.json
node scripts/booking-integration.mjs activate /ruta/privada/natalia.json CLAVE_PUBLICA REVISION_REVISADA
```

`check` es sólo lectura y devuelve los requisitos pendientes. `create-disabled` crea únicamente el registro, sin activar reservas ni alterar el acceso comercial. `activate` exige configuración, clave y revisión coincidentes, revisa disponibilidad pública y usa una actualización condicionada a esa revisión. No confirma un cambio si otro operador actualizó la configuración. Las preguntas, precios, duraciones y horarios no se inventan.

La herramienta opera sobre un perfil con el nombre indicado; no sustituye un panel de administración completo ni modifica automáticamente perfiles activos. Una configuración futura se actualiza de forma controlada en Cita Suite y requiere nueva revisión. Sus resultados de readiness son una inspección puntual, no garantía de que haya un turno libre ni sustituto de las validaciones al reservar.

El ciclo `check`/readiness, `create-disabled`, `activate`, rechazo de una revisión desactualizada y `deactivate` se probó con éxito contra el fixture local desechable. Esa comprobación cubre la herramienta y sus guardias en ese entorno; no acredita la configuración ni el estado de un consultorio de producción.

Los orígenes HTTP de loopback se admiten sólo en desarrollo (`BOOKING_INTEGRATION_ALLOW_LOCAL=true` para la herramienta y `dev=true` en la aplicación). Mantener perfiles de desarrollo separados de producción. El esquema también admite esos valores para pruebas locales, pero la aplicación de producción no los acepta.

## Conexión futura en HTML o Astro

Ejemplo a incorporar **cuando se migre la maqueta**, con la clave obtenida del consultorio real:

```html
<script src="https://app.cita-suite.workers.dev/booking/embed-v1.js" defer></script>
<script defer src="/booking-host.js"></script>
```

```js
const widget = window.CitaSuiteBooking.mount({
  integrationKey: 'CLAVE_PUBLICA_REAL',
  baseURL: 'https://app.cita-suite.workers.dev',
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
});
document.querySelectorAll('.open-booking-modal-btn').forEach((button) => {
  button.addEventListener('click', () => widget.open());
});
// Al cambiar el tema del sitio:
// widget.setTheme('dark');
// Al desmontar una página con navegación SPA:
// widget.destroy();
```

Montar una única instancia por contenedor. `close()` conserva el marco y el intento; `destroy()` elimina listeners y marco. Para una sección sin diálogo se usa `mode:'inline'` y un `container` explícito. `onComplete` es opcional, no tiene datos personales ni constituye una API de cobro, gestión o creación de turnos. Nunca decidir el éxito de un pago a partir de ese callback. Al migrar los CTA, conservar también un enlace real a `/embed/v1/CLAVE_PUBLICA_REAL` que funcione si JavaScript está deshabilitado o no llega a cargar el propio SDK; el manejo de timeout del marco necesita que el SDK ya esté ejecutándose.

La gestión, calendario y notificaciones se abren mediante el enlace de turno en una página superior: las restricciones de permisos de navegador y OAuth en iframes no deben convertirse en un flujo paralelo. Chrome y Firefox restringen la solicitud de permisos de notificaciones en marcos de otro origen, según [MDN Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API). Los tokens de gestión y referencias de recuperación deben excluirse de analytics y grabaciones de sesión. No persistir el formulario en el sitio anfitrión. La configuración CSP de Cita Suite incluye los orígenes de script/frame requeridos por [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/reference/content-security-policy/); el widget y la validación real del proveedor se verifican en staging antes de publicar.

## Apagado y reversión

Para detener nuevas reservas de Natalia, desactivar su perfil con revisión explícita:

```sh
node scripts/booking-integration.mjs check /ruta/privada/natalia.json
node scripts/booking-integration.mjs deactivate /ruta/privada/natalia.json CLAVE_PUBLICA REVISION_REVISADA
```

Con la función habilitada, el perfil inactivo conserva consulta y recuperación de reservas existentes; no admite nuevas. Si se apaga `BOOKING_INTEGRATIONS_ENABLED`, el enlace nativo de un consultorio con perfil predeterminado también bloquea nuevas reservas, en lugar de eludir sus políticas. Mantener `BOOKING_CONTEXTS_AVAILABLE=true` permite ver los turnos existentes con modalidad y apariencia correctas.

No borrar tablas, snapshots ni migraciones para revertir tráfico. Después de reservar virtuales, volver a un binario antiguo que no entiende modalidades podría mostrar direcciones incorrectas: el rollback debe conservar los lectores de contexto o detener la presentación incompatible. Una reversión operativa con el código nuevo es preferible a una reversión de esquema. Los backups/restauraciones deben incluir contexto y respuestas junto con pacientes y turnos.

## Pruebas reproducibles

Todo en secuencia; no ejecutar este listado en paralelo:

```sh
node scripts/test-booking-foundation.mjs
pnpm --filter web exec vitest run --maxWorkers=1 --no-file-parallelism
pnpm check
pnpm build:cloudflare
```

El ejecutor SQL sólo puede crear su propio PostgreSQL desechable, sin puertos publicados, con 384 MB, un CPU y doce conexiones. Usa una imagen Supabase Postgres ya disponible; no descarga una imagen grande automáticamente. Reconstruye todas las migraciones, adapta únicamente servicios de plataforma ausentes en esa imagen, ejecuta los contratos y elimina su contenedor y volumen. La compatibilidad de plataforma incluye claims modernos de Auth, tablas mínimas de Storage/Realtime y pg_cron; no prueba entregas de esos servicios.

`--keep` conserva una base de prueba y una red interna para desarrollo local, e imprime sus comandos de limpieza. Nunca toma una URL o base externa como destino. Las pruebas SQL de fixtures no deben ejecutarse directamente sobre una base con pacientes reales.

Para preparar el servidor E2E, ejecutar el runner SQL con `--keep` y después `node scripts/serve-booking-fixture.mjs NOMBRE_DEL_CONTENEDOR_IMPRESO`. Este servidor sólo acepta un contenedor rotulado por el runner; inicia PostgREST con dos conexiones y 96 MB, un gateway en loopback y Vite con heap acotado. No usa proveedores externos. Al detenerlo elimina su base, volúmenes, redes y configuración temporal. No usarlo para una base local que se quiera conservar.

`apps/web/e2e/booking-embed.spec.ts` requiere `E2E_LOCAL_BOOKING_FIXTURE_PATH`, un JSON privado de una infraestructura **desechable y local** con `appOrigin`, `apiOrigin`, `key`, `businessId`, `serviceId`, `professionalId`, `anon` y `service`. El servidor de prueba debe tener habilitada la función, deshabilitados proveedores externos y un `/harness` que abra el SDK. No admite hostnames remotos. Ejecutar con el servidor preparado:

```sh
E2E_BASE_URL=http://127.0.0.1:5177 E2E_LOCAL_BOOKING_FIXTURE_PATH=/tmp/cita-booking-runtime.json \
  pnpm --filter web exec playwright test booking-embed.spec.ts --workers=1 --output=/tmp/cita-booking-playwright-results
```

La prueba ejercita un guardado real en PostgreSQL local, pérdida intencional de respuesta, recuperación, una segunda reserva virtual, el perfil nativo compartido y cabeceras de framing. Los servicios externos, dispositivos físicos y despliegue real necesitan su propia comprobación antes de activar pacientes.

## Evidencia de esta implementación

- Reconstrucción desde cero de 92 migraciones y contratos SQL: pasó. Incluye 1.005 bloqueos, rollback de paciente/turno, ámbitos, RLS clínica, esquema histórico y timestamps con/sin columna opcional.
- Suite de código final: 125 archivos, 927 pruebas pasaron. Suite de componentes: 8 archivos, 72 pruebas pasaron. Incluye una respuesta desconocida informada por el servidor, bloqueo hasta recuperación, conservación de intento/contexto en acciones y reinicios, errores de configuración con salida humana y consulta compartida entre cargas concurrentes de layout/página.
- `pnpm check`: pasó con cero errores y cero advertencias en la verificación realizada.
- E2E local con navegador Chromium, servidor web y PostgreSQL/PostgREST desechables: pasó. Incluyó pérdida intencional de respuesta a guardado real y recuperación del mismo turno, una segunda reserva virtual que comparte exclusión por profesional, preguntas y ámbitos comunes con el perfil nativo, mensajes al anfitrión sin datos personales ni clínicos, gestión en página superior, framing permitido/rechazado y lectura clínica privada. Viewports 1280×900 y 390×844; no se registraron errores de página en esa ejecución. No certifica dispositivos físicos ni CSP/infraestructura del despliegue real.
- CLI de configuración: ciclo de readiness, creación deshabilitada, activación, rechazo de revisión desactualizada y desactivación probado en fixture local; sin cambios de producción.
- Revisión visual independiente: disposición `ship` para la resolución de F1/F2, con el alcance registrado abajo.
- Verificación final: 927 pruebas de lógica y 72 de componentes pasaron; `pnpm check` terminó con cero errores y cero advertencias; `pnpm build:cloudflare` terminó correctamente. Se ejecutaron secuencialmente.
- Build local: versión `booking-foundation-f0caecf75dd7`, hash del manifiesto de artefacto Cloudflare `ebbcbb7e003bf99a56d711473ddb4797cb17f870de2d541922daa37352c92801`. El manifiesto ordenado de 115 archivos se conserva en `/tmp/cita-booking-cloudflare.manifest`, los datos en `/tmp/cita-booking-build-metadata.json` y el hash de fuentes de ejecución en `/tmp/cita-booking-build-source.manifest`. Es identificación de este build; no demuestra por sí sola reproducibilidad de dos compilaciones ni un despliegue remoto. La búsqueda exacta de las tres credenciales privadas configuradas verificadas no encontró coincidencias en ese artefacto; no sustituye una auditoría general de secretos.
- Maqueta: `index.html`, `app.js` y `styles.css` locales coinciden por SHA-256 con los archivos servidos por `https://natalia-frutos.vercel.app/` al cerrar la verificación. No se editaron.
- Limpieza: se eliminaron los PostgreSQL/PostgREST de esta tarea, sus volúmenes/redes y los servidores de prueba. No se detuvo ni modificó el stack Supabase ajeno que ya estaba ejecutándose.
- Producción: no modificada ni certificada por estas pruebas. No se hizo carga sobre la base remota.

Esta matriz prueba los casos implementados y detecta regresiones conocidas; no permite prometer ausencia absoluta de errores ni anticipar toda capacidad futura sin pruebas nuevas.

## Revisión visual resuelta

El revisor independiente devolvió la disposición `ship` en el pase de veredicto sobre las dos correcciones solicitadas. Ese pase evaluó F1/F2; no constituye una nueva aprobación de toda la superficie ni certifica la web completa.

| Hallazgo | Corrección y evidencia | Veredicto |
|---|---|---|
| F1: gestión virtual y texto del calendario | La gestión muestra modalidad e instrucciones virtuales. El calendario habla de datos e indicaciones de acceso y esa vista no muestra dirección ni llegada físicas. Se contrastaron el código y la captura móvil con el calendario abierto. | Resuelto. |
| F2: legibilidad de estados en ambos temas | El tema Natalia define colores de error, éxito, aviso y advertencia para claro/oscuro. Se contrastaron esas definiciones con las capturas de ambos temas y la cancelación desplegada en claro. | Resuelto. |

Capturas locales revisadas, almacenadas temporalmente fuera del proyecto:

| Artefacto | Estado capturado |
|---|---|
| `/tmp/cita-booking-desktop.png` | Viewport 1280×900, modal claro y formulario desplazado. |
| `/tmp/cita-booking-mobile.png` | Viewport 390×844, modal oscuro y formulario desplazado. |
| `/tmp/cita-booking-manage-cancel-light.png` | Gestión presencial en claro, captura de página completa con cancelación desplegada. |
| `/tmp/cita-booking-manage-virtual.png` | Gestión virtual de 390 px de ancho, captura de página completa con calendario abierto, modalidad e indicaciones de acceso. |

Las capturas de formulario muestran un estado desplazado dentro del modal, no su primer viewport completo. Las recapturas de gestión posteriores a los ajustes de texto leyeron turnos ya creados en el fixture, sin una nueva alta. Se contrastaron con la paleta y las tipografías de la maqueta: documentan continuidad de identidad, no fidelidad píxel por píxel. Los artefactos temporales y la evidencia local no sustituyen la comprobación del sitio migrado y servido en su destino real.
