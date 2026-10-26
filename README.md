# Cita Suite

Monorepo con la aplicación SvelteKit, la web Astro de Natalia y Supabase: agenda, reservas, pacientes, historia clínica, documentos e integraciones.

La campaña actual se rige por el [plan aprobado íntegro](docs/plans/refactorizacion-cita-suite.md). Su [registro de ejecución](docs/plans/registro-refactorizacion-cita-suite.md) distingue avances, pruebas, resultados y pendientes. Las notificaciones por WhatsApp están descartadas; cursos y noticias siguen pospuestos.

Repositorio principal: [Juan4787/cita-suite](https://github.com/Juan4787/cita-suite). El directorio físico es `Cita Suite`; la ruta anterior conserva un enlace de compatibilidad. La fuente compilada0851 y la revisión de promoción37f625b tienen funciones distintas: el marcador servido identifica el artefacto, mientras la promoción conserva historia y documentación. El [dictamen actual](docs/architecture/auditoria-final.md) mantiene el lanzamiento sin aprobar por dos mediciones fallidas de latencia y las dependencias externas descritas. La comparación sin muestreadorSQL no aprobó; sus datos y credenciales temporales ya se retiraron. El cierre está documentado con evidencia y límites, sin un tercer ensayo idéntico.

## Estructura

```text
apps/web              App SvelteKit existente
apps/natalia          Web pública Astro de Natalia
apps/scheduler        Programador Cloudflare con Service Binding
packages/shared       Tipos, constantes y helpers compartidos
supabase/migrations   SQL versionado
supabase/functions    Edge Functions futuras
```

## Comandos

```sh
pnpm install
pnpm dev
pnpm check
pnpm test
pnpm test:e2e
pnpm build
pnpm verify:fast
pnpm verify:full
pnpm verify:release
```

Usar Node de `.node-version` y pnpm de `packageManager`. Las verificaciones ejecutan una sola tarea a la vez y fallan si una suite obligatoria no se ejecuta. `full` y `release` corren exclusivamente en GitHub Actions: reconstruyen contenedores descartables propios y ejecutan navegador y compilaciones secuencialmente. No ejecutar bases, navegadores ni builds en esta máquina durante la campaña. `fast` comprueba la memoria disponible antes de cada proceso. `release` exige el paquete de su revisión exacta y comprueba el artefacto compilado y el staging; no despliega. Ver [verificación](docs/architecture/verificacion.md) y [traspaso vigente](docs/plans/traspaso-refactorizacion-cita-suite.md).

## Supabase

```sh
pnpm supabase:start
pnpm supabase:types
pnpm supabase:db:reset
pnpm supabase:stop
```

Las variables de entorno viven en la raíz. `apps/web/vite.config.ts` usa `envDir: '../..'` para que SvelteKit las cargue desde el workspace root.

## Despliegues

Cloudflare Workers es el destino de la app (`app`) y del programador (`cita-suite-scheduler`). Natalia conserva `natalia-frutos.vercel.app`. Staging tiene destinos separados. El lanzamiento inicial usa Workers Free y Supabase Free para dos consultorios; no se contratan servicios ni se cambian planes sin autorización.

La [publicación y reversión](docs/architecture/publicacion-y-reversion.md) es el procedimiento operativo. CI empaqueta el release una sola vez, con manifiesto y hashes; staging, `verify:release` y producción usan esos archivos exactos. No compilar de nuevo para publicar ni ejecutar `pnpm deploy:cloudflare` como atajo de la campaña. Antes de cualquier intervención de producción deben cumplirse las condiciones previas del procedimiento, incluidos los disparadores automáticos desconectados.

La candidata aprobada se publica con los scripts de destino explícito:

```sh
node scripts/deploy-staging-workers.mjs app <release-descargado>
node scripts/deploy-production-workers.mjs app <release-descargado>
```

Estos son pasos distintos del procedimiento; no ejecutarlos juntos ni antes de sus controles de respaldo, migraciones, staging y auditoría. El programador y Natalia tienen su propia secuencia de publicación y comprobación.

No copies valores privados al repositorio ni a `wrangler.jsonc`. Cargá en
Cloudflare, en **Settings → Variables and Secrets**, las mismas variables de
producción que necesita el servidor (incluidas las claves de Supabase,
integraciones de calendario y VAPID). `DEMO_MODE` debe permanecer
sin definir o con valor distinto de `true` en producción. Definí también
`PUBLIC_SITE_URL` con el dominio final de Cloudflare y agregalo a las Redirect
URLs de Supabase y a los redirect URIs de las integraciones externas que estén
habilitadas.

`keep_vars: true` en `apps/web/wrangler.jsonc` evita que un despliegue
borre los bindings cargados desde el panel. No lo elimines mientras las variables
y los secretos de producción se administren fuera del repositorio.

El Worker fija su ejecución dinámica cerca de `aws:sa-east-1` (São Paulo), donde
reside Supabase. Cloudflare sigue entregando los assets estáticos desde el borde
más cercano a cada persona; la ubicación dirigida reduce los viajes de las rutas
server-side a la base de datos.

Las variables y los secretos pertenecen al Worker, no al repositorio. Cambiar
`name` en `wrangler.jsonc` apunta a otro Worker y **no** copia su configuración.
Después de cualquier cambio de nombre, cargá y verificá como mínimo
`ODONTO_SUPABASE_URL`, `ODONTO_SUPABASE_ANON_KEY` y
`ODONTO_SUPABASE_SERVICE_ROLE_KEY` en el nuevo destino antes de dirigir tráfico.

Para una vista previa de Workers desde la terminal, tras cargar secretos locales
en un archivo no versionado `.dev.vars`, ejecutá:

```sh
pnpm dev:cloudflare
```

Los secretos locales no se incluyen en Git. El Worker usa la compatibilidad de
Node de Cloudflare para mantener los módulos de servidor existentes. El
`compatibility_date` queda fijado a la última fecha compatible con la versión
de Wrangler elegida para los despliegues existentes. La versión Node de compilación
es independiente de esa fecha de compatibilidad. La revisión servida se comprueba contra
el artefacto publicado; no se deduce de la versión local de Node.

## Estado actual

La app operativa es el panel SvelteKit de `apps/web`, con rutas `/odonto` protegidas, login Supabase, modo demo, modelo multi-tenant, agenda, turnos, ficha clínica y archivos privados en Supabase Storage.
