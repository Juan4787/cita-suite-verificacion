# Evidencia de etapa 5: estructura, interfaz e identidad

**Estado: cerrada sobre `674649108bc2caa87e82c8bca25d93f82d584d51`, con dictamen independiente `ship` de Impeccable y DESIGN.md documentado (ver la última sección).** La fuente normativa es el [plan íntegro](../plans/refactorizacion-cita-suite.md). Esta matriz no sustituye ni reduce objetivos. [Registro cronológico y hashes](../plans/registro-refactorizacion-cita-suite.md) · [traspaso](../plans/traspaso-refactorizacion-cita-suite.md) · [revisión de interfaz](revision-ui-estructura.md) · [verificación](verificacion.md).

Evidencia de cierre: **full 39276578152** (recibo `c0219616-f7d1-4e03-9843-bf6cb72a4cb7`, digest `44fb86451d5355987ab90456278173ddb24edb2d99312dd9fb63b941c3349490`, paquete `.verification/remote-39276578152/`, SHA-256 `b7667aeee80f8814b29a8917f7ead6123aaec0c335e45a2578d9bc19e9697c36`). Las 15 etapas obligatorias con estado 0: plan, inventario, tipos compartidos/web/**pruebas de navegador**/Natalia, guardas del verificador, recuperación de evidencia, fronteras, 1.265 pruebas de servidor, 167 de cliente, exportación nativa, reconstrucción SQL con todas las suites y carreras, **37/37 casos de navegador** con GoTrue/PostgREST/Storage reales descartables, 2/2 demo y medición de Natalia. Sin omitidos ni reintentos; deadlocks 0; sin errores Auth.

Fulls anteriores aprobados de esta etapa (39220668360 sobre `a940f23`, 39230164316 sobre `34ceee9`, 39271310470 sobre `bfba6de`) certifican sus propias fuentes. Cada lote posterior corrigió observaciones de la revisión independiente; ninguno de esos fulls certifica los cambios que vinieron después.

## Matriz de aceptación

| Requisito original | Implementación y comprobación | Evidencia |
|---|---|---|
| Recorridos completos hacia seis áreas | `server/{access,team,scheduling,patients,integrations,sites}/{public,internal}`, contratos puros y plataforma transversal; mapa en `areas-y-fronteras.md`. `dependency-cruiser` fijado, sin exclusión global heredada, con pruebas adversarias reales de importación privada, servidor desde navegador y ciclos. | Fronteras y adversarias aprobadas en full 39276578152. |
| Rutas limitadas a transporte, contexto, operación y resultados | Ficha, edición clínica, archivo y alta de pacientes; editor y alta de Equipo; disponibilidad, reserva y sitios delegan sus reglas. Los CRUD sencillos no reciben capas vacías. Se retiraron el escaneo de Auth, las compensaciones administrativas y los helpers sin consumidores. | Unidades, SQL y navegador en full 39276578152; SQL propio en 39161858092, 39162608709 y 39183067318. |
| Componentes por tarea y estado | Reserva: selección, fechas, formulario final y confirmación. Manual: selección e identidad. Pacientes: perfil, historia y formularios. Profesional: perfil, servicios, horarios y ciclo de vida con coordinador de borrador. Equipo: alta separada del listado y los accesos. | Cliente 167/167 y matrices de navegador en full 39276578152. |
| Controles personalizados y diseño preservados | Sin sistema visual nuevo. Los controles que requieren JS quedan deshabilitados hasta hidratar (también menús del shell, categorías de Equipo y «Agregar seguimiento»). El primer clic habilitado funciona y las pruebas lo ejercen con un único clic, sin reintentos. Meta viewport con zoom permitido. | Full 39276578152; prueba de carga lenta de referencias; detector Impeccable sin hallazgos primarios. |
| Perfil, prestaciones y horarios en su sección | Equipo conserva la configuración; Sitios configura presentación, orígenes y alcance sin redefinir servicios ni horarios. | Rutas y contratos; navegador en full 39276578152. |
| Obligatorios antes de opcionales | `.patient-required-fields` precede a `.patient-optional-fields` y los opcionales no tienen `required`. | Matriz pública de 20 combinaciones y capturas de región en full 39276578152. |
| Marca sólo presentación | Operaciones, motor y permisos únicos. Natalia usa `BookingAppearance`; `color_mode` no otorga alcance. | Contratos, SQL y matriz pública. |
| Temas semánticos y continuidad | Cita Suite conserva su tema oscuro único con ambas preferencias del navegador; Natalia tiene dos modos reales por `color_mode`. No se inyectan clases para fabricar un tema privado. | Las matrices registran por separado preferencia y tema renderizado. |
| Natalia abre Cita Suite nativa | Navegación al origen real, mismo token, gestión y push; sin copia del motor en Natalia. Cursos y noticias intactos. | Recorridos nativos en full 39276578152. Hosting real queda para release. |
| Retornos seguros | Validación de URL y origen, sin redirección arbitraria ni autoridad derivada de la marca. | Contratos y negativos en unidades y navegador. |
| Sin desbordes, controles recortados ni texto ilegible | `layoutIssues` (`e2e/helpers/layout-usability.ts`) es el contrato común: zoom permitido, sin desbordamiento horizontal, controles dentro del viewport con ancho útil, sin overlay y texto legible (`textIssues`): ninguna palabra ordinaria partida, ninguna etiqueta corta de control partida, ningún número separado de su unidad o importe ni contador «N de M» partido, ningún «·» colgado al final de línea y ningún texto del contenido truncado con «…». `e2e/layout-usability.spec.ts` prueba que cada clase detecta su caso defectuoso y acepta los legítimos. | Sensibilidad sobre código real: diagnóstico 39213353905 detecta los cuatro defectos reintroducidos; 39213414834, tres defectos reales nuevos; 39275879477, el contador partido de la reserva manual a 320. Full 39276578152 aprueba las cinco matrices. |
| Escritorio, móvil y contenido largo | 320/390/768/1280/1600. Ficha: 50 combinaciones de rol, ancho y preferencia. Profesional 10, alta 10, manual 10, pública 20. Contenido largo sintético. | Full 39276578152; 139 capturas alineadas a su tarea en `.impeccable/review/structure-20261018/round-2/`. |
| Teclado, foco, errores, carga y vacío | Historia por teclado, foco modal y retorno, formulario inválido, carga y error simulados con recuperación real, conteos malformados sin habilitar borrar, incertidumbre sin repetición automática y respuesta lenta de referencias. | Full 39276578152. Las intercepciones prueban presentación y recuperación, no caídas reales de un proveedor alojado. |
| JS e hidratación de Natalia | `measure-natalia-baseline.mjs`: dos builds fijados, 12 cargas frías y transferencia HTTP real. | Baseline `c0129e4` y candidata idénticas en full 39276578152: HTML 67.211 B; JS 2.371 B comprimido, 6.239 decodificado y 2.671 transferido, mismo SHA-256; 0 islas, hidratación no aplicable. |
| Identidad y repositorio | Paquetes, lock, imports y configuración local unificados; inventario y ensayo real de renombrado en un repositorio sintético, revertido y archivado; transición de producción, proveedores y directorio preparada con reversión. | Ensayo con ID y SHA conservados y tres Actions (`identidad-ensayo-github.json`). Los destinos reales se renombran en release (`identidad-cita-suite.md`). |
| Cursos y noticias intactos | `apps/natalia` sin cambios de fuente respecto del baseline. | `git diff c0129e4 6746491 -- apps/natalia` vacío; medición idéntica. |

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

1. `layoutIssues` detecta las clases de texto ilegible descritas arriba y consolida las cinco variantes duplicadas de geometría. Cada clase nueva nació de un defecto real que la barrera anterior dejaba pasar: palabras partidas (ronda 1), etiqueta corta partida, número y unidad separados y truncamiento (primer dictamen), «·» colgado (segundo puntaje) y contador partido (tercer puntaje).
2. Su sensibilidad quedó demostrada sobre el código defectuoso real y con una prueba permanente sobre marcado sintético.
3. Los specs e2e se tipan en `verify:fast` (`browser-test-types`): antes nunca se comprobaban, y había cerca de 150 errores, lecturas que ignoraban errores y limpiezas silenciosas.
4. Se retiraron los reintentos `toPass` alrededor de clics, que dependían de tiempos y ocultaban primeros clics perdidos.
5. Los specs con varios casos reutilizan una sesión real en lugar de agotar el límite de ingreso.
6. Las capturas PNG de página completa pasan a JPEG para respetar el presupuesto de evidencia sin omitir archivos.

## Revisión independiente y cierre formal

- Inspección propia en dos rondas (61 capturas de ronda 1 como evidencia negativa; ronda 2 recapturada desde cada full aprobado) y detector Impeccable una sola vez (`round-2/detector.json`, `round-2/detector-notes.md`): cero hallazgos primarios y 14 recomendaciones preexistentes de tamaños tipográficos literales.
- Revisor fresco: primer dictamen `fix` con ocho correcciones (`round-2/review-round-2.md`); puntajes posteriores (`round-2/verdict-passes.md`, texto literal) sobre `34ceee9` (`fix`: dos parciales y dos regresiones), `bfba6de` (`fix`: contador de pasos partido y emoji como ícono) y **`6746491` (`ship`)**, sin regresiones visibles y con las 139 capturas validadas por SHA-256 contra una sola corrida.
- Observaciones no bloqueantes del dictamen final, asignadas a la auditoría transversal de interfaz: la píldora «Reserva online» sobre el nombre del consultorio (kicker preexistente en la reserva pública) y las fechas «Miércoles 4 de / noviembre» partidas a 320 en Cita Suite. Se suman a las recomendaciones tipográficas preexistentes del detector. No quedan cerradas por esta etapa.
- Documentación del sistema: el documentador fresco de Impeccable actualizó `apps/web/DESIGN.md` y su sidecar con las reglas evidenciadas en el código (Tema único, Texto inseparable, Texto completo, composición de filas con acciones y controles hasta hidratar), sin cambiar tokens. Las deudas preexistentes que no canonizó están enumeradas en el [registro](../plans/registro-refactorizacion-cita-suite.md) y asignadas a la auditoría transversal.

Etapa 6, capacidad, staging, release y la auditoría transversal mantienen sus criterios propios: ninguna aprobación de esta etapa los certifica.
