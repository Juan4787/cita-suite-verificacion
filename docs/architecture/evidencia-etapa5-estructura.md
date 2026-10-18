# Evidencia de etapa 5: estructura, interfaz e identidad

**Etapa abierta.** Autoridad: [plan aprobado íntegro](../plans/refactorizacion-cita-suite.md). Esta matriz orienta el seguimiento; no sustituye ni reduce el original. [Registro y fuentes](../plans/registro-refactorizacion-cita-suite.md).

| Condición | Evidencia actual | Cierre pendiente |
|---|---|---|
| Seis áreas y entradas públicas sin privados cruzados | 62 módulos con propietarios; reglas sobre public/internal, sin índice masivo. Fast39091959358 sobree30daa4. | Recorridos/controladores/componentes, auditoría de APIs y full actual. |
| Sin ciclos, incluidos tipos | Excepción type-only retirada; prueba adversaria real aprobada en fast39091606334 y39091959358. | Mantenerla al descomponer recorridos. |
| Navegador sin implementación de servidor | Cuatro consumidores migrados a contratos; guardas de import directo, tipo e intermediario compartido. | Build/release y auditoría transversal de código restante. |
| Sin capas vacías ni reglas duplicadas | Entradas públicas implementan operaciones; dos fachadas redundantes eliminadas. Parser HTTP común extraído de controlador público. | Revisar invariantes/operaciones al adelgazar rutas. |
| Rutas con parámetros, autorización, operación y traducción | Lectura y edición completa de ficha, vínculo y creación/edición clínica extraídos; full39112958708. | Restantes recorridos extensos y errores/roles. |
| Componentes por tareas y estados | Confirmación, elección profesional y fechas separadas; full39112958708 conserva recorridos. | Descomponer ficha/manual y equivalencia render/interacciones/visual. |
| Tipos efectivos dentro de Svelte | Comparación39111971029 confirma que `$props<T>()` no verifica la asignación interna;67 bindings corregidos con anotación real y guarda AST. Full39112958708 aprobado. | Retirar any/validar HTTP restantes en ficha y recorridos críticos. Los contratos posteriores de ficha todavía requieren comparación positiva. PageProps usa proxies generados de SvelteKit; no se altera masivamente la firma de loads para resolver una hipótesis descartada. |
| Profesional/prestación/horario permanecen en su sección | Regresiones previas conservadas. | Comparación específica tras extraer/configurar sitios. |
| Obligatorios antes de opcionales | Formulario final previo sin cambio funcional. | Recorrido y geometría en matriz amplia. |
| Marca sólo presentación | Contratos/cálculo únicos de etapa4. | Auditoría de imports, permisos y ambos temas. |
| Natalia nativa, notificaciones/gestión mismo origen | Recorridos CI previos completos. | Repetición con build final y hosting real. |
| Retornos validados | Validadores/contratos vigentes conservados. | Casos manipulados y publicación. |
| Sin recortes, desbordamientos ni estilos accidentales | Etapas3/4 revisadas sólo a alcance propio. |320/390/768/1280/1600, teclado/foco/carga/error/vacío/contenido largo. |
| Errores legibles y logs sin datos sensibles | Logging/handler seguro, guarda AST y pantalla503 con CSP por hash aprobados en full39112958708. Cinco capturas y teclado/cookies/recuperación; caída simulada por intercepción, recuperación posterior contra Auth descartable real sano. | Inspección visual amplia y mantener frontera al extraer. No demuestra caída real del proveedor alojado. |
| Diagnóstico SSR | Callsite real: acción de login/rate-limit mediante event.fetch; wrappers globales DEV anidados de SvelteKit2.70.3. Ningún fetch de componente probado. | Comprobar artefacto de producción; no parchear/silenciar framework ni declarar desaparecido un aviso DEV conservado. |
| Semántica de documentos | Backend y pruebas de PDF cerrados en etapa3. | Corregir textos preexistentes de papelera y comprobar permisos/estados. |
| JS transferido e hidratación de Natalia | Fuente de Natalia no tocada en estos lotes. Eso no sustituye medición. | Baseline/resultado de artefacto y red comparables. |
| Identidad Cita Suite consistente | Inventario en identidad-cita-suite.md; accesos resueltos. | Paquetes/referencias activas, ensayo de renombrado, transición/repositorio y proveedores en release. |
| Cursos/noticias intactos | No forman parte de los cambios autorizados. | Verificación de diff en cierre. |

Los cinco errores secundarios de proyección de ficha se reprodujeron con SDK real y transporte simulado en39110451224; la corrección rechaza el resultado editable incompleto y aprueba full39111152522/39112958708. El historial realmente vacío permanece válido y la disponibilidad independiente de documentos se conserva. Dos candidatos posteriores —costos paginados y vacío inicial SSR— están en reproducción separada; el cierre anterior no los cubre.

El full de extracción39092194979 detectó40P01 durante inserciones concurrentes de profesionales y no aprobó. La carrera controlada39093073514 reprodujo40P01 con FK reales y bloqueo observado. La corrección compatible `FOR NO KEY UPDATE` aprobó full39093599146: dos commits, revisión+2 sin retry, once carreras y contador real de deadlocks=0. La CLI nativa también aprueba tras reproducir/corregir su alias Vite. Esto restituye la garantía de etapa4, sin cerrar la descomposición/UI/identidad pendiente de etapa5.

La campaña conserva etapas6/capacidad/staging/release/producción/auditoría final; ninguna fila de esta etapa las declara satisfechas.

Otro candidato estático que debe contrastarse en la auditoría del contexto: `loadMembershipsLegacy` mantiene compatibilidad ante error de suscripción mediante legacyFallback. Debe distinguir ausencia de esquema compatible de indisponibilidad técnica y conservar las reglas históricas efectivas; no se presume permiso indebido ni se cambia esta ruta antes de verificar el contrato con pruebas.
