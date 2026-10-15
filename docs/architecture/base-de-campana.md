# Base efectiva de la campaña

Fecha de identificación: 15 de octubre de 2026. Este documento describe la entrada y los límites de evidencia; la fuente normativa sigue siendo el [plan original](../plans/refactorizacion-cita-suite.md).

## Código y preservación

La rama aislada es `refactor/maintainability-20261015`. Su HEAD de entrada, `c4a2417`, incluía una ejecución anterior rechazada. El árbol efectivo tenía reversiones de esa ejecución, documentación modificada/eliminada y archivos ajenos sin seguimiento. Se conservaron: no se utilizó `git reset`, `git clean` ni incorporación global de archivos. Ese commit no es una entrega aceptada ni una prueba de funcionamiento.

El inventario reproducible (`node scripts/inventory-campaign.mjs`) identifica archivos, tamaños, rutas, migraciones y pruebas del árbol efectivo. El catálogo SQL (`node scripts/catalog-disposable-database.mjs`) consulta exclusivamente una base descartable propia: firmas, privilegios, propietarios y huellas. Contar declaraciones SQL no sustituye ese catálogo.

## Aplicaciones y destinos

| Componente | Implementación y configuración | Destino conocido; alcance de la comprobación |
|---|---|---|
| Cita Suite | SvelteKit, adaptador Cloudflare, `apps/web/wrangler.jsonc` | Worker `app`, cuenta `52b358653379c162b5a07b10ae5e84b3`, origen configurado `https://app.cita-suite.workers.dev`. Configuración local, no certificación del artefacto servido. |
| Natalia | Astro estático, Tailwind y TypeScript, `apps/natalia/astro.config.mjs` | Demo sustituida anteriormente en `https://natalia-frutos.vercel.app`. Esta campaña no la publicó ni la modificó remotamente. |
| Datos activos | PostgreSQL/Supabase; Auth, REST y Storage | Proyecto configurado `yjzferwuzbtgpmdnzlcb`. Exclusivamente identificación/consulta de metadatos remotos; no usado como base de pruebas. |
| Código compartido | `packages/shared` | Fechas, estados, teléfono y contratos de integración; tipos SQL existentes pendientes de regeneración durante la etapa 2. |
| Administrativo | Módulo histórico inactivo | No se activa ni se le inventa un esquema. |

Las familias de configuración son acceso Supabase por módulo, correo maestro, capacidades de reservas/documentos, origen público, credencial de tareas, VAPID, Google y Mercado Pago. Los valores secretos no se copian a documentación, artefactos públicos ni registros. Los fixtures sustituyen explícitamente proveedores y credenciales por identidades sintéticas.

## Automatismos y proveedores de entrada

Existen entradas HTTP en `internal/jobs`: generación y procesamiento de mensajes, recordatorios push y conciliación comercial. Hay automatismos SQL `pg_cron` para mantenimiento clínico y exportaciones. La lista configurada en archivos no acredita cuáles están activos en la cuenta remota; la etapa 6 debe contrastar disparadores reales antes de preparar su transición.

Los efectos externos incluyen push web, calendario/reseñas de Google y Mercado Pago. No se incorporan notificaciones por WhatsApp. Cursos y noticias de Natalia permanecen pospuestos e intactos. El turnero de Natalia navega a la misma aplicación de Cita Suite.

## Accesos comprobados

- GitHub: el remoto usa el alias SSH `github-secundaria` para `Juan4787/dashboard`. La sesión activa inicial carecía de administración. Otra sesión ya guardada, `Juan4787`, tiene permisos administrativos y de escritura; Actions está habilitado. Se usa por invocación, sin cambiar la identidad global.
- La API de GitHub informa una integración `cloudflare-workers-and-pages` y una comprobación `Workers Builds: app` sobre `main`. La inexistencia de webhooks clásicos **no** demuestra ausencia de despliegues automáticos. No se subirá una rama mientras no se compruebe su destino o se disponga de un ejecutor aislado seguro.
- La lista remota de despliegues incluye `313355a4403e850379ace72bb4f37cd1c7952142` como Production el 15 de octubre. Esto no equivale a verificar la versión actualmente servida.
- Cloudflare: la sesión Wrangler consultada pertenece a otra cuenta (`fc592fdc570803acbf4b523d106e446e`). No se cambió `account_id` para eludir la discrepancia. Se solicitó renovar acceso a la cuenta correcta mientras continúa el trabajo local.
- Supabase: la CLI puede consultar proyectos. No se identificó todavía un staging autorizado y vacío. No se reutilizan proyectos ajenos ni se reactivan proyectos inactivos suponiendo que carecen de datos reales.

## Problemas de entrada y evidencia

La verificación anterior omitía Natalia en tipos, una parte de las suites SQL y no impedía éxitos sin pruebas. Algunos E2E usaban textos antiguos y limpieza demasiado amplia. La preparación de Auth insertaba usuarios SQL sin satisfacer el contrato interno de GoTrue. Son problemas de entrada/ejecutor corregidos y contrastados durante la etapa 1, no regresiones atribuidas al producto remoto.

La [matriz funcional](functional-contracts.md) vincula recorridos, roles, alcance, garantías y suites. El [registro de ejecución](../plans/registro-refactorizacion-cita-suite.md) mantiene resultados y pendientes. La evidencia local distingue autenticación SQL simulada, GoTrue/Storage reales, navegador y staging. Ninguna capa acredita automáticamente la siguiente.
