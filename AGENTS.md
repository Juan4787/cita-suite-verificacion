# Directivas del Proyecto y Restricciones de Entorno

## Restricciones de Rendimiento y Memoria RAM
- **Memoria RAM muy limitada:** La máquina del usuario cuenta con poca memoria RAM y se satura con extrema facilidad.
- **Prohibido el paralelismo en pruebas:** Correr tests en paralelo casi garantiza el congelamiento del sistema.

### Reglas de Ejecución:
- **Tests / Pruebas:** Ejecutar siempre en modo secuencial (`--workers=1`, `--threads=false`, `--maxWorkers=1`, etc.).
- **Procesos en segundo plano:** Evitar spawnear múltiples tareas o compilaciones concurrentes pesadas.

## Campaña de refactorización de Cita Suite

- La fuente de verdad es `docs/plans/refactorizacion-cita-suite.md`: contiene el plan aprobado íntegro y la instrucción de ejecución del usuario. Sus requisitos prevalecen sobre cualquier resumen de compactación.
- Después de cada compactación y antes de comenzar cada etapa, leer el documento original completo y contrastarlo con `docs/plans/registro-refactorizacion-cita-suite.md`, el traspaso vigente `docs/plans/traspaso-refactorizacion-cita-suite.md` y sus evidencias. No reconstruir el plan de memoria ni considerar eliminado un requisito porque falte en un resumen.
- Identificar el último punto verificado y continuar desde el siguiente trabajo pendiente, sin repetir innecesariamente operaciones ya comprobadas ni dar por terminadas tareas incompletas.
- Mantener el registro separado con etapas, cambios, pruebas, resultados, decisiones, bloqueos y pendientes. No modificar el plan original para hacerlo coincidir con una implementación incompleta.
- La autonomía cubre la campaña íntegra en rama aislada. El usuario autorizó además publicación y pruebas masivas en producción el 17 de octubre: consultar la ampliación literal del plan. Mantener la secuencia de validación/respaldo/reversión y usar datos sintéticos acotados, preservando los reales. No se autorizaron contrataciones; conservar todas las restricciones de RAM.
- Antes de declarar la campaña terminada, verificar punto por punto todos los requisitos y criterios de aceptación del documento original mediante evidencia comprobable.
- Alcance vigente (19 de octubre): al cerrar una etapa, avisar al usuario y continuar con la siguiente sin detenerse, hasta terminar la campaña. Esto no reduce ningún control.
- Alcance de lanzamiento (20 de octubre, decisión literal al final del plan): Cita Suite no tiene usuarios ni consultorios reales, y todos sus datos son ficticios. El lanzamiento es para dos consultorios sobre Workers Free y Supabase Free, y el despliegue gratuito debe demostrar los criterios del plan con esa carga antes de publicar; si un límite del proveedor lo impide, es un impedimento que se informa con alternativas. La capacidad para 5 y 25 consultorios deja de ser condición de cierre, sin rebajar calidad, seguridad ni integridad. No contratar nada, ni ningún servicio con cobro variable sin tope. Las protecciones de consumo se deciden por mérito: ahora si se justifican, o postergadas con su riesgo residual documentado.

## Pruebas de navegador

- Seguir `docs/architecture/verificacion.md`: los specs e2e se tipan (`pnpm --filter web check:e2e`); las matrices visuales usan `layoutIssues` y `alignTaskForCapture`; los fixtures usan `e2e/helpers/fixture-db.ts`; un spec con varios casos reutiliza la sesión (`loginWithSharedSession`); no hay reintentos `toPass` alrededor de un clic.
- Un defecto encontrado a mano se reproduce primero con una prueba que falle y después se corrige. Una prueba verde sólo vale si puede detectar el defecto que protege.
