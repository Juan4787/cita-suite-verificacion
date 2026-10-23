# Verdict pass — cuotas y documentos — ronda 1

disposition: **ship**

## persistence

Dictamen limitado a los tres hallazgos de la revisión independiente anterior. Se revisaron de nuevo las seis capturas obligatorias antes de leer el lote y se contrastaron con el código pertinente. Las seis son válidas y sus SHA-256 coinciden con `capture-source.json`.

Fuente declarada: CI descartable `39048463987`, revisión `50f0b58d3583402b82bd09678e779c267689b293`, digest `efe2d810070d46e49ae8d07e9aa91946b73dc4a2f40bddaa57ea54e7cbeaa41b`. El recibo `full.json` confirma aprobación entre 16:15:50 y 16:21:06 UTC. El reporte de navegador confirma el caso de cuotas aprobado sin reintentos y 27 casos esperados, cero omitidos, inesperados o inestables. No se ejecutaron pruebas, compilaciones, navegador ni detector locales.

## fidelity

La navegación de escritorio ahora conserva etiquetas horizontales y separación de marca, navegación y cuenta en las capturas de consultorio y paciente a 1280. El nombre completo permanece en el DOM y se expone también mediante `title`; el código dispone dos filas antes de xl y tres columnas desde xl. El E2E aprobado comprueba geometría de navegación a 768, 1024, 1280 y 1600.

Las capturas maestras muestran el resultado junto a la fila usada. Las capturas del paciente pausado muestran una descripción neutral del vacío. Se conserva el sistema visual heredado. La posición de las barras inferiores móviles en fullPage sigue siendo un efecto de captura, no una nueva regresión demostrada.

## ceiling

**Ship para esta lista de tres correcciones: 3/3 resolved.** Este pase no repite la auditoría completa ni declara aprobada toda la interfaz, la matriz visual de etapa 5, staging o producción. La evidencia de funcionamiento corresponde exclusivamente al entorno descartable de CI.

## material_fixes

| Hallazgo anterior | Puntaje | Evidencia de resolución |
|---|---|---|
| P1: navegación comprimida por el nombre largo | **resolved** | `clinic/desktop.png` y `patient/desktop.png`: encabezado compacto, destinos legibles y sin solapamiento. `apps/web/src/routes/odonto/+layout.svelte:796` distribuye las regiones con grid; los controles mantienen texto sin partir. `apps/web/e2e/clinical-storage-policy.spec.ts:16` comprueba los cuatro anchos de escritorio y el caso consta aprobado en el reporte recuperado. |
| P2: respuesta alejada del formulario maestro | **resolved** | `master/desktop.png` y `master/mobile.png`: éxito dentro de la fila guardada. `apps/web/src/routes/odonto/maestro/almacenamiento/+page.svelte:54` y `:84` condicionan cada respuesta por `form.target`; el campo enlaza su mensaje y marca el importe inválido cuando corresponde. La acción distingue errores de importe y conflictos de revisión. El E2E aprobado comprueba éxito, error y conflicto dentro de la fila y conserva valor y borradores ajenos. |
| P2: invitación a adjuntar durante una pausa | **resolved** | `patient/desktop.png` y `patient/mobile.png`: el vacío dice que los documentos guardados aparecerán en la ficha. `apps/web/src/lib/components/patients/RadiographsPanel.svelte:627` limita la invitación a `canUpload && !demo`; el E2E aprobado exige su ausencia durante la pausa. |

No se observaron regresiones directamente introducidas por el lote dentro de estos tres puntos. No quedan elementos partial o unresolved en esta lista.

## keep

Conservar el reparto adaptable del encabezado, los resultados locales con asociación accesible y el vacío condicionado por disponibilidad. Mantener borradores independientes, protección de salida y acceso histórico durante la pausa. Continuar la campaña y su documentación sin ampliar este dictamen a superficies no revisadas.
