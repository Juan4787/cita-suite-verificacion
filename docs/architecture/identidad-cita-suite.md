# Unificación de identidad de Cita Suite

Fuente normativa: ampliación del 16 de octubre en `docs/plans/refactorizacion-cita-suite.md`. Estado: inventario inicial y preparación; **ningún recurso externo renombrado**. No sustituye el inventario final ni sus criterios de cierre.

| Recurso | Estado observado | Objetivo | Dependencias y condición de aplicación |
|---|---|---|---|
| Producto | Cita Suite | Cita Suite | Preservar marcas de consultorios y Natalia. Revisar manifest, títulos, correo/push y documentación. |
| Directorio local | `/home/usuario/CascadeProjects/Base de Datos Sabrina` | `/home/usuario/CascadeProjects/Cita Suite` | Traslado coordinado al finalizar procesos/sesión; inventariar referencias absolutas y editor. No mover durante la campaña activa. |
| GitHub principal | `Juan4787/dashboard`, remoto SSH `github-secundaria:Juan4787/dashboard.git` | `Juan4787/cita-suite` | Historial y permisos conservados; verificar disponibilidad, reglas, integraciones y CI antes de aplicar. No se sube la rama al original mientras no se verifique el despliegue automático. |
| GitHub de verificación | `Juan4787/cita-suite-verificacion` | Conservado: función explícita | Workflow manual y sin despliegue, permisos propios `contents: read`; comprobar tras cambios. |
| Supabase alojado vinculado | Adjunto: `Odontologia`, ref `yjzferwuzbtgpmdnzlcb`, organización `mstbrfonbbsbgracxfge` | Nombre visible Cita Suite | Verificar por API antes de actuar; conservar ref/API/Auth/Storage/datos. El timeout SQL es un problema independiente. Cambios externos sujetos a la puerta de publicación. |
| Supabase local CLI | `project_id = "turnos-saas"` en `supabase/config.toml` | `cita-suite` | El identificador local puede cambiar nombres/volúmenes de contenedores. Inventariar instancias existentes antes de cambiarlo; no confundir con project ref alojado. |
| Paquete raíz | `turnos-saas` | `cita-suite` | Scripts, lockfile y descriptores de evidencia. |
| Shared | `@turnos-saas/shared` | `@cita-suite/shared` | Imports, exports, filtros pnpm, dependencias workspace y lockfile deben cambiar juntos. |
| Aplicación principal | Paquete `web`, Worker `app`, URL `https://app.cita-suite.workers.dev` | Identidad Cita Suite; slugs específicos por entorno | El nombre Worker determina dirección y bindings: preservar enlaces anteriores y push/OAuth; no renombrar sólo la configuración. Resolver primero cuenta correcta. |
| Web de Natalia | Paquete `natalia`, destino comunicado `natalia-frutos.vercel.app` | Conservado: marca de Natalia | Revisar vínculo de repositorio/proyecto Vercel e integración pública al renombrar GitHub; no cambiar su marca. |
| Rutas/variables heredadas | `/odonto`, `ODONTO_SUPABASE_*`, `SABRINA_EMAIL` | Clasificación individual pendiente | Rutas públicas y nombres de secretos tienen consumidores externos. Preparar transición compatible cuando proceda; nunca reemplazo global ni lectura de sus valores. |

## Evidencia y límites

- Lectura actual de `gh api user`: `Juan4787`. `gh repo view` identifica `Juan4787/dashboard`. Actions habilitado; permisos predeterminados `write`, aprobación de PR deshabilitada. El workflow propio limita explícitamente su token a lectura; no se alteraron permisos globales.
- `apps/web/wrangler.jsonc` configura cuenta `52b358653379c162b5a07b10ae5e84b3`; el adjunto muestra sesión en `fc592fdc570803acbf4b523d106e446e`. No se cambió cuenta, destino ni despliegue.
- Configuraciones locales inspeccionadas sin abrir archivos de credenciales. Nombres de Supabase provienen del adjunto; no se presenta esa transcripción como lectura actual de la API.
- Búsqueda inicial acotada de nombres: `rg -n 'turnos-saas|dashboard|Sabrina|sabrina|Odontologia|Base de Datos Sabrina' .github scripts README.md apps/web/package.json tsconfig.base.json .env.example`. La búsqueda final ampliará código/configuración y clasificará referencias históricas sin leer secretos ni adjuntos privados.

## Pendientes de cierre

Inventario completo por proveedor, disponibilidad de nombres, referencias activas/históricas, ensayos de cambio y reversión, compatibilidad de direcciones/callbacks/orígenes, versión exacta de artefactos y autorización de entrega cuando afecte producción. Este documento no declara cumplida la unificación.


## Staging Supabase identificado por el usuario

El 16 de octubre el usuario informó el proyecto **Staging 455** (`ikaudqoilclfnztkxubz`, `https://ikaudqoilclfnztkxubz.supabase.co`), creado en la cuenta disponible de su hermano para pruebas. Destino objetivo: **Cita Suite Staging**, conservando ref/URLs. No renombrado ni migrado todavía. Producción conserva `yjzferwuzbtgpmdnzlcb`; ningún comando de staging puede inferir su destino de la vinculación CLI de producción. Acceso/contenido/plan se verificarán antes de escribir.
