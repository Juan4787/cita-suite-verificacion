# Evidencia de etapa 5: estructura, interfaz e identidad

**Etapa abierta.** La fuente normativa es el [plan íntegro](../plans/refactorizacion-cita-suite.md). Esta matriz no sustituye ni reduce objetivos. [Registro cronológico y hashes](../plans/registro-refactorizacion-cita-suite.md), [traspaso detallado en preparación](../plans/traspaso-refactorizacion-cita-suite.md).

## Matriz de aceptación

| Requisito original | Implementación y comprobación | Estado de evidencia |
|---|---|---|
| Recorridos completos hacia seis áreas | `server/{access,team,scheduling,patients,integrations,sites}/{public,internal}`, contratos puros y plataforma transversal; mapa `areas-y-fronteras.md`. `dependency-cruiser` fijado, sin exclusión global heredada, con pruebas adversarias reales de privado/servidor/ciclos de tipos. | Fronteras aprobadas en corridas citadas; repetir full de revisión final. |
| Rutas limitadas a transporte/contexto/operación/resultados | Ficha/edición clínica/archivo/alta de pacientes, editor/alta de Equipo, disponibilidad/reserva y sitios delegan reglas y operaciones. CRUD sencillos no reciben capas vacías. Escaneo Auth, compensaciones administrativas y helpers sin consumidores retirados. | Ficha/fecha full39137667238; nuevos consumidores de Equipo/alta necesitan full actual. |
| Componentes por tarea y estado | Reserva: selección, fechas, formulario final y confirmación. Manual: tareas de selección/identidad. Pacientes: perfil, historia y formularios. Profesional: perfil/servicios/horarios/ciclo de vida con coordinador de borrador. Equipo: wizard de alta separado del listado/accesos. | Unidades previas y editor fast39160133360; wizard/capturas amplias todavía pendientes. |
| Controles personalizados y diseño preservados | Sin sistema visual nuevo. Modelos/props tipados, errores humanos, estados vacíos/error separados, campos obligatorios primero. SSR no anuncia acciones JS antes de inicializarse. Meta viewport permite zoom del navegador. | Regresiones específicas en cliente; matriz y revisión visual final abiertas. |
| Perfil, prestaciones y horarios en su sección | Equipo mantiene configuración; Sitios configura presentación/orígenes/alcance de integración, sin volver a definir servicios/horarios. | Rutas/contratos y navegador existente; repetir sobre revisión final. |
| Obligatorios antes de opcionales | `.patient-required-fields` precede a `.patient-optional-fields`; opcionales no tienen required. Misma reserva/configuración; sin título descartado. | Matriz pública20 combinaciones preparada; prueba real de reserva+readback anterior se conserva. |
| Marca sólo presentación | Operaciones/motor y permisos únicos. Natalia usa `BookingAppearance`; color_mode no otorga alcance. | Contratos de origen/retorno/ámbito y SQL; navegador y capturas actuales pendientes. |
| Temas semánticos y continuidad | Cita Suite conserva diseño oscuro único (`app.html`, `app.css`, DESIGN). Se comprueba con preferencias clara/oscura del navegador. Natalia tiene dos modos reales por `color_mode`. No inyectar clases para fabricar un tema privado no ofrecido. | Precisión del arnés documentada; las capturas deben indicar preferencia y tema realmente renderizado. |
| Natalia abre Cita Suite nativa | Navegación al origen real, mismo token/gestión/push, sin copia de motor en Natalia. Curso/noticias intactos. | Recorridos nativos previos de CI; repetir navegador. Hosting real sigue en release, no se deduce de CI. |
| Retornos seguros | Validación de URL/origen, sin redirección arbitraria ni autoridad derivada de marca. | Contratos/negativos vigentes; full actual obligatorio. |
| Escritorio/móvil/contenido largo |320/390/768/1280/1600. Ficha50 combinaciones de rol/ancho/preferencia; profesional10; wizard10; manual10; público20 de marca/ancho/modo o preferencia según marca. Capturas JPEG acotadas sin reducir assertions. | Nunca hubo todavía comparación completa positiva de estas matrices; no cerrar por sólo tenerlas escritas. |
| Teclado/foco/errores/carga/vacío | Historia por Espacio/Enter, foco modal y retorno, formulario inválido, carga/error de auditoría y recuperación, conteos malformados sin habilitar borrar, incertidumbre sin repetición automática. | SDK simulado y cliente distinguidos del backend. Navegador/capturas actuales pendientes. |
| JS e hidratación Natalia | `measure-natalia-baseline.mjs`: dos builds fijados,12 cargas frías y transferencia HTTP real; islas/eventos y duración no aplicable sin fingir0ms. Baseline `c0129e492051a38d5b8025158fb996a81da0e871`. | Preparación y guardas; aún no se alcanzó ejecución positiva. |
| Identidad y repositorio | Paquetes/lock/imports/config local; inventario y ensayo real GitHub en recurso sintético, revertido/archivado. Transición de producción/proveedores/directorio preparada con reversión. | Ensayo positivo con ID/SHA conservados y3 Actions; no renombrados destinos reales. Ver `identidad-cita-suite.md`. |
| Cursos y noticias intactos | `apps/natalia` sin modificaciones de fuente en etapa5 respecto del baseline; medición y diff de cierre. | Revisión de diff; falta medición completa. No convertirlos en trabajo pendiente de campaña. |

## Garantías de las operaciones extraídas

- Ficha: errores de proyecciones secundarias no producen vacíos editables; paginación/costos/microsegundos conservados. Evidencia SDK simulado y full39114580403/39137667238. No implica que una caída alojada haya sido reproducida.
- Fecha/costo clínicos: fecha local nueva conserva autor/plazo; costo histórico125.5 no se transforma en1255. SQL17 controles compatible y navegador/readback full39137667238. El redondeo de aranceles no se aplica retroactivamente al costo histórico.
- Archivo: firma previa conservada; profesional sólo vínculo propio, dueño/admin global. SQL39138864309 verifica28 controles y siete carreras reales de revocación; no hay actualización administrativa de archivo personal en el controlador actual.
- Editor profesional: snapshot de envío, borrador posterior conservado, token de edición de apertura y JSON de conteos validado. Fast39160133360:160 cliente y resto de puertas rápidas aprobadas al alcance de esa fuente. Cambios posteriores necesitan su recibo.
- Servicios/eliminación: SQL39158920021 y39161858092 prueban atomicidad, autoridad, historial, limpieza fallida y dos carreras nuevas controladas. Conteos no sustituyen la revisión definitiva dentro de delete.
- Equipo/roles: SQL39161858092 prueba alta/defaults/horarios/acceso, rollback final, dueño/admin atendibles y último dueño. Invitaciones se consultan por RPC autorizado; SELECT directo está denegado por diseño. Readback privilegiado independiente acredita persistencia sin debilitar RLS.
- Registro manual: SQL39162608709 prueba18 controles de ficha+vínculo, DNI sin sobrescribir demografía, repetición legítima de nombre/teléfono, permisos y rollback. Los20 controles y dos carreras propias (membresía/asignación con bloqueo observado) aprueban SQL39183067318; consumidor y navegador de revisión final requieren repetición.
- Disponibilidad: el40P01 observado durante extracción se reprodujo con FKs/bloqueos reales y corrigió mediante bloqueo compatible `FOR NO KEY UPDATE`, conservando OID/ACL. Full39093599146 acredita dos commits/revisión+2 sin retry y deadlocks0; no volver a un bloqueo más fuerte por estética.

## Cierre todavía necesario

1. Full actual positivo con todas las suites obligatorias efectivamente ejecutadas, incluyendo20 controles de registro y carreras nuevas.
2. Matrices de navegador y recuperación/persistencia, sin retries ni omisiones; recuperar paquete íntegro con hashes.
3. Medición real de Natalia y comparación con baseline, sin atribuir CPU0 a ausencia de framework.
4. Inspección propia acotada, detector una vez, revisión fresca de finalización y documentación de Impeccable con capturas válidas.
5. Contraste punto por punto de esta etapa contra documento original, actualización de mapa/registro/traspaso y aviso inmediato al usuario. Después continuar con la etapa 6 (alcance vigente del 19 de octubre; la detención antes de 6 de la intervención anterior quedó reemplazada).

La separación de tareas de6, carga5/25, staging, artefactos de release, publicación y auditoría transversal siguen en el plan. Ninguna aprobación parcial de esta etapa certifica esos trabajos.

## Estado al relevo inmediato del19 de octubre

Etapa5 abierta por pedido de relevo. El diagnóstico39206541967 acredita siete casos funcionales y las matrices previstas; el octavo falla limpiando la cuenta sintética de administrador, corregido en el candidato full09dec4e/39207125504 aún en curso al relevo. La inspección propia posterior detectó defectos visuales de legibilidad y capturas de tareas incorrectas: cuatro correcciones y helper de captura preparados **sin prueba posterior**. No dar por satisfecho el criterio visual aunque full09dec4e apruebe. Releer el [traspaso actualizado](../plans/traspaso-refactorizacion-cita-suite.md), completar esa tanda, segunda inspección, detector, revisión/documentación frescas y full final antes de avisar cierre; la etapa 6 comienza sólo después de ese cierre.
