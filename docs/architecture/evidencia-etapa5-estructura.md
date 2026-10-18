# Evidencia de etapa 5: estructura, interfaz e identidad

**Etapa abierta.** Autoridad: [plan aprobado íntegro](../plans/refactorizacion-cita-suite.md). Esta matriz orienta el seguimiento; no sustituye ni reduce el original. [Registro y fuentes](../plans/registro-refactorizacion-cita-suite.md).

| Condición | Evidencia actual | Cierre pendiente |
|---|---|---|
| Seis áreas y entradas públicas sin privados cruzados | 62 módulos con propietarios; reglas sobre public/internal, sin índice masivo. Fast39091959358 sobree30daa4. | Recorridos/controladores/componentes, auditoría de APIs y full actual. |
| Sin ciclos, incluidos tipos | Excepción type-only retirada; prueba adversaria real aprobada en fast39091606334 y39091959358. | Mantenerla al descomponer recorridos. |
| Navegador sin implementación de servidor | Cuatro consumidores migrados a contratos; guardas de import directo, tipo e intermediario compartido. | Build/release y auditoría transversal de código restante. |
| Sin capas vacías ni reglas duplicadas | Entradas públicas implementan operaciones; dos fachadas redundantes eliminadas. Parser HTTP común extraído de controlador público. | Revisar invariantes/operaciones al adelgazar rutas. |
| Rutas con parámetros, autorización, operación y traducción | Lectura de ficha y creación/edición clínica extraídas; full39111152522. Edición completa/vínculo/validación extraídos posteriormente. | Verificar edición completa, restantes recorridos extensos y errores/roles. |
| Componentes por tareas y estados | Confirmación extraída y comprobada en full39111152522; elección profesional/fechas separadas después. | Verificar nuevas separaciones, descomponer ficha/manual y equivalencia render/interacciones. |
| Tipos efectivos dentro de Svelte | Comparación39111971029 confirma que `$props<T>()` no verifica la asignación interna;67 bindings corregidos con anotación real y guarda AST. | Resolver/repetir diagnósticos y retirar any/validar HTTP restantes en ficha y recorridos críticos. PageProps usa proxies generados de SvelteKit; no se altera masivamente la firma de loads para resolver una hipótesis descartada. |
| Profesional/prestación/horario permanecen en su sección | Regresiones previas conservadas. | Comparación específica tras extraer/configurar sitios. |
| Obligatorios antes de opcionales | Formulario final previo sin cambio funcional. | Recorrido y geometría en matriz amplia. |
| Marca sólo presentación | Contratos/cálculo únicos de etapa4. | Auditoría de imports, permisos y ambos temas. |
| Natalia nativa, notificaciones/gestión mismo origen | Recorridos CI previos completos. | Repetición con build final y hosting real. |
| Retornos validados | Validadores/contratos vigentes conservados. | Casos manipulados y publicación. |
| Sin recortes, desbordamientos ni estilos accidentales | Etapas3/4 revisadas sólo a alcance propio. |320/390/768/1280/1600, teclado/foco/carga/error/vacío/contenido largo. |
| Errores legibles y logs sin datos sensibles | Logging/handler seguro y guarda AST aprobados en full39111152522; pantalla503 con CSP por hash y pruebas posteriores. | Verificar pantalla503/cookies/no-store/estado503/recuperación y mantener frontera al extraer. |
| Diagnóstico SSR cerrado | Tres advertencias genéricas preservadas. Instrumentación de callsites exclusiva CI preparada. | Identificar causa real, corregir mecanismo y comprobar. |
| Semántica de documentos | Backend y pruebas de PDF cerrados en etapa3. | Corregir textos preexistentes de papelera y comprobar permisos/estados. |
| JS transferido e hidratación de Natalia | Fuente de Natalia no tocada en estos lotes. Eso no sustituye medición. | Baseline/resultado de artefacto y red comparables. |
| Identidad Cita Suite consistente | Inventario en identidad-cita-suite.md; accesos resueltos. | Paquetes/referencias activas, ensayo de renombrado, transición/repositorio y proveedores en release. |
| Cursos/noticias intactos | No forman parte de los cambios autorizados. | Verificación de diff en cierre. |

Posible error observado estáticamente, todavía sin reproducción nueva: el cargador de ficha registra errores secundarios de perfil/historia/turnos/vínculo y continúa con valores vacíos. Debe contrastarse el contrato y reproducirse en la etapa antes de decidir recuperación por panel o rechazo completo; no se presenta aún como defecto publicado demostrado.

El full de extracción39092194979 detectó40P01 durante inserciones concurrentes de profesionales y no aprobó. La carrera controlada39093073514 reprodujo40P01 con FK reales y bloqueo observado. La corrección compatible `FOR NO KEY UPDATE` aprobó full39093599146: dos commits, revisión+2 sin retry, once carreras y contador real de deadlocks=0. La CLI nativa también aprueba tras reproducir/corregir su alias Vite. Esto restituye la garantía de etapa4, sin cerrar la descomposición/UI/identidad pendiente de etapa5.

La campaña conserva etapas6/capacidad/staging/release/producción/auditoría final; ninguna fila de esta etapa las declara satisfechas.

Otro candidato estático que debe contrastarse en la auditoría del contexto: `loadMembershipsLegacy` mantiene compatibilidad ante error de suscripción mediante legacyFallback. Debe distinguir ausencia de esquema compatible de indisponibilidad técnica y conservar las reglas históricas efectivas; no se presume permiso indebido ni se cambia esta ruta antes de verificar el contrato con pruebas.
