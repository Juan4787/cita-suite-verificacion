# Directivas del Proyecto y Restricciones de Entorno

## Restricciones de Rendimiento y Memoria RAM
- **Memoria RAM muy limitada:** La máquina del usuario cuenta con poca memoria RAM y se satura con extrema facilidad.
- **Prohibido el paralelismo en pruebas:** Correr tests en paralelo casi garantiza el congelamiento del sistema.

### Reglas de Ejecución:
- **Tests / Pruebas:** Ejecutar siempre en modo secuencial (`--workers=1`, `--threads=false`, `--maxWorkers=1`, etc.).
- **Procesos en segundo plano:** Evitar spawnear múltiples tareas o compilaciones concurrentes pesadas.

## Campaña de refactorización de Cita Suite

- La fuente de verdad es `docs/plans/refactorizacion-cita-suite.md`: contiene el plan aprobado íntegro y la instrucción de ejecución del usuario. Sus requisitos prevalecen sobre cualquier resumen de compactación.
- Después de cada compactación y antes de comenzar cada etapa, leer el documento original completo y contrastarlo con `docs/plans/registro-refactorizacion-cita-suite.md` y sus evidencias. No reconstruir el plan de memoria ni considerar eliminado un requisito porque falte en un resumen.
- Identificar el último punto verificado y continuar desde el siguiente trabajo pendiente, sin repetir innecesariamente operaciones ya comprobadas ni dar por terminadas tareas incompletas.
- Mantener el registro separado con etapas, cambios, pruebas, resultados, decisiones, bloqueos y pendientes. No modificar el plan original para hacerlo coincidir con una implementación incompleta.
- La autonomía cubre la campaña íntegra en rama aislada. El usuario autorizó además publicación y pruebas masivas en producción el 17 de octubre: consultar la ampliación literal del plan. Mantener la secuencia de validación/respaldo/reversión y usar datos sintéticos acotados, preservando los reales. No se autorizaron contrataciones; conservar todas las restricciones de RAM.
- Antes de declarar la campaña terminada, verificar punto por punto todos los requisitos y criterios de aceptación del documento original mediante evidencia comprobable.
