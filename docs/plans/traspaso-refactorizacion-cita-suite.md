# Traspaso de la campaña de refactorización de Cita Suite

## Estado de este documento

**En preparación durante el cierre de etapa 5. La etapa 5 continúa abierta hasta que su matriz de aceptación y su revisión visual tengan evidencia positiva.** Este aviso deberá sustituirse por el recibo exacto de cierre; no interpretar la existencia de este archivo como certificación. La campaña completa no está terminada.

La instrucción vigente de esta intervención es cerrar la fase 5, avisar inmediatamente al usuario y detenerse antes de fase 6, dejando el resto listo para continuidad. No reduce el plan ni sus garantías.

## Autoridad, orden de lectura y conservación

1. Leer íntegro `docs/plans/refactorizacion-cita-suite.md`, incluidos instrucción literal de ejecución, continuidad, identidad y autorización de producción. Es la fuente normativa; prevalece sobre este traspaso, resúmenes de contexto y memorias.
2. Leer `AGENTS.md`, `docs/plans/registro-refactorizacion-cita-suite.md` y las matrices `docs/architecture/evidencia-etapa{3,4,5}-*.md`. Contrastar cada cierre con su revisión, corrida y alcance.
3. Leer `docs/architecture/areas-y-fronteras.md`, `functional-contracts.md`, `guia-nuevas-funciones.md`, `identidad-cita-suite.md`, `verificacion.md`, `contabilidad-documentos.md` y `disponibilidad-y-aranceles.md`.
4. Después de cada compactación y antes de cada etapa, repetir lectura del plan original completo y contraste con registro/evidencias. Nunca reconstruir requisitos de memoria ni modificar el plan para amoldarlo a trabajo incompleto.
5. Registrar separadamente cambios, pruebas, resultado, decisiones, bloqueos y pendientes. Una corrida posterior fallida no convierte sus suites no ejecutadas en aprobadas; tampoco borra la evidencia acotada de una corrida anterior.

## Espacio de trabajo y destinos

- Carpeta actual: `/home/usuario/CascadeProjects/Base de Datos Sabrina`. No moverla durante esta sesión: hay consumidores y referencias absolutas activos. La transición segura a `Cita Suite` está preparada en el inventario de identidad.
- Rama aislada: `refactor/maintainability-20261015`. HEAD conservado `80268e2a501198243996e1bdb0048ce066434727`. Hay numerosos cambios previos y archivos nuevos preservados; el snapshot de verificación no es un commit global del árbol ni autoriza limpiar archivos.
- No ejecutar `git reset --hard`, `git clean`, restauraciones globales ni `git add -A`. No incorporar secretos, `.env`, trazas clínicas ni recursos ajenos.
- Repositorio principal actual: `Juan4787/dashboard`; su rama principal está conectada al despliegue automático. **No empujar allí para obtener CI.** Nombre objetivo `Juan4787/cita-suite`, sujeto a volver a comprobar disponibilidad y consumidores en release.
- CI aislado: `Juan4787/cita-suite-verificacion`, rama `refactor/maintainability-20261015`, workflow numérico `386107045`. Es el único destino usado para snapshots de esta fase.
- Supabase producción: ref `yjzferwuzbtgpmdnzlcb`, nombre visible comprobado `Odontologia`, región `sa-east-1`. Staging: ref `ikaudqoilclfnztkxubz`, nombre visible aportado/comprobado `Staging 455`, región `us-west-2`. Renombrar sólo etiquetas del recurso correcto cuando corresponda, preservando refs/datos/URLs/claves/buckets.
- Cloudflare cuenta esperada `52b358653379c162b5a07b10ae5e84b3`; Worker `app`, origen estable `https://app.cita-suite.workers.dev`. **Workers Free**, confirmado por usuario; no contratar ni cambiar planes. El identificador del Worker y su URL no se cambian por uniformar una etiqueta.
- Natalia origen estable `https://natalia-frutos.vercel.app`. Mantener navegación al turnero real; no duplicar reglas en otra aplicación ni reintroducir iframe como recorrido principal para push.
- Credenciales: utilizar la configuración privada existente y comprobar sólo presencia/alcance. No copiar sus valores aquí, al chat, a snapshots, logs ni nuevos repositorios. Ninguna contraseña debe pedirse o publicarse para continuar.

## RAM y disciplina de pruebas

La máquina se satura con facilidad. Las restricciones sobreviven a cualquier permiso de autonomía/producción.

- No ejecutar builds, navegadores, bases, cargas ni múltiples procesos pesados en esta máquina. Los contenedores activos de otro producto no pertenecen a esta campaña: no detenerlos ni limpiarlos.
- CI ejecuta suites, compilaciones, PostgreSQL/Auth/Storage y navegador secuencialmente. Vitest/Playwright un trabajador, sin paralelismo entre archivos. Las carreras SQL son dos conexiones controladas dentro de una prueba.
- No aumentar conexiones/recursos para ocultar errores de bloqueo. PostgreSQL descartable se usa con el presupuesto configurado; el contador real de deadlocks debe seguir en cero. Las advertencias de SvelteKit DEV no prueban un fetch de componente ni justifican silenciar el framework.
- Mantener una corrida activa y, como máximo, una pendiente. No reemplazar pendientes sin registrar que quedaron canceladas. Las pruebas locales permitidas deben ser realmente livianas y secuenciales.

### Ciclo reproducible de snapshot y CI

Ejecutar cada comando sólo si el anterior terminó con salida cero; `exec_command` devuelve errores de salida sin lanzar necesariamente una excepción.

```bash
node --max-old-space-size=192 scripts/prepare-ci-snapshot.mjs
git push github-secundaria:Juan4787/cita-suite-verificacion.git refs/verification/maintainability-20261015:refs/heads/refactor/maintainability-20261015
gh workflow run 386107045 --repo Juan4787/cita-suite-verificacion --ref refactor/maintainability-20261015 -f level=full
```

La preparación usa índice aislado, conserva HEAD/índice de usuario y publica commit/tree/digest exactos. Incluye nuevas entradas mediante allowlist explícita; si se añade un script invocado por verificación, comprobar que el snapshot lo contiene. No deducirlo de `git diff` cuando el archivo sigue sin seguimiento.

Niveles `fast`, `full`, `sql`, `types`: los dos últimos reconstruyen la base y recuperan tipos oficiales; `sql` además ejecuta todas las suites/carreras descubiertas. `verify:release` tiene puertas adicionales de artefactos/staging, no equivale a `full` ni se satisface llamándolo sobre producción.

### Recuperar evidencia sin perder binarios

```bash
gh api repos/Juan4787/cita-suite-verificacion/actions/runs/ID/logs > .verification/remote-ID-logs.zip
python3 scripts/collect-verification-evidence.py .verification/remote-ID-logs.zip .verification/remote-ID
```

El destino debe ser nuevo. El colector valida SHA256, límites, rutas y binarios. Evidencia de cada corrida está también en su log público; no imprimir bloques base64. Usar `rg --hidden --no-ignore` para buscar dentro de `.verification`. Analizar primero el primer fallo real, no los errores secundarios de las suites siguientes. Recibos JSON, SQL, tipos generados, resultados Playwright y capturas son pruebas distintas.

## Qué se hizo y qué conserva cada área

El detalle cronológico está en el registro. Esta sección explica responsabilidades y riesgos para quien amplíe el producto.

### Acceso

Contexto común por petición `server/access/public/odonto-context.ts`: identidad validada, consultorio, membresía y capacidades; sin caché global de permisos. `team-access.ts` usa RPC autenticados y valida listas completas y resultados de acceso en ejecución. Una fila inválida no desaparece silenciosamente del conteo de dueños. No escanea el directorio de Auth con una clave administrativa para simular una operación transaccional.

La firma de `upsert_business_role_access` se conserva; SQL mantiene el cambio de rol/invitación/perfil en transacción. Dueños/administradores atendibles conservan su perfil; el control del último dueño conserva el criterio canónico. Invitaciones no tienen SELECT directo por RLS: la lectura autenticada autorizada es `list_business_role_access`; no abrir esa tabla para corregir una prueba mal planteada.

### Equipo

Editor individual: coordinador de borrador/guardado en `ProfessionalEditor.svelte`, perfil, servicios, horario y ciclo de vida separados por tarea. Contratos/copias/sanitización en `lib/team/professional-editor.ts`; normalización y payload horario en `professional-form.ts`. Reconocer el guardado usa la fotografía enviada, conservando cambios posteriores. Las franjas restringidas sin prestaciones quedan cerradas.

Servicios: creación+asignación en una transacción autenticada; edición conserva token y campos de apertura aunque llegue invalidación de datos remotos. Un resultado incierto no se reintenta como si fuera una creación fallida segura. Conteos de dependencias son informativos: la eliminación vuelve a verificar permisos e historial en SQL. El conteo incluye cita principal y equipo sin duplicar.

Eliminación: autoridad bloqueada, dependencias revalidadas y limpieza atómica; conflicto inmediato ante bloqueos incompatibles evita invertir el orden con FKs. El autor clínico nuevo toma bloqueo real sobre su profesional; la historia existente se conserva en actualizaciones ajenas a autoría.

Alta desde Equipo: `member-profile.ts` prepara/valida y delega a `create_team_member_profile` o `make_team_member_attending`. SQL guarda perfil, defaults reales, servicios, horarios, excepción opcional, vínculo/invitación y auditoría juntos. No hay rollback HTTP administrativo ni éxito parcial cuando fallan los defaults. La invitación pendiente mantiene el perfil oculto hasta registro.

`TeamMemberWizard.svelte` es dueño de pasos, borrador, errores y envío; listado de accesos permanece en su coordinador. El componente se identifica por consultorio/actor y descarta respuestas posteriores a desmontaje. Los controles JS esperan inicialización. Las mutaciones alternativas sin consumidores y el fallback de borrado/reinserción horario se retiraron; no restaurarlos para compatibilidad silenciosa.

### Pacientes y clínica

Proyección, ficha, historia, edición clínica, archivo y documentos tienen operaciones públicas con permisos explícitos. Los retornos JSON se validan, errores secundarios de lecturas no se convierten en falsos vacíos y los costos históricos conservan decimales existentes cuando corresponde (no confundirlos con aranceles cotizados en pesos enteros).

Fecha clínica nueva respeta zona del consultorio; RPC compatible anterior permanece. Archivo profesional afecta su vínculo, no el archivo global ni el de un colega. Dueño/admin conservan alcance global. Las carreras prueban revocación de rol, vínculo, asignación, asistencia y pausa comercial.

Alta manual: `patient-registration.ts` y `register_patient_safely` guardan ficha+vínculo en transacción autenticada. DNI duplicado recupera identidad existente sin sobrescribir sus datos; nombre y teléfono repetidos siguen siendo válidos. Restaurar vínculo elige sólo uno entre históricos inactivos. No usar un cliente administrativo después de una comprobación previa de permisos ni borrar una ficha como compensación por un resultado incierto.

### Agenda/reservas

Un calculador TS y ventanas SQL acotadas; precio confirmado por SQL y preview exacto por TS. Se conservan intervalos base/márgenes/descansos, idempotencia, exclusión y aceptación de cotización actualizada. La UI manual y pública reutiliza esas reglas; marca y tema son sólo presentación. Cita Suite conserva su diseño oscuro único (también ante preferencia clara del navegador); Natalia tiene dos modos reales. No habilitar un tema privado inexistente manipulando clases en el arnés ni llamarlo cobertura de una función implementada. Cada etapa tiene su evidencia propia de paridad/carreras.

### Sitios

Configuración profesional/servicios/horarios sigue en Equipo, no se replica en conexión del sitio. Integración mantiene orígenes y retorno validados, navegación nativa, tokens/rutas existentes y mismo origen para gestión/push. El formulario final mantiene obligatorios antes de opcionales. Natalia no almacena una copia del motor ni convierte una confirmación visual en prueba de persistencia.

### Integraciones

Los módulos están clasificados con fronteras, pero **la separación y presupuesto de tareas de fase 6 no se consideran hechos**. Mantener push/calendario/reseñas/limpieza existentes hasta transición verificada. No activar programadores nuevos ni duplicar cron como efecto secundario de publicar una refactorización parcial.

## SQL nuevo y transición

Las migraciones aplicadas históricamente no se editan. Las nuevas de esta campaña están en la rama/snapshots y deben aplicarse en orden después de reconstrucción, respaldo/recuperación, staging y auditoría de release. No ejecutar un `db push` al destino vinculado por comodidad.

En el último lote de etapa 5:

| Migración | Responsabilidad |
|---|---|
| `20261018010000_clinical_entry_date_edit.sql` | Fecha de consulta compatible. |
| `20261018020000_patient_archive_actor_scope.sql` | Autoridad vigente y archivo global/personal. |
| `20261018030000_team_editor_atomic_commands.sql` | Servicios, dependencias, eliminación y autoría clínica concurrente. |
| `20261018040000_team_access_transactions.sql` | RPC canónico de acceso compatible y perfiles atendibles. |
| `20261018050000_team_profile_onboarding.sql` | Alta completa y perfil atendible atómicos. |
| `20261018060000_patient_registration_transaction.sql` | Registro manual de paciente y vínculo atómico. |

Esta tabla no sustituye el manifiesto completo: obtener todos los archivos pendientes, su orden y hashes al preparar la entrega. Tipos en `packages/shared/src/database.types.ts` provienen del generador fijado sobre todas las migraciones, con doble generación reproducible; nunca añadir firmas a mano para poner verde TypeScript.

## Identidad: aplicado, ensayado y preparado

- Aplicado en código: producto `Cita Suite`, raíz `cita-suite`, workspace `@cita-suite/shared`, filtros/imports/lockfile coherentes, configuración local y variable `CITA_SUITE_OWNER_EMAIL` con alias compatible histórico.
- Ensayado realmente: renombrado/reversión de repositorio sintético, conservación de ID/SHA/permisos/default branch, Git nativo y tres Actions sobre mismo SHA. Evidencia `docs/architecture/identidad-ensayo-github.json`. Recurso quedó con nombre original, archivado y Actions deshabilitado.
- Preparado: transición exacta del principal/remotos/proveedores, nombres visibles Supabase, hosting y directorio, con inventario/excepciones/reversión. Ver `identidad-cita-suite.md`.
- No aplicado en esta fase: nombres de producción, dominios, project refs, claves, vinculaciones de proveedores ni movimiento de carpeta. La redirección GitHub no sustituye actualizar consumidores. No afirmar que Apps externas no existen sólo porque webhooks/rulesets listados estén vacíos.

## Evidencia y limitaciones de entorno

Consultar el recibo final de etapa 5 y el registro para la revisión exacta aceptada. Referencias parciales verificadas: full39137667238 (ficha/fecha/costo), SQL39138864309 (archivo y carreras), fast39160133360 (editor160 cliente), SQL39161858092 (Equipo/accesos/alta y carreras), SQL39162608709 (registro de paciente18 controles). Ninguna certifica cambios hechos después de su snapshot.

Toda la evidencia SQL de CI usa PostgreSQL real descartable con claims sintéticos; las suites E2E usan GoTrue/PostgREST/Storage reales descartables. Intercepciones de red prueban presentación/recuperación, no una caída real del proveedor. `full` no acredita capacidad alojada, despliegue en Cloudflare/Vercel ni entrega real con OAuth externo. Las dos suites OAuth preexistentes tienen requisitos de cuentas/proveedores y se deben tratar expresamente en release/auditoría, sin contarlas como aprobadas por CI.

La comparación de Natalia construye baseline `c0129e492051a38d5b8025158fb996a81da0e871` y candidato con herramientas/dependencias fijadas; mide doce cargas frías (390/1280, tres por variante), JS comprimido/decodificado/transferido e indicadores de islas/eventos. Si no hay hidratación Astro, duración no aplicable: no inventar 0ms ni confundirlo con CPU de JS nativo. El contacto/catálogo usados para medir son sintéticos loopback.

## Continuidad después del cierre de fase 5

### Etapa 6: tareas automáticas

Releer su texto original antes de comenzar. Separar disparador Worker pequeño con Service Binding, sin reglas ni credenciales de Supabase/proveedores; trabajo en aplicación. Cada evento ejecuta una categoría y espera resultado. Programaciones UTC: push `*/5 * * * *`; calendario `1-59/5 * * * *`; reseñas `2-59/10 * * * *`; limpieza `3-59/15 * * * *`; mantenimiento `17 */3 * * *`. Mantenimiento alterna conciliación comercial y almacenamiento, cada una cada seis horas. Verificar capacidad efectiva de cinco disparadores en la cuenta/plan actual antes de activar; respetar propagación.

Medir cadena completa: perfil Free hasta40 llamadas externas, hasta4 simultáneas,20s totales con margen, CPU/memoria/conexiones de plataforma comprobadas. Perfil Paid hasta300 no autoriza contratar. Derivar lote del peor costo por elemento, incluyendo Auth, SDK, envíos, resultados, redirecciones y retries; un Service Binding no concede mágicamente otro presupuesto.

Reutilizar estados/reclamaciones existentes: vencimientos, reparto por consultorio, contexto/escrituras agrupadas seguras, revalidación cancelación/reprogramación antes de proveedor, respuesta perdida/resultado incierto, espera persistente e identificadores estables para deduplicar cuando sea posible. No prometer exactamente una entrega si el proveedor no la garantiza. El entrypoint viejo no puede seguir procesando categorías duplicadas.

Cierre con recuperación y comienzo de trabajo ordinario dentro de10min con proveedor sano/volumen acordado. Si Free no alcanza, medir y exponer el recurso necesario; no rebajar criterio ni contratar automáticamente.

### Capacidad y regresión transversal

Dos escenarios deterministas, no estados inventados:5 consultorios/30.000 pacientes/60.000 turnos y25/150.000/300.000, doce meses. Cada uno2min preparación+10min medición, tres repeticiones secuenciales; un usuario concurrente por consultorio,80% lecturas/20% escrituras internas, pausas3–8s. Runner externo, nunca esta máquina.

Reserva pública separada: recorrido Natalia y enlace; lecturas bajo límites; escrituras un único generador cada4min, teléfonos ficticios distintos; abuso espera rechazo. No desactivar límite IP global ni falsificar encabezados/IP. Medir lecturas p95<1s/p99<2s; escrituras p95<1,5s/p99<3s; errores inesperados<1%; cero cruces/doble reserva/cuotas; disponibilidad completa o error, nunca parcial silencioso.

Colas:5 pendientes por consultorio y escenario desigual con uno muy grande; antigüedad por consultorio además de total. Planes/índices/bloqueos/crecimiento de consultas con datos representativos; un seq scan no es un defecto sin contexto. No extrapolar contenedor a Supabase alojado. Observabilidad debe distinguir HTTP a base, proveedor y SQL: un contador de fetch no es número de queries SQL.

### Release, producción y auditoría final

Producción/pruebas masivas autorizadas por ampliación literal del17 de octubre; no volver a pedir ese permiso ni omitir puertas previas. No hay autorización de compras. Preparar manifiesto exacto de revisión, hashes, destinos y migraciones; ensayar respaldo/restauración aislados y reversión compatible; migraciones compatibles y aplicaciones/programador en staging; auditoría de artefactos y hosting.

Sólo después del conjunto aprobado, detener programador anterior, esperar activos, publicar migraciones/apps, activar nuevo, verificar eventos reales y versión servida, permisos, reserva, almacenamiento y tareas. Reversión detiene nuevo programador antes de restaurar versión compatible/programador anterior; no restauración destructiva que pierda escrituras nuevas.

Auditoría final punto por punto del plan, no una etiqueta general: rutas alternativas que eviten autoridad/cuota/capacidad, clientes/JSON/casts, duplicación/ciclos/imports, paginación/truncamiento/falso vacío, alta de consultorio sin configuración faltante, recorridos cruzados en artefactos y cambio de cuota/recursos sin perder datos/permisos/pendientes. Corregir y repetir fallos antes de cierre; no ocultar deuda en un comentario de trabajo futuro.

## Fuera del alcance actual

Cursos y noticias de Natalia continúan intactos y pospuestos. No abrir su implementación en esta campaña. Notificaciones de WhatsApp descartadas; no reintroducirlas en tareas ni pendientes. PDF y documentos sí tienen el alcance autorizado posterior y garantías de etapa3; no confundir con la postergación histórica anterior.

## Entrega requerida al usuario

Notificar fase5 en cuanto cierre realmente; identificar revisión/evidencia y documentación, y detenerse antes de6 conforme al último alcance. Quien continúe debe completar toda la campaña restante antes de presentarla como finalizada. Nunca asegurar “cero deuda” o “todo auditado” por un full positivo parcial, una captura o una migración no aplicada.
