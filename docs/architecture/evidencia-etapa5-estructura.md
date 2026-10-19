# Evidencia de etapa 5: estructura, interfaz e identidad

**Estado: cierre técnico comprobado sobre `a940f23cdd65a03b08d8f1d2e7f51117ca60b702`; el cierre formal se registra junto con el dictamen independiente de Impeccable (ver la última sección).** La fuente normativa es el [plan íntegro](../plans/refactorizacion-cita-suite.md). Esta matriz no sustituye ni reduce objetivos. [Registro cronológico y hashes](../plans/registro-refactorizacion-cita-suite.md) · [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) · [revisión de interfaz](revision-ui-estructura.md) · [verificación](verificacion.md).

Evidencia de cierre: **full 39220668360** (recibo `9d0be4c3-9edf-41ff-9213-acacb21a48b5`, digest `93825d2e49938b2caa11959c0ee6c13f8e0f0929d585986df5ab972ca71570d1`, paquete `.verification/remote-39220668360/`, SHA-256 `4510a25d107d7f2b02c1f5c9f50dc52b0d9aedf565880a2780b5a488e56eef63`). Todas las etapas obligatorias: plan, inventario, tipos compartidos/web/**pruebas de navegador**/Natalia, 59 guardas del verificador, recuperación de evidencia, fronteras, 1.264 pruebas de servidor, 167 de cliente, exportación nativa, reconstrucción SQL con todas las suites y carreras, **37/37 casos de navegador** con GoTrue/PostgREST/Storage reales descartables, 2/2 demo y medición de Natalia. Sin omitidos ni reintentos; deadlocks 0; sin errores Auth.

## Matriz de aceptación

| Requisito original | Implementación y comprobación | Evidencia |
|---|---|---|
| Recorridos completos hacia seis áreas | `server/{access,team,scheduling,patients,integrations,sites}/{public,internal}`, contratos puros y plataforma transversal; mapa en `areas-y-fronteras.md`. `dependency-cruiser` fijado, sin exclusión global heredada, con pruebas adversarias reales de importación privada, servidor desde navegador y ciclos. | Fronteras y adversarias aprobadas en full 39220668360. |
| Rutas limitadas a transporte, contexto, operación y resultados | Ficha, edición clínica, archivo y alta de pacientes; editor y alta de Equipo; disponibilidad, reserva y sitios delegan sus reglas. Los CRUD sencillos no reciben capas vacías. Se retiraron el escaneo de Auth, las compensaciones administrativas y los helpers sin consumidores. | Unidades, SQL y navegador en full 39220668360; SQL propio en 39161858092, 39162608709 y 39183067318. |
| Componentes por tarea y estado | Reserva: selección, fechas, formulario final y confirmación. Manual: selección e identidad. Pacientes: perfil, historia y formularios. Profesional: perfil, servicios, horarios y ciclo de vida con coordinador de borrador. Equipo: alta separada del listado y los accesos. | Cliente 167/167 y matrices de navegador en full 39220668360. |
| Controles personalizados y diseño preservados | Sin sistema visual nuevo. Los controles que requieren JS quedan deshabilitados hasta hidratar (stage 5 y, desde el cierre, también menús del shell, categorías de Equipo y «Agregar seguimiento»). El primer clic habilitado funciona y las pruebas lo ejercen con un único clic, sin reintentos. Meta viewport con zoom permitido. | Full 39220668360; prueba de carga lenta de referencias; detector sin hallazgos primarios. |
| Perfil, prestaciones y horarios en su sección | Equipo conserva la configuración; Sitios configura presentación, orígenes y alcance sin redefinir servicios ni horarios. | Rutas y contratos; navegador en full 39220668360. |
| Obligatorios antes de opcionales | `.patient-required-fields` precede a `.patient-optional-fields` y los opcionales no tienen `required`. | Matriz pública de 20 combinaciones y capturas de región en full 39220668360. |
| Marca sólo presentación | Operaciones, motor y permisos únicos. Natalia usa `BookingAppearance`; `color_mode` no otorga alcance. | Contratos, SQL y matriz pública. |
| Temas semánticos y continuidad | Cita Suite conserva su tema oscuro único con ambas preferencias del navegador; Natalia tiene dos modos reales por `color_mode`. No se inyectan clases para fabricar un tema privado. | Las matrices registran por separado preferencia y tema renderizado. |
| Natalia abre Cita Suite nativa | Navegación al origen real, mismo token, gestión y push; sin copia del motor en Natalia. Cursos y noticias intactos. | Recorridos nativos en full 39220668360. Hosting real queda para release. |
| Retornos seguros | Validación de URL y origen, sin redirección arbitraria ni autoridad derivada de la marca. | Contratos y negativos en unidades y navegador. |
| Sin desbordes, controles recortados ni texto ilegible | `layoutIssues` (`e2e/helpers/layout-usability.ts`) es el contrato común: zoom permitido, sin desbordamiento horizontal, controles dentro del viewport con ancho útil, sin overlay y **ninguna palabra ordinaria partida entre líneas**. `e2e/layout-usability.spec.ts` prueba que el detector no es vacuo. | Sensibilidad sobre código real: diagnóstico 39213353905 detecta los cuatro defectos reintroducidos; 39213414834 detecta tres defectos reales nuevos; full 39220668360 aprueba las cinco matrices. |
| Escritorio, móvil y contenido largo | 320/390/768/1280/1600. Ficha: 50 combinaciones de rol, ancho y preferencia. Profesional 10, alta 10, manual 10, pública 20. Contenido largo sintético. | Full 39220668360; capturas alineadas a su tarea en `.impeccable/review/structure-20261018/round-2/`. |
| Teclado, foco, errores, carga y vacío | Historia por teclado, foco modal y retorno, formulario inválido, carga y error simulados con recuperación real, conteos malformados sin habilitar borrar, incertidumbre sin repetición automática y respuesta lenta de referencias. | Full 39220668360. Las intercepciones prueban presentación y recuperación, no caídas reales de un proveedor alojado. |
| JS e hidratación de Natalia | `measure-natalia-baseline.mjs`: dos builds fijados, 12 cargas frías y transferencia HTTP real. | Baseline `c0129e4` y candidata idénticas: HTML 67.211 B; JS 2.371 B comprimido, 6.239 decodificado y 2.671 transferido; 0 islas, hidratación no aplicable. |
| Identidad y repositorio | Paquetes, lock, imports y configuración local unificados; inventario y ensayo real de renombrado en un repositorio sintético, revertido y archivado; transición de producción, proveedores y directorio preparada con reversión. | Ensayo con ID y SHA conservados y tres Actions (`identidad-ensayo-github.json`). Los destinos reales se renombran en release (`identidad-cita-suite.md`). |
| Cursos y noticias intactos | `apps/natalia` sin cambios de fuente respecto del baseline. | `git diff c0129e4 a940f23 -- apps/natalia` vacío; medición idéntica. |

## Garantías de las operaciones extraídas

- Ficha: los errores de proyecciones secundarias no producen vacíos editables; paginación, costos y microsegundos se conservan.
- Fecha y costo clínicos: la fecha local nueva conserva autor y plazo; el costo histórico 125.5 no se transforma en 1255. El redondeo de aranceles no se aplica retroactivamente al costo histórico.
- Archivo: la firma previa se conserva; el profesional sólo archiva su vínculo propio y dueño/admin tienen alcance global. SQL 39138864309: 28 controles y siete carreras reales de revocación.
- Editor profesional: snapshot de envío, borrador posterior conservado, token de edición de apertura y JSON de conteos validado. La revisión optimista pertenece a la base que originó el borrador.
- Servicios y eliminación: SQL 39158920021 y 39161858092 prueban atomicidad, autoridad, historial, limpieza fallida y dos carreras controladas.
- Equipo y roles: SQL 39161858092 prueba alta, defaults, horarios, acceso, rollback final, dueño/admin atendibles y último dueño. Las invitaciones se consultan por RPC autorizado y la lectura directa está denegada por diseño. La invitación aceptada conserva el mismo perfil profesional (comprobado en navegador).
- Registro manual: SQL 39183067318, con 20 controles y dos carreras propias (membresía y asignación con bloqueo observado). La lectura de identidad usa `FOR NO KEY UPDATE`.
- Disponibilidad: el 40P01 observado se corrigió con bloqueo compatible `FOR NO KEY UPDATE`. Full 39093599146: dos commits, revisión +2 sin retry y deadlocks 0.

## Verificación reforzada durante el cierre

El full 39207125504 aprobó con cuatro defectos de legibilidad visibles en sus propias capturas. Se investigó por qué: la geometría sólo medía desbordamiento del documento, y `overflow-wrap: anywhere` permite comprimir texto sin desbordar. Desde el cierre:

1. `layoutIssues` detecta palabras ordinarias partidas y consolida las cinco variantes duplicadas de geometría.
2. Su sensibilidad quedó demostrada sobre el código defectuoso real y con una prueba permanente sobre marcado sintético.
3. Los specs e2e se tipan en `verify:fast` (`browser-test-types`): antes nunca se comprobaban, y había cerca de 150 errores, lecturas que ignoraban errores y limpiezas silenciosas.
4. Se retiraron los reintentos `toPass` alrededor de clics, que dependían de tiempos y ocultaban primeros clics perdidos.
5. Los specs con varios casos reutilizan una sesión real en lugar de agotar el límite de ingreso.
6. Las capturas PNG de página completa pasan a JPEG para respetar el presupuesto de evidencia sin omitir archivos.

## Estado del cierre formal

El cierre formal de etapa 5 se registra cuando el revisor independiente de Impeccable devuelve su dictamen sobre `round-2` y, si corresponde, el documentador confirma DESIGN.md. Etapa 6, capacidad, staging, release y la auditoría transversal mantienen sus criterios propios: ninguna aprobación de esta etapa los certifica.
