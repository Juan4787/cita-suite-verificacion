# Campaña de mantenibilidad — 2026-10-15

La fuente de verdad es el [plan aprobado íntegro](../plans/refactorizacion-cita-suite.md). Este documento inicial no lo reemplaza. El avance y las evidencias se mantienen exclusivamente en el [registro separado](../plans/registro-refactorizacion-cita-suite.md).

Estado: en ejecución local. No publicada. Autorización: campaña íntegra, sin producción, datos reales ni contrataciones. Rama: `refactor/maintainability-20261015`.

## Base y preservación

HEAD de entrada: `c4a2417`; el árbol contiene reversiones de la ejecución anterior no autorizada. Se preservan esas diferencias y los archivos ajenos. No se considera aceptada aquella ejecución ni sus evidencias. La referencia publicada anterior registrada es `313355a`; no se confirmó ahora la versión servida.

## Contrato de cierre

1. Inventario y verificaciones secuenciales completas, sin éxito con suites omitidas.
2. Fábricas y consumidores activos tipados; autorización común y contratos JSON validados.
3. Capacidades coherentes y cuotas global/consultorio atómicas: 700 MB global, 100 MB predeterminados al habilitar documentos; máximos compartidos, no espacio garantizado.
4. Disponibilidad compartida en ventanas fijas de 15 días; precios enteros exactos y paridad SQL/TS; mismas garantías transaccionales.
5. Seis áreas: acceso/comercial, equipo, agenda/reservas, pacientes/clínica, integraciones/tareas y sitios/presentación. Interfaces públicas cruzadas permitidas, detalles privados y ciclos prohibidos. Sin capas vacías.
6. Interfaz y recorridos conservados; Natalia usa navegación nativa a Cita Suite. No tocar cursos/noticias ni activar WhatsApp.
7. Programador Cloudflare con tareas independientes, presupuestos completos y recuperación persistente. Push/calendario cada cinco minutos; inicio ordinario dentro de diez minutos.
8. Carga sintética de 5 y 25 consultorios: 30.000/150.000 pacientes y 60.000/300.000 turnos. Entorno pesado externo; nunca producción ni computadora local.
9. Auditoría transversal, documentación, artefactos, reversión y limitaciones comprobadas. Ningún cierre parcial equivale a campaña terminada.

## Evidencia y límites

`verify:fast`, `verify:full` y `verify:release` registran resultados en `.verification/`. Las suites corren secuencialmente, con un trabajador. Una dependencia o suite ausente hace fallar el nivel correspondiente; no cuenta como omitida satisfactoriamente.

Antes de actuar en remoto: resolver la discrepancia de cuenta Cloudflare, comprobar el destino y verificar permisos de Actions. No cambiar el destino para eludir autenticación. Un contenedor local no acredita capacidad del servicio alojado.

## Registro de avance

- Inicio: rama aislada creada con cambios anteriores preservados. Verificaciones antiguas no incluían Natalia ni todas las suites SQL. Se comienza cerrando esas brechas.
